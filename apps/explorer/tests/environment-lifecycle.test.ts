import assert from 'node:assert/strict';
import test from 'node:test';
import { ReducedMotionPreference, type MotionPreferenceSource } from '../src/reduced-motion.ts';
import { StyleReloadLifecycle, type StyleReloadEvents } from '../src/style-reload-lifecycle.ts';
import { DetailCanvas } from '../src/detail-canvas.ts';
import type { DetailFrame } from '../src/detail-context.ts';

class PreferenceFixture implements MotionPreferenceSource {
  value = false;
  readonly listeners = new Set<(reduced: boolean) => void>();
  current(): boolean { return this.value; }
  subscribe(listener: (reduced: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  change(value: boolean): void {
    this.value = value;
    for (const listener of this.listeners) listener(value);
  }
}

class StyleFixture implements StyleReloadEvents {
  readonly listeners = new Set<() => void>();
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  loaded(): void { for (const listener of this.listeners) listener(); }
}

test('reduced-motion source changes complete animations without listener growth', () => {
  const source = new PreferenceFixture(), policy = new ReducedMotionPreference(source), updates: boolean[] = [];
  const unsubscribe = policy.subscribe(reduced => updates.push(reduced));
  assert.equal(source.listeners.size, 1);
  assert.equal(policy.duration(180), 180);
  source.change(true);
  assert.equal(policy.duration(180), 0);
  source.change(true);
  source.change(false);
  assert.deepEqual(updates, [true, false]);
  assert.throws(() => policy.duration(-1), RangeError);
  assert.throws(() => policy.duration(Infinity), RangeError);
  unsubscribe();
  source.change(true);
  assert.deepEqual(updates, [true, false]);
  policy.dispose(); policy.dispose();
  assert.equal(source.listeners.size, 0);
});

test('existing city tween snaps its rendered radius to target on preference change and schedules no further tween', t => {
  const source = new PreferenceFixture();
  let draws = 0, now = 0, scheduled = 0;
  t.mock.method(performance, 'now', () => now);
  const previousRaf = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame');
  Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: (_callback: FrameRequestCallback) => ++scheduled });
  t.after(() => {
    if (previousRaf) Object.defineProperty(globalThis, 'requestAnimationFrame', previousRaf);
    else Reflect.deleteProperty(globalThis, 'requestAnimationFrame');
  });
  const radii: number[] = [];
  const context = {
    save() {}, restore() {}, beginPath() {}, fill() {}, stroke() {}, strokeText() {}, fillText() {},
    arc(_x: number, _y: number, radius: number) { radii.push(radius); },
    measureText: (text: string) => ({ width: text.length * 6 }),
  } as unknown as CanvasRenderingContext2D;
  const painter = new DetailCanvas(() => { draws++; }, source);
  t.after(() => painter.destroy());
  const paint = () => painter.drawOverlay(context, { x: .5, y: .5, scale: 2048 }, 1024, 768);
  const frame = (population: number): DetailFrame => ({
    terrain: null, hydro: null, population: null,
    options: { terrain: false, water: false, cities: true, density: false, modernCities: false },
    requestedYear: 2000, populationLabel: 'Test fixture only',
    places: [{ id: 'synthetic-test-city', title: 'Synthetic test city', coordinates: [0, 0], sourceId: 'fixture', sourceUrl: 'https://example.invalid',
      validFromYear: null, validToYear: null, rank: 1, temporalMode: 'historical-city',
      populationEstimate: { value: population, year: 2000, ageYears: 0, sourceId: 'fixture', stale: false } }],
  });
  painter.setFrame(frame(10_000));
  paint();
  const initialRadius = radii.at(-1)!;
  painter.setFrame(frame(1_000_000));
  now = 45;
  paint();
  const tweenRadius = radii.at(-1)!;
  assert.ok(tweenRadius > initialRadius, 'real Canvas drawing progresses before reduction');
  assert.equal(scheduled, 1, 'ordinary tween requests another frame');
  assert.equal(painter.getDiagnostics().activeCityTweens, 1);
  source.change(true);
  assert.equal(draws, 1);
  assert.equal(painter.getDiagnostics().activeCityTweens, 0);
  paint();
  const reducedRadius = radii.at(-1)!;
  assert.ok(reducedRadius > tweenRadius, 'current tween immediately draws its final radius');
  now = 1000;
  paint();
  assert.equal(radii.at(-1), reducedRadius, 'waiting does not change the reduced-motion rendering');
  painter.setFrame(frame(20_000));
  paint();
  const nextRadius = radii.at(-1)!;
  assert.ok(nextRadius < reducedRadius, 'changed evidence is drawn immediately without retaining the previous visual');
  now = 2000;
  paint();
  assert.equal(radii.at(-1), nextRadius);
  assert.equal(scheduled, 1, 'reduced-motion draws never schedule a tween continuation');
  assert.equal(painter.getDiagnostics().activeCityTweens, 0);
  assert.equal(painter.getDiagnostics().reducedMotion, true);
  painter.destroy();
  assert.equal(source.listeners.size, 0);
  source.change(false);
  assert.equal(draws, 1);
});

