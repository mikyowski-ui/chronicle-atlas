import { immutable } from '@chronicle/contracts/canonical';
import type { MechanismSelection, MechanismSpecification } from '@chronicle/contracts/mechanism';
import { InteractionRuntime, type InteractionState } from './interaction.ts';
import {
  MechanismError, exportMechanismReplay, preflightMechanismReplay, registerMechanism, resolveMechanism, resolveMechanismSelection,
  restoreMechanismReplay, specForMechanism, validateMechanismSpecification, type MechanismBundle, type MechanismRegistration,
} from './mechanism.ts';

export interface MechanismLoader { source(signal: AbortSignal): Promise<string>; dataset(signal: AbortSignal): Promise<string> }
export interface MechanismResult {
  readonly domain: 'technological-mechanism';
  readonly spec: MechanismSpecification;
  readonly bundle: MechanismBundle;
  readonly restored: { readonly cursorYear: number; readonly selection: MechanismSelection | null } | null;
}
export interface MechanismEngineOptions {
  readonly datasetId: string;
  readonly workspaceId: string;
  readonly pins: { readonly sourceHash: string; readonly datasetHash: string };
  readonly loader: MechanismLoader;
}
export class MechanismEngine {
  private registration: MechanismRegistration | null = null;
  private loads = 0;
  private disposed = false;
  private readonly options: MechanismEngineOptions;
  constructor(options: MechanismEngineOptions) {
    if (![options.datasetId, options.workspaceId].every(value => /^[a-z][a-z0-9-]{0,79}$/.test(value)) || ![options.pins.sourceHash, options.pins.datasetHash].every(value => /^[a-f0-9]{64}$/.test(value))) throw new MechanismError('INVALID_SPEC', 'Host registration pins are invalid.');
    this.options = { ...options, pins: Object.freeze({ ...options.pins }), loader: { ...options.loader } };
  }
  get datasetId(): string { return this.options.datasetId; }
  private async register(signal: AbortSignal): Promise<MechanismRegistration> {
    if (this.disposed || signal.aborted) throw new Error('CANCELLED');
    if (this.registration) return this.registration;
    this.loads++;
    const [source, dataset] = await Promise.all([this.options.loader.source(signal), this.options.loader.dataset(signal)]);
    if (this.disposed || signal.aborted) throw new Error('CANCELLED');
    const registration = registerMechanism(source, dataset, this.options.pins);
    if (registration.descriptor.id !== this.options.datasetId) throw new MechanismError('EDITION_MISMATCH', 'Host dataset identity differs from its registered records.');
    this.registration = registration; return registration;
  }
  private finish(spec: MechanismSpecification, registration: MechanismRegistration, restored: MechanismResult['restored']): MechanismResult {
    const checked = validateMechanismSpecification(spec, registration);
    return immutable({ domain: 'technological-mechanism', spec: checked, bundle: resolveMechanism(checked, registration), restored });
  }
  async prepared(id: string, signal: AbortSignal): Promise<MechanismResult> {
    if (id !== this.options.datasetId) throw new MechanismError('UNKNOWN_REFERENCE', 'Mechanism dataset is not host-registered.');
    const registration = await this.register(signal);
    return this.finish(specForMechanism(registration, undefined, this.options.workspaceId), registration, null);
  }
  async reopen(input: unknown, signal: AbortSignal): Promise<MechanismResult> {
    if (preflightMechanismReplay(input).datasetId !== this.options.datasetId) throw new MechanismError('UNKNOWN_REFERENCE', 'Replay cites an unregistered mechanism dataset.');
    const registration = await this.register(signal), restored = restoreMechanismReplay(input, registration);
    return this.finish(restored.spec, registration, restored.restored);
  }
  async setViews(current: MechanismResult, views: MechanismSpecification['views'], signal: AbortSignal): Promise<MechanismResult> {
    const registration = await this.register(signal);
    return this.finish({ ...current.spec, views }, registration, null);
  }
  getDiagnostics() { return { registered: this.registration !== null, loads: this.loads }; }
  dispose() { this.disposed = true; this.registration = null; }
}
export interface MechanismSnapshot extends InteractionState { active: MechanismResult | null }
export class MechanismController extends InteractionRuntime<MechanismSnapshot> {
  constructor(initialYear: number, private readonly engine: MechanismEngine) {
    super({ revision: 0, pendingRevision: 0, status: 'idle', message: 'Prepared mechanism', errorCode: null, cursorYear: initialYear, selection: null, active: null }, {
      hasResult: state => state.active !== null, clear: () => ({ active: null }),
      acceptsSelection: (state, action) => !!state.active && !!resolveMechanismSelection(state.active.bundle, action),
    });
  }
  private readonly commit = (active: MechanismResult, revision: number): Partial<MechanismSnapshot> => ({ revision, active, status: 'ready', message: 'Source-backed prepared mechanism · excerpt pinned', errorCode: null,
    ...(active.restored ? { cursorYear: active.restored.cursorYear, selection: active.restored.selection } : { selection: null }),
  });
  open() { return this.stage(signal => this.engine.prepared(this.engine.datasetId, signal), this.commit); }
  replay(input: unknown) { return this.stage(signal => this.engine.reopen(input, signal), this.commit); }
  exportManifest(): string {
    const active = this.state.active;
    if (!active) throw new Error('Open a workspace before saving.');
    return exportMechanismReplay(active.spec, active.bundle, this.state.cursorYear, this.state.selection);
  }
  getDiagnostics() { return { ...super.getDiagnostics(), ...this.engine.getDiagnostics() }; }
  dispose() { if (this.disposed) return; super.dispose(); this.engine.dispose(); }
}
