import type { AlphaEpoch, AlphaManifest, SceneSnapshot } from '../../../packages/contracts/src/index.ts';
import { adaptAlphaManifest } from './alpha.ts';
import type { EpochLoader, SceneData } from './temporal.ts';
import { politicalContinuityKey, reviewPoliticalContinuity } from './political-continuity.ts';

export type DisplayPolicy = 'exact' | 'reference';
export interface DisplayTrack { id: string; manifest: AlphaManifest; loader: EpochLoader }
export interface DisplayPlan {
  requestedTime: number; displayedTime: number | null; policy: DisplayPolicy;
  representation: 'exact' | 'reference' | 'missing'; track: DisplayTrack;
  political?: AlphaEpoch; overlay?: AlphaEpoch; key: string;
  overlayTrack?: DisplayTrack;
  layers: { population: boolean; migration: boolean };
}
type Intervals = readonly (readonly [number, number, string])[];
type Index = { territories: Intervals; population: Intervals; migration: Intervals; populationIndexed: boolean };
function mergeMetadata<T>(political: Readonly<Record<string, T>> | undefined, overlay: Readonly<Record<string, T>> | undefined, kind: string): Readonly<Record<string, T>> | undefined {
  if (!overlay || overlay === political) return political ?? overlay;
  if (!political) return overlay;
  const merged: Record<string, T> = { ...political };
  for (const [id, value] of Object.entries(overlay)) {
    if (Object.hasOwn(merged, id) && merged[id] !== value && JSON.stringify(merged[id]) !== JSON.stringify(value)) {
      throw new Error(`Conflicting ${kind} identity across political and overlay sources: ${id}`);
    }
    merged[id] = value;
  }
  return Object.freeze(merged);
}
const active = <T extends { properties: { t_start: number; t_end: number } }>(features: readonly T[], time: number) =>
  features.filter(feature => feature.properties.t_start <= time && time < feature.properties.t_end);

/** Viewer references never mutate valid-time bounds, and never borrow a future observation. */
export class DisplayResolver {
  private indexes = new Map<string, Index>();
  constructor(private readonly base: AlphaManifest['base_geography']) {}

  resolve(track: DisplayTrack, time: number, policy: DisplayPolicy, layers: DisplayPlan['layers'], independentOverlayTrack?: DisplayTrack): DisplayPlan {
    if (!Number.isSafeInteger(time)) throw new Error('Display resolution requires an integer canonical day.');
    const observations = track.manifest.epochs.filter(epoch => epoch.stream.source_layers.includes('territories'));
    const exact = observations.find(epoch => epoch.t_start <= time && time < epoch.t_end);
    const political = exact ?? (policy === 'reference' ? [...observations].reverse().find(epoch => epoch.t_start <= time) : undefined);
    const representation = exact ? 'exact' : political ? 'reference' : 'missing';
    const displayedTime = political ? exact ? time : political.t_start : null;
    const eligibleOverlay=(epoch:AlphaEpoch)=>epoch.t_start<=time&&time<epoch.t_end
      &&((layers.population&&epoch.stream.source_layers.includes('population'))||(layers.migration&&epoch.stream.source_layers.includes('migration')));
    const localOverlay=track.manifest.epochs.find(eligibleOverlay);
    const overlayTrack=localOverlay?track:independentOverlayTrack;
    const overlay=localOverlay??independentOverlayTrack?.manifest.epochs.find(eligibleOverlay);
    const key = JSON.stringify([track.id, track.manifest.edition, track.manifest.recorded_at, policy, representation, politicalContinuityKey(time),
      political?.epoch_id ?? null, representation === 'reference' ? displayedTime : null,
      political ? this.eligibility(political, displayedTime!, 'political', layers) : null,
      overlay?.epoch_id ?? null, overlay ? [overlayTrack?.manifest.edition,this.eligibility(overlay, time, 'overlay', layers)] : null, layers]);
    return { requestedTime: time, displayedTime, policy, representation, track, political, overlay, overlayTrack, key, layers: { ...layers } };
  }

  private eligibility(epoch: AlphaEpoch, time: number, role: 'political' | 'overlay', layers: DisplayPlan['layers']): unknown {
    const index = this.indexes.get(epoch.metadata.sha256);
    if (!index) return { unresolved: epoch.metadata.sha256 };
    const intervals = role === 'political' ? index.territories
      : [...(layers.population ? index.population : []), ...(layers.migration ? index.migration : [])];
    return [intervals.filter(([start,end]) => start <= time && time < end).map(([, ,id]) => id),
      role === 'overlay' && layers.population && epoch.stream.source_layers.includes('population') && !index.populationIndexed ? time : null];
  }

