/** Researched political lifecycles are independent of map-observation validity. */
import historyData from '../public/history/state-histories.json';
import capitalData from '../public/history/capitals.json';
import { eventDay, type HistoricalTimelineEvent } from './historical-context';

export interface StateHistorySource {
  id: string; title: string; publisher: string; url: string; verifiedAt?: string; rights?: string;
}
export interface StateHistoryAlias { name: string; fromYear: number; toYear: number }
export interface StateHistoryTransition {
  year: number; dateLabel: string; title: string; summary: string;
  type: string; targets: string[]; precision: string; sourceIds: string[];
}
export interface StateHistory {
  id: string; title: string; aliases: StateHistoryAlias[];
  /** Historical BCE/CE signed years: -1 means 1 BCE; zero is prohibited. */
  fromYear: number; toYear: number; periodLabel: string; precision: string;
  summary: string; continuity: string; sources: StateHistorySource[];
  continents: string[]; kind: 'political'; transitions: StateHistoryTransition[]; ongoing?: boolean;
}
export interface CapitalPeriod {
  from: number; to: number; polityId: string; label?: string; sourceId: string; note?: string;
}
export interface HistoricalCapital {
  id: string; cityId?: string; name: string; coordinates: [number, number];
  coordinateSourceId: string; coordinateNote?: string; sourceIds: string[]; periods: CapitalPeriod[];
}
export interface ActiveHistoricalCapital extends HistoricalCapital { period: CapitalPeriod }
export const STATE_HISTORIES = historyData.profiles as StateHistory[];
export const STATE_HISTORY_EDITION = historyData.edition;
export const HISTORICAL_CAPITALS = capitalData.capitals as HistoricalCapital[];
export const CAPITAL_SOURCES = capitalData.sources as StateHistorySource[];
/** Named capital identities are independent of whether a full lifecycle is researched. */
export const CAPITAL_POLITIES = capitalData.polities as { id: string; title: string; scope: string }[];

/** App year 0 is astronomical 1 BCE. Never expose it as a historical year zero. */
export function toHistoricalYear(astronomicalYear: number): number {
  if (!Number.isInteger(astronomicalYear)) throw new RangeError('Expected an integer astronomical year');
  return astronomicalYear <= 0 ? astronomicalYear - 1 : astronomicalYear;
}
export function toAstronomicalYear(historicalYear: number): number {
  if (!Number.isInteger(historicalYear) || historicalYear === 0) throw new RangeError('Historical year zero does not exist');
  return historicalYear < 0 ? historicalYear + 1 : historicalYear;
}
const normalizedName = (name: string) => name.trim().toLocaleLowerCase('en');
export function getStateHistory(id: string): StateHistory | undefined {
  return STATE_HISTORIES.find(profile => profile.id === id);
}
/** Match the source label AND its date; a familiar name never bridges unrelated states. */
export function findStateHistory(name: string, displayedAstronomicalYear: number, kind?: string): StateHistory | undefined {
  if (kind !== undefined && kind !== 'political' && kind !== 'political-association') return undefined;
  if (!Number.isInteger(displayedAstronomicalYear)) return undefined;
  const year = toHistoricalYear(displayedAstronomicalYear);
  const normalized = normalizedName(name);
  const matches = STATE_HISTORIES.filter(profile => profile.aliases.some(alias =>
    normalizedName(alias.name) === normalized && year >= alias.fromYear && year <= alias.toYear));
  return matches.length === 1 ? matches[0] : undefined;
}
/** A history may remain open while scrubbing; its capital still depends on the current year. */
export function activeCapitals(polityId: string, astronomicalYear: number): ActiveHistoricalCapital[] {
  if (!Number.isInteger(astronomicalYear)) return [];
  const year = toHistoricalYear(astronomicalYear);
  return HISTORICAL_CAPITALS.flatMap(capital => capital.periods
    .filter(period => period.polityId === polityId && year >= period.from && year <= period.to)
    .map(period => ({ ...capital, period })));
}
export function formatHistoryYear(year: number): string {
  if (!Number.isInteger(year) || year === 0) throw new RangeError('Historical year zero does not exist');
  return year < 0 ? `${Math.abs(year).toLocaleString('en')} BCE` : `${year.toLocaleString('en')} CE`;
}

/** Contextual navigation anchors, never evidence that borders were observed on these dates. */
export const STATE_HISTORY_EVENTS: readonly HistoricalTimelineEvent[] = STATE_HISTORIES.flatMap(profile => {
  const begins: StateHistoryTransition[] = profile.transitions.some(t => t.year === profile.fromYear) ? [] : [{
    year: profile.fromYear,
    dateLabel: `${profile.precision === 'year' ? '' : 'c. '}${formatHistoryYear(profile.fromYear)}`,
    title: `${profile.title}: period begins`,
    summary: `Start of the ${profile.title} period covered by the researched lifecycle. ${profile.precision === 'year' ? '' : 'This is an approximate chronology. '}This contextual date does not establish a dated border observation.`,
    type: 'period-begin', targets: [], precision: profile.precision,
    sourceIds: [profile.sources[0].id],
  }];
  return [...begins, ...profile.transitions].map((transition, index) => {
    const year = toAstronomicalYear(transition.year);
    return {
      id: `state-history:${profile.id}:${index}`, time: eventDay(year), year, month: 1, day: 1,
      title: `${transition.dateLabel} · ${transition.title}`, description: transition.summary,
      kind: 'event' as const, dateLabel: transition.dateLabel,
      precision: transition.precision === 'year' ? 'year' as const : 'circa-year' as const,
      entityNames: [...new Set(profile.aliases.map(alias => alias.name))], entityIds: [],
      continents: profile.continents, civilization: profile.title,
      sourceURL: profile.sources.find(source => transition.sourceIds.includes(source.id))?.url ?? profile.sources[0].url,
      sourceIds: transition.sourceIds,
    };
  });
});
