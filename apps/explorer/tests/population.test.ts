import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PopulationFeature, SceneSnapshot, TerritoryFeature } from '../../../packages/contracts/src/index.ts';
import { comparePopulation, estimatePopulation, FIXTURE_REFERENCE_TERRITORIES } from '../src/population.ts';

function rectangle(west: number, south: number, east: number, north: number): number[][] {
  return [[west, south], [east, south], [east, north], [west, north], [west, south]];
}
function territory(ring: number[][], id = 'entity', holes: number[][][] = []): TerritoryFeature {
  return { type: 'Feature', properties: { entity_id: id, render_id: id, territory_state_id: `${id}:state`, t_start: 0, t_end: 20 },
    geometry: { type: 'Polygon', coordinates: [ring, ...holes] } };
}
function density(ring: number[][], value: number): PopulationFeature {
  return { type: 'Feature', properties: { render_id: `density:${value}`, density: value, t_start: 0, t_end: 20 },
    geometry: { type: 'Polygon', coordinates: [ring] } };
}
function scene(territories: TerritoryFeature[], population: PopulationFeature[]): SceneSnapshot {
  return { generation: 1, time: 5, epoch_id: 'test', edition: 'synthetic-test', territories, population, migration: [] };
}
function close(actual: number, expected: number, relativeTolerance = 1e-9): void {
  assert.ok(Math.abs(actual - expected) <= Math.max(1, Math.abs(expected)) * relativeTolerance, `${actual} ≈ ${expected}`);
}

test('expanding a border changes historical population without changing the fixed-area measure', () => {
  const original = territory(rectangle(0, 0, 1, 1));
  const expanded = territory(rectangle(0, 0, 2, 1));
  const cells = [density(rectangle(0, 0, 2, 1), 10)];
  const before = comparePopulation('entity', scene([original], cells), [original]);
  const after = comparePopulation('entity', scene([expanded], cells), [original]);
  close(after.historical.population!, before.historical.population! * 2);
  close(after.fixed.population!, before.fixed.population!);
  close(after.fixed.areaKm2, before.fixed.areaKm2);
  assert.equal(after.historical.status, 'complete');
});

test('growth in density changes both population estimates while the fixed area stays constant', () => {
  const original = territory(rectangle(0, 0, 1, 1));
  const expanded = territory(rectangle(0, 0, 2, 1));
  const earlier = comparePopulation('entity', scene([expanded], [density(rectangle(0, 0, 2, 1), 10)]), [original]);
  const later = comparePopulation('entity', scene([expanded], [density(rectangle(0, 0, 2, 1), 30)]), [original]);
  close(later.fixed.population!, earlier.fixed.population! * 3);
  close(later.historical.population!, earlier.historical.population! * 3);
  close(later.fixed.areaKm2, earlier.fixed.areaKm2);
});

test('partial density coverage is a subtotal and never extrapolates to the full footprint', () => {
  const estimate = estimatePopulation([territory(rectangle(0, 0, 2, 1))], [density(rectangle(0, 0, 1, 1), 10)]);
  assert.equal(estimate.status, 'partial');
  close(estimate.coverageFraction, 0.5);
  close(estimate.population!, estimate.coveredAreaKm2 * 10);
  assert.notEqual(estimate.population, estimate.areaKm2 * 10);
});

test('holes are subtracted regardless of winding, and all disjoint islands contribute', () => {
  const hole = rectangle(1, 1, 2, 2);
  const hollow = territory(rectangle(0, 0, 3, 3), 'entity', [hole]);
  const island = territory(rectangle(4, 0, 5, 1));
  const cells = [density(rectangle(0, 0, 5, 3), 7)];
  const expectedArea = estimatePopulation([territory(rectangle(0, 0, 3, 3)), island], cells).areaKm2 -
    estimatePopulation([territory(hole)], cells).areaKm2;
  const estimate = estimatePopulation([hollow, island], cells);
  close(estimate.areaKm2, expectedArea);
  close(estimate.population!, expectedArea * 7);
  hollow.geometry.coordinates[1].reverse();
  close(estimatePopulation([hollow, island], cells).population!, estimate.population!);
});

