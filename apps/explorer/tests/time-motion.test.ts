import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TimeMotion, type MotionSeekOutcome } from '../src/time-motion.ts';
import { TemporalController, type SceneData } from '../src/temporal.ts';
import type { TemporalManifest } from '../../../packages/contracts/src/index.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const committed = (time: number): MotionSeekOutcome => ({ status: 'committed', scene: { time } });
const options = { initialTime: 0, minTime: -1_000, maxTime: 1_000, changeTimes: [-100, 0, 100], initialCommittedTime: 0 };

test('canonical seekTime keeps exact days, validates bounds, and floors negative presentation days', async () => {
  const delivered: number[] = [];
  const motion = new TimeMotion({ ...options, deliver: async time => { delivered.push(time); return committed(time); } });
  assert.throws(() => motion.seekTime(10.25), /integer day/);
  assert.throws(() => motion.seekTime(1_001), /bounds/);
  const request = motion.scrub(-2.25);
  assert.equal(motion.snapshot.cursorTime, -2.25);
  assert.equal(motion.snapshot.requestedTime, -3);
  assert.equal(motion.snapshot.committedTime, 0);
  assert.deepEqual(delivered, []);
  motion.tick(0);
  assert.equal((await request).status, 'committed');
  assert.deepEqual(delivered, [-3]);
  assert.equal(motion.snapshot.committedTime, -3);
  assert.equal(motion.snapshot.cursorTime, -2.25);
});

test('free scrub replaces queued targets before a frame and settles superseded promises', async () => {
  const delivered: number[] = [];
  const motion = new TimeMotion({ ...options, deliver: async time => { delivered.push(time); return committed(time); } });
  const first = motion.seekTime(99);
  const second = motion.seekTime(101);
  const latest = motion.seekTime(98);
  assert.deepEqual([await first, await second], [{ status: 'stale' }, { status: 'stale' }]);
  assert.equal(motion.snapshot.requestedTime, 98);
  assert.equal(motion.snapshot.cursorTime, 98);
  assert.equal(motion.snapshot.committedTime, 0);
  assert.deepEqual(delivered, []);
  motion.tick(16);
  await latest;
  assert.deepEqual(delivered, [98]);
  assert.equal(motion.snapshot.coalescedRequests, 2);
  assert.equal(motion.snapshot.deliveredRequests, 1);
});

test('reverse input invalidates in-flight delivery immediately and late completion never drags the cursor back', async () => {
  const late = deferred<MotionSeekOutcome>();
  let invalidations = 0;
  const motion = new TimeMotion({ ...options, invalidatePending: () => { invalidations++; },
    deliver: time => time === 100 ? late.promise : Promise.resolve(committed(time)) });
  const crossing = motion.seekTime(100);
  motion.tick(0);
  const reversing = motion.seekTime(99);
  assert.equal(invalidations, 1, 'The renderer is invalidated before another animation frame.');
  assert.equal((await crossing).status, 'stale');
  motion.tick(16);
  await reversing;
  late.resolve(committed(100));
  await Promise.resolve();
  assert.equal(motion.snapshot.cursorTime, 99);
  assert.equal(motion.snapshot.requestedTime, 99);
  assert.equal(motion.snapshot.committedTime, 99);
  assert.equal(motion.snapshot.pending, false);
  assert.equal(motion.snapshot.supersededRequests, 1);
});

test('reversing to the already committed day cancels pending work without redundant delivery', async () => {
  const late = deferred<MotionSeekOutcome>();
  let invalidations = 0;
  const motion = new TimeMotion({ ...options, invalidatePending: () => { invalidations++; }, deliver: () => late.promise });
  const crossing = motion.seekTime(100);
  motion.tick(0);
  assert.equal((await motion.seekTime(0)).status, 'committed');
  assert.equal((await crossing).status, 'stale');
  assert.equal(motion.snapshot.pending, false);
  assert.equal(motion.snapshot.deliveredRequests, 1);
  assert.equal(invalidations, 1);
  late.resolve(committed(100));
  await Promise.resolve();
  assert.equal(motion.snapshot.committedTime, 0);
});

