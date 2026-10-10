import { chooseSceneLabels, placeLabels, MAX_VISIBLE_LABELS, type DisplayLabel } from './labels.ts';
import maplibregl, { type ExpressionSpecification, type FilterSpecification, type LayerSpecification, type StyleSpecification } from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import type { SceneSnapshot, VectorArchiveDescriptor } from '../../../packages/contracts/src/index.ts';
import type { EntityStyle } from './canvas-map.ts';
import type { RawPickHit } from './picking.ts';
import { StreamingLifecycle, type StageToken } from './streaming-lifecycle.ts';
import type { PinnedArchive } from './streaming-range.ts';
import { WarmArchiveCache } from './warm-archive-cache.ts';
import { sceneRenderSignature } from './scene-signature.ts';
import { DISPLAY_ORDER, DISPLAY_STYLES } from './display-style.ts';
import type { DetailCamera, DetailFrame } from './detail-context.ts';
import { DetailCanvas } from './detail-canvas.ts';
import { TeachingOverlay } from './teaching-overlay.ts';
import type { TeachingFeature } from './teaching-data.ts';
import { ReducedMotionPreference } from './reduced-motion.ts';
import { StyleReloadLifecycle } from './style-reload-lifecycle.ts';
import { MapLibreResearchAdapter } from '@chronicle/view-adapters/maplibre';
import type { ResearchOverlay } from '@chronicle/view-adapters/spatial';

type Layers = { population: boolean; migration: boolean };
type Stream = PinnedArchive & { minzoom: number; maxzoom: number; bounds?: readonly [number, number, number, number]; source_layers: readonly string[] };
type SceneGroup = {
  scene: SceneSnapshot;
  renderSignature: string;
  source: string;
  stream?: Stream;
  supplement?: { source: string; stream: Stream; edition: string };
  retainedMain: boolean;
  retainedSupplement: boolean;
  layers: string[];
  token: StageToken;
  selected: readonly string[];
  hovered: readonly string[];
  selectionForScene: () => readonly string[];
  cancel: () => void;
};
// MapLibre's protocol registry is global. Register it once, never on date scrubs.
const protocol = new Protocol();
let registered = false;
const archives = new WarmArchiveCache(protocol);
const baseEdition = (stream: Stream) => `physical-base:${stream.sha256}`;
function abortError(): DOMException { return new DOMException('Superseded scene generation.', 'AbortError'); }
export type BasemapAppearance = 'paper' | 'contrast';
function basemapStyle(appearance: BasemapAppearance): StyleSpecification {
  return { version: 8, projection: { type: 'mercator' }, transition: { duration: 0, delay: 0 }, sources: {}, layers: [
    { id: 'ocean', type: 'background', paint: { 'background-color': appearance === 'contrast' ? '#bfd8e1' : '#e4edf0' } },
  ] };
}

/**
 * One MapLibre instance for the lifetime of the explorer. Active and staging
 * epochs are independent vector sources; staging layers stay layout-visible
 * with zero opacity so the current viewport hydrates without becoming visible.
 * A commit changes all thematic paints in one JS turn, with transitions off.
 */
export class GLMap {
  private readonly map: maplibregl.Map;
  private readonly node: HTMLDivElement;
  private readonly ready: Promise<void>;
  private readonly lifetime = new AbortController();
  private readonly lifecycle = new StreamingLifecycle();
  private active: SceneGroup | null = null;
  private staging: SceneGroup | null = null;
  private base: Stream | undefined;
  private layers: Layers = { population: false, migration: false };
  private markers = new Map<string, { marker: maplibregl.Marker; label: DisplayLabel }>();
  private labels: ReturnType<typeof chooseSceneLabels> = [];
  private measure: CanvasRenderingContext2D;
  private sequence = 0;
  private disposed = false;
  private errorListener: ((error: Error) => void) | null = null;
  private hoverFrame: number | null = null;
  private hoverPoint: maplibregl.Point | null = null;
  private hoverQueries = 0;
  private reusedScenes = 0;
  private createdLabelNodes = 0;
  private presentationUpdates = 0;
  private renderCallbacks = 0;
  private lastRenderCallback: { at: number; generation: number | null; time: number | null } | null = null;
  private detailFrame: DetailFrame | null = null;
  private readonly detailPainter: DetailCanvas;
  private readonly detailOverlay: HTMLCanvasElement;
  private detailReady = false;
  private terrainSourceKey = '';
  private terrainError: string | null = null;
  private teaching = new TeachingOverlay();
  private interpretiveBorders = false;
  private readonly motionPreference = new ReducedMotionPreference();
  private readonly styleReload: StyleReloadLifecycle;
  private stylePending: Promise<void> | null = null;
  private styleLoading = false;
  private readonly researchRenderer: MapLibreResearchAdapter;

