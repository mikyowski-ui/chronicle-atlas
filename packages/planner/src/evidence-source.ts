import { EVIDENCE_LIMITS, parseEvidenceRecord, type EvidenceRecord, type EvidenceSourceAdapter } from '@chronicle/contracts/evidence';
import { BoundingBoxSchema, EpochSchema, type BoundingBox } from '@chronicle/contracts/research';
import { canonicalJSON } from '@chronicle/contracts/canonical';

export interface SourceRequestOptions { readonly signal?: AbortSignal; readonly allowRemote?: boolean }
export interface RegisteredEvidenceSource extends EvidenceSourceAdapter {
  readonly remote: boolean;
  queryEntities(query: string, bounds?: BoundingBox, temporalRange?: [number, number], options?: SourceRequestOptions): Promise<EvidenceRecord[]>;
  fetchRecord(id: string, options?: SourceRequestOptions): Promise<EvidenceRecord>;
  clear(): void;
}
export function checkSourceRequest(query: string, bounds?: BoundingBox, temporalRange?: [number, number], signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('CANCELLED');
  if (typeof query !== 'string' || query.length > 500 || /[\u0000-\u001f]/.test(query)) throw new Error('INVALID_SOURCE_QUERY');
  if (bounds) BoundingBoxSchema.parse(bounds);
  if (temporalRange) EpochSchema.parse(temporalRange);
}
export function matchesEvidence(record: EvidenceRecord, query: string, bounds?: BoundingBox, temporalRange?: [number, number]): boolean {
  const terms = query.normalize('NFKC').trim().toLowerCase().split(/\s+/).filter(Boolean), haystack = `${record.label} ${record.variable} ${record.value ?? ''}`.normalize('NFKC').toLowerCase();
  if (terms.some(term => !haystack.includes(term))) return false;
  if (temporalRange && (!record.time || record.time.endYear < temporalRange[0] || record.time.startYear > temporalRange[1])) return false;
  if (bounds) {
    if (!record.geometry) return false;
    const points = record.geometry.type === 'Point' ? [record.geometry.coordinates] : record.geometry.coordinates.flat();
    const xs = points.map(point => point[0]), ys = points.map(point => point[1]);
    if (Math.max(...xs) < bounds[0] || Math.min(...xs) > bounds[2] || Math.max(...ys) < bounds[1] || Math.min(...ys) > bounds[3]) return false;
  }
  return true;
}
export class EvidenceMemoryCache {
  private records = new Map<string, EvidenceRecord>();
  admit(input: readonly EvidenceRecord[]): EvidenceRecord[] {
    if (input.length > EVIDENCE_LIMITS.records) throw new Error('EVIDENCE_BUDGET_EXCEEDED');
    const records = input.map(parseEvidenceRecord);
    if (new Set(records.map(record => record.id)).size !== records.length) throw new Error('DUPLICATE_EVIDENCE_ID');
    const next = new Map(this.records);
    for (const record of records) next.set(`${record.id}:${record.recordHash}`, record);
    if (next.size > EVIDENCE_LIMITS.records || new TextEncoder().encode(canonicalJSON([...next.values()])).byteLength > EVIDENCE_LIMITS.cacheBytes) throw new Error('EVIDENCE_CACHE_FULL');
    this.records = next; return records;
  }
  get(id: string, hash?: string): EvidenceRecord {
    const record = hash ? this.records.get(`${id}:${hash}`) : [...this.records.values()].reverse().find(record => record.id === id);
    if (!record) throw new Error('EVIDENCE_NOT_CACHED'); return record;
  }
  values(): EvidenceRecord[] { return [...this.records.values()]; }
  clear(): void { this.records.clear(); }
}
export async function boundedSourceOperation<T>(operation: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal, timeoutMs = 10000): Promise<T> {
  if (signal?.aborted) throw new Error('CANCELLED');
  const controller = new AbortController(); let timedOut = false;
  const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
  let rejectAbort: () => void = () => {};
  const cancelled = new Promise<never>((_, reject) => { rejectAbort = () => reject(new Error(timedOut ? 'SOURCE_TIMEOUT' : 'CANCELLED')); controller.signal.addEventListener('abort', rejectAbort, { once: true }); });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try { const result = await Promise.race([operation(controller.signal), cancelled]); if (controller.signal.aborted) throw new Error('CANCELLED'); return result; }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); controller.signal.removeEventListener('abort', rejectAbort); controller.abort(); }
}
