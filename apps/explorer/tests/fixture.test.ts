import { test } from 'node:test';
import assert from 'node:assert/strict';
import fixtureJson from '../src/fixture.json' with { type: 'json' };
import { dayFromAstronomical, formatHistoricalDay } from '../../../lib/readiness/chronology.ts';
import { formatFixtureYear } from '../src/date-label.ts';
import { advancePresentation, commitRequestedTime, createState, isActive, requestTime, selectedCard, selectTerritory, shouldHandleSpace, togglePlayback, validateFixture } from '../src/state.ts';

const fixture = validateFixture(structuredClone(fixtureJson));

test('three immutable, nonoverlapping polygons are initially active; dates match the retained adapter', () => {
  const state = commitRequestedTime(createState(fixture.initial_time), fixture);
  assert.equal(fixture.initial_time, dayFromAstronomical(1000));
  for (const year of [-199, 0, 1, 950, 1000, 1050]) {
    const day = dayFromAstronomical(year);
    assert.equal(formatFixtureYear(day), formatHistoricalDay(day, 'year'));
  }
  assert.equal(state.committed!.activeFeatures.length, 3);
  const bounds = fixture.features.map(feature => {
    assert.equal(feature.properties.t_start, dayFromAstronomical(950));
    assert.equal(feature.properties.t_end, dayFromAstronomical(1050));
    assert.ok(Object.isFrozen(feature.geometry.coordinates[0]));
    const ring = feature.geometry.coordinates[0];
    // Positive signed area establishes counterclockwise exterior rings.
    assert.ok(ring.slice(0, -1).reduce((sum, p, i) => sum + p[0] * ring[i + 1][1] - ring[i + 1][0] * p[1], 0) > 0);
    return { left: Math.min(...ring.map(p => p[0])), right: Math.max(...ring.map(p => p[0])), bottom: Math.min(...ring.map(p => p[1])), top: Math.max(...ring.map(p => p[1])) };
  });
  for (let i = 0; i < bounds.length; i++) for (let j = i + 1; j < bounds.length; j++) {
    const a = bounds[i], b = bounds[j];
    assert.ok(a.right < b.left || b.right < a.left || a.top < b.bottom || b.top < a.bottom, 'Fixture bounding boxes must not overlap');
  }
});

test('half-open eligibility includes the start and excludes the end, without interpolation', () => {
  for (const f of fixture.features) {
    assert.equal(isActive(f, f.properties.t_start - 1), false);
    assert.equal(isActive(f, f.properties.t_start), true);
    assert.equal(isActive(f, f.properties.t_end - 1), true);
    assert.equal(isActive(f, f.properties.t_end), false);
  }
});

test('pending requests and playback never mutate committed geometry, card time, or requested time', () => {
  const initial = commitRequestedTime(createState(fixture.initial_time), fixture);
  const selected = selectTerritory(initial, fixture.features[0].properties.render_id);
  const pending = requestTime(selected, fixture.features[0].properties.t_end);
  assert.strictEqual(pending.committed, initial.committed);
  assert.equal(selectedCard(pending)!.committed_time, initial.committed!.time);
  const playing = advancePresentation(togglePlayback(pending), 1250);
  assert.strictEqual(playing.committed, pending.committed);
  assert.equal(playing.requestedTime, pending.requestedTime);
  assert.equal(playing.presentation.elapsedMs, 1250);
  assert.equal(advancePresentation(togglePlayback(playing), 500).presentation.elapsedMs, 1250);
  const committed = commitRequestedTime(playing, fixture);
  assert.equal(committed.committed!.activeFeatures.length, 0);
  assert.equal(committed.selectedRenderId, null);
  assert.equal(selectedCard(committed), null);
});

test('cards use committed feature identity and reject unknown picks', () => {
  const initial = commitRequestedTime(createState(fixture.initial_time), fixture);
  for (const f of fixture.features) {
    const card = selectedCard(selectTerritory(initial, f.properties.render_id));
    assert.equal(card!.entity_id, f.properties.entity_id);
    assert.equal(card!.render_id, f.properties.render_id);
    assert.equal(card!.territory_state_id, f.properties.territory_state_id);
    assert.equal(card!.fixture_kind, 'synthetic');
  }
  assert.equal(selectedCard(selectTerritory(initial, 'invented-id')), null);
  assert.equal(selectedCard(selectTerritory(createState(fixture.initial_time), fixture.features[0].properties.render_id)), null);
});

test('malformed identity, time bounds and rings are rejected', () => {
  const duplicate = structuredClone(fixtureJson);
  duplicate.features[1].properties.render_id = duplicate.features[0].properties.render_id;
  assert.throws(() => validateFixture(duplicate));
  const inverted = structuredClone(fixtureJson);
  inverted.features[0].properties.t_end = inverted.features[0].properties.t_start;
  assert.throws(() => validateFixture(inverted));
  const openRing = structuredClone(fixtureJson);
  openRing.features[0].geometry.coordinates[0].pop();
  assert.throws(() => validateFixture(openRing));
});

test('Space handles one unmodified press and ignores repeat/editable targets', () => {
  const press = { code: 'Space', repeat: false, altKey: false, ctrlKey: false, metaKey: false };
  assert.equal(shouldHandleSpace(press, false), true);
  assert.equal(shouldHandleSpace(press, true), false);
  assert.equal(shouldHandleSpace({ ...press, repeat: true }, false), false);
  assert.equal(shouldHandleSpace({ ...press, ctrlKey: true }, false), false);
  assert.equal(shouldHandleSpace({ ...press, code: 'Enter' }, false), false);
});

test('global playback yields Space to focused controls while map navigation keeps its shortcut', () => {
  const press = { code: 'Space', repeat: false, altKey: false, ctrlKey: false, metaKey: false };
  // main.ts routes native buttons, links, disclosures and ARIA widgets through this same guard.
  assert.equal(shouldHandleSpace(press, false, true), false, 'Do not prevent native activation or start playback from a control.');
  assert.equal(shouldHandleSpace(press, false, false), true, 'An ordinary map focus still plays/pauses.');
  assert.equal(shouldHandleSpace(press, true, true), false, 'Editable controls stay isolated.');
  assert.equal(shouldHandleSpace({ ...press, code: 'Enter' }, false, true), false, 'Native Enter activation is not a playback action.');
});
