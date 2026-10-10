import { sha256 } from '@noble/hashes/sha2.js';

/** Ordered compiler key; every field is required, including source observation date. */
export type PopulationLookupKey = readonly [
  edition: string, entity_id: string, territory_state_id: string, geometry_hash: string,
  population_dataset_version: string, observation_date: string, method_version: string,
];
export interface PrecomputedPopulationMeasure {
  population: number | null;
  areaKm2: number | null;
  coveredAreaKm2: number | null;
  coverageFraction: number | null;
  status: 'complete' | 'partial' | 'unavailable' | 'regional-reference';
  reason: string | null;
}
export interface PopulationSource {
  source_title: string;
  source_edition: string;
  source_url: string;
  input_sha256?: string;
  license: string;
  attribution: string;
}
export interface PopulationLookupEntry {
  key: PopulationLookupKey;
  /** Applicability of this record, not a claim of a constant population. */
  t_start: number;
  t_end: number;
  historical: PrecomputedPopulationMeasure;
  fixed: PrecomputedPopulationMeasure;
  referenceLabel: string;
  observationDateLabel: string;
  methodology: string;
  notes: readonly string[];
  source: PopulationSource;
}
export interface PopulationLookupDocument {
  schema_version: 1;
  edition: string;
  entries: readonly PopulationLookupEntry[];
}
export interface PopulationSceneIdentity {
  edition: string;
  time: number;
  geometry_hashes?: Readonly<Record<string, string>>;
}
export interface PopulationLookupDescriptor { sha256: string; byte_length: number }
const MAX_BYTES = 262_144;
const MAX_ENTRIES = 160;
const digestPattern = /^[a-f0-9]{64}$/;
const measureStatuses = new Set(['complete', 'partial', 'unavailable', 'regional-reference']);

function validMeasure(value: unknown): value is PrecomputedPopulationMeasure {
  if (!value || typeof value !== 'object') return false;
  const m = value as PrecomputedPopulationMeasure;
  return ['population', 'areaKm2', 'coveredAreaKm2', 'coverageFraction'].every(field => {
    const n = m[field as keyof PrecomputedPopulationMeasure];
    return n === null || (typeof n === 'number' && Number.isFinite(n) && n >= 0);
  }) && (m.coverageFraction === null || m.coverageFraction <= 1) && measureStatuses.has(m.status) &&
    (m.reason === null || typeof m.reason === 'string') && (m.status !== 'unavailable' || m.population === null);
}

/** Validation and a small index only. This module never reads or intersects a polygon. */
export function createPopulationLookup(value: unknown) {
  const document = value as PopulationLookupDocument;
  if (!document || document.schema_version !== 1 || typeof document.edition !== 'string' ||
      !Array.isArray(document.entries) || document.entries.length > MAX_ENTRIES) throw new Error('Invalid population lookup.');
  const keys = new Set<string>();
  const index = new Map<string, PopulationLookupEntry[]>();
  for (const row of document.entries) {
    if (!Array.isArray(row.key) || row.key.length !== 7 || row.key.some((part: unknown) => typeof part !== 'string' || !part.length) ||
        row.key[0] !== document.edition || !digestPattern.test(row.key[3]) ||
        !Number.isSafeInteger(row.t_start) || !Number.isSafeInteger(row.t_end) || row.t_start >= row.t_end ||
        !validMeasure(row.historical) || !validMeasure(row.fixed) ||
        typeof row.referenceLabel !== 'string' || typeof row.observationDateLabel !== 'string' ||
        typeof row.methodology !== 'string' || !Array.isArray(row.notes) || row.notes.some((note: unknown) => typeof note !== 'string') ||
        !row.source || ['source_title','source_edition','source_url','license','attribution'].some(field =>
          typeof row.source[field as keyof PopulationSource] !== 'string')) throw new Error('Invalid population lookup entry.');
    const exactKey = JSON.stringify(row.key);
    if (keys.has(exactKey)) throw new Error('Duplicate population lookup key.');
    keys.add(exactKey);
    const identity = JSON.stringify(row.key.slice(0, 4));
    const group = index.get(identity) ?? [];
    if (group.some(other => row.t_start < other.t_end && other.t_start < row.t_end)) throw new Error('Ambiguous population observations.');
    // Copy before freezing: callers cannot mutate a validated lookup after indexing.
    const frozen = Object.freeze({ ...row, key: Object.freeze([...row.key]) as PopulationLookupKey,
      historical: Object.freeze({ ...row.historical }), fixed: Object.freeze({ ...row.fixed }),
      notes: Object.freeze([...row.notes]), source: Object.freeze({ ...row.source }) });
    group.push(frozen); index.set(identity, group);
  }
  return Object.freeze({
    edition: document.edition,
    size: document.entries.length,
    forScene(scene: PopulationSceneIdentity, entityId: string, stateId: string): PopulationLookupEntry | null {
      const geometryHash = scene.geometry_hashes?.[`${entityId}|${stateId}`];
      if (!geometryHash || scene.edition !== document.edition) return null;
      const group = index.get(JSON.stringify([scene.edition, entityId, stateId, geometryHash]));
      return group?.find(row => row.t_start <= scene.time && scene.time < row.t_end) ?? null;
    },
  });
}
export type PopulationLookup = ReturnType<typeof createPopulationLookup>;

/** Bounded sidecar transfer, hashed before parsing. No fallback to a stale edition. */
export async function loadPopulationLookup(url: string | URL, descriptor: PopulationLookupDescriptor,
  signal?: AbortSignal): Promise<PopulationLookup> {
  if (!digestPattern.test(descriptor.sha256) || !Number.isSafeInteger(descriptor.byte_length) ||
      descriptor.byte_length <= 0 || descriptor.byte_length > MAX_BYTES) throw new Error('Invalid population sidecar descriptor.');
  const response = await fetch(url, { signal });
  if (!response.ok || !response.body) throw new Error(`Population lookup delivery failed (${response.status}).`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let count = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      count += value.byteLength;
      if (count > descriptor.byte_length) throw new Error('Population sidecar exceeds declared length.');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  if (count !== descriptor.byte_length) throw new Error('Population sidecar length mismatch.');
  const bytes = new Uint8Array(count); let position = 0;
  for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.byteLength; }
  const digest = [...sha256(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  if (digest !== descriptor.sha256) throw new Error('Population sidecar hash mismatch.');
  return createPopulationLookup(JSON.parse(new TextDecoder().decode(bytes)));
}
