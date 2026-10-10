import type { ExplorerState, HistoricalDay, SyntheticFixture, TerritoryCard, TerritoryFeature } from '../../../packages/contracts/src/index.ts';

export function validateFixture(value: unknown): SyntheticFixture {
  const fixture = value as SyntheticFixture;
  if (!fixture || fixture.type !== 'FeatureCollection' || fixture.fixture_kind !== 'synthetic' ||
      !Number.isSafeInteger(fixture.initial_time) || !Array.isArray(fixture.features) || fixture.features.length < 3) {
    throw new Error('Expected a synthetic collection with at least three territories and an integer initial day.');
  }
  const ids = new Set<string>();
  for (const feature of fixture.features) {
    const p = feature.properties;
    if (feature.type !== 'Feature' || !p ||
        ![p.entity_id, p.render_id, p.territory_state_id].every(id => typeof id === 'string' && id.length > 0) ||
        ids.has(p.render_id) || !Number.isSafeInteger(p.t_start) || !Number.isSafeInteger(p.t_end) || p.t_start >= p.t_end) {
      throw new Error('Invalid or duplicate territory identity or interval.');
    }
    ids.add(p.render_id);
    if (feature.geometry?.type !== 'Polygon' || !Array.isArray(feature.geometry.coordinates) || !feature.geometry.coordinates.length) {
      throw new Error('The fixture requires Polygon geometry.');
    }
    for (const ring of feature.geometry.coordinates) {
      if (ring.length < 4 || ring.some(point => point.length !== 2 || !point.every(Number.isFinite) ||
          Math.abs(point[0]) > 180 || Math.abs(point[1]) > 85.05112878) ||
          ring[0][0] !== ring.at(-1)![0] || ring[0][1] !== ring.at(-1)![1]) {
        throw new Error('Expected closed WGS84 rings within Web Mercator limits.');
      }
    }
  }
  if (fixture.features.filter(f => isActive(f, fixture.initial_time)).length < 3) {
    throw new Error('At least three territories must be active initially.');
  }
  return deepFreeze(fixture);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

export function isActive(feature: TerritoryFeature, time: HistoricalDay): boolean {
  return feature.properties.t_start <= time && time < feature.properties.t_end;
}

export function createState(time: HistoricalDay): ExplorerState {
  if (!Number.isSafeInteger(time)) throw new Error('Historical time must be an integer day.');
  return { requestedTime: time, committed: null, presentation: { elapsedMs: 0 }, isPlaying: false, selectedRenderId: null };
}

export function requestTime(state: ExplorerState, time: HistoricalDay): ExplorerState {
  if (!Number.isSafeInteger(time)) throw new Error('Historical time must be an integer day.');
  return { ...state, requestedTime: time };
}

// Called at the explicit commit boundary, never from the presentation clock.
export function commitRequestedTime(state: ExplorerState, fixture: SyntheticFixture): ExplorerState {
  const activeFeatures = fixture.features.filter(f => isActive(f, state.requestedTime));
  return {
    ...state,
    committed: Object.freeze({ time: state.requestedTime, activeFeatures: Object.freeze(activeFeatures) }),
    selectedRenderId: activeFeatures.some(f => f.properties.render_id === state.selectedRenderId) ? state.selectedRenderId : null,
  };
}

export function togglePlayback(state: ExplorerState): ExplorerState {
  return { ...state, isPlaying: !state.isPlaying };
}

export function advancePresentation(state: ExplorerState, elapsedMs: number): ExplorerState {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) throw new Error('Invalid presentation delta.');
  return state.isPlaying ? { ...state, presentation: { elapsedMs: state.presentation.elapsedMs + elapsedMs } } : state;
}

export function selectTerritory(state: ExplorerState, renderId: unknown): ExplorerState {
  const selected = state.committed?.activeFeatures.find(f => f.properties.render_id === renderId);
  return { ...state, selectedRenderId: selected?.properties.render_id ?? null };
}

export function selectedCard(state: ExplorerState): TerritoryCard | null {
  const feature = state.committed?.activeFeatures.find(f => f.properties.render_id === state.selectedRenderId);
  if (!feature || !state.committed) return null;
  return { ...feature.properties, fixture_kind: 'synthetic', committed_time: state.committed.time };
}

export function shouldHandleSpace(event: Pick<KeyboardEvent, 'code' | 'repeat' | 'altKey' | 'ctrlKey' | 'metaKey'>, editable: boolean, interactive = false): boolean {
  // Native controls and ARIA widgets retain their own Space activation behavior.
  return event.code === 'Space' && !event.repeat && !event.altKey && !event.ctrlKey && !event.metaKey && !editable && !interactive;
}
