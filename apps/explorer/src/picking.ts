import type { CanonicalPart, SceneSnapshot, TerritoryFeature } from '../../../packages/contracts/src/index.ts';
import { displayRank } from './display-style.ts';

/** Renderer hits carry only an identifier and the generation actually displayed. */
export interface RawPickHit {
  render_id: unknown;
  generation: number;
}

export interface TerritorySelection {
  readonly entityId: string;
  readonly renderId: string;
  readonly territoryStateId: string;
  /** Every active render part of this entity, not merely the hit tile fragment. */
  readonly renderIds: readonly string[];
}

/** Locale-independent Unicode code-point ordering, including non-BMP IDs. */
function compareIds(left: string, right: string): number {
  const a = Array.from(left, character => character.codePointAt(0)!);
  const b = Array.from(right, character => character.codePointAt(0)!);
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return a.length < b.length ? -1 : a.length > b.length ? 1 : 0;
}

type PickPart = CanonicalPart | TerritoryFeature;

function activeTerritories(scene: SceneSnapshot): PickPart[] {
  // The sidecar is the canonical unclipped identity index; streamed fragments are never identities.
  return (scene.parts ?? scene.territories).filter(({ properties }) =>
    properties.t_start <= scene.time && scene.time < properties.t_end);
}

/** Unit-sphere area: projection-independent ranking, with interior rings removed. */
function polygonArea(feature: TerritoryFeature): number {
  const radians = Math.PI / 180;
  const ringAreas = feature.geometry.coordinates.map(ring => {
    let sum = 0;
    for (let index = 0; index < ring.length; index++) {
      const current = ring[index];
      const next = ring[(index + 1) % ring.length];
      // Source rings may cross the longitude seam; take the short longitude arc.
      const delta = ((next[0] - current[0] + 540) % 360) - 180;
      sum += delta * radians * (2 + Math.sin(current[1] * radians) + Math.sin(next[1] * radians));
    }
    return Math.abs(sum / 2);
  });
  return Math.max(0, (ringAreas[0] ?? 0) - ringAreas.slice(1).reduce((sum, area) => sum + area, 0));
}

function pickPriority(feature: PickPart): number {
  // Optional future priority is read from the trusted committed feature only.
  const value: unknown = (feature.properties as unknown as Record<string, unknown>).pick_priority;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function compareFeatures(left: PickPart, right: PickPart): number {
  // Context and culture remain inspectable, but a contextual sliver must not
  // capture a click over an admitted political association. Explicit priority
  // still resolves competing candidates of the same semantic kind.
  const kindOrder = displayRank(right.properties) - displayRank(left.properties);
  if (kindOrder !== 0) return kindOrder;
  const priorityOrder = pickPriority(right) - pickPriority(left);
  if (priorityOrder !== 0) return priorityOrder;
  const area = (part: PickPart) => 'areaKm2' in part ? part.areaKm2 : polygonArea(part) * 6371.0088 ** 2;
  const areaOrder = area(left) - area(right);
  if (areaOrder !== 0) return areaOrder;
  return compareIds(left.properties.entity_id, right.properties.entity_id)
    || compareIds(left.properties.territory_state_id, right.properties.territory_state_id)
    || compareIds(left.properties.render_id, right.properties.render_id);
}

function selectionFor(feature: PickPart, active: readonly PickPart[]): TerritorySelection {
  const { entity_id, render_id, territory_state_id } = feature.properties;
  const renderIds = [...new Set(active
    .filter(candidate => candidate.properties.entity_id === entity_id)
    .map(candidate => candidate.properties.render_id))].sort(compareIds);
  return Object.freeze({
    entityId: entity_id,
    renderId: render_id,
    territoryStateId: territory_state_id,
    renderIds: Object.freeze(renderIds),
  });
}

/**
 * Resolve the same canonical selection regardless of renderer/tile hit order.
 * Stale generations, inactive parts, duplicate fragments and unknown IDs cannot
 * become selections. No identity or priority is accepted from renderer payloads.
 */
export function resolvePick(hits: readonly RawPickHit[], scene: SceneSnapshot): TerritorySelection | null {
  const active = activeTerritories(scene);
  const hitIds = new Set(hits
    .filter(hit => hit.generation === scene.generation && typeof hit.render_id === 'string')
    .map(hit => hit.render_id as string));
  const candidates = active.filter(feature => hitIds.has(feature.properties.render_id));
  candidates.sort(compareFeatures);
  return candidates[0] ? selectionFor(candidates[0], active) : null;
}

/** Select an entity from a keyboard-accessible list using committed identity. */
export function selectEntity(entityId: string, scene: SceneSnapshot): TerritorySelection | null {
  const active = activeTerritories(scene);
  const parts = active.filter(feature => feature.properties.entity_id === entityId)
    .sort((a, b) => compareIds(a.properties.render_id, b.properties.render_id));
  return parts[0] ? selectionFor(parts[0], active) : null;
}

/** Keep entity selection through a commit, refreshing every highlighted part. */
export function reconcileSelection(
  previous: TerritorySelection | null,
  scene: SceneSnapshot,
): TerritorySelection | null {
  if (!previous) return null;
  const active = activeTerritories(scene);
  const retainedPart = active.find(feature => feature.properties.entity_id === previous.entityId
    && feature.properties.render_id === previous.renderId);
  return retainedPart ? selectionFor(retainedPart, active) : selectEntity(previous.entityId, scene);
}
