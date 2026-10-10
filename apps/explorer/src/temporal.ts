import { PMTiles, type Source } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import { sha256 } from '@noble/hashes/sha2.js';
import type { Feature } from 'geojson';
import type { FixtureEpoch, HistoricalDay, MigrationFeature, PopulationFeature, SceneMetadata, SceneSnapshot, TemporalManifest, TerritoryFeature } from '../../../packages/contracts/src/index.ts';

export type SceneData = Omit<SceneSnapshot, 'generation' | 'time'>;
export type EpochLoader = (epoch: FixtureEpoch, manifest: TemporalManifest, signal: AbortSignal) => Promise<SceneData>;
const LAYERS = ['territories', 'population', 'migration'] as const;
const MAX_ARCHIVE_BYTES = 1_000_000;
const MAX_MANIFEST_BYTES = 65_536;
const MAX_FEATURES_PER_LAYER = 1_000;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object.');
  return value as Record<string, unknown>;
}
function nonempty(value: unknown): value is string { return typeof value === 'string' && value.length > 0; }
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(freeze);
  }
  return value;
}
function checkAbort(signal?: AbortSignal): void { signal?.throwIfAborted(); }
function interval(start: unknown, end: unknown): void {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || (start as number) >= (end as number)) {
    throw new Error('Historical intervals require finite integer bounds with start < end.');
  }
}

/** The manifest is a bounded delivery contract, never a request to infer missing years. */
export function validateManifest(value: unknown, baseUrl?: string): TemporalManifest {
  const input = record(value);
  if (input.schema_version !== 1 || !['synthetic', 'historical-candidate'].includes(String(input.fixture_kind)) || !nonempty(input.edition) ||
      !Number.isSafeInteger(input.initial_time) || !Array.isArray(input.epochs) || !input.epochs.length || input.epochs.length > 32) {
    throw new Error('Invalid temporal manifest.');
  }
  const ids = new Set<string>();
  const epochs = input.epochs.map(value => {
    const epoch = record(value);
    interval(epoch.t_start, epoch.t_end);
    if (!nonempty(epoch.epoch_id) || ids.has(epoch.epoch_id) || !nonempty(epoch.url) ||
        typeof epoch.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(epoch.sha256) ||
        !Number.isSafeInteger(epoch.byte_length) || (epoch.byte_length as number) <= 0 || (epoch.byte_length as number) > MAX_ARCHIVE_BYTES ||
        !Array.isArray(epoch.layers) || !epoch.layers.includes('territories') || new Set(epoch.layers).size !== epoch.layers.length || epoch.layers.some(layer => !LAYERS.includes(layer)) ||
        (input.fixture_kind === 'synthetic' && !LAYERS.every(layer => (epoch.layers as unknown[]).includes(layer))) ||
        !Array.isArray(epoch.tile) || epoch.tile.length !== 3 || !epoch.tile.every(Number.isSafeInteger)) {
      throw new Error('Invalid epoch identity, digest, bounded archive size, layers, or tile.');
    }
    const [z, x, y] = epoch.tile as number[];
    if (z < 0 || z > 24 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) throw new Error('Invalid epoch tile coordinates.');
    ids.add(epoch.epoch_id);
    return { ...epoch, url: baseUrl ? new URL(epoch.url, baseUrl).href : epoch.url } as unknown as FixtureEpoch;
  });
  const sorted = [...epochs].sort((a, b) => a.t_start - b.t_start);
  for (let i = 1; i < sorted.length; i++) if (sorted[i].t_start < sorted[i - 1].t_end) throw new Error('Epoch intervals must not overlap.');
  if (!epochs.some(epoch => epoch.t_start <= (input.initial_time as number) && (input.initial_time as number) < epoch.t_end)) {
    throw new Error('The initial day must have explicit fixture coverage.');
  }
  if (input.bounds !== undefined && (!Array.isArray(input.bounds) || input.bounds.length !== 4 || !input.bounds.every(Number.isFinite) || input.bounds[0] >= input.bounds[2] || input.bounds[1] >= input.bounds[3])) throw new Error('Invalid geographic bounds.');
  if (input.fixture_kind === 'historical-candidate' && (!nonempty(input.recorded_at) || !Number.isFinite(Date.parse(input.recorded_at)) || !input.source)) throw new Error('Historical candidates require a recorded edition and source.');
  return freeze({ ...input, schema_version: 1, epochs: sorted } as unknown as TemporalManifest);
}

