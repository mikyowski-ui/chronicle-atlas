/** Editorial context for selected, admitted source observations. Never extends border validity. */
import data from '../public/glass/context-data.json';

export interface HistoricalSource {
  id: string; title: string; publisher: string; url: string;
  verifiedAt?: string; rights?: string;
}
export interface HistoricalContextImage {
  src: string; alt: string; caption: string; credit: string; sourceUrl: string; rights: string;
}
export interface HistoricalContextProfile {
  id: string; names: string[]; kind: 'political'; fromYear: number; toYear: number;
  /** Explicit astronomical observation years; no assumption that an intervening year is researched. */
  observationYears: number[];
  title: string; periodLabel: string; summary: string; institutions: string[]; changes: string[];
  metrics?: { label: string; value: string; qualifier: string; sourceId: string }[];
  succession?: {
    label: string; summary: string; dateLabel: string; year: number; sourceIds: string[];
    /** Supported map dates, deliberately separate from the transition year. */
    targets: { name: string; year: number; entityId?: string }[];
  };
  image?: HistoricalContextImage;
  sources: HistoricalSource[]; claimIds: string[]; continents: string[]; civilization: string;
}
export interface HistoricalTimelineEvent {
  id: string; time: number; year: number; month: number; day: number; title: string;
  description: string; kind: 'event'; dateLabel: string; precision: 'year' | 'circa-year' | 'day';
  entityNames: string[]; entityIds: string[]; continents: string[]; civilization: string;
  sourceURL: string; sourceIds: string[];
}
/** Navigation anchor only. Approximate/year precision remains explicit on the event. */
export function eventDay(astronomicalYear: number, month = 1, day = 1): number {
  if (!Number.isInteger(astronomicalYear) || !Number.isInteger(month) || !Number.isInteger(day)) throw new RangeError('Invalid navigation date');
  const date = new Date(0);
  date.setUTCFullYear(astronomicalYear, month - 1, day);
  if (date.getUTCFullYear() !== astronomicalYear || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new RangeError('Invalid navigation date');
  return date.getTime() / 86400000;
}
export const HISTORICAL_CONTEXT_EDITION = data.edition;
export const HISTORICAL_CONTEXTS: readonly HistoricalContextProfile[] = data.profiles as HistoricalContextProfile[];
export const historicalEvents: HistoricalTimelineEvent[] = (data.events as Omit<HistoricalTimelineEvent, 'time'>[])
  .map(event => ({ ...event, time: eventDay(event.year, event.month, event.day) }));
export const HISTORICAL_EVENTS: readonly HistoricalTimelineEvent[] = historicalEvents;

/** Match the displayed source observation, never the requested reference-view cursor. */
export function findHistoricalContext(name: string, displayedYear: number, kind?: string): HistoricalContextProfile | undefined {
  if (kind !== undefined && kind !== 'political' && kind !== 'political-association') return undefined;
  const normalized = name.trim().toLocaleLowerCase('en');
  return HISTORICAL_CONTEXTS.find(profile => profile.observationYears.includes(displayedYear)
    && profile.names.some(alias => alias.toLocaleLowerCase('en') === normalized));
}
