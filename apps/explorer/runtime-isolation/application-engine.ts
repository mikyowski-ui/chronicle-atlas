/** User-approved application fallback. Fixed reviewed fixtures, NOT arbitrary-code security. */
import { Worker } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { admit, authorize, sha256, validateResult, type Authority, type TransformRequest, type TransformResult } from './contract.ts';
import { BoundaryError, object, strictJson } from './strict-json.ts';

export const APPLICATION_POLICY = Object.freeze({
  version: 'm3-application-fixed-v1', profile: 'application-capability-guard',
  generatedExecution: false, modelProcessing: false, liveServices: false,
  requestBytes: 65_536, outputBytes: 4_096, diagnosticBytes: 1_024,
  rows: 2_000, vmMilliseconds: 100, wallMilliseconds: 2_000,
  terminationMilliseconds: 1_000, queue: 1, workers: 1,
  maxOldGenerationSizeMb: 32, maxYoungGenerationSizeMb: 8, stackSizeMb: 2,
  kernelIsolation: false, aggregateProcessMemoryLimit: false,
});
export const APPLICATION_FIXTURES = ['network', 'dom', 'environment', 'filesystem', 'processes', 'constructor-escape', 'prototype-pollution', 'unauthorized-call', 'infinite-loop', 'memory-flood', 'output-flood', 'diagnostic-flood', 'malformed-output', 'markup-output', 'forged-output', 'crash', 'partial-output'] as const;
export type ApplicationFixture = typeof APPLICATION_FIXTURES[number];
export type ApplicationReceipt = Readonly<{
  profile: 'application-capability-guard'; policy: string; runtimeHash: string; inputHash: string; resultHash: string | null;
  generation: number; parentRevision: string | null; policyHash: string | null;
  wallMilliseconds: number; terminationMilliseconds: number; outputBytes: number; diagnosticBytes: number;
  threadId: number; exitCode: number | null; cleanupVerified: boolean;
  generatedExecution: false; modelProcessing: false; kernelIsolation: false;
}>;
export type ApplicationOutcome = Readonly<{ code: string; result?: TransformResult; receipt?: ApplicationReceipt }>;
type Job = Readonly<{ operation: 'sum-v1' | ApplicationFixture; request?: TransformRequest; authority?: () => Authority; generation: number; resolve: (outcome: ApplicationOutcome) => void }>;
const workerUrl = new URL('./application-worker.mjs', import.meta.url);
const allowedFailureCodes = new Set(['EXECUTION_TIMEOUT', 'MEMORY_LIMIT', 'BOUNDARY_CRASH', 'UNKNOWN_OPERATION', 'INVALID_REQUEST', 'FIXTURE_FAILED']);

export class ApplicationIsolationEngine {
  private generation = 0;
  private running = false;
  private disposed = false;
  private disabled = false;
  private pending: Job | undefined;
  private active: Worker | undefined;
  private termination: Promise<number | undefined> | undefined;
  private terminationStarted: number | undefined;
  private terminationCode: string | undefined;

