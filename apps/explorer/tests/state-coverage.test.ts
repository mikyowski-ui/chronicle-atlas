import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { STATE_COVERAGE, STATE_COVERAGE_STATS, STATE_COVERAGE_SOURCES, searchStateCoverage, findStateCoverage } from '../src/state-coverage';

test('every admitted entity observation has a classified description and resolvable source', () => {
  const sourceIds = new Set(STATE_COVERAGE_SOURCES.map(source => source.id));
  const observationKeys = new Set<string>();
  for (const entry of STATE_COVERAGE) {
    assert.ok(entry.summary.length > 100);
    assert.ok(entry.continuity.includes('not foundation'));
    assert.ok(['political', 'cultural', 'context'].includes(entry.kind));
    for (const observation of entry.observations) {
      assert.notEqual(observation.year, 0);
      assert.ok(sourceIds.has(observation.sourceId));
      const key = `${observation.observationId}|${observation.entityId}`;
      assert.ok(!observationKeys.has(key), key); observationKeys.add(key);
      assert.equal(findStateCoverage({entityId: observation.entityId, observationYear: observation.year, scope: observation.scope})?.entry.id, entry.id);
    }
  }
  assert.equal(observationKeys.size, STATE_COVERAGE_STATS.entityObservations);
  assert.equal(STATE_COVERAGE_STATS.describedEntityObservations, STATE_COVERAGE_STATS.entityObservations);
  assert.equal(STATE_COVERAGE_STATS.observations, 80);
});
test('coverage dates cannot bridge an unobserved year or change cultural labels into states', () => {
  assert.equal(searchStateCoverage('', {atYear: 1415}).length, 0);
  assert.ok(searchStateCoverage('', {atYear: 1400, kind: 'political', scope: 'world'}).length > 50);
  const context = STATE_COVERAGE.find(entry => entry.title === 'Maya city-states');
  assert.equal(context?.kind, 'context');
  assert.equal(context?.historyIds.length, 0);
  assert.equal(findStateCoverage({name: 'Mamluke Sultanate', observationYear: 1415}), undefined);
  assert.equal(findStateCoverage({name: 'The Meridian Isles'}), undefined);
});
test('same source label can resolve different researched phases at different dates', () => {
  const early = findStateCoverage({name: 'Egypt', kind: 'political', observationYear: -3000, scope: 'world'});
  assert.equal(early?.history?.id, 'egypt-early');
  const modern = findStateCoverage({name: 'Egypt', kind: 'political', observationYear: 2010, scope: 'world'});
  assert.equal(modern?.history, undefined);
  assert.notEqual(early?.entry.researchStatus, 'researched-overview');
});

test('source disagreements are visible rather than converted into a tidy state lifespan', () => {
  for (const name of ['White Horde', 'Blue Horde']) {
    const entry = STATE_COVERAGE.find(value => value.title === name)!;
    assert.ok(entry.researchNotes.length);
    assert.ok(entry.summary.includes('Jochid'));
    assert.ok(entry.sources.some(source => source.id === 'nagamine-jochids-2013'));
    assert.equal(entry.historyIds.length, 0);
    for (const note of entry.researchNotes) {
      note.sourceIds.forEach(sourceId => assert.ok(entry.sources.some(source => source.id === sourceId)));
    }
  }
});

test('the active observation list respects existing chronology exclusions while preserving raw source critique', () => {
  const source = findStateCoverage({name: 'Sultanate of Delhi', observationYear: 1200, scope: 'world'});
  assert.ok(source);
  assert.equal(source.observation?.chronologyReview.allowed, false);
  assert.equal(searchStateCoverage('Sultanate of Delhi', {atYear: 1200, scope: 'world'}).length, 0);
  assert.equal(searchStateCoverage('Sultanate of Delhi', {atYear: 1200, scope: 'world', includeSuppressed: true}).length, 1);
});

// Independent input traversal protects against an omitted snapshot or entity in the compiler.
test('coverage includes the actual entities from every cataloged historical metadata file', () => {
  const read = (path: string) => JSON.parse(readFileSync(resolve(import.meta.dirname, '..', path), 'utf8'));
  const world = read('public/global-history/catalog.json');
  const alpha = read('public/alpha/historical-manifest.json');
  const seen = new Set<string>();
  for (const observation of world.observations) {
    const metadata = read(`public/global-history/observations/${observation.observation_id}/metadata.json`);
    for (const [id, entity] of Object.entries(metadata.entities) as [string, {name: string; kind: string}][]) {
      const found = findStateCoverage({entityId: id, observationYear: observation.year, scope: 'world'});
      assert.equal(found?.entry.title, entity.name);
      assert.equal(found?.entry.kind, entity.kind);
      seen.add(`world:${observation.year}|${id}`);
    }
  }
  for (const epoch of alpha.epochs) {
    if (!/^isles-(?:bce)?[0-9]+$/.test(epoch.epoch_id)) continue;
    const value = epoch.epoch_id.slice(6);
    const year = value.startsWith('bce') ? -Number(value.slice(3)) : Number(value);
    const metadata = read(`public/alpha/${epoch.metadata.url}`);
    for (const [id, entity] of Object.entries(metadata.entities) as [string, {name: string; kind: string}][]) {
      const found = findStateCoverage({entityId: id, observationYear: year, scope: 'isles'});
      assert.equal(found?.entry.title, entity.name);
      assert.equal(found?.entry.kind, entity.kind);
      seen.add(`isles:${year}|${id}`);
    }
  }
  assert.equal(seen.size, STATE_COVERAGE_STATS.entityObservations);
});
