import { EVIDENCE_LIMITS, EVIDENCE_POLICY, EvidenceQueryIntentSchema, EvidenceQueryPlanSchema, EvidenceReplaySchema, boundedEvidence, parseEvidenceRecord, validateEvidenceDashboard, type EvidenceRecord, type EvidenceQueryIntent, type EvidenceQueryPlan, type EvidenceWorkspace, type ResolvedEvidenceBundle } from '@chronicle/contracts/evidence';
import { canonicalJSON, hashText, immutable } from '@chronicle/contracts/canonical';
import { EvidenceMemoryCache, boundedSourceOperation, matchesEvidence, type RegisteredEvidenceSource, type SourceRequestOptions } from './evidence-source.ts';
import { WikidataHistoricalAdapter } from './wikidata.ts';
import { createRenderSpecification, type SandboxedRenderSpecification } from '@chronicle/contracts/visualization';

const authorizedWikidataContexts = new WeakSet<object>();
export function isAuthorizedWikidataContext(context: object): boolean { return authorizedWikidataContexts.has(context); }
export class EvidenceSourceRegistry {
  private readonly sources = new Map<string, RegisteredEvidenceSource>();
  private readonly cache = new EvidenceMemoryCache();
  register(adapter: RegisteredEvidenceSource): void {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(adapter.id) || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(adapter.version) || this.sources.has(adapter.id) || this.sources.size >= EVIDENCE_LIMITS.sources) throw new Error('INVALID_SOURCE_ADAPTER');
    this.sources.set(adapter.id, adapter);
  }
  list(): readonly { id: string; version: string; remote: boolean }[] { return immutable([...this.sources.values()].map(source => ({ id: source.id, version: source.version, remote: source.remote }))); }
  remember(records: readonly EvidenceRecord[]): EvidenceRecord[] {
    for (const record of records) if (!this.sources.has(record.source.adapterId)) throw new Error('UNREGISTERED_SOURCE');
    return this.cache.admit(records);
  }
  async resolve(intent: EvidenceQueryIntent, options: SourceRequestOptions): Promise<EvidenceRecord[]> {
    const records: EvidenceRecord[] = [];
    for (const id of intent.sourceIds) {
      if (options.signal?.aborted) throw new Error('CANCELLED');
      const source = this.sources.get(id); if (!source) throw new Error('UNREGISTERED_SOURCE');
      if (source.remote && options.allowRemote !== true) throw new Error('REMOTE_NOT_AUTHORIZED');
      const rows = await source.queryEntities(intent.question, intent.bounds ?? undefined, intent.temporalRange ?? undefined, options);
      if (options.signal?.aborted) throw new Error('CANCELLED');
      if (!Array.isArray(rows) || records.length + rows.length > EVIDENCE_LIMITS.records) throw new Error('EVIDENCE_BUDGET_EXCEEDED');
      for (const row of rows) { const checked = parseEvidenceRecord(row); if (checked.source.adapterId !== source.id) throw new Error('SOURCE_ID_MISMATCH'); records.push(checked); }
    }
    return this.remember(records).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  }
  dependencies(ids: readonly string[]): EvidenceQueryPlan['adapters'] {
    return ids.map(id => { const source = this.sources.get(id); if (!source) throw new Error('UNREGISTERED_SOURCE'); return { id, version: source.version }; });
  }
  pinned(plan: EvidenceQueryPlan): EvidenceRecord[] {
    if (canonicalJSON(this.dependencies(plan.adapters.map(adapter => adapter.id))) !== canonicalJSON(plan.adapters)) throw new Error('ADAPTER_VERSION_MISMATCH');
    return plan.records.map(ref => this.cache.get(ref.id, ref.recordHash));
  }
  permitsWikidataProcessing(records: readonly EvidenceRecord[]): boolean {
    const source = this.sources.get('wikidata');
    return source instanceof WikidataHistoricalAdapter && records.length > 0 && records.every(record => record.source.adapterId === source.id && source.hasPinnedRecord(record));
  }
  clear(): void { this.cache.clear(); for (const source of this.sources.values()) source.clear(); }
}
export interface EvidenceLayoutContext {
  readonly recordIds: readonly string[]; readonly resultHash: string; readonly permittedViews: readonly string[];
  readonly records: readonly Pick<EvidenceRecord, 'id' | 'label' | 'variable' | 'value' | 'unit' | 'time' | 'geometry'>[];
}
export interface EvidenceLayoutProvider { readonly mode: 'offline-test' | 'live'; propose(context: EvidenceLayoutContext, signal: AbortSignal): Promise<unknown> }
export class GroundedEvidencePlanner {
  constructor(readonly sources: EvidenceSourceRegistry) {}
  async prepare(input: unknown, options: SourceRequestOptions & { readonly layout?: EvidenceLayoutProvider; readonly allowWikidataModelProcessing?: boolean; readonly timeoutMs?: number } = {}): Promise<EvidenceWorkspace> {
    const intent = EvidenceQueryIntentSchema.parse(boundedEvidence(input, 8192)), timeoutMs = options.timeoutMs ?? (options.layout ? 30000 : 10000);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 45000) throw new Error('INVALID_SOURCE_DEADLINE');
    return boundedSourceOperation(async signal => {
      const records = await this.sources.resolve(intent, { allowRemote: options.allowRemote, signal });
      const result = this.fromRecords(intent, records);
      if (!options.layout) return result;
      const authorized = options.allowWikidataModelProcessing === true && this.sources.permitsWikidataProcessing(records);
      if (options.layout.mode === 'live' && !authorized) throw new Error('MODEL_PROCESSING_DENIED');
      const context: EvidenceLayoutContext = immutable({ recordIds: records.map(record => record.id), resultHash: result.bundle.resultHash, permittedViews: ['table', 'evidence', ...(records.some(record => record.geometry) ? ['map'] : [])], records: records.map(({ id, label, variable, value, unit, time, geometry }) => ({ id, label, variable, value, unit, time, geometry })) });
      if (authorized) authorizedWikidataContexts.add(context);
      const proposal = await options.layout.propose(context, signal); if (signal.aborted) throw new Error('CANCELLED');
      return immutable({ ...result, specification: validateEvidenceDashboard(proposal, result.bundle), planner: options.layout.mode });
    }, options.signal, timeoutMs);
  }
  async prepareVisualization(input: unknown, options: SourceRequestOptions & { readonly allowWikidataModelProcessing?: boolean; readonly generator: { readonly mode: 'offline-test' | 'live'; proposeProgram(context: EvidenceLayoutContext, signal: AbortSignal): Promise<string> } }): Promise<{ workspace: EvidenceWorkspace; specification: SandboxedRenderSpecification }> {
    let program = '';
    const workspace = await this.prepare(input, { ...options, layout: { mode: options.generator.mode, async propose(context, signal) {
      program = await options.generator.proposeProgram(context, signal);
      return { schemaVersion: 1, kind: 'chronicle-evidence-dashboard', resultHash: context.resultHash, recordIds: context.recordIds, views: context.permittedViews };
    } } });
    return immutable({ workspace, specification: createRenderSpecification(workspace.bundle, program) });
  }
  fromRecords(input: unknown, data: readonly EvidenceRecord[]): EvidenceWorkspace {
    const intent = EvidenceQueryIntentSchema.parse(boundedEvidence(input, 8192));
    if (!data.length) throw new Error('INSUFFICIENT_EVIDENCE');
    const records = this.sources.remember(data).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    if (records.some(record => !intent.sourceIds.includes(record.source.adapterId))) throw new Error('SOURCE_SCOPE_MISMATCH');
    if (records.some(record => !matchesEvidence(record, '', intent.bounds ?? undefined, intent.temporalRange ?? undefined))) throw new Error('EVIDENCE_SCOPE_MISMATCH');
    const plan = EvidenceQueryPlanSchema.parse({ policy: EVIDENCE_POLICY, intentHash: hashText(canonicalJSON(intent)), adapters: this.sources.dependencies(intent.sourceIds), records: records.map(record => ({ id: record.id, recordHash: record.recordHash })) });
    const bundle: ResolvedEvidenceBundle = immutable({ records, resultHash: hashText(canonicalJSON({ plan, records })) });
    const specification = validateEvidenceDashboard({ schemaVersion: 1, kind: 'chronicle-evidence-dashboard', resultHash: bundle.resultHash, recordIds: records.map(record => record.id), views: ['table', 'evidence', ...(records.some(record => record.geometry) ? ['map'] : [])] }, bundle);
    return immutable({ intent, plan, bundle, specification, planner: 'host' });
  }
  export(result: EvidenceWorkspace): string {
    const manifest = EvidenceReplaySchema.parse({ schemaVersion: 1, kind: 'chronicle-evidence-replay', intent: result.intent, plan: result.plan, specification: result.specification, planner: result.planner });
    return canonicalJSON(boundedEvidence(manifest, 1048576)) + '\n';
  }
  reopen(input: unknown): EvidenceWorkspace {
    const manifest = EvidenceReplaySchema.parse(boundedEvidence(input, 1048576));
    const result = this.fromRecords(manifest.intent, this.sources.pinned(manifest.plan));
    if (canonicalJSON(manifest.plan) !== canonicalJSON(result.plan)) throw new Error('EVIDENCE_REPLAY_MISMATCH');
    return immutable({ ...result, specification: validateEvidenceDashboard(manifest.specification, result.bundle), planner: manifest.planner });
  }
  dispose(): void { this.sources.clear(); }
}
