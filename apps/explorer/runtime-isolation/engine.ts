/** Node-only coordinator. Never imported by the browser or a replay loader. */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, readFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { admit, authorize, FIXTURES, POLICY, sha256, validateResult, type Authority, type Fixture, type TransformRequest, type TransformResult } from './contract.ts';
import { BoundaryError, object, strictJson } from './strict-json.ts';

export type Receipt = Readonly<{
  policy: string; runtimeHash: string; sourceHash: string; inputHash: string;
  generation: number; parentRevision: string | null; policyHash: string | null;
  wallMilliseconds: number; outputBytes: number; diagnosticBytes: number;
  exitCode: number | null; signal: string | null; bootstrapStage: string | null;
  bootstrapErrno: number | null; cleanupVerified: boolean; nativeValidation: boolean;
  generatedExecution: false; modelProcessing: false;
}>;
export type Outcome = Readonly<{ code: string; result?: TransformResult; receipt?: Receipt }>;
type Work = Readonly<{ generation: number; operation: 'sum-v1' | Fixture; request?: TransformRequest; authority?: () => Authority; resolve: (outcome: Outcome) => void }>;
type Runtime = Readonly<{ binary: string; runtimeHash: string; sourceHash: string }>;
const defaultDirectory = fileURLToPath(new URL('../verification/m3/runtime/', import.meta.url));
const sourcePath = fileURLToPath(new URL('./worker.c', import.meta.url));
const bootstrapStages = new Set(['invocation', 'operation', 'stdio-pipes', 'close-descriptors', 'clear-environment', 'core', 'file-size', 'cpu', 'address-space', 'stack', 'processes', 'descriptors', 'empty-root', 'supplementary-groups', 'unprivileged-identity', 'no-new-privileges', 'nondumpable', 'locked-memory', 'seccomp', 'architecture']);

/** Trusted installation config only. No request may choose a path, environment or budget. */
async function runtime(directory: string): Promise<Runtime> {
  if (process.platform !== 'linux' || process.arch !== 'x64') throw new BoundaryError('ISOLATION_UNAVAILABLE');
  const raw = await readFile(join(directory, 'build-receipt.json'));
  const data = object(strictJson(raw), ['schema', 'sourceHash', 'binaryHash', 'platform', 'compiler', 'command', 'generatedExecution', 'modelProcessing']);
  if (data.schema !== 1 || typeof data.binaryHash !== 'string' || typeof data.sourceHash !== 'string' || data.generatedExecution !== false || data.modelProcessing !== false) throw new BoundaryError('ISOLATION_UNAVAILABLE');
  const binary = join(directory, 'chronicle-isolation-worker');
  const [bytes, source] = await Promise.all([readFile(binary), readFile(sourcePath)]);
  if (sha256(bytes) !== data.binaryHash || sha256(source) !== data.sourceHash) throw new BoundaryError('RUNTIME_HASH_MISMATCH');
  return { binary, runtimeHash: data.binaryHash, sourceHash: data.sourceHash };
}

export class IsolationEngine {
  private generation = 0;
  private active: ChildProcessWithoutNullStreams | undefined;
  private pending: Work | undefined;
  private running = false;
  private disabled = false;
  private disposed = false;
  private terminationCode: string | undefined;
  private terminationStarted: number | undefined;
  constructor(private readonly runtimeDirectory = defaultDirectory) {}