test('continuous playback commits every ordered same-year change and interval end without skipping during slow delivery', async () => {
  const date = new Date(0);
  date.setUTCFullYear(1050, 0, 1);
  const start = date.valueOf() / 86_400_000;
  const delivered: number[] = [];
  const slowBoundary = deferred<MotionSeekOutcome>();
  const motion = new TimeMotion({ initialTime: start, initialCommittedTime: start, minTime: start, maxTime: start + 50,
    // +10 is the end of one observation; +20 starts the next, leaving an explicit gap.
    changeTimes: [start, start + 5, start + 10, start + 20], observationTimes: [start, start + 5, start + 20], daysPerSecond: 100,
    deliver: time => { delivered.push(time); return time === start + 5 ? slowBoundary.promise : Promise.resolve(committed(time)); } });
  motion.setPlaying(true);
  motion.tick(0);
  motion.tick(1_000);
  assert.deepEqual(delivered, [start + 5], 'A long frame stops at the first exact boundary in 1050.');
  assert.equal(motion.snapshot.cursorTime, start + 5);
  assert.equal(motion.snapshot.committedTime, start);
  motion.tick(1_500);
  motion.tick(2_000);
  assert.deepEqual(delivered, [start + 5]);
  slowBoundary.resolve(committed(start + 5));
  await Promise.resolve();
  motion.tick(2_001); // Reset origin after slow delivery; no accumulated time jump.
  assert.deepEqual(delivered, [start + 5]);
  motion.tick(3_001);
  await Promise.resolve();
  assert.deepEqual(delivered, [start + 5, start + 10], 'The gap starts at the exact interval end.');
  motion.tick(3_002);
  motion.tick(4_002);
  await Promise.resolve();
  assert.deepEqual(delivered, [start + 5, start + 10, start + 20]);
});

test('continuous clock follows animation elapsed time while the observation tour is an explicit separate mode', async () => {
  const delivered: number[] = [];
  const motion = new TimeMotion({ ...options, daysPerSecond: 2, tourIntervalMs: 500, observationTimes: [0, 100, 200],
    deliver: async time => { delivered.push(time); return committed(time); } });
  motion.setPlaying(true);
  motion.tick(0);
  motion.tick(250);
  assert.equal(motion.snapshot.cursorTime, 0.5);
  assert.equal(motion.snapshot.requestedTime, 0);
  assert.deepEqual(delivered, []);
  motion.tick(500);
  await Promise.resolve();
  assert.deepEqual(delivered, [1]);
  motion.setMode('observation-tour');
  motion.tick(1_000);
  motion.tick(1_499);
  assert.equal(motion.snapshot.cursorTime, 1);
  motion.tick(1_500);
  await Promise.resolve();
  assert.deepEqual(delivered, [1, 100]);
  assert.equal(motion.snapshot.mode, 'observation-tour');
});

test('instant deliveries preserve the declared continuous rate at both 30 Hz and 60 Hz', async () => {
  const run = async (frames: number) => {
    const motion = new TimeMotion({ ...options, changeTimes: [], daysPerSecond: 30,
      deliver: async time => committed(time) });
    motion.setPlaying(true);
    motion.tick(0);
    for (let frame = 1; frame <= frames; frame++) {
      motion.tick(frame * 1_000 / frames);
      await Promise.resolve();
    }
    return motion.snapshot;
  };
  const thirty = await run(30), sixty = await run(60);
  assert.ok(Math.abs(thirty.cursorTime - 30) < 1e-9, `30 Hz advanced ${thirty.cursorTime} days.`);
  assert.ok(Math.abs(sixty.cursorTime - 30) < 1e-9, `60 Hz advanced ${sixty.cursorTime} days.`);
  assert.ok(Math.abs(thirty.cursorTime - sixty.cursorTime) < 1e-9);
});

