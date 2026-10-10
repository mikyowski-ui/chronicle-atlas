import type { SceneLabel, SceneSnapshot } from '../../../packages/contracts/src/index.ts';
import { displayKind, displayRank, type DisplayKind } from './display-style.ts';

export type DisplayLabel = SceneLabel & { displayKind?: DisplayKind };
export type PlacedLabel = DisplayLabel & { x: number; y: number };
export type LabelProjector = (position: readonly [number, number]) => readonly [number, number];
export const MAX_VISIBLE_LABELS = 64;

/** One line of 18 px type, including its halo and some breathing room. */
const TEXT_HEIGHT = 24;
const PADDING = 6;

function compareText(a: string, b: string): number {
  const left = Array.from(a, c => c.codePointAt(0)!);
  const right = Array.from(b, c => c.codePointAt(0)!);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return left.length - right.length;
}

function priority(label: SceneLabel): number {
  return Number.isFinite(label.priority) ? label.priority! : 0;
}

function compareLabels(a: DisplayLabel, b: DisplayLabel): number {
  return displayRank({ kind: b.displayKind }) - displayRank({ kind: a.displayKind })
    || priority(b) - priority(a)
    || compareText(a.entity_id, b.entity_id)
    || compareText(a.label_id, b.label_id)
    || compareText(a.text, b.text)
    || a.position[0] - b.position[0]
    || a.position[1] - b.position[1];
}

function uniqueLabels(labels: readonly SceneLabel[]): SceneLabel[] {
  const entities = new Set<string>();
  return labels.filter(label => label.entity_id && label.label_id && label.text.trim()
    && label.position.every(Number.isFinite) && Math.abs(label.position[1]) <= 90)
    .slice().sort(compareLabels).filter(label => {
      if (entities.has(label.entity_id)) return false;
      entities.add(label.entity_id);
      return true;
    });
}

/**
 * Anchors are authored or compiled once per entity, independently of territory
 * rings. Clipped tiles and disconnected islands therefore cannot create labels.
 * Only entities present at the committed date are eligible for display.
 */
export function chooseSceneLabels(scene: SceneSnapshot): DisplayLabel[] {
  const active = new Map<string, DisplayKind>();
  for (const feature of scene.parts ?? scene.territories) {
    if (feature.properties.t_start > scene.time || scene.time >= feature.properties.t_end) continue;
    const kind = displayKind(feature.properties), previous = active.get(feature.properties.entity_id);
    if (!previous || displayRank({ kind }) > displayRank({ kind: previous })) active.set(feature.properties.entity_id, kind);
  }
  return uniqueLabels((scene.labels ?? []).filter(label => active.has(label.entity_id))
    .map(label => ({ ...label, displayKind: active.get(label.entity_id)! })));
}

/**
 * A deterministic greedy placement shared by both renderers. x/y are the text
 * centre in CSS pixels. The caller supplies the renderer's projection and text
 * width for its actual font. The projection selects one visible world copy at
 * the longitude seam; this function never generates repeated world labels.
 */
export function placeLabels(
  labels: readonly SceneLabel[],
  project: LabelProjector,
  width: number,
  height: number,
  measureText: (text: string) => number,
): PlacedLabel[] {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return [];
  const boxes: { left: number; top: number; right: number; bottom: number }[] = [];
  const placed: PlacedLabel[] = [];
  // Collision avoidance alone still permits a flood of short labels at world
  // scale. Bound visible labels by viewport area as well as an absolute cap.
  const limit = Math.min(MAX_VISIBLE_LABELS, Math.max(1, Math.floor(width * height / 12_000)));
  for (const label of uniqueLabels(labels)) {
    const [x, y] = project(label.position);
    const textWidth = measureText(label.text);
    if (![x, y, textWidth].every(Number.isFinite) || textWidth <= 0) continue;
    const box = {
      left: x - textWidth / 2 - PADDING, right: x + textWidth / 2 + PADDING,
      top: y - TEXT_HEIGHT / 2 - PADDING, bottom: y + TEXT_HEIGHT / 2 + PADDING,
    };
    if (box.left < 0 || box.top < 0 || box.right > width || box.bottom > height) continue;
    if (boxes.some(other => box.left < other.right && box.right > other.left
      && box.top < other.bottom && box.bottom > other.top)) continue;
    boxes.push(box);
    placed.push({ ...label, x, y });
    if (placed.length >= limit) break;
  }
  return placed;
}
