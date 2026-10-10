import assert from 'node:assert/strict';
import { mkdir, open, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { EvidenceSourceRegistry, GroundedEvidencePlanner } from '@chronicle/planner/evidence';
import { WikidataHistoricalAdapter } from '@chronicle/planner/wikidata';
import { GeminiEvidenceLayout } from '@chronicle/planner/gemini-evidence';
import { PROVIDER_PROCESSING_POLICY } from '@chronicle/planner';
import { canonicalJSON, hashText } from '@chronicle/contracts/canonical';

const app = fileURLToPath(new URL('../', import.meta.url)), sourceRoot = resolve(app, '../..');
const args = process.argv.slice(2), outIndex = args.indexOf('--out'), out = outIndex >= 0 ? resolve(args[outIndex + 1]) : join(app, 'verification/m4/phase4-live');
const live = args.includes('--live'), modelOptIn = args.includes('--gemini-wikidata');
const report: Record<string, unknown> = { schemaVersion: 1, status: 'NOT RUN', startedAt: new Date().toISOString(), platform: process.platform, node: process.version, live, modelOptIn, query: 'Q84', historicalModelProcessing: PROVIDER_PROCESSING_POLICY.modelProcessing, importedFileModelProcessing: false, disclosure: 'Only explicitly authorized public Wikidata metadata can enter the Node-only provider. No keys, source text, prompts or raw provider errors are recorded.', checks: [] };
const checks = report.checks as Record<string, unknown>[];
let sourceRequests = 0, provider: GeminiEvidenceLayout | undefined;
const registry = new EvidenceSourceRegistry(), planner = new GroundedEvidencePlanner(registry);
registry.register(new WikidataHistoricalAdapter({ fetch: async (url, init) => { sourceRequests++; const response = await fetch(url, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), 'User-Agent': 'ChronicleResearchWorkspace/0.1 (local evidence acceptance)' } }); report.sourceHTTPStatus = response.status; const retry = response.headers.get('retry-after'); report.retryAfterSeconds = retry && /^\d{1,6}$/.test(retry) ? Number(retry) : null; return response; } }));
async function credentialEnvironment(): Promise<Readonly<Record<string, string | undefined>>> {
  if (process.env.GEMINI_API_KEY) return { GEMINI_API_KEY: process.env.GEMINI_API_KEY };
  const handle = await open(join(sourceRoot, '.env'), 'r'), bytes = Buffer.alloc(16385);
  try {
    if (!(await handle.stat()).isFile()) throw new Error('CREDENTIAL_FILE_INVALID');
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0); if (bytesRead > 16384) throw new Error('CREDENTIAL_FILE_INVALID');
    const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
    return { GEMINI_API_KEY: parseEnv(new TextDecoder(encoding, { fatal: true }).decode(bytes.subarray(0, bytesRead)).replace(/^\uFEFF/, '')).GEMINI_API_KEY };
  } finally { bytes.fill(0); await handle.close(); }
}
try {
  if (!live) report.reason = 'EXPLICIT_LIVE_OPT_IN_REQUIRED';
  else {
    if (modelOptIn) provider = new GeminiEvidenceLayout({ modelId: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash', allowWikidata: true, environment: await credentialEnvironment(), budgets: { inputTokens: 16000, outputTokens: 8192, sessionTokens: 24192, timeoutMs: 30000, outputBytes: 32768, maximumRequests: 1 } });
    const result = await planner.prepare({ question: 'Q84', sourceIds: ['wikidata'], bounds: null, temporalRange: null }, { allowRemote: true, allowWikidataModelProcessing: modelOptIn, layout: provider, timeoutMs: 45000 });
    assert.ok(result.bundle.records.length > 0); assert.ok(result.bundle.records.every(record => record.source.adapterId === 'wikidata' && record.modelProcessing === false && record.reviewStatus === 'unreviewed'));
    checks.push({ name: 'real-wikidata-retrieval-and-host-validation', status: 'PASS', records: result.bundle.records.length, geometryRecords: result.bundle.records.filter(record => record.geometry).length, temporalRecords: result.bundle.records.filter(record => record.time).length, recordIds: result.bundle.records.map(record => record.id), sourceHashes: [...new Set(result.bundle.records.map(record => record.source.contentHash))], resultHash: result.bundle.resultHash });
    if (provider) { assert.equal(result.planner, 'live'); assert.equal(provider.diagnostics().lastHTTPStatus, 200); checks.push({ name: 'wikidata-only-gemini-grounded-layout', status: 'PASS', specificationHash: hashText(canonicalJSON(result.specification)) }); }
    const requestsBefore = sourceRequests, modelBefore = provider?.diagnostics().requests ?? 0, archive = planner.export(result);
    assert.equal(planner.export(planner.reopen(archive)), archive); assert.equal(sourceRequests, requestsBefore); assert.equal(provider?.diagnostics().requests ?? 0, modelBefore);
    checks.push({ name: 'warm-pinned-reference-replay-without-network-or-model', status: 'PASS', sha256: hashText(archive) });
    assert.equal(PROVIDER_PROCESSING_POLICY.modelProcessing, false); report.status = 'PASS';
  }
} catch (error) {
  const code = error instanceof Error && /^[A-Z][A-Z0-9_]{2,70}$/.test(error.message) ? error.message : 'LIVE_ACCEPTANCE_FAILED';
  report.status = ['MISSING_CREDENTIAL', 'AUTHENTICATION_REQUIRED', 'WIKIDATA_UNAVAILABLE'].includes(code) ? 'BLOCKED' : 'FAIL'; report.reason = code; process.exitCode = 1;
} finally {
  report.sourceRequests = sourceRequests; report.provider = provider?.diagnostics() ?? null; report.finishedAt = new Date().toISOString();
  provider?.dispose(); planner.dispose(); await mkdir(out, { recursive: true }); await writeFile(join(out, 'acceptance.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
}
