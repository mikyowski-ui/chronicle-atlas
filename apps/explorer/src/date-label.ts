import type { HistoricalDay } from '../../../packages/contracts/src/index.ts';

// Display only. Fixture day numbers are checked against the retained chronology
// adapter in tests; no calendar parsing or alternate historical time model.
export function formatFixtureYear(day: HistoricalDay): string {
  const year = new Date(day * 86_400_000).getUTCFullYear();
  return year <= 0 ? `${1 - year} BCE` : `${year} CE`;
}
