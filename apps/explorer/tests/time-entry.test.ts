import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatNavigationDate, parseNavigationDate } from '../src/time-entry.ts';

test('exact navigation days preserve same-year changes and the BCE/CE boundary without year zero', () => {
  const a = parseNavigationDate('1050-01-01 CE')!;
  assert.equal(parseNavigationDate('1050-02-01 CE'), a + 31);
  assert.equal(formatNavigationDate(a + 31), '1050-02-01 CE');
  const b = parseNavigationDate('1-12-31 BCE')!;
  assert.equal(formatNavigationDate(b + 1), '1-01-01 CE');
  assert.equal(formatNavigationDate(b + .9), '1-12-31 BCE');
  for (const invalid of ['0-01-01 CE', '1050-02-29 CE', '1050-13-01 CE', '1050', 'Infinity-01-01 CE']) assert.equal(parseNavigationDate(invalid), null);
});