  constructor(
    private host: HTMLElement,
    private entities: Record<string, EntityStyle>,
    private pick: (hits: RawPickHit[]) => void,
    private bounds: readonly [number, number, number, number] = [-24, 28, 24, 57],
    private hover: (hits: RawPickHit[]) => void = () => undefined,
    private migrationPick: (renderId: string) => void = () => undefined,
    private inspect?: (hit: { coordinates: [number, number]; renderIds: string[]; mode: 'place' | 'polity' }) => void,
  ) {
    if (!registered) { maplibregl.addProtocol('pmtiles', protocol.tile); registered = true; }
    this.node = document.createElement('div');
    this.node.className = 'gl-stage';
    this.host.append(this.node);
    this.measure = document.createElement('canvas').getContext('2d')!;
    this.measure.font = '17px Georgia';
    try {
      this.map = new maplibregl.Map({
        container: this.node,
        style: basemapStyle('paper'),
        center: [-2, 43], zoom: 3, minZoom: 0, maxZoom: 10, maxTileCacheSize: 64,
        renderWorldCopies: false, dragRotate: false, pitchWithRotate: false, touchPitch: false, attributionControl: false,
      });
    } catch (error) { this.motionPreference.dispose(); this.node.remove(); throw error; }
    this.researchRenderer = new MapLibreResearchAdapter({
      getSource: id => this.map.getSource(id) as maplibregl.GeoJSONSource | undefined, getLayer: id => this.map.getLayer(id),
      addSource: (id, source) => this.map.addSource(id, source), addLayer: layer => this.map.addLayer(layer as LayerSpecification),
      removeLayer: id => this.map.removeLayer(id), removeSource: id => this.map.removeSource(id),
      setFilter: (id, filter) => this.map.setFilter(id, filter as FilterSpecification), setPaintProperty: (id, property, value) => this.map.setPaintProperty(id, property, value),
      metadata: () => this.map.getCanvas().dataset,
    });
    this.map.touchZoomRotate.disableRotation();
    // Context is independent of the historical source groups. The overlay has
    // no pointer handlers: picking still uses the committed native polygons.
    this.detailOverlay = document.createElement('canvas');
    this.detailOverlay.className = 'detail-context-overlay';
    this.detailOverlay.setAttribute('aria-hidden', 'true');
    Object.assign(this.detailOverlay.style, { position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '1' });
    this.map.getCanvasContainer().append(this.detailOverlay);
    this.detailPainter = new DetailCanvas(() => this.drawDetailOverlay());
    this.motionPreference.subscribe(reduced => { if (reduced) this.map.stop(); });
    this.styleReload = new StyleReloadLifecycle({ subscribe: listener => {
      this.map.on('style.load', listener);
      return () => { this.map.off('style.load', listener); };
    } }, () => this.restoreStyleBindings(), error => {
      this.host.dispatchEvent(new CustomEvent('renderer-error', { detail: error }));
    });
    // Timeline shortcuts are application-owned; MapLibre must not also pan on arrows.
    this.map.keyboard.disable();
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-left');
    this.ready = new Promise<void>((resolve, reject) => {
      const abort = () => reject(abortError());
      this.lifetime.signal.addEventListener('abort', abort, { once: true });
      this.map.once('load', () => { this.lifetime.signal.removeEventListener('abort', abort); resolve(); });
      this.map.once('error', event => { this.lifetime.signal.removeEventListener('abort', abort); reject(event.error); });
    });
    // Ensure a context initialization error is observed even before prepare runs.
    void this.ready.catch(() => undefined);
    void this.ready.then(() => {
      if (this.disposed) return;
      this.detailReady = true;
      this.syncDetailTerrain();
      this.drawDetailOverlay();
    }).catch(() => undefined);
    this.map.on('error', event => {
      const sourceId = (event as unknown as { sourceId?: string }).sourceId;
      if (sourceId === 'chronicle-detail-terrain') {
        // An unavailable contextual raster must not reject an admitted scene.
        this.terrainError = event.error.message;
        if (this.active) this.paintGroup(this.active, true);
        this.host.dispatchEvent(new CustomEvent('detail-context-error', { detail: { source: sourceId, message: this.terrainError } }));
        this.annotate();
        return;
      }
      const ownsSource = (group: SceneGroup | null) => sourceId === group?.source || sourceId === group?.supplement?.source;
      if (sourceId && sourceId.startsWith('chronicle-epoch-') && !ownsSource(this.active) && !ownsSource(this.staging)) return;
      if (this.errorListener && (!sourceId || ownsSource(this.staging) || sourceId === 'chronicle-land')) this.errorListener(event.error);
      else if (this.active && !this.disposed) {
        this.host.dispatchEvent(new CustomEvent('renderer-error', { detail: event.error }));
        console.error('[Chronicle MapLibre]', event.error);
      }
    });
    this.map.on('webglcontextlost', () => {
      const error = new Error('The MapLibre WebGL context was lost. Reload with Canvas rendering to continue.');
      this.map.getCanvas().dataset.contextState = 'lost';
      this.errorListener?.(error);
      this.host.dispatchEvent(new CustomEvent('renderer-error', { detail: error }));
    });
    this.map.on('webglcontextrestored', () => { this.map.getCanvas().dataset.contextState = 'restored'; });
    this.map.on('move', () => {
      this.lifecycle.moveCamera();
      const readout = document.getElementById('camera-readout');
      if (readout) readout.textContent = `Zoom ${this.map.getZoom().toFixed(1)} · MapLibre`;
      this.updateLabels();
      this.drawDetailOverlay();
      this.annotate();
      this.notifyView();
    });
    this.map.on('moveend', () => this.notifyView());
    this.map.on('resize', () => { this.lifecycle.moveCamera(); this.updateLabels(); this.drawDetailOverlay(); this.notifyView(); });
    this.map.on('render', () => {
      this.renderCallbacks++;
      this.lastRenderCallback = { at: performance.now(), generation: this.active?.scene.generation ?? null, time: this.active?.scene.time ?? null };
    });
    this.map.on('click', event => {
      const researchLayers = ['chronicle-research-hud-points', 'chronicle-research-hud-polygons'].filter(id => !!this.map.getLayer(id));
      const research = researchLayers.length ? this.map.queryRenderedFeatures(event.point, { layers: researchLayers })[0]?.properties : undefined;
      if (research && this.researchRenderer.acceptsPick(research)) {
        this.host.dispatchEvent(new CustomEvent('research-map-select', { detail: { entityId: research.entityId, observationId: research.observationId, revision: research.revision } })); return;
      }
      const group = this.active;
      const hits = this.queryTerritories(event.point);
      if (this.inspect) this.inspect({ coordinates: [event.lngLat.lng, event.lngLat.lat], renderIds: hits.map(hit => String(hit.render_id)), mode: 'place' });
      else if (hits.length) this.pick(hits);
      if (!hits.length && this.layers.migration && group?.layers.includes(`${group.source}-migration`) && this.map.getLayer(`${group.source}-migration`)) {
        const feature = this.map.queryRenderedFeatures(event.point, { layers: [`${group.source}-migration`] })[0];
        if (typeof feature?.properties.render_id === 'string') this.migrationPick(feature.properties.render_id);
      }
    });
    this.map.on('contextmenu', event => {
      if (!this.inspect) return;
      event.originalEvent.preventDefault();
      this.inspect({ coordinates: [event.lngLat.lng, event.lngLat.lat], renderIds: this.queryTerritories(event.point).map(hit => String(hit.render_id)), mode: 'polity' });
    });
    this.map.on('mousemove', event => {
      this.hoverPoint = event.point;
      if (this.hoverFrame !== null) return;
      this.hoverFrame = requestAnimationFrame(() => {
        this.hoverFrame = null;
        if (this.disposed || !this.hoverPoint) return;
        const hits = this.queryTerritories(this.hoverPoint);
        this.hoverQueries++;
        this.map.getCanvas().style.cursor = hits.length ? 'pointer' : '';
        this.hover(hits);
      });
    });
    this.map.getCanvas().addEventListener('mouseleave', () => {
      this.cancelHover();
      this.map.getCanvas().style.cursor = '';
      this.hover([]);
    }, { signal: this.lifetime.signal });
    this.fit();
    this.annotate();
  }

