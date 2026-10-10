import type { RangeResponse, Source } from 'pmtiles';
import { sha256 } from '@noble/hashes/sha2.js';

export interface PinnedArchive {
  url: string;
  byte_length: number;
  sha256: string;
  integrity?: { chunk_size: number; sha256: readonly string[] };
}

export interface RangeMeasurements {
  requests: number;
  bytes: number;
  aborted: number;
  outstanding: number;
  peakOutstanding: number;
  cacheHits: number;
  cacheMisses: number;
  sharedReads: number;
  chunkEvictions: number;
}

/** The registry applies its aggregate byte budget without owning decoded tiles. */
export interface RangeCacheObserver {
  touch(source: PinnedRangeSource, index: number, bytes: number): void;
  remove(source: PinnedRangeSource, index: number, bytes: number): void;
  measure?(kind: 'request' | 'bytes' | 'abort' | 'finish' | 'hit' | 'miss' | 'shared', amount?: number): void;
}

type PendingChunk = { controller: AbortController; promise: Promise<Uint8Array>; users: number; settled: boolean };

/**
 * Native PMTiles still owns directory and tile decoding. This bounded transport
 * rejects servers which silently send an entire archive in response to Range.
 * Every aligned 16 or 64 KiB chunk is SHA-256 checked against the manifest before
 * PMTiles sees its bytes. This retains integrity without downloading the world.
 */
export class PinnedRangeSource implements Source {
  readonly archive: PinnedArchive;
  readonly measurements: RangeMeasurements = { requests: 0, bytes: 0, aborted: 0, outstanding: 0, peakOutstanding: 0, cacheHits: 0, cacheMisses: 0, sharedReads: 0, chunkEvictions: 0 };
  private lifetime = new AbortController();
  private etag: string | undefined;
  private chunks = new Map<number, Uint8Array>();
  private pending = new Map<number, PendingChunk>();

  constructor(archive: PinnedArchive, private request: typeof fetch = fetch, private observer?: RangeCacheObserver) {
    if (!Number.isSafeInteger(archive.byte_length) || archive.byte_length <= 0 || !/^[a-f0-9]{64}$/.test(archive.sha256)) {
      throw new Error('A streaming archive requires a pinned digest and exact byte length.');
    }
    const integrity = archive.integrity;
    if (!integrity || ![16_384, 65_536].includes(integrity.chunk_size) || integrity.sha256.length !== Math.ceil(archive.byte_length / integrity.chunk_size) || integrity.sha256.some(digest => !/^[a-f0-9]{64}$/.test(digest))) {
      throw new Error('A streaming archive requires a complete 16 or 64 KiB chunk integrity index.');
    }
    this.archive = Object.freeze({ ...archive, integrity: Object.freeze({ chunk_size: integrity.chunk_size, sha256: Object.freeze([...integrity.sha256]) }) });
  }

  getKey(): string { return this.archive.url; }
  dispose(): void { this.lifetime.abort(); for (const index of this.chunks.keys()) this.evictChunk(index); }
  get cachedChunks(): number { return this.chunks.size; }
  get cachedBytes(): number { return [...this.chunks.values()].reduce((total, chunk) => total + chunk.length, 0); }
  async waitForPendingRanges(): Promise<void> { await Promise.allSettled([...this.pending.values()].map(item => item.promise)); }

  evictChunk(index: number): boolean {
    const chunk = this.chunks.get(index);
    if (!chunk) return false;
    this.chunks.delete(index);
    this.measurements.chunkEvictions++;
    this.observer?.remove(this, index, chunk.length);
    return true;
  }

