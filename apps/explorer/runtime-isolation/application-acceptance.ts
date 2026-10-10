/** Revised user-authorized application-level acceptance; offline fixed fixtures only. */
import { mkdir, writeFile } from 'node:fs/promises';
import { release } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { ApplicationIsolationEngine, APPLICATION_FIXTURES, APPLICATION_POLICY, type ApplicationOutcome } from './application-engine.ts';
import { sha256, type Authority, type StagedRow } from './contract.ts';
const output = fileURLToPath(new URL('../verification/m3/runtime/application-acceptance.json', import.meta.url));
const engine = new ApplicationIsolationEngine();
const expected = new Map<string, string>([
  ['network', 'OK'], ['dom', 'OK'], ['environment', 'OK'], ['filesystem', 'OK'], ['processes', 'OK'],
  ['constructor-escape', 'OK'], ['prototype-pollution', 'OK'], ['unauthorized-call', 'OK'],
  ['infinite-loop', 'EXECUTION_TIMEOUT'], ['memory-flood', 'MEMORY_LIMIT'], ['output-flood', 'OUTPUT_LIMIT'],
  ['diagnostic-flood', 'DIAGNOSTIC_LIMIT'], ['malformed-output', 'DUPLICATE_KEY'], ['markup-output', 'INVALID_SCHEMA'],
  ['forged-output', 'INVALID_SCHEMA'], ['crash', 'BOUNDARY_CRASH'], ['partial-output', 'INVALID_JSON'],
]);
const results: { fixture: string; status: string; outcome: ApplicationOutcome }[] = [];
for (const fixture of APPLICATION_FIXTURES) {
  const outcome = await engine.verifyFixture(fixture);
  results.push({ fixture, status: outcome.code === expected.get(fixture) && outcome.receipt?.cleanupVerified && outcome.receipt.terminationMilliseconds < APPLICATION_POLICY.terminationMilliseconds ? 'PASS' : 'FAIL', outcome });
}
const sourceHash = sha256('synthetic-application-acceptance-source'); const policyHash = sha256('synthetic-application-acceptance-policy');
const rows: readonly StagedRow[] = [{ id: 'synthetic-acceptance-1', entityId: 'entity-1', sourceHash, value: 2, unit: 'count' }, { id: 'synthetic-acceptance-2', entityId: 'entity-1', sourceHash, value: 3, unit: 'count' }];
const authority: Authority = { dataClass: 'synthetic-isolation-fixture', parentRevision: 'synthetic-revision-1', policyHash, records: rows, grants: [{ sourceHash, field: 'value', localTransform: true, modelProcessing: false }] };
const input = new TextEncoder().encode(JSON.stringify({ schema: 1, operation: 'sum-v1', parentRevision: authority.parentRevision, policyHash, rows }));
const transformed = await engine.transform(input, () => authority);
results.push({ fixture: 'independently-validated-synthetic-transform', status: transformed.code === 'OK' && transformed.result?.sum === 5 && transformed.receipt?.cleanupVerified ? 'PASS' : 'FAIL', outcome: transformed });
let authorityCalls = 0;
const revoked = await engine.transform(input, () => ++authorityCalls > 2 ? { ...authority, grants: [] } : authority);
results.push({ fixture: 'permission-revocation-before-activation', status: revoked.code === 'FIELD_PERMISSION_DENIED' && revoked.result === undefined ? 'PASS' : 'FAIL', outcome: revoked });
const firstA = engine.verifyFixture('infinite-loop'); await delay(20);
const b = engine.verifyFixture('network'); const finalA = engine.transform(input, () => authority);
const sequence = await Promise.all([firstA, b, finalA]);
const latestWins = sequence[0].code === 'SUPERSEDED' && sequence[1].code === 'SUPERSEDED' && sequence[2].code === 'OK';
engine.dispose();
const cycles: { cancel: ApplicationOutcome; next: ApplicationOutcome; disposed: boolean }[] = [];
for (let i = 0; i < 20; i++) {
  const cycle = new ApplicationIsolationEngine(); const pending = cycle.verifyFixture('infinite-loop'); await delay(5); cycle.cancel();
  const cancel = await pending; const next = await cycle.transform(input, () => authority);
  cycle.dispose(); const disposed = (await cycle.verifyFixture('environment')).code === 'ISOLATION_UNAVAILABLE';
  cycles.push({ cancel, next, disposed });
}
const cleanup = cycles.every(cycle => cycle.cancel.code === 'SUPERSEDED' && (!cycle.cancel.receipt || cycle.cancel.receipt.cleanupVerified) && cycle.next.code === 'OK' && cycle.next.receipt?.cleanupVerified && cycle.disposed);
const receipts = [...results.map(item => item.outcome.receipt), ...sequence.map(item => item.receipt), ...cycles.flatMap(item => [item.cancel.receipt, item.next.receipt])].filter(receipt => receipt !== undefined);
const status = results.every(result => result.status === 'PASS') && latestWins && cleanup ? 'PASS' : 'FAIL';
const report = {
  schema: 1, status, acceptanceScope: 'User-approved fixed-fixture application capability and lifecycle profile; not kernel isolation or arbitrary generated code activation.',
  environment: { platform: process.platform, architecture: process.arch, kernel: release(), node: process.version }, policy: APPLICATION_POLICY,
  results, sequence, latestWins, cycles, cleanup,
  maxima: { wallMilliseconds: Math.max(...receipts.map(receipt => receipt.wallMilliseconds)), terminationMilliseconds: Math.max(...receipts.map(receipt => receipt.terminationMilliseconds)), outputBytes: Math.max(...receipts.map(receipt => receipt.outputBytes)), diagnosticBytes: Math.max(...receipts.map(receipt => receipt.diagnosticBytes)) },
  generatedExecution: false, liveServices: false, modelProcessing: false,
  limitations: ['node:vm is not a security mechanism for arbitrary hostile code; only reviewed fixed snippets are admitted.', 'Worker resourceLimits bound V8 heap/stack, not process RSS or arbitrary external allocations. Typed-array/ArrayBuffer/DataView globals are removed in the fixed VM profile.', 'No kernel network/filesystem denial or packet-capture certification is claimed. The stronger optional native profile remains unavailable when bootstrap controls fail.', 'The application parser bounds result bytes/depth/nodes; it does not claim an independent 64MiB native validator acceptance.'],
  references: ['https://nodejs.org/download/release/v24.19.0/docs/api/vm.html', 'https://nodejs.org/download/release/v24.19.0/docs/api/worker_threads.html'],
};
await mkdir(fileURLToPath(new URL('../verification/m3/runtime/', import.meta.url)), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status, output, fixtures: results.length, latestWins, cycles: cycles.length, cleanup, maxima: report.maxima }));
if (status !== 'PASS') process.exitCode = 1;
