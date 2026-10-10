import type { HistoricalDay } from '@chronicle/contracts/chronology';

export type MotionMode = 'chronological' | 'observation-tour';
export type MotionSeekOutcome =
  | { status: 'committed'; scene?: { time: HistoricalDay } }
  | { status: 'stale' }
  | { status: 'error'; error: Error };

export interface MotionSnapshot {
  /** May be fractional. Presentation never changes the committed scene's date. */
  readonly cursorTime: number;
  readonly requestedTime: HistoricalDay;
  readonly committedTime: HistoricalDay | null;
  readonly isPlaying: boolean;
  readonly pending: boolean;
  readonly mode: MotionMode;
  readonly daysPerSecond: number;
  readonly tourIntervalMs: number;
  readonly error: Error | null;
  readonly deliveredRequests: number;
  readonly coalescedRequests: number;
  readonly supersededRequests: number;
  readonly presentationAdvances: number;
}

export interface TimeMotionOptions {
  initialTime: HistoricalDay;
  minTime: HistoricalDay;
  maxTime: HistoricalDay;
  /** Include observation ends as well as starts so gaps are real scene changes. */
  changeTimes: readonly HistoricalDay[];
  observationTimes?: readonly HistoricalDay[];
  initialCommittedTime?: HistoricalDay | null;
  daysPerSecond?: number;
  tourIntervalMs?: number;
  deliver(time: HistoricalDay): Promise<MotionSeekOutcome>;
  /** Abort/invalidate an older renderer generation immediately, before the next frame. */
  invalidatePending?(): void;
  onChange?(snapshot: MotionSnapshot): void;
  /** Synchronous presentation-only acceptance for an already committed semantic scene. */
  tryAdvance?(time: HistoricalDay): boolean;
}

interface Intent {
  id: number;
  time: HistoricalDay;
  force: boolean;
  waitedAcrossFrame: boolean;
  promise: Promise<MotionSeekOutcome>;
  resolve(outcome: MotionSeekOutcome): void;
}