  async getBytes(offset: number, length: number, signal?: AbortSignal, expectedEtag?: string): Promise<RangeResponse> {
    this.lifetime.signal.throwIfAborted();
    signal?.throwIfAborted();
    if (expectedEtag && this.etag && expectedEtag !== this.etag) throw new Error('PMTiles archive changed during a pinned edition.');
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length <= 0 || offset >= this.archive.byte_length || length > 2_097_152) {
      throw new Error('PMTiles range exceeds the frozen two-megabyte request budget or archive bounds.');
    }
    const end = Math.min(this.archive.byte_length, offset + length);
    const integrity = this.archive.integrity!;
    const result = new Uint8Array(end - offset);
    for (let index = Math.floor(offset / integrity.chunk_size); index <= Math.floor((end - 1) / integrity.chunk_size); index++) {
      signal?.throwIfAborted();
      this.lifetime.signal.throwIfAborted();
      let chunk = this.chunks.get(index);
      if (!chunk) {
        this.measurements.cacheMisses++; this.observer?.measure?.('miss');
        chunk = await this.readChunk(index, signal, expectedEtag);
      } else {
        this.measurements.cacheHits++; this.observer?.measure?.('hit');
      }
      signal?.throwIfAborted();
      this.lifetime.signal.throwIfAborted();
      this.chunks.delete(index);
      this.chunks.set(index, chunk);
      while (this.chunks.size > 8) this.evictChunk(this.chunks.keys().next().value!);
      this.observer?.touch(this, index, chunk.length);
      const chunkStart = index * integrity.chunk_size;
      const first = Math.max(offset, chunkStart), last = Math.min(end, chunkStart + chunk.length);
      result.set(chunk.subarray(first - chunkStart, last - chunkStart), first - offset);
    }
    return { data: result.buffer, etag: this.etag };
  }

  /** One caller's cancellation never cancels another caller's shared range. */
  private readChunk(index: number, signal?: AbortSignal, expectedEtag?: string): Promise<Uint8Array> {
    let pending = this.pending.get(index);
    if (pending?.controller.signal.aborted) { this.pending.delete(index); pending = undefined; }
    if (!pending) {
      const controller = new AbortController(), integrity = this.archive.integrity!;
      const start = index * integrity.chunk_size;
      const created: PendingChunk = { controller, users: 0, settled: false, promise: Promise.resolve(new Uint8Array()) };
      created.promise = this.fetchRange(start, Math.min(integrity.chunk_size, this.archive.byte_length - start), controller.signal, expectedEtag).then(response => {
        const chunk = new Uint8Array(response.data);
        const digest = Array.from(sha256(chunk), byte => byte.toString(16).padStart(2, '0')).join('');
        if (digest !== integrity.sha256[index]) throw new Error('PMTiles chunk failed SHA-256 integrity verification.');
        return chunk;
      }).finally(() => {
        created.settled = true;
        if (this.pending.get(index) === created) this.pending.delete(index);
      });
      this.pending.set(index, created);
      pending = created;
    } else { this.measurements.sharedReads++; this.observer?.measure?.('shared'); }
    const shared = pending;
    shared.users++;
    return new Promise<Uint8Array>((resolve, reject) => {
      let complete = false;
      const finish = (error?: unknown, chunk?: Uint8Array) => {
        if (complete) return;
        complete = true;
        signal?.removeEventListener('abort', abort);
        shared.users--;
        if (!shared.users && !shared.settled) shared.controller.abort();
        if (error) reject(error); else resolve(chunk!);
      };
      const abort = () => finish(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      shared.promise.then(chunk => finish(undefined, chunk), error => finish(error));
    });
  }

  private async fetchRange(offset: number, length: number, signal?: AbortSignal, expectedEtag?: string): Promise<RangeResponse> {
    const end = offset + length - 1;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    this.lifetime.signal.addEventListener('abort', abort, { once: true });
    this.measurements.requests++;
    this.measurements.outstanding++;
    this.measurements.peakOutstanding = Math.max(this.measurements.peakOutstanding, this.measurements.outstanding);
    this.observer?.measure?.('request');
    try {
      const request = this.request;
      const response = await request(this.archive.url, {
        headers: { Range: `bytes=${offset}-${end}` }, signal: controller.signal,
        credentials: 'same-origin', cache: 'no-cache',
      });
      controller.signal.throwIfAborted();
      if (response.status !== 206) throw new Error(`PMTiles requires HTTP 206 range delivery; received ${response.status}.`);
      const expectedRange = `bytes ${offset}-${end}/${this.archive.byte_length}`;
      if (response.headers.get('content-range') !== expectedRange) throw new Error('PMTiles Content-Range does not match the pinned archive.');
      const etag = response.headers.get('etag') ?? undefined;
      const previousEtag = expectedEtag ?? this.etag;
      if (etag && previousEtag && previousEtag !== etag) throw new Error('PMTiles archive changed during a pinned edition.');
      if (etag) this.etag = etag;
      const wanted = end - offset + 1;
      const declared = response.headers.get('content-length');
      if (declared && Number(declared) !== wanted) throw new Error('PMTiles range byte length is inconsistent.');
      if (!response.body) throw new Error('PMTiles range has no response body.');
      const reader = response.body.getReader();
      const data = new Uint8Array(wanted);
      let used = 0;
      try {
        for (;;) {
          const chunk = await reader.read();
          controller.signal.throwIfAborted();
          if (chunk.done) break;
          if (used + chunk.value.length > wanted) throw new Error('PMTiles response exceeds its requested byte range.');
          data.set(chunk.value, used);
          used += chunk.value.length;
        }
      } catch (error) {
        await reader.cancel().catch(() => undefined);
        throw error;
      } finally { reader.releaseLock(); }
      if (used !== wanted) throw new Error('PMTiles range response was truncated.');
      this.measurements.bytes += used;
      this.observer?.measure?.('bytes', used);
      return { data: data.buffer, etag, cacheControl: response.headers.get('cache-control') ?? undefined };
    } catch (error) {
      if (controller.signal.aborted) { this.measurements.aborted++; this.observer?.measure?.('abort'); }
      throw error;
    } finally {
      this.measurements.outstanding--;
      this.observer?.measure?.('finish');
      signal?.removeEventListener('abort', abort);
      this.lifetime.signal.removeEventListener('abort', abort);
    }
  }
}
