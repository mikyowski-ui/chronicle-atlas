export type HostWorkStage = 'cursor' | 'teaching' | 'card' | 'commit' | 'research-cursor' | 'detail-time' | 'ruler-update' | 'presentation';

/** Bounded CPU timings for actual host work; nested stages must not be summed. */
export class HostWorkProfile {
  private readonly stages = new Map<HostWorkStage, { calls: number; totalMs: number; samples: number[] }>();
  measure<T>(stage: HostWorkStage, work: () => T): T {
    const started = performance.now();
    try { return work(); }
    finally {
      const elapsed = performance.now() - started;
      const entry = this.stages.get(stage) ?? { calls: 0, totalMs: 0, samples: [] };
      entry.calls++; entry.totalMs += elapsed; entry.samples.push(elapsed);
      if (entry.samples.length > 200) entry.samples.shift();
      this.stages.set(stage, entry);
    }
  }
  snapshot() {
    return [...this.stages].map(([stage, entry]) => {
      const sorted = [...entry.samples].sort((a, b) => a - b);
      return { stage, calls: entry.calls, totalMs: entry.totalMs, retained: sorted.length,
        p95Ms: sorted[Math.max(0, Math.ceil(sorted.length * .95) - 1)] ?? 0,
        maximumMs: sorted.at(-1) ?? 0 };
    });
  }
}
