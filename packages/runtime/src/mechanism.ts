/** Trusted Watt mechanism compiler and validator. Pinned host records are the only data source. */
import { boundedJSON, canonicalJSON, hashText, immutable } from '@chronicle/contracts/canonical';
import {
  MECHANISM_LIMITS, MECHANISM_VERSIONS, MechanismDatasetSchema, MechanismReplaySchema, MechanismSelectionSchema, MechanismSpecificationSchema, SourceDocumentSchema,
  type MechanismClaim, type MechanismComponent, type MechanismDataset, type MechanismFunction, type MechanismQueryPlan,
  type MechanismSelection, type MechanismSpecification, type SourceDocument,
} from '@chronicle/contracts/mechanism';

export type MechanismErrorCode = 'INVALID_SPEC' | 'UNKNOWN_REFERENCE' | 'EDITION_MISMATCH' | 'EVIDENCE_MISMATCH' | 'BUDGET_EXCEEDED';
export class MechanismError extends Error {
  constructor(readonly code: MechanismErrorCode, message: string) { super(message); this.name = 'MechanismError'; }
}
const fail = (code: MechanismErrorCode, message: string): never => { throw new MechanismError(code, message); };
const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
const contentHash = (value: unknown) => hashText(canonicalJSON(value));
const limits = (bytes: number) => ({ bytes, depth: MECHANISM_LIMITS.depth, nodes: MECHANISM_LIMITS.nodes });
function bounded(input: unknown, bytes: number): unknown {
  try { return boundedJSON(input, limits(bytes)); }
  catch (error) { return fail(error instanceof Error && 'code' in error && error.code === 'BUDGET_EXCEEDED' ? 'BUDGET_EXCEEDED' : 'INVALID_SPEC', 'Input must be bounded plain JSON.'); }
}
function parse<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, value: unknown, message: string): T {
  const result = schema.safeParse(value);
  return result.success ? result.data : fail('INVALID_SPEC', message);
}

export interface MechanismRegistration {
  readonly descriptor: { readonly id: string; readonly edition: string; readonly dataHash: string; readonly sourceHash: string };
  readonly source: SourceDocument;
  readonly dataset: MechanismDataset;
}
const verified = new WeakSet<MechanismRegistration>();

/** Pins content hashes, re-verifies every passage hash and requires every quotation to occur verbatim in its pinned passage. */
export function registerMechanism(sourceRaw: string, datasetRaw: string, pins: { readonly sourceHash: string; readonly datasetHash: string }): MechanismRegistration {
  const sourceInput = bounded(sourceRaw, MECHANISM_LIMITS.sourceBytes), datasetInput = bounded(datasetRaw, MECHANISM_LIMITS.datasetBytes);
  if (contentHash(sourceInput) !== pins.sourceHash) fail('EDITION_MISMATCH', 'Source excerpt differs from the host-pinned edition.');
  if (contentHash(datasetInput) !== pins.datasetHash) fail('EDITION_MISMATCH', 'Mechanism records differ from the host-pinned edition.');
  const source = parse(SourceDocumentSchema, sourceInput, 'Source excerpt is not a valid pinned record.');
  for (const passage of source.passages) {
    if (normalize(passage.text) !== passage.text || hashText(passage.text) !== passage.sha256) fail('EVIDENCE_MISMATCH', 'A source passage differs from its recorded hash.');
  }
  const dataset = parse(MechanismDatasetSchema, datasetInput, 'Mechanism records do not satisfy the domain contract.');
  if (dataset.sourceId !== source.id || dataset.sourceSha256 !== pins.sourceHash) fail('EDITION_MISMATCH', 'Mechanism records cite a different source edition.');
  const passages = new Map(source.passages.map(passage => [passage.id, passage]));
  const claims = new Map<string, MechanismClaim>(), rows = new Set<string>(), used = new Set<string>();
  for (const claim of dataset.claims) {
    if (claims.has(claim.id)) fail('INVALID_SPEC', 'Duplicate claim identifier.');
    const passage = passages.get(claim.passageId);
    if (claim.sourceId !== source.id || !passage) fail('UNKNOWN_REFERENCE', 'A claim cites an unregistered passage.');
    if ((passage!.role === 'patent-specification-text') !== (claim.evidence === 'attested-specification-text')) fail('EVIDENCE_MISMATCH', 'Claim evidence class differs from its passage role.');
    if (normalize(claim.quote) !== claim.quote || !passage!.text.includes(claim.quote)) fail('EVIDENCE_MISMATCH', 'A quotation does not occur verbatim in its pinned passage.');
    claims.set(claim.id, claim);
  }
  const cite = (ids: readonly string[]) => { for (const id of ids) { if (!claims.has(id)) fail('UNKNOWN_REFERENCE', 'A row cites an unknown claim.'); used.add(id); } };
  for (const row of [...dataset.components, ...dataset.functions]) { if (rows.has(row.id) || claims.has(row.id)) fail('INVALID_SPEC', 'Row identifiers must be unique across the domain.'); rows.add(row.id); cite(row.claimIds); }
  const components = new Set(dataset.components.map(component => component.id)), referenced = new Set<string>();
  for (const fn of dataset.functions) for (const component of fn.componentIds) { if (!components.has(component)) fail('UNKNOWN_REFERENCE', 'A function names an unknown component.'); referenced.add(component); }
  if ([...components].some(component => !referenced.has(component))) fail('INVALID_SPEC', 'Every component must take part in at least one function.');
  cite([dataset.statedPurposeClaimId]); cite(dataset.temporalSupport.claimIds); for (const omission of dataset.coverage.omissions) cite(omission.claimIds);
  if (used.size !== claims.size) fail('INVALID_SPEC', 'Every retained claim must support a row, coverage note or support statement.');
  const registration = immutable({ descriptor: { id: dataset.id, edition: dataset.edition, dataHash: pins.datasetHash, sourceHash: pins.sourceHash }, source, dataset });
  verified.add(registration);
  return registration;
}
function requireVerified(registration: MechanismRegistration): void {
  if (!verified.has(registration)) fail('EDITION_MISMATCH', 'Only byte-verified mechanism registrations are usable.');
}

