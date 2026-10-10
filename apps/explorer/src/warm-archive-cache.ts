import { PMTiles, Protocol, SharedPromiseCache, type Source, type Header } from 'pmtiles';
import { PinnedRangeSource, type PinnedArchive, type RangeCacheObserver } from './streaming-range.ts';

/** Frozen for this slice. Live GPU tile resources are owned separately by GLMap. */
export const WARM_ARCHIVE_BUDGET = Object.freeze({
  compressedBytes: 1_048_576,
  idleArchives: 4,
  chunksPerArchive: 8,
  directoryEntriesPerArchive: 16,
  concurrentPrefetch: 2,
  headerRequestBytes: 16_384,
  maxArchiveBytes: 1_000_000,
});

export interface WarmArchiveRequest { archive: PinnedArchive; edition: string }
type Entry = {
  archive: PinnedArchive; edition: string; source: PinnedRangeSource; pmtiles: PMTiles;
  refs: number; warmers: number; used: number;
};
type Chunk = { source: PinnedRangeSource; index: number; bytes: number };

/** PMTiles 4.5 retains rejected promises; warm residency must allow a later retry. */
class RecoverableDirectoryCache extends SharedPromiseCache {
  override getHeader(source: Source) {
    const result = super.getHeader(source), key = source.getKey(), value = this.cache.get(key);
    return result.catch(error => { if (this.cache.get(key) === value) this.cache.delete(key); throw error; });
  }
  override getDirectory(source: Source, offset: number, length: number, header: Header, signal?: AbortSignal) {
    const result = super.getDirectory(source, offset, length, header, signal);
    // The public cache map uses this key in the pinned PMTiles 4.5.0 implementation.
    const key = `${source.getKey()}|${header.etag || ''}|${offset}|${length}`, value = this.cache.get(key);
    return result.catch(error => {
      if (this.cache.get(key) === value) { this.cache.delete(key); this.pendingFetches.delete(key); }
      throw error;
    });
  }
}

/**
 * Archive residency outlives a MapLibre source group. Only verified compressed
 * chunks and PMTiles' bounded directory cache stay warm; decoded viewport tiles
 * and graphics allocations remain under MapLibre's independent lifecycle.
 */
export class WarmArchiveCache {
  private entries = new Map<string, Entry>();
  private chunks = new Map<PinnedRangeSource, Map<number, Chunk>>();
  private lru = new Set<Chunk>();
  private sequence = 0;
  private bytes = 0;
  private peakBytes = 0;
  private disposed = false;
  private prefetchController: AbortController | null = null;
  private prefetchTail: Promise<void> = Promise.resolve();
  private counters = {
    requests: 0, bytes: 0, aborted: 0, outstanding: 0, peakOutstanding: 0,
    cacheHits: 0, cacheMisses: 0, sharedReads: 0, chunkEvictions: 0,
    archiveEvictions: 0, warmRetains: 0, coldRetains: 0,
    prefetchStarted: 0, prefetchCompleted: 0, prefetchAborted: 0, prefetchFailed: 0,
    activePrefetch: 0, peakPrefetch: 0,
  };

  constructor(private protocol: Protocol, private fetcher: typeof fetch = fetch) {}

  retain(archive: PinnedArchive, edition: string): { source: PinnedRangeSource; pmtiles: PMTiles } {
    const existing = this.entries.get(archive.url);
    const entry = this.getEntry(archive, edition);
    if (existing === entry) this.counters.warmRetains++; else this.counters.coldRetains++;
    entry.refs++; entry.used = ++this.sequence;
    return { source: entry.source, pmtiles: entry.pmtiles };
  }

  release(archive: PinnedArchive, edition: string): void {
    const entry = this.entries.get(archive.url);
    if (!entry) return;
    this.assertIdentity(entry, archive, edition);
    if (entry.refs <= 0) throw new Error('A warm archive cannot be released without a matching retain.');
    entry.refs--; entry.used = ++this.sequence;
    this.trimIdle();
  }

  /**
   * At most previous/next headers are prefetched. A newer navigation direction
   * cancels its predecessor; the next batch waits for actual range settlement,
   * so even a slow abort cannot silently exceed the two-task prefetch budget.
   * Integrity alignment can require 64 KiB to verify a 16 KiB header request.
   */
  prefetchNeighbors(requests: readonly WarmArchiveRequest[]): Promise<void> {
    if (requests.length > WARM_ARCHIVE_BUDGET.concurrentPrefetch) throw new Error('Only the previous and next archive may be prefetched.');
    this.assertLive();
    this.cancelPrefetch();
    const controller = new AbortController();
    this.prefetchController = controller;
    const prior = this.prefetchTail;
    const task = (async () => {
      await prior;
      if (controller.signal.aborted || this.disposed) return;
      const unique = [...new Map(requests.map(request => [`${request.edition}\0${request.archive.url}`, request])).values()];
      await Promise.all(unique.map(async ({ archive, edition }) => {
        let entry: Entry | undefined;
        try {
          controller.signal.throwIfAborted();
          entry = this.getEntry(archive, edition);
          entry.warmers++; entry.used = ++this.sequence;
          this.counters.prefetchStarted++; this.counters.activePrefetch++;
          this.counters.peakPrefetch = Math.max(this.counters.peakPrefetch, this.counters.activePrefetch);
          await entry.source.getBytes(0, Math.min(WARM_ARCHIVE_BUDGET.headerRequestBytes, archive.byte_length), controller.signal);
          this.counters.prefetchCompleted++;
        } catch (error) {
          if (controller.signal.aborted) this.counters.prefetchAborted++;
          else this.counters.prefetchFailed++;
          // Prefetch is speculative. Active source hydration still reports any
          // integrity or transport failure through the normal scene path.
        } finally {
          if (entry) {
            await entry.source.waitForPendingRanges();
            entry.warmers--; entry.used = ++this.sequence;
            this.counters.activePrefetch--;
          }
          this.trimIdle();
        }
      }));
    })();
    this.prefetchTail = task;
    return task;
  }

