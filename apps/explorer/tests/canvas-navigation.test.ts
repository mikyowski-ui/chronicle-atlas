import assert from 'node:assert/strict';
import test from 'node:test';
import { cameraCoordinates, geometryContainsCoordinates, inverseMercator, mercator, mercatorBounds } from '../src/canvas-map.ts';
import type { Polygon, MultiPolygon } from 'geojson';

const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} is not close to ${expected}`);

test('Geographic inspection inverts actual Mercator coordinates across continents', () => {
  for (const coordinates of [[-74.006, 40.7128], [-0.1276, 51.5072], [139.6917, 35.6895], [18.4241, -33.9249], [0, 0]]) {
    const actual = inverseMercator(mercator(coordinates));
    near(actual[0], coordinates[0]);
    near(actual[1], coordinates[1]);
  }
});

test('Two pointer locations retain distinct geographic positions under the same camera', () => {
  const [x, y] = mercator([-4, 54]);
  const camera = { x, y, scale: 8192 };
  const first = cameraCoordinates(camera, 1400, 900, 700, 450);
  const second = cameraCoordinates(camera, 1400, 900, 750, 500);
  near(first[0], -4); near(first[1], 54);
  near(second[0], -4 + 50 / 8192 * 360);
  assert.ok(second[1] < first[1]);
  assert.notDeepEqual(first, second);
});

test('Inspection normalizes world copies and clamps to the visible polar limit', () => {
  const first = inverseMercator([.98, .4]);
  const repeated = inverseMercator([2.98, .4]);
  near(first[0], repeated[0]); near(first[1], repeated[1]);
  near(inverseMercator([.5, -1])[1], 85.0511287798066);
  near(inverseMercator([.5, 2])[1], -85.0511287798066);
  near(inverseMercator([1, .5])[0], -180);
});

test('World fit preserves its full span while seam-crossing bounds stay narrow', () => {
  const world = mercatorBounds([-180, -85, 180, 85]);
  assert.equal(world.left, 0);
  assert.equal(world.right, 1);
  assert.ok(world.bottom > world.top);
  const seam = mercatorBounds([170, -20, -170, 20]);
  near(seam.right - seam.left, 20 / 360);
  const isles = mercatorBounds([-12, 49, 3, 61]);
  near(isles.right - isles.left, 15 / 360);
});

test('World fit rejects zero-width or invalid geographic extents', () => {
  for (const bounds of [[0, -20, 0, 20], [-180, -90, 540, 90], [-10, 50, 10, 40], [-10, -100, 10, 40], [NaN, -20, 20, 20]]) {
    assert.throws(() => mercatorBounds(bounds as [number, number, number, number]), RangeError);
  }
});

test('Geographic territory containment excludes holes and empty ground independently of labels', () => {
  const geometry: Polygon = { type: 'Polygon', coordinates: [
    [[-10, 40], [10, 40], [10, 60], [-10, 60], [-10, 40]],
    [[-2, 48], [2, 48], [2, 52], [-2, 52], [-2, 48]],
  ] };
  assert.equal(geometryContainsCoordinates(geometry, [-5, 50]), true);
  assert.equal(geometryContainsCoordinates(geometry, [0, 50]), false);
  assert.equal(geometryContainsCoordinates(geometry, [15, 50]), false);
  assert.equal(geometryContainsCoordinates(geometry, [-10, 50]), true);
  assert.equal(geometryContainsCoordinates(geometry, [NaN, 50]), false);
});

test('Geographic territory containment retains seam islands and separate parts', () => {
  const geometry: MultiPolygon = { type: 'MultiPolygon', coordinates: [
    [[[178, 20], [-178, 20], [-178, 26], [178, 26], [178, 20]]],
    [[[150, 10], [152, 10], [152, 12], [150, 12], [150, 10]]],
  ] };
  assert.equal(geometryContainsCoordinates(geometry, [179, 23]), true);
  assert.equal(geometryContainsCoordinates(geometry, [-179, 23]), true);
  assert.equal(geometryContainsCoordinates(geometry, [151, 11]), true);
  assert.equal(geometryContainsCoordinates(geometry, [0, 23]), false);
  assert.equal(geometryContainsCoordinates(geometry, [160, 15]), false);
});

test('Full-width polar context remains pickable at every longitude without covering temperate land', () => {
  const geometry: Polygon = { type: 'Polygon', coordinates: [
    [[-180, -65], [-90, -68], [0, -66], [90, -68], [180, -65], [180, -90], [-180, -90], [-180, -65]],
  ] };
  for (const longitude of [-179, -90, 0, 90, 179]) assert.equal(geometryContainsCoordinates(geometry, [longitude, -80]), true);
  assert.equal(geometryContainsCoordinates(geometry, [0, -50]), false);
});
