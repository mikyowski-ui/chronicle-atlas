import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SceneLabel, SceneSnapshot, TerritoryFeature } from '../../../packages/contracts/src/index.ts';
import { chooseSceneLabels, placeLabels, MAX_VISIBLE_LABELS } from '../src/labels.ts';

const anchor = (entity_id: string, position: readonly [number, number] = [100, 50], priority = 0, label_id = `${entity_id}-label`): SceneLabel =>
  ({ entity_id, label_id, text: entity_id, position, priority });
const part = (entity_id: string, render_id: string, t_start = 0, t_end = 10): TerritoryFeature => ({
  type: 'Feature', properties: { entity_id, render_id, territory_state_id: `${entity_id}-state`, t_start, t_end },
  geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
});
const scene = (territories: TerritoryFeature[], labels: SceneLabel[]): SceneSnapshot => ({
  generation: 1, epoch_id: 'test', edition: 'test', time: 5, territories, labels, population: [], migration: [],
});
const project = (point: readonly [number, number]) => point;
const measure = (text: string) => text.length * 8;

test('archipelago parts and clipped tile duplicates produce one independent entity label', () => {
  const labels = [anchor('Isles'), anchor('Isles', [110, 50], 0, 'Isles-west'), anchor('Coast', [250, 50])];
  const snapshot = scene([part('Isles', 'west'), part('Isles', 'east'), part('Isles', 'west'), part('Coast', 'main')], labels);
  assert.deepEqual(chooseSceneLabels(snapshot).map(label => label.entity_id), ['Coast', 'Isles']);
  assert.deepEqual(chooseSceneLabels(snapshot), chooseSceneLabels({ ...snapshot, territories: [...snapshot.territories].reverse(), labels: [...labels].reverse() }));
  assert.deepEqual(chooseSceneLabels(snapshot).find(label => label.entity_id === 'Isles')?.position, [100, 50]);
});

test('committed half-open validity removes dissolved labels and does not synthesize geometry centroids', () => {
  const snapshot = scene([part('Ended', 'a', 0, 5), part('Future', 'b', 6, 10), part('Current', 'c', 5, 10), part('Unlabelled', 'd')],
    [anchor('Ended'), anchor('Future'), anchor('Current'), anchor('Absent')]);
  assert.deepEqual(chooseSceneLabels(snapshot).map(label => label.entity_id), ['Current']);
  assert.deepEqual(chooseSceneLabels({ ...snapshot, labels: undefined }), []);
});

test('collision priority and stable identity ties are independent of input or tile order', () => {
  const labels = [anchor('Zulu', [100, 50]), anchor('Aster', [100, 50]), anchor('Priority', [100, 50], 10), anchor('Distant', [300, 50])];
  const chosen = placeLabels(labels, project, 500, 100, measure);
  assert.deepEqual(chosen.map(label => label.entity_id), ['Priority', 'Distant']);
  assert.deepEqual(chosen, placeLabels([...labels].reverse(), project, 500, 100, measure));
  assert.deepEqual(placeLabels(labels.slice(0, 2), project, 500, 100, measure).map(label => label.entity_id), ['Aster']);
});

test('fully offscreen, clipped, colliding and invalid anchors are filtered with measured text bounds', () => {
  const labels = [anchor('A', [100, 50]), anchor('B', [110, 50]), anchor('C', [2, 50]), anchor('D', [100, 2]),
    anchor('E', [490, 50]), anchor('F', [300, 50]), anchor('Invalid', [NaN, 50])];
  assert.deepEqual(placeLabels(labels, project, 500, 100, () => 40).map(label => label.entity_id), ['A', 'F']);
  assert.deepEqual(placeLabels(labels, project, 0, 100, measure), []);
  assert.deepEqual(placeLabels(labels, () => [Infinity, 20], 500, 100, measure), []);
  assert.deepEqual(placeLabels(labels, project, 500, 100, () => NaN), []);
});

test('a seam-aware projection chooses one world copy, while repeated seam anchors remain deduplicated', () => {
  const labels = [anchor('Seam', [179, 0], 1, 'seam-east'), anchor('Seam', [-181, 0], 0, 'seam-copy'), anchor('Neighbour', [-175, 0])];
  const aroundDateline = ([longitude, latitude]: readonly [number, number]): readonly [number, number] => {
    const shortest = ((longitude - 180 + 540) % 360) - 180;
    return [250 + shortest * 20, 50 - latitude];
  };
  const placed = placeLabels(labels, aroundDateline, 500, 100, measure);
  assert.deepEqual(placed.map(label => label.entity_id), ['Seam', 'Neighbour']);
  assert.equal(placed.filter(label => label.entity_id === 'Seam').length, 1);
  assert.equal(placed[0].x, 230);
});

test('label selection and placement do not mutate source anchors or polygons', () => {
  const snapshot = scene([part('Aster', 'main')], [anchor('Aster')]);
  const before = structuredClone(snapshot);
  const labels = chooseSceneLabels(snapshot);
  placeLabels(labels, project, 500, 100, measure);
  assert.deepEqual(snapshot, before);
});

test('global labels have bounded visible density even without collisions', () => {
  const labels = Array.from({ length: 200 }, (_, index) => anchor(`Place ${index}`, [50 + index % 20 * 90, 5 + Math.floor(index / 20) * 8]));
  const placed = placeLabels(labels, ([x, y]) => [x, y * 20], 2000, 2000, () => 24);
  assert.equal(placed.length, MAX_VISIBLE_LABELS);
  assert.deepEqual(placed, placeLabels([...labels].reverse(), ([x, y]) => [x, y * 20], 2000, 2000, () => 24));
  const small = placeLabels(labels, ([x, y]) => [x / 6, y * 5], 320, 480, () => 5);
  assert.ok(small.length <= Math.floor(320 * 480 / 12_000));
});

test('cultural and context labels retain meaning and do not crowd out political labels', () => {
  const political = part('Political', 'p'), cultural = part('Cultural', 'c'), context = part('Context', 'x');
  political.properties.kind = 'political'; cultural.properties.kind = 'cultural'; context.properties.kind = 'context';
  const labels = chooseSceneLabels(scene([context, cultural, political], [anchor('Context', [100, 50], 1000), anchor('Cultural', [100, 50], 100), anchor('Political')]));
  assert.equal(labels.find(label => label.entity_id === 'Cultural')?.displayKind, 'cultural');
  assert.equal(labels.find(label => label.entity_id === 'Context')?.displayKind, 'context');
  assert.equal(placeLabels(labels, project, 500, 100, measure)[0].entity_id, 'Political');
});
