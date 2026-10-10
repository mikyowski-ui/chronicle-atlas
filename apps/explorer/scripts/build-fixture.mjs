// Rebuild the bounded synthetic temporal fixture. No historical input is read.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import geojsonvt from 'geojson-vt';
import { fromGeojsonVt } from '@maplibre/vt-pbf';
import { PMTiles } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';

const app = fileURLToPath(new URL('../', import.meta.url));
const output = join(app, 'public/fixtures');
const build = join(app, '.sites-runtime/fixture-build');
const inputPath = join(app, 'fixtures/meridian-v2.json');
const inputBytes = await readFile(inputPath);
const input = JSON.parse(inputBytes.toString('utf8'));
const layers = ['territories', 'population', 'migration'];
const budget = Object.freeze({ archives: 2, tilesPerArchive: 1, featuresPerArchive: 12, bytesPerArchive: 1_000_000 });
const extent = 65536;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

if (input.fixture_kind !== 'synthetic' || input.schema_version !== 1 || input.edition !== 'meridian-v2' || input.epochs.length !== budget.archives) {
  throw new Error('Unexpected fixture edition or archive count.');
}
await mkdir(output, { recursive: true });
await mkdir(join(build, 'tmp'), { recursive: true });
const manifest = { schema_version: 1, fixture_kind: 'synthetic', edition: input.edition, initial_time: input.initial_time, epochs: [] };
const results = [];

