import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SceneSnapshot } from '../../../packages/contracts/src/index.ts';
import { sceneRenderSignature } from '../src/scene-signature.ts';

function scene(): SceneSnapshot {
  return {
    generation: 1, epoch_id: 'two-changes-one-year', edition: 'pinned-edition', time: 10,
    territories: [], population: [], migration: [],
    stream: { url: 'https://example.test/fixture.pmtiles', sha256: 'a'.repeat(64), byte_length: 127,
      integrity: { chunk_size: 16384, sha256: ['b'.repeat(64)] }, minzoom: 0, maxzoom: 7,
      source_layers: ['territories'], bounds: [-10, 40, 10, 60] },
    parts: [{ properties: { entity_id: 'aster', render_id: 'aster:west', territory_state_id: 'aster:1', t_start: 0, t_end: 20 }, areaKm2: 25, geometry_hash: 'c'.repeat(64) }],
    entities: { aster: { name: 'Aster', color: '#aaccdd', number: '01' } },
  };
}

test('fully indexed unchanged political days reuse their source despite a new date/generation', () => {
  const before = scene(), after = { ...before, generation: 2, time: 19 };
  assert.equal(sceneRenderSignature(before), sceneRenderSignature(after));
  assert.notEqual(sceneRenderSignature(before), sceneRenderSignature({ ...after, time: 20 }));
});

test('identity, display geometry, edition and paint changes invalidate source reuse', () => {
  const before = scene();
  for (const changed of [
    { ...before, edition: 'another-edition' },
    { ...before, parts: before.parts!.map(part => ({ ...part, geometry_hash: 'd'.repeat(64) })) },
    { ...before, parts: before.parts!.map(part => ({ ...part, properties: { ...part.properties, territory_state_id: 'aster:2' } })) },
    { ...before, entities: { aster: { ...before.entities!.aster, color: '#ffffff' } } },
    { ...before, stream: { ...before.stream!, sha256: 'd'.repeat(64) } },
  ]) assert.notEqual(sceneRenderSignature(before), sceneRenderSignature(changed));
});

test('population and migration changes within an epoch cannot reuse political-only readiness', () => {
  const before = scene();
  before.population = [{ type: 'Feature', properties: { render_id: 'population', t_start: 0, t_end: 11, density: 40 }, geometry: { type: 'Polygon', coordinates: [[[0, 40], [1, 40], [1, 41], [0, 40]]] } }];
  before.migration = [{ type: 'Feature', properties: { render_id: 'movement', t_start: 0, t_end: 12, magnitude: 100 }, geometry: { type: 'LineString', coordinates: [[0, 40], [1, 41]] } }];
  assert.equal(sceneRenderSignature(before), sceneRenderSignature({ ...before, time: 9 }));
  assert.notEqual(sceneRenderSignature(before), sceneRenderSignature({ ...before, time: 11 }));
  assert.notEqual(sceneRenderSignature(before), sceneRenderSignature({ ...before, time: 12 }));
  assert.notEqual(sceneRenderSignature(before), sceneRenderSignature({ ...before, population: before.population.map(feature => ({ ...feature, properties: { ...feature.properties, density: 80 } })) }));
  assert.notEqual(sceneRenderSignature(before), sceneRenderSignature({ ...before, migration: before.migration.map(feature => ({ ...feature, geometry: { ...feature.geometry, coordinates: [[0, 40], [2, 42]] } })) }));
});

test('unindexed native overlays conservatively retain time in the signature', () => {
  const before = scene(); before.stream = { ...before.stream!, source_layers: ['territories', 'population', 'migration'] };
  assert.notEqual(sceneRenderSignature(before), sceneRenderSignature({ ...before, generation: 2, time: 11 }));
  assert.equal(sceneRenderSignature(before), sceneRenderSignature({ ...before, generation: 2 }));
});


test('independent overlay validity uses requested time while reference politics stay exactly dated', () => {
  const before = scene();
  before.overlayTime = 100;
  before.supplement = { stream: { ...before.stream!, url: 'https://example.test/migration.pmtiles', sha256: 'e'.repeat(64), source_layers: ['migration'] }, edition: before.edition, time: 100 };
  before.migration = [{ type: 'Feature', properties: { render_id: 'movement', t_start: 100, t_end: 110, magnitude: 100 }, geometry: { type: 'LineString', coordinates: [[0, 40], [1, 41]] } }];
  assert.equal(sceneRenderSignature(before), sceneRenderSignature({ ...before, overlayTime: 109, supplement: { ...before.supplement, time: 109 } }));
  assert.notEqual(sceneRenderSignature(before), sceneRenderSignature({ ...before, overlayTime: 110 }));
  assert.notEqual(sceneRenderSignature(before), sceneRenderSignature({ ...before, supplement: { ...before.supplement, stream: { ...before.supplement.stream, sha256: 'f'.repeat(64) } } }));
  assert.notEqual(sceneRenderSignature(before), sceneRenderSignature({ ...before, supplement: { ...before.supplement, edition: 'different-recorded-edition' } }));
});

test('hidden native overlays do not force per-day source rebuilds, but enabling them restores eligibility checks', () => {
  const before = scene(); before.stream = { ...before.stream!, source_layers: ['territories', 'population', 'migration'] };
  const after = { ...before, generation: 2, time: 11 };
  assert.equal(sceneRenderSignature(before, { population: false, migration: false }), sceneRenderSignature(after, { population: false, migration: false }));
  assert.notEqual(sceneRenderSignature(before, { population: true, migration: false }), sceneRenderSignature(after, { population: true, migration: false }));
});
