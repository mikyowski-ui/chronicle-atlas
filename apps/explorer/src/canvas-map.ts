import { DetailCanvas } from './detail-canvas.ts';
import type { DetailFrame } from './detail-context.ts';
import type { Feature, MultiPolygon, Polygon, Position } from 'geojson';
import { chooseSceneLabels, placeLabels } from './labels.ts';
import type { SceneSnapshot, TerritoryFeature } from '../../../packages/contracts/src/index.ts';
import { displayKind, DISPLAY_STYLES, orderDisplayFeatures } from './display-style.ts';
import { TeachingOverlay } from './teaching-overlay.ts';
import type { TeachingFeature } from './teaching-data.ts';
import { CanvasResearchAdapter } from '@chronicle/view-adapters/canvas';
import type { ResearchOverlay } from '@chronicle/view-adapters/spatial';

export type EntityStyle = { name: string; color: string; position: [number, number]; number: string };
export type Camera = { x: number; y: number; scale: number };
export type GeographicView = { longitude: number; latitude: number; zoom: number; moving: boolean };
export type GeographicInspection = { coordinates: [number, number]; renderIds: string[]; mode: 'place' | 'polity' };
export type BaseGeographyFeature = Feature<Polygon | MultiPolygon>;
const limit = 85.05112878;
const minimumScale = 512;
const maximumScale = 50000;
export function mercator([lon, lat]: number[]): [number, number] {
  const radians = Math.max(-limit, Math.min(limit, lat)) * Math.PI / 180;
  return [(lon + 180) / 360, (1 - Math.log(Math.tan(Math.PI / 4 + radians / 2)) / Math.PI) / 2];
}

/** Invert the actual pointed world coordinate, including repeated world copies. */
export function inverseMercator([x, y]: readonly [number, number]): [number, number] {
  const longitude = ((x * 360) % 360 + 360) % 360 - 180;
  const latitude = Math.atan(Math.sinh(Math.PI * (1 - 2 * Math.max(0, Math.min(1, y))))) * 180 / Math.PI;
  return [longitude, latitude];
}

export function cameraCoordinates(camera: Camera, width: number, height: number, x: number, y: number): [number, number] {
  return inverseMercator([camera.x + (x - width / 2) / camera.scale, camera.y + (y - height / 2) / camera.scale]);
}

/** Preserve a 360-degree world span; east < west denotes a seam-crossing extent. */
export function mercatorBounds(bounds: readonly [number, number, number, number]): { left: number; right: number; top: number; bottom: number } {
  const [west, south, east, north] = bounds;
  if (!bounds.every(Number.isFinite) || south >= north || south < -90 || north > 90 || Math.abs(east - west) > 360) throw new RangeError('Invalid geographic bounds.');
  const [left, top] = mercator([west, north]);
  const [rawRight, bottom] = mercator([east, south]);
  let span = rawRight - left;
  if (span < 0) span += Math.ceil(-span);
  if (span === 0 && west !== east) span = 1;
  if (span <= 0 || span > 1) throw new RangeError('Geographic bounds must span at most one world.');
  return { left, right: left + span, top, bottom };
}

/** Unwrap once per ring and place holes in the same world copy as their shell. */
export function projectedPolygonRings(coordinates: Position[][], cameraX: number): [number, number][][] {
  let shellCentre: number | undefined;
  return coordinates.map(ring => {
    const unwrapped: [number, number][] = [];
    for (const [index, p] of ring.entries()) {
      const [rawX, y] = mercator(p);
      const previous = unwrapped.at(-1)?.[0];
      // +180 and -180 describe the same meridian for a narrow seam island,
      // but an explicit 360° edge is a full-width map/polar boundary. Short-arc
      // unwrapping would otherwise collapse Antarctica's bottom edge to zero.
      const previousPoint = ring[index - 1];
      const fullWidth = previousPoint && Math.abs(Math.abs(p[0] - previousPoint[0]) - 360) < 1e-9;
      const x = previous === undefined ? rawX : fullWidth
        ? rawX + Math.round(previous - mercator(previousPoint)[0])
        : rawX + Math.round(previous - rawX);
      unwrapped.push([x, y]);
    }
    if (!unwrapped.length) return unwrapped;
    let minX = Infinity, maxX = -Infinity;
    for (const [x] of unwrapped) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
    const centre = (minX + maxX) / 2;
    const shift = Math.round((shellCentre ?? cameraX) - centre);
    const positioned = unwrapped.map(([x, y]) => [x + shift, y] as [number, number]);
    shellCentre ??= centre + shift;
    return positioned;
  });
}

