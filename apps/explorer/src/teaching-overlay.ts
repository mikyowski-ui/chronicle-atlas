import type { Position } from 'geojson';
import { projectDetail, type DetailCamera } from './detail-context.ts';
import type { TeachingFeature } from './teaching-data.ts';

/** These are display limits, not a claim about the completeness of the evidence. */
export const TEACHING_LIMITS = Object.freeze({ features: 256, verticesPerFeature: 4096, vertices: 32768, rings: 32, worldCopies: 8 });
type XY = [number, number];
type Box = { left: number; top: number; right: number; bottom: number };
type ProjectedFeature = { feature: TeachingFeature; paths: XY[][] };
const categories = new Set(['trade', 'diffusion', 'power', 'ecology', 'belief', 'language']);

export function teachingPaint(feature: Pick<TeachingFeature, 'category' | 'relationship' | 'certainty' | 'directional'>) {
  let color = { trade: '#087b83', diffusion: '#ad5c36', power: '#8056a0', ecology: '#71844a', belief: '#a07925', language: '#4365a0' }[feature.category];
  if(feature.category==='power')color=feature.relationship==='tributary'?'#94642d':feature.relationship==='autonomous'?'#657d84':'#8056a0';
  // Relationship styling refers to the cited connection, never the area on
  // either side of the line. A dotted line is not a surveyed frontier.
  const dash = feature.category === 'power'
    ? ({ core: [] as number[], tributary: [9, 4], influence: [2, 5], autonomous: [9, 4, 2, 4] }[feature.relationship ?? 'influence'] ?? [2, 5])
    : feature.category === 'diffusion' ? [6, 5]
    : feature.category === 'ecology' ? [2, 6]
    : feature.category === 'trade' && !/^(documented|attested)$/i.test(feature.certainty) ? [9, 4] : [];
  return { color, dash, fill: feature.category === 'ecology', arrow: feature.category === 'diffusion' && feature.directional === true };
}

/** Reject malformed or over-budget shapes before projection or Canvas work. */
export function teachingGeometrySize(feature: TeachingFeature): number {
  if (!feature || !categories.has(feature.category) || typeof feature.id !== 'string' || typeof feature.title !== 'string') return 0;
  const geometry = feature.geometry;
  if (!geometry || !['Point', 'LineString', 'Polygon'].includes(geometry.type)) return 0;
  const paths: Position[][] = geometry.type === 'Point' ? [[geometry.coordinates]] : geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates;
  if (!Array.isArray(paths) || !paths.length || paths.length > TEACHING_LIMITS.rings) return 0;
  let count = 0;
  for (const path of paths) {
    if (!Array.isArray(path) || path.length < (geometry.type === 'Point' ? 1 : geometry.type === 'Polygon' ? 4 : 2)) return 0;
    count += path.length;
    if (count > TEACHING_LIMITS.verticesPerFeature) return 0;
    for (const p of path) if (!Array.isArray(p) || p.length < 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90) return 0;
    if (geometry.type === 'Polygon' && (path[0][0] !== path.at(-1)![0] || path[0][1] !== path.at(-1)![1])) return 0;
  }
  return count;
}

/** Unwrap consecutive vertices together; independent point wrapping draws a
 * false line across the entire globe when a corridor crosses the date line. */
export function projectTeachingPath(path: readonly Position[], camera: DetailCamera, width: number, height: number, shellX?: number): XY[] {
  const unwrapped: XY[] = [];
  for (const [index, coordinate] of path.entries()) {
    const [rawX, y] = projectDetail(coordinate), previous = unwrapped.at(-1)?.[0];
    const fullWidth = index > 0 && Math.abs(Math.abs(coordinate[0] - path[index - 1][0]) - 360) < 1e-9;
    const x = previous === undefined ? rawX : fullWidth
      ? rawX + Math.round(previous - projectDetail(path[index - 1])[0])
      : rawX + Math.round(previous - rawX);
    unwrapped.push([x, y]);
  }
  if (!unwrapped.length) return [];
  const left = Math.min(...unwrapped.map(p => p[0])), right = Math.max(...unwrapped.map(p => p[0]));
  const shift = Math.round((shellX ?? camera.x) - (left + right) / 2);
  return unwrapped.map(([x, y]) => [(x + shift - camera.x) * camera.scale + width / 2, (y - camera.y) * camera.scale + height / 2]);
}

