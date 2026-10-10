/** Run after build-alpha: node --import tsx scripts/build-population-lookups.mjs */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { comparePopulation, estimatePopulation } from '../src/population.ts';
import { createPopulationLookup } from '../src/population-lookup.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const alpha = join(root, 'public/alpha');
const output = join(root, 'public/people');
const started = performance.now();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const inputs = [];
async function retainedBytes(path) {
  const bytes = await readFile(path); inputs.push({ path: path.slice(root.length), sha256: hash(bytes), byte_length: bytes.length });
  return bytes;
}
async function read(path) {
  const bytes = await retainedBytes(path);
  return JSON.parse(bytes.toString());
}
const observation = await read(join(output, 'population-observation.json'));
const workbook = await retainedBytes(join(output, 'source/ons-ew-1838-2025.xlsx'));
if (hash(workbook) !== observation.input_sha256) throw new Error('Pinned ONS source hash mismatch.');
await retainedBytes(join(root, 'fixtures/meridian-v2.json'));
await retainedBytes(join(root, 'src/population.ts'));
const datasets = [];
let totalBytes = 0, totalEntries = 0;
for (const [name, manifestName, synthetic] of [['meridian', 'fixture', true], ['isles', 'historical', false]]) {
  const manifest = await read(join(alpha, `${manifestName}-manifest.json`));
  const entries = [];
  for (const epoch of manifest.epochs) {
    if (!synthetic && epoch.epoch_id !== 'isles-1900') continue;
    const [geojson, metadata] = await Promise.all([
      read(join(alpha, `${epoch.epoch_id}.geojson.json`)), read(join(alpha, `${epoch.epoch_id}.metadata.json`)),
    ]);
    const sceneMetadata = metadata.scene_metadata ?? metadata;
    const territories = geojson.territories;
    if (!Array.isArray(territories)) throw new Error('Population compiler needs complete, untiled display geometries.');
    const scene = { ...sceneMetadata, edition: manifest.edition, epoch_id: epoch.epoch_id,
      generation: 0, time: epoch.t_start, territories, population: geojson.population ?? [], migration: geojson.migration ?? [] };
    const states = new Map();
    for (const feature of territories) {
      const p = feature.properties;
      if (!synthetic && sceneMetadata.entities?.[p.entity_id]?.name !== 'United Kingdom of Great Britain and Ireland') continue;
      states.set(`${p.entity_id}|${p.territory_state_id}`, p);
    }
    for (const [stateKey, properties] of states) {
      const geometryHash = sceneMetadata.geometry_hashes?.[stateKey] ?? metadata.geometry_hashes?.[stateKey];
      if (!/^[a-f0-9]{64}$/.test(geometryHash ?? '')) throw new Error(`Missing display geometry hash for ${stateKey}.`);
      const geometries = territories.filter(f => f.properties.entity_id === properties.entity_id &&
        f.properties.territory_state_id === properties.territory_state_id).map(f => f.geometry);
      if (hash(JSON.stringify(geometries)) !== geometryHash) throw new Error(`Display geometry hash mismatch for ${stateKey}.`);
      if (synthetic) {
        const comparison = comparePopulation(properties.entity_id, scene);
        entries.push({
          key: [manifest.edition, properties.entity_id, properties.territory_state_id, geometryHash,
            'meridian-v2-density', String(epoch.t_start), 'spherical-equal-area-rectangles-v1'],
          t_start: epoch.t_start, t_end: epoch.t_end, ...comparison,
          observationDateLabel: `${epoch.epoch_id === 'meridian-950' ? '950–1050' : '1050–1150'} CE synthetic epoch`,
          notes: ['Precomputed from the complete display geometry before tiling.', 'Invented fixture data; covered-area subtotals, not historical measurements.'],
          source: { source_title: 'The Meridian Isles synthetic density fixture', source_edition: 'meridian-v2',
            source_url: './fixtures/meridian-v2.json', license: 'Original synthetic demonstration data',
            attribution: 'Chronicle Atlas fixture authors' },
        });
      } else {
        const area = estimatePopulation(territories.filter(f => f.properties.entity_id === properties.entity_id), []);
        entries.push({
          key: [manifest.edition, properties.entity_id, properties.territory_state_id, geometryHash,
            observation.population_dataset_version, observation.observation_date, observation.method_version],
          t_start: epoch.t_start, t_end: epoch.t_end,
          historical: { ...area, reason: 'No admitted population total for the complete UK territory; the source covers England and Wales only.' },
          fixed: { population: observation.population, areaKm2: null, coveredAreaKm2: null, coverageFraction: null,
            status: 'regional-reference', reason: null },
          referenceLabel: observation.geographic_scope,
          observationDateLabel: 'Mid-1900 · ONS estimate',
          methodology: observation.methodology,
          notes: [observation.coverage_relation, ...observation.limitations],
          source: Object.fromEntries(['source_title','source_edition','source_url','input_sha256','license','attribution'].map(key => [key, observation[key]])),
        });
      }
    }
  }
  if (entries.length !== (synthetic ? 6 : 1)) throw new Error(`Unexpected bounded lookup cardinality: ${entries.length}.`);
  const document = { schema_version: 1, edition: manifest.edition, entries };
  createPopulationLookup(document);
  const bytes = Buffer.from(JSON.stringify(document, null, 2) + '\n');
  totalBytes += bytes.length; totalEntries += entries.length;
  if (totalBytes > 262144 || totalEntries > 160) throw new Error('Frozen population output budget exceeded.');
  if (process.resourceUsage().maxRSS * 1024 > 268435456) throw new Error('Frozen population compiler RSS budget exceeded.');
  const filename = `${name}-lookup.json`;
  await writeFile(join(output, filename), bytes);
  datasets.push({ edition: manifest.edition, url: `./${filename}`, sha256: hash(bytes), byte_length: bytes.length, entries: entries.length });
}
await writeFile(join(output, 'manifest.json'), JSON.stringify({ schema_version: 1, datasets }, null, 2) + '\n');
await writeFile(join(output, 'build-record.json'), JSON.stringify({
  schema_version: 1, method: 'compile-only intersection; runtime lookup by exact seven-field key',
  inputs, datasets, total_entries: totalEntries, total_lookup_bytes: totalBytes,
  elapsed_ms: Math.round(performance.now() - started), peak_rss_bytes: process.resourceUsage().maxRSS * 1024,
  public_ledger_mutation: false,
}, null, 2) + '\n');
console.log(JSON.stringify({ entries: totalEntries, lookupBytes: totalBytes, datasets }));
