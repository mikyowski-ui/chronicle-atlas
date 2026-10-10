import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PMTiles } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import { fromVectorTileJs } from '@maplibre/vt-pbf';
import Pbf from 'pbf';
import type { SceneSnapshot } from '../../../packages/contracts/src/index.ts';
import { createEpochLoader, decodeScene, TemporalController, validateManifest, type SceneData, type EpochLoader } from '../src/temporal.ts';

const manifestInput = JSON.parse(await readFile(new URL('../public/fixtures/manifest.json', import.meta.url), 'utf8'));
const manifest = validateManifest(manifestInput, 'https://fixture.invalid/fixtures/manifest.json');
const [epochA, epochB] = manifest.epochs;
const archiveA = new Uint8Array(await readFile(new URL('../public/fixtures/epoch-950.pmtiles', import.meta.url)));
const archiveB = new Uint8Array(await readFile(new URL('../public/fixtures/epoch-1050.pmtiles', import.meta.url)));
const responseFor = (epochId: string) => new Response(new Uint8Array(epochId === epochA.epoch_id ? archiveA : archiveB));
const localFetcher: typeof fetch = async input => responseFor(String(input).includes('epoch-950') ? epochA.epoch_id : epochB.epoch_id);
const fixtureLoader = createEpochLoader(localFetcher);
const sceneA = await fixtureLoader(epochA, manifest, new AbortController().signal);
const sceneB = await fixtureLoader(epochB, manifest, new AbortController().signal);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const immediateLoader: EpochLoader = async epoch => epoch.epoch_id === epochA.epoch_id ? sceneA : sceneB;
const byTime = (time: number) => time < epochB.t_start ? epochA.epoch_id : epochB.epoch_id;

test('both pinned PMTiles archives decode complete immutable territory, density, and movement layers', () => {
  for (const [scene, epoch] of [[sceneA, epochA], [sceneB, epochB]] as const) {
    assert.equal(scene.epoch_id, epoch.epoch_id);
    assert.equal(scene.edition, manifest.edition);
    assert.equal(scene.territories.length, 5);
    assert.equal(new Set(scene.territories.map(feature => feature.properties.entity_id)).size, 3);
    assert.equal(scene.population.length, 6);
    assert.equal(scene.migration.length, 1);
    for (const features of [scene.territories, scene.population, scene.migration]) for (const feature of features) {
      assert.equal(feature.properties.t_start, epoch.t_start);
      assert.equal(feature.properties.t_end, epoch.t_end);
      assert.equal(feature.id, feature.properties.render_id);
      assert.ok(Object.isFrozen(feature.geometry.coordinates));
    }
  }
});

test('manifest validates half-open intervals, uniqueness, resource bounds and relative archive URLs', () => {
  assert.equal(manifest.epochs[0].url, 'https://fixture.invalid/fixtures/epoch-950.pmtiles');
  const overlap = structuredClone(manifestInput);
  overlap.epochs[1].t_start = overlap.epochs[0].t_end - 1;
  assert.throws(() => validateManifest(overlap), /overlap/);
  const duplicate = structuredClone(manifestInput);
  duplicate.epochs[1].epoch_id = duplicate.epochs[0].epoch_id;
  assert.throws(() => validateManifest(duplicate), /identity/);
  const oversized = structuredClone(manifestInput);
  oversized.epochs[0].byte_length = 1_000_001;
  assert.throws(() => validateManifest(oversized), /bounded archive/);
  const noninteger = structuredClone(manifestInput);
  noninteger.epochs[0].t_start += .5;
  assert.throws(() => validateManifest(noninteger), /integer/);
  const missingLayer = structuredClone(manifestInput);
  missingLayer.epochs[0].layers.pop();
  assert.throws(() => validateManifest(missingLayer), /layers/);
});

