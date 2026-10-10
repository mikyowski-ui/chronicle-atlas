import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createPopulationLookup, loadPopulationLookup, type PopulationLookupDocument } from '../src/population-lookup.ts';

const geometryHash = '1'.repeat(64);
const measure = { population: 123, areaKm2: 10, coveredAreaKm2: 8, coverageFraction: .8, status: 'partial' as const, reason: null };
function sample(): PopulationLookupDocument {
  return { schema_version: 1, edition: 'test-edition', entries: [{
    key: ['test-edition','aster','aster-01',geometryHash,'density-v1','950-epoch','method-v1'],
    t_start: 10, t_end: 20, historical: { ...measure }, fixed: { ...measure },
    referenceLabel: 'Fixed reference', observationDateLabel: '950 CE', methodology: 'Compiled synthetic density.',
    notes: [], source: { source_title: 'Fixture', source_edition: 'v1', source_url: './fixture', license: 'Synthetic', attribution: 'Chronicle' },
  }] };
}
const scene = { edition: 'test-edition', time: 15, geometry_hashes: { 'aster|aster-01': geometryHash } };

test('population lookup refuses stale edition, state, geometry and dates', () => {
  const lookup = createPopulationLookup(sample());
  assert.equal(lookup.forScene(scene, 'aster', 'aster-01')?.historical.population, 123);
  assert.equal(lookup.forScene({ ...scene, edition: 'other' }, 'aster', 'aster-01'), null);
  assert.equal(lookup.forScene(scene, 'aster', 'aster-02'), null);
  assert.equal(lookup.forScene({ ...scene, geometry_hashes: { 'aster|aster-01': '2'.repeat(64) } }, 'aster', 'aster-01'), null);
  assert.equal(lookup.forScene({ ...scene, time: 20 }, 'aster', 'aster-01'), null);
  assert.equal(lookup.forScene({ ...scene, time: 9 }, 'aster', 'aster-01'), null);
});

test('population lookup copies records and rejects overlapping observations', () => {
  const input = sample(); const lookup = createPopulationLookup(input);
  input.entries[0].historical.population = 999;
  assert.equal(lookup.forScene(scene, 'aster', 'aster-01')?.historical.population, 123);
  assert.throws(() => createPopulationLookup({ ...input, entries: [...input.entries, {
    ...input.entries[0], key: [...input.entries[0].key.slice(0, 5), '951-epoch', 'method-v1'],
  }] }), /Ambiguous/);
});

test('seven-part population key and bounded numeric values are required', () => {
  const input = sample();
  assert.throws(() => createPopulationLookup({ ...input, entries: [{ ...input.entries[0], key: input.entries[0].key.slice(0, 6) }] }));
  input.entries[0].fixed.population = Infinity;
  assert.throws(() => createPopulationLookup(input));
  assert.throws(() => createPopulationLookup({ ...sample(), entries: Array(161).fill(sample().entries[0]) }));
});

test('lookup sidecar verifies length and hash before returning a record', async () => {
  const bytes = Buffer.from(JSON.stringify(sample()));
  const descriptor = { byte_length: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  const url = `data:application/json;base64,${bytes.toString('base64')}`;
  assert.equal((await loadPopulationLookup(url, descriptor)).forScene(scene, 'aster', 'aster-01')?.fixed.population, 123);
  await assert.rejects(loadPopulationLookup(url, { ...descriptor, sha256: '0'.repeat(64) }), /hash/);
  await assert.rejects(loadPopulationLookup(url, { ...descriptor, byte_length: bytes.length - 1 }), /length/);
});

test('runtime population module contains no geometry or clipping imports', async () => {
  const source = await readFile(new URL('../src/population-lookup.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /from ['"].*(?:population\.ts|polygon-clipping|jsts|geojson)/);
  assert.doesNotMatch(source, /\b(?:estimatePopulation|comparePopulation|intersectionArea|clipRing)\s*\(/);
});

test('real observation retains source scope and exact migration interval', async () => {
  const [population, migration] = await Promise.all(['population-observation.json','migration-observation.json'].map(async name =>
    JSON.parse(await readFile(new URL(`../public/people/${name}`, import.meta.url), 'utf8'))));
  assert.equal(population.population, 32_249_200);
  assert.equal(population.observation_date, '1900-midyear');
  assert.equal(population.geographic_scope, 'England and Wales');
  assert.match(population.coverage_relation, /not its full population/);
  assert.equal(migration.t_start, -44913);
  assert.equal(migration.t_end, -44883);
  assert.equal(migration.magnitude, 27012);
  assert.match(migration.geometry_precision, /Schematic/);
  assert.equal(migration.geometry.coordinates.length, 2);
});

test('delivered sidecars match hashes and keep synthetic and regional observations separate', async () => {
  const manifest = JSON.parse(await readFile(new URL('../public/people/manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.datasets.length, 2);
  for (const descriptor of manifest.datasets) {
    const bytes = await readFile(new URL(`../public/people/${descriptor.url}`, import.meta.url));
    assert.equal(bytes.length, descriptor.byte_length);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), descriptor.sha256);
    const document = JSON.parse(bytes.toString()) as PopulationLookupDocument;
    const lookup = createPopulationLookup(document);
    assert.equal(lookup.edition, descriptor.edition);
    assert.equal(lookup.size, descriptor.edition.startsWith('meridian') ? 6 : 1);
    for (const row of document.entries) {
      const [edition, entity, state, geometry] = row.key;
      const actual = lookup.forScene({ edition, time: row.t_start, geometry_hashes: { [`${entity}|${state}`]: geometry } }, entity, state);
      assert.equal(actual?.fixed.population, row.fixed.population);
      if (edition.startsWith('isles')) {
        assert.equal(actual?.historical.population, null);
        assert.equal(actual?.fixed.status, 'regional-reference');
        assert.equal(actual?.fixed.population, 32_249_200);
        assert.equal(actual?.fixed.areaKm2, null);
        assert.equal(actual?.fixed.coverageFraction, null);
      } else assert.match(entity, /^synthetic:/);
    }
  }
});
