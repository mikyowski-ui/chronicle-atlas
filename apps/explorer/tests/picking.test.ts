import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SceneSnapshot, TerritoryFeature } from '../../../packages/contracts/src/index.ts';
import { reconcileSelection, resolvePick, selectEntity } from '../src/picking.ts';

const square = (size = 4): number[][] => [[0, 0], [size, 0], [size, size], [0, size], [0, 0]];
function territory(entityId: string, renderId = `${entityId}-part`, options: {
  size?: number; stateId?: string; start?: number; end?: number; priority?: unknown; holes?: number[][][];
} = {}): TerritoryFeature {
  return {
    type: 'Feature',
    properties: {
      entity_id: entityId, render_id: renderId, territory_state_id: options.stateId ?? `${entityId}-state`,
      t_start: options.start ?? 0, t_end: options.end ?? 20,
      ...(options.priority === undefined ? {} : { pick_priority: options.priority }),
    },
    geometry: { type: 'Polygon', coordinates: [square(options.size), ...(options.holes ?? [])] },
  };
}
function scene(territories: TerritoryFeature[], generation = 7, time = 5): SceneSnapshot {
  return { generation, epoch_id: `epoch-${generation}`, edition: 'synthetic-test', time, territories, population: [], migration: [] };
}
const hit = (render_id: unknown, generation = 7) => ({ render_id, generation });

test('overlapping hits resolve identically across tile duplicates, input order and untrusted metadata', () => {
  const active = scene([territory('large', 'large', { size: 8 }), territory('small', 'small', { size: 2 })]);
  const forged = { ...hit('small'), entity_id: 'forged', territory_state_id: 'forged', pick_priority: -100 };
  const hits = [hit('large'), forged, hit('small'), hit('unknown'), hit(3), hit(null), hit('large', 6)];
  const expected = { entityId: 'small', renderId: 'small', territoryStateId: 'small-state', renderIds: ['small'] };
  assert.deepEqual(resolvePick(hits, active), expected);
  assert.deepEqual(resolvePick([...hits].reverse(), { ...active, territories: [...active.territories].reverse() }), expected);
});

test('priority comes only from finite canonical values before area and stable identity ties', () => {
  const small = territory('small', 'small', { size: 1 });
  const preferred = territory('preferred', 'preferred', { size: 10, priority: 2 });
  const infinite = territory('infinite', 'infinite', { size: 2, priority: Infinity });
  const string = territory('string', 'string', { size: 3, priority: '99' });
  assert.equal(resolvePick([small, preferred, infinite, string].map(f => hit(f.properties.render_id)), scene([small, preferred, infinite, string]))?.entityId, 'preferred');
  assert.equal(resolvePick([hit('small'), hit('infinite'), hit('string')], scene([small, infinite, string]))?.entityId, 'small');
});

test('equal priority uses polygon area with holes removed, independent of hole winding', () => {
  const solid = territory('a-solid', 'solid');
  const hole = [[1, 1], [3, 1], [3, 3], [1, 3], [1, 1]];
  const hollow = territory('z-hollow', 'hollow', { holes: [hole] });
  assert.equal(resolvePick([hit('solid'), hit('hollow')], scene([solid, hollow]))?.renderId, 'hollow');
  hollow.geometry.coordinates[1].reverse();
  assert.equal(resolvePick([hit('hollow'), hit('solid')], scene([hollow, solid]))?.renderId, 'hollow');
});

test('area ranking handles a polygon crossing the longitude seam', () => {
  const acrossSeam = territory('seam', 'seam');
  acrossSeam.geometry.coordinates = [[[179, 0], [-179, 0], [-179, 2], [179, 2], [179, 0]]];
  const large = territory('a-large', 'large', { size: 4 });
  assert.equal(resolvePick([hit('large'), hit('seam')], scene([large, acrossSeam]))?.renderId, 'seam');
});