test('twenty style reloads restore through one owned listener and disposal removes it', async () => {
  const events = new StyleFixture();
  let restores = 0;
  const failures: Error[] = [];
  const lifecycle = new StyleReloadLifecycle(events, () => { restores++; }, error => failures.push(error));
  for (let i = 0; i < 20; i++) {
    await lifecycle.request(() => events.loaded());
    assert.equal(events.listeners.size, 1);
    assert.equal(lifecycle.diagnostics.pending, false);
  }
  assert.equal(restores, 20);
  assert.deepEqual(failures, []);
  assert.deepEqual(lifecycle.diagnostics, { listeners: 1, events: 20, restorations: 20, failures: 0, pending: false });
  lifecycle.dispose(); lifecycle.dispose(); events.loaded();
  assert.equal(events.listeners.size, 0);
  assert.equal(restores, 20);
  assert.equal(lifecycle.diagnostics.listeners, 0);
});

test('new style intent supersedes pending old request and a late event after disposal cannot restore', async () => {
  const events = new StyleFixture();
  let restores = 0;
  const lifecycle = new StyleReloadLifecycle(events, () => { restores++; }, () => undefined);
  const first = lifecycle.request(() => undefined);
  const superseded = assert.rejects(first, { name: 'AbortError' });
  const second = lifecycle.request(() => undefined);
  events.loaded();
  await Promise.all([superseded, second]);
  assert.equal(restores, 1);
  const third = lifecycle.request(() => undefined);
  const disposed = assert.rejects(third, { name: 'AbortError' });
  lifecycle.dispose(); events.loaded();
  await disposed;
  assert.equal(restores, 1);
  await assert.rejects(lifecycle.request(() => events.loaded()), /disposed/);
});

test('style restore and replacement failures reject without leaking pending state', async () => {
  const events = new StyleFixture(), failures: Error[] = [];
  const lifecycle = new StyleReloadLifecycle(events, () => { throw new Error('Restore fixture failure'); }, error => failures.push(error));
  await assert.rejects(lifecycle.request(() => events.loaded()), /Restore fixture failure/);
  assert.equal(lifecycle.diagnostics.pending, false);
  await assert.rejects(lifecycle.request(() => { throw new Error('Replacement fixture failure'); }), /Replacement fixture failure/);
  assert.equal(lifecycle.diagnostics.pending, false);
  assert.equal(failures.length, 2);
  lifecycle.dispose();
  assert.equal(events.listeners.size, 0);
});

test('style reload timeout is bounded and clears the pending request', async () => {
  const events = new StyleFixture(), failures: Error[] = [];
  const lifecycle = new StyleReloadLifecycle(events, () => undefined, error => failures.push(error));
  await assert.rejects(lifecycle.request(() => undefined, 1), /bounded timeout/);
  assert.equal(lifecycle.diagnostics.pending, false);
  assert.equal(failures.length, 1);
  await assert.rejects(lifecycle.request(() => undefined, 0), RangeError);
  lifecycle.dispose();
  assert.equal(events.listeners.size, 0);
});
