import { sha256 } from '@noble/hashes/sha2.js';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import type { AlphaEpoch, AlphaManifest, CanonicalPart, FixtureEpoch, HashedAsset, MigrationFeature, PopulationFeature, SceneMetadata, TemporalManifest, TerritoryFeature, VectorArchiveDescriptor } from '../../../packages/contracts/src/index.ts';
import { boundedResponse, validateFeature, validateSceneMetadata, type EpochLoader, type SceneData } from './temporal.ts';

const MAX_MANIFEST_BYTES = 65_536;
const MAX_ARCHIVE_BYTES = 1_000_000;
const MAX_METADATA_BYTES = 2 * 1024 * 1024;
const MAX_FALLBACK_BYTES = 4 * 1024 * 1024;
const MAX_PARTS = 1_000;
const LAYERS = ['territories', 'population', 'migration'] as const;
const DIGEST = /^[a-f0-9]{64}$/;
const reads = { requests: 0, receivedBytes: 0, verifiedBytes: 0, metadataBytes: 0, geometryBytes: 0, physicalBytes: 0 };
export const alphaDeliveryMeasurements = () => ({ ...reads, scope: 'Hashed Alpha sidecars only; excludes application bundles, catalog/manifest JSON and native tile ranges.' });
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an Alpha object.');
  return value as Record<string, unknown>;
}
function nonempty(value: unknown): value is string { return typeof value === 'string' && value.length > 0; }
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); Object.values(value).forEach(freeze); }
  return value;
}
function interval(start: unknown, end: unknown): void {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || (start as number) >= (end as number)) throw new Error('Alpha epochs require finite integer half-open intervals.');
}
function bounds(value: unknown): asserts value is readonly [number, number, number, number] {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(Number.isFinite) || value[0] < -180 || value[2] > 180 || value[1] < -85.05112878 || value[3] > 85.05112878 || value[0] >= value[2] || value[1] >= value[3]) throw new Error('Invalid Alpha Web Mercator bounds.');
}
function asset(value: unknown, maximum: number, baseUrl?: string): HashedAsset {
  const input = record(value);
  if (!nonempty(input.url) || !DIGEST.test(String(input.sha256)) || !Number.isSafeInteger(input.byte_length) || (input.byte_length as number) <= 0 || (input.byte_length as number) > maximum) throw new Error('Invalid Alpha asset identity, hash or resource bound.');
  const url = baseUrl ? new URL(input.url, baseUrl).href : input.url;
  if (/^[a-z][a-z\d+.-]*:/i.test(url) && !/^https?:/i.test(url)) throw new Error('Alpha assets require HTTP delivery.');
  return { url, sha256: input.sha256 as string, byte_length: input.byte_length as number };
}
function stream(value: unknown, baseUrl?: string, base = false): VectorArchiveDescriptor {
  const input = record(value); const archive = asset(input, MAX_ARCHIVE_BYTES, baseUrl); bounds(input.bounds);
  if (!Number.isSafeInteger(input.minzoom) || !Number.isSafeInteger(input.maxzoom) || (input.minzoom as number) < 0 || (input.maxzoom as number) < (input.minzoom as number) || (input.maxzoom as number) > 14 || !Array.isArray(input.source_layers) || !input.source_layers.length || new Set(input.source_layers).size !== input.source_layers.length || input.source_layers.some(layer => base ? layer !== 'land' : !LAYERS.includes(layer))) throw new Error('Invalid Alpha vector source layers or zoom range.');
  const integrity = record(input.integrity); const chunk = integrity.chunk_size as number;
  if (!Number.isSafeInteger(chunk) || ![16_384, 65_536].includes(chunk) || !Array.isArray(integrity.sha256) || integrity.sha256.length !== Math.ceil(archive.byte_length / chunk) || !integrity.sha256.every(hash => typeof hash === 'string' && DIGEST.test(hash))) throw new Error('Invalid bounded vector integrity chunks.');
  return { ...archive, minzoom: input.minzoom as number, maxzoom: input.maxzoom as number, bounds: input.bounds, source_layers: input.source_layers as string[], integrity: { chunk_size: chunk, sha256: integrity.sha256 as string[] } };
}