  get status(): Readonly<{ running: boolean; queued: number; disabled: boolean; generation: number }> {
    return Object.freeze({ running: this.running, queued: this.pending ? 1 : 0, disabled: this.disabled, generation: this.generation });
  }
  async transform(raw: Uint8Array, authority: () => Authority): Promise<Outcome> {
    let request: TransformRequest;
    try { request = admit(raw, authority()); }
    catch (error) { return { code: error instanceof BoundaryError ? error.code : 'INVALID_REQUEST' }; }
    return this.enqueue({ operation: 'sum-v1', request, authority });
  }
  /** Synthetic hand-authored fixtures only; this never accepts executable bytes or source. */
  async verifyFixture(fixture: Fixture): Promise<Outcome> {
    if (!FIXTURES.includes(fixture)) return { code: 'UNKNOWN_OPERATION' };
    return this.enqueue({ operation: fixture });
  }
  cancel(): void {
    this.generation++;
    this.pending?.resolve({ code: 'CANCELLED' }); this.pending = undefined;
    this.terminate('CANCELLED');
  }
  dispose(): void { this.disposed = true; this.cancel(); }
  private terminate(code: string): void {
    this.terminationCode ??= code;
    this.terminationStarted ??= performance.now();
    if (this.active?.pid && this.active.exitCode === null && this.active.signalCode === null) {
      try { process.kill(-this.active.pid, 'SIGKILL'); }
      catch { try { this.active.kill('SIGKILL'); } catch { this.disabled = true; } }
    }
  }
  private enqueue(work: Omit<Work, 'generation' | 'resolve'>): Promise<Outcome> {
    if (this.disposed || this.disabled) return Promise.resolve({ code: 'ISOLATION_UNAVAILABLE' });
    const generation = ++this.generation;
    this.pending?.resolve({ code: 'SUPERSEDED' });
    this.terminate('SUPERSEDED');
    return new Promise(resolve => {
      const queued: Work = { ...work, generation, resolve };
      if (this.running) this.pending = queued;
      else void this.execute(queued);
    });
  }
  private async execute(work: Work): Promise<void> {
    this.running = true;
    this.terminationCode = undefined;
    this.terminationStarted = undefined;
    let outcome: Outcome;
    try { outcome = await this.launch(work); }
    catch (error) { outcome = { code: work.generation !== this.generation || this.disposed ? 'SUPERSEDED' : error instanceof BoundaryError ? error.code : 'ISOLATION_UNAVAILABLE' }; }
    work.resolve(outcome);
    this.active = undefined; this.running = false;
    const next = this.pending; this.pending = undefined;
    if (next) {
      if (this.disabled || this.disposed) next.resolve({ code: 'ISOLATION_UNAVAILABLE' });
      else void this.execute(next);
    }
  }
  private async launch(work: Work): Promise<Outcome> {
    const installation = await runtime(this.runtimeDirectory);
    if (work.generation !== this.generation || this.disposed) return { code: 'SUPERSEDED' };
    if (work.request && work.authority) authorize(work.request, work.authority());
    const directory = await mkdtemp(join(tmpdir(), 'chronicle-isolation-'));
    const started = performance.now();
    let outputBytes = 0; let diagnosticBytes = 0;
    const payload = Buffer.alloc(4 + (work.request?.rows.length ?? 0) * 8);
    payload.writeUInt32LE(work.request?.rows.length ?? 0);
    work.request?.rows.forEach((row, index) => payload.writeDoubleLE(row.value, 4 + index * 8));
    let code = 'OK'; let exitCode: number | null = null; let signal: string | null = null;
    let bootstrapStage: string | null = null; let bootstrapErrno: number | null = null;
    let cleanupVerified = false; let nativeValidation = false;
    let acceptedResult: TransformResult | undefined;
    const run = async (operation: string, input: Buffer, wallLimit: number): Promise<Buffer> => {
      const output: Buffer[] = []; const diagnostics: Buffer[] = [];
      const child = spawn(installation.binary, [operation], { cwd: directory, env: {}, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
      this.active = child;
      await new Promise<void>(resolve => {
        let finished = false;
        const finish = (): void => {
          if (finished) return;
          finished = true; clearTimeout(wallTimer); clearInterval(reapTimer); resolve();
        };
        const wallTimer = setTimeout(() => this.terminate(operation === 'validate-v1' ? 'VALIDATION_LIMIT' : 'WALL_LIMIT'), wallLimit);
        const reapTimer = setInterval(() => {
          if (this.terminationStarted !== undefined && performance.now() - this.terminationStarted > POLICY.terminationMilliseconds) { this.disabled = true; code = 'CLEANUP_FAILED'; finish(); }
        }, 10);
        child.stdout.on('data', (chunk: Buffer) => { outputBytes += chunk.byteLength; if (outputBytes > POLICY.outputBytes) this.terminate('OUTPUT_LIMIT'); else output.push(chunk); });
        child.stderr.on('data', (chunk: Buffer) => { diagnosticBytes += chunk.byteLength; if (diagnosticBytes > POLICY.diagnosticBytes) this.terminate('DIAGNOSTIC_LIMIT'); else diagnostics.push(chunk); });
        child.on('error', () => { code = 'ISOLATION_UNAVAILABLE'; finish(); });
        child.on('close', (exit, killed) => { exitCode = exit; signal = killed; finish(); });
        child.stdin.on('error', () => { /* Denied bootstrap closes input immediately. */ });
        child.stdin.end(input);
      });
      if (code !== 'CLEANUP_FAILED') code = this.terminationCode ?? code;
      if (exitCode === 78 && code === 'OK') {
        code = 'ISOLATION_UNAVAILABLE';
        const text = Buffer.concat(diagnostics).toString('ascii');
        const match = /^ISOLATION_UNAVAILABLE:([a-z-]+):(\d+)\n$/.exec(text);
        if (match && bootstrapStages.has(match[1])) { bootstrapStage = match[1]; bootstrapErrno = Number(match[2]); }
      } else if (code === 'OK' && (exitCode !== 0 || signal)) {
        code = exitCode === 79 ? 'RESULT_LINEAGE_MISMATCH' : signal === 'SIGKILL' || signal === 'SIGXCPU' ? 'CPU_LIMIT' : 'BOUNDARY_CRASH';
      }
      const result = Buffer.concat(output);
      output.forEach(chunk => chunk.fill(0)); diagnostics.forEach(chunk => chunk.fill(0));
      return result;
    };
    try {
      await chmod(directory, 0o500);
      if (work.generation !== this.generation) code = 'SUPERSEDED';
      else {
        const output = await run(work.operation, payload, POLICY.executionMilliseconds);
        try {
          if (work.generation !== this.generation && code === 'OK') code = 'SUPERSEDED';
          if (code === 'OK' && work.request && work.authority) {
            authorize(work.request, work.authority());
            // A separate hard-limited native process validates quarantined bytes. It receives
            // only the retained staged values, output length and bounded output; no host objects.
            const validationInput = Buffer.alloc(payload.length + 4 + output.length);
            payload.copy(validationInput); validationInput.writeUInt32LE(output.length, payload.length);
            output.copy(validationInput, payload.length + 4);
            try {
              const validated = await run('validate-v1', validationInput, POLICY.validatorMilliseconds);
              try {
                if (code === 'OK') { nativeValidation = true; acceptedResult = validateResult(validated, work.request); }
              } finally { validated.fill(0); }
            } finally { validationInput.fill(0); }
          } else if (code === 'OK') {
            const parsed = object(strictJson(output, POLICY.outputBytes), ['schema', 'denied']);
            if (parsed.schema !== 1 || parsed.denied !== true) code = 'FIXTURE_FAILED';
          }
        } finally { output.fill(0); }
      }
    } catch (error) {
      code = error instanceof BoundaryError ? error.code : 'ISOLATION_UNAVAILABLE';
    } finally {
      payload.fill(0);
      try { await rm(directory, { recursive: true, force: false }); cleanupVerified = true; }
      catch { this.disabled = true; code = 'CLEANUP_FAILED'; }
    }
    if (code !== 'CLEANUP_FAILED') {
      code = this.terminationCode ?? code;
      if (work.generation !== this.generation || this.disposed) code = 'SUPERSEDED';
      if (code === 'OK' && work.request && work.authority) {
        try { authorize(work.request, work.authority()); }
        catch (error) { code = error instanceof BoundaryError ? error.code : 'INVALID_AUTHORITY'; }
      }
    }
    return { code, ...(code === 'OK' && acceptedResult ? { result: acceptedResult } : {}), receipt: {
      policy: POLICY.version, runtimeHash: installation.runtimeHash, sourceHash: installation.sourceHash,
      inputHash: sha256(work.request ? JSON.stringify(work.request) : work.operation), generation: work.generation,
      parentRevision: work.request?.parentRevision ?? null, policyHash: work.request?.policyHash ?? null,
      wallMilliseconds: performance.now() - started, outputBytes, diagnosticBytes, exitCode, signal,
      bootstrapStage, bootstrapErrno, cleanupVerified, nativeValidation, generatedExecution: false, modelProcessing: false,
    } };
  }
}
