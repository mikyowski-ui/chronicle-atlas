import test from 'node:test';
import assert from 'node:assert/strict';
import { ResearchController } from '../../../apps/explorer/src/research/workspace-controller.ts';

const file = (text = 'id,label,startYear,endYear,longitude,latitude\nsynthetic-1,Synthetic intake fixture,1769,1769,0,0\n') => {
  const bytes = new TextEncoder().encode(text); return { name: 'synthetic.csv', size: bytes.length, async arrayBuffer() { return bytes.buffer; } };
};
test('imported evidence participates in the shared revision, cursor, selection and reference-only replay store', async () => {
  const controller = new ResearchController(1769); assert.equal(await controller.importEvidence(file()), true);
  const state = controller.getSnapshot(), record = state.imported!.bundle.records[0];
  assert.equal(state.active, null); assert.equal(state.mechanism, null);
  assert.equal(controller.dispatch({ type: 'select', entityId: record.entityId, observationId: record.id, origin: 'test', revision: state.revision }), true);
  controller.dispatch({ type: 'cursor', year: 1800, origin: 'test', revision: state.revision });
  const saved = controller.exportManifest(); assert.equal(saved.includes('Synthetic intake fixture'), false);
  controller.close(); assert.equal(await controller.replay(saved), true); assert.equal(controller.exportManifest(), saved);
  assert.equal(controller.getSnapshot().cursorYear, 1800); assert.equal(controller.getSnapshot().selection!.observationId, record.id);
  assert.equal(await controller.importEvidence(file('id,label\nbad,"broken')), false);
  assert.equal(controller.getSnapshot().imported!.bundle.resultHash, state.imported!.bundle.resultHash);
  controller.dispose(); assert.equal(controller.getDiagnostics().listeners, 0);
});
test('late file reads cannot replace a newer import and a missing cache never silently refetches replay evidence', async () => {
  const controller = new ResearchController(1769); let finish!: (value: ArrayBuffer) => void;
  const stale = controller.importEvidence({ ...file(), arrayBuffer: () => new Promise<ArrayBuffer>(resolve => { finish = resolve; }) });
  const next = file('id,label\nsynthetic-new,Synthetic newer fixture\n'); assert.equal(await controller.importEvidence(next), true);
  finish(await file().arrayBuffer()); assert.equal(await stale, false);
  assert.equal(controller.getSnapshot().imported!.bundle.records[0].label, 'Synthetic newer fixture');
  const saved = controller.exportManifest(), fresh = new ResearchController(1769);
  assert.equal(await fresh.replay(saved), false); assert.equal(fresh.getSnapshot().imported, null);
  controller.dispose(); fresh.dispose();
});
