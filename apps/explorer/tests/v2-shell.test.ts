import test from 'node:test';
import assert from 'node:assert/strict';
import { clampJogTime, jogAngleDelta, jogRotationTime, jogWheelTurns } from '../src/v2-shell.ts';

test('jog crosses its angle seam without a century-size jump and reverses symmetrically', () => {
  const a = Math.PI - .01, b = -Math.PI + .01;
  assert.ok(Math.abs(jogAngleDelta(a, b) - .02) < 1e-12);
  const forward = jogRotationTime(100, a, b, 36524.25, -1e6, 1e6);
  const reversed = jogRotationTime(forward, b, a, 36524.25, -1e6, 1e6);
  assert.ok(Math.abs(reversed - 100) < 1e-10);
});

test('jog bounds presentation time without rounding BCE days or extending source validity', () => {
  assert.equal(jogRotationTime(-20.5, 0, Math.PI, 30, -25, 25), -5.5);
  assert.equal(jogRotationTime(20, 0, Math.PI, 30, -25, 25), 25);
  assert.equal(clampJogTime(-100, -25, 25), -25);
  assert.throws(() => clampJogTime(0, 2, 1), RangeError);
  assert.throws(() => jogRotationTime(0, 0, 1, 0, -1, 1), RangeError);
});

test('wheel input bounds pixel, line and page events without accumulating inertia', () => {
  assert.equal(jogWheelTurns(1200), -.25);
  assert.equal(jogWheelTurns(-1200), .25);
  assert.equal(jogWheelTurns(3, 1), -.04);
  assert.equal(jogWheelTurns(1, 2), -.2);
  assert.equal(jogWheelTurns(0), -0);
  assert.throws(() => jogWheelTurns(Infinity), TypeError);
  assert.throws(() => jogAngleDelta(NaN, 0), TypeError);
});
