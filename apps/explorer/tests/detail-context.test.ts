import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activePlaces, densityColor, nearestDetailPlace, precedingPopulation,
  type DetailPlace,
} from '../src/detail-context.ts';

const place = (id: string, coordinates: [number, number], overrides: Partial<DetailPlace> = {}): DetailPlace => ({
  id, title: id, coordinates, sourceId: 'test-source', sourceUrl: 'https://example.test/source',
  validFromYear: -199, validToYear: 640, rank: 6, temporalMode: 'source-envelope',
  ...overrides,
});

test('settlement relevance uses requested astronomical years and preserves inclusive source envelopes', () => {
  const ancient = place('ancient', [12, 42]);
  const oneBce = place('one-bce', [13, 42], { validFromYear: 0, validToYear: 0 });
  const undated = place('undated', [14, 42], { validFromYear: null, validToYear: null });
  const rows = [ancient, oneBce, undated];
  assert.deepEqual(activePlaces(rows, -200), []);
  assert.deepEqual(activePlaces(rows, -199).map(p => p.id), ['ancient']);
  assert.deepEqual(activePlaces(rows, 0).map(p => p.id), ['ancient', 'one-bce']);
  assert.deepEqual(activePlaces(rows, 1).map(p => p.id), ['ancient']);
  assert.deepEqual(activePlaces(rows, 640).map(p => p.id), ['ancient']);
  assert.deepEqual(activePlaces(rows, 641), []);
  assert.equal(ancient.validToYear, 640, 'looking beyond the envelope must not extend source relevance');
});

test('modern orientation requires its explicit switch at every date and never receives historical validity', () => {
  const ancient = place('ancient', [12, 42]);
  const modern = place('modern', [13, 42], {
    temporalMode: 'modern-context', validFromYear: null, validToYear: null,
  });
  const rows = [ancient, modern];
  for (const year of [-199, 1950, 2010]) {
    assert.ok(!activePlaces(rows, year, false).some(p => p.id === 'modern'));
    assert.ok(activePlaces(rows, year, true).some(p => p.id === 'modern'));
  }
  assert.deepEqual(activePlaces(rows, 2010, true).map(p => p.id), ['modern']);
  assert.equal(modern.validFromYear, null);
  assert.equal(modern.validToYear, null);
});

test('population selects only an exact or preceding observation without interpolation or source reordering', () => {
  const rows = Object.freeze([
    Object.freeze({ year: 2000, total: 100 }),
    Object.freeze({ year: 1900, total: 10 }),
    Object.freeze({ year: 1950, total: 40 }),
  ]);
  assert.equal(precedingPopulation(rows, 1899), undefined);
  assert.equal(precedingPopulation(rows, 1900), rows[1]);
  assert.equal(precedingPopulation(rows, 1949), rows[1]);
  assert.equal(precedingPopulation(rows, 1950), rows[2]);
  assert.equal(precedingPopulation(rows, 1975), rows[2]);
  assert.equal(precedingPopulation(rows, 2001), rows[0]);
  assert.deepEqual(rows.map(r => r.year), [2000, 1900, 1950]);
});

test('density colors preserve one absolute scale rather than rescaling each date or viewport', () => {
  assert.equal(densityColor(null), 'rgba(0,0,0,0)');
  assert.equal(densityColor(0), 'rgba(0,0,0,0)');
  assert.equal(densityColor(1000), 'rgba(113,30,75,0.830)');
  assert.equal(densityColor(2000), densityColor(1000), 'values beyond the fixed legend maximum saturate');
  const reference = densityColor(25);
  [null, 0, 1, 50000, 200, 2].forEach(densityColor);
  assert.equal(densityColor(25), reference, 'other visible cell values cannot alter a density color');
  assert.notEqual(densityColor(25), densityColor(250));
});

test('place picking crosses the date line and retains its bounded screen-space tolerance', () => {
  const acrossSeam = place('across-seam', [-179.9, 0]);
  const sameSide = place('same-side', [179.2, 0]);
  assert.equal(nearestDetailPlace([sameSide, acrossSeam], [179.9, 0], 3600), acrossSeam);
  assert.equal(nearestDetailPlace([acrossSeam], [179.9, 0], 36000), undefined);
  assert.equal(nearestDetailPlace([sameSide], [179.2, 0], 36000), sameSide);
  assert.equal(nearestDetailPlace([], [179.9, 0], 3600), undefined);
});