export async function boundedResponse(response: Response, maximum: number, signal?: AbortSignal): Promise<ArrayBuffer> {
  if (!response.ok) throw new Error(`Delivery failed with HTTP ${response.status}.`);
  const declared = response.headers.get('content-length');
  if (declared && Number(declared) > maximum) throw new Error('Delivery exceeds the declared resource budget.');
  if (!response.body) throw new Error('Delivery has no response body.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      checkAbort(signal);
      const { done, value } = await reader.read();
      checkAbort(signal);
      if (done) break;
      size += value.byteLength;
      if (size > maximum) throw new Error('Delivery exceeds the declared resource budget.');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes.buffer;
}

export async function loadManifest(url: string, signal?: AbortSignal): Promise<TemporalManifest> {
  checkAbort(signal);
  const response = await fetch(url, { signal });
  const bytes = await boundedResponse(response, MAX_MANIFEST_BYTES, signal);
  return validateManifest(JSON.parse(new TextDecoder().decode(bytes)), response.url || new URL(url, globalThis.location?.href).href);
}

export function validateFeature(feature: Feature, layer: typeof LAYERS[number], epoch: FixtureEpoch, allowAltitude = false): void {
  const props = record(feature.properties);
  interval(props.t_start, props.t_end);
  if (!nonempty(props.render_id) || (props.t_start as number) < epoch.t_start || (props.t_end as number) > epoch.t_end) {
    throw new Error(`Invalid ${layer} identity or feature interval outside epoch.`);
  }
  if (layer === 'territories' && (!nonempty(props.entity_id) || !nonempty(props.territory_state_id))) throw new Error('Invalid territory identity.');
  const measure = layer === 'population' ? props.density : props.magnitude;
  if (layer !== 'territories' && (typeof measure !== 'number' || !Number.isFinite(measure) || measure < 0)) throw new Error(`Invalid ${layer} measure.`);
  const geometry = feature.geometry;
  if (layer === 'migration' ? geometry?.type !== 'LineString' : geometry?.type !== 'Polygon') throw new Error(`Invalid ${layer} geometry type.`);
  const lines = geometry.type === 'Polygon' ? geometry.coordinates : geometry.type === 'LineString' ? [geometry.coordinates] : [];
  if (!lines.length) throw new Error(`Empty ${layer} geometry.`);
  for (const line of lines) {
    if (line.length < (geometry.type === 'Polygon' ? 4 : 2) || line.some(point => (point.length !== 2 && !(allowAltitude && point.length === 3)) || !point.every(Number.isFinite) ||
        Math.abs(point[0]) > 180 || Math.abs(point[1]) > 85.05112878)) throw new Error(`Invalid ${layer} coordinates.`);
    if (geometry.type === 'Polygon' && (line[0][0] !== line.at(-1)![0] || line[0][1] !== line.at(-1)![1])) throw new Error('Polygon ring is not closed.');
  }
}

/** One decoder validates every layer before any renderer sees the candidate. */
export function decodeScene(tileBytes: ArrayBuffer, epoch: FixtureEpoch, manifest: TemporalManifest, metadata: SceneMetadata = {}): SceneData {
  const [z, x, y] = epoch.tile;
  const tile = new VectorTile(new Pbf(tileBytes));
  const decoded: Record<string, Feature[]> = {};
  const ids = new Set<string>();
  for (const name of LAYERS) {
    const layer = tile.layers[name];
    if (!epoch.layers.includes(name)) {
      if (layer?.length) throw new Error(`Undeclared scene layer: ${name}.`);
      decoded[name] = []; continue;
    }
    if (!layer || !layer.length || layer.length > MAX_FEATURES_PER_LAYER) throw new Error(`Missing, empty, or oversized required layer: ${name}.`);
    decoded[name] = [];
    for (let i = 0; i < layer.length; i++) {
      const feature = layer.feature(i).toGeoJSON(x, y, z);
      validateFeature(feature, name, epoch);
      const id = feature.properties!.render_id as string;
      if (ids.has(id)) throw new Error(`Duplicate render_id across scene layers: ${id}.`);
      ids.add(id);
      // The promoted identity is explicit in both renderers, independent of MVT numeric IDs.
      feature.id = id;
      decoded[name].push(feature);
    }
  }
  validateSceneMetadata(metadata, decoded.territories as TerritoryFeature[], manifest);
  return freeze({ ...metadata, epoch_id: epoch.epoch_id, edition: manifest.edition,
    territories: decoded.territories as TerritoryFeature[], population: decoded.population as PopulationFeature[], migration: decoded.migration as MigrationFeature[] });
}

/** Evidence and label metadata are part of the hash-verified archive generation. */
export function validateSceneMetadata(value: SceneMetadata, territories: readonly Pick<TerritoryFeature, 'properties'>[], manifest: TemporalManifest) {
  const required = manifest.fixture_kind === 'historical-candidate';
  record(value);
  if (required && (!value.labels || !value.entities || !value.evidence)) throw new Error('Historical scene is missing labels, entities or evidence.');
  const activeEntities = new Set(territories.map(f => f.properties.entity_id));
  const ids = new Set<string>();
  for (const label of value.labels ?? []) {
    if (!nonempty(label.label_id) || ids.has(label.label_id) || !activeEntities.has(label.entity_id) || !nonempty(label.text) || !Array.isArray(label.position) || label.position.length !== 2 || !label.position.every(Number.isFinite) || Math.abs(label.position[0]) > 180 || Math.abs(label.position[1]) > 85.05112878) throw new Error('Invalid independent label.');
    ids.add(label.label_id);
  }
  if (required) for (const feature of territories) {
    const props = feature.properties;
    const entity = value.entities?.[props.entity_id];
    const evidence = value.evidence?.[props.territory_state_id];
    if (!entity || !nonempty(entity.name) || !/^#[a-f0-9]{6}$/i.test(entity.color) || !evidence || !Array.isArray(evidence.assertion_ids) || !evidence.assertion_ids.length || !evidence.assertion_ids.every(nonempty) || !nonempty(evidence.source_edition) || !nonempty(evidence.license) || !nonempty(evidence.source_title) || !Array.isArray(evidence.methodology) || !Array.isArray(evidence.limitations)) throw new Error('Incomplete historical evidence linkage.');
    interval(evidence.valid_from, evidence.valid_to);
    if (evidence.valid_from !== props.t_start || evidence.valid_to !== props.t_end || !Number.isFinite(Date.parse(evidence.recorded_from)) || (evidence.recorded_to !== null && (!Number.isFinite(Date.parse(evidence.recorded_to)) || Date.parse(evidence.recorded_to) <= Date.parse(evidence.recorded_from)))) throw new Error('Invalid bitemporal evidence interval.');
    const asOf = Date.parse(manifest.recorded_at!);
    if (Date.parse(evidence.recorded_from) > asOf || (evidence.recorded_to !== null && asOf >= Date.parse(evidence.recorded_to))) throw new Error('Evidence is not active in the recorded edition.');
    if (evidence.valid_extent) {
      const extent = evidence.valid_extent;
      if (!nonempty(extent.precision) || ![extent.start.earliest, extent.start.latest, extent.end.earliest, extent.end.latest].every(Number.isSafeInteger) || extent.start.earliest !== evidence.valid_from || extent.end.latest !== evidence.valid_to || extent.start.latest < extent.start.earliest || extent.end.latest < extent.end.earliest || extent.start.latest >= extent.end.latest || extent.end.earliest <= extent.start.earliest) throw new Error('Invalid temporal uncertainty bounds.');
    }
  }
}

/** Complete fixture archives are <=1 MB; only two successfully decoded payloads remain cached. */
export function createEpochLoader(fetcher: typeof fetch = fetch): EpochLoader {
  const cache = new Map<string, SceneData>();
  return async (epoch, manifest, signal) => {
    checkAbort(signal);
    const key = JSON.stringify([manifest.fixture_kind, manifest.edition, manifest.recorded_at, epoch]);
    const cached = cache.get(key);
    if (cached) {
      cache.delete(key); cache.set(key, cached);
      return cached;
    }
    // Requests do not share in-flight promises: aborting one generation cannot poison another.
    const response = await fetcher(epoch.url, { signal });
    const bytes = await boundedResponse(response, epoch.byte_length, signal);
    if (bytes.byteLength !== epoch.byte_length) throw new Error('Archive byte length does not match its manifest.');
    // Pinned portable SHA-256 also verifies archives on HTTP preview origins.
    const digest = sha256(new Uint8Array(bytes));
    checkAbort(signal);
    if (Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('') !== epoch.sha256) throw new Error('Archive SHA-256 does not match its manifest.');
    const source: Source = {
      getKey: () => key,
      getBytes: async (offset, length, rangeSignal) => {
        checkAbort(signal); checkAbort(rangeSignal);
        if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset >= bytes.byteLength) {
          throw new Error('Archive contains an invalid byte range.');
        }
        return { data: bytes.slice(offset, Math.min(offset + length, bytes.byteLength)) };
      },
    };
    const archive = new PMTiles(source);
    const metadata = record(await archive.getMetadata());
    checkAbort(signal);
    if (metadata.schema_version !== 1 || metadata.fixture_kind !== manifest.fixture_kind || metadata.edition !== manifest.edition ||
        metadata.epoch_id !== epoch.epoch_id || metadata.t_start !== epoch.t_start || metadata.t_end !== epoch.t_end) {
      throw new Error('Archive metadata does not match its manifest edition and epoch.');
    }
    const tile = await archive.getZxy(...epoch.tile, signal);
    checkAbort(signal);
    if (!tile) throw new Error('The required epoch tile is missing.');
    const scene = decodeScene(tile.data, epoch, manifest, (metadata.scene_metadata ?? {}) as SceneMetadata);
    checkAbort(signal);
    cache.set(key, scene);
    while (cache.size > 2) cache.delete(cache.keys().next().value!);
    return scene;
  };
}

export const loadEpoch: EpochLoader = createEpochLoader();

export interface TemporalCallbacks {
  onRequest?: (time: HistoricalDay, generation: number) => void;
  onPending?: (pending: boolean, generation: number) => void;
  /** Prepare offscreen; the returned function swaps the complete scene synchronously. */
  prepare: (scene: SceneSnapshot, signal: AbortSignal) => Promise<() => void>;
  onCommit: (scene: SceneSnapshot) => void;
  onError?: (error: Error) => void;
}
export type SeekOutcome =
  | { status: 'committed'; scene: SceneSnapshot }
  | { status: 'stale' }
  | { status: 'error'; error: Error };

/** Only the newest fully prepared request may replace the visible historical generation. */
export class TemporalController {
  private generation = 0;
  private aborter: AbortController | null = null;
  private committed: SceneSnapshot | null = null;
  constructor(readonly manifest: TemporalManifest, private readonly callbacks: TemporalCallbacks, private readonly loader: EpochLoader = loadEpoch) {}
  get current(): SceneSnapshot | null { return this.committed; }

  async seek(time: HistoricalDay): Promise<SeekOutcome> {
    return this.seekView(time, async signal => {
      const epoch = this.manifest.epochs.find(epoch => epoch.t_start <= time && time < epoch.t_end);
      const data: SceneData = epoch ? await this.loader(epoch, this.manifest, signal) : {
        epoch_id: 'uncovered', edition: this.manifest.edition, territories: [], population: [], migration: [],
      };
      if (data.epoch_id !== (epoch?.epoch_id ?? 'uncovered') || data.edition !== this.manifest.edition) throw new Error('Loaded scene belongs to a different epoch or edition.');
      const active = <T extends { properties: { t_start: number; t_end: number } }>(features: readonly T[]) =>
        features.filter(feature => feature.properties.t_start <= time && time < feature.properties.t_end);
      return { data: { ...data, territories: active(data.territories), population: active(data.population), migration: active(data.migration),
        ...(data.parts ? { parts: active(data.parts) } : {}) }, displayTime: time };
    });
  }

  /** Viewer resolution is separate from assertions; the same atomic guard owns both paths. */
  async seekView(time: HistoricalDay, resolve: (signal: AbortSignal) => Promise<{ data: SceneData; displayTime: HistoricalDay }>): Promise<SeekOutcome> {
    const generation = ++this.generation;
    this.aborter?.abort();
    const aborter = new AbortController();
    this.aborter = aborter;
    const isCurrent = () => generation === this.generation && !aborter.signal.aborted;
    this.callbacks.onRequest?.(time, generation);
    this.callbacks.onPending?.(true, generation);
    try {
      if (!Number.isSafeInteger(time)) throw new Error('Requested historical time must be an integer day.');
      const resolved = await resolve(aborter.signal);
      if (!isCurrent()) return { status: 'stale' };
      if (!Number.isSafeInteger(resolved.displayTime) || !resolved.data.edition) throw new Error('Invalid resolved viewer scene.');
      const scene: SceneSnapshot = freeze({ ...resolved.data, generation, time: resolved.displayTime });
      const commit = await this.callbacks.prepare(scene, aborter.signal);
      if (!isCurrent()) return { status: 'stale' };
      // No await occurs between the renderer swap and application-state commit.
      commit();
      this.committed = scene;
      this.callbacks.onCommit(scene);
      return { status: 'committed', scene };
    } catch (cause) {
      if (!isCurrent()) return { status: 'stale' };
      const error = cause instanceof Error ? cause : new Error(String(cause));
      this.callbacks.onError?.(error);
      return { status: 'error', error };
    } finally {
      if (isCurrent()) this.callbacks.onPending?.(false, generation);
    }
  }

  /** Cancel immediately when a newer cursor target is queued, before its next frame dispatch. */
  invalidatePending(): void {
    this.generation++;
    this.aborter?.abort();
    this.aborter = null;
    this.callbacks.onPending?.(false, this.generation);
  }

  dispose(): void { this.generation++; this.aborter?.abort(); this.aborter = null; }
}
