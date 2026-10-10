import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PinnedRangeSource } from '../src/streaming-range.ts';

const app = fileURLToPath(new URL('../', import.meta.url)), root = fileURLToPath(new URL('../../../', import.meta.url));
const out = join(app, 'verification/m3/native/integrity');
const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
async function receipt(name: string, value: unknown) {
  await mkdir(out, { recursive: true });
  await writeFile(join(out, name), JSON.stringify(value, null, 2) + '\n');
}
async function filesBelow(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['node_modules', '.sites-runtime', '__pycache__'].includes(entry.name)) continue;
    assert.equal(entry.isSymbolicLink(), false, 'Build identity cannot follow source symlinks');
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(path));
    else if (entry.isFile()) files.push(path);
  }
  return files.sort();
}

test('native browser range delivery never uses a cache object as the fetch receiver', async () => {
  const bytes = Uint8Array.from({ length: 64 }, (_, index) => index), digest = sha256(bytes);
  const request: typeof fetch = async function (this: unknown, _input, options) {
    assert.equal(this === undefined, true, 'Browser fetch must be called as a function, not a PinnedRangeSource method');
    assert.equal(new Headers(options?.headers).get('range'), 'bytes=0-63');
    return new Response(bytes, { status: 206, headers: { 'Content-Range': 'bytes 0-63/64', 'Content-Length': '64' } });
  };
  const source = new PinnedRangeSource({ url: 'https://fixture.invalid/native-receiver.pmtiles', byte_length: 64, sha256: digest, integrity: { chunk_size: 16384, sha256: [digest] } }, request);
  try { assert.deepEqual(new Uint8Array((await source.getBytes(0, 8)).data), bytes.slice(0, 8)); }
  finally { source.dispose(); }
});

test('native continuation preserves every protected historical input and the main dependency policy', async () => {
  const protectedInputs = JSON.parse(await readFile(join(app, 'verification/research-workspace/protected-inputs.json'), 'utf8')) as { path: string; sha256: string }[];
  assert.equal(protectedInputs.length, 2282);
  for (const entry of protectedInputs) assert.equal(sha256(await readFile(join(root, entry.path))), entry.sha256, entry.path);
  await receipt('protected.json', { status: 'PASS', checked: protectedInputs.length, changed: [] });
});

test('native build matches actual source bytes and excludes the Node-only Gemini credential transport from browser assets', async () => {
  const paths = [];
  for (const directory of ['src', 'research-semantic', 'runtime-isolation', 'verification-tools', 'public']) paths.push(...await filesBelow(join(app, directory)));
  for (const name of ['contracts', 'runtime', 'planner', 'view-adapters']) { paths.push(...await filesBelow(join(root, 'packages', name, 'src'))); paths.push(join(root, 'packages', name, 'package.json')); }
  paths.push(...['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json'].map(name => join(root, name)));
  paths.push(...['index.html', 'production-review.html', 'vite.config.ts', 'package.json', 'pnpm-lock.yaml'].map(name => join(app, name)));
  const inputs = [];
  for (const path of paths.sort()) {
    const bytes = await readFile(path);
    inputs.push({ path: relative(root, path).replaceAll('\\', '/'), byte_length: bytes.length, sha256: sha256(bytes) });
  }
  const build = JSON.parse(await readFile(join(app, 'dist/build-info.json'), 'utf8'));
  const fingerprint = sha256(JSON.stringify(inputs));
  assert.equal(fingerprint, build.source_fingerprint); assert.equal(inputs.length, build.source_file_count);
  let browserAssets = 0;
  for (const name of await readdir(join(app, 'dist/assets'))) {
    if (!name.endsWith('.js')) continue;
    const source = await readFile(join(app, 'dist/assets', name), 'utf8');
    assert.equal(/generativelanguage\.googleapis\.com|GEMINI_API_KEY|x-goog-api-key|gemini-provider/.test(source), false, name);
    browserAssets++;
  }
  assert.ok(browserAssets > 0);
  await receipt('source-build-match.json', { status: 'PASS', sourceFileCount: inputs.length, sourceFingerprint: fingerprint, buildId: build.build_id, browserAssets, nodeCredentialTransportBundled: false });
});

test('native portability edits retain the exact original M2 test assertions without changing archived checksum policy', async () => {
  const original = JSON.parse(await readFile(join(app, 'verification/m3/accepted-m2-tests.json'), 'utf8')) as { acceptedBuildId: string; originalTestCount: number; files: { path: string; sha256: string }[] };
  const substitutions = new Map<string, readonly (readonly [string, string])[]>([
    ['apps/explorer/tests/global-semantics.test.ts', [[".read_text(encoding='utf-8')", '.read_text()']]],
    ['apps/explorer/tests/research-workspace.test.ts', [["import { fileURLToPath } from 'node:url';\n", ''], ['fileURLToPath(workbookPath)', 'workbookPath.pathname']]],
  ]);
  let unchanged = 0;
  const portabilityChanges = [];
  for (const entry of original.files) {
    const bytes = await readFile(join(root, entry.path));
    if (sha256(bytes) === entry.sha256) { unchanged++; continue; }
    const replacements = substitutions.get(entry.path);
    assert.ok(replacements, `Unexpected modification of retained test: ${entry.path}`);
    let originalForm = bytes.toString('utf8');
    for (const [portable, previous] of replacements) {
      assert.equal(originalForm.split(portable).length, 2, entry.path);
      originalForm = originalForm.replace(portable, previous);
    }
    assert.equal(sha256(originalForm), entry.sha256, `Original test assertions must remain byte-identical after reversing only path/encoding adapters: ${entry.path}`);
    portabilityChanges.push({ path: entry.path, originalSHA256: entry.sha256, nativeSHA256: sha256(bytes), assertionsChanged: false });
  }
  assert.equal(original.originalTestCount, 386); assert.equal(original.files.length, 49);
  await receipt('retained-tests.json', { status: 'PASS', acceptedBuildId: original.acceptedBuildId, retainedM2Tests: original.originalTestCount, originalTestFiles: original.files.length, byteIdenticalFiles: unchanged, portabilityChanges,
    interpretation: 'The archived byte-identity verifier and checksum manifest are unchanged. This separate native test proves only the two explicit path/encoding substitutions; it does not relabel changed files as byte-identical.' });
});
