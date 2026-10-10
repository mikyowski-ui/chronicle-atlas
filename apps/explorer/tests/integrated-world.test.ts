import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PMTiles } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import { adaptAlphaManifest, createAlphaLoader, loadAlphaBase, validateAlphaManifest } from '../src/alpha.ts';
import { selectEntity, reconcileSelection } from '../src/picking.ts';
import { TemporalController } from '../src/temporal.ts';

const read = async (name: string) => JSON.parse(await readFile(new URL('../public/' + name, import.meta.url), 'utf8'));
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const origin = 'https://example.test/integrated/world-manifest.json';
const signal = () => new AbortController().signal;
const fetcher: typeof fetch = async input => new Response(await readFile(new URL('../public' + new URL(String(input)).pathname, import.meta.url)));
const world = async () => validateAlphaManifest(await read('integrated/world-manifest.json'), origin);

test('world1900 retains admissible source polygons and explicitly accounts for every source feature', async () => {
  const [source, mapping, result, queue, fallback, inventory] = await Promise.all([
    read('integrated/source/world_1900.geojson'), read('integrated/source/world_1900-mappings.json'),
    read('integrated/mapping-record.json'), read('integrated/review-queue.json'),
    read('integrated/world-overview-1900.geojson.json'), read('integrated/source-inventory.json'),
  ]);
  assert.equal(hash(await readFile(new URL('../public/integrated/source/world_1900.geojson', import.meta.url))), inventory.historical_source.sha256);
  const admitted = new Set<number>(result.records.map((r: { source_feature_index: number }) => r.source_feature_index));
  const withheld = new Set<number>(queue.records.map((r: { source_feature_index: number }) => r.source_feature_index));
  assert.equal(admitted.size + withheld.size, source.features.length);
  for (const index of admitted) assert.ok(!withheld.has(index));
  for (const row of result.records) {
    assert.equal(mapping.mappings[row.source_feature_index].decision, 'political-association');
    const original = source.features[row.source_feature_index].geometry;
    const coordinates = original.type === 'Polygon' ? [original.coordinates] : original.coordinates;
    assert.deepEqual(fallback.territories.filter((f: any) => f.properties.source_feature_index === row.source_feature_index).map((f: any) => f.geometry.coordinates), coordinates);
    assert.equal(row.repair, 'none; JSTS2.12.1 IsValidOp passed');
  }
  assert.equal(result.admitted_features, 111);
  assert.equal(queue.count, 159);
  assert.ok(result.records.every((r: any) => !/Hawai[ʻiian]/i.test(r.source_name)));
});

test('world archive contains spatially addressable land and political tiles on three continents', async () => {
  const m = await world();
  for (const [stream, layer, points] of [
    [m.base_geography.stream, 'land', [[-100, 40], [20, 10], [105, 35]]],
    [m.epochs[0].stream, 'territories', [[-100, 40], [30, 27], [137, 36]]],
  ] as const) {
    const bytes = await readFile(new URL('../public' + new URL(stream.url).pathname, import.meta.url));
    assert.equal(hash(bytes), stream.sha256);
    assert.ok(bytes.length < 1_000_000);
    const archive = new PMTiles({ getKey: () => stream.sha256, getBytes: async (offset, length) => ({ data: Uint8Array.from(bytes.subarray(offset, offset + length)).buffer }) });
    for (const [longitude, latitude] of points) {
      const z = 4, x = Math.floor((longitude + 180) / 360 * 2 ** z), y = Math.floor((1 - Math.asinh(Math.tan(latitude * Math.PI / 180)) / Math.PI) / 2 * 2 ** z);
      const tile = await archive.getZxy(z, x, y);
      assert.ok(tile, `${layer} tile missing for ${longitude},${latitude}`);
      assert.ok(new VectorTile(new Pbf(tile.data)).layers[layer].length > 0);
    }
  }
});

test('global neutral land loads under unchanged caps and retains every physical component', async () => {
  const m = await world();
  const land = await loadAlphaBase(m, origin, signal(), fetcher);
  const report = await read('integrated/land-build-record.json');
  assert.equal(report.omitted_components, 0);
  assert.equal(report.source_components, 1421);
  assert.equal(land.features.length, 143);
  assert.equal(land.features.reduce((n: number, feature: any) => n + (feature.geometry.type === 'MultiPolygon' ? feature.geometry.coordinates.length : 1), 0), 1421);
  assert.ok(land.features.length <= 1000 && report.vertices <= 250_000 && report.bytes <= 4 * 1024 * 1024);
});

test('world route preserves UK entity intent across regional detail without aliasing display states', async () => {
  const m = await world(), regional = validateAlphaManifest(await read('alpha/historical-manifest.json'), 'https://example.test/alpha/historical-manifest.json');
  const wm = adaptAlphaManifest(m), rm = adaptAlphaManifest(regional);
  const we = wm.epochs[0], re = rm.epochs.find(e => e.epoch_id === 'isles-1900')!;
  const [w, r] = await Promise.all([
    createAlphaLoader(m, origin, true, fetcher)(we, wm, signal()),
    createAlphaLoader(regional, 'https://example.test/alpha/historical-manifest.json', true, fetcher)(re, rm, signal()),
  ]);
  const entity = Object.entries(w.entities!).find(([, e]) => e.name === 'United Kingdom of Great Britain and Ireland')![0];
  const before = selectEntity(entity, { ...w, generation: 1, time: we.t_start })!;
  const after = reconcileSelection(before, { ...r, generation: 2, time: re.t_start })!;
  assert.equal(after.entityId, before.entityId);
  assert.notDeepEqual(after.renderIds, before.renderIds);
  assert.equal(w.entities![entity].color, r.entities![entity].color);
  const catalog = await read('integrated/catalog.json');
  assert.equal(catalog.maximum_routes, 2);
  assert.equal(catalog.routes.find((route: any) => route.route_id === 'isles-detail').minzoom, 4);
});

test('world observation retains year precision and does not produce earlier political coverage', async () => {
  const m = await world(), chronology = adaptAlphaManifest(m);
  const loader = createAlphaLoader(m, origin, true, fetcher);
  const controller = new TemporalController(chronology, { prepare: async () => () => {}, onCommit: () => {} }, loader);
  const absent = await controller.seek(chronology.epochs[0].t_start - 1);
  assert.equal(absent.status, 'committed');
  assert.equal(controller.current?.territories.length, 0);
  const covered = await controller.seek(chronology.epochs[0].t_start);
  assert.equal(covered.status, 'committed');
  assert.equal(controller.current?.territories.length, 280);
  assert.ok(Object.values(controller.current?.evidence ?? {}).every(e => e.valid_extent?.precision === 'year'));
  controller.dispose();
});
