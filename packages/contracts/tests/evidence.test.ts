import test from 'node:test';
import assert from 'node:assert/strict';
import { makeEvidenceRecord, parseEvidenceRecord, validateEvidenceDashboard } from '../src/evidence.ts';

const input = () => ({
  schemaVersion: 1, id: 'synthetic-record', entityId: 'synthetic-entity', label: 'Synthetic test observation', variable: 'test-count', value: 0, unit: 'items', geometry: null, time: null,
  evidenceType: 'unknown', uncertainty: null, limitations: ['Synthetic test fixture only.'], reviewStatus: 'unreviewed', modelProcessing: false,
  source: { adapterId: 'synthetic-source', recordId: 'record-1', title: 'Synthetic fixture', locator: 'row 1', edition: 'test-v1', contentHash: 'a'.repeat(64) },
});
test('intake records preserve zero, unknown support, provenance and deterministic identity', () => {
  const record = makeEvidenceRecord(input());
  assert.equal(record.value, 0); assert.equal(record.time, null); assert.equal(record.geometry, null);
  assert.deepEqual(parseEvidenceRecord(JSON.stringify(record)), record);
  assert.equal(Object.isFrozen(record.source), true);
  assert.throws(() => parseEvidenceRecord({ ...record, value: 1 }));
  assert.throws(() => makeEvidenceRecord({ ...input(), modelProcessing: true }));
  assert.throws(() => makeEvidenceRecord({ ...input(), reviewStatus: 'scholarly-reviewed' }));
});
test('intake rejects reversed dates, fabricated precision, malformed geometry and accessors', () => {
  assert.throws(() => makeEvidenceRecord({ ...input(), time: { startYear: 3, endYear: 1, precision: 'range', meaning: 'test' } }));
  assert.throws(() => makeEvidenceRecord({ ...input(), time: { startYear: 1, endYear: 3, precision: 'year', meaning: 'test' } }));
  assert.throws(() => makeEvidenceRecord({ ...input(), geometry: { type: 'Point', coordinates: [181, 20] } }));
  let calls = 0; const value = { ...input(), get label() { calls++; return 'unsafe'; } };
  assert.throws(() => makeEvidenceRecord(value)); assert.equal(calls, 0);
  const bce = makeEvidenceRecord({ ...input(), time: { startYear: 0, endYear: 0, precision: 'year', meaning: 'Astronomical year zero is 1 BCE.' } });
  assert.equal(bce.time!.startYear, 0);
});
test('layout proposals can reference only pinned records and supported host views, never facts or resources', () => {
  const record = makeEvidenceRecord(input()), bundle = { records: [record], resultHash: 'b'.repeat(64) };
  const spec = { schemaVersion: 1, kind: 'chronicle-evidence-dashboard', resultHash: bundle.resultHash, recordIds: [record.id], views: ['table', 'evidence'] };
  assert.deepEqual(validateEvidenceDashboard(spec, bundle), spec);
  for (const invalid of [{ ...spec, recordIds: ['invented'] }, { ...spec, resultHash: 'c'.repeat(64) }, { ...spec, views: ['map'] }, { ...spec, coordinates: [0, 0] }, { ...spec, url: 'https://untrusted.invalid/' }]) assert.throws(() => validateEvidenceDashboard(invalid, bundle));
});
