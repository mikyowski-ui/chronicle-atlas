import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StreamingLifecycle } from '../src/streaming-lifecycle.ts';
function ready(lifecycle: StreamingLifecycle, token: ReturnType<StreamingLifecycle['begin']>) {
  assert.equal(lifecycle.frame(token, true), false);
  assert.equal(lifecycle.frame(token, true), true);
}
test('native staging requires two complete hydrated viewport frames', () => {
  const lifecycle = new StreamingLifecycle(), token = lifecycle.begin(1);
  assert.equal(lifecycle.frame(token, false), false);
  assert.equal(lifecycle.frame(token, true), false);
  assert.equal(lifecycle.frame(token, false), false);
  assert.throws(() => lifecycle.commit(token), { name: 'AbortError' });
  ready(lifecycle, token); lifecycle.commit(token);
  assert.equal(lifecycle.generation, 1);
  assert.equal(lifecycle.pendingGeneration, null);
});
test('a viewport move invalidates readiness even after source hydration resolved', () => {
  const lifecycle = new StreamingLifecycle(), token = lifecycle.begin(4);
  ready(lifecycle, token); lifecycle.moveCamera();
  assert.equal(lifecycle.ready(token), false);
  assert.throws(() => lifecycle.commit(token), { name: 'AbortError' });
  ready(lifecycle, token); lifecycle.commit(token);
  assert.equal(lifecycle.cameraRevision, 1);
});
test('950 → 1050 → 1049 reversals cannot commit late tile readiness', () => {
  const lifecycle = new StreamingLifecycle(), initial = lifecycle.begin(1);
  ready(lifecycle, initial); lifecycle.commit(initial);
  const late1050 = lifecycle.begin(2), latest1049 = lifecycle.begin(3);
  assert.equal(lifecycle.frame(late1050, true), false);
  assert.equal(lifecycle.frame(late1050, true), false);
  assert.throws(() => lifecycle.commit(late1050), { name: 'AbortError' });
  assert.equal(lifecycle.generation, 1);
  ready(lifecycle, latest1049); lifecycle.commit(latest1049);
  assert.equal(lifecycle.generation, 3);
  assert.throws(() => lifecycle.begin(2), { name: 'AbortError' });
});
test('hundreds of stale completions and cancellations preserve the latest generation', () => {
  const lifecycle = new StreamingLifecycle();
  for (let generation = 1; generation <= 300; generation += 3) {
    const cancelled = lifecycle.begin(generation);
    ready(lifecycle, cancelled); lifecycle.cancel(cancelled);
    assert.throws(() => lifecycle.commit(cancelled), { name: 'AbortError' });
    const superseded = lifecycle.begin(generation + 1), current = lifecycle.begin(generation + 2);
    lifecycle.cancel(superseded);
    assert.equal(lifecycle.pendingGeneration, generation + 2);
    assert.equal(lifecycle.frame(superseded, true), false);
    ready(lifecycle, current); lifecycle.commit(current);
  }
  assert.equal(lifecycle.generation, 300);
});

test('continuous camera pan can commit after two hydrated frames with unchanged tile coverage', () => {
  const lifecycle = new StreamingLifecycle(), token = lifecycle.begin(8);
  const coverage = 'zoom4:7/4,7/5,8/4,8/5';
  assert.equal(lifecycle.coveredFrame(token, true, coverage), false);
  for (let i = 0; i < 20; i++) lifecycle.moveCamera();
  assert.equal(lifecycle.ready(token), false);
  assert.equal(token.coveredFrames, 1);
  assert.equal(lifecycle.coveredFrame(token, true, coverage), true);
  assert.equal(token.cameraRevision, lifecycle.cameraRevision);
  lifecycle.commit(token);
  assert.equal(lifecycle.generation, 8);
});

test('changed viewport tile coverage and incomplete hydration restart consecutive covered frames', () => {
  const lifecycle = new StreamingLifecycle(), token = lifecycle.begin(9);
  assert.equal(lifecycle.coveredFrame(token, true, 'zoom4:7/4'), false);
  lifecycle.moveCamera();
  assert.equal(lifecycle.coveredFrame(token, true, 'zoom4:8/4'), false);
  assert.throws(() => lifecycle.commit(token), { name: 'AbortError' });
  assert.equal(lifecycle.coveredFrame(token, false, 'zoom4:8/4'), false);
  assert.equal(lifecycle.coveredFrame(token, true, 'zoom4:8/4'), false);
  assert.equal(lifecycle.coveredFrame(token, true, 'zoom4:8/4'), true);
  lifecycle.moveCamera();
  assert.equal(lifecycle.ready(token), false);
  assert.throws(() => lifecycle.commit(token), { name: 'AbortError' });
  assert.equal(lifecycle.coveredFrame(token, true, 'zoom5:16/8'), false);
  assert.equal(lifecycle.coveredFrame(token, true, 'zoom5:16/8'), true);
  lifecycle.commit(token);
});

test('stale and cancelled covered frames cannot mutate or commit the current generation', () => {
  const lifecycle = new StreamingLifecycle(), stale = lifecycle.begin(10);
  lifecycle.coveredFrame(stale, true, 'a');
  const latest = lifecycle.begin(11);
  lifecycle.moveCamera();
  const previousStale = { ...stale };
  assert.equal(lifecycle.coveredFrame(stale, true, 'a'), false);
  assert.deepEqual(stale, previousStale);
  assert.throws(() => lifecycle.commit(stale), { name: 'AbortError' });
  assert.equal(lifecycle.coveredFrame(latest, true, 'a'), false);
  assert.equal(lifecycle.coveredFrame(latest, true, 'a'), true);
  lifecycle.cancel(latest);
  assert.equal(lifecycle.coveredFrame(latest, true, 'a'), false);
  assert.throws(() => lifecycle.commit(latest), { name: 'AbortError' });
  assert.equal(lifecycle.generation, -1);
});

test('coverage mode never reuses a missing key or readiness interrupted by legacy hydration', () => {
  const lifecycle = new StreamingLifecycle(), token = lifecycle.begin(12);
  assert.equal(lifecycle.coveredFrame(token, true, ''), false);
  assert.equal(lifecycle.coveredFrame(token, true, ''), false);
  assert.equal(lifecycle.coveredFrame(token, true, 'tiles'), false);
  assert.equal(lifecycle.coveredFrame(token, true, 'tiles'), true);
  assert.equal(lifecycle.frame(token, false), false);
  assert.equal(lifecycle.coveredFrame(token, true, 'tiles'), false);
  assert.equal(lifecycle.coveredFrame(token, true, 'tiles'), true);
  lifecycle.commit(token);
});