/** Geographic picking ignores label rectangles and does not depend on viewport paths. */
export function geometryContainsCoordinates(geometry: Polygon | MultiPolygon, coordinates: readonly [number, number]): boolean {
  if (!coordinates.every(Number.isFinite) || Math.abs(coordinates[1]) > limit) return false;
  const [x, y] = mercator([...coordinates]);
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some(polygon => {
    const rings = projectedPolygonRings(polygon, x);
    let inside = false;
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [ax, ay] = ring[j], [bx, by] = ring[i];
        const cross = (x - ax) * (by - ay) - (y - ay) * (bx - ax);
        // Shared borders may yield multiple candidates; the existing resolver decides.
        if (Math.abs(cross) <= 1e-12 && x >= Math.min(ax, bx) - 1e-12 && x <= Math.max(ax, bx) + 1e-12
          && y >= Math.min(ay, by) - 1e-12 && y <= Math.max(ay, by) + 1e-12) return true;
        if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
      }
    }
    return inside;
  });
}

type LabelHit = { entityId: string; left: number; right: number; top: number; bottom: number };
type ProjectedPolygon = { path: Path2D; bounds: readonly [number, number, number, number] };
const sameItems = <T>(left: readonly T[], right: readonly T[]) => left.length===right.length && left.every((value,index)=>value===right[index]);

/** Conservative CSS-pixel culling: clipping never changes source geometry or picks. */
export function intersectsViewport(bounds: readonly [number, number, number, number], width: number, height: number, margin = 4): boolean {
  return bounds[2] >= -margin && bounds[0] <= width + margin && bounds[3] >= -margin && bounds[1] <= height + margin;
}

/** Inputs are immutable source objects. A camera change drops the whole weak cache. */
export class GeometryProjectionCache<T> {
  private cameraKey = '';
  private cache = new WeakMap<Polygon | MultiPolygon, T>();
  builds = 0;
  get(geometry: Polygon | MultiPolygon, cameraKey: string, project: (geometry: Polygon | MultiPolygon) => T): T {
    if (cameraKey !== this.cameraKey) { this.cameraKey = cameraKey; this.cache = new WeakMap(); }
    const previous = this.cache.get(geometry);
    if (previous !== undefined) return previous;
    const projected = project(geometry); this.cache.set(geometry, projected); this.builds++;
    return projected;
  }
}

/** Same Web Mercator coordinates as the GL view; no temporal border interpolation. */
export class CanvasMap {
  readonly canvas = document.createElement('canvas');
  private context: CanvasRenderingContext2D;
  private detail = new DetailCanvas(()=>this.draw());
  private detailFrame:DetailFrame|null=null;
  private teaching = new TeachingOverlay();
  private readonly researchRenderer = new CanvasResearchAdapter(() => this.draw());
  private interpretiveBorders = false;
  private camera: Camera = { x: 0.5, y: 0.36, scale: 2000 };
  private width = 1;
  private height = 1;
  private features: readonly TerritoryFeature[] = [];
  private baseGeography: readonly BaseGeographyFeature[] = [];
  private baseProjectionKey = '';
  private basePaths: readonly ProjectedPolygon[] = [];
  private baseProjectionBuilds = 0;
  private scene: SceneSnapshot | null = null;
  private visibleLayers = { population: false, migration: false };
  private selected = new Set<string>();
  private hovered = new Set<string>();
  private paths = new Map<string, Path2D>();
  private projectedTerritories = new Map<string, ProjectedPolygon>();
  private geometryProjectionCache = new GeometryProjectionCache<ProjectedPolygon>();
  private territoryProjectionKey = '';
  private territoryProjectionFeatures: readonly TerritoryFeature[] | null = null;
  private territoryProjectionBuilds = 0;
  private labels: ReturnType<typeof chooseSceneLabels> = [];
  private migrationPaths = new Map<string, Path2D>();
  private labelHits: LabelHit[] = [];
  private lastHoverHit = '';
  private drawTimes: number[] = [];
  private drawCount = 0;
  private detailPaintReuses = 0;
  private lastDrawAt: number | null = null;
  private lastViewKey = '';
  private resizeObserver: ResizeObserver;
  private controller = new AbortController();
  private down: { x: number; y: number; camera: Camera; moved: boolean } | null = null;
  private teachingFeatures: readonly TeachingFeature[] = [];
  private teachingSelection: string | undefined;