function integerDay(value: number): void {
  if (!Number.isSafeInteger(value)) throw new Error('Canonical historical time must be an integer day.');
}
function positive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be positive and finite.`);
}

/** Continuous input and clock, independent of asynchronous scene delivery.
 *
 * A caller supplies animation timestamps through tick(). Free input replaces queued
 * work immediately, but dispatches at most once per frame. Chronological playback
 * stops at every explicit change and waits for delivery before advancing again;
 * wall time spent waiting is discarded, rather than skipping historical changes.
 */
export class TimeMotion {
  private cursor: number;
  private requested: HistoricalDay;
  private committed: HistoricalDay | null;
  private playing = false;
  private mode: MotionMode = 'chronological';
  private rate: number;
  private tourInterval: number;
  private tourElapsed = 0;
  private lastTimestamp: number | null = null;
  private suspended = false;
  private disposed = false;
  private queued: Intent | null = null;
  private inFlight: Intent | null = null;
  private serial = 0;
  private error: Error | null = null;
  private delivered = 0;
  private coalesced = 0;
  private superseded = 0;
  private advances = 0;
  private readonly changes: readonly HistoricalDay[];
  private observations: readonly HistoricalDay[];

  constructor(private readonly options: TimeMotionOptions) {
    [options.initialTime, options.minTime, options.maxTime].forEach(integerDay);
    if (options.minTime > options.maxTime || options.initialTime < options.minTime || options.initialTime > options.maxTime) {
      throw new Error('Initial time must lie inside the inclusive motion bounds.');
    }
    this.cursor = this.requested = options.initialTime;
    this.committed = options.initialCommittedTime ?? null;
    if (this.committed !== null) {
      integerDay(this.committed);
      if (this.committed < options.minTime || this.committed > options.maxTime) throw new Error('Committed time lies outside motion bounds.');
    }
    this.rate = options.daysPerSecond ?? 365.2425;
    this.tourInterval = options.tourIntervalMs ?? 1_000;
    positive(this.rate, 'Playback rate');
    positive(this.tourInterval, 'Observation tour interval');
    const ordered = (values: readonly HistoricalDay[]) => {
      values.forEach(integerDay);
      return Object.freeze([...new Set(values)].filter(t => t >= options.minTime && t <= options.maxTime).sort((a, b) => a - b));
    };
    this.changes = ordered(options.changeTimes);
    this.observations = ordered(options.observationTimes ?? options.changeTimes);
  }

  get snapshot(): MotionSnapshot {
    return Object.freeze({ cursorTime: this.cursor, requestedTime: this.requested, committedTime: this.committed,
      isPlaying: this.playing, pending: this.queued !== null || this.inFlight !== null, mode: this.mode,
      daysPerSecond: this.rate, tourIntervalMs: this.tourInterval, error: this.error,
      deliveredRequests: this.delivered, coalescedRequests: this.coalesced, supersededRequests: this.superseded, presentationAdvances: this.advances });
  }

  /** Route-specific tour markers; the continuous clock and pending intent stay intact. */
  setObservationTimes(values: readonly HistoricalDay[]): void {
    values.forEach(integerDay);
    this.observations = Object.freeze([...new Set(values)].filter(t => t >= this.options.minTime && t <= this.options.maxTime).sort((a,b)=>a-b));
    this.tourElapsed = 0;
  }

  /** Exact canonical API: no year conversion, observation snapping, or interpolation. */
  seekTime(time: HistoricalDay, options: { force?: boolean } = {}): Promise<MotionSeekOutcome> {
    integerDay(time);
    if (time < this.options.minTime || time > this.options.maxTime) throw new Error('Requested time lies outside motion bounds.');
    return this.request(time, time, options.force);
  }

  /** Pointer/slider presentation may be fractional; canonical days always floor, including BCE. */
  scrub(cursorTime: number): Promise<MotionSeekOutcome> {
    if (!Number.isFinite(cursorTime)) throw new Error('Presentation cursor must be finite.');
    const cursor = Math.max(this.options.minTime, Math.min(this.options.maxTime, cursorTime));
    return this.request(Math.floor(cursor), cursor);
  }

  private request(time: HistoricalDay, cursor: number, force = false): Promise<MotionSeekOutcome> {
    if (this.disposed) return Promise.resolve({ status: 'stale' });
    this.cursor = cursor;
    this.requested = time;
    this.error = null;
    const existing = this.queued ?? this.inFlight;
    if (!force && existing?.time === time) {
      this.emit();
      return existing.promise;
    }
    this.serial++;
    if (this.queued) {
      this.coalesced++;
      this.queued.resolve({ status: 'stale' });
      this.queued = null;
    }
    if (this.inFlight) {
      this.superseded++;
      this.inFlight.resolve({ status: 'stale' });
      this.inFlight = null;
      this.options.invalidatePending?.();
    }
    if (!force && this.committed === time) {
      this.emit();
      return Promise.resolve({ status: 'committed', scene: { time } });
    }
    let resolve!: (outcome: MotionSeekOutcome) => void;
    const promise = new Promise<MotionSeekOutcome>(done => { resolve = done; });
    this.queued = { id: this.serial, time, force, waitedAcrossFrame: false, promise, resolve };
    this.emit();
    return promise;
  }

  setPlaying(playing: boolean): void {
    if (this.disposed || this.playing === playing) return;
    this.playing = playing;
    this.lastTimestamp = null;
    this.tourElapsed = 0;
    this.emit();
  }

  setMode(mode: MotionMode): void {
    if (mode !== 'chronological' && mode !== 'observation-tour') throw new Error('Unknown playback mode.');
    this.mode = mode;
    this.lastTimestamp = null;
    this.tourElapsed = 0;
    this.emit();
  }

  setRate(daysPerSecond: number): void {
    positive(daysPerSecond, 'Playback rate');
    this.rate = daysPerSecond;
    this.lastTimestamp = null;
    this.emit();
  }

  setTourInterval(intervalMs: number): void {
    positive(intervalMs, 'Observation tour interval');
    this.tourInterval = intervalMs;
    this.tourElapsed = 0;
    this.emit();
  }

  /** Call on visibility loss; resume deliberately establishes a fresh timestamp origin. */
  suspend(): void { this.suspended = true; this.lastTimestamp = null; }
  resume(): void { this.suspended = false; this.lastTimestamp = null; }

  tick(timestamp: number): void {
    if (!Number.isFinite(timestamp) || timestamp < 0) throw new Error('Animation timestamp must be finite and nonnegative.');
    if (this.disposed || this.suspended) return;
    const delta = this.lastTimestamp === null ? 0 : Math.max(0, timestamp - this.lastTimestamp);
    this.lastTimestamp = timestamp;
    if (this.queued) { this.dispatch(); return; }
    if (this.inFlight) { this.inFlight.waitedAcrossFrame = true; return; }
    if (!this.playing) return;
    // Resuming after a failed/stale boundary must commit that exact cursor first.
    // Advancing from it would otherwise silently skip a required change.
    if (this.committed !== this.requested) {
      void this.request(this.requested, this.cursor);
      this.dispatch();
      return;
    }
    if (this.cursor >= this.options.maxTime) { this.setPlaying(false); return; }
    if (this.mode === 'observation-tour') {
      this.tourElapsed += delta;
      if (this.tourElapsed < this.tourInterval) return;
      const next = this.observations.find(time => time > this.cursor);
      if (next === undefined) { this.setPlaying(false); return; }
      this.tourElapsed = 0;
      void this.seekTime(next);
      this.dispatch();
      return;
    }
    const nextChange = this.changes.find(time => time > this.cursor) ?? this.options.maxTime;
    const cursor = Math.min(this.options.maxTime, nextChange, this.cursor + delta * this.rate / 1_000);
    if (cursor === this.cursor) return;
    void this.request(Math.floor(cursor), cursor);
    this.dispatch();
  }

  private dispatch(): void {
    const intent = this.queued;
    if (!intent) return;
    this.queued = null;
    this.inFlight = intent;
    try {
      if (!intent.force && this.options.tryAdvance?.(intent.time)) {
        // The callback may synchronously invalidate this intent through UI work.
        if (this.disposed || this.inFlight !== intent || intent.id !== this.serial) return;
        this.inFlight = null;
        this.committed = intent.time; this.advances++;
        intent.resolve({ status: 'committed', scene: { time: intent.time } });
        this.emit(); return;
      }
    } catch (cause) {
      this.finish(intent, { status: 'error', error: cause instanceof Error ? cause : new Error(String(cause)) });
      return;
    }
    if (this.disposed || this.inFlight !== intent || intent.id !== this.serial) return;
    this.delivered++;
    let delivery: Promise<MotionSeekOutcome>;
    try { delivery = this.options.deliver(intent.time); }
    catch (cause) { delivery = Promise.resolve({ status: 'error', error: cause instanceof Error ? cause : new Error(String(cause)) }); }
    void delivery.then(outcome => this.finish(intent, outcome), cause => this.finish(intent,
      { status: 'error', error: cause instanceof Error ? cause : new Error(String(cause)) }));
  }

  private finish(intent: Intent, result: MotionSeekOutcome): void {
    if (this.disposed || this.inFlight !== intent || intent.id !== this.serial) return;
    this.inFlight = null;
    let outcome = result;
    if (outcome.status === 'committed' && outcome.scene && outcome.scene.time !== intent.time) {
      outcome = { status: 'error', error: new Error('Delivery committed a different historical time.') };
    }
    if (outcome.status === 'committed') this.committed = intent.time;
    else {
      this.playing = false;
      if (outcome.status === 'error') this.error = outcome.error;
    }
    // A slow fetch cannot accumulate wall time for a later jump. Immediate cached
    // delivery keeps the preceding frame origin, preserving the declared rate at
    // both 30 and 60 Hz instead of dropping every other animation interval.
    if (intent.waitedAcrossFrame) this.lastTimestamp = null;
    intent.resolve(outcome);
    this.emit();
  }

  private emit(): void { this.options.onChange?.(this.snapshot); }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.playing = false;
    this.serial++;
    this.queued?.resolve({ status: 'stale' });
    this.inFlight?.resolve({ status: 'stale' });
    if (this.inFlight) this.options.invalidatePending?.();
    this.queued = this.inFlight = null;
    this.lastTimestamp = null;
  }
}
