/** Readiness belongs to a request AND to the viewport whose tiles were loaded. */
export interface StageToken {
  readonly serial: number;
  readonly generation: number;
  cameraRevision: number;
  readyFrames: number;
  /** Consecutive hydrated frames for the same required viewport tile set. */
  coverageKey: string | null;
  coveredFrames: number;
}

/**
 * The renderer owns one committed source group and at most one staging group.
 * This coordinator deliberately knows nothing about WebGL: tests establish the
 * lifecycle invariant, while actual GPU hydration remains a browser profile.
 */
export class StreamingLifecycle {
  private serial = 0;
  private revision = 0;
  private pending: StageToken | null = null;
  private latestGeneration = -1;
  private committedGeneration = -1;

  begin(generation: number): StageToken {
    if (generation < this.latestGeneration) throw new DOMException('Superseded scene generation.', 'AbortError');
    this.latestGeneration = generation;
    this.pending = { serial: ++this.serial, generation, cameraRevision: this.revision, readyFrames: 0, coverageKey: null, coveredFrames: 0 };
    return this.pending;
  }

  moveCamera(): void {
    this.revision++;
    if (this.pending) {
      this.pending.cameraRevision = this.revision;
      this.pending.readyFrames = 0;
      // Preserve only tile-coverage history. Another completed render must
      // confirm hydration of the current viewport before ready()/commit().
    }
  }

  current(token: StageToken): boolean {
    return this.pending === token && token.generation === this.latestGeneration;
  }

  /** Two completed frames after hydration ensure style/worker updates ran. */
  frame(token: StageToken, hydrated: boolean): boolean {
    if (!this.current(token)) return false;
    token.coverageKey = null;
    token.coveredFrames = 0;
    token.readyFrames = hydrated && token.cameraRevision === this.revision ? token.readyFrames + 1 : 0;
    return token.readyFrames >= 2;
  }

  /**
   * Continuous camera movement may reuse an unchanged hydrated tile set.
   * The renderer supplies a key covering the required viewport tiles/zoom for
   * this completed render, not merely an archive or scene ID. Movement alone
   * does not discard coverage history; a different set or missing hydration
   * does. A camera move after this call still invalidates immediate commit.
   */
  coveredFrame(token: StageToken, hydrated: boolean, coverageKey: string): boolean {
    if (!this.current(token)) return false;
    const sameCoverage = token.coverageKey === coverageKey;
    token.coverageKey = coverageKey;
    token.coveredFrames = hydrated && coverageKey.length > 0
      ? Math.min(2, sameCoverage ? token.coveredFrames + 1 : 1)
      : 0;
    token.cameraRevision = this.revision;
    token.readyFrames = token.coveredFrames;
    return token.readyFrames >= 2;
  }

  ready(token: StageToken): boolean {
    return this.current(token) && token.cameraRevision === this.revision && token.readyFrames >= 2;
  }

  commit(token: StageToken): void {
    if (!this.ready(token)) throw new DOMException('The requested viewport is no longer ready.', 'AbortError');
    this.committedGeneration = token.generation;
    this.pending = null;
  }

  cancel(token: StageToken): void {
    if (this.pending === token) this.pending = null;
  }

  get generation(): number { return this.committedGeneration; }
  get cameraRevision(): number { return this.revision; }
  get pendingGeneration(): number | null { return this.pending?.generation ?? null; }
}
