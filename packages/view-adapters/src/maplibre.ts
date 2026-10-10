import { parseResearchOverlay, visibleResearchFeatures, type ResearchOverlay } from './spatial-overlay.ts';
import type { SpatialViewAdapter } from './interfaces.ts';

export const RESEARCH_SOURCE = 'chronicle-research-hud';
export const RESEARCH_LAYERS = [`${RESEARCH_SOURCE}-polygons`, `${RESEARCH_SOURCE}-points`] as const;
export interface ResearchLayerDefinition { id: string; type: 'fill' | 'circle'; source: string; paint: Record<string, unknown> }
export interface MapLibreResearchPort {
  getSource(id: string): { setData(data: ResearchOverlay): unknown } | undefined;
  getLayer(id: string): unknown;
  addSource(id: string, source: { type: 'geojson'; data: ResearchOverlay }): unknown;
  addLayer(layer: ResearchLayerDefinition): unknown;
  removeLayer(id: string): unknown;
  removeSource(id: string): unknown;
  setFilter(id: string, filter: unknown[]): unknown;
  setPaintProperty(id: string, property: string, value: unknown): unknown;
  metadata?: () => DOMStringMap;
}
export class MapLibreResearchAdapter implements SpatialViewAdapter<ResearchOverlay> {
  private input: ResearchOverlay | null = null;
  private data: ResearchOverlay | null = null;
  private year = 0;
  private selected: string | null = null;
  private dirty = true;
  private filterKey = '';
  constructor(private readonly port: MapLibreResearchPort) {}
  update(input: ResearchOverlay | null, cursorYear: number, selectedId: string | null): void {
    if (!Number.isFinite(cursorYear)) throw new Error('INVALID_CURSOR');
    if (input !== this.input) { const checked = input === null ? null : parseResearchOverlay(input); this.input = input; this.data = checked; this.dirty = true; }
    this.year = Math.floor(cursorYear); this.selected = selectedId;
  }
  paint(restoring = false): void {
    const [polygons, points] = RESEARCH_LAYERS, data = this.data;
    if (!data) {
      for (const id of [points, polygons]) if (this.port.getLayer(id)) this.port.removeLayer(id);
      if (this.port.getSource(RESEARCH_SOURCE)) this.port.removeSource(RESEARCH_SOURCE);
      this.filterKey = ''; this.dirty = false; this.annotate(); return;
    }
    const source = this.port.getSource(RESEARCH_SOURCE);
    if (!source) this.port.addSource(RESEARCH_SOURCE, { type: 'geojson', data });
    else if (this.dirty) source.setData(data);
    if (!this.port.getLayer(polygons)) this.port.addLayer({ id: polygons, type: 'fill', source: RESEARCH_SOURCE, paint: { 'fill-color': '#176e86', 'fill-opacity': .2, 'fill-outline-color': '#164f61' } });
    if (!this.port.getLayer(points)) this.port.addLayer({ id: points, type: 'circle', source: RESEARCH_SOURCE, paint: { 'circle-color': '#176e86', 'circle-radius': 7, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
    const key = `${this.year}:${this.selected ?? ''}`;
    if (this.dirty || restoring || key !== this.filterKey || !source) {
      const at = ['any', ['==', ['get', 'startYear'], null], ['all', ['!=', ['get', 'startYear'], null], ['<=', ['get', 'startYear'], this.year], ['>=', ['get', 'endYear'], this.year]], ['==', ['get', 'observationId'], this.selected ?? '']];
      this.port.setFilter(points, ['all', ['==', ['geometry-type'], 'Point'], at]);
      this.port.setFilter(polygons, ['all', ['==', ['geometry-type'], 'Polygon'], at]);
      this.port.setPaintProperty(points, 'circle-color', ['case', ['==', ['get', 'observationId'], this.selected ?? ''], '#9b531f', '#176e86']);
      this.filterKey = key;
    }
    this.dirty = false; this.annotate();
  }
  acceptsPick(properties: { observationId?: unknown; revision?: unknown }): boolean {
    return this.data?.features.some(feature => feature.id === properties.observationId && feature.properties.revision === properties.revision) ?? false;
  }
  getDiagnostics() { return { source: this.data !== null, features: this.data?.features.length ?? 0, visible: this.data ? visibleResearchFeatures(this.data, this.year, this.selected).length : 0 }; }
  private annotate() {
    const metadata = this.port.metadata?.(), counts = this.getDiagnostics();
    if (metadata) { metadata.researchFeatures = String(counts.features); metadata.researchVisible = String(counts.visible); }
  }
  clear(): void { this.update(null, this.year, null); this.paint(); }
}
