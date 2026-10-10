/** Navigation uses proleptic Gregorian days; source precision stays in evidence. */
export function formatNavigationDate(day: number): string {
  const date = new Date(Math.floor(day) * 86400000);
  const year = date.getUTCFullYear();
  return `${year <= 0 ? 1 - year : year}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')} ${year <= 0 ? 'BCE' : 'CE'}`;
}

export function parseNavigationDate(text: string): number | null {
  const match = /^(\d{1,6})-(\d{2})-(\d{2})\s+(BCE|CE)$/i.exec(text.trim());
  if (!match || Number(match[1]) === 0) return null;
  const year = match[4].toUpperCase() === 'BCE' ? 1 - Number(match[1]) : Number(match[1]);
  const month = Number(match[2]) - 1, day = Number(match[3]);
  const date = new Date(0); date.setUTCFullYear(year, month, day);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) return null;
  const time = date.getTime() / 86400000;
  return Number.isSafeInteger(time) ? time : null;
}
