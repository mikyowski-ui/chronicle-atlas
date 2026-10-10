export interface MotionPreferenceSource {
  current(): boolean;
  subscribe(listener: (reduced: boolean) => void): () => void;
}

function browserPreference(): MotionPreferenceSource {
  const query = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  return {
    current: () => query?.matches ?? false,
    subscribe(listener) {
      if (!query) return () => undefined;
      const changed = (event: MediaQueryListEvent) => listener(event.matches);
      query.addEventListener('change', changed);
      return () => query.removeEventListener('change', changed);
    },
  };
}

/** One owned media-query listener; changes affect already mounted renderers. */
export class ReducedMotionPreference {
  private value: boolean;
  private disposed = false;
  private readonly listeners = new Set<(reduced: boolean) => void>();
  private readonly unsubscribe: () => void;

  constructor(source: MotionPreferenceSource = browserPreference()) {
    this.value = source.current();
    this.unsubscribe = source.subscribe(reduced => {
      if (this.disposed || reduced === this.value) return;
      this.value = reduced;
      for (const listener of this.listeners) listener(reduced);
    });
  }

  get reduced(): boolean { return this.value; }
  duration(milliseconds: number): number {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new RangeError('Animation duration must be finite and nonnegative.');
    return this.value ? 0 : milliseconds;
  }
  subscribe(listener: (reduced: boolean) => void): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    this.listeners.clear();
  }
}