test('concave polygon clipping retains separated intersections without filling the gap', () => {
  // U-shaped footprint; the horizontal cell intersects only the two arms.
  const u = territory([[0, 0], [3, 0], [3, 3], [2, 3], [2, 1], [1, 1], [1, 3], [0, 3], [0, 0]]);
  const cell = density(rectangle(0, 2, 3, 3), 2);
  const actual = estimatePopulation([u], [cell]);
  const expected = estimatePopulation([territory(rectangle(0, 2, 1, 3)), territory(rectangle(2, 2, 3, 3))], [cell]);
  close(actual.population!, expected.population!);
  close(actual.coveredAreaKm2, expected.coveredAreaKm2);
});

test('missing density or an uncovered region is unavailable, but measured zero remains zero', () => {
  const footprint = [territory(rectangle(0, 0, 1, 1))];
  assert.equal(estimatePopulation(footprint, []).population, null);
  assert.equal(estimatePopulation(footprint, [density(rectangle(2, 2, 3, 3), 10)]).population, null);
  const zero = estimatePopulation(footprint, [density(rectangle(0, 0, 1, 1), 0)]);
  assert.equal(zero.population, 0);
  assert.equal(zero.status, 'complete');
});

test('overlapping cells fail closed instead of double-counting people', () => {
  const estimate = estimatePopulation([territory(rectangle(0, 0, 2, 2))], [
    density(rectangle(0, 0, 2, 2), 10), density(rectangle(1, 1, 2, 2), 20),
  ]);
  assert.equal(estimate.population, null);
  assert.match(estimate.reason!, /Overlapping density/);
});

test('population weights spherical area rather than treating degrees as equal areas', () => {
  const equator = estimatePopulation([territory(rectangle(0, 0, 1, 1))], [density(rectangle(0, 0, 1, 1), 1)]);
  const north = estimatePopulation([territory(rectangle(0, 60, 1, 61))], [density(rectangle(0, 60, 1, 61), 1)]);
  close(north.population! / equator.population!, (Math.sin(61 * Math.PI / 180) - Math.sin(60 * Math.PI / 180)) / Math.sin(Math.PI / 180));
});

test('longitude-seam rectangles use their narrow footprint', () => {
  const seam = territory(rectangle(179, 0, -179, 1));
  const actual = estimatePopulation([seam], [density(rectangle(179, 0, -179, 1), 10)]);
  const expected = estimatePopulation([territory(rectangle(0, 0, 2, 1))], [density(rectangle(0, 0, 2, 1), 10)]);
  assert.equal(actual.status, 'complete');
  close(actual.population!, expected.population!);
});

test('the authored fixture reference is stable after its historical interval ends', () => {
  const part = FIXTURE_REFERENCE_TERRITORIES.find(part => part.properties.entity_id === 'synthetic:aster')!;
  const after = { ...part, properties: { ...part.properties, t_start: -336023, t_end: -299499 } };
  const cell = density(rectangle(-19, 38, -15, 42), 27);
  cell.properties.t_start = -336023; cell.properties.t_end = -299499;
  const committed = { ...scene([after], [cell]), time: -336023 };
  const comparison = comparePopulation('synthetic:aster', committed);
  assert.equal(comparison.referenceLabel, '950 CE footprint');
  assert.ok(comparison.fixed.population! > 0);
  close(comparison.fixed.areaKm2, comparison.historical.areaKm2);
});

test('real-data identifiers do not inherit the synthetic fixed area or density', () => {
  const real = territory(rectangle(-8, 50, 0, 59), 'historical:britain');
  const comparison = comparePopulation('historical:britain', { ...scene([real], []), edition: 'real-candidate' });
  assert.equal(comparison.historical.population, null);
  assert.equal(comparison.fixed.population, null);
  assert.equal(comparison.fixed.areaKm2, 0);
});