test('exact area ties use code points for entity, state and render identifiers', () => {
  const laterUnicode = territory('\u{10000}', 'later');
  const earlierUnicode = territory('\uE000', 'earlier');
  assert.equal(resolvePick([hit('later'), hit('earlier')], scene([laterUnicode, earlierUnicode]))?.renderId, 'earlier');
  const byState = [territory('entity', 'z', { stateId: 'A' }), territory('entity', 'a', { stateId: 'B' })];
  assert.equal(resolvePick([hit('a'), hit('z')], scene(byState))?.renderId, 'z');
  const byRender = [territory('entity', 'z'), territory('entity', 'A')];
  assert.equal(resolvePick([hit('z'), hit('A')], scene(byRender))?.renderId, 'A');
});

test('stale, unknown and half-open inactive hits cannot become a selection', () => {
  const active = scene([territory('ended', 'ended', { end: 5 }), territory('future', 'future', { start: 6 }), territory('start', 'start', { start: 5 })]);
  assert.equal(resolvePick([hit('ended'), hit('future'), hit('unknown'), hit('start', 6)], active), null);
  assert.equal(resolvePick([hit('start')], active)?.entityId, 'start');
  assert.equal(resolvePick([], active), null);
});

test('one island hit selects all active parts of its entity and excludes other or inactive parts', () => {
  const active = scene([
    territory('isles', 'west'), territory('isles', 'east'), territory('isles', 'retired', { end: 5 }),
    territory('mainland', 'mainland'),
  ]);
  const selection = resolvePick([hit('west'), hit('west')], active)!;
  assert.deepEqual(selection.renderIds, ['east', 'west']);
  assert.equal(selection.renderId, 'west');
  assert.equal(Object.isFrozen(selection.renderIds), true);
});

test('commits preserve the entity and active representative, or choose a new deterministic part', () => {
  const before = scene([territory('isles', 'west'), territory('isles', 'east')]);
  const previous = resolvePick([hit('west')], before)!;
  const retained = scene([territory('isles', 'new-island'), territory('isles', 'west', { stateId: 'revised-state' })], 8);
  assert.deepEqual(reconcileSelection(previous, retained), {
    entityId: 'isles', renderId: 'west', territoryStateId: 'revised-state', renderIds: ['new-island', 'west'],
  });
  const replaced = scene([territory('isles', 'z-new'), territory('isles', 'a-new')], 9);
  assert.deepEqual(reconcileSelection(previous, replaced), {
    entityId: 'isles', renderId: 'a-new', territoryStateId: 'isles-state', renderIds: ['a-new', 'z-new'],
  });
  assert.equal(reconcileSelection(previous, scene([territory('other', 'west')], 10)), null);
  assert.equal(reconcileSelection(null, replaced), null);
});

test('accessible entity selection also uses all committed parts and rejects absent entities', () => {
  const active = scene([territory('isles', 'z'), territory('isles', 'a'), territory('ended', 'ended', { end: 5 })]);
  assert.deepEqual(selectEntity('isles', active), {
    entityId: 'isles', renderId: 'a', territoryStateId: 'isles-state', renderIds: ['a', 'z'],
  });
  assert.equal(selectEntity('ended', active), null);
  assert.equal(selectEntity('unknown', active), null);
});

test('political hits precede cultural and source context regardless of smaller context area or priority', () => {
  const political = territory('political', 'political', { size: 10 });
  political.properties.kind = 'political';
  const cultural = territory('cultural', 'cultural', { size: 3, priority: 100 });
  cultural.properties.kind = 'cultural';
  const context = territory('context', 'context', { size: 1, priority: 1000 });
  context.properties.kind = 'context';
  const candidates = [context, cultural, political], active = scene(candidates);
  assert.equal(resolvePick(candidates.map(f => hit(f.properties.render_id)), active)?.entityId, 'political');
  assert.equal(resolvePick([hit('context'), hit('cultural')], active)?.entityId, 'cultural');
  assert.equal(resolvePick([hit('context')], active)?.entityId, 'context');
  assert.equal(selectEntity('context', active)?.entityId, 'context', 'Context remains explicitly inspectable.');
});