export function compileMechanismPlan(registration: MechanismRegistration): MechanismQueryPlan {
  requireVerified(registration);
  const { dataset, descriptor } = registration;
  return immutable({
    schemaVersion: 1, domain: 'technological-mechanism', datasetId: descriptor.id, edition: descriptor.edition, dataHash: descriptor.dataHash, sourceHashes: [descriptor.sourceHash],
    operation: 'component-function-tables', componentIds: dataset.components.map(item => item.id).sort(), functionIds: dataset.functions.map(item => item.id).sort(),
    joins: 'declared-claim-links-only', policyVersion: MECHANISM_VERSIONS.policy,
  } as const);
}
export function defaultMechanismViews(): MechanismSpecification['views'] {
  return (['summary', 'component-table', 'function-table', 'evidence'] as const).map(type => ({ id: `view-${type}`, type, binding: 'mechanism' as const }));
}
export function specForMechanism(registration: MechanismRegistration, views = defaultMechanismViews(), workspaceId = 'mechanism-workspace'): MechanismSpecification {
  return { schemaVersion: 1, kind: 'mechanism-workspace', id: workspaceId, title: registration.dataset.title, plan: compileMechanismPlan(registration), views, selection: 'row-claim', layout: 'adaptive' };
}
/** Trusted recompilation: a specification may arrange views but cannot alter pins, rows, joins or policy. */
export function validateMechanismSpecification(input: unknown, registration: MechanismRegistration): MechanismSpecification {
  const spec = parse(MechanismSpecificationSchema, bounded(input, MECHANISM_LIMITS.replayBytes), 'Mechanism specification does not satisfy the contract.');
  if (new Set(spec.views.map(view => view.id)).size !== spec.views.length || new Set(spec.views.map(view => view.type)).size !== spec.views.length) fail('INVALID_SPEC', 'Duplicate view IDs or types.');
  if (canonicalJSON(spec.plan) !== canonicalJSON(compileMechanismPlan(registration))) fail('EDITION_MISMATCH', 'Plan pins, rows or policy differ from the host-compiled plan.');
  return immutable(spec);
}

