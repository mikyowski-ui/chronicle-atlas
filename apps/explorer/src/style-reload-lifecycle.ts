export interface StyleReloadEvents {
  subscribe(listener: () => void): () => void;
}

interface PendingReload {
  resolve(): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

/** Owns exactly one style-load listener, independent of sources and tile events.
 * Restoration is trusted, synchronous and idempotent. The result establishes
 * restored bindings, not tile hydration or physical presentation.
 */
export class StyleReloadLifecycle {
  private disposed = false;
  private pending: PendingReload | null = null;
  private events = 0;
  private restored = 0;
  private failures = 0;
  private readonly unsubscribe: () => void;

  constructor(events: StyleReloadEvents, private readonly restore: () => void, private readonly failed: (error: Error) => void) {
    this.unsubscribe = events.subscribe(() => {
      if (this.disposed) return;
      this.events++;
      try {
        this.restore();
        this.restored++;
        this.settle();
      } catch (cause) {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        this.failures++;
        this.settle(error);
        this.failed(error);
      }
    });
  }

  request(replace: () => void, timeoutMilliseconds = 30_000): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Map style lifecycle has been disposed.'));
    if (!Number.isFinite(timeoutMilliseconds) || timeoutMilliseconds <= 0) return Promise.reject(new RangeError('Style reload timeout must be positive.'));
    this.settle(new DOMException('A newer basemap style superseded this request.', 'AbortError'));
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const error = new Error('Basemap style did not load before the bounded timeout.');
        this.failures++;
        this.settle(error);
        this.failed(error);
      }, timeoutMilliseconds);
      this.pending = { resolve, reject, timer };
      try { replace(); }
      catch (cause) {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        this.failures++;
        this.settle(error);
        this.failed(error);
      }
    });
  }

  private settle(error?: Error): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    clearTimeout(pending.timer);
    if (error) pending.reject(error); else pending.resolve();
  }

  get diagnostics(): { listeners: number; events: number; restorations: number; failures: number; pending: boolean } {
    return { listeners: this.disposed ? 0 : 1, events: this.events, restorations: this.restored, failures: this.failures, pending: this.pending !== null };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    this.settle(new DOMException('Map style lifecycle disposed.', 'AbortError'));
  }
}
