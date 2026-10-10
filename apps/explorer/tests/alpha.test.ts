import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { AlphaManifest, SceneSnapshot } from '../../../packages/contracts/src/index.ts';
import { adaptAlphaManifest, createAlphaLoader, loadAlphaBase, validateAlphaManifest, validateAlphaMetadata } from '../src/alpha.ts';
import { TemporalController } from '../src/temporal.ts';
import { chooseSceneLabels } from '../src/labels.ts';
import { reconcileSelection, resolvePick, selectEntity } from '../src/picking.ts';

const origin = 'https://example.test/alpha/';
const signal = () => new AbortController().signal;
const localFetcher: typeof fetch = async input => new Response(await readFile(new URL(`../public${new URL(String(input)).pathname}`, import.meta.url)));
async function manifest(name = 'historical'): Promise<AlphaManifest> {
  return validateAlphaManifest(JSON.parse(await readFile(new URL(`../public/alpha/${name}-manifest.json`, import.meta.url), 'utf8')), `${origin}${name}-manifest.json`);
}
async function metadata(m: AlphaManifest, index = 0) {
  return JSON.parse(await (await localFetcher(m.epochs[index].metadata.url)).text());
}

test('all compiled Alpha observations load original vectors and independent geography within their declared hashes', async () => {
  const counts: number[] = [];
  for (const name of ['historical', 'fixture']) {
    const m = await manifest(name); const chronology = adaptAlphaManifest(m);
    const loader = createAlphaLoader(m, `${origin}${name}-manifest.json`, true, localFetcher);
    let count = 0;
    for (const epoch of chronology.epochs) {
      const scene = await loader(epoch, chronology, signal());
      assert.equal(scene.territories.length, scene.parts!.length);
      assert.equal(new Set(scene.parts!.map(part => part.properties.render_id)).size, scene.parts!.length);
      assert.equal(scene.stream!.sha256, epoch.sha256);
      count++;
    }
    const land = await loadAlphaBase(m, `${origin}${name}-manifest.json`, signal(), localFetcher);
    assert.ok(land.features.length > 1);
    counts.push(count);
  }
  assert.deepEqual(counts, [32, 2]);
});

test('native delivery reads only canonical metadata, never a whole archive or Canvas geometry', async () => {
  const m = await manifest('fixture'); const chronology = adaptAlphaManifest(m); const requests: string[] = [];
  const loader = createAlphaLoader(m, `${origin}fixture-manifest.json`, false, async (input, init) => {
    requests.push(String(input)); return localFetcher(input, init);
  });
  const data = await loader(chronology.epochs[0], chronology, signal());
  assert.deepEqual(requests, [m.epochs[0].metadata.url]);
  assert.equal(data.territories.length, 0);
  assert.equal(data.parts!.length, 5);
  assert.equal(data.migration.length, 1);
  const scene: SceneSnapshot = { ...data, generation: 1, time: chronology.epochs[0].t_start };
  assert.equal(chooseSceneLabels(scene).length, 3);
  const cedar = scene.parts!.find(part => part.properties.entity_id === 'synthetic:cedar')!;
  const selection = resolvePick([{ render_id: cedar.properties.render_id, generation: 1 }], scene)!;
  assert.equal(selection.entityId, 'synthetic:cedar');
  assert.equal(selection.renderIds.length, 3);
  assert.deepEqual(selectEntity(selection.entityId, scene)?.renderIds, selection.renderIds);
  const next = await loader(chronology.epochs[1], chronology, signal());
  const retained = reconcileSelection(selection, { ...next, generation: 2, time: chronology.epochs[1].t_start });
  assert.equal(retained?.entityId, 'synthetic:cedar');
  assert.equal(retained?.renderIds.length, 3);
});

test('the canonical area and priority index resolves native overlap without trusting tile properties', async () => {
  const m = await manifest('fixture'); const chronology = adaptAlphaManifest(m);
  const data = await createAlphaLoader(m, origin, false, localFetcher)(chronology.epochs[0], chronology, signal());
  const scene: SceneSnapshot = { ...data, generation: 8, time: chronology.initial_time };
  const a = scene.parts![0]; const b = scene.parts![1];
  const ranked = { ...scene, parts: [{ ...a, areaKm2: 10 }, { ...b, areaKm2: 1 }] };
  const hits = [a, b].map(part => ({ render_id: part.properties.render_id, generation: 8, pick_priority: Infinity }));
  assert.equal(resolvePick(hits, ranked)?.entityId, b.properties.entity_id);
  assert.equal(resolvePick(hits.slice().reverse(), ranked)?.entityId, b.properties.entity_id);
  assert.equal(resolvePick(hits.map(hit => ({ ...hit, generation: 7 })), ranked), null);
});

