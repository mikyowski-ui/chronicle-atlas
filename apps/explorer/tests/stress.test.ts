import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { SceneSnapshot } from '../../../packages/contracts/src/index.ts';
import { reconcileSelection, resolvePick, selectEntity, type TerritorySelection } from '../src/picking.ts';
import { createEpochLoader, TemporalController, validateManifest, type EpochLoader, type SceneData } from '../src/temporal.ts';

// Use the delivered archives, including their actual independent demographic layers.
const manifest = validateManifest(JSON.parse(await readFile(new URL('../public/fixtures/manifest.json', import.meta.url), 'utf8')),
  'https://fixture.invalid/fixtures/manifest.json');
const [epochA, epochB] = manifest.epochs;
const archiveA = new Uint8Array(await readFile(new URL('../public/fixtures/epoch-950.pmtiles', import.meta.url)));
const archiveB = new Uint8Array(await readFile(new URL('../public/fixtures/epoch-1050.pmtiles', import.meta.url)));
const decode = createEpochLoader(async input => new Response(new Uint8Array(String(input).includes('epoch-950') ? archiveA : archiveB)));
const dataA = await decode(epochA, manifest, new AbortController().signal);
const dataB = await decode(epochB, manifest, new AbortController().signal);
const dataFor: EpochLoader = async epoch => epoch.epoch_id === epochA.epoch_id ? dataA : dataB;
const delay = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** An observation of a whole renderer swap, not a claim about physical GPU paint. */
function observe() {
  const swaps: SceneSnapshot[] = [], commits: SceneSnapshot[] = [], errors: Error[] = [];
  let rendered: SceneSnapshot | undefined;
  return {
    swaps, commits, errors,
    swap(scene: SceneSnapshot) {
      const expected = scene.epoch_id === epochA.epoch_id ? dataA : dataB;
      for (const layer of ['territories', 'population', 'migration'] as const) {
        assert.deepEqual(scene[layer].map(feature => feature.properties.render_id), expected[layer].map(feature => feature.properties.render_id),
          `${layer} must come entirely from ${scene.epoch_id}`);
        for (const feature of scene[layer]) assert.ok(feature.properties.t_start <= scene.time && scene.time < feature.properties.t_end);
      }
      // This single reference assignment is the renderer's atomic commit contract.
      rendered = scene;
      swaps.push(scene);
    },
    commit(scene: SceneSnapshot) {
      assert.strictEqual(rendered, scene, 'Application state and the complete rendered scene commit in the same turn.');
      commits.push(scene);
    },
    error(error: Error) { errors.push(error); },
  };
}

test('VP06: a real 500 ms delivery completing after two reversals cannot replace the latest complete scene', async () => {
  const observation = observe();
  let delayed = true;
  let delayedSignal: AbortSignal | undefined;
  const controller = new TemporalController(manifest, {
    prepare: async scene => () => observation.swap(scene), onCommit: observation.commit, onError: observation.error,
  }, async (epoch, _, signal) => {
    if (epoch.epoch_id === epochB.epoch_id && delayed) {
      delayedSignal = signal;
      await delay(500); // Deliberately ignore abort, as a late transport completion can.
    }
    return epoch.epoch_id === epochA.epoch_id ? dataA : dataB;
  });
  await controller.seek(epochA.t_start); // 950 CE
  const crossing = controller.seek(epochB.t_start); // 1050 CE
  await controller.seek(epochA.t_end - 1);
  await controller.seek(epochA.t_start);
  const newest = controller.current;
  assert.ok(delayedSignal!.aborted);
  assert.equal(newest!.generation, 4);
  assert.equal((await crossing).status, 'stale');
  assert.strictEqual(controller.current, newest);
  assert.deepEqual(observation.commits.map(scene => scene.generation), [1, 3, 4]);
  delayed = false;
  await controller.seek(epochB.t_start);
  assert.equal(controller.current!.epoch_id, epochB.epoch_id);
  assert.deepEqual(observation.errors, []);
  controller.dispose();
});

test('VP06: 128 alternating requests survive newest-first and interleaved stale completions without mixed layers', async () => {
  const deliveries: { gate: ReturnType<typeof deferred<SceneData>>; data: SceneData; signal: AbortSignal }[] = [];
  const observation = observe();
  const pending: [boolean, number][] = [];
  let starting = true;
  const controller = new TemporalController(manifest, {
    prepare: async scene => () => observation.swap(scene), onCommit: observation.commit, onError: observation.error,
    onPending: (value, generation) => pending.push([value, generation]),
  }, async (epoch, _, signal) => {
    const data = epoch.epoch_id === epochA.epoch_id ? dataA : dataB;
    if (starting) return data;
    const gate = deferred<SceneData>(); deliveries.push({ gate, data, signal }); return gate.promise;
  });
  await controller.seek(epochA.t_start);
  starting = false;
  const times = [epochA.t_start, epochB.t_start, epochA.t_end - 1, epochB.t_start + 1];
  const requests = Array.from({ length: 128 }, (_, index) => controller.seek(times[index % times.length]));
  assert.equal(controller.current!.generation, 1, 'Keep the old complete scene while delivery is pending.');
  assert.ok(deliveries.slice(0, -1).every(delivery => delivery.signal.aborted));
  const latest = deliveries.at(-1)!;
  latest.gate.resolve(latest.data);
  assert.equal((await requests.at(-1)!).status, 'committed');
  const newest = controller.current;
  // A fixed interleaving exercises both late successes and late transport errors.
  const order = Array.from({ length: 127 }, (_, index) => (index * 53) % 127);
  for (const index of order) {
    if (index % 11 === 0) deliveries[index].gate.reject(new Error(`Late failure ${index}`));
    else deliveries[index].gate.resolve(deliveries[index].data);
    assert.equal((await requests[index]).status, 'stale');
    assert.strictEqual(controller.current, newest);
  }
  assert.deepEqual(observation.commits.map(scene => scene.generation), [1, 129]);
  assert.deepEqual(observation.swaps.map(scene => scene.generation), [1, 129]);
  assert.deepEqual(pending.filter(([value]) => !value), [[false, 1], [false, 129]], 'Stale completions cannot clear a newer pending state.');
  assert.deepEqual(observation.errors, [], 'Stale failures must not replace the current delivery status.');
  controller.dispose();
});