test('actual TemporalController rejects an old completion after reverse input but before the next animation frame', async () => {
  const manifest: TemporalManifest = { schema_version: 1, fixture_kind: 'synthetic', edition: 'motion-test-v1', initial_time: 0,
    epochs: [
      { epoch_id: 'a', t_start: 0, t_end: 100, url: 'a.pmtiles', sha256: 'a'.repeat(64), byte_length: 127, layers: ['territories'], tile: [0, 0, 0] },
      { epoch_id: 'b', t_start: 100, t_end: 200, url: 'b.pmtiles', sha256: 'b'.repeat(64), byte_length: 127, layers: ['territories'], tile: [0, 0, 0] },
    ] };
  const data = (epoch_id: string): SceneData => ({ epoch_id, edition: manifest.edition, territories: [], population: [], migration: [] });
  const lateB = deferred<SceneData>();
  const visibleCommits: number[] = [];
  const controller = new TemporalController(manifest,
    { prepare: async () => () => undefined, onCommit: scene => { visibleCommits.push(scene.time); } },
    async epoch => epoch.epoch_id === 'b' ? lateB.promise : data(epoch.epoch_id));
  await controller.seek(0);
  const motion = new TimeMotion({ initialTime: 0, initialCommittedTime: 0, minTime: 0, maxTime: 199, changeTimes: [0, 100],
    deliver: time => controller.seek(time), invalidatePending: () => controller.invalidatePending() });
  const crossing = motion.seekTime(100);
  motion.tick(0);
  const reversing = motion.seekTime(99);
  assert.equal((await crossing).status, 'stale');
  lateB.resolve(data('b'));
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(visibleCommits, [0], 'Old scene cannot commit in the input-to-frame coalescing window.');
  assert.equal(controller.current!.time, 0);
  motion.tick(16);
  await reversing;
  assert.deepEqual(visibleCommits, [0, 99]);
  assert.equal(controller.current!.time, 99);
});

test('background resume and speed changes reset the timestamp origin instead of advancing across suspended time', async () => {
  const motion = new TimeMotion({ ...options, daysPerSecond: 1, deliver: async time => committed(time) });
  motion.setPlaying(true);
  motion.tick(0);
  motion.tick(250);
  assert.equal(motion.snapshot.cursorTime, 0.25);
  motion.suspend();
  motion.tick(60_000);
  motion.resume();
  motion.tick(3_600_000);
  assert.equal(motion.snapshot.cursorTime, 0.25);
  motion.tick(3_600_250);
  assert.equal(motion.snapshot.cursorTime, 0.5);
  motion.setRate(2);
  motion.tick(7_200_000);
  assert.equal(motion.snapshot.cursorTime, 0.5);
  motion.tick(7_200_250);
  await Promise.resolve();
  assert.equal(motion.snapshot.cursorTime, 1);
});

test('delivery failure pauses playback and cannot relabel the last committed scene', async () => {
  const failure = new Error('Delivery unavailable');
  const motion = new TimeMotion({ ...options, deliver: async () => { throw failure; } });
  motion.setPlaying(true);
  const request = motion.seekTime(1);
  motion.tick(0);
  assert.deepEqual(await request, { status: 'error', error: failure });
  assert.equal(motion.snapshot.isPlaying, false);
  assert.equal(motion.snapshot.committedTime, 0);
  assert.equal(motion.snapshot.requestedTime, 1);
  assert.equal(motion.snapshot.error, failure);
});

test('resuming after a failed boundary retries that exact day before advancing, including the final day', async () => {
  for (const failedBoundary of [5, 10]) {
    const delivered: number[] = [];
    const motion = new TimeMotion({ initialTime: 0, initialCommittedTime: 0, minTime: 0, maxTime: 10,
      changeTimes: [failedBoundary], daysPerSecond: 100,
      deliver: async time => {
        delivered.push(time);
        if (delivered.length === 1) throw new Error('Temporary delivery failure');
        return committed(time);
      } });
    motion.setPlaying(true);
    motion.tick(0);
    motion.tick(1_000);
    await Promise.resolve();
    assert.equal(motion.snapshot.isPlaying, false);
    assert.equal(motion.snapshot.committedTime, 0);
    motion.setPlaying(true);
    motion.tick(2_000);
    await Promise.resolve();
    assert.deepEqual(delivered, [failedBoundary, failedBoundary]);
    assert.equal(motion.snapshot.committedTime, failedBoundary);
    assert.equal(motion.snapshot.error, null);
  }
});

