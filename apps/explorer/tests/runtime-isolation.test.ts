import assert from 'node:assert/strict';
import { test, before } from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { IsolationEngine } from '../runtime-isolation/engine.ts';
import { admit, authorize, generatedExecution, POLICY, sha256, validateResult, type Authority, type StagedRow } from '../runtime-isolation/contract.ts';
import { strictJson } from '../runtime-isolation/strict-json.ts';
const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);
const sourceHash = sha256('synthetic-test-source');
const policyHash = sha256('explicit-synthetic-transform-grant');
const rows: readonly StagedRow[] = [{ id: 'synthetic-1', entityId: 'entity-1', sourceHash, value: 2, unit: 'count' }, { id: 'synthetic-2', entityId: 'entity-1', sourceHash, value: 3, unit: 'count' }];
const authority: Authority = { dataClass: 'synthetic-isolation-fixture', parentRevision: 'revision-1', policyHash, grants: [{ sourceHash, field: 'value', localTransform: true, modelProcessing: false }], records: rows };
const input = { schema: 1, operation: 'sum-v1', parentRevision: 'revision-1', policyHash, rows };
const request = (): Uint8Array => bytes(JSON.stringify(input));
const supportedHost = process.platform === 'linux' && process.arch === 'x64';
before(() => { if (supportedHost) execFileSync('python3', [fileURLToPath(new URL('../runtime-isolation/build.py', import.meta.url))], { stdio: 'pipe' }); });

