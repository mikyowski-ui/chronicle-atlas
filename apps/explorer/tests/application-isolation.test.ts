import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { ApplicationIsolationEngine, APPLICATION_POLICY, type ApplicationFixture } from '../runtime-isolation/application-engine.ts';
import { sha256, type Authority, type StagedRow } from '../runtime-isolation/contract.ts';
const sourceHash = sha256('synthetic-application-source'); const policyHash = sha256('synthetic-application-policy');
const rows: readonly StagedRow[] = [{ id: 'synthetic-app-1', entityId: 'entity-1', sourceHash, value: 2, unit: 'count' }, { id: 'synthetic-app-2', entityId: 'entity-1', sourceHash, value: 3, unit: 'count' }];
const authority: Authority = { dataClass: 'synthetic-isolation-fixture', parentRevision: 'revision-app-1', policyHash, records: rows, grants: [{ sourceHash, field: 'value', localTransform: true, modelProcessing: false }] };
const input = (): Uint8Array => new TextEncoder().encode(JSON.stringify({ schema: 1, operation: 'sum-v1', parentRevision: authority.parentRevision, policyHash, rows }));

for (const fixture of ['network', 'dom', 'environment', 'filesystem', 'processes', 'constructor-escape', 'prototype-pollution', 'unauthorized-call'] as const) {
  test(`M3 application VM denies reviewed ${fixture} capability probe`, async () => {
    const engine = new ApplicationIsolationEngine(); const outcome = await engine.verifyFixture(fixture);
    assert.equal(outcome.code, 'OK'); assert.equal(outcome.receipt?.cleanupVerified, true);
    assert.equal(outcome.receipt?.kernelIsolation, false); assert.equal(outcome.receipt?.generatedExecution, false);
    engine.dispose(); assert.equal(Object.prototype.hasOwnProperty('syntheticPollution'), false);
  });
}
for (const [fixture, expected] of [
  ['infinite-loop', 'EXECUTION_TIMEOUT'], ['memory-flood', 'MEMORY_LIMIT'], ['output-flood', 'OUTPUT_LIMIT'],
  ['diagnostic-flood', 'DIAGNOSTIC_LIMIT'], ['malformed-output', 'DUPLICATE_KEY'], ['markup-output', 'INVALID_SCHEMA'],
  ['forged-output', 'INVALID_SCHEMA'], ['crash', 'BOUNDARY_CRASH'], ['partial-output', 'INVALID_JSON'],
] as const) {
  test(`M3 application ${fixture} terminates or rejects with ${fixture === 'memory-flood' ? 'heap or execution guard' : expected}`, async () => {
    const engine = new ApplicationIsolationEngine(); const outcome = await engine.verifyFixture(fixture);
    if (fixture === 'memory-flood') assert.ok(['MEMORY_LIMIT', 'EXECUTION_TIMEOUT'].includes(outcome.code));
    else assert.equal(outcome.code, expected);
    assert.equal(outcome.result, undefined); assert.equal(outcome.receipt?.cleanupVerified, true);
    assert.ok((outcome.receipt?.terminationMilliseconds ?? Infinity) < APPLICATION_POLICY.terminationMilliseconds);
    assert.equal(engine.status.running, false); engine.dispose();
  });
}
test('M3 application validates synthetic transform and retains reference-only receipt', async () => {
  const engine = new ApplicationIsolationEngine(); const outcome = await engine.transform(input(), () => authority);
  assert.equal(outcome.code, 'OK'); assert.deepEqual(outcome.result, { schema: 1, count: 2, sum: 5 });
  assert.equal(outcome.receipt?.cleanupVerified, true); assert.equal(outcome.receipt?.modelProcessing, false);
  assert.ok(outcome.receipt?.runtimeHash.match(/^[a-f0-9]{64}$/));
  assert.ok(!JSON.stringify(outcome.receipt).includes('synthetic-app-1'));
  assert.ok(!JSON.stringify(outcome.receipt).includes('secret')); engine.dispose();
});
test('M3 application cannot accept code, unknown fixture or caller budgets', async () => {
  const engine = new ApplicationIsolationEngine();
  assert.equal((await engine.verifyFixture('execute-arbitrary-source' as ApplicationFixture)).code, 'UNKNOWN_OPERATION');
  const bad = new TextEncoder().encode('{"code":"process.env","budget":9999999}');
  assert.equal((await engine.transform(bad, () => authority)).code, 'INVALID_SCHEMA');
  assert.equal(engine.status.running, false); engine.dispose();
});
test('M3 application rechecks rights and source binding after worker teardown', async () => {
  const engine = new ApplicationIsolationEngine(); let calls = 0;
  const revoked = await engine.transform(input(), () => ++calls > 2 ? { ...authority, grants: [] } : authority);
  assert.equal(revoked.code, 'FIELD_PERMISSION_DENIED'); assert.equal(revoked.result, undefined); assert.equal(revoked.receipt?.cleanupVerified, true);
  calls = 0;
  const changed = await engine.transform(input(), () => ++calls > 2 ? { ...authority, records: [{ ...rows[0], value: 999 }, rows[1]] } : authority);
  assert.equal(changed.code, 'SOURCE_BINDING_MISMATCH'); assert.equal(changed.result, undefined); engine.dispose();
});
test('M3 application stale parent cannot activate a completed result', async () => {
  const engine = new ApplicationIsolationEngine(); let calls = 0;
  const outcome = await engine.transform(input(), () => ++calls > 2 ? { ...authority, parentRevision: 'revision-app-2' } : authority);
  assert.equal(outcome.code, 'STALE_AUTHORITY'); assert.equal(outcome.result, undefined); engine.dispose();
});
test('M3 application A-B-A latest input wins with one pending job', async () => {
  const engine = new ApplicationIsolationEngine();
  const a = engine.verifyFixture('infinite-loop'); await delay(20);
  const b = engine.verifyFixture('network'); const latestA = engine.transform(input(), () => authority);
  assert.ok(engine.status.queued <= 1);
  const outcomes = await Promise.all([a, b, latestA]);
  assert.equal(outcomes[0].code, 'SUPERSEDED'); assert.equal(outcomes[1].code, 'SUPERSEDED');
  assert.equal(outcomes[2].code, 'OK'); assert.equal(outcomes[2].result?.sum, 5);
  assert.equal(engine.status.running, false); assert.equal(engine.status.queued, 0); engine.dispose();
});
test('M3 application executes/cancels/disposes 20 times without residual worker capability', async () => {
  for (let i = 0; i < 20; i++) {
    const engine = new ApplicationIsolationEngine(); const job = engine.verifyFixture('infinite-loop'); await delay(5); engine.cancel();
    const cancelled = await job; assert.equal(cancelled.code, 'SUPERSEDED');
    if (cancelled.receipt) assert.equal(cancelled.receipt.cleanupVerified, true);
    const next = await engine.transform(input(), () => authority); assert.equal(next.code, 'OK'); assert.equal(next.receipt?.cleanupVerified, true);
    assert.equal(engine.status.queued, 0); assert.equal(engine.status.running, false); engine.dispose();
    assert.equal((await engine.verifyFixture('environment')).code, 'ISOLATION_UNAVAILABLE');
  }
});
