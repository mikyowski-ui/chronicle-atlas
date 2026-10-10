/** Exact-name, date-aware study coverage. Observation ranges are never state lifespans. */
import coverage from '../public/history/state-coverage.json';
import { getStateHistory, type StateHistory, type StateHistorySource } from './state-histories';
export type StateCoverageKind = 'political' | 'cultural' | 'context';
export interface StateCoverageSource { id: string; title: string; publisher: string; url: string; license: string; type: string; edition: string; limitations: string }
export interface StateCoverageObservation {
  observationId: string; scope: 'world' | 'isles';
  /** Signed historical year; -1 is 1 BCE, and year zero does not exist. */
  year: number; entityId: string; sourceId: string; classificationRules: string[];
  borderPrecision: number[]; sourceFeatureIndexes: number[]; historyId: string | null;
  chronologyReview: {allowed: boolean; ruleId?: string; note?: string; sources?: {url: string; title: string}[]};
}
export interface StateCoverageEntry {
  id: string; title: string; kind: StateCoverageKind; summary: string; continuity: string;
  entityIds: string[]; sourceIds: string[]; historyIds: string[];
  observations: StateCoverageObservation[]; observationYears: number[];
  firstObservationYear: number; lastObservationYear: number;
  researchStatus: 'researched-overview' | 'partly-researched' | 'atlas-description';
  researchedObservationCount: number;
  researchNotes: {summary: string; sourceIds: string[]}[]; sources: StateHistorySource[];
}
export interface StateCoverageMatch { entry: StateCoverageEntry; observation?: StateCoverageObservation; history?: StateHistory }
export const STATE_COVERAGE = coverage.entries as StateCoverageEntry[];
export const STATE_COVERAGE_STATS = coverage.stats;
export const STATE_COVERAGE_SOURCES = coverage.sources as StateCoverageSource[];
export const STATE_COVERAGE_OBSERVATIONS = coverage.observationIndex;
const normalize = (value: string) => value.trim().toLocaleLowerCase('en');
export function getStateCoverage(id: string): StateCoverageEntry | undefined { return STATE_COVERAGE.find(entry => entry.id === id); }
export function stateCoverageSources(entry: StateCoverageEntry): StateCoverageSource[] {
  return STATE_COVERAGE_SOURCES.filter(source => entry.sourceIds.includes(source.id));
}
/** atYear is an exact map observation year, never a nearest-year or lifetime match. */
export function searchStateCoverage(query = '', options: {kind?: StateCoverageKind; atYear?: number; scope?: 'world' | 'isles'; limit?: number; includeSuppressed?: boolean} = {}): StateCoverageEntry[] {
  const needle = normalize(query);
  return STATE_COVERAGE.filter(entry => (!options.kind || entry.kind === options.kind)
    && (!needle || normalize(entry.title).includes(needle))
    && ((options.atYear === undefined && !options.scope) || entry.observations.some(observation =>
      (options.atYear === undefined || observation.year === options.atYear) && (!options.scope || observation.scope === options.scope)
      && (options.atYear === undefined || options.includeSuppressed || observation.chronologyReview.allowed))))
    .slice(0, options.limit ?? STATE_COVERAGE.length);
}
/** Exact source entity identity is preferred. Name-only ambiguity returns nothing. */
export function findStateCoverage(options: {entityId?: string; name?: string; observationYear?: number; scope?: 'world' | 'isles'; kind?: string}): StateCoverageMatch | undefined {
  if (!options.entityId && !options.name) return undefined;
  const matches = STATE_COVERAGE.filter(entry =>
    (!options.kind || entry.kind === options.kind)
    && (options.entityId ? entry.entityIds.includes(options.entityId) : normalize(entry.title) === normalize(options.name!))
    && entry.observations.some(observation => (!options.scope || observation.scope === options.scope)
      && (!options.entityId || observation.entityId === options.entityId)
      && (options.observationYear === undefined || observation.year === options.observationYear)));
  if (matches.length !== 1) return undefined;
  const entry = matches[0];
  const observations = entry.observations.filter(observation => (!options.scope || observation.scope === options.scope)
    && (!options.entityId || observation.entityId === options.entityId)
    && (options.observationYear === undefined || observation.year === options.observationYear));
  // Do not silently replace an explicitly requested missing observation with another date.
  if (!observations.length && (options.observationYear !== undefined || options.scope)) return undefined;
  const observation = options.observationYear === undefined ? undefined : observations[0];
  return { entry, observation, history: observation?.historyId ? getStateHistory(observation.historyId) : undefined };
}