const intersects = (a: Box, b: Box) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const extent = (paths: XY[][]): Box => {
  const points = paths.flat();
  return { left: Math.min(...points.map(p => p[0])), right: Math.max(...points.map(p => p[0])), top: Math.min(...points.map(p => p[1])), bottom: Math.max(...points.map(p => p[1])) };
};

export class TeachingOverlay {
  private features: readonly TeachingFeature[] = [];
  private selectedId: string | undefined;
  private rejectedFeatures = 0;
  private vertexCount = 0;
  private drawnFeatures = 0;
  private selectedLabel: { title: string; anchor: XY; color: string } | undefined;
  private labelBox: Box | undefined;
  private viewport = { width: 0, height: 0 };

  setFeatures(features: readonly TeachingFeature[], selectedId?: string) {
    const accepted: TeachingFeature[] = [], ids = new Set<string>();
    let vertices = 0;
    for (const feature of features.slice(0, TEACHING_LIMITS.features)) {
      const size = teachingGeometrySize(feature);
      if (!size || ids.has(feature.id) || size + vertices > TEACHING_LIMITS.vertices) continue;
      accepted.push(feature); ids.add(feature.id); vertices += size;
    }
    this.features = accepted;
    this.selectedId = selectedId;
    this.rejectedFeatures = features.length - accepted.length;
    this.vertexCount = vertices;
  }

  draw(ctx: CanvasRenderingContext2D, camera: DetailCamera, width: number, height: number) {
    this.drawnFeatures = 0; this.selectedLabel = undefined; this.labelBox = undefined;
    this.viewport = { width, height };
    if (![camera.x, camera.y, camera.scale, width, height].every(Number.isFinite) || camera.scale <= 0 || width <= 0 || height <= 0) return;
    const ordered = this.features.slice().sort((a, b) => Number(a.id === this.selectedId) - Number(b.id === this.selectedId) || Number(b.category === 'ecology') - Number(a.category === 'ecology'));
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.rect(0, 0, width, height); ctx.clip();
    for (const feature of ordered) {
      const geometry = feature.geometry;
      const sourcePaths = geometry.type === 'Point' ? [[geometry.coordinates]] : geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates;
      let shellX: number | undefined;
      const paths = sourcePaths.map(path => {
        const projected = projectTeachingPath(path, camera, width, height, shellX);
        if (shellX === undefined) { const e = extent([projected]); shellX = ((e.left + e.right) / 2 - width / 2) / camera.scale + camera.x; }
        return projected;
      });
      const e = extent(paths);
      if (e.bottom < -15 || e.top > height + 15) continue;
      const first = Math.ceil((-15 - e.right) / camera.scale), last = Math.floor((width + 15 - e.left) / camera.scale);
      let visible = false;
      for (let copy = first; copy <= last && copy < first + TEACHING_LIMITS.worldCopies; copy++) {
        const shifted = copy ? paths.map(path => path.map(([x, y]) => [x + copy * camera.scale, y] as XY)) : paths;
        this.paintFeature(ctx, { feature, paths: shifted }); visible = true;
      }
      if (visible) this.drawnFeatures++;
    }
    ctx.restore();
  }

