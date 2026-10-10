import { boundedJSON } from '@chronicle/contracts/canonical';
import { validateRenderInput, VisualizationError, VisualizationWireResultSchema, VISUALIZATION_LIMITS, VISUALIZATION_RUNTIME, type VisualizationResult, type RenderFailureCode } from '@chronicle/contracts/visualization';
import type { ResolvedEvidenceBundle } from '@chronicle/contracts/evidence';
import { parseSafeSVG, serializeSafeSVG } from '@chronicle/runtime/visualization-output';

export class VisualizationClient {
  private active: { cancel(): void } | null = null;
  private disposed = false;
  private launches = 0;
  private terminations = 0;
  constructor(private readonly createWorker: () => Worker = () => new Worker(new URL('./visualization-worker.ts', import.meta.url), { type: 'module', name: 'chronicle-bounded-visualization' })) {}
  execute(input: unknown, bundle: ResolvedEvidenceBundle, signal?: AbortSignal): Promise<VisualizationResult> {
    this.cancel();
    if (this.disposed || signal?.aborted) return Promise.resolve({ status: 'fallback', code: 'CANCELLED', elapsedMs: 0 });
    let checked: ReturnType<typeof validateRenderInput>;
    try { checked = validateRenderInput(input, bundle); } catch (error) { return Promise.resolve({ status: 'fallback', code: error instanceof VisualizationError ? error.code : 'INVALID_SPEC', elapsedMs: 0 }); }
    return new Promise(resolve => {
      let worker: Worker;
      try { worker = this.createWorker(); this.launches++; } catch { resolve({ status: 'fallback', code: 'RUNTIME_UNAVAILABLE', elapsedMs: 0 }); return; }
      let done = false, started: number | null = null, timer: ReturnType<typeof setTimeout>;
      const elapsed = () => started === null ? 0 : performance.now() - started;
      const finish = (result: VisualizationResult) => {
        if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
        worker.onmessage = null; worker.onerror = null; worker.terminate(); this.terminations++;
        if (this.active === job) this.active = null; resolve(result);
      };
      const fail = (code: RenderFailureCode) => finish({ status: 'fallback', code, elapsedMs: elapsed() });
      const abort = () => fail('CANCELLED'), job = { cancel: abort }; this.active = job;
      signal?.addEventListener('abort', abort, { once: true }); timer = setTimeout(() => fail('RUNTIME_UNAVAILABLE'), 5000);
      worker.onerror = event => { event.preventDefault(); fail('RUNTIME_UNAVAILABLE'); };
      worker.onmessage = event => {
        try {
          const message = boundedJSON(event.data, { bytes: 131072, depth: 8, nodes: 3000 }) as Record<string, unknown>;
          if (message.type === 'ready' && message.runtime === VISUALIZATION_RUNTIME && Object.keys(message).length === 2 && started === null) {
            clearTimeout(timer); started = performance.now(); timer = setTimeout(() => fail('TIMEOUT'), VISUALIZATION_LIMITS.executionMs);
            worker.postMessage({ type: 'evaluate', specification: checked.specification, bundle: { records: checked.records, resultHash: checked.specification.bundleHash } }); return;
          }
          if (message.type !== 'result' || Object.keys(message).length !== 2) return fail('INVALID_OUTPUT');
          const result = VisualizationWireResultSchema.parse(message.result);
          if (result.status === 'fallback') return finish(result);
          if (started === null || elapsed() > VISUALIZATION_LIMITS.executionMs) return fail('TIMEOUT');
          if (result.programHash !== checked.specification.programHash || result.inputHash !== checked.specification.inputHash || result.bundleHash !== checked.specification.bundleHash) return fail('BINDING_MISMATCH');
          const tree = parseSafeSVG(result.svg, checked.records, checked.specification.width, checked.specification.height);
          if (serializeSafeSVG(tree) !== result.svg) return fail('INVALID_OUTPUT');
          if (elapsed() > VISUALIZATION_LIMITS.executionMs) return fail('TIMEOUT');
          finish({ ...result, tree, elapsedMs: Math.max(result.elapsedMs, elapsed()) });
        } catch { fail('INVALID_OUTPUT'); }
      };
      if (signal?.aborted) abort();
    });
  }
  cancel(): void { this.active?.cancel(); }
  dispose(): void { this.disposed = true; this.cancel(); }
  diagnostics() { return { activeWorkers: this.active ? 1 : 0, launches: this.launches, terminations: this.terminations, disposed: this.disposed }; }
}
