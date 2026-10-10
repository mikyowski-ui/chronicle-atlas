import { z } from '@chronicle/contracts/schema';
import { EVIDENCE_LIMITS, EvidenceGeometrySchema, makeEvidenceRecord, type EvidenceRecord } from '@chronicle/contracts/evidence';
import type { BoundingBox } from '@chronicle/contracts/research';
import { hashText } from '@chronicle/contracts/canonical';
import { decodeOutput } from './provider-transport.ts';
import { EvidenceMemoryCache, checkSourceRequest, matchesEvidence, type RegisteredEvidenceSource, type SourceRequestOptions } from './evidence-source.ts';

const columns = ['id', 'label', 'variable', 'value', 'unit', 'longitude', 'latitude', 'startYear', 'endYear', 'source', 'edition', 'locator', 'uncertainty', 'evidenceType'] as const;
const fields = z.strictObject(Object.fromEntries(columns.map(key => [key, z.union([z.string().max(4000), z.number().finite(), z.null()]).optional()])));
type Row = Record<string, string | number | null | undefined>;
function readCSV(text: string): Row[] {
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false, ended = false;
  const addCell = () => { if (cell.length > 4000 || row.length >= columns.length) throw new Error('CSV_CELL_LIMIT'); row.push(cell); cell = ''; ended = false; };
  const addRow = () => { addCell(); if (row.some(value => value.length)) rows.push(row); row = []; if (rows.length > EVIDENCE_LIMITS.records + 1) throw new Error('CSV_ROW_LIMIT'); };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) { if (char === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; ended = true; } } else cell += char; }
    else if (char === ',') addCell();
    else if (char === '\n' || char === '\r') { if (char === '\r' && text[i + 1] === '\n') i++; addRow(); }
    else if (char === '"' && !cell && !ended) quoted = true;
    else { if (ended || char === '"') throw new Error('INVALID_CSV_QUOTE'); cell += char; }
    if (cell.length > 4000) throw new Error('CSV_CELL_LIMIT');
  }
  if (quoted) throw new Error('UNTERMINATED_CSV'); if (cell || row.length || ended) addRow();
  const header = rows.shift();
  if (!header || !header.includes('id') || !header.includes('label') || new Set(header).size !== header.length || header.some(key => !columns.includes(key as typeof columns[number]))) throw new Error('INVALID_CSV_COLUMNS');
  return rows.map(values => { if (values.length !== header.length) throw new Error('INVALID_CSV_ROW'); return Object.fromEntries(header.map((key, index) => [key, values[index]])); });
}
const present = (value: Row[string]): boolean => value !== undefined && value !== null && value !== '';
function numeric(value: Row[string]): number {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string' || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)) throw new Error('INVALID_NUMBER');
  const result = Number(value); if (!Number.isFinite(result)) throw new Error('INVALID_NUMBER'); return result;
}
function isoYear(value: unknown): number | null {
  if (value === undefined) return null;
  if (typeof value !== 'string' || !/^-?\d{1,5}$/.test(value)) throw new Error('JSONLD_YEAR_PRECISION_REQUIRED');
  return numeric(value.replace(/^(-?)0+(?=\d)/, '$1'));
}
export interface EvidenceFile { readonly name: string; readonly size: number; arrayBuffer(): Promise<ArrayBuffer> }
export class FileDropAdapter implements RegisteredEvidenceSource {
  readonly id = 'local-files'; readonly version = 'file-drop-1'; readonly remote = false;
  private readonly cache = new EvidenceMemoryCache();
  async ingestFile(file: EvidenceFile, options: SourceRequestOptions = {}): Promise<EvidenceRecord[]> {
    if (options.signal?.aborted) throw new Error('CANCELLED');
    if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > EVIDENCE_LIMITS.fileBytes) throw new Error('FILE_SIZE_LIMIT');
    const bytes = await file.arrayBuffer(); if (options.signal?.aborted) throw new Error('CANCELLED');
    if (bytes.byteLength !== file.size) throw new Error('FILE_SIZE_MISMATCH');
    return this.ingest(file.name, new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes));
  }
  ingest(name: string, raw: string): EvidenceRecord[] {
    if (typeof name !== 'string' || name.length > 255 || /[\/\\\u0000]/.test(name)) throw new Error('INVALID_FILE_NAME');
    if (typeof raw !== 'string' || raw.length > EVIDENCE_LIMITS.fileBytes || new TextEncoder().encode(raw).byteLength > EVIDENCE_LIMITS.fileBytes) throw new Error('FILE_SIZE_LIMIT');
    const contentHash = hashText(raw), text = raw.replace(/^\uFEFF/, ''), extension = name.toLowerCase().split('.').at(-1);
    let entries: { row: Row; geometry?: unknown }[];
    if (extension === 'csv') entries = readCSV(text).map(row => ({ row }));
    else if (['json', 'geojson', 'jsonld'].includes(extension ?? '')) {
      const value = decodeOutput(new TextEncoder().encode(text), EVIDENCE_LIMITS.fileBytes) as Record<string, unknown>;
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_ARCHIVE');
      if (value.type === 'FeatureCollection') {
        const archive = z.strictObject({ type: z.literal('FeatureCollection'), features: z.array(z.strictObject({ type: z.literal('Feature'), id: z.union([z.string().max(4000), z.number().finite()]).optional(), geometry: EvidenceGeometrySchema.nullable(), properties: fields })).min(1).max(EVIDENCE_LIMITS.records) }).parse(value);
        entries = archive.features.map(feature => ({ row: { ...feature.properties, id: feature.id ?? feature.properties.id }, geometry: feature.geometry }));
      } else entries = this.readJSONLD(value);
    } else throw new Error('UNSUPPORTED_FILE_FORMAT');
    if (!entries.length || entries.length > EVIDENCE_LIMITS.records) throw new Error('EVIDENCE_RECORD_LIMIT');
    const ids = new Set<string>();
    const records = entries.map(({ row: input, geometry: supplied }, index) => {
      const row = fields.parse(input) as Row, key = String(row.id ?? '');
      if (!key || ['__proto__', 'constructor', 'prototype'].includes(key) || ids.has(key) || !present(row.label)) throw new Error('INVALID_RECORD_ID'); ids.add(key);
      const hasX = present(row.longitude), hasY = present(row.latitude), hasStart = present(row.startYear), hasEnd = present(row.endYear);
      if (hasX !== hasY || !hasStart && hasEnd) throw new Error('INCOMPLETE_SUPPORT');
      const geometry = supplied !== undefined ? supplied : hasX ? { type: 'Point', coordinates: [numeric(row.longitude), numeric(row.latitude)] } : null;
      if (supplied !== undefined && (hasX || hasY)) throw new Error('AMBIGUOUS_GEOMETRY');
      const startYear = hasStart ? numeric(row.startYear) : null, endYear = hasEnd ? numeric(row.endYear) : startYear;
      const time = startYear === null ? null : { startYear, endYear, precision: startYear === endYear ? 'year' : 'range', meaning: 'Explicit file temporal support; semantics require source review.' };
      let value: string | number | null = present(row.value) ? row.value! : null;
      if (typeof value === 'string' && /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)) value = numeric(value);
      if (value !== null && !present(row.variable)) throw new Error('MISSING_VARIABLE_DEFINITION');
      const id = `local:${contentHash.slice(0, 24)}:${hashText(key).slice(0, 24)}`;
      return makeEvidenceRecord({ schemaVersion: 1, id, entityId: id, label: String(row.label), variable: String(row.variable || 'Unspecified variable'), value, unit: present(row.unit) ? String(row.unit) : null, geometry, time,
        evidenceType: row.evidenceType || 'unknown', uncertainty: present(row.uncertainty) ? String(row.uncertainty) : null,
        limitations: ['Browser-local unreviewed import, not published history. Source claims and processing rights have not been verified.', 'Unknown support remains unknown; no geocoding, dates, arithmetic or causal links are inferred.'], reviewStatus: 'unreviewed', modelProcessing: false,
        source: { adapterId: this.id, recordId: key, title: String(row.source || 'User-supplied archive; source not specified'), locator: String(row.locator || `record ${index + 1}: ${key}`), edition: String(row.edition || `file-sha256:${contentHash}`), contentHash },
      });
    });
    return this.cache.admit(records);
  }
  private readJSONLD(value: Record<string, unknown>): { row: Row; geometry?: unknown }[] {
    const context = value['@context'];
    if (!['https://schema.org', 'https://schema.org/', 'http://schema.org', 'http://schema.org/'].includes(String(context))) throw new Error('UNSUPPORTED_JSONLD_CONTEXT');
    const archive = z.strictObject({ '@context': z.string(), '@graph': z.array(z.strictObject({
      '@id': z.string().min(1).max(4000), '@type': z.enum(['Thing', 'Place', 'Event', 'Dataset']), name: z.string().min(1).max(4000), description: z.string().max(4000).optional(),
      startDate: z.string().optional(), endDate: z.string().optional(), citation: z.string().max(4000).optional(), version: z.string().max(4000).optional(),
      geo: z.strictObject({ '@type': z.literal('GeoCoordinates'), longitude: z.number().finite(), latitude: z.number().finite() }).optional(),
    })).min(1).max(EVIDENCE_LIMITS.records) }).parse(value);
    return archive['@graph'].map(item => ({ row: { id: item['@id'], label: item.name, variable: 'description', value: item.description ?? null, startYear: isoYear(item.startDate), endYear: isoYear(item.endDate), source: item.citation ?? null, edition: item.version ?? null, longitude: item.geo?.longitude ?? null, latitude: item.geo?.latitude ?? null } }));
  }
  async queryEntities(query: string, bounds?: BoundingBox, temporalRange?: [number, number], options: SourceRequestOptions = {}): Promise<EvidenceRecord[]> {
    checkSourceRequest(query, bounds, temporalRange, options.signal); return this.cache.values().filter(record => matchesEvidence(record, query, bounds, temporalRange));
  }
  async fetchRecord(id: string, options: SourceRequestOptions = {}): Promise<EvidenceRecord> { if (options.signal?.aborted) throw new Error('CANCELLED'); return this.cache.get(id); }
  clear(): void { this.cache.clear(); }
}
