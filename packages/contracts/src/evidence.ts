import { z } from './schema.ts';
import { boundedJSON, canonicalJSON, hashText, immutable } from './canonical.ts';
import { BoundingBoxSchema, EpochSchema, TemporalSupportSchema, type BoundingBox } from './research.ts';

export const EVIDENCE_LIMITS = Object.freeze({ fileBytes: 4194304, responseBytes: 1048576, cacheBytes: 8388608, records: 2000, sources: 4, depth: 14, nodes: 150000 });
export const EVIDENCE_POLICY = 'evidence-intake-1' as const;
const id = z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().trim().min(1).max(4000).refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value));
const position = z.tuple([z.number().finite().min(-180).max(180), z.number().finite().min(-90).max(90)]);
const ring = z.array(position).min(4).max(2048).refine(points => canonicalJSON(points[0]) === canonicalJSON(points.at(-1)));
export const EvidenceGeometrySchema = z.union([
  z.strictObject({ type: z.literal('Point'), coordinates: position }),
  z.strictObject({ type: z.literal('Polygon'), coordinates: z.array(ring).min(1).max(16) }),
]);
const fields = z.strictObject({
  schemaVersion: z.literal(1), id, entityId: id, label: text, variable: text, value: z.union([z.number().finite(), text, z.null()]), unit: text.nullable(),
  geometry: EvidenceGeometrySchema.nullable(), time: TemporalSupportSchema.nullable(), evidenceType: z.enum(['recorded-statement', 'estimate', 'model', 'proxy', 'unknown']),
  uncertainty: text.nullable(), limitations: z.array(text).min(1).max(12), reviewStatus: z.literal('unreviewed'), modelProcessing: z.literal(false),
  source: z.strictObject({ adapterId: id, recordId: text, title: text, locator: text, edition: text, contentHash: hash }),
});
export const EvidenceRecordSchema = fields.extend({ recordHash: hash });
export type EvidenceRecord = z.infer<typeof EvidenceRecordSchema>;
export interface EvidenceSourceAdapter {
  readonly id: string;
  readonly version: string;
  queryEntities(query: string, bounds?: BoundingBox, temporalRange?: [number, number]): Promise<EvidenceRecord[]>;
  fetchRecord(id: string): Promise<EvidenceRecord>;
}
export function boundedEvidence(input: unknown, bytes: number = EVIDENCE_LIMITS.fileBytes): unknown {
  return boundedJSON(input, { bytes, depth: EVIDENCE_LIMITS.depth, nodes: EVIDENCE_LIMITS.nodes });
}
export function makeEvidenceRecord(input: unknown): EvidenceRecord {
  const value = fields.parse(boundedEvidence(input));
  return immutable({ ...value, recordHash: hashText(canonicalJSON(value)) });
}
export function parseEvidenceRecord(input: unknown): EvidenceRecord {
  const record = EvidenceRecordSchema.parse(boundedEvidence(input)), { recordHash, ...body } = record;
  if (recordHash !== hashText(canonicalJSON(body))) throw new Error('EVIDENCE_HASH_MISMATCH');
  return immutable(record);
}
export const EvidenceQueryIntentSchema = z.strictObject({ question: z.string().trim().max(500), sourceIds: z.array(id).min(1).max(EVIDENCE_LIMITS.sources), bounds: BoundingBoxSchema.nullable(), temporalRange: EpochSchema.nullable() })
  .refine(value => new Set(value.sourceIds).size === value.sourceIds.length);
export type EvidenceQueryIntent = z.infer<typeof EvidenceQueryIntentSchema>;
export const EvidenceQueryPlanSchema = z.strictObject({ policy: z.literal(EVIDENCE_POLICY), intentHash: hash, adapters: z.array(z.strictObject({ id, version: id })).min(1).max(EVIDENCE_LIMITS.sources), records: z.array(z.strictObject({ id, recordHash: hash })).min(1).max(EVIDENCE_LIMITS.records) });
export type EvidenceQueryPlan = z.infer<typeof EvidenceQueryPlanSchema>;
export interface ResolvedEvidenceBundle { readonly records: readonly EvidenceRecord[]; readonly resultHash: string }
export const EvidenceDashboardSpecificationSchema = z.strictObject({
  schemaVersion: z.literal(1), kind: z.literal('chronicle-evidence-dashboard'), resultHash: hash, recordIds: z.array(id).min(1).max(EVIDENCE_LIMITS.records), views: z.array(z.enum(['table', 'evidence', 'map'])).min(2).max(3),
}).refine(value => new Set(value.recordIds).size === value.recordIds.length && new Set(value.views).size === value.views.length && value.views.includes('table') && value.views.includes('evidence'));
export type EvidenceDashboardSpecification = z.infer<typeof EvidenceDashboardSpecificationSchema>;
export function validateEvidenceDashboard(input: unknown, bundle: ResolvedEvidenceBundle): EvidenceDashboardSpecification {
  const spec = EvidenceDashboardSpecificationSchema.parse(boundedEvidence(input, 524288));
  if (spec.resultHash !== bundle.resultHash || spec.recordIds.length !== bundle.records.length || spec.recordIds.some(id => !bundle.records.some(record => record.id === id))) throw new Error('UNRESOLVED_EVIDENCE');
  if (spec.views.includes('map') && !bundle.records.some(record => record.geometry !== null)) throw new Error('MISSING_SPATIAL_SUPPORT');
  return immutable(spec);
}
export interface EvidenceWorkspace {
  readonly intent: EvidenceQueryIntent;
  readonly plan: EvidenceQueryPlan;
  readonly bundle: ResolvedEvidenceBundle;
  readonly specification: EvidenceDashboardSpecification;
  readonly planner: 'host' | 'offline-test' | 'live';
}
export const EvidenceReplaySchema = z.strictObject({ schemaVersion: z.literal(1), kind: z.literal('chronicle-evidence-replay'), intent: EvidenceQueryIntentSchema, plan: EvidenceQueryPlanSchema, specification: EvidenceDashboardSpecificationSchema, planner: z.enum(['host', 'offline-test', 'live']) });
export const EvidenceSessionReplaySchema = z.strictObject({ schemaVersion: z.literal(1), kind: z.literal('chronicle-evidence-session'), workspace: EvidenceReplaySchema, cursorYear: z.number().finite().min(-12000).max(3000), selection: z.strictObject({ entityId: id, observationId: id }).nullable() });
export function evidenceAtCursor(record: EvidenceRecord, year: number): boolean { return record.time !== null && Math.floor(year) >= record.time.startYear && Math.floor(year) <= record.time.endYear; }