test('cross B then reverse to cached A: a late B response can never replace the committed generation', async () => {
  const lateB = deferred<SceneData>();
  const requests: number[] = [], visible: string[] = [], committed: SceneSnapshot[] = [];
  let abortedB: AbortSignal | undefined;
  const loader: EpochLoader = (epoch, _, signal) => {
    if (epoch.epoch_id === epochB.epoch_id) { abortedB = signal; return lateB.promise; }
    return Promise.resolve(sceneA);
  };
  const controller = new TemporalController(manifest, {
    onRequest: time => requests.push(time),
    prepare: async scene => () => visible.push(scene.epoch_id),
    onCommit: scene => committed.push(scene),
  }, loader);
  await controller.seek(epochA.t_start);
  const crossing = controller.seek(epochB.t_start);
  assert.equal(controller.current!.epoch_id, epochA.epoch_id, 'Old complete scene remains while B is pending.');
  const reversing = await controller.seek(epochA.t_end - 1);
  assert.equal(reversing.status, 'committed');
  assert.ok(abortedB!.aborted);
  lateB.resolve(sceneB); // Deliberately emulate a transport that ignores abort.
  assert.equal((await crossing).status, 'stale');
  assert.deepEqual(visible, [epochA.epoch_id, epochA.epoch_id]);
  assert.deepEqual(committed.map(scene => scene.generation), [1, 3]);
  assert.deepEqual(requests, [epochA.t_start, epochB.t_start, epochA.t_end - 1]);
});

test('stale work after render preparation cannot swap a complete scene or clear a newer pending indicator', async () => {
  const prepareB = deferred<() => void>();
  const enteredB = deferred<void>();
  const swaps: string[] = [], pending: [boolean, number][] = [];
  let prepSignal: AbortSignal | undefined;
  const controller = new TemporalController(manifest, {
    onPending: (value, generation) => pending.push([value, generation]),
    prepare: async (scene, signal) => {
      if (scene.epoch_id === epochB.epoch_id) { prepSignal = signal; enteredB.resolve(); return prepareB.promise; }
      return () => swaps.push(scene.epoch_id);
    }, onCommit: () => undefined,
  }, immediateLoader);
  await controller.seek(epochA.t_start);
  const crossing = controller.seek(epochB.t_start);
  await enteredB.promise;
  await controller.seek(epochA.t_end - 1);
  assert.ok(prepSignal!.aborted);
  prepareB.resolve(() => swaps.push(epochB.epoch_id));
  assert.equal((await crossing).status, 'stale');
  assert.deepEqual(swaps, [epochA.epoch_id, epochA.epoch_id]);
  assert.deepEqual(pending, [[true, 1], [false, 1], [true, 2], [true, 3], [false, 3]]);
});

test('same-epoch seek also invalidates older work; presentation does not commit historical time', async () => {
  const firstPrepare = deferred<() => void>(), firstEntered = deferred<void>();
  const visible: number[] = [];
  const controller = new TemporalController(manifest, {
    prepare: async scene => {
      if (scene.generation === 1) { firstEntered.resolve(); return firstPrepare.promise; }
      return () => visible.push(scene.time);
    }, onCommit: () => undefined,
  }, immediateLoader);
  const first = controller.seek(epochA.t_start);
  await firstEntered.promise;
  await controller.seek(epochA.t_start + 1);
  firstPrepare.resolve(() => visible.push(epochA.t_start));
  assert.equal((await first).status, 'stale');
  assert.deepEqual(visible, [epochA.t_start + 1]);
  assert.equal(controller.current!.generation, 2);
});

test('failed epoch delivery retains previous complete scene; the exact boundary selects only B', async () => {
  let failB = true;
  const errors: Error[] = [], commits: SceneSnapshot[] = [];
  const loader: EpochLoader = async epoch => {
    if (epoch.epoch_id === epochB.epoch_id && failB) throw new Error('Simulated delivery failure');
    return epoch.epoch_id === epochA.epoch_id ? sceneA : sceneB;
  };
  const controller = new TemporalController(manifest, {
    prepare: async scene => () => {
      for (const features of [scene.territories, scene.population, scene.migration]) for (const feature of features) {
        assert.ok(feature.properties.t_start <= scene.time && scene.time < feature.properties.t_end);
      }
    }, onCommit: scene => commits.push(scene), onError: error => errors.push(error),
  }, loader);
  await controller.seek(epochA.t_end - 1);
  const retained = controller.current;
  assert.equal((await controller.seek(epochA.t_end)).status, 'error');
  assert.strictEqual(controller.current, retained);
  assert.equal(errors.length, 1);
  failB = false;
  await controller.seek(epochA.t_end);
  assert.equal(controller.current!.epoch_id, epochB.epoch_id);
  assert.deepEqual(commits.map(scene => scene.epoch_id), commits.map(scene => byTime(scene.time)));
});