  private async load(plan: DisplayPlan, epoch: AlphaEpoch, signal: AbortSignal, track=plan.track): Promise<SceneData> {
    const legacy = adaptAlphaManifest(track.manifest);
    const descriptor = legacy.epochs.find(item => item.epoch_id === epoch.epoch_id)!;
    const data = await track.loader(descriptor, legacy, signal);
    const intervals = (features: readonly { properties: { t_start: number; t_end: number; render_id: string } }[]): Intervals =>
      features.map(feature => [feature.properties.t_start, feature.properties.t_end, feature.properties.render_id] as const);
    this.indexes.delete(epoch.metadata.sha256);
    this.indexes.set(epoch.metadata.sha256, { territories: intervals(data.parts ?? data.territories),
      population: intervals(data.population), migration: intervals(data.migration),
      populationIndexed: data.population.length > 0 || !epoch.stream.source_layers.includes('population') });
    while (this.indexes.size > 4) this.indexes.delete(this.indexes.keys().next().value!);
    return data;
  }

  async materialize(plan: DisplayPlan, signal: AbortSignal): Promise<{ data: SceneData; displayTime: number }> {
    const political = plan.political ? await this.load(plan, plan.political, signal) : undefined;
    const overlay = plan.overlay ? plan.overlay === plan.political ? political : await this.load(plan, plan.overlay, signal, plan.overlayTrack) : undefined;
    signal.throwIfAborted();
    const time = plan.displayedTime ?? plan.requestedTime;
    const data: SceneData = {
      ...(political ?? overlay ?? {}),
      edition: plan.track.manifest.edition,
      epoch_id: plan.political?.epoch_id ?? plan.overlay?.epoch_id ?? 'uncovered',
      territories: political ? active(political.territories, time) : [],
      parts: political?.parts ? active(political.parts, time) : [],
      population: overlay && plan.layers.population ? active(overlay.population, plan.requestedTime) : [],
      migration: overlay && plan.layers.migration ? active(overlay.migration, plan.requestedTime) : [],
      // Overlay evidence must travel with its independent valid-time observation.
      entities: mergeMetadata(political?.entities, overlay?.entities, 'entity'),
      evidence: mergeMetadata(political?.evidence, overlay?.evidence, 'assertion'),
      geometry_hashes: mergeMetadata(political?.geometry_hashes, overlay?.geometry_hashes, 'geometry hash'),
      labels: political?.labels ?? [],
      ...{ migration_observation: plan.layers.migration
        ? (overlay as (SceneData & { migration_observation?: unknown }) | undefined)?.migration_observation : undefined },
      stream: plan.political?.stream ?? plan.overlay?.stream,
      supplement: plan.political && plan.overlay && plan.overlay !== plan.political
        ? { stream: plan.overlay.stream, edition: plan.overlayTrack?.manifest.edition??plan.track.manifest.edition, time: plan.requestedTime } : undefined,
      overlayTime: plan.requestedTime,
      baseGeography: this.base,
    };
    const reviewed = reviewPoliticalContinuity(data, plan.requestedTime, time);
    return { data: { ...reviewed.scene, suppressedEntityIds: reviewed.suppressedEntityIds }, displayTime: time };
  }

  /** Same arrays and hashes; only navigation stamps move. No source or card recreation. */
  advance(scene: SceneSnapshot, plan: DisplayPlan): SceneSnapshot {
    return Object.freeze({ ...scene, time: plan.displayedTime ?? plan.requestedTime, overlayTime: plan.requestedTime,
      supplement: scene.supplement ? { ...scene.supplement, time: plan.requestedTime } : undefined });
  }
}

/** Exclusive routing prevents duplicate paint and picks at the regional handoff. */
export function chooseTrack(view: { longitude: number; latitude: number; zoom: number }, bounds: readonly number[], minimumZoom = 4): 'isles' | 'world' {
  return view.zoom >= minimumZoom && view.longitude >= bounds[0] && view.longitude <= bounds[2]
    && view.latitude >= bounds[1] && view.latitude <= bounds[3] ? 'isles' : 'world';
}
