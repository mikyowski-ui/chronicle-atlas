import assert from 'node:assert/strict';
import test from 'node:test';
import { GeometryProjectionCache, intersectsViewport, mercator, projectedPolygonRings } from '../src/canvas-map.ts';
import type { Polygon } from 'geojson';

test('Canvas Mercator clamps both poles to finite map limits', () => {
  const north = mercator([0, 90]), south = mercator([0, -90]);
  assert.ok(north.every(Number.isFinite) && south.every(Number.isFinite));
  assert.ok(Math.abs(north[1]) < 1e-9);
  assert.ok(Math.abs(south[1] - 1) < 1e-9);
  assert.deepEqual(north, mercator([0, 85.05112878]));
});

test('Canvas seam polygon remains narrow in either visible world copy', () => {
  const ring = [[179, 20], [-179, 20], [-179, 25], [179, 25], [179, 20]];
  for (const cameraX of [0, 1, 2]) {
    const [projected] = projectedPolygonRings([ring], cameraX);
    const xs = projected.map(([x]) => x);
    assert.ok(Math.max(...xs) - Math.min(...xs) < .006);
    assert.ok(Math.abs((Math.max(...xs) + Math.min(...xs)) / 2 - cameraX) < .001);
    assert.deepEqual(projected[0], projected.at(-1));
  }
});

test('Canvas keeps a seam-crossing hole inside the same projected shell', () => {
  const rings = [
    [[178, 20], [-178, 20], [-178, 26], [178, 26], [178, 20]],
    [[-179, 22], [179, 22], [179, 24], [-179, 24], [-179, 22]],
  ];
  const [shell, hole] = projectedPolygonRings(rings, 1);
  const shellXs = shell.map(p => p[0]), shellYs = shell.map(p => p[1]);
  for (const [x, y] of hole) {
    assert.ok(x > Math.min(...shellXs) && x < Math.max(...shellXs));
    assert.ok(y > Math.min(...shellYs) && y < Math.max(...shellYs));
  }
});

test('Canvas retains every original vertex and does not interpolate regional geometry', () => {
  const ring = [[-7, 50], [-6.5, 50.125], [-5, 51], [-7, 50]];
  const [projected] = projectedPolygonRings([ring], .5);
  assert.equal(projected.length, ring.length);
  projected.forEach((point, index) => assert.deepEqual(point, mercator(ring[index])));
  assert.deepEqual(projectedPolygonRings([[]], .5), [[]]);
});

test('Canvas preserves explicit full-world polar edges instead of collapsing Antarctica', () => {
  const ring = [[-180, -65], [-90, -68], [0, -66], [90, -68], [180, -65], [180, -90], [-180, -90], [-180, -65]];
  const original = structuredClone(ring);
  const [projected] = projectedPolygonRings([ring], .5);
  assert.equal(projected.length, ring.length);
  assert.equal(projected[5][0] - projected[6][0], 1);
  assert.deepEqual(projected[0], projected.at(-1));
  assert.ok(projected.every(point => point.every(Number.isFinite)));
  assert.deepEqual(ring, original);
});

test('projection reuse follows immutable geometry identity and camera, never a render ID or source year', () => {
  const first: Polygon = { type: 'Polygon', coordinates: [[[-7,50],[-5,50],[-5,51],[-7,50]]] };
  const replacement: Polygon = { type: 'Polygon', coordinates: [[[-7,50],[-4,50],[-5,51],[-7,50]]] };
  const cache = new GeometryProjectionCache<readonly number[]>();
  let calls=0;
  const project=(geometry: Polygon | import('geojson').MultiPolygon)=>{calls++;return Object.freeze([calls,geometry.coordinates.length]);};
  const original=cache.get(first,'fixed-camera',project);
  for(let revision=0;revision<200;revision++)assert.strictEqual(cache.get(first,'fixed-camera',project),original);
  assert.equal(calls,1,'New exact/reference wrappers reuse the same original geometry.');
  assert.notStrictEqual(cache.get(replacement,'fixed-camera',project),original,'Changed geometry always projects, even if a render ID is retained.');
  assert.notStrictEqual(cache.get(first,'moved-camera',project),original,'Paths from another camera cannot be reused.');
  assert.equal(cache.builds,3);
  assert.deepEqual(first.coordinates,[[[-7,50],[-5,50],[-5,51],[-7,50]]]);
});

test('viewport culling retains crossings, full-world polygons and stroke margins without dropping vertices', () => {
  assert.equal(intersectsViewport([-200,-200,2000,2000],1363,936),true);
  assert.equal(intersectsViewport([-10,20,-3,30],1363,936),true,'Visible border stroke margin stays included.');
  assert.equal(intersectsViewport([1366,20,1400,30],1363,936),true);
  assert.equal(intersectsViewport([1368,20,1400,30],1363,936),false);
  assert.equal(intersectsViewport([-200,20,-10,30],1363,936),false);
  assert.equal(intersectsViewport([20,940,30,1000],1363,936),true);
  assert.equal(intersectsViewport([Infinity,Infinity,-Infinity,-Infinity],1363,936),false,'Empty polygons do not paint.');
});
