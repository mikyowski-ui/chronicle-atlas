import { z } from './schema.ts';
import { boundedJSON, canonicalJSON, hashText, immutable } from './canonical.ts';
import { parseEvidenceRecord, type EvidenceRecord, type ResolvedEvidenceBundle } from './evidence.ts';

export const VISUALIZATION_RUNTIME = 'quickjs-emscripten-0.32.0' as const;
export const VISUALIZATION_POLICY = 'bounded-evidence-svg-1' as const;
export const VISUALIZATION_LIMITS = Object.freeze({ executionMs: 50, heapBytes: 8388608, stackBytes: 262144, programBytes: 16384, inputBytes: 65536, outputBytes: 65536, records: 100, nodes: 512, depth: 8 });
const hash = z.string().regex(/^[a-f0-9]{64}$/), id = z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
export const SandboxedRenderSpecificationSchema = z.strictObject({
  schemaVersion: z.literal(1), kind: z.literal('chronicle-sandbox-render'), runtime: z.literal(VISUALIZATION_RUNTIME), policy: z.literal(VISUALIZATION_POLICY),
  bundleHash: hash, inputHash: hash, programHash: hash, recordIds: z.array(id).min(1).max(VISUALIZATION_LIMITS.records),
  program: z.string().min(1).max(VISUALIZATION_LIMITS.programBytes).refine(value => new TextEncoder().encode(value).byteLength <= VISUALIZATION_LIMITS.programBytes),
  width: z.number().int().min(240).max(1024), height: z.number().int().min(120).max(768),
  limits: z.strictObject({ executionMs: z.literal(50), heapBytes: z.literal(8388608), outputBytes: z.literal(65536) }),
}).refine(value => new Set(value.recordIds).size === value.recordIds.length && value.programHash === hashText(value.program));
export type SandboxedRenderSpecification = z.infer<typeof SandboxedRenderSpecificationSchema>;
export const RenderFailureCodeSchema = z.enum(['INVALID_SPEC', 'BINDING_MISMATCH', 'INPUT_LIMIT', 'OUTPUT_LIMIT', 'INVALID_OUTPUT', 'GUEST_ERROR', 'TIMEOUT', 'CANCELLED', 'RUNTIME_UNAVAILABLE']);
export type RenderFailureCode = z.infer<typeof RenderFailureCodeSchema>;
export class VisualizationError extends Error { constructor(readonly code: RenderFailureCode) { super(code); this.name = 'VisualizationError'; } }
const paint = ['fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity'] as const;
export const SVG_ATTRIBUTE_VOCABULARY = immutable({
  svg: ['xmlns', 'viewBox', 'width', 'height'], g: ['data-record-id', 'transform', ...paint],
  rect: ['x', 'y', 'width', 'height', 'rx', 'ry', ...paint], circle: ['cx', 'cy', 'r', ...paint], ellipse: ['cx', 'cy', 'rx', 'ry', ...paint],
  line: ['x1', 'y1', 'x2', 'y2', ...paint], polyline: ['points', ...paint], polygon: ['points', ...paint], path: ['d', ...paint],
  text: ['x', 'y', 'font-size', 'font-weight', 'text-anchor', ...paint], tspan: ['x', 'y', 'dx', 'dy', 'font-size', 'font-weight', ...paint],
} as const);
export interface SafeSVGNode { readonly tag: keyof typeof SVG_ATTRIBUTE_VOCABULARY; readonly attributes: Readonly<Record<string, string>>; readonly children: readonly SafeSVGNode[]; readonly text: string }
export type VisualizationResult =
  | { readonly status: 'rendered'; readonly svg: string; readonly tree: SafeSVGNode; readonly programHash: string; readonly inputHash: string; readonly bundleHash: string; readonly elapsedMs: number; readonly runtime: typeof VISUALIZATION_RUNTIME; readonly heapLimitBytes: 8388608 }
  | { readonly status: 'fallback'; readonly code: RenderFailureCode; readonly elapsedMs: number };
export const VisualizationWireResultSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('rendered'), svg: z.string().max(VISUALIZATION_LIMITS.outputBytes), programHash: hash, inputHash: hash, bundleHash: hash, elapsedMs: z.number().finite().min(0).max(50), runtime: z.literal(VISUALIZATION_RUNTIME), heapLimitBytes: z.literal(8388608) }),
  z.strictObject({ status: z.literal('fallback'), code: RenderFailureCodeSchema, elapsedMs: z.number().finite().min(0).max(60000) }),
]);
export function projectVisualizationRecords(records: readonly EvidenceRecord[]) { return records.map(({ id, label, variable, value, unit, time, geometry }) => ({ id, label, variable, value, unit, time, geometry })); }
function checkedRecords(bundle: ResolvedEvidenceBundle): EvidenceRecord[] {
  if (!bundle || !Array.isArray(bundle.records) || bundle.records.length < 1 || bundle.records.length > VISUALIZATION_LIMITS.records || !hash.safeParse(bundle.resultHash).success) throw new VisualizationError('INPUT_LIMIT');
  let records: EvidenceRecord[];
  try { records = (boundedJSON(bundle.records, { bytes: VISUALIZATION_LIMITS.inputBytes, depth: 14, nodes: 20000 }) as unknown[]).map(parseEvidenceRecord); }
  catch { throw new VisualizationError('INPUT_LIMIT'); }
  if (new Set(records.map(record => record.id)).size !== records.length) throw new VisualizationError('BINDING_MISMATCH');
  return records;
}
export function createRenderSpecification(bundle: ResolvedEvidenceBundle, program: string, dimensions: { width?: number; height?: number } = {}): SandboxedRenderSpecification {
  const records = checkedRecords(bundle);
  return immutable(SandboxedRenderSpecificationSchema.parse({ schemaVersion: 1, kind: 'chronicle-sandbox-render', runtime: VISUALIZATION_RUNTIME, policy: VISUALIZATION_POLICY, bundleHash: bundle.resultHash, inputHash: hashText(canonicalJSON(projectVisualizationRecords(records))), recordIds: records.map(record => record.id), program, programHash: hashText(program), width: dimensions.width ?? 640, height: dimensions.height ?? 240, limits: { executionMs: 50, heapBytes: 8388608, outputBytes: 65536 } }));
}
export function validateRenderInput(input: unknown, bundle: ResolvedEvidenceBundle): { specification: SandboxedRenderSpecification; records: readonly EvidenceRecord[] } {
  let specification: SandboxedRenderSpecification;
  try { specification = SandboxedRenderSpecificationSchema.parse(boundedJSON(input, { bytes: 32768, depth: 8, nodes: 3000 })); }
  catch { throw new VisualizationError('INVALID_SPEC'); }
  const records = checkedRecords(bundle);
  if (specification.bundleHash !== bundle.resultHash || specification.inputHash !== hashText(canonicalJSON(projectVisualizationRecords(records))) || canonicalJSON(specification.recordIds) !== canonicalJSON(records.map(record => record.id))) throw new VisualizationError('BINDING_MISMATCH');
  return immutable({ specification, records });
}