  cancelPrefetch(): void { this.prefetchController?.abort(); this.prefetchController = null; }

  getDiagnostics() {
    return {
      budget: WARM_ARCHIVE_BUDGET,
      ...this.counters,
      cachedBytes: this.bytes, peakCachedBytes: this.peakBytes,
      archives: this.entries.size,
      activeArchives: [...this.entries.values()].filter(entry => entry.refs > 0).length,
      idleArchives: [...this.entries.values()].filter(entry => !entry.refs && !entry.warmers).length,
      liveReferences: [...this.entries.values()].reduce((total, entry) => total + entry.refs, 0),
      cachedChunks: this.lru.size,
      entries: [...this.entries.values()].map(entry => ({
        url: entry.archive.url, edition: entry.edition, sha256: entry.archive.sha256,
        refs: entry.refs, prefetch: entry.warmers, cachedChunks: entry.source.cachedChunks, cachedBytes: entry.source.cachedBytes,
      })),
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.cancelPrefetch();
    for (const entry of [...this.entries.values()]) this.evict(entry);
  }

  private assertLive(): void { if (this.disposed) throw new Error('The warm archive cache has been disposed.'); }

  private assertIdentity(entry: Entry, archive: PinnedArchive, edition: string): void {
    if (entry.edition !== edition || entry.archive.sha256 !== archive.sha256 || entry.archive.byte_length !== archive.byte_length ||
        JSON.stringify(entry.archive.integrity) !== JSON.stringify(archive.integrity)) {
      throw new Error('A PMTiles URL cannot identify conflicting pinned editions or integrity indexes.');
    }
  }

  private getEntry(archive: PinnedArchive, edition: string): Entry {
    this.assertLive();
    if (!edition.trim()) throw new Error('A warm archive requires its recorded edition.');
    if (archive.byte_length > WARM_ARCHIVE_BUDGET.maxArchiveBytes) throw new Error('A warm archive exceeds the existing one-million-byte product limit.');
    let entry = this.entries.get(archive.url);
    if (entry) {
      try { this.assertIdentity(entry, archive, edition); }
      catch (error) {
        // A different edition never inherits old chunks or directory promises.
        if (entry.refs || entry.warmers) throw error;
        this.evict(entry); entry = undefined;
      }
    }
    if (!entry) {
      const observer: RangeCacheObserver = {
        touch: (source, index, bytes) => this.touch(source, index, bytes),
        remove: (source, index, bytes) => this.remove(source, index, bytes),
        measure: (kind, amount = 0) => {
          if (kind === 'request') {
            this.counters.requests++; this.counters.outstanding++;
            this.counters.peakOutstanding = Math.max(this.counters.peakOutstanding, this.counters.outstanding);
          } else if (kind === 'bytes') this.counters.bytes += amount;
          else if (kind === 'finish') this.counters.outstanding--;
          else if (kind === 'abort') this.counters.aborted++;
          else if (kind === 'hit') this.counters.cacheHits++;
          else if (kind === 'miss') this.counters.cacheMisses++;
          else if (kind === 'shared') this.counters.sharedReads++;
        },
      };
      const source = new PinnedRangeSource(archive, this.fetcher, observer);
      const pmtiles = new PMTiles(source, new RecoverableDirectoryCache(WARM_ARCHIVE_BUDGET.directoryEntriesPerArchive));
      entry = { archive: source.archive, edition, source, pmtiles, refs: 0, warmers: 0, used: ++this.sequence };
      this.entries.set(archive.url, entry);
      this.protocol.add(pmtiles);
    }
    return entry;
  }

  private touch(source: PinnedRangeSource, index: number, bytes: number): void {
    let sourceChunks = this.chunks.get(source);
    if (!sourceChunks) { sourceChunks = new Map(); this.chunks.set(source, sourceChunks); }
    let chunk = sourceChunks.get(index);
    if (chunk) this.lru.delete(chunk);
    else {
      chunk = { source, index, bytes }; sourceChunks.set(index, chunk); this.bytes += bytes;
    }
    this.lru.add(chunk);
    while (this.bytes > WARM_ARCHIVE_BUDGET.compressedBytes) {
      const oldest = this.lru.values().next().value!;
      oldest.source.evictChunk(oldest.index);
    }
    this.peakBytes = Math.max(this.peakBytes, this.bytes);
  }

  private remove(source: PinnedRangeSource, index: number, bytes: number): void {
    const sourceChunks = this.chunks.get(source), chunk = sourceChunks?.get(index);
    if (!chunk) return;
    this.lru.delete(chunk); sourceChunks!.delete(index); this.bytes -= bytes;
    if (!sourceChunks!.size) this.chunks.delete(source);
    this.counters.chunkEvictions++;
  }

  private trimIdle(): void {
    const idle = [...this.entries.values()].filter(entry => !entry.refs && !entry.warmers).sort((a, b) => a.used - b.used);
    while (idle.length > WARM_ARCHIVE_BUDGET.idleArchives) this.evict(idle.shift()!);
  }

  private evict(entry: Entry): void {
    entry.source.dispose();
    this.entries.delete(entry.archive.url);
    if (this.protocol.tiles.get(entry.archive.url) === entry.pmtiles) this.protocol.tiles.delete(entry.archive.url);
    this.counters.archiveEvictions++;
  }
}