for (const epoch of input.epochs) {
  if (!Number.isSafeInteger(epoch.t_start) || !Number.isSafeInteger(epoch.t_end) || epoch.t_start >= epoch.t_end) {
    throw new Error('Invalid epoch interval.');
  }
  const collections = {};
  const vectorLayers = [];
  const tileLayers = {};
  const ids = new Set();
  for (const layer of layers) {
    const features = epoch[layer].map(record => {
      const { coordinates, ...properties } = record;
      if (!properties.render_id || ids.has(properties.render_id)) throw new Error('Invalid or duplicate render_id.');
      ids.add(properties.render_id);
      return {
        type: 'Feature',
        properties: { ...properties, t_start: epoch.t_start, t_end: epoch.t_end },
        geometry: { type: layer === 'migration' ? 'LineString' : 'Polygon', coordinates },
      };
    });
    collections[layer] = { type: 'FeatureCollection', features };
    tileLayers[layer] = geojsonvt(collections[layer], {
      maxZoom: 0, indexMaxZoom: 0, tolerance: 0, extent, buffer: 0,
    }).getTile(0, 0, 0);
    if (!tileLayers[layer] || tileLayers[layer].features.length !== features.length) throw new Error(`Unexpected feature loss in ${layer}.`);
    const fields = Object.fromEntries(Object.entries(features[0].properties).map(([key, value]) => [key, typeof value === 'number' ? 'Number' : 'String']));
    vectorLayers.push({ id: layer, minzoom: 0, maxzoom: 0, fields });
  }
  if (ids.size !== budget.featuresPerArchive || new Set(epoch.territories.map(f => f.entity_id)).size !== 3 || epoch.migration.length !== 1) {
    throw new Error('Fixture count budget changed.');
  }
  const stem = `epoch-${epoch.epoch_id === 'meridian-950' ? '950' : '1050'}`;
  const metadata = {
    schema_version: 1, fixture_kind: 'synthetic', edition: input.edition,
    epoch_id: epoch.epoch_id, t_start: epoch.t_start, t_end: epoch.t_end,
    name: `Meridian Isles — ${epoch.epoch_id} — SYNTHETIC`,
    description: 'Invented territory, independent population density, and movement for interaction tests only. No historical claims.',
    attribution: 'Chronicle Atlas synthetic fixture; no third-party historical data.',
    format: 'pbf', type: 'overlay', minzoom: 0, maxzoom: 0,
    bounds: '-24,28,22,58', center: '-1,43,3',
    layers, vector_layers: vectorLayers, tile: [0, 0, 0],
    population_unit: 'invented people/km²',
    migration_unit: 'invented people across the whole epoch interval',
    geometry_encoding: { projection: 'Web Mercator', extent, tolerance: 0, interpolation: false },
  };
  const tileBytes = fromGeojsonVt(tileLayers, { version: 2, extent });
  const tilePath = join(build, `${stem}.mvt`);
  const metadataPath = join(build, `${stem}.metadata.json`);
  const archivePath = join(output, `${stem}.pmtiles`);
  await writeFile(tilePath, tileBytes);
  await writeFile(metadataPath, JSON.stringify(metadata));
  const python = process.env.FIXTURE_PYTHON || join(build, 'venv/bin/python');
  const written = spawnSync(python, [join(app, 'scripts/build-fixture-pmtiles.py'), tilePath, metadataPath, archivePath], {
    encoding: 'utf8', env: { ...process.env, TMPDIR: join(build, 'tmp'), PYTHONDONTWRITEBYTECODE: '1' },
  });
  if (written.error || written.status !== 0) throw new Error(written.error?.message || written.stderr || 'PMTiles writer failed.');
  const bytes = await readFile(archivePath);
  if (bytes.length > budget.bytesPerArchive) throw new Error('Archive byte budget exceeded.');
  const archive = new PMTiles({
    getKey: () => archivePath,
    getBytes: async (offset, length) => ({ data: Uint8Array.from(bytes.subarray(offset, offset + length)).buffer }),
  });
  const header = await archive.getHeader();
  const decodedMetadata = await archive.getMetadata();
  if (header.specVersion !== 3 || header.numAddressedTiles !== 1 || decodedMetadata.epoch_id !== epoch.epoch_id) {
    throw new Error('PMTiles reader verification failed.');
  }
  const decodedBytes = await archive.getZxy(0, 0, 0);
  if (!decodedBytes) throw new Error('Archive is missing its fixture tile.');
  const decoded = new VectorTile(new Pbf(new Uint8Array(decodedBytes.data)));
  const counts = {};
  for (const layer of layers) {
    const decodedLayer = decoded.layers[layer];
    counts[layer] = decodedLayer?.length ?? 0;
    if (counts[layer] !== collections[layer].features.length || decodedLayer.extent !== extent) throw new Error(`Decoded ${layer} mismatch.`);
    for (let i = 0; i < decodedLayer.length; i++) {
      const feature = decodedLayer.feature(i).toGeoJSON(0, 0, 0);
      const expected = collections[layer].features[i];
      if (feature.geometry.type !== expected.geometry.type || JSON.stringify(feature.properties) !== JSON.stringify(expected.properties)) {
        throw new Error(`Decoded ${layer} identity, values, or geometry type changed.`);
      }
    }
  }
  manifest.epochs.push({
    epoch_id: epoch.epoch_id, t_start: epoch.t_start, t_end: epoch.t_end,
    url: `./${stem}.pmtiles`, sha256: sha256(bytes), byte_length: bytes.length,
    layers, tile: [0, 0, 0],
  });
  results.push({ epoch_id: epoch.epoch_id, bytes: bytes.length, sha256: sha256(bytes), counts });
}
await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
const report = {
  schema_version: 1, edition: input.edition, synthetic: true,
  input_sha256: sha256(inputBytes),
  pinned_tools: { pmtiles_python: '3.8.1', geojson_vt: '4.0.3', maplibre_vt_pbf: '4.3.2', pmtiles_js: '4.5.0', mapbox_vector_tile: '2.0.5', pbf: '4.0.2' },
  budget, actual_total_bytes: results.reduce((sum, r) => sum + r.bytes, 0),
  encoding: { tiles: [0, 0, 0], extent, tolerance: 0, buffer: 0, interpolation: false },
  verification: 'Decoded with official PMTiles JS and @mapbox/vector-tile; all identities, properties, geometry types, layer counts, and intervals preserved.',
  archives: results,
};
await writeFile(join(output, 'build-record.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
