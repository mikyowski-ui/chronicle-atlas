import type { Feature, FeatureCollection, LineString, Polygon } from "geojson";

/**
 * Integer days since 1970-01-01 in the proleptic Gregorian calendar.
 * Use Chronicle's existing chronology adapter when converting calendar dates.
 */
export type HistoricalDay = number;

export interface TerritoryProperties {
  entity_id: string;
  render_id: string;
  territory_state_id: string;
  /** Inclusive lower bound of the feature's validity interval. */
  t_start: HistoricalDay;
  /** Exclusive upper bound of the feature's validity interval. */
  t_end: HistoricalDay;
  /** Display interpretation, never an implied universal sovereignty claim. */
  kind?: "political" | "cultural" | "context";
  relation?: string;
  review_status?: "source-attributed" | "independently-reviewed" | "synthetic";
}

export type TerritoryFeature = Feature<Polygon, TerritoryProperties>;

export type SyntheticFixture = FeatureCollection<Polygon, TerritoryProperties> & {
  fixture_kind: "synthetic";
  initial_time: HistoricalDay;
};

export interface FixtureSourceBinding {
  type: "geojson";
  promoteId: "render_id";
  data: SyntheticFixture;
}

export interface CommittedHistoricalState {
  readonly time: HistoricalDay;
  readonly activeFeatures: readonly TerritoryFeature[];
}

export interface ExplorerState {
  requestedTime: HistoricalDay;
  committed: CommittedHistoricalState | null;
  presentation: { elapsedMs: number };
  isPlaying: boolean;
  selectedRenderId: string | null;
}

export interface TerritoryCard extends TerritoryProperties {
  fixture_kind: "synthetic";
  committed_time: HistoricalDay;
}

/** A complete synthetic delivery unit. Epoch bounds are half-open. */
export interface FixtureEpoch {
  epoch_id: string;
  t_start: HistoricalDay;
  t_end: HistoricalDay;
  url: string;
  sha256: string;
  byte_length: number;
  layers: readonly ("territories" | "population" | "migration")[];
  tile: readonly [number, number, number];
}

export interface TemporalManifest {
  schema_version: 1;
  fixture_kind: "synthetic" | "historical-candidate";
  edition: string;
  initial_time: HistoricalDay;
  epochs: readonly FixtureEpoch[];
  title?: string;
  bounds?: readonly [number, number, number, number];
  recorded_at?: string;
  source?: { title: string; edition: string; url: string; license: string; attribution: string };
  methodology?: readonly string[];
}

/** Independent point anchors: never generated from viewport-clipped tile fragments. */
export interface SceneLabel {
  label_id: string;
  entity_id: string;
  text: string;
  position: readonly [number, number];
  priority?: number;
}
export interface SceneEntity { name: string; color: string; number: string; kind?: string }
export interface AssertionEvidence {
  assertion_ids: readonly string[];
  source_title: string;
  source_edition: string;
  source_url: string;
  license: string;
  attribution: string;
  valid_from: HistoricalDay;
  valid_to: HistoricalDay;
  valid_extent?: {
    precision: string;
    start: { earliest: HistoricalDay; latest: HistoricalDay };
    end: { earliest: HistoricalDay; latest: HistoricalDay };
    originalCalendar: string;
    sourceText: string;
    conversionNote: string;
  };
  recorded_from: string;
  recorded_to: string | null;
  methodology: readonly string[];
  limitations: readonly string[];
}
export interface SceneMetadata {
  labels?: readonly SceneLabel[];
  entities?: Readonly<Record<string, SceneEntity>>;
  evidence?: Readonly<Record<string, AssertionEvidence>>;
  parts?: readonly CanonicalPart[];
  geometry_hashes?: Readonly<Record<string, string>>;
}

/** Canonical, unclipped identity index. Tile fragments never define entity identity. */
export interface CanonicalPart {
  properties: TerritoryProperties & { pick_priority?: number; [key: string]: unknown };
  areaKm2: number;
  geometry_hash: string;
}
export interface HashedAsset { url: string; sha256: string; byte_length: number }
export interface VectorArchiveDescriptor extends HashedAsset {
  minzoom: number;
  maxzoom: number;
  bounds: readonly [number, number, number, number];
  source_layers: readonly string[];
  integrity: { chunk_size: number; sha256: readonly string[] };
}
export interface AlphaEpoch {
  epoch_id: string;
  t_start: HistoricalDay;
  t_end: HistoricalDay;
  stream: VectorArchiveDescriptor;
  metadata: HashedAsset;
  fallback: HashedAsset;
}
export interface AlphaManifest extends Omit<TemporalManifest, "schema_version" | "epochs"> {
  schema_version: 2;
  epochs: readonly AlphaEpoch[];
  base_geography: { stream: VectorArchiveDescriptor; fallback: HashedAsset };
}

/** Independent density cell; the value is invented people per square kilometre. */
export type PopulationFeature = Feature<Polygon, {
  render_id: string;
  t_start: HistoricalDay;
  t_end: HistoricalDay;
  density: number;
}>;

/** Invented movement magnitude for the stated interval, not a per-year estimate. */
export type MigrationFeature = Feature<LineString, {
  render_id: string;
  t_start: HistoricalDay;
  t_end: HistoricalDay;
  magnitude: number;
}>;

/** All thematic layers belong to this one immutable committed generation. */
export interface SceneSnapshot extends SceneMetadata {
  generation: number;
  epoch_id: string;
  edition: string;
  time: HistoricalDay;
  territories: readonly TerritoryFeature[];
  population: readonly PopulationFeature[];
  migration: readonly MigrationFeature[];
  stream?: VectorArchiveDescriptor;
  baseGeography?: { stream: VectorArchiveDescriptor; fallback?: HashedAsset };
  displayEdition?: string;
  /** Independent, exactly dated movement overlay; never extends political validity. */
  supplement?: { stream: VectorArchiveDescriptor; edition: string; time: HistoricalDay };
  overlayTime?: HistoricalDay;
  /** Reviewed chronology exclusions applied to both native tiles and feature indexes. */
  suppressedEntityIds?: readonly string[];
}