/** Version two separates canonical metadata, Canvas geometry and native tiled delivery. */
export function validateAlphaManifest(value: unknown, baseUrl?: string): AlphaManifest {
  const input = record(value);
  if (input.schema_version !== 2 || !['synthetic', 'historical-candidate'].includes(String(input.fixture_kind)) || !nonempty(input.edition) || !Number.isSafeInteger(input.initial_time) || !Array.isArray(input.epochs) || !input.epochs.length || input.epochs.length > 32) throw new Error('Invalid Alpha temporal manifest.');
  if (input.bounds !== undefined) bounds(input.bounds);
  if (input.fixture_kind === 'historical-candidate' && (!nonempty(input.recorded_at) || !Number.isFinite(Date.parse(input.recorded_at)) || !input.source)) throw new Error('Historical Alpha manifests require a recorded edition and source.');
  const ids = new Set<string>();
  const epochs = input.epochs.map(value => {
    const epoch = record(value); interval(epoch.t_start, epoch.t_end);
    if (!nonempty(epoch.epoch_id) || ids.has(epoch.epoch_id)) throw new Error('Duplicate or invalid Alpha epoch identity.');
    ids.add(epoch.epoch_id);
    return { epoch_id: epoch.epoch_id, t_start: epoch.t_start as number, t_end: epoch.t_end as number, stream: stream(epoch.stream, baseUrl), metadata: asset(epoch.metadata, MAX_METADATA_BYTES, baseUrl), fallback: asset(epoch.fallback, MAX_FALLBACK_BYTES, baseUrl) };
  }).sort((a, b) => a.t_start - b.t_start);
  for (let i = 1; i < epochs.length; i++) if (epochs[i].t_start < epochs[i - 1].t_end) throw new Error('Alpha epochs must not overlap.');
  if (!epochs.some(epoch => epoch.t_start <= (input.initial_time as number) && (input.initial_time as number) < epoch.t_end)) throw new Error('Alpha initial time has no explicit coverage.');
  const base = record(input.base_geography);
  return freeze({ ...input, epochs, base_geography: { ...base, stream: stream(base.stream, baseUrl, true), fallback: asset(base.fallback, MAX_FALLBACK_BYTES, baseUrl) } } as unknown as AlphaManifest);
}
export async function fetchAlphaManifest(url: string, signal?: AbortSignal): Promise<AlphaManifest> {
  signal?.throwIfAborted(); const response = await fetch(url, { signal });
  const bytes = await boundedResponse(response, MAX_MANIFEST_BYTES, signal);
  return validateAlphaManifest(JSON.parse(new TextDecoder().decode(bytes)), response.url || new URL(url, globalThis.location?.href).href);
}
/** Adapt only chronology; this descriptor must be paired with createAlphaLoader. */
export function adaptAlphaManifest(manifest: AlphaManifest): TemporalManifest {
  return freeze({ ...manifest, schema_version: 1, epochs: manifest.epochs.map(epoch => ({ epoch_id: epoch.epoch_id, t_start: epoch.t_start, t_end: epoch.t_end, url: epoch.stream.url, sha256: epoch.stream.sha256, byte_length: epoch.stream.byte_length, layers: epoch.stream.source_layers as FixtureEpoch['layers'], tile: [0, 0, 0] as const })) });
}
export function validateAlphaMetadata(value: unknown, epoch: AlphaEpoch, manifest: AlphaManifest): SceneMetadata {
  const input = record(value);
  if (input.schema_version !== 2 || input.fixture_kind !== manifest.fixture_kind || input.edition !== manifest.edition || input.epoch_id !== epoch.epoch_id || input.t_start !== epoch.t_start || input.t_end !== epoch.t_end || !Array.isArray(input.parts) || input.parts.length > MAX_PARTS) throw new Error('Alpha metadata differs from its manifest generation.');
  const ids = new Set<string>();
  const parts = input.parts.map(value => {
    const part = record(value); const properties = record(part.properties); interval(properties.t_start, properties.t_end);
    if (!nonempty(properties.entity_id) || !nonempty(properties.render_id) || !nonempty(properties.territory_state_id) || ids.has(properties.render_id) || (properties.t_start as number) < epoch.t_start || (properties.t_end as number) > epoch.t_end || typeof part.areaKm2 !== 'number' || !Number.isFinite(part.areaKm2) || part.areaKm2 < 0 || !DIGEST.test(String(part.geometry_hash)) || (properties.pick_priority !== undefined && (typeof properties.pick_priority !== 'number' || !Number.isFinite(properties.pick_priority)))) throw new Error('Invalid canonical Alpha part.');
    ids.add(properties.render_id); return part as unknown as CanonicalPart;
  });
  if (epoch.stream.source_layers.includes('territories') !== (parts.length > 0)) throw new Error('Canonical part index differs from declared territory layer.');
  const geometryHashes = record(input.geometry_hashes);
  if (Object.values(geometryHashes).some(hash => typeof hash !== 'string' || !DIGEST.test(hash)) || parts.some(part => !geometryHashes[`${part.properties.entity_id}|${part.properties.territory_state_id}`])) throw new Error('Missing or invalid territory geometry hashes.');
  if (input.migration !== undefined) {
    if (!Array.isArray(input.migration) || input.migration.length > 100 || (!epoch.stream.source_layers.includes('migration') && input.migration.length)) throw new Error('Invalid bounded migration card metadata.');
    const adapted = adaptAlphaManifest(manifest).epochs.find(candidate => candidate.epoch_id === epoch.epoch_id)!;
    for (const feature of input.migration) {
      validateFeature(feature, 'migration', adapted, true);
      const id = feature.properties.render_id;
      if (ids.has(id)) throw new Error('Duplicate Alpha metadata render identity.');
      ids.add(id);
    }
  }
  if (input.migration_observation !== undefined) {
    const evidence = record(input.migration_observation);
    interval(evidence.t_start, evidence.t_end);
    const from = typeof evidence.recorded_from === 'string' ? Date.parse(evidence.recorded_from) : NaN;
    const to = evidence.recorded_to === null ? Infinity : typeof evidence.recorded_to === 'string' ? Date.parse(evidence.recorded_to) : NaN;
    const asOf = Date.parse(manifest.recorded_at ?? '');
    if (!nonempty(evidence.source_title) || !nonempty(evidence.source_edition) || !nonempty(evidence.source_url) ||
      !nonempty(evidence.license) || !nonempty(evidence.attribution) || !nonempty(evidence.methodology) || !Array.isArray(evidence.limitations) ||
      (evidence.t_start as number) < epoch.t_start || (evidence.t_end as number) > epoch.t_end ||
      !Number.isFinite(from) || Number.isNaN(to) || to <= from || !Number.isFinite(asOf) || from > asOf || asOf >= to) {
      throw new Error('Migration evidence is incomplete or inactive in the recorded edition.');
    }
  }
  const metadata = { ...input, parts } as unknown as SceneMetadata;
  validateSceneMetadata(metadata, parts, adaptAlphaManifest(manifest)); return freeze(metadata);
}
async function jsonAsset(descriptor: HashedAsset, fetcher: typeof fetch, signal: AbortSignal, kind: 'metadataBytes'|'geometryBytes'|'physicalBytes'): Promise<unknown> {
  signal.throwIfAborted(); const response = await fetcher(descriptor.url, { signal });
  const bytes = await boundedResponse(response, descriptor.byte_length, signal);
  reads.requests++; reads.receivedBytes += bytes.byteLength;
  if (bytes.byteLength !== descriptor.byte_length) throw new Error('Alpha sidecar length differs from its manifest.');
  const hash = Array.from(sha256(new Uint8Array(bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
  signal.throwIfAborted(); if (hash !== descriptor.sha256) throw new Error('Alpha sidecar SHA-256 differs from its manifest.');
  reads.verifiedBytes += bytes.byteLength; reads[kind] += bytes.byteLength;
  return JSON.parse(new TextDecoder().decode(bytes));
}
function validateFallback(value: unknown, epoch: AlphaEpoch, manifest: AlphaManifest, metadata: SceneMetadata) {
  const input = record(value);
  if (input.schema_version !== 2 || input.edition !== manifest.edition || input.epoch_id !== epoch.epoch_id) throw new Error('Alpha Canvas geometry differs from the metadata generation.');
  const legacyEpoch = adaptAlphaManifest(manifest).epochs.find(candidate => candidate.epoch_id === epoch.epoch_id)!;
  const allIds = new Set<string>(); const decoded: Record<string, Feature[]> = {};
  for (const name of LAYERS) {
    const features = input[name];
    if (!Array.isArray(features) || features.length > MAX_PARTS || (epoch.stream.source_layers.includes(name) ? !features.length : features.length > 0)) throw new Error('Alpha Canvas layer differs from declared stream layers.');
    decoded[name] = features.map(value => {
      const feature = record(value) as unknown as Feature;
      if (feature.type !== 'Feature') throw new Error('Invalid Alpha Canvas feature.'); validateFeature(feature, name, legacyEpoch, true);
      const id = feature.properties!.render_id as string;
      if (allIds.has(id)) throw new Error('Duplicate Alpha Canvas render identity.'); allIds.add(id); return { ...feature, id };
    });
  }
  const canonical = new Map(metadata.parts!.map(part => [part.properties.render_id, part]));
  if (decoded.territories.length !== canonical.size) throw new Error('Canvas geometry does not cover the canonical part index.');
  for (const feature of decoded.territories) {
    const props = feature.properties!; const part = canonical.get(props.render_id);
    if (!part || ['entity_id', 'territory_state_id', 't_start', 't_end'].some(key => props[key] !== part.properties[key])) throw new Error('Canvas geometry has a noncanonical identity.');
  }
  return { territories: decoded.territories as TerritoryFeature[], population: decoded.population as PopulationFeature[], migration: decoded.migration as MigrationFeature[] };
}
/** Canvas alone fetches the independent neutral geography; GL uses its streamed source. */
export async function loadAlphaBase(value: AlphaManifest, manifestURL: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<FeatureCollection<Polygon | MultiPolygon>> {
  const manifest = validateAlphaManifest(value, manifestURL);
  const input = record(await jsonAsset(manifest.base_geography.fallback, fetcher, signal, 'physicalBytes'));
  if (input.type !== 'FeatureCollection' || !Array.isArray(input.features) || input.features.length > MAX_PARTS) throw new Error('Invalid neutral Canvas geography.');
  let vertices = 0;
  for (const item of input.features) {
    const feature = record(item); const geometry = record(feature.geometry);
    if (feature.type !== 'Feature' || !['Polygon','MultiPolygon'].includes(String(geometry.type)) || !Array.isArray(geometry.coordinates) || !geometry.coordinates.length) throw new Error('Invalid neutral land polygon.');
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    for (const polygon of polygons) {
      if (!Array.isArray(polygon) || !polygon.length) throw new Error('Invalid neutral land component.');
    for (const ring of polygon) {
      if (!Array.isArray(ring) || ring.length < 4 || ring.some(point => !Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite) || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 85.05112878)) throw new Error('Invalid neutral land coordinates.');
      if (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1]) throw new Error('Neutral land ring is not closed.');
      vertices += ring.length; if (vertices > 250_000) throw new Error('Neutral land exceeds the vertex budget.');
    }}
  }
  return freeze(input as unknown as FeatureCollection<Polygon | MultiPolygon>);
}
/** GL fetches only metadata; Canvas also fetches full source geometry. Two successful generations stay cached. */
export function createAlphaLoader(value: AlphaManifest, manifestURL: string, canvasMode: boolean, fetcher: typeof fetch = fetch, cache = new Map<string, SceneData>()): EpochLoader {
  const manifest = validateAlphaManifest(value, manifestURL); const adapted = adaptAlphaManifest(manifest);
  return async (requestedEpoch, requestedManifest, signal) => {
    signal.throwIfAborted();
    if (requestedManifest.edition !== manifest.edition || requestedManifest.fixture_kind !== manifest.fixture_kind || requestedManifest.recorded_at !== manifest.recorded_at) throw new Error('Alpha loader cannot cross recorded editions.');
    const epoch = manifest.epochs.find(candidate => candidate.epoch_id === requestedEpoch.epoch_id);
    const expected = adapted.epochs.find(candidate => candidate.epoch_id === requestedEpoch.epoch_id);
    if (!epoch || !expected || requestedEpoch.t_start !== expected.t_start || requestedEpoch.t_end !== expected.t_end || requestedEpoch.sha256 !== expected.sha256 || requestedEpoch.byte_length !== expected.byte_length || requestedEpoch.url !== expected.url) throw new Error('Alpha loader received a different epoch descriptor.');
    const key = JSON.stringify([manifest.fixture_kind, manifest.edition, manifest.recorded_at, epoch, canvasMode]);
    const cached = cache.get(key); if (cached) { cache.delete(key); cache.set(key, cached); return cached; }
    const metadata = validateAlphaMetadata(await jsonAsset(epoch.metadata, fetcher, signal, 'metadataBytes'), epoch, manifest);
    const layers = canvasMode ? validateFallback(await jsonAsset(epoch.fallback, fetcher, signal, 'geometryBytes'), epoch, manifest, metadata) : { territories: [], population: [], migration: ((metadata as SceneMetadata & { migration?: MigrationFeature[] }).migration ?? []) };
    signal.throwIfAborted();
    const scene: SceneData = freeze({ ...metadata, ...layers, epoch_id: epoch.epoch_id, edition: manifest.edition, stream: epoch.stream, baseGeography: manifest.base_geography, displayEdition: manifest.edition });
    cache.set(key, scene); while (cache.size > 2) cache.delete(cache.keys().next().value!); return scene;
  };
}