test('VP06: 24 aborted offscreen preparations may finish late but none can execute a stale scene swap', async () => {
  const preparations: { gate: ReturnType<typeof deferred<() => void>>; scene: SceneSnapshot; signal: AbortSignal }[] = [];
  const observation = observe();
  let entered = deferred<void>();
  let stage = false;
  const controller = new TemporalController(manifest, {
    prepare: async (scene, signal) => {
      if (!stage) return () => observation.swap(scene);
      const gate = deferred<() => void>(); preparations.push({ gate, scene, signal }); entered.resolve(); return gate.promise;
    }, onCommit: observation.commit, onError: observation.error,
  }, dataFor);
  await controller.seek(epochA.t_start);
  stage = true;
  const requests = [];
  for (let index = 0; index < 24; index++) {
    entered = deferred<void>();
    requests.push(controller.seek(index % 2 ? epochA.t_end - 1 : epochB.t_start));
    await entered.promise;
  }
  stage = false;
  await controller.seek(epochB.t_start + 1);
  const newest = controller.current;
  assert.ok(preparations.every(preparation => preparation.signal.aborted));
  for (let index = preparations.length - 1; index >= 0; index--) {
    const preparation = preparations[index];
    preparation.gate.resolve(() => observation.swap(preparation.scene));
    assert.equal((await requests[index]).status, 'stale');
    assert.strictEqual(controller.current, newest);
  }
  assert.deepEqual(observation.swaps.map(scene => scene.generation), [1, 26]);
  assert.deepEqual(observation.commits.map(scene => scene.generation), [1, 26]);
  assert.deepEqual(observation.errors, []);
  controller.dispose();
});

test('VP06: Aster selected at 950 CE survives 1050 with the new territory state and only current render IDs', async () => {
  let selected: TerritorySelection | null = null;
  const controller = new TemporalController(manifest, {
    prepare: async () => () => undefined,
    onCommit: scene => { selected = reconcileSelection(selected, scene); },
  }, dataFor);
  await controller.seek(epochA.t_start);
  const firstScene = controller.current!;
  const initialSelection = selectEntity('synthetic:aster', firstScene)!;
  assert.ok(initialSelection);
  selected = initialSelection;
  await controller.seek(epochB.t_start);
  const secondScene = controller.current!;
  const expected = selectEntity('synthetic:aster', secondScene)!;
  assert.deepEqual(selected, expected);
  assert.equal(expected.entityId, initialSelection.entityId);
  assert.notEqual(expected.territoryStateId, initialSelection.territoryStateId);
  assert.ok(expected.renderIds.every(id => !initialSelection.renderIds.includes(id)));
  assert.equal(resolvePick([{ render_id: initialSelection.renderId, generation: firstScene.generation }], secondScene), null,
    'A late pointer hit on an old fragment cannot change current selection.');
  await controller.seek(epochA.t_end - 1);
  assert.deepEqual(selected, selectEntity('synthetic:aster', controller.current!));
  assert.equal((selected as unknown as TerritorySelection).territoryStateId, initialSelection.territoryStateId);
  controller.dispose();
});

test('VP06: a dissolved entity clears selection without inventing a successor or silently reselecting it later', async () => {
  let selected: TerritorySelection | null = null;
  // Explicit test-only absence: not an assertion about the authored fixture's history.
  const withoutAster: SceneData = { ...dataB, territories: dataB.territories.filter(feature => feature.properties.entity_id !== 'synthetic:aster') };
  const controller = new TemporalController(manifest, {
    prepare: async () => () => undefined,
    onCommit: scene => { selected = reconcileSelection(selected, scene); },
  }, async epoch => epoch.epoch_id === epochA.epoch_id ? dataA : withoutAster);
  await controller.seek(epochA.t_start);
  selected = selectEntity('synthetic:aster', controller.current!);
  assert.ok(selected);
  await controller.seek(epochB.t_start);
  assert.equal(selected, null);
  assert.ok(controller.current!.territories.length > 0, 'Unrelated entities remain usable.');
  await controller.seek(epochA.t_start);
  assert.equal(selected, null, 'A cleared selection stays cleared until another explicit selection.');
  assert.ok(selectEntity('synthetic:aster', controller.current!), 'The original entity is still selectable at its supported time.');
  controller.dispose();
});
