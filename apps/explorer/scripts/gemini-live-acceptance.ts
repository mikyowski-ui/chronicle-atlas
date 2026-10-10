import { mkdir, open, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import { createHash } from 'node:crypto';
import { release } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGeminiProviderConnection, GEMINI_DEFAULT_MODEL, GEMINI_DESTINATION, isGeminiCredentialValue, type GeminiProviderConnection } from '../research-semantic/gemini-provider.ts';
import { PlannerBoundary } from '../research-semantic/planner.ts';
import { PROVIDER_PROCESSING_POLICY, ProviderTransportError } from '../research-semantic/provider-transport.ts';
import { QueryPlanSchema } from '../research-semantic/contracts.ts';
import { WorkspaceSpecificationSchema } from '../research-semantic/workspace-contract.ts';
import { canonicalJSON } from '../src/research/engine.ts';
import { geminiFixture } from '../tests/gemini-fixtures.ts';

const outIndex = process.argv.indexOf('--out');
const out = outIndex < 0 ? fileURLToPath(new URL('../verification/m3/native/gemini/', import.meta.url)) : resolve(process.argv[outIndex + 1]);
const optedIn = process.argv.includes('--live');
const extendedSmoke = process.argv.includes('--extended-smoke'), timeoutMs = extendedSmoke ? 30000 : 10000;
const acceptanceProfile = extendedSmoke ? 'synthetic-live-30s-v1' : 'synthetic-live-10s-v1';
const modelId = process.env.GEMINI_MODEL ?? GEMINI_DEFAULT_MODEL;
const fixture = geminiFixture();
const adapters: GeminiProviderConnection[] = [];
const checks: { name: string; status: string; code?: string; httpStatus?: number | null; upstreamReason?: string | null; fieldViolations?: readonly string[]; outputHash?: string }[] = [];
const report = {
  schemaVersion: 1, status: 'NOT RUN', reason: 'OPT_IN_REQUIRED', startedAt: new Date().toISOString(),
  environment: { platform: process.platform, architecture: process.arch, kernel: release(), node: process.version },
  model: /^gemini-[a-z0-9][a-z0-9.-]{0,79}$/.test(modelId) ? modelId : null,
  optedIn, dataClass: 'synthetic-fixture', historicalModelProcessing: PROVIDER_PROCESSING_POLICY.modelProcessing,
  credentialSetup: { key: 'GEMINI_API_KEY', source: 'process-environment', encoding: 'not-read', sourceEnvCreated: false },
  acceptanceProfile, budgets: { maximumRequests: 2, aggregateReservedTokenCeiling: 40448, timeoutMsPerRequest: timeoutMs, repairs: 0, toolCalls: 0 },
  checks, requests: 0, reportedUsage: { inputTokens: 0, outputTokens: 0, thoughtTokens: 0, totalTokens: 0 },
  unrefundedFailedAttempts: 0, accountingTokensCharged: 0,
  tokenAccounting: 'Provider-reported usage is separate from conservative byte-based reservation charges. Missing usage for an attempted request is unknown, not proof of zero billing. Cancellation does not prove server-side generation stopped.',
  disclosure: 'No credentials, prompts, source records, raw model output or provider error bodies are recorded. Historical permissions are never mutated.',
};
class CredentialSetupError extends Error {
  constructor(readonly code: 'CREDENTIAL_SOURCE_REQUIRED' | 'CREDENTIAL_FILE_INVALID' | 'CREDENTIAL_ENTRY_MISSING' | 'CREDENTIAL_VALUE_INVALID' | 'CREDENTIAL_VALUE_LENGTH_INVALID' | 'CREDENTIAL_VALUE_HAS_ASSIGNMENT' | 'CREDENTIAL_VALUE_HAS_WHITESPACE' | 'CREDENTIAL_VALUE_HAS_WRAPPING' | 'CREDENTIAL_VALUE_HAS_NON_ASCII' | 'ENV_TARGET_NOT_IGNORED' | 'ENV_TARGET_EXISTS' | 'ENV_WRITE_FAILED') { super(code); }
}
async function credentialEnvironment(): Promise<Readonly<Record<string, string>> | undefined> {
  const sourceRoot = fileURLToPath(new URL('../../../', import.meta.url)), target = join(sourceRoot, '.env');
  const index = process.argv.indexOf('--from-dotenv'), save = process.argv.includes('--save-source-env');
  if (index >= 0 && (!process.argv[index + 1] || process.argv[index + 1].startsWith('--')) || save && index < 0) throw new CredentialSetupError('CREDENTIAL_SOURCE_REQUIRED');
  const source = index >= 0 ? resolve(process.argv[index + 1]) : optedIn && !process.env.GEMINI_API_KEY && !process.env.GEMINI_API_KEY_FILE && existsSync(target) ? target : null;
  if (!source) return undefined;
  report.credentialSetup.source = source === target ? 'source-root-dotenv' : 'explicit-dotenv-file';
  let key: string;
  try {
    const handle = await open(source, 'r'), bytes = Buffer.alloc(16385);
    try {
      if (!(await handle.stat()).isFile()) throw new CredentialSetupError('CREDENTIAL_FILE_INVALID');
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
      if (bytesRead > 16384) throw new CredentialSetupError('CREDENTIAL_FILE_INVALID');
      const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
      report.credentialSetup.encoding = encoding;
      const parsed = parseEnv(new TextDecoder(encoding, { fatal: true }).decode(bytes.subarray(0, bytesRead)).replace(/^\uFEFF/, ''));
      const value = parsed.GEMINI_API_KEY;
      if (typeof value !== 'string') throw new CredentialSetupError('CREDENTIAL_ENTRY_MISSING');
      key = value.trim();
      if (key.length < 8 || key.length > 4096) throw new CredentialSetupError('CREDENTIAL_VALUE_LENGTH_INVALID');
      if (key.startsWith('GEMINI_API_KEY=')) throw new CredentialSetupError('CREDENTIAL_VALUE_HAS_ASSIGNMENT');
      if (/\s/.test(key)) throw new CredentialSetupError('CREDENTIAL_VALUE_HAS_WHITESPACE');
      if (/["'<>\[\]{}]/.test(key)) throw new CredentialSetupError('CREDENTIAL_VALUE_HAS_WRAPPING');
      if (/[^\x20-\x7e]/.test(key)) throw new CredentialSetupError('CREDENTIAL_VALUE_HAS_NON_ASCII');
      if (!isGeminiCredentialValue(key)) throw new CredentialSetupError('CREDENTIAL_VALUE_INVALID');
    } finally { bytes.fill(0); await handle.close(); }
  } catch (error) { throw error instanceof CredentialSetupError ? error : new CredentialSetupError('CREDENTIAL_FILE_INVALID'); }
  if (save) {
    try { execFileSync('git', ['check-ignore', '--quiet', '--', target], { cwd: sourceRoot, stdio: 'ignore' }); }
    catch { throw new CredentialSetupError('ENV_TARGET_NOT_IGNORED'); }
    try { await writeFile(target, `GEMINI_API_KEY=${key}\n`, { flag: 'wx', mode: 0o600 }); }
    catch (error) { throw new CredentialSetupError((error as NodeJS.ErrnoException).code === 'EEXIST' ? 'ENV_TARGET_EXISTS' : 'ENV_WRITE_FAILED'); }
    report.credentialSetup.sourceEnvCreated = true;
  }
  return Object.freeze({ GEMINI_API_KEY: key });
}
try {
  const environment = await credentialEnvironment();
  if (optedIn && process.argv.includes('--probe-model')) {
    const key = environment?.GEMINI_API_KEY ?? process.env.GEMINI_API_KEY ?? '';
    if (!isGeminiCredentialValue(key) || report.model === null) throw new ProviderTransportError('PROVIDER_UNAVAILABLE');
    report.budgets.maximumRequests = 1; report.budgets.aggregateReservedTokenCeiling = 0;
    const signal = AbortSignal.timeout(10000); report.requests++;
    try {
      const response = await fetch(`${GEMINI_DESTINATION}/models/${modelId}`, { headers: { 'x-goog-api-key': key }, signal, redirect: 'error', credentials: 'omit', cache: 'no-store' });
      void response.body?.cancel().catch(() => {});
      checks.push({ name: 'model-metadata-availability-only', status: response.status === 200 ? 'PASS' : 'FAIL', httpStatus: response.status });
      report.status = response.status === 200 ? 'NOT RUN' : 'FAIL'; report.reason = 'MODEL_METADATA_ONLY_NO_INFERENCE';
    } catch { throw new ProviderTransportError(signal.aborted ? 'TIMEOUT' : 'PROVIDER_FAILURE'); }
  } else if (optedIn) {
    const configuration = { ...fixture.configuration, modelId, acceptanceProfile, budgets: { ...fixture.configuration.budgets, sessionTokens: 24192, timeoutMs } };
    const adapter = createGeminiProviderConnection({ configuration, consent: fixture.consent, validateSpecification: fixture.validateSpecification, environment });
    adapters.push(adapter);
    if (adapter.mode === 'unavailable') {
      report.status = 'BLOCKED'; report.reason = adapter.status.reason;
      checks.push({ name: 'credential-configuration-and-consent', status: 'BLOCKED', code: adapter.status.code });
    } else {
      const request = fixture.request();
      const result = await new PlannerBoundary(adapter, fixture.validateSpecification).propose(request.question, request.context, {
        allowLiveSynthetic: true, budgets: { tokens: 24192, outputBytes: 16384, timeoutMs, repairs: 0, toolCalls: 0 },
      });
      if (result.status !== 'proposed') {
        report.status = 'FAIL'; report.reason = result.status === 'error' ? result.code : 'UNEXPECTED_UNSUPPORTED';
        checks.push({ name: 'live-inference-and-schema-conformance', status: 'FAIL', code: report.reason, httpStatus: adapter.diagnostics().lastHTTPStatus, upstreamReason: adapter.diagnostics().lastFailureReason, fieldViolations: adapter.diagnostics().lastFieldViolations });
      } else {
        QueryPlanSchema.parse(result.specification.plan); WorkspaceSpecificationSchema.parse(result.specification); fixture.validateSpecification(result.specification);
        checks.push({ name: 'live-inference-and-schema-conformance', status: 'PASS', httpStatus: adapter.diagnostics().lastHTTPStatus,
          outputHash: createHash('sha256').update(canonicalJSON(result.specification)).digest('hex') });
        const cancelled = new AbortController(); cancelled.abort();
        for (const [name, signal, expected] of [
          ['session-budget-exhaustion-no-extra-request', request.signal, 'PROVIDER_UNAVAILABLE'],
          ['pre-cancelled-request-no-network', cancelled.signal, 'CANCELLED'],
        ] as const) {
          const before = adapter.diagnostics().exchanges; let code: string | undefined;
          try { await adapter.propose({ ...request, signal }); }
          catch (error) { code = error instanceof ProviderTransportError ? error.code : 'PROVIDER_FAILURE'; }
          checks.push({ name, status: code === expected && adapter.diagnostics().exchanges === before ? 'PASS' : 'FAIL', code: code ?? 'UNEXPECTED_SUCCESS' });
        }
        const negativeConfiguration = { ...configuration, modelId: 'gemini-chronicle-unavailable-test', budgets: { ...configuration.budgets, outputTokens: 256, sessionTokens: 16256 } };
        const negative = createGeminiProviderConnection({ configuration: negativeConfiguration, consent: fixture.consent, validateSpecification: fixture.validateSpecification, environment });
        adapters.push(negative);
        let errorCode: string | undefined;
        try { await negative.propose({ ...request, remainingTokens: 16256 }); }
        catch (error) { errorCode = error instanceof ProviderTransportError ? error.code : 'PROVIDER_FAILURE'; }
        const passed = negative.diagnostics().exchanges === 1 && negative.diagnostics().lastHTTPStatus === 404 && errorCode === 'PROVIDER_UNAVAILABLE';
        checks.push({ name: 'live-unavailable-model-error-redaction', status: passed ? 'PASS' : 'FAIL', code: errorCode ?? 'UNEXPECTED_SUCCESS', httpStatus: negative.diagnostics().lastHTTPStatus });
        const allPassed = passed && checks.every(check => check.status === 'PASS');
        report.status = allPassed ? 'PASS' : 'FAIL'; report.reason = allPassed ? 'SYNTHETIC_LIVE_CHECKS_COMPLETED' : 'LIVE_GUARD_OR_ERROR_CHECK_FAILED';
      }
    }
  }
} catch (error) {
  report.status = error instanceof CredentialSetupError ? 'BLOCKED' : 'FAIL';
  report.reason = error instanceof CredentialSetupError || error instanceof ProviderTransportError ? error.code : 'INVALID_OUTPUT';
} finally {
  for (const adapter of adapters) {
    const diagnostics = adapter.diagnostics(); report.requests += diagnostics.exchanges;
    report.unrefundedFailedAttempts += diagnostics.uncertainAttempts;
    for (const key of ['inputTokens', 'outputTokens', 'thoughtTokens', 'totalTokens'] as const) report.reportedUsage[key] += diagnostics.reportedUsage[key];
    adapter.dispose();
  }
  report.accountingTokensCharged = adapters.reduce((total, adapter, index) => total + (adapter.mode === 'unavailable' ? 0 : (index === 0 ? 24192 : 16256) - adapter.diagnostics().remainingSessionTokens), 0);
  const defaultsIntact = PROVIDER_PROCESSING_POLICY.modelProcessing === false && fixture.registration.fixture.sourcePins.every(pin => pin.modelProcessing === false);
  checks.push({ name: 'historical-processing-defaults-unchanged', status: defaultsIntact ? 'PASS' : 'FAIL' });
  if (!defaultsIntact) { report.status = 'FAIL'; report.reason = 'POLICY_INVARIANT_FAILED'; }
  await mkdir(out, { recursive: true });
  await writeFile(join(out, 'acceptance.json'), JSON.stringify({ ...report, finishedAt: new Date().toISOString() }, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, reason: report.reason, credentialSetup: report.credentialSetup, requests: report.requests, reportedUsage: report.reportedUsage, checks, receipt: join(out, 'acceptance.json') }, null, 2));
  process.exitCode = report.status === 'PASS' || report.status === 'NOT RUN' ? 0 : report.status === 'BLOCKED' ? 2 : 1;
}
