import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const base = new URL('../public/detail/', import.meta.url);
const read = async (name: string) => JSON.parse(await readFile(new URL(name, base), 'utf8'));
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

test('settlement detail and retained source archives match their bounded exact receipt', async () => {
  const [budget, receipt, data] = await Promise.all([read('places-budget.json'), read('places-receipt.json'), readFile(new URL('places.json', base))]);
  assert.equal(hash(data), receipt.output.sha256);
  assert.equal(data.byteLength, receipt.output.bytes);
  assert.ok(data.byteLength <= budget.browserOutputBytes);
  assert.ok(receipt.measuredPeakRssBytes <= budget.maxRssBytes);
  assert.equal(receipt.historicalPublicationApproved, false);
  for (const source of receipt.rawInputsRetained) {
    const bytes = await readFile(new URL('../' + source.path, import.meta.url));
    assert.equal(bytes.byteLength, source.bytes);
    assert.equal(hash(bytes), source.sha256);
  }
});

test('ancient relevance retains source chronology and modern context never acquires historical validity', async () => {
  const data = await read('places.json');
  const ids = new Set<string>();
  let ancient = 0, modern = 0;
  for (const place of data.places) {
    assert.ok(!ids.has(place.id)); ids.add(place.id);
    assert.ok(place.title.length > 0);
    assert.ok(place.coordinates.every(Number.isFinite));
    assert.ok(Math.abs(place.coordinates[0]) <= 180 && Math.abs(place.coordinates[1]) <= 85.051129);
    assert.ok(new URL(place.sourceUrl).protocol === 'https:');
    if (place.temporalMode === 'source-envelope') {
      ancient++;
      assert.equal(place.sourceId, 'pleiades-4.1');
      assert.equal(place.validFromYear, place.sourceStartYear < 0 ? place.sourceStartYear + 1 : place.sourceStartYear);
      assert.equal(place.validToYear, place.sourceEndYear < 0 ? place.sourceEndYear + 1 : place.sourceEndYear);
      assert.ok(place.validFromYear <= place.validToYear);
      assert.ok(place.accuracyMeters >= 0 && place.accuracyMeters <= 2000);
      assert.ok(place.locationUrl.startsWith('https://pleiades.stoa.org/places/'));
    } else {
      modern++;
      assert.equal(place.temporalMode, 'modern-context');
      assert.equal(place.sourceId, 'natural-earth-places-5.1.2');
      for (const field of ['validFromYear', 'validToYear', 'sourceStartYear', 'sourceEndYear']) assert.equal(place[field], null);
    }
    assert.ok(!('population' in place));
    assert.ok(!('entity_id' in place));
  }
  assert.equal(ancient, data.counts.ancient);
  assert.equal(modern, data.counts.modern);
  assert.ok(ancient > 6000 && modern > 7000);
});

test('every source place and location row has an admitted or explicit omitted outcome', async () => {
  const receipt = await read('places-receipt.json');
  const p = receipt.pleiades;
  const total = (record: Record<string, number>) => Object.values(record).reduce((a, b) => a + b, 0);
  assert.equal(p.admittedPlaces + total(p.placeExclusions), p.sourcePlaceRows);
  assert.equal(p.eligiblePointRows + total(p.pointExclusions), p.sourcePointRows);
  assert.equal(p.admittedPlaces + p.unselectedAlternativePointRows, p.eligiblePointRows);
  assert.equal(receipt.modern.admittedPlaces + receipt.modern.excluded, receipt.modern.sourceRows);
  assert.equal(receipt.modern.exclusionRecords[0].reason, 'outside_web_mercator_display_limit');
  const review = await read('places-review-queue.json');
  assert.equal(review.records.length, p.reviewQueueCount);
});
