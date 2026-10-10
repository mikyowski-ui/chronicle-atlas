import test from 'node:test';
import assert from 'node:assert/strict';
import { InteractionRuntime, type InteractionState } from '../src/interaction.ts';

type State = InteractionState & { active: string | null };
const initial = (): State => ({ revision: 0, pendingRevision: 0, status: 'idle', message: '', errorCode: null, cursorYear: 1769, selection: null, active: null });
const create = () => new InteractionRuntime(initial(), { hasResult: state => state.active !== null, clear: () => ({ active: null }), acceptsSelection: (state, action) => action.entityId === state.active && action.observationId === 'claim-1' });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const commit = (active: string, revision: number): Partial<State> => ({ active, revision, status: 'ready', message: '', errorCode: null });

test('shared interaction runtime commits only the newest prepared result', async () => {
  const runtime = create(), first = deferred<string>();
  const old = runtime.stage(() => first.promise, commit);
  assert.equal(await runtime.stage(async () => 'second', commit), true);
  first.resolve('first'); assert.equal(await old, false);
  assert.equal(runtime.getSnapshot().active, 'second'); assert.equal(runtime.getDiagnostics().commits, 1);
  runtime.dispose(); assert.equal(runtime.getDiagnostics().listeners, 0);
});

test('shared actions reject stale revisions, undeclared selections and echoed actions', async () => {
  const runtime = create(); await runtime.stage(async () => 'component', commit);
  const revision = runtime.getSnapshot().revision;
  assert.equal(runtime.dispatch({ type: 'select', entityId: 'other', observationId: 'claim-1', origin: 'table', revision }), false);
  assert.equal(runtime.dispatch({ type: 'select', entityId: 'component', observationId: 'claim-1', origin: 'table', revision: revision - 1 }), false);
  const action = { type: 'select' as const, entityId: 'component', observationId: 'claim-1', origin: 'table', revision };
  assert.equal(runtime.dispatch(action), true); assert.equal(runtime.dispatch(action), false);
  assert.equal(runtime.dispatch({ type: 'cursor', year: 1800, origin: 'timeline', revision }), true);
  assert.deepEqual(runtime.getSnapshot().selection, { entityId: 'component', observationId: 'claim-1' });
  assert.equal(Object.isFrozen(runtime.getSnapshot()), true); runtime.dispose();
});

test('failed rendering restores prior immutable state and does not increase commits', async () => {
  const runtime = create(); await runtime.stage(async () => 'valid', commit);
  const before = runtime.getSnapshot();
  runtime.subscribe(state => { if (state.active === 'rejected') throw Error('renderer unavailable'); });
  assert.equal(await runtime.stage(async () => 'rejected', commit), false);
  assert.equal(runtime.getSnapshot().active, before.active); assert.equal(runtime.getSnapshot().revision, before.revision);
  assert.equal(runtime.getSnapshot().errorCode, 'RENDER_FAILED'); assert.equal(runtime.getDiagnostics().commits, 1);
  runtime.dispose();
});

test('cancellation and disposal suppress late result activation', async () => {
  const runtime = create(), gate = deferred<string>();
  const pending = runtime.stage(() => gate.promise, commit); runtime.cancel(); gate.resolve('late');
  assert.equal(await pending, false); assert.equal(runtime.getSnapshot().active, null);
  runtime.dispose(); assert.equal(await runtime.stage(async () => 'ignored', commit), false);
});
