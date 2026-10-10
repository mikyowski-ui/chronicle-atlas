import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { adaptAlphaManifest } from '../src/alpha.ts';
import { CATALOG_LIMITS, fetchGlobalCatalog, GlobalCatalogStore, resolveGlobalObservation, validateGlobalCatalog } from '../src/global-catalog.ts';
import type { DisplayTrack } from '../src/display-policy.ts';

const origin = 'https://example.test/global-history/catalog.json';
const rawBytes = await readFile(new URL('../public/global-history/catalog.json', import.meta.url));
const raw = () => JSON.parse(rawBytes.toString('utf8'));
const catalog = () => validateGlobalCatalog(raw(), origin);
const signal = () => new AbortController().signal;
const localBytes = (url: string) => readFile(new URL('../public' + new URL(url).pathname, import.meta.url));
const localFetcher: typeof fetch = async input => new Response(await localBytes(String(input)));
const load = (track: DisplayTrack, abortSignal = signal()) => {
  const adapted = adaptAlphaManifest(track.manifest);
  return track.loader(adapted.epochs[0], adapted, abortSignal);
};
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

test('real root catalog accounts for all forty primary observations and bounded optional earlier dates', () => {
  const c = catalog();
  const primary = [-200, -100, -1, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1279, 1300, 1400, 1492, 1500, 1530, 1600, 1650, 1700, 1715, 1783, 1800, 1815, 1878, 1880, 1900, 1914, 1920, 1930, 1938, 1945, 1960, 1994, 2000, 2010];
  const optional = [-3000, -2000, -1500, -1000, -700, -500, -400, -323, -300];
  assert.deepEqual(c.observations.filter(o => o.year >= -200).map(o => o.year), primary);
  assert.ok(c.observations.filter(o => o.year < -200).every(o => optional.includes(o.year)));
  assert.ok(c.observations.length >= 40 && c.observations.length <= 49);
  assert.equal(c.observations.at(-1)!.year, 2010);
  assert.ok(rawBytes.length <= CATALOG_LIMITS.bytes);
  assert.equal(c.publication, 'staged-candidate-only');
  assert.equal(c.failures.length, 0);
  for (const observation of c.observations) {
    assert.equal(new URL(observation.manifest).origin, new URL(origin).origin);
    const coverage = observation.coverage;
    assert.equal(coverage.political + coverage.cultural + coverage.context + coverage.review + coverage.quarantine + coverage.excluded, coverage.source_features);
    assert.ok(observation.manifest_bytes <= CATALOG_LIMITS.manifestBytes);
  }
  const reversed = raw(); reversed.observations.reverse();
  assert.deepEqual(validateGlobalCatalog(reversed, origin).observations, c.observations);
  assert.ok(Object.isFrozen(c) && Object.isFrozen(c.observations) && Object.isFrozen(c.observations[0].coverage));
});

test('catalog rejects excess observations, failed accounting, duplicate identity and overlapping dates', () => {
  const oversized = raw(); oversized.observations = Array(65).fill(oversized.observations[0]);
  assert.throws(() => validateGlobalCatalog(oversized, origin), /bounded global catalog/);
  const accounting = raw(); accounting.observations[0].coverage.review++;
  assert.throws(() => validateGlobalCatalog(accounting, origin), /exactly one outcome/);
  const negative = raw(); negative.observations[0].coverage.context = -1;
  assert.throws(() => validateGlobalCatalog(negative, origin), /accounting/);
  const duplicate = raw(); duplicate.observations[1].observation_id = duplicate.observations[0].observation_id;
  assert.throws(() => validateGlobalCatalog(duplicate, origin), /descriptor/);
  const overlap = raw(); overlap.observations.push({ ...overlap.observations[0], observation_id: 'same-year-different-id' });
  assert.throws(() => validateGlobalCatalog(overlap, origin), /overlap/);
});

test('BCE source years have no year zero and exact observations never become reference validity', () => {
  const c = catalog(), bce = c.observations.find(o => o.year === -1)!;
  assert.equal(new Date(bce.t_start * 86400000).getUTCFullYear(), 0, 'Astronomical zero represents historical 1 BCE, not a displayed year zero.');
  const zero = raw(); zero.observations[0].year = 0;
  assert.throws(() => validateGlobalCatalog(zero, origin), /descriptor/);
  const relabelled = raw(); relabelled.observations[0].year = -201;
  assert.throws(() => validateGlobalCatalog(relabelled, origin), /canonical observation interval/);
  for (const o of c.observations) {
    assert.equal(resolveGlobalObservation(c, o.t_start, 'exact')?.observation_id, o.observation_id);
    assert.equal(resolveGlobalObservation(c, o.t_end - 1, 'exact')?.observation_id, o.observation_id);
    assert.equal(resolveGlobalObservation(c, o.t_end, 'exact'), undefined);
    assert.equal(resolveGlobalObservation(c, o.t_end, 'reference')?.observation_id, o.observation_id);
  }
  assert.equal(resolveGlobalObservation(c, c.observations[0].t_start - 1, 'reference'), undefined);
  assert.equal(resolveGlobalObservation(c, c.observations.at(-1)!.t_end + 3650, 'reference')?.year, 2010);
  assert.throws(() => resolveGlobalObservation(c, bce.t_start + .5, 'reference'), /integer day/);
});

