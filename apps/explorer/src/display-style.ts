/** Display meaning is separate from source identity and never implies sovereignty. */
export type DisplayKind = 'political' | 'cultural' | 'context';

export const DISPLAY_ORDER = ['context', 'cultural', 'political'] as const;
export const DISPLAY_STYLES = Object.freeze({
  context: Object.freeze({ opacity: .18, stroke: '#9a9180', dash: [1, 3] as readonly number[], lineWidth: .8, label: 'Source context · not political ownership' }),
  cultural: Object.freeze({ opacity: .36, stroke: '#8d7d66', dash: [5, 3] as readonly number[], lineWidth: 1, label: 'Cultural approximation · not political ownership' }),
  political: Object.freeze({ opacity: .94, stroke: '#657e78', dash: [] as readonly number[], lineWidth: .75, label: 'Source-attributed political association' }),
});

/** Missing kind is the retained synthetic/political fixture contract. */
export function displayKind(properties: { kind?: unknown }): DisplayKind {
  return properties.kind === 'cultural' || properties.kind === 'context' ? properties.kind : 'political';
}

export function displayRank(properties: { kind?: unknown }): number {
  return DISPLAY_ORDER.indexOf(displayKind(properties));
}

/** Paint contexts first, so they cannot obscure admitted political outlines. */
export function orderDisplayFeatures<T extends { properties: { kind?: unknown; render_id: string } }>(features: readonly T[]): T[] {
  return features.slice().sort((a, b) => displayRank(a.properties) - displayRank(b.properties)
    || (a.properties.render_id < b.properties.render_id ? -1 : a.properties.render_id > b.properties.render_id ? 1 : 0));
}
