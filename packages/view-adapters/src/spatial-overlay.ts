import { z } from '@chronicle/contracts/schema';
import { boundedJSON, immutable } from '@chronicle/contracts/canonical';
import { matchesCursor } from './hud-contract.ts';

z.config({ jitless: true });
const id = z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const year = z.number().int().min(-12000).max(3000);
const position = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
const ring = z.array(position).min(4).max(4096).refine(points => points[0][0] === points.at(-1)![0] && points[0][1] === points.at(-1)![1]);
const geometry = z.union([z.strictObject({ type: z.literal('Point'), coordinates: position }), z.strictObject({ type: z.literal('Polygon'), coordinates: z.array(ring).min(1).max(32) })]);
const properties = z.strictObject({ entityId: id, observationId: id, revision: z.number().int().nonnegative(), startYear: year.nullable(), endYear: year.nullable(), sourceHash: z.string().regex(/^[a-f0-9]{64}$/) }).refine(value => value.startYear === null ? value.endYear === null : value.endYear !== null && value.startYear <= value.endYear);
export const ResearchOverlaySchema = z.strictObject({ type: z.literal('FeatureCollection'), features: z.array(z.strictObject({ type: z.literal('Feature'), id, geometry, properties })).max(2000) })
  .refine(value => new Set(value.features.map(feature => feature.id)).size === value.features.length && value.features.every(feature => feature.id === feature.properties.observationId));
export type ResearchOverlay = z.infer<typeof ResearchOverlaySchema>;
export function parseResearchOverlay(input: unknown): ResearchOverlay {
  return immutable(ResearchOverlaySchema.parse(boundedJSON(input, { bytes: 1048576, depth: 12, nodes: 50000 })));
}
export function researchOverlayFor(bundle: {
  readonly entities: readonly { readonly id: string; readonly coordinates: readonly [number, number] }[];
  readonly observations: readonly { readonly id: string; readonly entityId: string; readonly time: { readonly startYear: number; readonly endYear: number }; readonly provenance: { readonly sourceSha256: string } }[];
}, revision: number): ResearchOverlay {
  const entities = new Map(bundle.entities.map(entity => [entity.id, entity]));
  return parseResearchOverlay({ type: 'FeatureCollection', features: bundle.observations.map(row => {
    const entity = entities.get(row.entityId);
    if (!entity) throw new Error('UNKNOWN_RESEARCH_ENTITY');
    return { type: 'Feature', id: row.id, geometry: { type: 'Point', coordinates: [...entity.coordinates] }, properties: { entityId: row.entityId, observationId: row.id, revision, startYear: row.time.startYear, endYear: row.time.endYear, sourceHash: row.provenance.sourceSha256 } };
  }) });
}
export function visibleResearchFeatures(data: ResearchOverlay, cursorYear: number, selectedId: string | null = null): ResearchOverlay['features'] {
  return data.features.filter(feature => feature.id === selectedId || feature.properties.startYear === null || feature.properties.endYear !== null && matchesCursor(feature.properties.startYear, feature.properties.endYear, cursorYear));
}
export function evidenceOverlayFor(records: readonly import('@chronicle/contracts/evidence').EvidenceRecord[], revision: number): ResearchOverlay {
  return parseResearchOverlay({ type: 'FeatureCollection', features: records.filter(record => record.geometry !== null).map(record => ({ type: 'Feature', id: record.id, geometry: record.geometry, properties: { entityId: record.entityId, observationId: record.id, revision, startYear: record.time?.startYear ?? null, endYear: record.time?.endYear ?? null, sourceHash: record.source.contentHash } })) });
}
