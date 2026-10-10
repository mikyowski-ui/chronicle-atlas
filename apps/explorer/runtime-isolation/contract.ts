import { createHash } from 'node:crypto';
import { BoundaryError, object, strictJson } from './strict-json.ts';

export const POLICY = Object.freeze({
  version: 'm3-linux-fixed-v1', generatedExecution: false, modelProcessing: false,
  requestBytes: 65_536, rows: 2_000, entities: 2_000, cpuSeconds: 2, cpuSecondsPerProcess: 1,
  wallMilliseconds: 2_500, executionMilliseconds: 1_500, addressSpaceBytes: 16 * 1024 * 1024,
  outputBytes: 4_096, diagnosticBytes: 1_024, scratchBytes: 0,
  guestProcesses: 1, guestThreads: 1, terminationMilliseconds: 1_000,
  validatorMilliseconds: 1_000, queue: 1,
});
export const FIXTURES = ['network', 'filesystem', 'descriptors', 'processes', 'memory', 'environment', 'infinite-loop', 'output-flood', 'diagnostic-flood', 'malformed-output', 'markup-output', 'forged-output', 'crash', 'partial-output'] as const;
export type Fixture = typeof FIXTURES[number];
export type StagedRow = Readonly<{ id: string; entityId: string; sourceHash: string; value: number; unit: 'count' }>;
export type TransformRequest = Readonly<{ schema: 1; operation: 'sum-v1'; parentRevision: string; policyHash: string; rows: readonly StagedRow[] }>;
export type SourceGrant = Readonly<{ sourceHash: string; field: 'value'; localTransform: boolean; modelProcessing: false }>;
export type Authority = Readonly<{ dataClass: 'synthetic-isolation-fixture'; parentRevision: string; policyHash: string; grants: readonly SourceGrant[]; records: readonly StagedRow[] }>;
export type TransformResult = Readonly<{ schema: 1; count: number; sum: number }>;
const token = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const hash = /^[a-f0-9]{64}$/;
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
export function admit(raw: Uint8Array, authority: Authority): TransformRequest {
  const data = object(strictJson(raw, POLICY.requestBytes), ['schema', 'operation', 'parentRevision', 'policyHash', 'rows']);
  if (data.schema !== 1 || data.operation !== 'sum-v1' || typeof data.parentRevision !== 'string' || !token.test(data.parentRevision) || typeof data.policyHash !== 'string' || !hash.test(data.policyHash) || !Array.isArray(data.rows) || !data.rows.length || data.rows.length > POLICY.rows) throw new BoundaryError('INVALID_SCHEMA');
  const ids = new Set<string>();
  const rows = data.rows.map((item: unknown): StagedRow => {
    const row = object(item, ['id', 'entityId', 'sourceHash', 'value', 'unit']);
    if (typeof row.id !== 'string' || !token.test(row.id) || ids.has(row.id) || typeof row.entityId !== 'string' || !token.test(row.entityId) || typeof row.sourceHash !== 'string' || !hash.test(row.sourceHash) || typeof row.value !== 'number' || !Number.isFinite(row.value) || Math.abs(row.value) > 1e12 || row.unit !== 'count') throw new BoundaryError('INVALID_ROW');
    ids.add(row.id);
    return Object.freeze({ id: row.id, entityId: row.entityId, sourceHash: row.sourceHash, value: row.value, unit: 'count' });
  });
  const request: TransformRequest = Object.freeze({ schema: 1, operation: 'sum-v1', parentRevision: data.parentRevision, policyHash: data.policyHash, rows: Object.freeze(rows) });
  authorize(request, authority);
  return request;
}
export function authorize(request: TransformRequest, authority: Authority): void {
  if (authority.dataClass !== 'synthetic-isolation-fixture' || request.rows.some(row => !row.id.startsWith('synthetic-'))) throw new BoundaryError('REAL_DATA_EXECUTION_DISABLED');
  if (request.parentRevision !== authority.parentRevision || request.policyHash !== authority.policyHash) throw new BoundaryError('STALE_AUTHORITY');
  if (request.rows.some(row => !authority.records.some(record => record.id === row.id && record.entityId === row.entityId && record.sourceHash === row.sourceHash && record.value === row.value && record.unit === row.unit))) throw new BoundaryError('SOURCE_BINDING_MISMATCH');
  if (request.rows.some(row => !authority.grants.some(grant => grant.sourceHash === row.sourceHash && grant.field === 'value' && grant.localTransform === true && grant.modelProcessing === false))) throw new BoundaryError('FIELD_PERMISSION_DENIED');
}
export function validateResult(raw: Uint8Array, request: TransformRequest): TransformResult {
  const data = object(strictJson(raw, POLICY.outputBytes), ['schema', 'count', 'sum']);
  const expected = request.rows.reduce((sum, row) => sum + row.value, 0);
  if (data.schema !== 1 || data.count !== request.rows.length || data.sum !== expected) throw new BoundaryError('RESULT_LINEAGE_MISMATCH');
  return Object.freeze({ schema: 1, count: request.rows.length, sum: expected });
}
export function generatedExecution(): never { throw new BoundaryError('GENERATED_EXECUTION_DISABLED'); }
