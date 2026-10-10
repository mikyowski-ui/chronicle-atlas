import review from '../public/history/political-review.json';
import type { SceneData } from './temporal.ts';

export interface PoliticalRule {
  id: string; labels: string[]; start_inclusive?: string; end_exclusive?: string;
  intervals?: string[][]; source_year_max?: number; boundary_kind?: string;
  sources: { url: string; title: string }[]; note: string;
}
export interface ContinuityFinding {
  entityId: string; name: string; ruleId: string;
  reason: 'source-outside-reviewed-period' | 'requested-date-outside-reviewed-period' | 'reference-crosses-reviewed-discontinuity';
  note: string; sources: readonly { url: string; title: string }[];
}
export const POLITICAL_REVIEW = review;
export const POLITICAL_RULES = review.rules as readonly PoliticalRule[];

/** These dates use civil BCE numbering, unlike the astronomical Date year. */
export function politicalCivilDay(value: string): number {
  const match = /^(-?\d{4,6})-(\d{2})-(\d{2})$/.exec(value);
  if (!match || Number(match[1]) === 0) throw Error('Expected a signed civil date without year zero.');
  const year = Number(match[1]), date = new Date(0);
  date.setUTCFullYear(year < 0 ? year + 1 : year, Number(match[2]) - 1, Number(match[3]));
  date.setUTCHours(0, 0, 0, 0);
  if (date.getUTCMonth() !== Number(match[2]) - 1 || date.getUTCDate() !== Number(match[3])) throw Error('Invalid civil date.');
  return date.getTime() / 86_400_000;
}
function yearAt(day: number): number {
  const year = new Date(day * 86_400_000).getUTCFullYear();
  return year <= 0 ? year - 1 : year;
}
const indexed = POLITICAL_RULES.map(rule => ({
  rule,
  windows: rule.intervals?.map(([start, end]) => [politicalCivilDay(start), politicalCivilDay(end)] as const)
    ?? [[rule.start_inclusive ? politicalCivilDay(rule.start_inclusive) : -Infinity, rule.end_exclusive ? politicalCivilDay(rule.end_exclusive) : Infinity] as const],
}));
const transitions = [...new Set(indexed.flatMap(row => row.windows.flatMap(window => [...window])).filter(Number.isFinite))].sort((a,b) => a-b);
const inWindow = (windows: readonly (readonly [number, number])[], day: number) => windows.some(([from,to]) => from <= day && day < to);

/** Only negative chronological constraints. No matching rule means unreviewed, not verified. */
export function resolvePoliticalContinuity(name: string, requestedTime: number, observationTime = requestedTime):
  { allowed: boolean; rule?: PoliticalRule; reason?: ContinuityFinding['reason'] } {
  if (!Number.isSafeInteger(requestedTime) || !Number.isSafeInteger(observationTime)) throw Error('Chronology requires integer canonical days.');
  const row = indexed.find(row => row.rule.labels.includes(name)
    && (row.rule.source_year_max === undefined || yearAt(observationTime) <= row.rule.source_year_max));
  if (!row) return { allowed: true };
  if (!inWindow(row.windows, observationTime)) return { allowed: false, rule: row.rule, reason: 'source-outside-reviewed-period' };
  if (!inWindow(row.windows, requestedTime)) return { allowed: false, rule: row.rule, reason: 'requested-date-outside-reviewed-period' };
  if (!row.windows.some(([from,to]) => from <= observationTime && observationTime < to && from <= requestedTime && requestedTime < to))
    return { allowed: false, rule: row.rule, reason: 'reference-crosses-reviewed-discontinuity' };
  return { allowed: true, rule: row.rule };
}

/** Include in a display-plan key so crossing a guard boundary rematerializes raw source arrays, including reverse scrubbing. */
export function politicalContinuityKey(requestedTime: number): string {
  if (!Number.isSafeInteger(requestedTime)) throw Error('Chronology requires an integer day.');
  return 'chronology:' + transitions.filter(day => day <= requestedTime).length;
}

/**
 * Filters geometry indexes, labels and picks together without changing source geometry,
 * source valid-time bounds, entity identities, colors, or evidence. The native vector
 * renderer must also exclude suppressedEntityIds from its PMTiles layer filters.
 */
export function reviewPoliticalContinuity<T extends SceneData & { time?: number }>(source: T, requestedTime: number,
  observationTime = source.time ?? requestedTime): { scene: T; suppressedEntityIds: readonly string[]; findings: readonly ContinuityFinding[] } {
  const findings: ContinuityFinding[] = [], seen = new Set<string>();
  const properties = source.parts?.map(part => part.properties) ?? source.territories.map(feature => feature.properties);
  for (const propertiesRow of properties) {
    const entityId = propertiesRow.entity_id;
    if (seen.has(entityId)) continue;
    seen.add(entityId);
    const entity = source.entities?.[entityId];
    if (!entity || (propertiesRow.kind && propertiesRow.kind !== 'political') || (entity.kind && entity.kind !== 'political')) continue;
    const match = resolvePoliticalContinuity(entity.name, requestedTime, observationTime);
    if (!match.allowed && match.rule && match.reason) findings.push({entityId, name: entity.name, ruleId: match.rule.id,
      reason: match.reason, note: match.rule.note, sources: match.rule.sources});
  }
  const suppressedEntityIds = findings.map(finding => finding.entityId);
  if (!findings.length) return { scene: source, suppressedEntityIds, findings };
  const suppressed = new Set(suppressedEntityIds);
  return {
    scene: { ...source,
      territories: source.territories.filter(feature => !suppressed.has(feature.properties.entity_id)),
      ...(source.parts ? { parts: source.parts.filter(part => !suppressed.has(part.properties.entity_id)) } : {}),
      ...(source.labels ? { labels: source.labels.filter(label => !suppressed.has(label.entity_id)) } : {}),
    },
    suppressedEntityIds, findings,
  };
}