  constructor(
    private container: HTMLElement,
    private entities: Record<string, EntityStyle>,
    private pick: (ids: string[]) => void,
    private bounds: readonly [number, number, number, number] = [-24, 28, 24, 57],
    private hover?: (ids: string[]) => void,
    private pickMigration?: (renderId: string) => void,
    private inspect?: (hit: GeographicInspection) => void,
  ) {
    this.canvas.className = 'flat-canvas';
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('aria-label', 'Territory map. Drag to pan, plus and minus to zoom, up and down to pan, left and right to step observations, Space to play or pause.');
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is unavailable.');
    this.context = context;
    container.replaceChildren(this.canvas);
    const controls = document.createElement('div');
    controls.className = 'canvas-navigation';
    controls.innerHTML = '<button aria-label="Zoom in">+</button><button aria-label="Zoom out">−</button>';
    const options = { signal: this.controller.signal };
    controls.children[0].addEventListener('click', () => this.zoom(1.3), options);
    controls.children[1].addEventListener('click', () => this.zoom(1 / 1.3), options);
    container.append(controls);
    this.canvas.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      this.canvas.focus();
      this.canvas.setPointerCapture(e.pointerId);
      this.down = { x: e.clientX, y: e.clientY, camera: { ...this.camera }, moved: false };
    }, options);
    this.canvas.addEventListener('pointermove', e => {
      if (!this.down) {
        const [x, y] = this.pointerPosition(e);
        this.notifyHover(this.territoryHits(x, y));
        this.canvas.style.cursor = this.researchRenderer.pick([x, y], point => this.projectCoordinates(point)) || this.lastHoverHit || this.migrationHit(x, y) ? 'pointer' : 'grab';
        return;
      }
      const dx = e.clientX - this.down.x, dy = e.clientY - this.down.y;
      this.down.moved ||= Math.hypot(dx, dy) > 4;
      if (!this.down.moved) return;
      const x = this.down.camera.x - dx / this.camera.scale;
      const y = Math.max(0, Math.min(1, this.down.camera.y - dy / this.camera.scale));
      if (x === this.camera.x && y === this.camera.y) return;
      this.notifyHover([]); this.canvas.style.cursor = 'grabbing';
      this.camera.x = x; this.camera.y = y;
      this.draw();
      this.notifyView();
    }, options);
    this.canvas.addEventListener('pointerup', e => {
      if (!this.down) return;
      const [x, y] = this.pointerPosition(e);
      if (!this.down.moved) {
        const research = this.researchRenderer.pick([x, y], point => this.projectCoordinates(point));
        if (research) this.container.dispatchEvent(new CustomEvent('research-map-select', { detail: { entityId: research.entityId, observationId: research.observationId, revision: research.revision } }));
        else {
          const renderIds = this.territoryHits(x, y);
          const coordinates = this.coordinatesAt(x, y);
          this.inspect?.({ coordinates, renderIds: this.hitsAtCoordinates(coordinates), mode: 'place' });
          const migration = this.migrationHit(x, y);
          if (migration && this.pickMigration) this.pickMigration(migration);
          else if (!this.inspect) this.pick(renderIds);
        }
      }
      this.down = null;
      if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
      this.notifyHover(this.territoryHits(x, y));
      this.canvas.style.cursor = this.researchRenderer.pick([x, y], point => this.projectCoordinates(point)) || this.lastHoverHit ? 'pointer' : 'grab';
      this.notifyView();
    }, options);
    this.canvas.addEventListener('pointercancel', () => { this.down = null; this.notifyHover([]); this.notifyView(); }, options);
    this.canvas.addEventListener('contextmenu', e => {
      if (!this.inspect) return;
      e.preventDefault();
      const [x, y] = this.pointerPosition(e);
      const coordinates = this.coordinatesAt(x, y);
      this.inspect({ coordinates, renderIds: this.hitsAtCoordinates(coordinates), mode: 'polity' });
    }, options);
    this.canvas.addEventListener('pointerleave', () => { if (!this.down) this.notifyHover([]); }, options);
    this.canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const [x, y] = this.pointerPosition(e);
      this.zoom(Math.exp(-e.deltaY * .0015), x, y);
      this.notifyHover(this.territoryHits(x, y));
    }, { ...options, passive: false });
    this.canvas.addEventListener('keydown', e => {
      // Left/right belong to supported-date navigation in the application shell.
      if (!['+', '=', '-', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      e.preventDefault();
      if (e.key === '+' || e.key === '=') this.zoom(1.3);
      if (e.key === '-') this.zoom(1 / 1.3);
      if (e.key === 'ArrowUp') this.camera.y = Math.max(0, this.camera.y - 50 / this.camera.scale);
      if (e.key === 'ArrowDown') this.camera.y = Math.min(1, this.camera.y + 50 / this.camera.scale);
      this.notifyHover([]);
      this.draw();
      this.notifyView();
    }, options);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.reset();
  }

  setDetailContext(frame:DetailFrame){
    const previous=this.detailFrame;this.detailFrame=frame;
    // Always refresh dated metadata. Inspection resolves current records even
    // when the exact current camera's rendered pixels need no replacement.
    this.detail.setFrame(frame);
    if(previous && this.detail.canReusePaint(previous,frame,this.camera,this.width,this.height)){this.detailPaintReuses++;return;}
    this.draw();
  }
  /** Features have already been filtered to the requested date by the study model. */
  setTeachingFeatures(features: readonly TeachingFeature[], selectedId?: string) {
    if(selectedId===this.teachingSelection && features.length===this.teachingFeatures.length
      && features.every((feature,index)=>feature===this.teachingFeatures[index]))return;
    this.teachingFeatures=features;this.teachingSelection=selectedId;this.teaching.setFeatures(features, selectedId); this.draw();
  }
  /** A presentation convention; this does not infer control from source polygons. */
  setInterpretiveBorders(enabled: boolean) { if (this.interpretiveBorders === enabled) return; this.interpretiveBorders = enabled; this.draw(); }
  setFeatures(features: readonly TerritoryFeature[]) { this.features = orderDisplayFeatures(features); this.draw(); }
  setScene(scene: SceneSnapshot) {
    const features=orderDisplayFeatures(scene.territories),labels=chooseSceneLabels(scene);
    const previous=this.scene;
    const unchanged=previous && previous.edition===scene.edition && previous.entities===scene.entities && sameItems(this.features,features)
      && (!this.visibleLayers.population || sameItems(previous.population,scene.population))
      && (!this.visibleLayers.migration || sameItems(previous.migration,scene.migration))
      && this.labels.length===labels.length && this.labels.every((label,index)=>{
        const next=labels[index];return label.label_id===next.label_id && label.entity_id===next.entity_id
          && label.text===next.text && label.priority===next.priority && label.displayKind===next.displayKind
          && label.position[0]===next.position[0] && label.position[1]===next.position[1];
      }) && !this.hovered.size;
    this.scene = scene;
    if(unchanged){this.stampScene();return;}
    this.features = features;
    this.labels = labels;
    this.hovered.clear(); this.lastHoverHit = '';
    this.draw();
  }
  /** Only temporal stamps change here. The caller already resolved the same scene. */
  updatePresentation(scene: SceneSnapshot) {
    if (!this.scene || scene.edition !== this.scene.edition || scene.epoch_id !== this.scene.epoch_id
      || scene.territories !== this.scene.territories || scene.population !== this.scene.population || scene.migration !== this.scene.migration) {
      throw new Error('Canvas presentation updates require an unchanged rendered scene.');
    }
    this.scene = scene;
    this.stampScene();
  }
  setBaseGeography(features: readonly BaseGeographyFeature[]) {
    if (features === this.baseGeography) return;
    this.baseGeography = features;
    this.baseProjectionKey = '';
    this.basePaths = [];
    this.draw();
  }
  setLayers(layers: { population: boolean; migration: boolean }) {
    if (layers.population === this.visibleLayers.population && layers.migration === this.visibleLayers.migration) return;
    this.visibleLayers = { ...layers }; this.draw();
  }
  setSelected(ids: readonly string[]) {
    const next = new Set(ids);
    if (next.size === this.selected.size && [...next].every(id => this.selected.has(id))) return;
    this.selected = next; this.draw();
  }
  setHovered(ids: readonly string[]) {
    const next = new Set(ids);
    if (next.size === this.hovered.size && [...next].every(id => this.hovered.has(id))) return;
    this.hovered = next;
    this.draw();
  }
  getCamera() { return { ...this.camera }; }
  /** Project host-owned temporary research markers without changing historical layers. */
  projectCoordinates(coordinates: [number, number]): [number, number] | null {
    if (!coordinates.every(Number.isFinite) || Math.abs(coordinates[1]) > limit) return null;
    return this.project(coordinates);
  }
  hitsAtCoordinates(coordinates: readonly [number, number]): string[] {
    return this.features.filter(feature => geometryContainsCoordinates(feature.geometry, coordinates))
      .map(feature => feature.properties.render_id);
  }
  getView(): GeographicView {
    const [longitude, latitude] = inverseMercator([this.camera.x, this.camera.y]);
    return { longitude, latitude, zoom: Math.log2(this.camera.scale / 512), moving: !!this.down?.moved };
  }
  setView(view: Pick<GeographicView, 'longitude' | 'latitude' | 'zoom'>) {
    if (![view.longitude, view.latitude, view.zoom].every(Number.isFinite)) throw new RangeError('Invalid geographic view.');
    const [x, y] = mercator([view.longitude, view.latitude]);
    this.camera = { x, y: Math.max(0, Math.min(1, y)), scale: Math.max(minimumScale, Math.min(maximumScale, 512 * 2 ** view.zoom)) };
    this.notifyHover([]);
    this.draw();
    this.notifyView();
  }
  setResearchOverlay(data: ResearchOverlay | null, year: number, selected: string | null): void {
    if (!this.controller.signal.aborted) this.researchRenderer.update(data, year, selected);
  }
  fitResearchBounds(bounds: readonly [number, number, number, number]): void {
    if (bounds[0] === bounds[2] || bounds[1] === bounds[3]) this.setView({ longitude: bounds[0], latitude: bounds[1], zoom: 4 });
    else this.fitBounds(bounds);
  }
  getDiagnostics() {
    const sorted = this.drawTimes.slice().sort((a, b) => a - b);
    return {
      researchOverlay: this.researchRenderer.getDiagnostics(),
      detail: this.detail.getDiagnostics(),
      teaching: this.teaching.getDiagnostics(), interpretiveBorders: this.interpretiveBorders,
      renderer: 'Canvas 2D', mapInstances: 0, drawCount: this.drawCount,
      detailPaintReuses:this.detailPaintReuses,
      recentDraws: sorted.length, drawP95Ms: sorted[Math.max(0, Math.ceil(sorted.length * .95) - 1)] ?? 0,
      activeParts: this.features.length, baseFeatures: this.baseGeography.length,
      baseProjectionBuilds: this.baseProjectionBuilds, cachedBasePaths: this.basePaths.length,
      territoryProjectionBuilds: this.territoryProjectionBuilds, cachedTerritoryPaths: this.paths.size,
      geometryProjectionBuilds: this.geometryProjectionCache.builds,
      selectedParts: this.features.filter(f => this.selected.has(f.properties.render_id)).length,
      hoveredParts: this.features.filter(f => this.hovered.has(f.properties.render_id)).length,
      width: this.width, height: this.height, pixelRatio: devicePixelRatio,
      lastDrawAt: this.lastDrawAt, drawEvidence: 'CPU Canvas draw completion; not physical presentation',
      view: this.getView(),
    };
  }
  reset() {
    this.fitBounds(this.bounds);
  }
  fitBounds(bounds: readonly [number, number, number, number]) {
    const extent = mercatorBounds(bounds);
    const right = this.width > 800 ? 320 : 25, left = this.width > 800 ? 55 : 25;
    const top = 100, bottom = this.width > 800 ? 150 : 210;
    this.camera.scale = Math.max(minimumScale, Math.min(maximumScale, Math.max(80, this.width - left - right) / (extent.right - extent.left), Math.max(80, this.height - top - bottom) / (extent.bottom - extent.top)));
    this.camera.x = (extent.left + extent.right) / 2 + (right - left) / (2 * this.camera.scale);
    this.camera.y = Math.max(0, Math.min(1, (extent.top + extent.bottom) / 2 + (bottom - top) / (2 * this.camera.scale)));
    this.notifyHover([]);
    this.draw();
    this.notifyView();
  }
  private coordinatesAt(x: number, y: number) { return cameraCoordinates(this.camera, this.width, this.height, x, y); }
  private notifyView() {
    const view = this.getView();
    const key = JSON.stringify(view);
    if (key === this.lastViewKey) return;
    this.lastViewKey = key;
    this.container.dispatchEvent(new CustomEvent('camera-change', { detail: view }));
  }
  private pointerPosition(event: MouseEvent): [number, number] {
    const rect = this.canvas.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  }
  private entityParts(entityId: string) {
    const properties = this.scene?.parts?.map(part => part.properties) ?? this.features.map(feature => feature.properties);
    return properties.filter(part => part.entity_id === entityId
      && (!this.scene || part.t_start <= this.scene.time && this.scene.time < part.t_end))
      .map(part => part.render_id);
  }
  private territoryHits(x: number, y: number): string[] {
    // Labels deliberately remain pickable even when an island is smaller than a pointer.
    const label = this.labelHits.find(box => x >= box.left && x <= box.right && y >= box.top && y <= box.bottom);
    if (label) return this.entityParts(label.entityId);
    return this.features.filter(feature => {
      const path = this.paths.get(feature.properties.render_id);
      return path && this.context.isPointInPath(path, x * devicePixelRatio, y * devicePixelRatio, 'evenodd');
    }).map(feature => feature.properties.render_id);
  }
  private migrationHit(x: number, y: number): string | undefined {
    if (!this.visibleLayers.migration || !this.pickMigration) return;
    const ctx = this.context;
    ctx.save(); ctx.lineWidth = 12;
    const hit = [...this.migrationPaths].find(([, path]) => ctx.isPointInStroke(path, x * devicePixelRatio, y * devicePixelRatio))?.[0];
    ctx.restore();
    return hit;
  }
  private notifyHover(ids: string[]) {
    const key = ids.slice().sort().join(',');
    if (key === this.lastHoverHit) return;
    this.lastHoverHit = key;
    this.hover?.(ids);
  }
  private zoom(factor: number, x = this.width / 2, y = this.height / 2) {
    const before = this.camera.scale;
    this.camera.scale = Math.max(minimumScale, Math.min(maximumScale, before * factor));
    this.camera.x += (x - this.width / 2) * (1 / before - 1 / this.camera.scale);
    this.camera.y = Math.max(0, Math.min(1, this.camera.y + (y - this.height / 2) * (1 / before - 1 / this.camera.scale)));
    this.draw();
    this.notifyView();
  }
  private resize() {
    this.width = this.container.clientWidth;
    this.height = this.container.clientHeight;
    this.canvas.width = Math.round(this.width * devicePixelRatio);
    this.canvas.height = Math.round(this.height * devicePixelRatio);
    this.notifyHover([]);
    this.draw();
  }
  private project(position: number[]): [number, number] {
    const [rawX, y] = mercator(position);
    const x = rawX + Math.round(this.camera.x - rawX);
    return [(x - this.camera.x) * this.camera.scale + this.width / 2, (y - this.camera.y) * this.camera.scale + this.height / 2];
  }
  private projectPolygon(geometry: Polygon | MultiPolygon): ProjectedPolygon {
    const path = new Path2D();
    let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    for (const polygon of polygons) for (const ring of projectedPolygonRings(polygon, this.camera.x)) {
      ring.forEach(([u, v], i) => {
        const x = (u - this.camera.x) * this.camera.scale + this.width / 2;
        const y = (v - this.camera.y) * this.camera.scale + this.height / 2;
        left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);
        if (!i) path.moveTo(x, y); else path.lineTo(x, y);
      });
      path.closePath();
    }
    return {path,bounds:[left,top,right,bottom]};
  }
  private polygonPath(geometry: Polygon | MultiPolygon): Path2D { return this.projectPolygon(geometry).path; }
  private projectedBasePaths(): readonly ProjectedPolygon[] {
    // Path coordinates are CSS pixels. Device-pixel scaling remains in the context,
    // so style, selection, layer, and historical changes reuse these exact paths.
    const key = [this.camera.x, this.camera.y, this.camera.scale, this.width, this.height].join(':');
    if (key !== this.baseProjectionKey) {
      this.basePaths = this.baseGeography.map(feature => this.projectPolygon(feature.geometry));
      this.baseProjectionKey = key;
      this.baseProjectionBuilds++;
    }
    return this.basePaths;
  }
  private projectTerritories(): void {
    const key = [this.camera.x, this.camera.y, this.camera.scale, this.width, this.height].join(':');
    if (key === this.territoryProjectionKey && this.features === this.territoryProjectionFeatures) return;
    // New exact/reference array wrappers still contain the same immutable geometry.
    // Reuse those paths, while replacement geometry and camera changes rebuild.
    this.paths.clear();
    this.projectedTerritories.clear();
    for (const feature of this.features) {
      const projected=this.geometryProjectionCache.get(feature.geometry,key,geometry=>this.projectPolygon(geometry));
      this.paths.set(feature.properties.render_id,projected.path);
      this.projectedTerritories.set(feature.properties.render_id,projected);
    }
    this.territoryProjectionFeatures = this.features;
    this.territoryProjectionKey = key;
    this.territoryProjectionBuilds++;
  }
  draw() {
    const started = performance.now();
    const ctx = this.context;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.fillStyle = '#e4edf0'; ctx.fillRect(0, 0, this.width, this.height);
    for (const {path,bounds} of this.projectedBasePaths()) {
      if(!intersectsViewport(bounds,this.width,this.height))continue;
      ctx.fillStyle = '#dddcd1'; ctx.fill(path, 'evenodd');
      ctx.strokeStyle = '#b7c4bd'; ctx.lineWidth = .65; ctx.stroke(path);
    }
    this.detail.drawTerrain(ctx,this.camera,this.width,this.height);
    this.projectTerritories();
    for (const f of this.features) {
      if(!intersectsViewport(this.projectedTerritories.get(f.properties.render_id)!.bounds,this.width,this.height))continue;
      const path = this.paths.get(f.properties.render_id)!;
      const kind = displayKind(f.properties), style = DISPLAY_STYLES[kind];
      ctx.fillStyle = kind === 'context' ? '#b8ae99' : (this.scene?.entities ?? this.entities)[f.properties.entity_id]?.color ?? '#b4c6bf';
      ctx.globalAlpha = this.detailFrame?.terrain && this.detailFrame?.options.terrain && kind==='political' ? .4 : style.opacity;
      ctx.fill(path, 'evenodd');
      ctx.globalAlpha = 1;
      // Each type's boundary is painted with its fill. Later political fills
      // mask underlying context lines instead of inheriting an ownership look.
      ctx.strokeStyle = style.stroke; ctx.lineWidth = this.scene?.edition.startsWith('meridian') ? 1.25 : style.lineWidth;
      const porous = this.interpretiveBorders && kind === 'political';
      ctx.globalAlpha = porous ? .5 : 1;
      ctx.setLineDash(porous ? [4, 3] : [...style.dash]); ctx.stroke(path); ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
    if (this.scene && this.visibleLayers.population) for (const f of this.scene.population) {
      const path = this.polygonPath(f.geometry);
      const intensity = Math.min(.78, .08 + f.properties.density / 400 * .7);
      ctx.fillStyle = `rgba(198,58,40,${intensity})`; ctx.fill(path, 'evenodd');
      ctx.strokeStyle = '#fff8'; ctx.lineWidth = .5; ctx.stroke(path);
    }
    for (const f of this.features) {
      const id = f.properties.render_id, selected = this.selected.has(id), hovered = this.hovered.has(id);
      if (!selected && !hovered) continue;
      const path = this.paths.get(id)!;
      if (hovered) { ctx.fillStyle = '#ffffff45'; ctx.fill(path, 'evenodd'); }
      ctx.strokeStyle = selected ? '#123f37' : '#315c50'; ctx.lineWidth = selected ? 2.5 : 2;
      ctx.setLineDash(this.interpretiveBorders && displayKind(f.properties) === 'political' ? [6, 4] : [...DISPLAY_STYLES[displayKind(f.properties)].dash]); ctx.stroke(path); ctx.setLineDash([]);
    }
    this.migrationPaths.clear();
    if (this.scene && this.visibleLayers.migration) for (const f of this.scene.migration) {
      const points = f.geometry.coordinates.map(p => this.project(p));
      if (points.length < 2) continue;
      const path = new Path2D();
      points.forEach(([x, y], i) => { if (!i) path.moveTo(x, y); else path.lineTo(x, y); });
      this.migrationPaths.set(f.properties.render_id, path);
      ctx.strokeStyle = '#763e9d'; ctx.lineWidth = 3; ctx.setLineDash([8, 5]);
      ctx.stroke(path); ctx.setLineDash([]);
      const [x, y] = points.at(-1)!, prev = points.at(-2)!;
      const angle = Math.atan2(y - prev[1], x - prev[0]);
      ctx.fillStyle = '#763e9d'; ctx.beginPath(); ctx.moveTo(x, y);
      ctx.lineTo(x - 13 * Math.cos(angle - .45), y - 13 * Math.sin(angle - .45));
      ctx.lineTo(x - 13 * Math.cos(angle + .45), y - 13 * Math.sin(angle + .45)); ctx.closePath(); ctx.fill();
    }
    this.teaching.draw(ctx,this.camera,this.width,this.height);
    this.detail.drawOverlay(ctx,this.camera,this.width,this.height);
    this.teaching.drawLabel(ctx,(x,y,width,height)=>this.detail.overlapsCityLabel(x,y,width,height));
    const detailStats=this.detail.getDiagnostics();
    this.canvas.dataset.detailCities=String(detailStats.visibleCityLabels);
    this.canvas.dataset.detailTiles=String(detailStats.rasterTilesDrawn);
    this.canvas.dataset.detailPopulationYear=String(detailStats.populationYear??'');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '17px Georgia';
    const labels = this.scene ? placeLabels(this.labels, p => this.project([...p]), this.width, this.height, text => ctx.measureText(text).width)
      .filter(label=>!this.detail.overlapsCityLabel(label.x,label.y,ctx.measureText(label.text).width+12)
        && !this.teaching.overlapsLabel(label.x,label.y,ctx.measureText(label.text).width+12)) : [];
    this.labelHits = labels.map(label => ({ entityId: label.entity_id, left: label.x - ctx.measureText(label.text).width / 2 - 6, right: label.x + ctx.measureText(label.text).width / 2 + 6, top: label.y - 18, bottom: label.y + 18 }));
    for (const label of labels) {
      ctx.font = label.displayKind === 'political' || !label.displayKind ? '17px Georgia' : 'italic 17px Georgia';
      ctx.lineWidth = 4; ctx.strokeStyle = '#fbfaf6de'; ctx.strokeText(label.text, label.x, label.y);
      ctx.fillStyle = label.displayKind === 'context' ? '#777064' : label.displayKind === 'cultural' ? '#7b654b' : '#294b45'; ctx.fillText(label.text, label.x, label.y);
    }
    this.researchRenderer.draw(ctx, point => this.projectCoordinates(point));
    const research = this.researchRenderer.getDiagnostics();
    this.canvas.dataset.researchFeatures = String(research.features); this.canvas.dataset.researchVisible = String(research.visible);
    const activeIds = new Set(this.features.map(feature => feature.properties.render_id));
    const selected = [...this.selected].filter(id => activeIds.has(id)).sort();
    const hovered = [...this.hovered].filter(id => activeIds.has(id)).sort();
    this.canvas.dataset.labelCount = String(labels.length);
    this.canvas.dataset.labelEntities = labels.map(label => label.entity_id).join(',');
    this.canvas.dataset.renderedParts = String(this.features.length);
    this.canvas.dataset.baseFeatures = String(this.baseGeography.length);
    this.canvas.dataset.baseProjectionBuilds = String(this.baseProjectionBuilds);
    this.canvas.dataset.territoryProjectionBuilds = String(this.territoryProjectionBuilds);
    this.canvas.dataset.selectedParts = String(selected.length);
    this.canvas.dataset.selectedRenderIds = selected.join(',');
    this.canvas.dataset.hoveredParts = String(hovered.length);
    this.canvas.dataset.hoveredRenderIds = hovered.join(',');
    this.canvas.dataset.teachingFeatures = String(this.teaching.getDiagnostics().activeFeatures);
    this.canvas.dataset.teachingDrawn = String(this.teaching.getDiagnostics().drawnFeatures);
    this.canvas.dataset.interpretiveBorders = String(this.interpretiveBorders);
    this.stampScene();
    this.drawCount++;
    this.drawTimes.push(performance.now() - started);
    this.lastDrawAt = performance.now();
    this.canvas.dataset.lastDrawAt = String(this.lastDrawAt);
    if (this.drawTimes.length > 60) this.drawTimes.shift();
    const output = document.getElementById('camera-readout');
    if (output) output.textContent = `Zoom ${(Math.log2(this.camera.scale / 512)).toFixed(1)} · Canvas 2D`;
  }
  private stampScene() {
    this.canvas.dataset.generation = String(this.scene?.generation ?? 0);
    this.canvas.dataset.epoch = this.scene?.epoch_id ?? 'initial';
    this.canvas.dataset.populationGeneration = this.visibleLayers.population ? this.canvas.dataset.generation : 'hidden';
    this.canvas.dataset.migrationGeneration = this.visibleLayers.migration ? this.canvas.dataset.generation : 'hidden';
    this.canvas.dataset.time = String(this.scene?.time ?? '');
  }
  destroy() { this.researchRenderer.clear(); this.detail.destroy(); this.controller.abort(); this.resizeObserver.disconnect(); this.container.replaceChildren(); }
}