  private cancelHover(): void {
    if (this.hoverFrame !== null) cancelAnimationFrame(this.hoverFrame);
    this.hoverFrame = null; this.hoverPoint = null;
  }

  private queryTerritories(point: maplibregl.Point): RawPickHit[] {
    const group = this.active;
    if (!group?.stream) return [];
    const layers = DISPLAY_ORDER.map(kind => `${group.source}-fill-${kind}`).filter(id => group.layers.includes(id) && !!this.map.getLayer(id));
    if (!layers.length) return [];
    return this.map.queryRenderedFeatures(point, { layers })
      .filter(feature => feature.id === feature.properties.render_id)
      .map(feature => ({ render_id: feature.id, generation: group.scene.generation }));
  }

  private async whenReady(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (this.disposed) throw abortError();
    await new Promise<void>((resolve, reject) => {
      const abort = () => reject(abortError());
      signal.addEventListener('abort', abort, { once: true });
      this.ready.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
    signal.throwIfAborted();
    this.lifetime.signal.throwIfAborted();
    if (this.stylePending) await this.stylePending;
    signal.throwIfAborted();
    this.lifetime.signal.throwIfAborted();
  }

  async prepare(scene: SceneSnapshot, signal: AbortSignal, selectionForScene: () => readonly string[], desiredLayers: Layers = this.layers): Promise<() => void> {
    // Cancellation removes the previous staging source before another is added.
    this.staging?.cancel();
    await this.whenReady(signal);
    signal.throwIfAborted();
    const token = this.lifecycle.begin(scene.generation);
    const stream = scene.stream;
    if (scene.epoch_id !== 'uncovered' && !stream) throw new Error('MapLibre requires a compiled native PMTiles stream.');
    if (scene.baseGeography?.stream) this.ensureBase(scene.baseGeography.stream);
    const old = this.active;
    // Keep the mounted signature: hidden native filters may lag cheap cursor
    // stamps and must hydrate at the current date before being made visible.
    const renderSignature = sceneRenderSignature(scene, desiredLayers);
    if (old && old.renderSignature === renderSignature) {
      // Identical geometry needs no source rebuild. It still has a fresh token.
      this.lifecycle.frame(token, true); this.lifecycle.frame(token, true);
      return () => {
        signal.throwIfAborted();
        this.lifecycle.commit(token);
        this.reusedScenes++;
        old.scene = scene;
        old.renderSignature = renderSignature;
        old.selectionForScene = selectionForScene;
        this.applySelection(old, selectionForScene());
        this.installLabels(scene);
        this.annotate();
      };
    }
    const source = `chronicle-epoch-${++this.sequence}`;
    const group: SceneGroup = { scene, renderSignature, source, stream,
      supplement: scene.supplement ? { source: `${source}-overlay`, stream: scene.supplement.stream, edition: scene.supplement.edition } : undefined,
      retainedMain: false, retainedSupplement: false, layers: [], token, selected: [], hovered: [], selectionForScene, cancel: () => undefined };
    this.staging = group;
    let removed = false;
    const remove = () => {
      if (removed || this.active === group) return;
      removed = true;
      this.lifecycle.cancel(token);
      if (this.staging === group) this.staging = null;
      this.removeGroup(group);
    };
    try {
      if (stream) this.mountGroup(group);
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const cleanup = () => {
          this.map.off('render', onRender);
          this.map.off('sourcedata', onSourceData);
          signal.removeEventListener('abort', cancel);
          this.lifetime.signal.removeEventListener('abort', cancel);
          if (this.errorListener === fail) this.errorListener = null;
          clearTimeout(timeout);
        };
        const fail = (error: Error) => {
          if (settled) return;
          settled = true; cleanup(); remove(); reject(error);
        };
        const cancel = () => fail(abortError());
        group.cancel = cancel;
        const hydrated = () => (!stream || this.map.isSourceLoaded(group.source))
          && (!group.supplement || this.map.isSourceLoaded(group.supplement.source))
          && (!this.base || this.map.isSourceLoaded('chronicle-land'));
        const onRender = () => {
          if (!this.lifecycle.current(token)) { cancel(); return; }
          if (this.lifecycle.coveredFrame(token, hydrated(), this.coverageKey(group))) {
            settled = true; cleanup(); resolve();
          } else if (hydrated()) this.map.triggerRepaint();
        };
        const onSourceData = () => this.map.triggerRepaint();
        const timeout = setTimeout(() => fail(new Error('The requested viewport did not finish loading within 30 seconds.')), 30_000);
        this.map.on('render', onRender);
        this.map.on('sourcedata', onSourceData);
        this.errorListener = fail;
        signal.addEventListener('abort', cancel, { once: true });
        this.lifetime.signal.addEventListener('abort', cancel, { once: true });
        if (signal.aborted) { cancel(); return; }
        this.map.triggerRepaint();
      });
      // Keep a prepared-but-uncommitted group cancelable through the microtask gap.
      const abortPrepared = () => remove();
      signal.addEventListener('abort', abortPrepared, { once: true });
      group.cancel = () => { signal.removeEventListener('abort', abortPrepared); remove(); };
      return () => {
        try {
          signal.throwIfAborted();
          this.lifecycle.commit(token);
          this.applySelection(group, selectionForScene());
          this.paintGroup(group, true);
          if (old) this.paintGroup(old, false);
          this.active = group;
          this.staging = null;
          signal.removeEventListener('abort', abortPrepared);
          group.cancel = () => undefined;
          if (old) this.removeGroup(old);
          this.cancelHover();
          this.hover([]);
          this.installLabels(scene);
          this.annotate();
        } catch (error) { remove(); throw error; }
      };
    } catch (error) { remove(); throw error; }
  }

