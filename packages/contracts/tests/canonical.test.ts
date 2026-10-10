import test from 'node:test';
import assert from 'node:assert/strict';
import { boundedJSON, canonicalJSON, hashText } from '../src/canonical.ts';
import { dayToYear, yearToDay } from '../src/chronology.ts';

test('canonical identity is stable across property order and bounded input rejects accessors', () => {
  assert.equal(hashText(canonicalJSON({ b: 2, a: 1 })), hashText(canonicalJSON({ a: 1, b: 2 })));
  let reads = 0;
  assert.throws(() => boundedJSON({ get value() { reads++; return 1; } }, { bytes: 1000, depth: 10, nodes: 100 }));
  assert.equal(reads, 0);
});
test('chronology preserves astronomical year zero and years below 100 without Date constructor coercion', () => {
  for (const year of [-12000, -44, -1, 0, 1, 99, 1769, 2025, 3000]) assert.equal(dayToYear(yearToDay(year)), year);
  assert.equal(yearToDay(1970), 0); assert.throws(() => yearToDay(1.5)); assert.throws(() => dayToYear(Number.NaN));
});
