import test from 'node:test';
import assert from 'node:assert/strict';
import { clampHudPosition, queryShortcut, matchesCursor } from '../src/research/hud-contract.ts';
import { parseResearchOverlay, researchOverlayFor, visibleResearchFeatures } from '../src/research/spatial-overlay.ts';

const key = (key: string, changes: Record<string, boolean> = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, isComposing: false, editing: false, ...changes });
const bundle = {
  entities: [{ id: 'place-1', coordinates: [12, 45] as [number, number] }],
  observations: [{ id: 'record-1', entityId: 'place-1', time: { startYear: -1, endYear: 0 }, provenance: { sourceSha256: 'a'.repeat(64) } }],
};

test('HUD query shortcuts preserve text entry, composition and unrelated key combinations', () => {
  assert.equal(queryShortcut(key('/')), true);
  assert.equal(queryShortcut(key('/', { editing: true })), false);
  assert.equal(queryShortcut(key('k', { ctrlKey: true, editing: true })), true);
  assert.equal(queryShortcut(key('K', { metaKey: true })), true);
  for (const event of [key('k'), key('/', { altKey: true }), key('k', { ctrlKey: true, isComposing: true }), key(' ')]) assert.equal(queryShortcut(event), false);
});

test('HUD dragging is clamped above the timeline and below the pinned omnibar', () => {
  const bounds = { width: 1440, height: 1000, top: 140, bottom: 212 };
  assert.deepEqual(clampHudPosition({ x: -500, y: 0 }, { width: 530, height: 600 }, bounds), { x: 10, y: 140 });
  assert.deepEqual(clampHudPosition({ x: 2000, y: 2000 }, { width: 530, height: 600 }, bounds), { x: 900, y: 178 });
  const narrow = clampHudPosition({ x: 999, y: 999 }, { width: 355, height: 420 }, { width: 375, height: 812, top: 166, bottom: 206 });
  assert.deepEqual(narrow, { x: 10, y: 176 });
});

test('HUD cursor matching uses inclusive attested intervals and preserves astronomical year zero', () => {
  assert.equal(matchesCursor(-1, 0, -0.2), true);
  assert.equal(matchesCursor(-1, 0, 0.9), true);
  assert.equal(matchesCursor(-1, 0, 1), false);
  assert.equal(matchesCursor(1769, 1769, 700), false);
  assert.equal(matchesCursor(3, 2, 2), false);
  assert.equal(matchesCursor(0, 1, Number.NaN), false);
});

test('research GeoJSON includes only registered source coordinates, temporal support and reference identities', () => {
  const data = researchOverlayFor(bundle, 4);
  assert.equal(data.type, 'FeatureCollection'); assert.equal(data.features.length, 1);
  assert.deepEqual(data.features[0].geometry, { type: 'Point', coordinates: [12, 45] });
  assert.equal(data.features[0].properties.revision, 4);
  assert.equal(data.features[0].properties.sourceHash, 'a'.repeat(64));
  assert.equal(visibleResearchFeatures(data, 0).length, 1);
  assert.equal(visibleResearchFeatures(data, 1).length, 0);
  assert.equal(visibleResearchFeatures(data, 1, 'record-1').length, 1);
  assert.throws(() => researchOverlayFor({ ...bundle, entities: [] }, 4));
});

test('research overlay rejects malformed geometry, invented fields, duplicate IDs and unbounded payloads', () => {
  const data = researchOverlayFor(bundle, 1);
  const mutate = (change: (value: any) => void) => { const value = structuredClone(data); change(value); return () => parseResearchOverlay(value); };
  assert.throws(mutate(value => { value.features[0].geometry.coordinates[0] = 190; }));
  assert.throws(mutate(value => { value.features[0].properties.html = '<b>invented</b>'; }));
  assert.throws(mutate(value => { value.features[0].properties.endYear = -2; }));
  assert.throws(mutate(value => { value.features.push(value.features[0]); }));
  assert.throws(mutate(value => { value.features[0].geometry = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] }; }));
  assert.throws(mutate(value => { value.features = Array(2001).fill(value.features[0]); }));
  const polygon = structuredClone(data) as any;
  polygon.features[0].geometry = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
  assert.equal(parseResearchOverlay(polygon).features[0].geometry.type, 'Polygon');
});