  private ensureBase(stream: Stream): void {
    if (this.base && this.base.sha256 !== stream.sha256) throw new Error('Physical base geography must stay fixed for a recorded edition.');
    if (!this.base) { archives.retain(stream, baseEdition(stream)); this.base = stream; }
    if (!this.map.getSource('chronicle-land')) this.map.addSource('chronicle-land', {
      type: 'vector', url: `pmtiles://${stream.url}`, minzoom: stream.minzoom, maxzoom: stream.maxzoom,
      ...(stream.bounds ? { bounds: [...stream.bounds] as [number, number, number, number] } : {}),
    });
    const sourceLayer = stream.source_layers.includes('land') ? 'land' : stream.source_layers[0];
    if (!this.map.getLayer('physical-land')) this.map.addLayer({ id: 'physical-land', type: 'fill', source: 'chronicle-land', 'source-layer': sourceLayer, paint: { 'fill-color': '#e1e1d7', 'fill-outline-color': '#acbdb7' } }, this.map.getLayer('detail-relief') ? 'detail-relief' : undefined);
    if (!this.map.getLayer('physical-coastline')) this.map.addLayer({ id: 'physical-coastline', type: 'line', source: 'chronicle-land', 'source-layer': sourceLayer, paint: { 'line-color': '#a9bbb5', 'line-width': .7 } });
  }