export interface MechanismBundle {
  readonly title: string; readonly descriptor: MechanismRegistration['descriptor'];
  readonly components: readonly MechanismComponent[]; readonly functions: readonly MechanismFunction[]; readonly claims: readonly MechanismClaim[];
  readonly statedPurposeClaimId: string; readonly spatialSupport: MechanismDataset['spatialSupport']; readonly temporalSupport: MechanismDataset['temporalSupport']; readonly coverage: MechanismDataset['coverage'];
  readonly source: Omit<SourceDocument, 'passages'> & { readonly passages: readonly { readonly id: string; readonly role: string; readonly byteRange: readonly [number, number]; readonly sha256: string }[] };
  readonly resultHash: string;
}
export function resolveMechanism(spec: MechanismSpecification, registration: MechanismRegistration): MechanismBundle {
  const checked = validateMechanismSpecification(spec, registration), { dataset, source } = registration;
  const componentIds = new Set(checked.plan.componentIds), functionIds = new Set(checked.plan.functionIds);
  const components = dataset.components.filter(item => componentIds.has(item.id)), functions = dataset.functions.filter(item => functionIds.has(item.id));
  const { passages, ...sourceSummary } = source;
  const content = {
    title: dataset.title, descriptor: registration.descriptor, components, functions, claims: dataset.claims, statedPurposeClaimId: dataset.statedPurposeClaimId,
    spatialSupport: dataset.spatialSupport, temporalSupport: dataset.temporalSupport, coverage: dataset.coverage,
    source: { ...sourceSummary, passages: passages.map(({ id, role, byteRange, sha256 }) => ({ id, role, byteRange, sha256 })) },
  };
  return immutable({ ...content, resultHash: contentHash({ plan: checked.plan, components: components.map(item => item.id), functions: functions.map(item => item.id), claims: dataset.claims.map(item => [item.id, hashText(item.quote)]) }) });
}

export type ResolvedMechanismSelection = { readonly kind: 'component' | 'function'; readonly row: MechanismComponent | MechanismFunction; readonly claim: MechanismClaim };
/** A selection is valid only when its row exists and declares the selected claim. Missing rows are never replaced. */
export function resolveMechanismSelection(bundle: MechanismBundle, selection: { readonly entityId: string; readonly observationId: string } | null): ResolvedMechanismSelection | null {
  if (!selection) return null;
  const component = bundle.components.find(item => item.id === selection.entityId), fn = component ? undefined : bundle.functions.find(item => item.id === selection.entityId);
  const row = component ?? fn;
  if (!row || !row.claimIds.includes(selection.observationId)) return null;
  const claim = bundle.claims.find(item => item.id === selection.observationId);
  return claim ? { kind: component ? 'component' : 'function', row, claim } : null;
}

export function exportMechanismReplay(spec: MechanismSpecification, bundle: MechanismBundle, cursorYear: number, selection: MechanismSelection | null): string {
  const archive = MechanismReplaySchema.parse({
    schemaVersion: 1, kind: 'chronicle-mechanism-replay',
    versions: { schema: MECHANISM_VERSIONS.schema, domain: MECHANISM_VERSIONS.domain, policy: MECHANISM_VERSIONS.policy, renderer: MECHANISM_VERSIONS.renderer },
    specification: spec, cursorYear: Math.floor(cursorYear), cursorPrecision: 'year-navigation-anchor',
    selection: resolveMechanismSelection(bundle, selection) ? selection : null,
  });
  const text = canonicalJSON(archive);
  if (new TextEncoder().encode(text).byteLength > MECHANISM_LIMITS.replayBytes) fail('BUDGET_EXCEEDED', 'Mechanism replay exceeds 64 KiB.');
  return text + '\n';
}
export function isMechanismReplay(input: unknown): boolean {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const kind = Object.getOwnPropertyDescriptor(input, 'kind');
  return !!kind && 'value' in kind && kind.value === 'chronicle-mechanism-replay';
}
/** Strict shape preflight happens before dependency loading; restoration then rechecks pins, rows and selection. */
export function preflightMechanismReplay(input: unknown): { readonly datasetId: string } {
  const archive = parse(MechanismReplaySchema, bounded(input, MECHANISM_LIMITS.replayBytes), 'Mechanism replay does not satisfy the archive contract.');
  return { datasetId: archive.specification.plan.datasetId };
}
export function restoreMechanismReplay(input: unknown, registration: MechanismRegistration): { readonly spec: MechanismSpecification; readonly bundle: MechanismBundle; readonly restored: { readonly cursorYear: number; readonly selection: MechanismSelection | null } } {
  const archive = parse(MechanismReplaySchema, bounded(input, MECHANISM_LIMITS.replayBytes), 'Mechanism replay does not satisfy the archive contract.');
  const spec = validateMechanismSpecification(archive.specification, registration), bundle = resolveMechanism(spec, registration);
  const selection = archive.selection === null ? null : parse(MechanismSelectionSchema, archive.selection, 'Invalid saved selection.');
  if (selection && !resolveMechanismSelection(bundle, selection)) fail('UNKNOWN_REFERENCE', 'Saved selection is not a declared row and claim pair.');
  return immutable({ spec, bundle, restored: { cursorYear: archive.cursorYear, selection } });
}
