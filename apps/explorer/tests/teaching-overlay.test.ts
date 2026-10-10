import assert from 'node:assert/strict';
import test from 'node:test';
import { projectTeachingPath, teachingGeometrySize, teachingPaint, TeachingOverlay, TEACHING_LIMITS } from '../src/teaching-overlay.ts';
import type { TeachingFeature } from '../src/teaching-data.ts';

const feature = (overrides: Partial<TeachingFeature> = {}): TeachingFeature => ({
  id: 'route', title: 'Schematic connection', category: 'trade', fromYear: 1200, toYear: 1500,
  summary: 'Evidence connecting ports.', limitations: 'No exact sailing track is implied.', certainty: 'approximate',
  sourceIds: ['source'], geometry: { type: 'LineString', coordinates: [[10, 10], [20, 20]] }, ...overrides,
});
function harness() {
  const fills: number[] = [], lines: number[][] = [], texts: string[] = [];
  const ctx = {
    globalAlpha: 1, save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, setLineDash() {}, arc() {}, closePath() {}, stroke() {},
    moveTo(x: number, y: number) { lines.push([x, y]); }, lineTo(x: number, y: number) { lines.push([x, y]); },
    fill(this: { globalAlpha: number }) { fills.push(this.globalAlpha); }, fillRect() {}, fillText(value: string) { texts.push(value); },
    measureText(value: string) { return { width: value.length * 6 }; },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, fills, lines, texts, overlay: new TeachingOverlay() };
}
const camera = { x: .5, y: .5, scale: 512 };

test('teaching corridors unwrap the date line without a world-spanning false connection', () => {
  const points = projectTeachingPath([[178, 20], [-178, 21], [-170, 24]], camera, 1024, 768);
  assert.ok(Math.abs(points[1][0] - points[0][0]) < 6);
  assert.ok(Math.abs(points[2][0] - points[1][0]) < 12);
  const fullWidth = projectTeachingPath([[-180, -65], [180, -65]], camera, 1024, 768);
  assert.equal(fullWidth[1][0] - fullWidth[0][0], 512, 'explicit world-width context does not collapse at the seam');
});

test('invalid and excessive geometry cannot enter the renderer budget', () => {
  assert.equal(teachingGeometrySize(feature({ geometry: { type: 'Point', coordinates: [NaN, 30] } })), 0);
  assert.equal(teachingGeometrySize(feature({ geometry: { type: 'Point', coordinates: [0, 91] } })), 0);
  assert.equal(teachingGeometrySize(feature({ geometry: { type: 'Polygon', coordinates: [[[0, 0], [5, 0], [5, 5], [2, 2]]] } })), 0);
  const oversized = feature({ geometry: { type: 'LineString', coordinates: Array.from({ length: TEACHING_LIMITS.verticesPerFeature + 1 }, () => [0, 0]) } });
  assert.equal(teachingGeometrySize(oversized), 0);
  const { overlay } = harness();
  overlay.setFeatures([feature(), feature(), oversized]);
  assert.equal(overlay.getDiagnostics().activeFeatures, 1);
  assert.equal(overlay.getDiagnostics().rejectedFeatures, 2);
  overlay.setFeatures(Array.from({ length: 300 }, (_, i) => feature({ id: String(i) })));
  assert.equal(overlay.getDiagnostics().activeFeatures, TEACHING_LIMITS.features);
});

test('power relationships have distinct line conventions and never receive a sovereignty fill', () => {
  const relationships = ['core', 'tributary', 'influence', 'autonomous'] as const;
  assert.equal(new Set(relationships.map(relationship => JSON.stringify(teachingPaint(feature({ category: 'power', relationship })).dash))).size, 4);
  const { ctx, overlay, fills } = harness();
  const polygon = { type: 'Polygon' as const, coordinates: [[[0, 0], [10, 0], [10, 10], [0, 0]]] };
  overlay.setFeatures([feature({ category: 'power', relationship: 'core', geometry: polygon })]);
  overlay.draw(ctx, camera, 512, 512);
  assert.equal(fills.length, 0, 'a power polygon outlines a cited context without adding exclusive ownership');
  overlay.setFeatures([feature({ category: 'ecology', geometry: polygon })]);
  overlay.draw(ctx, camera, 512, 512);
  assert.ok(fills.length > 0 && fills.every(alpha => alpha <= .14), 'only broad ecological context receives a light wash');
});

test('selected evidence label yields to city bounds and only visible geometry spends draw budget', () => {
  const { ctx, overlay, texts } = harness();
  const point = feature({ geometry: { type: 'Point', coordinates: [0, 0] } });
  overlay.setFeatures([point], point.id);
  overlay.draw(ctx, camera, 512, 512);
  assert.equal(overlay.getDiagnostics().drawnFeatures, 1);
  overlay.drawLabel(ctx, () => true);
  assert.equal(texts.length, 0);
  assert.equal(overlay.getDiagnostics().selectedLabelVisible, false);
  overlay.drawLabel(ctx, (_x, y) => y < 256);
  assert.equal(texts.length, 1);
  assert.equal(overlay.overlapsLabel(256, 278, 20, 20), true);
  overlay.setFeatures([feature({ geometry: { type: 'Point', coordinates: [0, 80] } })]);
  overlay.draw(ctx, { ...camera, scale: 4096 }, 512, 512);
  assert.equal(overlay.getDiagnostics().drawnFeatures, 0);
  assert.equal(overlay.overlapsLabel(256, 278, 20, 20), false, 'prior labels cannot keep reserving space');
});

test('diffusion arrows require explicit source-supported direction, not coordinate order',()=>{
  assert.equal(teachingPaint(feature({category:'diffusion'})).arrow,false);
  assert.equal(teachingPaint(feature({category:'diffusion',directional:false})).arrow,false);
  assert.equal(teachingPaint(feature({category:'diffusion',directional:true})).arrow,true);
});
