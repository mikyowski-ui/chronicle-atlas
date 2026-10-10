import test from 'node:test';
import assert from 'node:assert/strict';
import { FileDropAdapter } from '@chronicle/planner/files';
import { EvidenceSourceRegistry, GroundedEvidencePlanner } from '@chronicle/planner/evidence';
import { createRenderSpecification, VISUALIZATION_RUNTIME, type VisualizationResult } from '@chronicle/contracts/visualization';
import { initializeVisualization, evaluateVisualization } from '@chronicle/runtime/visualization';
import { VisualizationClient } from '../src/visualization-client.ts';
import { preparedRenderSpecification } from '../src/visualization.ts';

function fixture() {
  const files = new FileDropAdapter(), sources = new EvidenceSourceRegistry(); sources.register(files);
  return new GroundedEvidencePlanner(sources).fromRecords({ question: '', sourceIds: [files.id], bounds: null, temporalRange: null }, files.ingest('synthetic.csv', 'id,label\nsynthetic-a,"Synthetic & quoted ""record"""\n'));
}
class SupervisorFixture {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  constructor(private readonly respond: boolean, private readonly forged = false) { queueMicrotask(() => this.onmessage?.({ data: { type: 'ready', runtime: VISUALIZATION_RUNTIME } } as MessageEvent)); }
  postMessage(request: { specification: unknown; bundle: Parameters<typeof evaluateVisualization>[1] }) {
    if (!this.respond) return;
    queueMicrotask(() => {
      const result = evaluateVisualization(request.specification, request.bundle);
      let wire: Omit<Extract<VisualizationResult, { status: 'rendered' }>, 'tree'> | Extract<VisualizationResult, { status: 'fallback' }>;
      if (result.status === 'rendered') { const { tree: _, ...output } = result; wire = this.forged ? { ...output, bundleHash: 'c'.repeat(64) } : output; } else wire = result;
      this.onmessage?.({ data: { type: 'result', result: wire } } as MessageEvent);
    });
  }
  terminate() { this.terminated = true; }
}
test('prepared procedural layout preserves escaped source labels in the actual VM', async () => {
  await initializeVisualization(); const result = fixture(), specification = preparedRenderSpecification(result);
  const output = evaluateVisualization(specification, result.bundle); assert.equal(output.status, 'rendered');
  if (output.status === 'rendered') { assert.match(output.svg, /&amp;/); assert.match(output.svg, /&quot;/); }
});
test('supervisor orchestration is latest-wins, rejects forged replies and reclaims every owned worker', async () => {
  await initializeVisualization(); const result = fixture(), specification = preparedRenderSpecification(result), workers: SupervisorFixture[] = [];
  const client = new VisualizationClient(() => { const worker = new SupervisorFixture(true); workers.push(worker); return worker as unknown as Worker; });
  const stale = client.execute(specification, result.bundle), newest = client.execute(specification, result.bundle);
  assert.equal((await stale).status, 'fallback'); assert.equal((await newest).status, 'rendered'); assert.ok(workers.every(worker => worker.terminated)); assert.equal(client.diagnostics().activeWorkers, 0);
  const forged = new VisualizationClient(() => new SupervisorFixture(true, true) as unknown as Worker);
  const denied = await forged.execute(specification, result.bundle); assert.equal(denied.status, 'fallback'); if (denied.status === 'fallback') assert.equal(denied.code, 'BINDING_MISMATCH');
  client.dispose(); forged.dispose(); assert.equal(client.diagnostics().disposed, true);
});
test('supervisor deadline terminates a non-cooperating worker and cancellation prevents activation', async () => {
  const result = fixture(), specification = preparedRenderSpecification(result), workers: SupervisorFixture[] = [];
  const client = new VisualizationClient(() => { const worker = new SupervisorFixture(false); workers.push(worker); return worker as unknown as Worker; });
  const outcome = await client.execute(specification, result.bundle); assert.equal(outcome.status, 'fallback'); if (outcome.status === 'fallback') assert.equal(outcome.code, 'TIMEOUT'); assert.equal(workers[0].terminated, true);
  const pending = client.execute(createRenderSpecification(result.bundle, 'for (;;) {}'), result.bundle); client.cancel(); const cancelled = await pending;
  assert.equal(cancelled.status, 'fallback'); if (cancelled.status === 'fallback') assert.equal(cancelled.code, 'CANCELLED'); assert.equal(client.diagnostics().activeWorkers, 0); client.dispose();
});