test('tampered sidecars and recorded-edition mismatch fail before producing a scene', async () => {
  const m = await manifest(); const chronology = adaptAlphaManifest(m);
  const loader = createAlphaLoader(m, origin, false, async input => {
    const bytes = new Uint8Array(await (await localFetcher(input)).arrayBuffer()); bytes[bytes.length - 1] ^= 1;
    return new Response(bytes);
  });
  await assert.rejects(loader(chronology.epochs[0], chronology, signal()), /SHA-256/);
  await assert.rejects(loader(chronology.epochs[0], { ...chronology, recorded_at: '2025-01-01T00:00:00Z' }, signal()), /recorded editions/);
});

test('manifest rejects overlapping epochs and malformed range-integrity descriptors', async () => {
  const m = await manifest('fixture');
  const overlap = structuredClone(m); overlap.epochs[1].t_start = overlap.epochs[0].t_end - 1;
  assert.throws(() => validateAlphaManifest(overlap), /overlap/);
  const hashes = structuredClone(m); hashes.epochs[0].stream.integrity.sha256 = [];
  assert.throws(() => validateAlphaManifest(hashes), /integrity chunks/);
  const unsupportedChunks = structuredClone(m); unsupportedChunks.epochs[0].stream.integrity.chunk_size = 32_768;
  unsupportedChunks.epochs[0].stream.integrity.sha256 = Array(Math.ceil(unsupportedChunks.epochs[0].stream.byte_length / 32_768)).fill('0'.repeat(64));
  assert.throws(() => validateAlphaManifest(unsupportedChunks), /integrity chunks/);
  const huge = structuredClone(m); huge.epochs[0].stream.byte_length = 1_000_001;
  assert.throws(() => validateAlphaManifest(huge), /resource bound/);
});

test('canonical metadata enforces unique parts and bitemporal evidence for independent migration', async () => {
  const m = await manifest(); const first = await metadata(m);
  first.parts.push(first.parts[0]);
  assert.throws(() => validateAlphaMetadata(first, m.epochs[0], m), /canonical Alpha part/);
  const index = m.epochs.findIndex(epoch => epoch.epoch_id === 'isles-migration-1847');
  const independent = await metadata(m, index);
  assert.equal(validateAlphaMetadata(independent, m.epochs[index], m).parts?.length, 0);
  assert.throws(() => validateAlphaMetadata(independent, m.epochs[index], { ...m, recorded_at: '2026-09-20T02:00:00Z' }), /inactive in the recorded edition/);
});

test('Alpha cache is bounded to two successful generations and aborted cache reads are rejected', async () => {
  const m = await manifest(); const chronology = adaptAlphaManifest(m); const reads: string[] = [];
  const loader = createAlphaLoader(m, origin, false, async input => { reads.push(String(input)); return localFetcher(input); });
  for (const index of [0, 1, 0, 2, 1]) await loader(chronology.epochs[index], chronology, signal());
  assert.equal(reads.length, 4);
  const aborter = new AbortController(); aborter.abort();
  await assert.rejects(loader(chronology.epochs[1], chronology, aborter.signal), /abort/i);
});

test('temporal commits filter canonical parts at the requested half-open date', async () => {
  const m = await manifest('fixture'); const chronology = adaptAlphaManifest(m);
  const base = await createAlphaLoader(m, origin, false, localFetcher)(chronology.epochs[0], chronology, signal());
  const cutoff = chronology.epochs[0].t_start + 2;
  const parts = base.parts!.map((part, index) => index ? part : { ...part, properties: { ...part.properties, t_end: cutoff } });
  const controller = new TemporalController(chronology, { prepare: async () => () => {}, onCommit: () => {} }, async () => ({ ...base, parts }));
  const outcome = await controller.seek(cutoff);
  assert.equal(outcome.status, 'committed');
  assert.equal(controller.current!.parts!.length, base.parts!.length - 1);
  assert.equal(selectEntity(parts[0].properties.entity_id, controller.current!), null);
  controller.dispose();
});