  private paintFeature(ctx: CanvasRenderingContext2D, { feature, paths }: ProjectedFeature) {
    const selected = feature.id === this.selectedId, style = teachingPaint(feature);
    ctx.save();
    ctx.strokeStyle = style.color; ctx.fillStyle = style.color;
    ctx.lineWidth = selected ? 3.3 : feature.category === 'ecology' ? 1.2 : 2;
    ctx.globalAlpha = selected ? 1 : .82;
    ctx.setLineDash(style.dash);
    if (feature.geometry.type === 'Point') {
      const [x, y] = paths[0][0];
      ctx.beginPath(); ctx.arc(x, y, selected ? 7 : 4.5, 0, 2 * Math.PI);
      ctx.fillStyle = '#fbf8ed'; ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, 1.5, 0, 2 * Math.PI); ctx.fillStyle = style.color; ctx.fill();
    } else {
      ctx.beginPath();
      for (const path of paths) {
        path.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
        if (feature.geometry.type === 'Polygon') ctx.closePath();
      }
      // The ecological wash is contextual, with a diffuse edge. Power polygons
      // deliberately receive no fill that could imply exclusive sovereignty.
      if (feature.geometry.type === 'Polygon' && style.fill) {
        ctx.globalAlpha = selected ? .14 : .075; ctx.fill('evenodd');
        ctx.globalAlpha = .06; ctx.lineWidth = selected ? 16 : 11; ctx.setLineDash([]); ctx.stroke();
        ctx.lineWidth = selected ? 2 : 1.2; ctx.globalAlpha = selected ? .8 : .55; ctx.setLineDash(style.dash);
      }
      ctx.stroke();
      if (feature.geometry.type === 'LineString') {
        const path = paths[0];
        ctx.setLineDash([]); ctx.globalAlpha = selected ? 1 : .9;
        for (const [x, y] of [path[0], path.at(-1)!]) { ctx.beginPath(); ctx.arc(x, y, selected ? 3.3 : 2.4, 0, 2 * Math.PI); ctx.fill(); }
        if (style.arrow) {
          const tip = path.at(-1)!, previous = path.slice(0, -1).reverse().find(p => Math.hypot(tip[0] - p[0], tip[1] - p[1]) > 1);
          if (previous) {
            const angle = Math.atan2(tip[1] - previous[1], tip[0] - previous[0]), size = selected ? 11 : 8;
            ctx.beginPath(); ctx.moveTo(...tip); ctx.lineTo(tip[0] - size * Math.cos(angle - .45), tip[1] - size * Math.sin(angle - .45));
            ctx.lineTo(tip[0] - size * Math.cos(angle + .45), tip[1] - size * Math.sin(angle + .45)); ctx.closePath(); ctx.fill();
          }
        }
      }
    }
    if (selected) {
      const { width, height } = this.viewport, e = extent(paths);
      const anchor: XY = feature.geometry.type === 'Polygon' ? [(e.left + e.right) / 2, (e.top + e.bottom) / 2] : paths[0][Math.floor((paths[0].length - 1) / 2)];
      if (anchor[0] >= 0 && anchor[0] <= width && anchor[1] >= 0 && anchor[1] <= height) this.selectedLabel = { title: feature.title, anchor, color: style.color };
    }
    ctx.restore();
  }

  /** Paint the one selected label after cities, trying alternate positions that
   * keep city names readable. Other evidence is identified through Studies. */
  drawLabel(ctx: CanvasRenderingContext2D, blocked?: (x: number, y: number, width: number, height: number) => boolean) {
    const label = this.selectedLabel;
    if (!label) return;
    const { width, height } = this.viewport;
    ctx.save(); ctx.font = '600 12px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    let title = label.title.slice(0, 90);
    while (title.length > 12 && ctx.measureText(title).width > Math.min(330, width - 30)) title = title.slice(0, -2);
    if (title !== label.title) title = `${title.trimEnd()}…`;
    const labelWidth = ctx.measureText(title).width + 18;
    for (const offset of [-20, 22, -42, 44]) {
      const x = Math.max(labelWidth / 2 + 6, Math.min(width - labelWidth / 2 - 6, label.anchor[0])), y = label.anchor[1] + offset;
      if (y < 14 || y > height - 14 || blocked?.(x, y, labelWidth, 24)) continue;
      this.labelBox = { left: x - labelWidth / 2, right: x + labelWidth / 2, top: y - 12, bottom: y + 12 };
      ctx.globalAlpha = .95; ctx.fillStyle = '#fffdf5'; ctx.fillRect(this.labelBox.left, this.labelBox.top, labelWidth, 24);
      ctx.globalAlpha = 1; ctx.fillStyle = label.color; ctx.fillText(title, x, y); break;
    }
    ctx.restore();
  }

  overlapsLabel(x: number, y: number, width: number, height = 32) { return !!this.labelBox && intersects(this.labelBox, { left: x - width / 2, right: x + width / 2, top: y - height / 2, bottom: y + height / 2 }); }

  getDiagnostics() {
    return { activeFeatures: this.features.length, drawnFeatures: this.drawnFeatures, rejectedFeatures: this.rejectedFeatures, vertices: this.vertexCount, selectedId: this.selectedId ?? null, selectedLabelVisible: !!this.labelBox,
      categories: Object.fromEntries([...categories].map(category => [category, this.features.filter(feature => feature.category === category).length])),
      geometryMeaning: 'Schematic evidence corridors, connections, broad ecological contexts and located attestations; not surveyed boundaries or demographic heatmaps.' };
  }
}