test('mismatched committed times fail closed, and disposal settles queued or pending callers', async () => {
  const wrong = new TimeMotion({ ...options, deliver: async time => committed(time + 1) });
  const request = wrong.seekTime(1);
  wrong.tick(0);
  assert.equal((await request).status, 'error');
  assert.equal(wrong.snapshot.committedTime, 0);
  const late = deferred<MotionSeekOutcome>();
  let invalidations = 0;
  const motion = new TimeMotion({ ...options, deliver: () => late.promise, invalidatePending: () => { invalidations++; } });
  const pending = motion.seekTime(2);
  motion.tick(0);
  motion.dispose();
  assert.equal((await pending).status, 'stale');
  assert.equal(invalidations, 1);
  late.resolve(committed(2));
  await Promise.resolve();
  assert.equal(motion.snapshot.committedTime, 0);
  assert.equal((await motion.seekTime(3)).status, 'stale');
});

test('semantic presentation acceptance advances canonical time without delivery or pending generation', async () => {
  const delivered: number[] = [], advanced: number[] = [];
  const motion = new TimeMotion({ ...options, tryAdvance: time => { advanced.push(time); return true; },
    deliver: async time => { delivered.push(time); return committed(time); } });
  const request = motion.seekTime(1); motion.tick(0);
  assert.equal((await request).status, 'committed');
  assert.deepEqual(advanced, [1]); assert.deepEqual(delivered, []);
  assert.equal(motion.snapshot.committedTime, 1); assert.equal(motion.snapshot.pending, false);
  assert.equal(motion.snapshot.presentationAdvances, 1); assert.equal(motion.snapshot.deliveredRequests, 0);
});

test('forced same-time refresh bypasses both committed-time and semantic fast paths', async () => {
  const delivered: number[] = []; let fastPaths = 0;
  const motion = new TimeMotion({ ...options, tryAdvance: () => { fastPaths++; return true; },
    deliver: async time => { delivered.push(time); return committed(time); } });
  assert.equal((await motion.seekTime(0)).status, 'committed');
  const refresh = motion.seekTime(0, { force: true });
  assert.equal(motion.snapshot.pending, true); motion.tick(0);
  assert.equal((await refresh).status, 'committed');
  assert.deepEqual(delivered, [0]); assert.equal(fastPaths, 0);
  assert.equal(motion.snapshot.deliveredRequests, 1); assert.equal(motion.snapshot.presentationAdvances, 0);
});

test('a semantic fast-path exception settles the request and pauses without relabeling the scene', async () => {
  const failure = new Error('Semantic resolution unavailable'); let deliveries = 0;
  const motion = new TimeMotion({ ...options, tryAdvance: () => { throw failure; }, deliver: async time => { deliveries++; return committed(time); } });
  motion.setPlaying(true); const request = motion.seekTime(1);
  assert.doesNotThrow(() => motion.tick(0));
  assert.deepEqual(await request, { status: 'error', error: failure });
  assert.equal(motion.snapshot.pending, false); assert.equal(motion.snapshot.isPlaying, false);
  assert.equal(motion.snapshot.committedTime, 0); assert.equal(motion.snapshot.error, failure); assert.equal(deliveries, 0);
});

test('continuous presentation fast paths still stop and deliver each changed semantic boundary', async () => {
  const delivered: number[] = [], advanced: number[] = [];
  const motion = new TimeMotion({ ...options, changeTimes: [5, 10], daysPerSecond: 100,
    tryAdvance: time => { advanced.push(time); return time !== 5 && time !== 10; },
    deliver: async time => { delivered.push(time); return committed(time); } });
  motion.setPlaying(true); motion.tick(0); motion.tick(20);
  assert.equal(motion.snapshot.committedTime, 2);
  motion.tick(1000); await Promise.resolve();
  assert.equal(motion.snapshot.committedTime, 5);
  motion.tick(2000); await Promise.resolve();
  assert.equal(motion.snapshot.committedTime, 10);
  assert.deepEqual(delivered, [5, 10]); assert.deepEqual(advanced, [2, 5, 10]);
});
