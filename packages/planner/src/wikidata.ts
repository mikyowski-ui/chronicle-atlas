import { z } from '@chronicle/contracts/schema';
import { EVIDENCE_LIMITS, makeEvidenceRecord, type EvidenceRecord } from '@chronicle/contracts/evidence';
import type { BoundingBox, TemporalSupport } from '@chronicle/contracts/research';
import { hashText } from '@chronicle/contracts/canonical';
import { decodeOutput } from './provider-transport.ts';
import { EvidenceMemoryCache, boundedSourceOperation, checkSourceRequest, matchesEvidence, type RegisteredEvidenceSource, type SourceRequestOptions } from './evidence-source.ts';

export const WIKIDATA_ENDPOINT = 'https://query.wikidata.org/sparql';
const cell = z.strictObject({ type: z.enum(['uri', 'literal', 'typed-literal', 'bnode']), value: z.string().max(4000), datatype: z.string().max(256).optional(), 'xml:lang': z.string().max(32).optional() });
const binding = z.strictObject({ item: cell, itemLabel: cell.optional(), description: cell.optional(), statement: cell.optional(), property: cell.optional(), longitude: cell.optional(), latitude: cell.optional(), globe: cell.optional(), coordinatePrecision: cell.optional(), time: cell.optional(), precision: cell.optional(), calendar: cell.optional(), reference: cell.optional() });
const responseSchema = z.strictObject({ head: z.strictObject({ vars: z.array(z.string().max(40)).max(20), link: z.array(z.string()).max(0).optional() }), results: z.strictObject({ bindings: z.array(binding).max(100) }) });
type Binding = z.infer<typeof binding>;
export function compileWikidataQuery(query: string, offset: number): string {
  checkSourceRequest(query);
  if (!query.trim() || !Number.isInteger(offset) || offset < 0 || offset > 900 || offset % 100 !== 0) throw new Error('INVALID_SOURCE_QUERY');
  const subjects = /^Q[1-9]\d{0,11}$/.test(query) ? `VALUES ?item { wd:${query} }` : `SERVICE wikibase:mwapi { bd:serviceParam wikibase:endpoint "www.wikidata.org" ; wikibase:api "EntitySearch" ; mwapi:search ${JSON.stringify(query)} ; mwapi:language "en" ; mwapi:limit "20" . ?item wikibase:apiOutputItem mwapi:item . }`;
  return `PREFIX hint: <http://www.bigdata.com/queryHints#>
PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX p: <http://www.wikidata.org/prop/>
PREFIX psv: <http://www.wikidata.org/prop/statement/value/>
PREFIX wikibase: <http://wikiba.se/ontology#>
PREFIX bd: <http://www.bigdata.com/rdf#>
PREFIX mwapi: <https://www.mediawiki.org/ontology#API/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX schema: <http://schema.org/>
PREFIX prov: <http://www.w3.org/ns/prov#>
SELECT DISTINCT ?item ?itemLabel ?description ?statement ?property ?longitude ?latitude ?globe ?coordinatePrecision ?time ?precision ?calendar ?reference WHERE {
  hint:Query hint:optimizer "None" .
  ${/^Q[1-9]\d{0,11}$/.test(query) ? subjects : `{ SELECT DISTINCT ?item WHERE { ${subjects} } LIMIT 20 }`}
  OPTIONAL {
    VALUES (?claimProperty ?valueProperty ?property) { (p:P625 psv:P625 "P625") (p:P571 psv:P571 "P571") }
    ?item ?claimProperty ?statement . ?statement ?valueProperty ?node .
    OPTIONAL { ?node wikibase:geoLongitude ?longitude ; wikibase:geoLatitude ?latitude ; wikibase:geoGlobe ?globe . OPTIONAL { ?node wikibase:geoPrecision ?coordinatePrecision } }
    OPTIONAL { ?node wikibase:timeValue ?time ; wikibase:timePrecision ?precision ; wikibase:timeCalendarModel ?calendar }
    OPTIONAL { ?statement prov:wasDerivedFrom ?reference }
  }
  OPTIONAL { ?item rdfs:label ?itemLabel . FILTER(LANG(?itemLabel) = "en") }
  OPTIONAL { ?item schema:description ?description . FILTER(LANG(?description) = "en") }
} ORDER BY STR(?item) STR(?statement) STR(?reference) LIMIT 100 OFFSET ${offset}`;
}
export function parseWikidataYear(value: string, precision: number, calendar: string): TemporalSupport | null {
  if (!Number.isInteger(precision) || precision < 9 || precision > 11 || calendar !== 'http://www.wikidata.org/entity/Q1985727') return null;
  const match = /^([+-]?\d{4,16})-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]); if (!Number.isSafeInteger(year) || year < -12000 || year > 3000) return null;
  return { startYear: year, endYear: year, precision: 'year', meaning: precision === 9 ? 'Wikidata inception statement; not an operating interval.' : 'Year projection of a more precise Wikidata inception statement; original timestamp retained, not an operating interval.' };
}
async function responseBytes(response: Response, signal: AbortSignal): Promise<Uint8Array> {
  const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (!response.ok || !['application/sparql-results+json', 'application/json'].includes(contentType ?? '') || !response.body) throw new Error('WIKIDATA_UNAVAILABLE');
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > EVIDENCE_LIMITS.responseBytes)) { await response.body.cancel(); throw new Error('SOURCE_BYTE_LIMIT'); }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); }; signal.addEventListener('abort', cancel, { once: true });
  try {
    for (;;) { if (signal.aborted) throw new Error('CANCELLED'); const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > EVIDENCE_LIMITS.responseBytes) throw new Error('SOURCE_BYTE_LIMIT'); chunks.push(value); }
    if (signal.aborted) throw new Error('CANCELLED');
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; } return bytes;
  } finally { signal.removeEventListener('abort', cancel); cancel(); reader.releaseLock(); }
}
function convert(row: Binding, contentHash: string): EvidenceRecord {
  const qid = /^http:\/\/www\.wikidata\.org\/entity\/(Q[1-9]\d{0,11})$/.exec(row.item.value)?.[1];
  if (row.item.type !== 'uri' || !qid) throw new Error('INVALID_WIKIDATA_ENTITY');
  const statement = row.statement?.value, statementEntity = statement?.match(/^http:\/\/www\.wikidata\.org\/entity\/statement\/([Qq][1-9]\d{0,11})-[A-Fa-f0-9-]{16,64}$/)?.[1];
  if (statement && (row.statement?.type !== 'uri' || statementEntity?.toUpperCase() !== qid)) throw new Error('INVALID_WIKIDATA_STATEMENT');
  if (row.reference && !/^http:\/\/www\.wikidata\.org\/reference\/[a-f0-9]{40}$/.test(row.reference.value)) throw new Error('INVALID_WIKIDATA_REFERENCE');
  const property = row.property?.value ?? 'entity-description'; if (!['P625', 'P571', 'entity-description'].includes(property)) throw new Error('INVALID_WIKIDATA_PROPERTY');
  const hasCoordinate = property === 'P625' && row.globe?.value === 'http://www.wikidata.org/entity/Q2' && row.longitude && row.latitude;
  if (hasCoordinate && [row.longitude!.value, row.latitude!.value].some(value => !/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value))) throw new Error('INVALID_WIKIDATA_COORDINATE');
  const longitude = hasCoordinate ? Number(row.longitude!.value) : NaN, latitude = hasCoordinate ? Number(row.latitude!.value) : NaN;
  const geometry = hasCoordinate && Number.isFinite(longitude) && Number.isFinite(latitude) ? { type: 'Point', coordinates: [longitude, latitude] } : null;
  const time = property === 'P571' && row.time && row.precision && row.calendar ? parseWikidataYear(row.time.value, Number(row.precision.value), row.calendar.value) : null;
  const recordId = `${statement ?? qid}:${property}:${row.reference?.value ?? 'no-reference'}`;
  const value = property === 'P571' ? row.time?.value ?? null : property === 'P625' ? hasCoordinate ? `Longitude ${row.longitude!.value}; latitude ${row.latitude!.value}` : 'Coordinate outside the supported Earth model' : row.description?.value ?? null;
  return makeEvidenceRecord({ schemaVersion: 1, id: `wikidata:${qid}:${hashText(recordId).slice(0, 24)}`, entityId: `wikidata:${qid}`, label: row.itemLabel?.value || qid, variable: property, value, unit: property === 'P625' ? 'degrees' : null, geometry, time,
    evidenceType: 'recorded-statement', uncertainty: property === 'P625' ? row.coordinatePrecision ? `Source coordinate precision: ${row.coordinatePrecision.value} degrees; not measurement confidence.` : null : row.precision ? `Source time precision: ${row.precision.value}; calendar: ${row.calendar?.value ?? 'unknown'}.` : null,
    limitations: ['Unreviewed Wikidata response, not historical publication or claim-level support review.', 'Each source statement is separate. Coordinates and inception dates are not combined into an inferred geographic operating interval.', 'Unknown, coarse or unsupported calendar dates remain unfiltered reference data. No dates or locations are inferred.'],
    reviewStatus: 'unreviewed', modelProcessing: false,
    source: { adapterId: 'wikidata', recordId, title: 'Wikidata Query Service response', locator: statement ? `${statement}${row.reference ? ` · ${row.reference.value}` : ' · reference not supplied'}` : `Wikidata ${qid} entity description`, edition: `wdqs-response-sha256:${contentHash}`, contentHash },
  });
}
export class WikidataHistoricalAdapter implements RegisteredEvidenceSource {
  readonly id = 'wikidata'; readonly version = 'wikidata-statements-1'; readonly remote = true;
  private readonly cache = new EvidenceMemoryCache();
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;
  constructor(options: { fetch?: typeof fetch; timeoutMs?: number } = {}) {
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis); this.timeoutMs = options.timeoutMs ?? 10000;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 30000) throw new Error('INVALID_SOURCE_DEADLINE');
  }
  async *streamEntities(query: string, bounds?: BoundingBox, temporalRange?: [number, number], options: SourceRequestOptions = {}): AsyncGenerator<EvidenceRecord> {
    checkSourceRequest(query, bounds, temporalRange, options.signal); if (options.allowRemote !== true) throw new Error('REMOTE_NOT_AUTHORIZED');
    const controller = new AbortController(), abort = () => controller.abort(); options.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, this.timeoutMs); let bytesRead = 0; const seen = new Set<string>();
    try {
      for (let page = 0; page < 10; page++) {
        const url = new URL(WIKIDATA_ENDPOINT); url.searchParams.set('query', compileWikidataQuery(query, page * 100)); url.searchParams.set('format', 'json');
        const bytes = await boundedSourceOperation(async signal => {
          const fetcher = this.fetcher, response = await fetcher(url, { signal, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', headers: { Accept: 'application/sparql-results+json' } });
          return responseBytes(response, signal);
        }, controller.signal, this.timeoutMs);
        bytesRead += bytes.byteLength; if (bytesRead > EVIDENCE_LIMITS.fileBytes) throw new Error('SOURCE_BYTE_LIMIT');
        const data = responseSchema.parse(decodeOutput(bytes, EVIDENCE_LIMITS.responseBytes)), contentHash = hashText(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes));
        const records = data.results.bindings.map(row => convert(row, contentHash));
        for (const record of records) {
          if (controller.signal.aborted) throw new Error('CANCELLED');
          if (seen.has(record.id)) throw new Error('UNSTABLE_SOURCE_PAGE'); seen.add(record.id);
          if (matchesEvidence(record, '', bounds, temporalRange)) yield record;
        }
        if (records.length < 100) return;
      }
      throw new Error('SOURCE_RESULT_LIMIT');
    } catch (error) {
      if (controller.signal.aborted) throw new Error(options.signal?.aborted ? 'CANCELLED' : 'SOURCE_TIMEOUT');
      throw error;
    } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); controller.abort(); }
  }
  async queryEntities(query: string, bounds?: BoundingBox, temporalRange?: [number, number], options: SourceRequestOptions = {}): Promise<EvidenceRecord[]> {
    const records: EvidenceRecord[] = [];
    for await (const record of this.streamEntities(query, bounds, temporalRange, options)) records.push(record);
    return this.cache.admit(records);
  }
  async fetchRecord(id: string, options: SourceRequestOptions = {}): Promise<EvidenceRecord> {
    if (options.signal?.aborted) throw new Error('CANCELLED'); return this.cache.get(id);
  }
  hasPinnedRecord(record: EvidenceRecord): boolean { try { return this.cache.get(record.id, record.recordHash).recordHash === record.recordHash; } catch { return false; } }
  clear(): void { this.cache.clear(); }
}
