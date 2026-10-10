import test from 'node:test';
import assert from 'node:assert/strict';
import { MapLibreResearchAdapter, RESEARCH_LAYERS, RESEARCH_SOURCE, type MapLibreResearchPort } from '../src/maplibre.ts';
import { CanvasResearchAdapter } from '../src/canvas.ts';
import { researchOverlayFor, parseResearchOverlay, visibleResearchFeatures } from '../src/spatial-overlay.ts';

test('undated spatial references remain explicitly null on both renderer paths, never an invented historical interval', () => {
  const input = { type: 'FeatureCollection', features: [{ type: 'Feature', id: 'synthetic-reference', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { entityId: 'synthetic-entity', observationId: 'synthetic-reference', revision: 1, startYear: null, endYear: null, sourceHash: 'a'.repeat(64) } }] };
  const overlay = parseResearchOverlay(input); assert.equal(visibleResearchFeatures(overlay, 0).length, 1); assert.equal(visibleResearchFeatures(overlay, 2000).length, 1);
  assert.equal(overlay.features[0].properties.startYear, null);
  assert.throws(() => parseResearchOverlay({ ...input, features: [{ ...input.features[0], properties: { ...input.features[0].properties, endYear: 1 } }] }));
});

const data = researchOverlayFor({ entities: [{ id: 'entity-1', coordinates: [0, 0] }], observations: [{ id: 'record-1', entityId: 'entity-1', time: { startYear: 1769, endYear: 1769 }, provenance: { sourceSha256: 'a'.repeat(64) } }] }, 7);
test('MapLibre adapter owns one source, reuses data on cursor updates and restores only its own layers', () => {
  const layers = new Map<string, unknown>([['host-land', {}]]), sources = new Map<string, { setData(): void }>();
  let writes = 0, filters = 0;
  const metadata = {} as DOMStringMap;
  const port: MapLibreResearchPort = {
    getLayer: id => layers.get(id), getSource: id => sources.get(id),
    addSource: id => { sources.set(id, { setData() { writes++; } }); }, addLayer: layer => { layers.set(layer.id, layer); },
    removeLayer: id => { layers.delete(id); }, removeSource: id => { sources.delete(id); },
    setFilter: () => { filters++; }, setPaintProperty: () => {}, metadata: () => metadata,
  };
  const adapter = new MapLibreResearchAdapter(port);
  adapter.update(data, 1769, null); adapter.paint();
  assert.equal(sources.size, 1); assert.equal(metadata.researchVisible, '1');
  adapter.update(data, 1800, null); adapter.paint(); assert.equal(writes, 0); assert.equal(metadata.researchVisible, '0');
  adapter.update(data, 1800, 'record-1'); adapter.paint(); assert.equal(metadata.researchVisible, '1');
  assert.equal(adapter.acceptsPick({ observationId: 'record-1', revision: 7 }), true);
  assert.equal(adapter.acceptsPick({ observationId: 'record-1', revision: 6 }), false);
  sources.delete(RESEARCH_SOURCE); for (const id of RESEARCH_LAYERS) layers.delete(id);
  adapter.paint(true); assert.equal(sources.size, 1); assert.equal(layers.size, 3); assert.ok(filters >= 8);
  adapter.clear(); assert.equal(sources.size, 0); assert.deepEqual([...layers.keys()], ['host-land']);
});
test('Canvas picking returns only visible source-backed points and polygons, including hole exclusion', () => {
  const adapter = new CanvasResearchAdapter(); adapter.update(data, 1769, null);
  assert.equal(adapter.pick([0, 0], point => point)?.observationId, 'record-1');
  adapter.update(data, 1800, null); assert.equal(adapter.pick([0, 0], point => point), null);
  adapter.update(data, 1800, 'record-1'); assert.equal(adapter.pick([0, 0], point => point)?.revision, 7);
  const polygon = parseResearchOverlay({ type: 'FeatureCollection', features: [{ ...data.features[0], geometry: { type: 'Polygon', coordinates: [[[0, 0], [20, 0], [20, 20], [0, 20], [0, 0]], [[5, 5], [15, 5], [15, 15], [5, 15], [5, 5]]] }, properties: { ...data.features[0].properties, startYear: null, endYear: null } }] });
  adapter.update(polygon, 0, null); assert.equal(adapter.pick([2, 2], point => point)?.observationId, 'record-1'); assert.equal(adapter.pick([10, 10], point => point), null); assert.equal(adapter.pick([25, 25], point => point), null);
  adapter.clear(); assert.equal(adapter.pick([2, 2], point => point), null);
});
test('Canvas adapter shares temporal filtering without acquiring a MapLibre dependency', () => {
  let invalidations = 0, dots = 0, saves = 0, restores = 0;
  const adapter = new CanvasResearchAdapter(() => { invalidations++; });
  const context = { save() { saves++; }, restore() { restores++; }, beginPath() {}, arc() { dots++; }, fill() {}, stroke() {} } as unknown as CanvasRenderingContext2D;
  adapter.update(data, 1769, null); adapter.draw(context, point => point);
  assert.equal(dots, 1); adapter.update(data, 1800, null); adapter.draw(context, point => point); assert.equal(dots, 1);
  adapter.update(data, 1800, 'record-1'); adapter.draw(context, point => point); assert.equal(dots, 2);
  assert.equal(saves, restores); assert.equal(invalidations, 3);
  adapter.clear(); assert.equal(adapter.getDiagnostics().source, false);
});