test('uncovered time explicitly commits empty layers rather than extending the last epoch', async () => {
  const requested: number[] = [], commits: SceneSnapshot[] = [];
  const controller = new TemporalController(manifest, {
    onRequest: time => requested.push(time), prepare: async () => () => undefined, onCommit: scene => commits.push(scene),
  }, immediateLoader);
  await controller.seek(epochB.t_end - 1);
  await controller.seek(epochB.t_end);
  assert.equal(controller.current!.epoch_id, 'uncovered');
  assert.deepEqual([controller.current!.territories.length, controller.current!.population.length, controller.current!.migration.length], [0, 0, 0]);
  assert.equal(controller.current!.time, epochB.t_end);
  assert.deepEqual(requested, [epochB.t_end - 1, epochB.t_end]);
  assert.equal(commits.length, 2);
});

test('corrupt or truncated archives are rejected before decode and never populate the cache', async () => {
  let calls = 0;
  const corrupt = new Uint8Array(archiveA);
  corrupt[corrupt.length - 1] ^= 1;
  const loader = createEpochLoader(async () => { calls++; return new Response(calls === 1 ? corrupt : new Uint8Array(archiveA)); });
  await assert.rejects(loader(epochA, manifest, new AbortController().signal), /SHA-256/);
  assert.equal((await loader(epochA, manifest, new AbortController().signal)).epoch_id, epochA.epoch_id);
  await loader(epochA, manifest, new AbortController().signal);
  assert.equal(calls, 2);
  await assert.rejects(createEpochLoader(async () => new Response(new Uint8Array(archiveA.slice(0, -1))))(epochA, manifest, new AbortController().signal), /byte length/);
  await assert.rejects(createEpochLoader(async () => new Response(new Uint8Array(archiveA), { headers: { 'content-length': String(epochA.byte_length + 1) } }))(epochA, manifest, new AbortController().signal), /budget/);
});

test('an aborted in-flight fetch cannot poison a subsequent request for the same epoch', async () => {
  const oldResponse = deferred<Response>();
  let calls = 0;
  const loader = createEpochLoader(async () => ++calls === 1 ? oldResponse.promise : responseFor(epochA.epoch_id));
  const abandoned = new AbortController();
  const first = loader(epochA, manifest, abandoned.signal);
  abandoned.abort();
  const second = await loader(epochA, manifest, new AbortController().signal);
  oldResponse.resolve(responseFor(epochA.epoch_id));
  await assert.rejects(first, { name: 'AbortError' });
  assert.equal(second.epoch_id, epochA.epoch_id);
  assert.strictEqual(await loader(epochA, manifest, new AbortController().signal), second);
  assert.equal(calls, 2);
});

test('cache reuse is bounded to two successful archives and rejects a pre-aborted cache hit', async () => {
  let calls = 0;
  const loader = createEpochLoader(async input => { calls++; return localFetcher(input); });
  const a = await loader(epochA, manifest, new AbortController().signal);
  await loader(epochB, manifest, new AbortController().signal);
  assert.strictEqual(await loader(epochA, manifest, new AbortController().signal), a);
  assert.equal(calls, 2);
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(loader(epochA, manifest, cancelled.signal), { name: 'AbortError' });
  assert.equal(calls, 2);
  // A third cache key with the same valid edition/bytes evicts the least-recently-used B.
  await loader({ ...epochA, url: `${epochA.url}?cache-budget-check` }, manifest, new AbortController().signal);
  assert.equal(calls, 3);
  await loader(epochB, manifest, new AbortController().signal);
  assert.equal(calls, 4, 'The third success must have evicted the older B cache entry.');
});