test('catalog URLs reject cross-origin, credentials and non-HTTP schemes', () => {
  for (const url of ['https://other.test/manifest.json', 'https://user:secret@example.test/manifest.json', 'data:application/json,{}', 'file:///manifest.json']) {
    const changed = raw(); changed.observations[0].manifest = url;
    assert.throws(() => validateGlobalCatalog(changed, origin), /same origin/);
  }
});

test('root fetch enforces its 96 KiB budget on streamed bytes as well as declared length', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(rawBytes));
  assert.equal((await fetchGlobalCatalog(origin, signal())).observations.length, raw().observations.length);
  t.mock.method(globalThis, 'fetch', async () => new Response(rawBytes, { headers: { 'content-length': String(CATALOG_LIMITS.bytes + 1) } }));
  await assert.rejects(fetchGlobalCatalog(origin, signal()), /resource budget/);
  t.mock.method(globalThis, 'fetch', async () => new Response(rawBytes.toString('utf8') + ' '.repeat(CATALOG_LIMITS.bytes)));
  await assert.rejects(fetchGlobalCatalog(origin, signal()), /resource budget/);
});

test('manifests hydrate lazily and the four-entry cache uses recent access for eviction', async () => {
  const c = catalog(), requests: string[] = [];
  const store = new GlobalCatalogStore(c, false, undefined, async (input, init) => { requests.push(String(input)); return localFetcher(input, init); });
  assert.equal(requests.length, 0);
  assert.equal(store.diagnostics().manifestEntries, 0);
  for (const i of [0, 1, 2, 3, 0, 4]) await store.track(c.observations[i], signal());
  assert.equal(requests.length, 5);
  assert.equal(store.diagnostics().manifestEntries, CATALOG_LIMITS.manifests);
  assert.ok(store.peek(c.observations[0]));
  assert.equal(store.peek(c.observations[1]), undefined);
  assert.ok(requests.every(url => url.endsWith('/manifest.json')));
  await store.track(c.observations[1], signal());
  assert.equal(requests.length, 6);
  assert.equal(store.peek(c.observations[2]), undefined);
  assert.equal(store.diagnostics().sceneEntries, 0, 'Indexing manifests must not eagerly decode scene payloads.');
  store.dispose();
});

test('all shard loaders share two scene slots across dates and retain no full native archive', async () => {
  const c = catalog(), requests: string[] = [];
  const store = new GlobalCatalogStore(c, false, undefined, async (input, init) => { requests.push(String(input)); return localFetcher(input, init); });
  const tracks = await Promise.all([0, 20, 39].map(i => store.track(c.observations[i], signal())));
  const first = await load(tracks[0]);
  await load(tracks[1]);
  assert.strictEqual(await load(tracks[0]), first);
  await load(tracks[2]);
  assert.equal(store.diagnostics().sceneEntries, CATALOG_LIMITS.scenes);
  const beforeReload = requests.length;
  await load(tracks[1]);
  assert.equal(requests.length, beforeReload + 1, 'The least recently used different-date scene must reload its metadata.');
  assert.equal(store.diagnostics().sceneEntries, 2);
  assert.ok(requests.every(url => url.endsWith('/manifest.json') || url.endsWith('/metadata.json')));
  assert.equal(first.territories.length, 0);
  assert.ok(first.parts!.length > 0);
  store.dispose();
});

test('a manifest hash or length mismatch cannot enter the cache and is retryable', async () => {
  const c = catalog(), observation = c.observations[0];
  const bytes = await localBytes(observation.manifest), corrupt = Buffer.from(bytes); corrupt[100] ^= 1;
  let mode: 'corrupt' | 'short' | 'valid' = 'corrupt';
  const store = new GlobalCatalogStore(c, false, undefined, async () => new Response(mode === 'corrupt' ? corrupt : mode === 'short' ? bytes.subarray(0, bytes.length - 1) : bytes));
  await assert.rejects(store.track(observation, signal()), /identity mismatch/);
  mode = 'short'; await assert.rejects(store.track(observation, signal()), /identity mismatch/);
  assert.equal(store.diagnostics().manifestEntries, 0);
  mode = 'valid'; await store.track(observation, signal());
  assert.equal(store.diagnostics().manifestEntries, 1);
  assert.equal(store.diagnostics().manifestFetches, 1);
  store.dispose();
});

