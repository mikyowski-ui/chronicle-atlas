import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PMTiles } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import { fromVectorTileJs } from '@maplibre/vt-pbf';
import Pbf from 'pbf';
import type { SceneMetadata } from '../../../packages/contracts/src/index.ts';
import { createEpochLoader, decodeScene, validateManifest } from '../src/temporal.ts';

const manifest = validateManifest(JSON.parse(await readFile(new URL('../public/wave-b/manifest.json', import.meta.url), 'utf8')));
const epoch = manifest.epochs.find(value => value.epoch_id === 'isles-800')!;
const bytes = new Uint8Array(await readFile(new URL('../public/wave-b/isles-800.pmtiles', import.meta.url)));
const archive = new PMTiles({
  getKey: () => 'admission-test-isles-800',
  getBytes: async (offset, length) => ({ data: bytes.slice(offset, offset + length).buffer }),
});
const metadata = (await archive.getMetadata() as { scene_metadata: SceneMetadata }).scene_metadata;
const tile = (await archive.getZxy(...epoch.tile))!.data;

test('historical sparse layers accept declared absence but reject a missing declared layer before scene admission', () => {
  const scene = decodeScene(tile, epoch, manifest, metadata);
  assert.ok(scene.territories.length > 0);
  assert.deepEqual(scene.population, []);
  assert.deepEqual(scene.migration, []);
  assert.throws(() => decodeScene(tile, { ...epoch, layers: ['territories', 'population'] }, manifest, metadata), /required layer: population/);
  const withoutTerritories = new VectorTile(new Pbf(tile));
  delete withoutTerritories.layers.territories;
  assert.throws(() => decodeScene(new Uint8Array(fromVectorTileJs(withoutTerritories)).buffer, epoch, manifest, metadata), /required layer: territories/);
});

test('historical scene admission rejects incomplete linkage and invalid valid-time or recorded-time evidence', () => {
  const first = Object.keys(metadata.evidence!)[0];
  const mutate = (change: (value: SceneMetadata) => void) => {
    const next = structuredClone(metadata);
    change(next);
    return () => decodeScene(tile, epoch, manifest, next);
  };
  assert.throws(mutate(value => { value.evidence = {}; }), /evidence linkage/);
  assert.throws(mutate(value => { value.entities = {}; }), /evidence linkage/);
  assert.throws(mutate(value => { value.evidence![first].valid_from += 1; }), /bitemporal evidence/);
  assert.throws(mutate(value => { value.evidence![first].recorded_from = 'not a recorded date'; }), /bitemporal evidence/);
  assert.throws(mutate(value => { value.evidence![first].recorded_to = value.evidence![first].recorded_from; }), /bitemporal evidence/);
  assert.equal(decodeScene(tile, epoch, manifest, metadata).epoch_id, epoch.epoch_id, 'Failed candidates leave the original immutable metadata usable.');
});

test('historical evidence must be active at the manifest recorded edition, including the exclusive recorded end', () => {
  const first = Object.keys(metadata.evidence!)[0];
  const asOf = Date.parse(manifest.recorded_at!);
  const future = structuredClone(metadata);
  future.evidence![first].recorded_from = new Date(asOf + 1).toISOString();
  assert.throws(() => decodeScene(tile, epoch, manifest, future), /recorded|bitemporal/i);
  for (const end of [asOf - 1, asOf]) {
    const ended = structuredClone(metadata);
    ended.evidence![first].recorded_from = new Date(asOf - 86_400_000).toISOString();
    ended.evidence![first].recorded_to = new Date(end).toISOString();
    assert.throws(() => decodeScene(tile, epoch, manifest, ended), /recorded|bitemporal/i);
  }
  const stillActive = structuredClone(metadata);
  stillActive.evidence![first].recorded_to = new Date(asOf + 1).toISOString();
  assert.equal(decodeScene(tile, epoch, manifest, stillActive).epoch_id, epoch.epoch_id);
});

test('the uncertainty envelope retains source precision and must be finite, ordered and agree with valid-time bounds', () => {
  const first = Object.keys(metadata.evidence!)[0];
  const validExtent = metadata.evidence![first].valid_extent!;
  assert.equal(validExtent.precision, 'year');
  assert.equal(validExtent.start.earliest, epoch.t_start);
  assert.equal(validExtent.end.latest, epoch.t_end);
  for (const change of [
    (extent: typeof validExtent) => { extent.start.latest = extent.start.earliest - 1; },
    (extent: typeof validExtent) => { extent.end.earliest = extent.end.latest + 1; },
    (extent: typeof validExtent) => { extent.start.latest = Infinity; },
    (extent: typeof validExtent) => { extent.end.earliest += .5; },
    (extent: typeof validExtent) => { extent.start.earliest -= 1; },
    (extent: typeof validExtent) => { extent.end.latest += 1; },
    (extent: typeof validExtent) => { extent.precision = ''; },
  ]) {
    const changed = structuredClone(metadata);
    change(changed.evidence![first].valid_extent!);
    assert.throws(() => decodeScene(tile, epoch, manifest, changed), /uncertainty|extent|precision|envelope|temporal/i);
  }
  const admitted = decodeScene(tile, epoch, manifest, metadata);
  assert.deepEqual(admitted.evidence![first].valid_extent, validExtent, 'Admission must not narrow a year-precision envelope to exact dates.');
});

test('a cached archive cannot bypass a different manifest recorded-time boundary', async () => {
  const loader = createEpochLoader(async () => new Response(new Uint8Array(bytes)));
  const signal = new AbortController().signal;
  assert.equal((await loader(epoch, manifest, signal)).epoch_id, epoch.epoch_id);
  const earlierEdition = { ...manifest, recorded_at: new Date(Date.parse(manifest.recorded_at!) - 1).toISOString() };
  await assert.rejects(loader(epoch, earlierEdition, signal), /recorded|bitemporal/i);
  assert.equal((await loader(epoch, manifest, signal)).epoch_id, epoch.epoch_id, 'An invalid as-of attempt does not poison the original cached edition.');
});
