/** One bounded world observation, using the existing Alpha display/PMTiles path.
 * Inputs/rights/budget must already be pinned. Never reads or writes the ledger.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import geojsonvt from 'geojson-vt';
import { fromGeojsonVt } from '@maplibre/vt-pbf';
import { PMTiles } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader.js';
import IsValidOp from 'jsts/org/locationtech/jts/operation/valid/IsValidOp.js';
import InteriorPointArea from 'jsts/org/locationtech/jts/algorithm/InteriorPointArea.js';
import { validateAlphaManifest, validateAlphaMetadata } from '../src/alpha.ts';

const app = fileURLToPath(new URL('../', import.meta.url));
const out = join(app, 'public/integrated'), build = join(app, '.sites-runtime/integrated-world');
const read = async path => JSON.parse(await readFile(path, 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async (path, value) => writeFile(path, JSON.stringify(value) + '\n');
const budgetBytes = await readFile(join(out, 'resource-budget.json'));
const budget = JSON.parse(budgetBytes), limits = budget.limits, encoding = budget.encoding;
const inventory = await read(join(out, 'source-inventory.json'));
const baselineUsage = (await read(join(app, 'public/alpha/build-record.json'))).cumulative_archives_bytes;
if (!Number.isSafeInteger(baselineUsage) || baselineUsage < 0 || baselineUsage + limits.new_compressed_bytes > limits.cumulative_compressed_bytes) throw Error('Frozen new allowance cannot fit the retained aggregate compressed budget');
if (sha(budgetBytes) !== inventory.budget_sha256) throw Error('Frozen budget hash differs');
for (const [name, hash] of Object.entries(inventory.retained_hashes)) {
  if (sha(await readFile(join(out, 'source', name))) !== hash) throw Error('Pinned source changed: ' + name);
}
await mkdir(build, { recursive: true });
const began = performance.now(), reports = [];
let totalBytes = 0, peakRss = 0;
const bounds = [-180, -85.05112878, 180, 85.05112878];
function check(started) {
  peakRss = Math.max(peakRss, process.resourceUsage().maxRSS * 1024);
  if (peakRss > limits.process_rss_bytes) throw Error('Frozen RSS budget exceeded');
  if (performance.now() - started > limits.worker_deadline_ms) throw Error('Frozen 60s sequential batch deadline exceeded');
}
async function asset(path) {
  const bytes = await readFile(path);
  return { url: './' + path.split('/').at(-1), sha256: sha(bytes), byte_length: bytes.length };
}
function areaKm2(geometry) {
  const rad = Math.PI / 180, radius = 6371.0088;
  const areas = geometry.coordinates.map(ring => {
    let sum = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      let delta = ring[i + 1][0] - ring[i][0];
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      sum += delta * rad * (2 + Math.sin(ring[i][1] * rad) + Math.sin(ring[i + 1][1] * rad));
    }
    return Math.abs(sum) * radius * radius / 2;
  });
  return Math.max(0, areas[0] - areas.slice(1).reduce((a, b) => a + b, 0));
}
async function archive(stem, layers, identity) {
  const started = performance.now(), dir = join(build, stem);
  await mkdir(dir, { recursive: true });
  const names = Object.keys(layers), expected = Object.fromEntries(names.map(name => [name, new Map(layers[name].features.map(f => [f.properties.render_id, f.properties]))]));
  const indices = Object.fromEntries(names.map(name => [name, geojsonvt(layers[name], { ...encoding, maxZoom: encoding.maxzoom, indexMaxZoom: 0, indexMaxPoints: 0 })]));
  const entries = [], tileCounts = {}, vertexCounts = {}, seen = new Set();
  for (let z = 0; z <= encoding.maxzoom; z++) {
    tileCounts[z] = vertexCounts[z] = 0;
    for (let x = 0; x < 2 ** z; x++) for (let y = 0; y < 2 ** z; y++) {
      const tileLayers = {};
      for (const name of names) {
        const tile = indices[name].getTile(z, x, y);
        if (tile?.features.length) tileLayers[name] = tile;
      }
      if (!Object.keys(tileLayers).length) continue;
      const bytes = fromGeojsonVt(tileLayers, { version: 2, extent: encoding.extent });
      if (bytes.length > limits.tile_bytes) throw Error('Tile byte cap exceeded');
      const decoded = new VectorTile(new Pbf(bytes));
      for (const name of names) {
        const layer = decoded.layers[name];
        if (!layer) continue;
        for (let i = 0; i < layer.length; i++) {
          const feature = layer.feature(i), props = expected[name].get(feature.properties.render_id);
          if (!props || Object.entries(props).some(([k, value]) => value != null && feature.properties[k] !== value)) throw Error('MVT canonical identity changed');
          vertexCounts[z] += feature.loadGeometry().reduce((n, ring) => n + ring.length, 0);
          if (z === encoding.maxzoom) seen.add(feature.properties.render_id);
        }
      }
      const path = `${z}-${x}-${y}.mvt`;
      await writeFile(join(dir, path), bytes);
      entries.push({ tile: [z, x, y], path }); tileCounts[z]++;
    }
    check(started);
  }
  if (entries.length > limits.tiles_per_archive) throw Error('Tile count cap exceeded');
  await json(join(dir, 'index.json'), entries);
  await json(join(dir, 'metadata.json'), { ...identity, format: 'pbf', type: 'overlay', minzoom: 0, maxzoom: encoding.maxzoom, bounds: bounds.join(','), bounds_array: bounds, geometry_encoding: encoding, vector_layers: names.map(id => ({ id, minzoom: 0, maxzoom: encoding.maxzoom, fields: { render_id: 'String', entity_id: 'String', territory_state_id: 'String', fill_color: 'String' } })) });
  const target = join(out, stem + '.pmtiles');
  const child = spawnSync(join(app, '.sites-runtime/fixture-build/venv/bin/python'), [join(app, 'scripts/build-alpha-pmtiles.py'), join(dir, 'index.json'), join(dir, 'metadata.json'), target], { encoding: 'utf8', timeout: limits.worker_deadline_ms, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  if (child.error || child.status !== 0) throw Error(child.error?.message || child.stderr);
  const bytes = await readFile(target), hash = sha(bytes), filename = `${stem}.${hash}.pmtiles`;
  if (bytes.length > limits.archive_bytes) throw Error(`Archive exceeds frozen 1MB cap: ${bytes.length}`);
  await rename(target, join(out, filename)); totalBytes += bytes.length;
  if (totalBytes > limits.new_compressed_bytes) throw Error('Aggregate new compressed cap exceeded');
  const pm = new PMTiles({ getKey: () => filename, getBytes: async (offset, count) => ({ data: Uint8Array.from(bytes.subarray(offset, offset + count)).buffer }) });
  const header = await pm.getHeader();
  if (header.specVersion !== 3 || header.numAddressedTiles !== entries.length || header.maxZoom !== encoding.maxzoom) throw Error('PMTiles header round-trip mismatch');
  for (const row of [entries[0], entries[Math.floor(entries.length / 2)], entries.at(-1)]) {
    const back = await pm.getZxy(...row.tile);
    if (!back || sha(new Uint8Array(back.data)) !== sha(await readFile(join(dir, row.path)))) throw Error('PMTiles spatial round-trip mismatch');
  }
  check(started);
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 16384) chunks.push(sha(bytes.subarray(offset, offset + 16384)));
  reports.push({ id: stem, bytes: bytes.length, sha256: hash, tiles: entries.length, tile_counts: tileCounts, vertices_by_zoom: vertexCounts, maxzoom_render_ids: seen.size, subpixel_parts_at_maxzoom: [...expected[names[0]].keys()].filter(id => !seen.has(id)), elapsed_ms: performance.now() - started });
  return { url: './' + filename, sha256: hash, byte_length: bytes.length, minzoom: 0, maxzoom: encoding.maxzoom, bounds, source_layers: names, integrity: { chunk_size: 16384, sha256: chunks } };
}

const landBuild = spawnSync('python3', [join(app, 'scripts/build-integrated-world-land.py')], { encoding: 'utf8', timeout: limits.worker_deadline_ms, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
if (landBuild.error || landBuild.status !== 0) throw Error(landBuild.error?.message || landBuild.stderr);
const land = await read(join(out, 'global-land.geojson.json'));
const landRights = await read(join(out, 'source/natural-earth-rights.json'));
const base = { edition: 'natural-earth-50m-land-4.1.0-global-v1', source: landRights, stream: await archive('global-physical-land', { land }, { edition: 'natural-earth-50m-land-4.1.0-global-v1', name: 'Global neutral physical context', attribution: landRights.attribution }), fallback: await asset(join(out, 'global-land.geojson.json')) };
await json(join(out, 'global-base.json'), base);

const started = performance.now();
const source = await read(join(out, 'source/world_1900.geojson'));
const mapping = await read(join(out, 'source/world_1900-mappings.json'));
const isles = await read(join(app, 'public/alpha/isles-1900.metadata.json'));
const edition = 'world-1900-da7a4b7-display-v1', epochId = 'world-overview-1900', start = -25567, end = -25202;
const recorded = '2026-09-23T00:00:00.000Z';
const territory = [], entities = {}, evidence = {}, labels = [], parts = [], groups = {}, aliases = [], queue = [], admitted = [];
const shared = new Map(Object.entries(isles.entities).map(([id, e]) => [e.name, { id, ...e }]));
const reader = new GeoJSONReader(), bestLabel = new Map();
const method = 'Separate direct-source display geometry, independent of immutable 0.5° audit mesh. No temporal interpolation or smoothing; zoom simplification is cartographic only. Full source polygons and holes retained in Canvas fallback.';
for (const row of mapping.mappings) {
  const feature = source.features[row.feature_index], name = row.original_properties.NAME;
  if (row.source_file_sha256 !== inventory.historical_source.sha256 || JSON.stringify(feature.properties) !== JSON.stringify(row.original_properties)) throw Error('Mapping/source mismatch');
  if (row.decision !== 'political-association' || /Hawai[ʻiian]/i.test(name ?? '')) {
    queue.push({ source_feature_index: row.feature_index, name, decision: row.decision, rule: row.rule, rationale: row.rationale, source_properties: row.original_properties }); continue;
  }
  let jts;
  try {
    jts = reader.read(feature.geometry);
    const valid = new IsValidOp(jts);
    if (!valid.isValid()) throw Error(String(valid.getValidationError()));
  } catch (error) {
    queue.push({ source_feature_index: row.feature_index, name, decision: 'review-queue', rule: 'invalid-source-topology', rationale: error.message }); continue;
  }
  const alias = shared.get(name), entity = alias?.id ?? 'world:political:' + sha(name).slice(0, 20);
  const state = 'world-source:' + sha(`${inventory.historical_source.sha256}:${row.feature_index}`).slice(0, 32);
  const hue = parseInt(sha(entity).slice(0, 6), 16);
  const color = alias?.color ?? '#' + [90 + (hue & 127), 80 + ((hue >> 7) & 127), 85 + ((hue >> 14) & 127)].map(v => Math.min(230, v).toString(16).padStart(2, '0')).join('');
  entities[entity] ??= { name, color, number: String(Object.keys(entities).length + 1).padStart(2, '0'), kind: 'political' };
  if (alias && !aliases.some(x => x.entity_id === entity)) aliases.push({ exact_source_name: name, entity_id: entity, reason: 'Exact retained1900 source NAME matches existing Isles entity; shared intent/style only, independent display-state/geometry identity.' });
  evidence[state] = { assertion_ids: [state], source_title: inventory.historical_rights.title, source_edition: 'overview:da7a4b7:world_1900.geojson', source_url: 'https://github.com/aourednik/historical-basemaps/blob/da7a4b735ecef70aebdc9c73e409d8a2500d50f3/geojson/world_1900.geojson', license: 'GPL-3.0', attribution: 'André Ourednik and Historical Basemaps contributors; bounded source classification and display compilation by Chronicle', valid_from: start, valid_to: end, recorded_from: recorded, recorded_to: null, valid_extent: { precision: 'year', start: { earliest: start, latest: end - 1 }, end: { earliest: start + 1, latest: end }, sourceText: 'Nominal1900 source snapshot; possible annual observation window, not event dates or daily historical continuity.' }, methodology: [row.rationale, method, 'Source NAME is a source-attributed territorial association, not independent sovereignty or effective-control certification. SUBJECTO/PARTOF remain uninterpreted source metadata.'], limitations: ['Global overview reconstruction with uncertain source boundaries and incomplete admitted political coverage.', 'No independently authenticated feature-level documentary sources; not scholarly certification.', 'Nominal snapshot year only; no exact onset/cessation or carry-forward historical validity.', 'Small components may be subpixel at overview zoom; full original components remain in the pinned source and Canvas fallback.'] };
  const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  let totalArea = 0;
  for (const [partIndex, coordinates] of polygons.entries()) {
    const geometry = { type: 'Polygon', coordinates };
    const properties = { entity_id: entity, territory_state_id: state, render_id: `world-display:${row.feature_index}:part:${partIndex}`, t_start: start, t_end: end, assertion_id: state, kind: 'political', relation: 'source_attributed_association', status: 'uncertain', source_edition: 'overview:da7a4b7:world_1900.geojson', recorded_from: recorded, recorded_to: '', pick_priority: 2, geometry_role: 'source-display', fill_color: color, source_feature_index: row.feature_index, source_borderprecision: feature.properties.BORDERPRECISION ?? 0 };
    const area = areaKm2(geometry); totalArea += area;
    territory.push({ type: 'Feature', properties, geometry });
    parts.push({ properties, areaKm2: area, geometry_hash: sha(JSON.stringify(geometry)) });
    (groups[`${entity}|${state}`] ??= []).push(geometry);
  }
  const anchor = InteriorPointArea.getInteriorPoint(jts);
  if (anchor && (!bestLabel.has(entity) || bestLabel.get(entity).area < totalArea)) bestLabel.set(entity, { area: totalArea, position: [anchor.x, anchor.y] });
  admitted.push({ source_feature_index: row.feature_index, source_name: name, entity_id: entity, territory_state_id: state, parts: polygons.length, original_geometry_sha256: sha(JSON.stringify(feature.geometry)), repair: 'none; JSTS2.12.1 IsValidOp passed', original_properties: feature.properties });
  check(started);
}
if (territory.length > limits.parts_per_scene) throw Error('Canonical part cap exceeded');
for (const [entity, label] of bestLabel) labels.push({ label_id: 'label:world-1900:' + entity, entity_id: entity, text: entities[entity].name, position: label.position, priority: Math.max(1, Math.min(9, Math.floor(Math.log10(label.area || 1)))) });
const geometry_hashes = Object.fromEntries(Object.entries(groups).map(([key, geometries]) => [key, sha(JSON.stringify(geometries))]));
const metadata = { schema_version: 2, fixture_kind: 'historical-candidate', edition, epoch_id: epochId, t_start: start, t_end: end, parts, geometry_hashes, entities, labels, evidence, migration: [], display_method: method };
const mp = join(out, epochId + '.metadata.json'), fp = join(out, epochId + '.geojson.json');
await json(mp, metadata); await json(fp, { schema_version: 2, edition, epoch_id: epochId, territories: territory, population: [], migration: [] });
if ((await stat(mp)).size > limits.metadata_bytes || (await stat(fp)).size > limits.fallback_bytes) throw Error('Sidecar cap exceeded');
const epoch = { epoch_id: epochId, t_start: start, t_end: end, stream: await archive(epochId, { territories: { type: 'FeatureCollection', features: territory } }, { edition, epoch_id: epochId, t_start: start, t_end: end, name: 'World1900 source-political overview', fixture_kind: 'historical-candidate', attribution: 'André Ourednik and Historical Basemaps contributors — GPL-3.0' }), metadata: await asset(mp), fallback: await asset(fp) };
const manifest = { schema_version: 2, fixture_kind: 'historical-candidate', edition, title: 'World overview · 1900', bounds, recorded_at: recorded, source: inventory.historical_rights, methodology: [method, inventory.temporal_interpretation], initial_time: start, display_product: 'direct-source-vectors-world-v1', base_geography: base, epochs: [epoch] };
const checked = validateAlphaManifest(manifest); validateAlphaMetadata(metadata, checked.epochs[0], checked);
await json(join(out, 'world-manifest.json'), manifest);
if ((await stat(join(out, 'world-manifest.json'))).size > limits.manifest_bytes) throw Error('Manifest cap exceeded');
await json(join(out, 'mapping-record.json'), { schema_version: 1, edition, source_sha256: inventory.historical_source.sha256, classified_source_features: source.features.length, admitted_features: admitted.length, admitted_parts: parts.length, admitted_entities: Object.keys(entities).length, records: admitted, identity_aliases: aliases });
await json(join(out, 'review-queue.json'), { schema_version: 1, source_edition: inventory.historical_rights.pinned_revision, source_sha256: inventory.historical_source.sha256, count: queue.length, records: queue });
await json(join(out, 'catalog.json'), { schema_version: 1, catalog_id: 'integrated-world-isles-v1', publication: 'staged-candidate-only', maximum_routes: 2, physical_context: { descriptor: './global-base.json', edition: base.edition, bounds, meaning: 'Modern neutral land; no historical political or shoreline assertion.' }, routes: [{ route_id: 'isles-detail', manifest: '../alpha/historical-manifest.json', edition: 'isles-alpha-da7a4b7-display-v1', bounds: [-12, 48, 3, 61.5], minzoom: 4, priority: 2 }, { route_id: 'world-overview', manifest: './world-manifest.json', edition, bounds, minzoom: 0, max_source_zoom: 4, priority: 1, supported_observations: [{ year: 1900, t_start: start, t_end: end }] }], precedence: 'Exactly one political route is active: Isles detail when camera center is within its bounds and zoom>=4; otherwise world overview. No simultaneous political painting or picking. Route changes retain selected entity intent through listed shared identities. Unsupported dates remain gaps unless the explicit reference policy shows a separately dated earlier compatible observation; no future reference.', identity_aliases: aliases, missing_coverage: { world_admitted_features: admitted.length, source_features: source.features.length, omitted_features: queue.length, review_queue: './review-queue.json', other_world_dates: 'No political observations admitted; neutral context only.' }, resource_budget: './resource-budget.json' });
const landRecord = await read(join(out, 'land-build-record.json'));
const report = { schema_version: 1, budget_sha256: sha(budgetBytes), encoding, elapsed_ms: performance.now() - began, peak_process_rss_bytes: peakRss, archives_bytes: totalBytes, baseline_cumulative_archives_bytes: baselineUsage, cumulative_archives_bytes: baselineUsage + totalBytes, cumulative_archive_cap: limits.cumulative_compressed_bytes, source_features: source.features.length, admitted_features: admitted.length, admitted_entities: Object.keys(entities).length, admitted_parts: parts.length, omitted_features: queue.length, physical: landRecord, archives: reports, verification: 'All MVTs decoded and stable identities checked; PMTiles headers and first/middle/last spatial entries round-trip checked. Alpha manifest and canonical metadata validated. No browser or GPU execution is claimed.' };
await json(join(out, 'build-record.json'), report);
console.log(JSON.stringify(report));
