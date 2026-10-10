/** Offline acceptance harness; does not activate production or load generated code. */
import { createServer } from 'node:net';
import { createSocket } from 'node:dgram';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir, release } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IsolationEngine, type Outcome } from './engine.ts';
import { FIXTURES, POLICY, sha256, type Authority, type StagedRow } from './contract.ts';

const directory = fileURLToPath(new URL('../verification/m3/runtime/', import.meta.url));
const outIndex = process.argv.indexOf('--out');
const out = outIndex < 0 ? fileURLToPath(new URL('../verification/m3/native/runtime/', import.meta.url)) : resolve(process.argv[outIndex + 1]);
await mkdir(out, { recursive: true });
const supportedHost = process.platform === 'linux' && process.arch === 'x64';
const engine = new IsolationEngine(directory);
let tcpConnections = 0; let udpPackets = 0;
const tcp = createServer(socket => { tcpConnections++; socket.destroy(); });
const udp = createSocket('udp4');
udp.on('message', () => { udpPackets++; });
await new Promise<void>((resolve, reject) => { tcp.once('error', reject); tcp.listen(0, '127.0.0.1', resolve); });
await new Promise<void>((resolve, reject) => { udp.once('error', reject); udp.bind(0, '127.0.0.1', resolve); });
const canaryDirectory = await mkdtemp(join(tmpdir(), 'chronicle-canary-'));
const canaryPath = join(canaryDirectory, 'secret');
const canaryText = 'SYNTHETIC_ISOLATION_CANARY_ONLY';
await writeFile(canaryPath, canaryText, { mode: 0o600 });
const beforeDirectories = (await readdir(tmpdir())).filter(name => name.startsWith('chronicle-isolation-')).sort();
const previousCanary = process.env.CHRONICLE_CANARY;
process.env.CHRONICLE_CANARY = canaryText;
const results: { fixture: string; status: string; outcome: Outcome }[] = [];
try {
  const expected = new Map<string, readonly string[]>([
    ['network', ['OK']], ['filesystem', ['OK']], ['descriptors', ['OK']], ['processes', ['OK']], ['memory', ['OK']], ['environment', ['OK']],
    ['infinite-loop', ['CPU_LIMIT', 'WALL_LIMIT']], ['output-flood', ['OUTPUT_LIMIT']], ['diagnostic-flood', ['DIAGNOSTIC_LIMIT']],
    ['malformed-output', ['DUPLICATE_KEY']], ['markup-output', ['INVALID_SCHEMA']], ['forged-output', ['INVALID_SCHEMA']], ['crash', ['BOUNDARY_CRASH']], ['partial-output', ['INVALID_JSON']],
  ]);
  for (const fixture of FIXTURES) {
    const outcome = await engine.verifyFixture(fixture);
    results.push({ fixture, status: outcome.code === 'ISOLATION_UNAVAILABLE' ? 'BLOCKED' : expected.get(fixture)?.includes(outcome.code) ? 'PASS' : 'FAIL', outcome });
  }
  const sourceHash = sha256('synthetic-acceptance-source'); const policyHash = sha256('synthetic-acceptance-policy');
  const rows: readonly StagedRow[] = [{ id: 'synthetic-acceptance-1', entityId: 'entity-1', sourceHash, value: 2, unit: 'count' }, { id: 'synthetic-acceptance-2', entityId: 'entity-1', sourceHash, value: 3, unit: 'count' }];
  const authority: Authority = { dataClass: 'synthetic-isolation-fixture', parentRevision: 'synthetic-revision-1', policyHash, records: rows, grants: [{ sourceHash, field: 'value', localTransform: true, modelProcessing: false }] };
  const transformed = await engine.transform(new TextEncoder().encode(JSON.stringify({ schema: 1, operation: 'sum-v1', parentRevision: authority.parentRevision, policyHash, rows })), () => authority);
  results.push({ fixture: 'transform-and-independent-native-validator', status: transformed.code === 'ISOLATION_UNAVAILABLE' ? 'BLOCKED' : transformed.code === 'OK' && transformed.result?.sum === 5 && transformed.receipt?.nativeValidation === true ? 'PASS' : 'FAIL', outcome: transformed });
  const cycles: Outcome[] = [];
  for (let i = 0; i < 20; i++) cycles.push(await engine.verifyFixture('environment'));
  const afterDirectories = (await readdir(tmpdir())).filter(name => name.startsWith('chronicle-isolation-')).sort();
  const canaryUnchanged = sha256(await readFile(canaryPath)) === sha256(canaryText);
  const cleanup = cycles.every(value => value.receipt ? value.receipt.cleanupVerified : value.code === 'ISOLATION_UNAVAILABLE') && JSON.stringify(beforeDirectories) === JSON.stringify(afterDirectories) && !engine.status.running && engine.status.queued === 0;
  const status = results.some(result => result.status === 'FAIL') || !cleanup || !canaryUnchanged || tcpConnections || udpPackets ? 'FAIL' : results.some(result => result.status === 'BLOCKED') ? 'BLOCKED' : 'PASS';
  let build: unknown = null;
  if (supportedHost) { try { build = JSON.parse(await readFile(join(directory, 'build-receipt.json'), 'utf8')); } catch {} }
  const report = {
    schema: 1, status, generatedExecution: false, modelProcessing: false,
    environment: { platform: process.platform, architecture: process.arch, kernel: release(), node: process.version }, policy: POLICY,
    runtimeSupport: { supportedHost, required: 'linux-x64', reason: supportedHost ? null : 'UNSUPPORTED_PLATFORM', guestLaunched: results.some(result => result.outcome.receipt !== undefined) },
    build,
    canaryObservations: { tcpConnections, udpPackets, fileHashUnchanged: canaryUnchanged, note: 'Endpoint counters and canary hashes are outside observations. BLOCKED bootstrap means no guest probe ran; zero counters are not confinement proof. No packet capture was available.' },
    results, cycles, cleanup,
    threatModelMatrix: Array.from({ length: 15 }, (_, index) => ({ id: `M3-${String(index + 1).padStart(2, '0')}`, status: status === 'BLOCKED' ? 'BLOCKED' : 'NOT RUN', reason: status === 'BLOCKED' ? 'Native enforcing boundary unavailable; application and contract tests are not OS proof.' : 'Full independent adversarial evidence remains separate from fixed fixture outcomes.' })),
    limits: ['This harness never enables arbitrary generated execution or production activation.', 'Supported-host fixture PASS alone is not full M3 security certification: packet capture, all-platform review, and full threat-model matrix remain required.', 'Bootstrap failure blocks all downstream kernel enforcement and native validator acceptance.', 'Prelaunch rejection with no owned process is cleanup evidence only, not successful execution or memory enforcement.'],
  };
  await writeFile(join(out, 'acceptance.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status, report: join(out, 'acceptance.json'), runtimeSupport: report.runtimeSupport, fixtureResults: results.map(({ fixture, status }) => ({ fixture, status })), cleanup }));
  if (status !== 'PASS') process.exitCode = status === 'BLOCKED' ? 2 : 1;
} finally {
  engine.dispose();
  if (previousCanary === undefined) delete process.env.CHRONICLE_CANARY; else process.env.CHRONICLE_CANARY = previousCanary;
  await new Promise<void>(resolve => tcp.close(() => resolve())); udp.close();
  await rm(canaryDirectory, { recursive: true, force: true });
}