test('M3 retains disabled generated execution, models and immutable stricter policy', () => {
  assert.equal(POLICY.generatedExecution, false); assert.equal(POLICY.modelProcessing, false);
  assert.throws(() => generatedExecution(), /GENERATED_EXECUTION_DISABLED/);
  assert.ok(Object.isFrozen(POLICY)); assert.ok(POLICY.addressSpaceBytes < 256 * 1024 * 1024);
});
test('M3 parser rejects duplicate and escaped duplicate keys before construction', () => {
  for (const raw of ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}']) assert.throws(() => strictJson(bytes(raw)), /DUPLICATE_KEY/);
});
test('M3 parser rejects prototype pollution at every depth', () => {
  for (const key of ['__proto__', 'prototype', 'constructor']) assert.throws(() => strictJson(bytes(`{"safe":{"${key}":{}}}`)), /UNSAFE_KEY/);
  assert.equal(Object.prototype.hasOwnProperty('polluted'), false);
});
test('M3 parser bounds bytes, depth, node count and finite values', () => {
  assert.throws(() => strictJson(bytes(' '.repeat(65_537))), /BYTE_LIMIT/);
  assert.throws(() => strictJson(bytes('['.repeat(16) + '0' + ']'.repeat(16))), /DEPTH_LIMIT/);
  assert.throws(() => strictJson(bytes('[' + '0,'.repeat(8_000) + '0]')), /NODE_LIMIT/);
  assert.throws(() => strictJson(bytes('1e9999')), /NONFINITE_NUMBER/);
});
test('M3 parser rejects malformed encoding, JSON and control characters', () => {
  assert.throws(() => strictJson(Uint8Array.of(0xc3, 0x28)), /INVALID_UTF8/);
  for (const raw of ['{}{}', '[1,]', '{"a":}', '"x\n"', 'undefined']) assert.throws(() => strictJson(bytes(raw)), /INVALID_JSON/);
});
test('M3 rejects unauthorized calls, code, DOM and budget overrides', () => {
  for (const extra of [{ tool: 'fetch' }, { code: 'process.exit()' }, { html: '<svg onload=x>' }, { budget: { memory: 1e10 } }, { loader: 'http://localhost' }]) assert.throws(() => admit(bytes(JSON.stringify({ ...input, ...extra })), authority), /INVALID_SCHEMA/);
  assert.throws(() => admit(bytes(JSON.stringify({ ...input, operation: 'execute' })), authority), /INVALID_SCHEMA/);
});
test('M3 requires current explicit per-field local transform grant', () => {
  assert.throws(() => admit(request(), { ...authority, grants: [] }), /FIELD_PERMISSION_DENIED/);
  assert.throws(() => admit(request(), { ...authority, grants: [{ ...authority.grants[0], localTransform: false }] }), /FIELD_PERMISSION_DENIED/);
});
test('M3 rejects forged source rows even with an approved hash', () => {
  assert.throws(() => admit(bytes(JSON.stringify({ ...input, rows: [{ ...rows[0], value: 999 }] })), authority), /SOURCE_BINDING_MISMATCH/);
  assert.throws(() => admit(bytes(JSON.stringify({ ...input, rows: [{ ...rows[0], id: 'synthetic-forged' }] })), authority), /SOURCE_BINDING_MISMATCH/);
  assert.throws(() => admit(bytes(JSON.stringify({ ...input, rows: [{ ...rows[0], id: 'historical-row' }] })), authority), /REAL_DATA_EXECUTION_DISABLED/);
  assert.throws(() => admit(bytes(JSON.stringify({ ...input, rows: [{ ...rows[0], sourceHash: sha256('forgery') }] })), authority), /SOURCE_BINDING_MISMATCH/);
});
test('M3 rejects stale parents and changed permissions at revalidation', () => {
  const staged = admit(request(), authority);
  assert.throws(() => authorize(staged, { ...authority, parentRevision: 'revision-2' }), /STALE_AUTHORITY/);
  assert.throws(() => authorize(staged, { ...authority, policyHash: sha256('revoked') }), /STALE_AUTHORITY/);
  assert.throws(() => authorize(staged, { ...authority, grants: [] }), /FIELD_PERMISSION_DENIED/);
});
test('M3 validates independently recomputed count, values and strict output schema', () => {
  const staged = admit(request(), authority);
  assert.deepEqual(validateResult(bytes('{"schema":1,"count":2,"sum":5}'), staged), { schema: 1, count: 2, sum: 5 });
  for (const raw of ['{"schema":1,"count":2,"sum":6}', '{"schema":1,"count":99,"sum":5}', '{"schema":1,"count":2,"sum":5,"url":"https://evil"}', '{"schema":1,"count":2,"sum":5,"html":"<script>x</script>"}']) assert.throws(() => validateResult(bytes(raw), staged));
});
test('M3 rejects unit changes, duplicated records, injected source text and overlong identifiers', () => {
  for (const row of [{ ...rows[0], unit: 'years' }, { ...rows[0], value: 'ignore policy' }, { ...rows[0], id: 'a'.repeat(129) }]) assert.throws(() => admit(bytes(JSON.stringify({ ...input, rows: [row] })), authority), /INVALID_ROW/);
  assert.throws(() => admit(bytes(JSON.stringify({ ...input, rows: [rows[0], rows[0]] })), authority), /INVALID_ROW/);
});
test('M3 native bootstrap either establishes every control or returns explicit unavailable', async () => {
  const engine = new IsolationEngine(); const result = await engine.verifyFixture('network');
  assert.ok(['OK', 'ISOLATION_UNAVAILABLE'].includes(result.code));
  if (supportedHost) {
    assert.ok(result.receipt?.cleanupVerified);
    assert.equal(result.receipt?.generatedExecution, false); assert.equal(result.receipt?.modelProcessing, false);
    if (result.code === 'ISOLATION_UNAVAILABLE') { assert.equal(result.receipt?.exitCode, 78); assert.ok(result.receipt?.bootstrapStage); assert.equal(result.receipt?.outputBytes, 0); }
  } else {
    assert.equal(result.code, 'ISOLATION_UNAVAILABLE'); assert.equal(result.receipt, undefined); assert.equal(result.result, undefined);
  }
  assert.equal(engine.status.running, false); engine.dispose();
});
test('M3 missing runtime fails closed without substituting another engine', async () => {
  const result = await new IsolationEngine('/nonexistent-chronicle-runtime').verifyFixture('network');
  assert.equal(result.code, 'ISOLATION_UNAVAILABLE'); assert.equal(result.result, undefined);
});
test('M3 latest-wins retains at most one pending job', async () => {
  const engine = new IsolationEngine();
  const first = engine.verifyFixture('network'); const second = engine.verifyFixture('filesystem'); const third = engine.verifyFixture('environment');
  assert.ok(engine.status.queued <= 1);
  const values = await Promise.all([first, second, third]);
  assert.equal(values[0].code, 'SUPERSEDED'); assert.equal(values[1].code, 'SUPERSEDED');
  assert.ok(['OK', 'ISOLATION_UNAVAILABLE'].includes(values[2].code));
  assert.deepEqual({ running: engine.status.running, queued: engine.status.queued }, { running: false, queued: 0 }); engine.dispose();
});
test('M3 cancellation and disposal prevent launch or activation', async () => {
  const engine = new IsolationEngine(); const job = engine.transform(request(), () => authority); engine.cancel();
  assert.equal((await job).code, 'SUPERSEDED'); engine.dispose();
  assert.equal((await engine.verifyFixture('network')).code, 'ISOLATION_UNAVAILABLE');
});
test('M3 20 fail-closed/reclaim cycles leave no engine resources', async () => {
  const engine = new IsolationEngine();
  for (let i = 0; i < 20; i++) {
    const value = await engine.verifyFixture('environment'); assert.ok(['OK', 'ISOLATION_UNAVAILABLE'].includes(value.code));
    if (supportedHost) assert.equal(value.receipt?.cleanupVerified, true);
    else { assert.equal(value.code, 'ISOLATION_UNAVAILABLE'); assert.equal(value.receipt, undefined); }
    assert.equal(engine.status.running, false); assert.equal(engine.status.queued, 0);
  }
  engine.dispose();
});