  get status(): Readonly<{ running: boolean; queued: number; disabled: boolean; generation: number }> {
    return Object.freeze({ running: this.running, queued: this.pending ? 1 : 0, disabled: this.disabled, generation: this.generation });
  }
  async transform(raw: Uint8Array, authority: () => Authority): Promise<ApplicationOutcome> {
    let request: TransformRequest;
    try { request = admit(raw, authority()); }
    catch (error) { return { code: error instanceof BoundaryError ? error.code : 'INVALID_REQUEST' }; }
    return this.enqueue({ operation: 'sum-v1', request, authority });
  }
  async verifyFixture(fixture: ApplicationFixture): Promise<ApplicationOutcome> {
    if (!APPLICATION_FIXTURES.includes(fixture)) return { code: 'UNKNOWN_OPERATION' };
    return this.enqueue({ operation: fixture });
  }
  cancel(): void {
    this.generation++;
    this.pending?.resolve({ code: 'CANCELLED' }); this.pending = undefined;
    this.stop('CANCELLED');
  }
  dispose(): void { this.disposed = true; this.cancel(); }
  private stop(code?: string): void {
    if (code) this.terminationCode ??= code;
    if (this.active && !this.termination) {
      this.terminationStarted = performance.now();
      this.termination = this.active.terminate();
    }
  }
  private enqueue(work: Omit<Job, 'generation' | 'resolve'>): Promise<ApplicationOutcome> {
    if (this.disposed || this.disabled) return Promise.resolve({ code: 'ISOLATION_UNAVAILABLE' });
    const generation = ++this.generation;
    this.pending?.resolve({ code: 'SUPERSEDED' });
    this.stop('SUPERSEDED');
    return new Promise(resolve => {
      const job: Job = { ...work, generation, resolve };
      if (this.running) this.pending = job;
      else void this.execute(job);
    });
  }
  private async execute(job: Job): Promise<void> {
    this.running = true; this.termination = undefined; this.terminationStarted = undefined; this.terminationCode = undefined;
    let outcome: ApplicationOutcome;
    try { outcome = await this.launch(job); }
    catch (error) { outcome = { code: error instanceof BoundaryError ? error.code : 'ISOLATION_UNAVAILABLE' }; }
    this.active = undefined; this.running = false; job.resolve(outcome);
    const next = this.pending; this.pending = undefined;
    if (next) {
      if (this.disabled || this.disposed) next.resolve({ code: 'ISOLATION_UNAVAILABLE' });
      else void this.execute(next);
    }
  }
  private async launch(job: Job): Promise<ApplicationOutcome> {
    const runtimeHash = sha256(await readFile(fileURLToPath(workerUrl)));
    if (job.generation !== this.generation || this.disposed) return { code: 'SUPERSEDED' };
    if (job.request && job.authority) authorize(job.request, job.authority());
    const started = performance.now();
    let outputBytes = 0; let diagnosticBytes = 0; let exitCode: number | null = null;
    let output: Buffer | undefined; let result: TransformResult | undefined; let resultHash: string | null = null;
    let code = 'OK'; let cleanupVerified = false; let terminationMilliseconds = 0;
    const worker = new Worker(workerUrl, {
      workerData: { operation: job.operation, values: job.request?.rows.map(row => row.value) ?? [] },
      env: {}, argv: [], execArgv: [], stdout: true, stderr: true,
      resourceLimits: { maxOldGenerationSizeMb: APPLICATION_POLICY.maxOldGenerationSizeMb, maxYoungGenerationSizeMb: APPLICATION_POLICY.maxYoungGenerationSizeMb, stackSizeMb: APPLICATION_POLICY.stackSizeMb },
    });
    this.active = worker; const threadId = worker.threadId;
    try {
      await new Promise<void>(resolve => {
        let done = false; let messages = 0;
        const finish = (failure?: string): void => {
          if (failure && code !== 'CLEANUP_FAILED') code = failure;
          if (done) return;
          done = true; clearTimeout(timer); clearInterval(reapWatch); this.stop(); resolve();
        };
        const timer = setTimeout(() => finish('WALL_LIMIT'), APPLICATION_POLICY.wallMilliseconds);
        const reapWatch = setInterval(() => {
          if (this.terminationStarted !== undefined && performance.now() - this.terminationStarted >= APPLICATION_POLICY.terminationMilliseconds) { this.disabled = true; finish('CLEANUP_FAILED'); }
        }, 10);
        const diagnostic = (chunk: Buffer): void => {
          diagnosticBytes += chunk.byteLength;
          if (diagnosticBytes > APPLICATION_POLICY.diagnosticBytes) finish('DIAGNOSTIC_LIMIT');
          chunk.fill(0);
        };
        worker.stdout.on('data', diagnostic); worker.stderr.on('data', diagnostic);
        worker.on('message', (message: unknown) => {
          try {
            const envelope = object(message, ['kind', 'bytes']);
            if (envelope.kind === 'diagnostic' && typeof envelope.bytes === 'string') {
              diagnosticBytes += Buffer.byteLength(envelope.bytes);
              if (diagnosticBytes > APPLICATION_POLICY.diagnosticBytes) finish('DIAGNOSTIC_LIMIT');
              return;
            }
          } catch { /* Failure envelopes have another strict shape below. */ }
          try {
            if (message !== null && typeof message === 'object' && 'kind' in message && message.kind === 'failure') {
              const envelope = object(message, ['kind', 'code']);
              finish(typeof envelope.code === 'string' && allowedFailureCodes.has(envelope.code) ? envelope.code : 'INVALID_MESSAGE'); return;
            }
            const envelope = object(message, ['kind', 'bytes']);
            if (envelope.kind !== 'output' || typeof envelope.bytes !== 'string') { finish('INVALID_MESSAGE'); return; }
            messages++; if (messages !== 1) { finish('MULTIPLE_OUTPUTS'); return; }
            outputBytes += Buffer.byteLength(envelope.bytes);
            if (outputBytes > APPLICATION_POLICY.outputBytes) { finish('OUTPUT_LIMIT'); return; }
            output = Buffer.from(envelope.bytes, 'utf8'); finish();
          } catch { finish('INVALID_MESSAGE'); }
        });
        worker.on('error', (error: Error & { code?: string }) => finish(error.code === 'ERR_WORKER_OUT_OF_MEMORY' ? 'MEMORY_LIMIT' : 'BOUNDARY_CRASH'));
        worker.on('exit', exit => { exitCode = exit; if (!done) finish(output ? undefined : 'BOUNDARY_CRASH'); });
      });
    } finally {
      this.stop();
      let reapTimer: ReturnType<typeof setTimeout> | undefined;
      const reaped = await Promise.race([
        (this.termination ?? Promise.resolve(undefined)).then(() => true, () => false),
        new Promise<boolean>(resolve => { reapTimer = setTimeout(() => resolve(false), Math.max(0, APPLICATION_POLICY.terminationMilliseconds - (this.terminationStarted === undefined ? 0 : performance.now() - this.terminationStarted))); }),
      ]);
      if (reapTimer) clearTimeout(reapTimer);
      terminationMilliseconds = this.terminationStarted === undefined ? 0 : performance.now() - this.terminationStarted;
      cleanupVerified = reaped && worker.threadId === -1;
      if (!cleanupVerified) { this.disabled = true; code = 'CLEANUP_FAILED'; }
    }
    if (code !== 'CLEANUP_FAILED') {
      code = this.terminationCode ?? code;
      if (job.generation !== this.generation || this.disposed) code = 'SUPERSEDED';
      if (code === 'OK') {
        try {
          if (!output) throw new BoundaryError('INVALID_RESULT');
          if (job.request && job.authority) { authorize(job.request, job.authority()); result = validateResult(output, job.request); }
          else {
            const parsed = object(strictJson(output, APPLICATION_POLICY.outputBytes), ['schema', 'denied']);
            if (parsed.schema !== 1 || parsed.denied !== true) throw new BoundaryError('FIXTURE_FAILED');
          }
          resultHash = sha256(output);
        } catch (error) { code = error instanceof BoundaryError ? error.code : 'INVALID_RESULT'; }
      }
    }
    output?.fill(0);
    return { code, ...(code === 'OK' && result ? { result } : {}), receipt: {
      profile: 'application-capability-guard', policy: APPLICATION_POLICY.version, runtimeHash,
      inputHash: sha256(job.request ? JSON.stringify(job.request) : job.operation), resultHash,
      generation: job.generation, parentRevision: job.request?.parentRevision ?? null, policyHash: job.request?.policyHash ?? null,
      wallMilliseconds: performance.now() - started, terminationMilliseconds, outputBytes, diagnosticBytes,
      threadId, exitCode, cleanupVerified, generatedExecution: false, modelProcessing: false, kernelIsolation: false,
    } };
  }
}