test('missing required MVT layer prevents the entire scene from being admitted', async () => {
  const archive = new PMTiles({
    getKey: () => 'test-valid-fixture',
    getBytes: async (offset, length) => ({ data: new Uint8Array(archiveA.slice(offset, offset + length)).buffer }),
  });
  const tileData = await archive.getZxy(...epochA.tile);
  const tile = new VectorTile(new Pbf(tileData!.data));
  delete tile.layers.population;
  const missing = new Uint8Array(fromVectorTileJs(tile)).buffer;
  assert.throws(() => decodeScene(missing, epochA, manifest), /required layer: population/);
});

test('duplicate promoted IDs across territory and population layers reject the complete scene', async () => {
  const archive = new PMTiles({
    getKey: () => 'test-duplicate-promoted-identity',
    getBytes: async (offset, length) => ({ data: new Uint8Array(archiveA.slice(offset, offset + length)).buffer }),
  });
  const tileData = await archive.getZxy(...epochA.tile);
  const tile = new VectorTile(new Pbf(tileData!.data));
  const territoryId = tile.layers.territories.feature(0).properties.render_id;
  const population = tile.layers.population;
  const readPopulation = population.feature.bind(population);
  population.feature = index => {
    const feature = readPopulation(index);
    if (index === 0) feature.properties.render_id = territoryId;
    return feature;
  };
  const duplicated = new Uint8Array(fromVectorTileJs(tile)).buffer;
  assert.throws(() => decodeScene(duplicated, epochA, manifest), /Duplicate render_id across scene layers/);
});

test('archive integrity verification works without Web Crypto on HTTP preview origins', async () => {
  const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
  try {
    const loader = createEpochLoader(localFetcher);
    assert.equal((await loader(epochA, manifest, new AbortController().signal)).epoch_id, epochA.epoch_id);
    const corrupt = new Uint8Array(archiveA);
    corrupt[corrupt.length - 1] ^= 1;
    await assert.rejects(createEpochLoader(async () => new Response(corrupt))(epochA, manifest, new AbortController().signal), /SHA-256/);
  } finally {
    if (cryptoDescriptor) Object.defineProperty(globalThis, 'crypto', cryptoDescriptor);
    else Reflect.deleteProperty(globalThis, 'crypto');
  }
});

test('metadata mismatch and failed preparation preserve the last committed generation', async () => {
  const wrongEpoch = { ...epochA, epoch_id: 'different-epoch' };
  await assert.rejects(createEpochLoader(localFetcher)(wrongEpoch, manifest, new AbortController().signal), /metadata/);
  let fail = false;
  const controller = new TemporalController(manifest, {
    prepare: async () => { if (fail) throw new Error('Offscreen render failed'); return () => undefined; }, onCommit: () => undefined,
  }, immediateLoader);
  await controller.seek(epochA.t_start);
  const retained = controller.current;
  fail = true;
  assert.equal((await controller.seek(epochB.t_start)).status, 'error');
  assert.strictEqual(controller.current, retained);
  controller.dispose();
});

test('queued cursor input invalidates an older preparation before next-frame delivery', async () => {
  const prepared = deferred<() => void>(), entered = deferred<void>();
  const swaps: number[] = [];
  const controller = new TemporalController(manifest, {
    prepare: async scene => {
      if (scene.epoch_id === epochB.epoch_id) { entered.resolve(); return prepared.promise; }
      return () => swaps.push(scene.time);
    }, onCommit: () => undefined,
  }, immediateLoader);
  await controller.seek(epochA.t_start);
  const old = controller.seek(epochB.t_start); await entered.promise;
  controller.invalidatePending();
  prepared.resolve(() => swaps.push(epochB.t_start));
  assert.equal((await old).status, 'stale');
  assert.deepEqual(swaps, [epochA.t_start]);
  assert.equal(controller.current!.time, epochA.t_start);
  assert.equal((await controller.seek(epochA.t_end - 1)).status, 'committed');
});