  private mountGroup(group: SceneGroup): void {
    const stream = group.stream!;
    if (!group.retainedMain) { archives.retain(stream, group.scene.edition); group.retainedMain = true; }
    if (!this.map.getSource(group.source)) this.map.addSource(group.source, {
      type: 'vector', url: `pmtiles://${stream.url}`, promoteId: 'render_id', minzoom: stream.minzoom, maxzoom: stream.maxzoom,
      ...(stream.bounds ? { bounds: [...stream.bounds] as [number, number, number, number] } : {}),
    });
    const entities = group.scene.entities ?? this.entities;
    const colors = Object.entries(entities).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).flatMap(([id, value]) => [id, value.color]);
    const color: ExpressionSpecification | string = colors.length ? ['match', ['get', 'entity_id'], ...colors, '#b4c6bf'] as unknown as ExpressionSpecification : '#b4c6bf';
    const at = (time: number): FilterSpecification => ['all', ['<=', ['get', 't_start'], time], ['>', ['get', 't_end'], time]];
    const excluded = group.scene.suppressedEntityIds ?? [];
    const filter: FilterSpecification = excluded.length
      ? ['all', at(group.scene.time), ['!', ['in', ['get', 'entity_id'], ['literal', [...excluded]]]]] as FilterSpecification
      : at(group.scene.time);
    // Independent overlays remain tied to requested time even on a reference map.
    const overlayFilter = at(group.scene.overlayTime ?? group.scene.time);
    if (group.supplement) {
      const { source, stream: overlay, edition } = group.supplement;
      if (!group.retainedSupplement) { archives.retain(overlay, edition); group.retainedSupplement = true; }
      if (!this.map.getSource(source)) this.map.addSource(source, {
        type: 'vector', url: `pmtiles://${overlay.url}`, promoteId: 'render_id', minzoom: overlay.minzoom, maxzoom: overlay.maxzoom,
        ...(overlay.bounds ? { bounds: [...overlay.bounds] as [number, number, number, number] } : {}),
      });
    }
    const overlaySource = group.supplement?.source ?? group.source;
    const overlayStream = group.supplement?.stream ?? stream;
    const add = (layer: LayerSpecification) => {
      if (!this.map.getLayer(layer.id)) this.map.addLayer(layer, this.map.getLayer('chronicle-research-hud-polygons') ? 'chronicle-research-hud-polygons' : undefined);
      if (!group.layers.includes(layer.id)) group.layers.push(layer.id);
    };
    // Geometry remains in one native source. Separate paint layers preserve the
    // cultural/context meaning and keep their strokes below political fills.
    if (stream.source_layers.includes('territories')) for (const kind of DISPLAY_ORDER) {
      const typedFilter = ['all', filter, ['==', ['coalesce', ['get', 'kind'], 'political'], kind]] as FilterSpecification;
      const style = DISPLAY_STYLES[kind];
      add({ id: `${group.source}-fill-${kind}`, type: 'fill', source: group.source, 'source-layer': 'territories', filter: typedFilter,
        paint: { 'fill-color': kind === 'context' ? '#b8ae99' : color, 'fill-opacity': 0 } });
      add({ id: `${group.source}-border-${kind}`, type: 'line', source: group.source, 'source-layer': 'territories', filter: typedFilter,
        paint: { 'line-color': style.stroke, 'line-width': style.lineWidth, 'line-opacity': 0,
          ...(this.interpretiveBorders && kind === 'political' ? { 'line-dasharray': [5.33, 4] } : style.dash.length ? { 'line-dasharray': [...style.dash] } : {}) } });
    }
    if (overlayStream.source_layers.includes('population')) add({ id: `${group.source}-population`, type: 'fill', source: overlaySource, 'source-layer': 'population', filter: overlayFilter,
      paint: { 'fill-color': ['interpolate', ['linear'], ['coalesce', ['get', 'density'], 0], 0, 'rgba(198,58,40,0.08)', 400, 'rgba(198,58,40,0.78)'], 'fill-opacity': 0 } });
    if (stream.source_layers.includes('territories')) add({ id: `${group.source}-hover`, type: 'fill', source: group.source, 'source-layer': 'territories', filter,
      paint: { 'fill-color': '#fffbea', 'fill-opacity': ['case', ['boolean', ['feature-state', 'hovered'], false], .3, 0] } });
    if (stream.source_layers.includes('territories')) add({ id: `${group.source}-hover-outline`, type: 'line', source: group.source, 'source-layer': 'territories', filter,
      paint: { 'line-color': '#3d6960', 'line-width': 2.3, 'line-opacity': ['case', ['boolean', ['feature-state', 'hovered'], false], .9, 0] } });
    if (stream.source_layers.includes('territories')) add({ id: `${group.source}-selection`, type: 'line', source: group.source, 'source-layer': 'territories', filter,
      paint: { 'line-color': '#123f37', 'line-width': 3.5, 'line-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 1, 0] } });
    if (overlayStream.source_layers.includes('migration')) add({ id: `${group.source}-migration`, type: 'line', source: overlaySource, 'source-layer': 'migration', filter: overlayFilter,
      paint: { 'line-color': '#763e9d', 'line-width': 3, 'line-dasharray': [3, 2], 'line-opacity': 0 } });
  }

  private paintGroup(group: SceneGroup, visible: boolean): void {
    if (!group.stream) return;
    const set = (suffix: string, property: string, value: unknown) => {
      const id = `${group.source}-${suffix}`;
      if (group.layers.includes(id) && this.map.getLayer(id)) this.map.setPaintProperty(id, property, value);
    };
    for (const kind of DISPLAY_ORDER) {
      const opacity = kind === 'political' && this.terrainVisible() ? .4 : DISPLAY_STYLES[kind].opacity;
      set(`fill-${kind}`, 'fill-opacity', visible ? opacity : 0);
      set(`border-${kind}`, 'line-opacity', visible ? this.interpretiveBorders && kind === 'political' ? .45 : .85 : 0);
      if (kind === 'political') set(`border-${kind}`, 'line-dasharray', this.interpretiveBorders ? [5.33, 4] : undefined);
    }
    // Keep data-driven expressions fixed: replacing them would relayout source
    // buckets after readiness. Selection and hover use feature-state only.
    set('population', 'fill-opacity', visible && this.layers.population ? 1 : 0);
    set('migration', 'line-opacity', visible && this.layers.migration ? .9 : 0);
  }

  private removeGroup(group: SceneGroup): void {
    for (const id of [...group.layers].reverse()) if (this.map.getLayer(id)) this.map.removeLayer(id);
    group.layers = [];
    if (this.map.getSource(group.source)) this.map.removeSource(group.source);
    if (group.stream && group.retainedMain) { archives.release(group.stream, group.scene.edition); group.retainedMain = false; }
    if (group.supplement) {
      if (this.map.getSource(group.supplement.source)) this.map.removeSource(group.supplement.source);
      if (group.retainedSupplement) { archives.release(group.supplement.stream, group.supplement.edition); group.retainedSupplement = false; }
    }
    this.annotate();
  }

  setLayers(layers: Layers): void {
    this.layers = { ...layers };
    if (this.active) this.paintGroup(this.active, true);
    this.annotate();
  }

  /** Shared Canvas evidence paint remains independent of native scene admission. */
  setTeachingFeatures(features: readonly TeachingFeature[], selectedId?: string): void {
    this.teaching.setFeatures(features, selectedId);
    this.drawDetailOverlay(); this.annotate();
  }
  /** Softer source outlines are a visualization convention, not inferred topology. */
  setInterpretiveBorders(enabled: boolean): void {
    if (this.interpretiveBorders === enabled) return;
    this.interpretiveBorders = enabled;
    if (this.active) this.paintGroup(this.active, true);
    if (this.staging) this.paintGroup(this.staging, false);
    this.annotate();
  }

  /** Static terrain and dated detail do not replace the historical scene. */
  setDetailContext(frame: DetailFrame): void {
    if (this.disposed) return;
    this.detailFrame = frame;
    this.detailPainter.setFrame(frame);
    if (this.detailReady) this.syncDetailTerrain();
    this.drawDetailOverlay();
    this.annotate();
  }

  private terrainVisible(): boolean {
    return !!this.detailFrame?.options.terrain && !!this.detailFrame.terrain && !!this.terrainSourceKey && !this.terrainError;
  }

  private syncDetailTerrain(): void {
    if (!this.detailReady || this.disposed || this.styleLoading) return;
    const terrain = this.detailFrame?.terrain;
    const key = terrain ? JSON.stringify([terrain.tiles, terrain.minzoom, terrain.maxzoom, terrain.tileSize]) : '';
    if (key !== this.terrainSourceKey || (terrain && (!this.map.getSource('chronicle-detail-terrain') || !this.map.getLayer('detail-relief')))) {
      if (this.map.getLayer('detail-relief')) this.map.removeLayer('detail-relief');
      if (this.map.getSource('chronicle-detail-terrain')) this.map.removeSource('chronicle-detail-terrain');
      this.terrainSourceKey = '';
      this.terrainError = null;
      if (terrain) {
        this.map.addSource('chronicle-detail-terrain', {
          type: 'raster', tiles: [terrain.tiles], tileSize: terrain.tileSize,
          minzoom: terrain.minzoom, maxzoom: terrain.maxzoom,
        });
        const before = this.map.getLayer('physical-coastline') ? 'physical-coastline'
          : this.map.getStyle().layers.find(layer => layer.id.startsWith('chronicle-epoch-'))?.id;
        this.map.addLayer({ id: 'detail-relief', type: 'raster', source: 'chronicle-detail-terrain',
          paint: { 'raster-opacity': 1, 'raster-fade-duration': 0, 'raster-resampling': 'linear' },
        }, before);
        this.terrainSourceKey = key;
      }
    }
    if (this.map.getLayer('detail-relief')) this.map.setLayoutProperty('detail-relief', 'visibility', this.detailFrame?.options.terrain ? 'visible' : 'none');
    if (this.active) this.paintGroup(this.active, true);
    this.annotate();
  }

  private drawDetailOverlay(): void {
    if (this.disposed || !this.detailOverlay) return;
    const width = this.node.clientWidth, height = this.node.clientHeight;
    if (width < 1 || height < 1) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pixelsWide = Math.round(width * dpr), pixelsHigh = Math.round(height * dpr);
    if (this.detailOverlay.width !== pixelsWide || this.detailOverlay.height !== pixelsHigh) {
      this.detailOverlay.width = pixelsWide; this.detailOverlay.height = pixelsHigh;
      this.detailOverlay.style.width = `${width}px`; this.detailOverlay.style.height = `${height}px`;
    }
    const ctx = this.detailOverlay.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const center = this.map.getCenter(), latitude = Math.max(-85.05112878, Math.min(85.05112878, center.lat)) * Math.PI / 180;
    const camera: DetailCamera = { x: (center.lng + 180) / 360, y: (1 - Math.log(Math.tan(Math.PI / 4 + latitude / 2)) / Math.PI) / 2, scale: 512 * 2 ** this.map.getZoom() };
    // MapLibre explicitly disables repeated world copies. Clip the shared
    // painter to that same world instead of repeating cities into empty margins.
    ctx.save(); ctx.beginPath();
    ctx.rect(width / 2 - camera.x * camera.scale, height / 2 - camera.y * camera.scale, camera.scale, camera.scale);
    ctx.clip();
    this.teaching.draw(ctx, camera, width, height);
    if (this.detailFrame) this.detailPainter.drawOverlay(ctx, camera, width, height);
    this.teaching.drawLabel(ctx,(x,y,labelWidth,labelHeight)=>this.detailPainter.overlapsCityLabel(x,y,labelWidth,labelHeight));
    ctx.restore();
    this.updateLabels();
  }

  private applyState(group: SceneGroup, previous: readonly string[], next: readonly string[], property: 'selected' | 'hovered'): void {
    if (!group.stream?.source_layers.includes('territories') || !this.map.getSource(group.source)) return;
    const before = new Set(previous), after = new Set(next);
    for (const id of before) if (!after.has(id)) this.map.setFeatureState({ source: group.source, sourceLayer: 'territories', id }, { [property]: false });
    for (const id of after) if (!before.has(id)) this.map.setFeatureState({ source: group.source, sourceLayer: 'territories', id }, { [property]: true });
  }
  private applySelection(group: SceneGroup, ids: readonly string[]): void {
    this.applyState(group, group.selected, ids, 'selected');
    group.selected = [...ids];
  }
  setSelected(ids: readonly string[]): void {
    if (this.active) this.applySelection(this.active, ids);
    // Staging has no selected/hovered feature-state until its atomic commit.
    // The latest selectionForScene() is read again inside the commit callback.
    this.annotate();
  }
  setHovered(ids: readonly string[]): void {
    if (this.active) {
      this.applyState(this.active, this.active.hovered, ids, 'hovered');
      this.active.hovered = [...ids];
    }
    this.annotate();
  }

  private installLabels(scene: SceneSnapshot): void {
    const nextLabels = chooseSceneLabels(scene);
    // Eligibility/anchors are independent of the changing committed date. Keep
    // stable DOM nodes, keyboard focus and collision decisions on unchanged days.
    if (JSON.stringify(nextLabels) === JSON.stringify(this.labels)) return;
    this.labels = nextLabels;
    this.updateLabels();
  }
  private syncVisibleLabels(labels: readonly DisplayLabel[]): void {
    const retained = new Set(labels.map(label => label.label_id));
    for (const [id, entry] of this.markers) if (!retained.has(id)) { entry.marker.remove(); this.markers.delete(id); }
    for (const label of labels) {
      const existing = this.markers.get(label.label_id);
      if (existing) {
        const element = existing.marker.getElement();
        if (existing.label.text !== label.text) {
          element.textContent = label.text;
          element.setAttribute('aria-label', `Inspect ${label.text}`);
        }
        if (existing.label.position[0] !== label.position[0] || existing.label.position[1] !== label.position[1]) {
          existing.marker.setLngLat([...label.position] as [number, number]);
        }
        existing.label = label;
        this.styleLabel(element, label);
        continue;
      }
      const element = document.createElement('div');
      element.className = 'territory-label'; element.textContent = label.text;
      this.styleLabel(element, label);
      element.style.pointerEvents = 'auto'; element.style.cursor = 'pointer';
      element.setAttribute('role', 'button'); element.setAttribute('tabindex', '0');
      element.setAttribute('aria-label', `Inspect ${label.text}`);
      // A retained node always picks from the current committed generation.
      const hit = () => {
        const current = this.active?.scene, currentLabel = this.markers.get(label.label_id)?.label;
        if (!current || !currentLabel) return [];
        const part = (current.parts ?? current.territories.map(feature => ({ properties: feature.properties })))
          .find(part => part.properties.entity_id === currentLabel.entity_id && part.properties.t_start <= current.time && current.time < part.properties.t_end);
        return part ? [{ render_id: part.properties.render_id, generation: current.generation }] : [];
      };
      element.addEventListener('click', event => {
        event.stopPropagation();
        if (!this.inspect) { this.pick(hit()); return; }
        const rect = this.map.getCanvas().getBoundingClientRect();
        const point = new maplibregl.Point(event.clientX - rect.left, event.clientY - rect.top);
        const coordinates = this.map.unproject(point);
        // A detached label can extend beyond its polygon. A place click must
        // report actual ground assertions rather than inventing label ownership.
        this.inspect({ coordinates: [coordinates.lng, coordinates.lat], renderIds: this.queryTerritories(point).map(item => String(item.render_id)), mode: 'place' });
      });
      element.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); this.pick(hit()); }
      });
      element.addEventListener('mouseenter', () => this.hover(hit()));
      element.addEventListener('mouseleave', () => this.hover([]));
      this.markers.set(label.label_id, { label, marker: new maplibregl.Marker({ element }).setLngLat([...label.position] as [number, number]).addTo(this.map) });
      this.createdLabelNodes++;
    }
  }
  private styleLabel(element: HTMLElement, label: DisplayLabel): void {
    const kind = label.displayKind ?? 'political';
    element.dataset.displayKind = kind;
    element.style.fontStyle = kind === 'political' ? 'normal' : 'italic';
    element.style.color = kind === 'context' ? '#777064' : kind === 'cultural' ? '#7b654b' : '#294b45';
    element.title = `${label.text} · ${DISPLAY_STYLES[kind].label}`;
    element.style.zIndex = '2';
  }
  private updateLabels(): void {
    const placed = placeLabels(this.labels, position => {
      const point = this.map.project([...position] as [number, number]); return [point.x, point.y];
    }, this.node.clientWidth, this.node.clientHeight, value => this.measure.measureText(value).width)
      .filter(label=>!this.detailPainter.overlapsCityLabel(label.x,label.y,this.measure.measureText(label.text).width+12)
        && !this.teaching.overlapsLabel(label.x,label.y,this.measure.measureText(label.text).width+12));
    // Create only visible anchors: a global scene cannot retain hundreds of
    // offscreen DOM markers. The same node survives while its label stays shown.
    this.syncVisibleLabels(placed);
    const canvas = this.map.getCanvas();
    canvas.dataset.labelCount = String(placed.length);
    canvas.dataset.labelEntities = placed.map(label => label.entity_id).join(',');
  }

  private webglReport() {
    const context = this.map.getCanvas().getContext('webgl2');
    if (!context) return { renderer: null, vendor: null, classification: 'unavailable' };
    const extension = context.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(context.getParameter(extension ? extension.UNMASKED_RENDERER_WEBGL : context.RENDERER));
    const vendor = String(context.getParameter(extension ? extension.UNMASKED_VENDOR_WEBGL : context.VENDOR));
    return { renderer, vendor, version: String(context.getParameter(context.VERSION)),
      classification: /SwiftShader|llvmpipe|software|softpipe/i.test(renderer) ? 'software-webgl' : 'native-renderer-reported',
      evidence: 'Renderer string read from the actual MapLibre canvas.',
      physicalPerformanceProfile: 'Not established by a renderer string; OS, driver and measured interaction receipt remain separate.' };
  }

  getDiagnostics() {
    const warmCache = archives.getDiagnostics();
    return {
      mapInstances: this.disposed ? 0 : 1,
      mapInstanceCount: this.disposed ? 0 : 1,
      sourceCount: Number(!!this.active?.stream) + Number(!!this.active?.supplement) + Number(!!this.staging?.stream) + Number(!!this.staging?.supplement) + Number(!!this.base) + Number(!!this.terrainSourceKey) + Number(this.researchRenderer.getDiagnostics().source),
      sourceLimit: 7,
      researchSourceLimit: 1,
      researchOverlay: this.researchRenderer.getDiagnostics(),
      historicalSourceLimit: 5,
      contextRasterSourceLimit: 1,
      detailContext: { ...this.detailPainter.getDiagnostics(), nativeTerrainSource: !!this.terrainSourceKey, terrainVisible: this.terrainVisible(), terrainError: this.terrainError },
      teaching: this.teaching.getDiagnostics(), interpretiveBorders: this.interpretiveBorders,
      styleReload: this.styleReload.diagnostics, reducedMotion: this.motionPreference.reduced,
      mountedSourceIds: Object.keys(this.map.getStyle().sources).sort(),
      mountedLayerIds: this.map.getStyle().layers.map(layer => layer.id),
      styleLoaded: this.map.isStyleLoaded(), tilesLoaded: this.map.areTilesLoaded(),
      activeStyleState: this.active ? {
        edition: this.active.scene.edition, generation: this.active.scene.generation,
        mainArchiveHash: this.active.stream?.sha256 ?? null,
        supplementArchiveHash: this.active.supplement?.stream.sha256 ?? null,
        selected: this.active.selected.map(id => ({ id, restored: !!this.map.getSource(this.active!.source)
          && this.map.getFeatureState({ source: this.active!.source, sourceLayer: 'territories', id }).selected === true })),
      } : null,
      readinessToken: this.staging ? { ...this.staging.token } : null,
      webgl: this.webglReport(),
      epochSourceGroups: Number(!!this.active?.stream) + Number(!!this.staging?.stream),
      committedGeneration: this.active?.scene.generation ?? null,
      pendingGeneration: this.staging?.scene.generation ?? null,
      cameraRevision: this.lifecycle.cameraRevision,
      rangeRequests: warmCache.requests,
      rangeBytes: warmCache.bytes,
      outstandingRanges: warmCache.outstanding,
      cachedChunks: warmCache.cachedChunks,
      warmCache,
      hoverQueries: this.hoverQueries,
      reusedScenes: this.reusedScenes,
      createdLabelNodes: this.createdLabelNodes,
      presentationUpdates: this.presentationUpdates,
      renderCallbacks: this.renderCallbacks,
      lastRenderCallback: this.lastRenderCallback,
      frameEvidence: 'MapLibre render callbacks; not proof of physical presentation.',
      view: this.getView(),
      labelNodeCount: this.markers.size, labelNodeLimit: MAX_VISIBLE_LABELS,
      tileCacheLimitPerSource: 64,
    };
  }

  private annotate(): void {
    if (!this.map || this.disposed) return;
    const canvas = this.map.getCanvas(), group = this.active;
    canvas.dataset.mapInstances = '1';
    canvas.dataset.epochSourceGroups = String(Number(!!this.active?.stream) + Number(!!this.staging?.stream));
    canvas.dataset.pendingGeneration = this.staging ? String(this.staging.scene.generation) : '';
    canvas.dataset.cameraRevision = String(this.lifecycle.cameraRevision);
    canvas.dataset.terrainVisible = String(this.terrainVisible());
    canvas.dataset.detailOverlay = String(!!this.detailFrame);
    canvas.dataset.teachingFeatures = String(this.teaching.getDiagnostics().activeFeatures);
    canvas.dataset.teachingDrawn = String(this.teaching.getDiagnostics().drawnFeatures);
    canvas.dataset.interpretiveBorders = String(this.interpretiveBorders);
    if (!group) return;
    canvas.dataset.generation = String(group.scene.generation); canvas.dataset.epoch = group.scene.epoch_id;
    canvas.dataset.time = String(group.scene.time); canvas.dataset.overlayTime = String(group.scene.overlayTime ?? group.scene.time); canvas.dataset.selectedRenderIds = [...group.selected].sort().join(','); canvas.dataset.selectedParts = String(group.selected.length);
    canvas.dataset.hoveredRenderIds = [...group.hovered].sort().join(','); canvas.dataset.hoveredParts = String(group.hovered.length);
    canvas.dataset.populationGeneration = this.layers.population ? canvas.dataset.generation : 'hidden';
    canvas.dataset.migrationGeneration = this.layers.migration ? canvas.dataset.generation : 'hidden';
  }
  private fit(): void { this.fitBounds(this.bounds); }
  /** Reload only trusted host basemaps; no query/model-provided URL can enter here.
   * Preserves the map instance, committed source edition, camera and selection.
   * Resolution means binding restoration; tile readiness is separately observed.
   */
  reloadBasemap(appearance: BasemapAppearance): Promise<void> {
    if (appearance !== 'paper' && appearance !== 'contrast') return Promise.reject(new Error('Unsupported host basemap.'));
    if (this.disposed) return Promise.reject(abortError());
    this.staging?.cancel();
    this.cancelHover();
    this.map.stop();
    this.styleLoading = true;
    const pending = this.styleReload.request(() => { this.map.setStyle(basemapStyle(appearance), { diff: false }); });
    this.stylePending = pending;
    void pending.finally(() => { if (this.stylePending === pending) this.stylePending = null; }).catch(() => undefined);
    return pending;
  }
  private restoreStyleBindings(): void {
    if (this.disposed) return;
    this.styleLoading = false;
    this.staging?.cancel();
    if (this.base) this.ensureBase(this.base);
    const group = this.active;
    if (group?.stream) {
      const selected = group.selected, hovered = group.hovered;
      this.mountGroup(group);
      this.paintGroup(group, true);
      // A new style has no feature-state; reapply even when identity is unchanged.
      this.applyState(group, [], selected, 'selected');
      this.applyState(group, [], hovered, 'hovered');
    }
    this.syncDetailTerrain();
    this.drawDetailOverlay();
    this.updateLabels();
    this.researchRenderer.paint(true);
    this.annotate();
    this.notifyView();
  }
  setResearchOverlay(input: ResearchOverlay | null, cursorYear: number, selectedId: string | null): void {
    if (this.disposed || !Number.isFinite(cursorYear)) return;
    this.researchRenderer.update(input, cursorYear, selectedId);
    if (this.styleLoading) return;
    void this.ready.then(() => { if (!this.disposed && !this.styleLoading) this.researchRenderer.paint(); }).catch(() => {});
  }
  fitResearchBounds(bounds: readonly [number, number, number, number]): void {
    if (this.disposed || !bounds.every(Number.isFinite) || bounds[0] > bounds[2] || bounds[1] > bounds[3]) return;
    const duration = this.motionPreference.reduced ? 0 : 350;
    if (bounds[0] === bounds[2] || bounds[1] === bounds[3]) this.map.easeTo({ center: [bounds[0], bounds[1]], zoom: 4, duration });
    else this.map.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: { top: 170, bottom: 40, left: this.host.clientWidth > 1000 ? 560 : 30, right: 30 }, maxZoom: 6, duration });
  }
  reset(): void { this.fit(); }
  /** Project host-owned temporary research markers; does not add sources or reset style. */
  projectCoordinates(coordinates: [number, number]): [number, number] | null {
    if (this.disposed || !coordinates.every(Number.isFinite) || Math.abs(coordinates[1]) > 85.05112878) return null;
    const point = this.map.project(coordinates); return [point.x, point.y];
  }
  getView(): { longitude: number; latitude: number; zoom: number; moving: boolean } {
    const center = this.map.getCenter();
    return { longitude: center.lng, latitude: center.lat, zoom: this.map.getZoom(), moving: this.map.isMoving() };
  }
  setView(view: { longitude: number; latitude: number; zoom: number }): void {
    if (![view.longitude, view.latitude, view.zoom].every(Number.isFinite)) throw new RangeError('Invalid geographic view.');
    this.map.jumpTo({ center: [Math.max(-180, Math.min(180, view.longitude)), Math.max(-85.05112878, Math.min(85.05112878, view.latitude))], zoom: Math.max(0, Math.min(10, view.zoom)) });
  }
  fitBounds(bounds: readonly [number, number, number, number]): void {
    if (!bounds.every(Number.isFinite) || bounds[1] >= bounds[3] || bounds[0] >= bounds[2]) throw new RangeError('Invalid geographic bounds.');
    this.map.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: { top: 105, bottom: 170, left: 50, right: this.host.clientWidth > 800 ? 290 : 25 }, duration: 0 });
  }
  private notifyView(): void { this.host.dispatchEvent(new CustomEvent('camera-change', { detail: this.getView() })); }
  /** Only actual rendered polygons participate; detached text labels are excluded. */
  hitsAtCoordinates(coordinates: readonly [number, number]): string[] {
    if (!coordinates.every(Number.isFinite)) return [];
    const point = this.map.project([...coordinates] as [number, number]);
    return [...new Set(this.queryTerritories(point).map(hit => String(hit.render_id)))];
  }
  /** The resolver proved layer eligibility unchanged; no source, style or label work. */
  updatePresentation(scene: SceneSnapshot): void {
    const previous = this.active?.scene;
    if (!previous || scene.edition !== previous.edition || scene.epoch_id !== previous.epoch_id
      || scene.territories !== previous.territories || scene.parts !== previous.parts
      || scene.population !== previous.population || scene.migration !== previous.migration
      || scene.stream !== previous.stream || scene.supplement?.stream !== previous.supplement?.stream) {
      throw new Error('MapLibre presentation updates require an unchanged rendered scene.');
    }
    this.active!.scene = scene;
    this.presentationUpdates++;
    this.annotate();
  }
  /** Stable within the same loaded tile footprint, even during sub-tile panning. */
  private coverageKey(group: SceneGroup): string {
    const bounds = this.map.getBounds();
    const clampLatitude = (latitude: number) => Math.max(-85.05112878, Math.min(85.05112878, latitude));
    const range = (stream: Stream) => {
      const zoom = Math.max(stream.minzoom, Math.min(stream.maxzoom, Math.floor(this.map.getZoom()))), count = 2 ** zoom;
      const x = (longitude: number) => Math.max(0, Math.min(count - 1, Math.floor((longitude + 180) / 360 * count)));
      const y = (latitude: number) => {
        const rad = clampLatitude(latitude) * Math.PI / 180;
        return Math.max(0, Math.min(count - 1, Math.floor((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * count)));
      };
      return [stream.sha256, zoom, x(bounds.getWest()), x(bounds.getEast()), y(bounds.getNorth()), y(bounds.getSouth())];
    };
    return JSON.stringify([this.node.clientWidth, this.node.clientHeight, ...[this.base, group.stream, group.supplement?.stream].filter((stream): stream is Stream => !!stream).map(range)]);
  }
  /** Metadata chooses the neighbors; prefetch never creates GPU source groups. */
  prefetchNeighbors(streams: readonly Stream[], edition: string): Promise<void> {
    if (this.disposed) return Promise.resolve();
    return archives.prefetchNeighbors(streams.map(archive => ({ archive, edition })));
  }
  /** Both neighbors form one cancellation unit even across recorded editions. */
  prefetchArchives(requests: readonly { archive: VectorArchiveDescriptor; edition: string }[]): Promise<void> {
    if (this.disposed) return Promise.resolve();
    return archives.prefetchNeighbors(requests);
  }
  destroy(): void {
    if (this.disposed) return;
    this.staging?.cancel();
    this.styleReload.dispose();
    this.motionPreference.dispose();
    this.cancelHover();
    archives.cancelPrefetch();
    this.lifetime.abort();
    if (this.active) this.removeGroup(this.active);
    if (this.base) archives.release(this.base, baseEdition(this.base));
    this.active = null; this.base = undefined; this.disposed = true;
    for (const { marker } of this.markers.values()) marker.remove();
    this.markers.clear(); this.researchRenderer.clear(); this.map.remove(); this.node.remove();
    this.detailPainter.destroy(); this.detailOverlay.remove();
  }
}
