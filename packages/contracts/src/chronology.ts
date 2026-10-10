export type HistoricalDay = number;
export const chronology = Object.freeze({ calendar: 'proleptic-gregorian', epoch: '1970-01-01', canonicalPrecision: 'integer-day', astronomicalYearZero: true } as const);
export function yearToDay(year: number): HistoricalDay {
  if (!Number.isSafeInteger(year) || year < -12000 || year > 3000) throw new RangeError('INVALID_YEAR');
  const date = new Date(0); date.setUTCFullYear(year, 0, 1); return date.getTime() / 86400000;
}
export function dayToYear(day: HistoricalDay): number {
  if (!Number.isSafeInteger(day)) throw new RangeError('INVALID_DAY');
  const year = new Date(day * 86400000).getUTCFullYear();
  if (!Number.isFinite(year) || year < -12000 || year > 3000) throw new RangeError('INVALID_DAY');
  return year;
}
