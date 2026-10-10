import { parseResearchOverlay, visibleResearchFeatures, type ResearchOverlay } from './spatial-overlay.ts';
import type { SpatialViewAdapter } from './interfaces.ts';

export class CanvasResearchAdapter implements SpatialViewAdapter<ResearchOverlay> {
  private input: ResearchOverlay | null = null;
  private data: ResearchOverlay | null = null;
  private year = 0;
  private selected: string | null = null;
  constructor(private readonly invalidate: () => void = () => {}) {}
  update(input: ResearchOverlay | null, cursorYear: number, selectedId: string | null): void {
    if (!Number.isFinite(cursorYear)) throw new Error('INVALID_CURSOR');
    const year = Math.floor(cursorYear);
    if (input === this.input && year === this.year && selectedId === this.selected) return;
    if (input !== this.input) { const checked = input === null ? null : parseResearchOverlay(input); this.input = input; this.data = checked; }
    this.year = year; this.selected = selectedId; this.invalidate();
  }
  draw(context: CanvasRenderingContext2D, project: (point: [number, number]) => [number, number] | null): void {
    if (!this.data) return;
    context.save();
    try {
      for (const feature of visibleResearchFeatures(this.data, this.year, this.selected)) {
        context.beginPath(); context.lineWidth = 2;
        context.strokeStyle = '#fff'; context.fillStyle = feature.id === this.selected ? '#9b531f' : '#176e86';
        if (feature.geometry.type === 'Point') {
          const point = project(feature.geometry.coordinates);
          if (!point?.every(Number.isFinite)) continue;
          context.arc(point[0], point[1], 7, 0, Math.PI * 2); context.fill(); context.stroke();
        } else {
          let complete = true;
          for (const ring of feature.geometry.coordinates) {
            const points = ring.map(project);
            if (points.some(point => !point?.every(Number.isFinite))) { complete = false; break; }
            points.forEach((point, index) => { if (index === 0) context.moveTo(point![0], point![1]); else context.lineTo(point![0], point![1]); }); context.closePath();
          }
          if (!complete) continue;
          context.globalAlpha = .2; context.fill('evenodd'); context.globalAlpha = 1; context.strokeStyle = '#164f61'; context.stroke();
        }
      }
    } finally { context.restore(); }
  }
  pick(point: [number, number], project: (coordinates: [number, number]) => [number, number] | null): ResearchOverlay['features'][number]['properties'] | null {
    if (!this.data || !point.every(Number.isFinite)) return null;
    for (const feature of [...visibleResearchFeatures(this.data, this.year, this.selected)].reverse()) {
      if (feature.geometry.type === 'Point') {
        const location = project(feature.geometry.coordinates);
        if (location?.every(Number.isFinite) && Math.hypot(point[0] - location[0], point[1] - location[1]) <= 10) return feature.properties;
      } else {
        let inside = false, complete = true;
        for (const ring of feature.geometry.coordinates) {
          const projected = ring.map(project);
          if (projected.some(location => !location?.every(Number.isFinite))) { complete = false; break; }
          for (let i = 0, j = projected.length - 1; i < projected.length; j = i++) {
            const a = projected[i]!, b = projected[j]!;
            if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
          }
        }
        if (complete && inside) return feature.properties;
      }
    }
    return null;
  }
  getDiagnostics() { return { source: this.data !== null, features: this.data?.features.length ?? 0, visible: this.data ? visibleResearchFeatures(this.data, this.year, this.selected).length : 0 }; }
  clear(): void { this.update(null, this.year, null); }
}
