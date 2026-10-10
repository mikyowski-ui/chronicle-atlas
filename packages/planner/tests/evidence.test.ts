import test from 'node:test';
import assert from 'node:assert/strict';
import { FileDropAdapter } from '../src/file-drop.ts';
import { hashText } from '@chronicle/contracts/canonical';
import { EvidenceSourceRegistry, GroundedEvidencePlanner } from '../src/evidence-planner.ts';
import { WikidataHistoricalAdapter, compileWikidataQuery, parseWikidataYear } from '../src/wikidata.ts';

test('UTF-8 file byte pins include an original BOM even though parsing ignores it', async () => {
  const text = '\uFEFFid,label\nsynthetic-bom,Synthetic BOM fixture\n', bytes = new TextEncoder().encode(text), adapter = new FileDropAdapter();
  const records = await adapter.ingestFile({ name: 'synthetic.csv', size: bytes.byteLength, async arrayBuffer() { return bytes.buffer; } });
  assert.equal(records[0].source.contentHash, hashText(text)); assert.deepEqual(records, adapter.ingest('renamed.csv', text));
});

const csv = 'id,label,variable,value,unit,startYear,endYear,longitude,latitude,source,edition,locator\r\nsynthetic-a,"Synthetic, zero",count,0,items,0,0,0,0,Synthetic fixture,test-v1,row 1\r\nsynthetic-b,Synthetic unknown,description,,,,,,,Synthetic fixture,test-v1,row 2\r\n';
test('CSV file intake preserves quoted cells, zero coordinates/value and unknown dates without inventing support', async () => {
  const adapter = new FileDropAdapter(), records = adapter.ingest('synthetic.csv', csv);
  assert.equal(records.length, 2); const zero = records.find(row => row.label === 'Synthetic, zero')!;
  assert.equal(zero.value, 0); assert.deepEqual(zero.geometry, { type: 'Point', coordinates: [0, 0] }); assert.equal(zero.time!.startYear, 0);
  const unknown = records.find(row => row.label === 'Synthetic unknown')!;
  assert.equal(unknown.value, null); assert.equal(unknown.time, null); assert.equal(unknown.geometry, null);
  assert.equal((await adapter.queryEntities('zero')).length, 1);
  assert.deepEqual(await adapter.fetchRecord(zero.id), zero);
  assert.deepEqual(adapter.ingest('renamed.csv', csv).map(row => row.id), records.map(row => row.id));
  assert.equal((await adapter.queryEntities('', [-1, -1, 1, 1], [0, 0])).length, 1);
});
test('file admission is atomic and bounded; malformed, duplicate and partially located rows cannot poison the cache', async () => {
  const adapter = new FileDropAdapter(); adapter.ingest('synthetic.csv', csv); const previous = await adapter.queryEntities('');
  for (const text of ['id,label\na,"unfinished', 'id,label\na,one\na,two', 'id,label,longitude\na,point,20', 'id,label,startYear,endYear\na,time,5,1', 'id,label\n__proto__,bad']) assert.throws(() => adapter.ingest('bad.csv', text));
  assert.throws(() => adapter.ingest('huge.csv', 'a'.repeat(4 * 1024 * 1024 + 1)));
  assert.throws(() => adapter.ingest('script.html', '<script>bad</script>'));
  assert.deepEqual(await adapter.queryEntities(''), previous);
});
test('GeoJSON keeps source polygons while JSON-LD uses only a bounded local vocabulary without remote context fetches', () => {
  const adapter = new FileDropAdapter();
  const geometry = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
  const rows = adapter.ingest('synthetic.geojson', JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', id: 'synthetic-polygon', geometry, properties: { label: 'Synthetic polygon' } }] }));
  assert.deepEqual(rows[0].geometry, geometry); assert.equal(rows[0].time, null);
  const graph = { '@context': 'https://schema.org', '@graph': [{ '@id': 'synthetic-event', '@type': 'Event', name: 'Synthetic event', description: 'Fixture only', startDate: '1769', endDate: '1769', geo: { '@type': 'GeoCoordinates', longitude: 0, latitude: 1 } }] };
  const ld = adapter.ingest('synthetic.jsonld', JSON.stringify(graph)); assert.equal(ld[0].time!.startYear, 1769); assert.equal(ld[0].value, 'Fixture only');
  assert.throws(() => adapter.ingest('bad.jsonld', JSON.stringify({ ...graph, '@context': 'https://untrusted.invalid/context' })));
  assert.throws(() => adapter.ingest('bad.geojson', '{"type":"FeatureCollection","type":"FeatureCollection","features":[]}'));
});
test('retrieval precedes layout generation and invalid layouts or unapproved live processing fail closed', async () => {
  const files = new FileDropAdapter(); files.ingest('synthetic.csv', csv);
  const registry = new EvidenceSourceRegistry(); registry.register(files);
  const planner = new GroundedEvidencePlanner(registry);
  const result = await planner.prepare({ question: 'zero', sourceIds: [files.id], bounds: null, temporalRange: null });
  assert.equal(result.bundle.records.length, 1); assert.equal(result.specification.views.includes('map'), true);
  assert.deepEqual(planner.reopen(planner.export(result)), result);
  assert.throws(() => planner.fromRecords({ ...result.intent, bounds: [10, 10, 20, 20] }, result.bundle.records), /EVIDENCE_SCOPE_MISMATCH/);
  assert.throws(() => planner.fromRecords({ ...result.intent, temporalRange: [1, 2] }, result.bundle.records), /EVIDENCE_SCOPE_MISMATCH/);
  let calls = 0;
  const layout = { mode: 'offline-test' as const, async propose(context: { recordIds: readonly string[]; resultHash: string }) { calls++; assert.equal(context.recordIds.length, 1); return { ...result.specification, recordIds: ['fabricated'] }; } };
  await assert.rejects(planner.prepare(result.intent, { layout })); assert.equal(calls, 1);
  await assert.rejects(planner.prepare(result.intent, { layout: { ...layout, mode: 'live' } }), /MODEL_PROCESSING_DENIED/); assert.equal(calls, 1);
  const tampered = JSON.parse(planner.export(result)); tampered.plan.records[0].recordHash = 'c'.repeat(64); assert.throws(() => planner.reopen(tampered));
  const controller = new AbortController(); controller.abort(); await assert.rejects(planner.prepare(result.intent, { signal: controller.signal }), /CANCELLED/);
});
test('Wikidata query values are escaped, endpoints cannot be injected, and imprecise/BCE dates stay explicit', () => {
  const query = compileWikidataQuery('Rome" . SERVICE <https://untrusted.invalid/> { ?s ?p ?o } #', 0);
  assert.match(query, /mwapi:search/); assert.match(query, /\\"/); assert.match(query, /LIMIT 100/);
  assert.match(query, /WHERE \{\s+hint:Query hint:optimizer "None"/);
  assert.deepEqual(parseWikidataYear('+1769-00-00T00:00:00Z', 9, 'http://www.wikidata.org/entity/Q1985727'), { startYear: 1769, endYear: 1769, precision: 'year', meaning: 'Wikidata inception statement; not an operating interval.' });
  assert.equal(parseWikidataYear('+1700-00-00T00:00:00Z', 7, 'http://www.wikidata.org/entity/Q1985727'), null);
  assert.equal(parseWikidataYear('+1769-00-00T00:00:00Z', 9, 'http://www.wikidata.org/entity/Q1985786'), null);
  assert.equal(parseWikidataYear('0000-01-01T00:00:00Z', 9, 'http://www.wikidata.org/entity/Q1985727')!.startYear, 0);
  assert.equal(parseWikidataYear('-0043-01-01T00:00:00Z', 9, 'http://www.wikidata.org/entity/Q1985727')!.startYear, -43);
});
test('Wikidata streaming is opt-in, bounded, cancellable and source-attributed even with missing geometry/time', async () => {
  let calls = 0;
  const payload = { head: { vars: ['item', 'itemLabel'] }, results: { bindings: [{ item: { type: 'uri', value: 'http://www.wikidata.org/entity/Q1' }, itemLabel: { type: 'literal', value: 'Synthetic WDQS transport fixture' } }] } };
  const fetcher: typeof fetch = async (_url, init) => { calls++; assert.equal(init?.credentials, 'omit'); assert.equal(init?.redirect, 'error'); return new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/sparql-results+json' } }); };
  const adapter = new WikidataHistoricalAdapter({ fetch: fetcher });
  await assert.rejects(adapter.queryEntities('fixture'), /REMOTE_NOT_AUTHORIZED/); assert.equal(calls, 0);
  const records = await adapter.queryEntities('fixture', undefined, undefined, { allowRemote: true });
  assert.equal(records.length, 1); assert.equal(records[0].geometry, null); assert.equal(records[0].time, null); assert.equal(records[0].modelProcessing, false); assert.equal(records[0].reviewStatus, 'unreviewed');
  assert.match(records[0].source.locator, /Q1/); assert.equal(calls, 1);
  assert.deepEqual(await adapter.fetchRecord(records[0].id), records[0]); assert.equal(calls, 1);
});
test('Wikidata deadlines also terminate a non-cooperating fetch and cancel a stalled response reader', async () => {
  const ignored = new WikidataHistoricalAdapter({ timeoutMs: 10, fetch: () => new Promise<Response>(() => {}) });
  await assert.rejects(ignored.queryEntities('Q1', undefined, undefined, { allowRemote: true }), /SOURCE_TIMEOUT/);
  let cancelled = 0;
  const stalled = new WikidataHistoricalAdapter({ timeoutMs: 10, fetch: async () => new Response(new ReadableStream({ cancel() { cancelled++; } }), { headers: { 'content-type': 'application/json' } }) });
  await assert.rejects(stalled.queryEntities('Q1', undefined, undefined, { allowRemote: true }), /SOURCE_TIMEOUT/); assert.equal(cancelled, 1);
});
test('Wikidata retains lowercase statement entity prefixes and rejects statements belonging to another entity', async () => {
  let prefix = 'q1';
  const adapter = new WikidataHistoricalAdapter({ fetch: async () => new Response(JSON.stringify({ head: { vars: ['item', 'statement', 'property'] }, results: { bindings: [{ item: { type: 'uri', value: 'http://www.wikidata.org/entity/Q1' }, statement: { type: 'uri', value: `http://www.wikidata.org/entity/statement/${prefix}-11111111-2222-3333-4444-555555555555` }, property: { type: 'literal', value: 'P571' } }] } }), { headers: { 'content-type': 'application/json' } }) });
  const rows = await adapter.queryEntities('Q1', undefined, undefined, { allowRemote: true }); assert.match(rows[0].source.locator, /statement\/q1-/);
  prefix = 'q2'; await assert.rejects(adapter.queryEntities('Q1', undefined, undefined, { allowRemote: true }), /INVALID_WIKIDATA_STATEMENT/);
});
test('Wikidata injected transports run as free functions, not as a cache or adapter receiver', async () => {
  const adapter = new WikidataHistoricalAdapter({ fetch: async function (this: unknown) { assert.equal(this, undefined); return new Response(JSON.stringify({ head: { vars: ['item'] }, results: { bindings: [] } }), { headers: { 'content-type': 'application/json' } }); } });
  assert.deepEqual(await adapter.queryEntities('Q1', undefined, undefined, { allowRemote: true }), []);
});
test('Wikidata rejects oversized responses and does not issue HTTP after pre-cancellation', async () => {
  let calls = 0;
  const adapter = new WikidataHistoricalAdapter({ fetch: async () => { calls++; return new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '1048577' } }); } });
  await assert.rejects(adapter.queryEntities('Q1', undefined, undefined, { allowRemote: true }), /SOURCE_BYTE_LIMIT/);
  const abort = new AbortController(); abort.abort(); await assert.rejects(adapter.queryEntities('Q1', undefined, undefined, { allowRemote: true, signal: abort.signal }), /CANCELLED/); assert.equal(calls, 1);
});
