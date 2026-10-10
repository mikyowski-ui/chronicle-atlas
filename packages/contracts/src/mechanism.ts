/** Watt mechanism contracts. One Zod source for runtime validation and types; no map, canvas or spatial fields. */
import { z } from 'zod';

z.config({ jitless: true });

export const MECHANISM_VERSIONS = Object.freeze({ schema: 1, domain: 'watt-separate-condenser-1', policy: 'mechanism-evidence-1', renderer: 'mechanism-tables-1' } as const);
export const MECHANISM_LIMITS = Object.freeze({ sourceBytes: 65536, datasetBytes: 262144, replayBytes: 65536, depth: 12, nodes: 20000 });
const id = z.string().regex(/^[a-z][a-z0-9-]{0,79}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const inert = (max: number) => z.string().min(1).max(max).refine(value => value === value.trim() && !/[<>\u0000-\u0008]/.test(value) && !/```|javascript:|data:/i.test(value), 'Inert text only.');
const text = inert(4000);
const httpsURL = z.string().max(2048).refine(value => { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash; } catch { return false; } }, 'A plain HTTPS source address is required.');
const uniqueIds = (values: readonly string[]) => new Set(values).size === values.length;

export const PRINCIPLES = ['Preamble', 'First', 'Second', 'Third', 'Fourth', 'Sixth', 'Last'] as const;
export const SourcePassageSchema = z.strictObject({
  id, role: z.enum(['patent-specification-text', 'reprint-editorial-statement']),
  byteRange: z.tuple([z.number().int().min(0), z.number().int().min(1)]).refine(([start, end]) => start < end, 'Byte range is reversed.'),
  text: inert(8000), sha256: hash,
});
export const SourceDocumentSchema = z.strictObject({
  schemaVersion: z.literal(1), id, domain: z.literal('technological-mechanism'), title: text, edition: text,
  retrieval: z.strictObject({ url: httpsURL, retrievedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), upstreamBytes: z.number().int().min(1), upstreamSha256: hash }),
  normalization: text, passages: z.array(SourcePassageSchema).min(1).max(8),
  primaryRecord: z.strictObject({ label: text, url: httpsURL, bytes: z.number().int().min(1), sha256: hash, status: z.literal('pinned-not-retained-not-collated') }),
  rights: z.literal('public-domain-text'), modelProcessing: z.literal(false), republication: z.literal(false), limitations: z.array(text).min(1).max(12),
}).refine(value => uniqueIds(value.passages.map(item => item.id)), 'Duplicate passage IDs.');
export type SourceDocument = z.infer<typeof SourceDocumentSchema>;

export const ClaimSchema = z.strictObject({
  id, sourceId: id, passageId: id, principle: z.enum(PRINCIPLES).nullable(), locator: text, quote: inert(2000),
  evidence: z.enum(['attested-specification-text', 'reprint-editorial-statement']),
  reviewStatus: z.literal('quote-verified-not-scholarly-reviewed'),
});
export type MechanismClaim = z.infer<typeof ClaimSchema>;
export const ComponentSchema = z.strictObject({ id, label: inert(160), sourceTerm: inert(400), role: text, claimIds: z.array(id).min(1).max(8), wording: z.literal('host-paraphrase') })
  .refine(value => uniqueIds(value.claimIds), 'Duplicate claim references.');
export type MechanismComponent = z.infer<typeof ComponentSchema>;
export const FunctionSchema = z.strictObject({
  id, label: inert(160), principle: z.enum(PRINCIPLES), statement: text, componentIds: z.array(id).max(8), componentNote: text.nullable(),
  claimIds: z.array(id).min(1).max(8), wording: z.literal('host-paraphrase'),
}).refine(value => uniqueIds(value.componentIds) && uniqueIds(value.claimIds), 'Duplicate references.')
  .refine(value => value.componentIds.length > 0 || value.componentNote !== null, 'A function without named components must say why.');
export type MechanismFunction = z.infer<typeof FunctionSchema>;
export const MechanismDatasetSchema = z.strictObject({
  schemaVersion: z.literal(1), id, edition: text, domain: z.literal('technological-mechanism'), title: inert(240),
  sourceId: id, sourceSha256: hash, statedPurposeClaimId: id,
  spatialSupport: z.strictObject({ kind: z.literal('not-applicable'), note: text }),
  temporalSupport: z.strictObject({ startYear: z.number().int().min(-12000).max(3000), endYear: z.number().int().min(-12000).max(3000), precision: z.literal('year'), meaning: text, claimIds: z.array(id).min(1).max(4) })
    .refine(value => value.startYear <= value.endYear, 'Temporal support is reversed.'),
  coverage: z.strictObject({ note: text, omissions: z.array(z.strictObject({ label: text, claimIds: z.array(id).min(1).max(4) })).max(8) }),
  claims: z.array(ClaimSchema).min(1).max(400), components: z.array(ComponentSchema).min(1).max(200), functions: z.array(FunctionSchema).min(1).max(200),
});
export type MechanismDataset = z.infer<typeof MechanismDatasetSchema>;

export const MechanismQueryPlanSchema = z.strictObject({
  schemaVersion: z.literal(1), domain: z.literal('technological-mechanism'), datasetId: id, edition: text, dataHash: hash, sourceHashes: z.array(hash).min(1).max(8),
  operation: z.literal('component-function-tables'), componentIds: z.array(id).min(1).max(200), functionIds: z.array(id).min(1).max(200),
  joins: z.literal('declared-claim-links-only'), policyVersion: z.literal(MECHANISM_VERSIONS.policy),
});
export type MechanismQueryPlan = z.infer<typeof MechanismQueryPlanSchema>;
export const MECHANISM_VIEW_TYPES = ['summary', 'component-table', 'function-table', 'evidence'] as const;
export const MechanismViewSchema = z.strictObject({ id: z.string().regex(/^[a-z][a-z0-9-]{0,79}$/), type: z.enum(MECHANISM_VIEW_TYPES), binding: z.literal('mechanism') });
export const MechanismSpecificationSchema = z.strictObject({
  schemaVersion: z.literal(1), kind: z.literal('mechanism-workspace'), id, title: inert(240), plan: MechanismQueryPlanSchema,
  views: z.array(MechanismViewSchema).min(1).max(MECHANISM_VIEW_TYPES.length), selection: z.literal('row-claim'), layout: z.literal('adaptive'),
});
export type MechanismSpecification = z.infer<typeof MechanismSpecificationSchema>;
/** Same shape as the host store selection: entityId names a component or function row; observationId names its claim. */
export const MechanismSelectionSchema = z.strictObject({ entityId: id, observationId: id });
export type MechanismSelection = z.infer<typeof MechanismSelectionSchema>;
export const MechanismReplaySchema = z.strictObject({
  schemaVersion: z.literal(1), kind: z.literal('chronicle-mechanism-replay'),
  versions: z.strictObject({ schema: z.literal(1), domain: z.literal(MECHANISM_VERSIONS.domain), policy: z.literal(MECHANISM_VERSIONS.policy), renderer: z.literal(MECHANISM_VERSIONS.renderer) }),
  specification: MechanismSpecificationSchema, cursorYear: z.number().int().min(-12000).max(3000), cursorPrecision: z.literal('year-navigation-anchor'),
  selection: MechanismSelectionSchema.nullable(),
});
export type MechanismReplay = z.infer<typeof MechanismReplaySchema>;
