import { immutable } from '@chronicle/contracts/canonical';

export interface InteractionState {
  revision: number; pendingRevision: number; status: 'idle' | 'loading' | 'ready' | 'error'; message: string; errorCode: string | null;
  cursorYear: number; selection: { entityId: string; observationId: string } | null;
}
export type InteractionAction =
  | { type: 'cursor'; year: number; origin: string; revision: number }
  | { type: 'select'; entityId: string; observationId: string; origin: string; revision: number }
  | { type: 'clear-selection'; origin: string; revision: number };
export interface InteractionOptions<S extends InteractionState> {
  readonly timeoutMs?: number;
  readonly derive?: (state: S) => S;
  readonly hasResult: (state: S) => boolean;
  readonly clear: () => Partial<S>;
  readonly acceptsSelection: (state: S, action: Extract<InteractionAction, { type: 'select' }>) => boolean;
}
export class InteractionRuntime<S extends InteractionState> {
  protected state: S;
  protected disposed = false;
  private readonly listeners = new Set<(state: S) => void>();
  private request = 0;
  private commits = 0;
  private pending: AbortController | null = null;
  private readonly timeoutMs: number;
  constructor(initial: S, private readonly options: InteractionOptions<S>) {
    if (!Number.isFinite(initial.cursorYear) || initial.cursorYear < -12000 || initial.cursorYear > 3000) throw new Error('Invalid host year');
    this.timeoutMs = options.timeoutMs ?? 5000;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 60000) throw new Error('Invalid staging deadline');
    this.state = immutable(initial);
  }
  getSnapshot(): S { return this.state; }
  subscribe(listener: (state: S) => void): () => void {
    if (this.disposed) throw new Error('Disposed');
    this.listeners.add(listener); listener(this.state); return () => { this.listeners.delete(listener); };
  }
  protected update(patch: Partial<S>): void {
    const next = { ...this.state, ...patch }, previous = this.state;
    this.state = immutable(this.options.derive ? this.options.derive(next) : next);
    try { for (const listener of this.listeners) listener(this.state); }
    catch {
      this.state = previous;
      for (const listener of this.listeners) { try { listener(previous); } catch { /* Data rollback is preserved even if a host renderer is unavailable. */ } }
      throw new Error('RENDER_FAILED');
    }
  }
  dispatch(action: InteractionAction): boolean {
    if (this.disposed || action.revision !== this.state.revision || typeof action.origin !== 'string' || action.origin.length > 120) return false;
    if (action.type === 'cursor') {
      if (!Number.isFinite(action.year) || action.year < -12000 || action.year > 3000 || action.year === this.state.cursorYear) return false;
      this.update({ cursorYear: action.year } as Partial<S>); return true;
    }
    if (action.type === 'clear-selection') {
      if (!this.state.selection) return false;
      this.update({ selection: null } as Partial<S>); return true;
    }
    if (!this.options.acceptsSelection(this.state, action)) return false;
    if (this.state.selection?.entityId === action.entityId && this.state.selection.observationId === action.observationId) return false;
    this.update({ selection: { entityId: action.entityId, observationId: action.observationId } } as Partial<S>); return true;
  }
  async stage<R>(operation: (signal: AbortSignal) => Promise<R>, commit: (result: R, revision: number) => Partial<S> | null): Promise<boolean> {
    if (this.disposed) return false;
    const request = ++this.request; this.pending?.abort(); const abort = new AbortController(); this.pending = abort;
    this.update({ pendingRevision: request, status: 'loading', message: 'Validating and staging the complete workspace…', errorCode: null } as Partial<S>);
    let timer: ReturnType<typeof setTimeout> | undefined, cancel: (() => void) | undefined;
    try {
      const cancellation = new Promise<never>((_, reject) => {
        cancel = () => reject(new Error('CANCELLED')); abort.signal.addEventListener('abort', cancel, { once: true });
        timer = setTimeout(() => { reject(new Error('DATA_TIMEOUT')); abort.abort(); }, this.timeoutMs);
      });
      const result = await Promise.race([operation(abort.signal), cancellation]);
      if (this.disposed || request !== this.request || abort.signal.aborted) return false;
      const patch = commit(result, request);
      if (!patch) { this.update({ status: 'ready', message: 'Scope unchanged; no duplicate revision was created.' } as Partial<S>); return true; }
      this.update(patch); this.commits++; return true;
    } catch (error) {
      if (this.disposed || request !== this.request) return false;
      const code = error instanceof Error && 'code' in error ? String(error.code) : error instanceof Error ? error.message : 'INVALID_SPEC';
      const patch = { status: 'error', errorCode: code, message: code === 'INSUFFICIENT_EVIDENCE' ? 'No observations overlap this scope. Previous workspace remains visible; missing is not zero.' : code === 'RENDER_FAILED' ? 'The new views could not be installed. Previous workspace data was restored.' : 'The requested workspace could not be activated. Previous evidence remains visible.' } as Partial<S>;
      try { this.update(patch); } catch { this.state = immutable({ ...this.state, ...patch }); }
      return false;
    } finally {
      if (timer) clearTimeout(timer);
      if (cancel) abort.signal.removeEventListener('abort', cancel);
      if (this.pending === abort) this.pending = null;
    }
  }
  cancel(): void {
    if (this.disposed) return;
    this.pending?.abort(); this.pending = null; ++this.request;
    this.update({ pendingRevision: this.request, status: this.options.hasResult(this.state) ? 'ready' : 'idle', message: 'Request cancelled; previous workspace retained.' } as Partial<S>);
  }
  close(): void {
    if (this.disposed) return;
    this.pending?.abort(); this.pending = null; const revision = ++this.request;
    this.update({ ...this.options.clear(), revision, pendingRevision: revision, status: 'idle', message: 'Prepared example — planner not enabled.' } as Partial<S>);
  }
  getDiagnostics() { return { listeners: this.listeners.size, commits: this.commits, revision: this.state.revision, pending: !!this.pending, disposed: this.disposed }; }
  dispose(): void { if (this.disposed) return; this.close(); this.listeners.clear(); this.disposed = true; }
}