test('even a correctly hashed shard must match the selected source date and edition', async () => {
  const c = catalog(), original = c.observations[0], bytes = await localBytes(original.manifest);
  const parsed = JSON.parse(bytes.toString('utf8')); parsed.edition += '-different';
  const changed = Buffer.from(JSON.stringify(parsed));
  const observation = { ...original, manifest_sha256: digest(changed), manifest_bytes: changed.length };
  const store = new GlobalCatalogStore(c, false, undefined, async () => new Response(changed));
  await assert.rejects(store.track(observation, signal()), /selected observation/);
  assert.equal(store.diagnostics().manifestEntries, 0);
  store.dispose();
});

test('aborted manifest delivery completing late cannot cache or replace the newer observation', async () => {
  const c = catalog(), old = new AbortController();
  let resume!: () => void;
  const gate = new Promise<void>(resolve => { resume = resolve; });
  const store = new GlobalCatalogStore(c, false, undefined, async (input, init) => {
    if (String(input) === c.observations[0].manifest) await gate;
    return localFetcher(input, init);
  });
  const stale = store.track(c.observations[0], old.signal);
  const rejected = assert.rejects(stale, { name: 'AbortError' });
  old.abort();
  const latest = await store.track(c.observations[39], signal());
  resume(); await rejected;
  assert.equal(store.peek(c.observations[0]), undefined);
  assert.strictEqual(store.peek(c.observations[39]), latest);
  assert.equal(store.diagnostics().manifestEntries, 1);
  const cachedAbort = new AbortController(); cachedAbort.abort();
  await assert.rejects(store.track(c.observations[39], cachedAbort.signal), { name: 'AbortError' });
  store.dispose();
});

test('aborted scene hydration does not consume a shared payload slot or poison a warm scene', async () => {
  const c = catalog(); let delayed = false, resume!: () => void;
  const gate = new Promise<void>(resolve => { resume = resolve; });
  const store = new GlobalCatalogStore(c, false, undefined, async (input, init) => {
    if (delayed && !String(input).endsWith('/manifest.json')) await gate;
    return localFetcher(input, init);
  });
  const first = await store.track(c.observations[0], signal()), second = await store.track(c.observations[1], signal());
  const warm = await load(first);
  delayed = true;
  const controller = new AbortController(), pending = load(second, controller.signal);
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  controller.abort(); resume(); await rejected;
  assert.equal(store.diagnostics().sceneEntries, 1);
  assert.strictEqual(await load(first), warm);
  store.dispose();
});

test('neighbor manifests are bounded to previous and next observations and never fetch their scenes', async () => {
  const c = catalog(), requests: string[] = [];
  const store = new GlobalCatalogStore(c, false, undefined, async (input, init) => { requests.push(String(input)); return localFetcher(input, init); });
  const neighbors = await store.neighbors(c.observations[20]);
  assert.deepEqual(neighbors.map(track => track.manifest.edition), [c.observations[19].edition, c.observations[21].edition]);
  assert.equal(requests.length, 2);
  assert.equal(store.diagnostics().sceneEntries, 0);
  assert.ok(requests.every(url => url.endsWith('/manifest.json')));
  store.dispose();
});

test('reversing neighbor prefetch waits for slow aborted transports and skips superseded queued batches', { timeout: 5000 }, async () => {
  const c = catalog();
  const pending: { url: string; resume: () => void }[] = [];
  let active = 0, peak = 0, notifySecondBatch!: () => void;
  const secondBatchStarted = new Promise<void>(resolve => { notifySecondBatch = resolve; });
  const store = new GlobalCatalogStore(c, false, undefined, async (input, init) => {
    active++; peak = Math.max(peak, active);
    await new Promise<void>(resolve => {
      pending.push({ url: String(input), resume: resolve });
      if (pending.length === 4) notifySecondBatch();
    });
    try { return await localFetcher(input, init); }
    finally { active--; }
  });
  const forward = store.neighbors(c.observations[10]);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(pending.length, 2);
  const superseded = store.neighbors(c.observations[20]);
  const reverse = store.neighbors(c.observations[30]);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(pending.length, 2, 'New speculative requests must wait for both canceled transports to settle.');
  pending[0].resume(); pending[1].resume();
  assert.deepEqual(await forward, []);
  assert.deepEqual(await superseded, []);
  await secondBatchStarted;
  assert.deepEqual(pending.slice(2).map(p => p.url), [c.observations[29].manifest, c.observations[31].manifest]);
  pending[2].resume(); pending[3].resume();
  assert.equal((await reverse).length, 2);
  assert.equal(peak, CATALOG_LIMITS.neighborConcurrency);
  assert.equal(store.diagnostics().manifestEntries, 2);
  for (const index of [9, 11, 19, 21]) assert.equal(store.peek(c.observations[index]), undefined);
  store.dispose();
});
