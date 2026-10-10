import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validateDossierManifest, validateDossier, safeArticleURL, safeInspectorSourceURL, dossierForTime, dossierForContext, describeInspectorFeature, DOSSIER_BUDGET, type InspectorContext, type InspectorFeatureContext } from '../src/dossier-inspector.ts';
const directory = new URL('../public/integrated/dossiers/', import.meta.url);
const manifestBytes = await readFile(new URL('manifest.json', directory));
const manifest = validateDossierManifest(JSON.parse(manifestBytes.toString()));

test('three bounded dated dossiers bind their static bytes and real source assertions', async () => {
  assert.ok(manifestBytes.byteLength <= DOSSIER_BUDGET.manifestBytes);
  for (const summary of manifest.records) {
    const bytes = await readFile(new URL(summary.url, directory));
    assert.equal(bytes.byteLength, summary.byte_length);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), summary.sha256);
    const record = validateDossier(JSON.parse(bytes.toString()), summary, manifest.edition);
    const metadata = JSON.parse(await readFile(new URL(`../public/alpha/${record.map_binding.epoch_id}.metadata.json`, import.meta.url), 'utf8'));
    assert.equal(metadata.edition, record.map_binding.edition);
    const claims = new Set(metadata.parts.filter((p: any) => p.properties.entity_id === record.entity_id).map((p: any) => p.properties.territory_state_id));
    assert.ok(record.map_binding.assertion_ids.length > 0);
    assert.ok(record.map_binding.assertion_ids.every(id => claims.has(id)));
    assert.equal(record.t_start, metadata.t_start); assert.equal(record.t_end, metadata.t_end);
    assert.ok(record.organization.length >= 5); assert.ok(record.overview.length >= 2);
    assert.ok(record.sources.every(source => safeArticleURL(source.url).startsWith('https://')));
  }
});

test('dated dossiers do not bleed into unsupported dates or substitute different entity identities', () => {
  const first = manifest.records[0];
  assert.equal(dossierForTime(manifest.records, first.entity_id, first.t_start)?.id, first.id);
  assert.equal(dossierForTime(manifest.records, first.entity_id, first.t_end - 1)?.id, first.id);
  assert.equal(dossierForTime(manifest.records, first.entity_id, first.t_start - 1), undefined);
  assert.equal(dossierForTime(manifest.records, first.entity_id, first.t_end), undefined);
  assert.equal(dossierForTime(manifest.records, 'unmatched modern state', first.t_start), undefined);
  assert.equal(dossierForTime(manifest.records, first.entity_id, null), undefined);
});

test('dossier loader rejects unsafe links, mismatched identity, missing references and enlarged budgets', async () => {
  for (const url of ['javascript:alert(1)', 'http://example.com', 'data:text/html,test', 'https://user:password@example.com']) assert.throws(() => safeArticleURL(url));
  const summary = manifest.records[0];
  const record = JSON.parse(await readFile(new URL(summary.url, directory), 'utf8'));
  assert.throws(() => validateDossier({ ...record, entity_id: 'different' }, summary, manifest.edition));
  assert.throws(() => validateDossier({ ...record, article_source_id: 'invented' }, summary, manifest.edition));
  assert.throws(() => validateDossier({ ...record, lead: { ...record.lead, source_ids: ['invented'] } }, summary, manifest.edition));
  assert.throws(() => validateDossierManifest({ ...manifest, records: [...manifest.records, summary] }));
  assert.throws(() => validateDossierManifest({ ...manifest, records: [{ ...summary, byte_length: DOSSIER_BUDGET.recordBytes + 1 }, ...manifest.records.slice(1)] }));
  assert.throws(() => validateDossierManifest({ ...manifest, records: [{ ...summary, url: '../outside.json' }, ...manifest.records.slice(1)] }));
});

test('UK population is explicitly regional and absent point facts remain absent', async () => {
  const record = JSON.parse(await readFile(new URL('united-kingdom-1900.json', directory), 'utf8'));
  assert.match(record.population.text, /England and Wales only/);
  assert.match(record.population.text, /neither the full UK total nor a population at the clicked point/);
  assert.match(record.population.scope, /no exact day/);
});

test('a retained selection cannot lend its dossier to a missing or unrelated scene', () => {
  const first = manifest.records[0];
  const context: InspectorContext = {requestedTime:first.t_start + 3650, displayedTime:first.t_start, edition:'map', policy:'reference', representation:'reference', selection:{entityId:first.entity_id,name:first.title}, selectionRepresented:true};
  assert.equal(dossierForContext(manifest.records, context)?.id, first.id, 'explicit earlier reference may show its actually dated study');
  assert.equal(dossierForContext(manifest.records, {...context, selectionRepresented:false}), undefined);
  assert.equal(dossierForContext(manifest.records, {...context, representation:'missing'}), undefined);
  assert.equal(dossierForContext(manifest.records, {...context, displayedTime:first.t_end}), undefined);
  assert.equal(dossierForContext(manifest.records, {...context, selection:{entityId:'different-id-with-same-name',name:first.title}}), undefined);
});

test('all global basic-card types retain meaning without claiming sovereignty or corroboration', () => {
  const common: InspectorFeatureContext = {sourceName:'Source label', kind:'political-association', reviewStatus:'source-attributed', sourceTitle:'Historical Basemaps', attribution:'A. Ourednik and contributors'};
  assert.match(describeInspectorFeature(common).status, /not independently corroborated/);
  assert.match(describeInspectorFeature(common).meaning, /does not establish universal or exclusive sovereignty/);
  const cultural = describeInspectorFeature({...common,kind:'cultural-presence'});
  assert.equal(cultural.type,'Cultural presence'); assert.match(cultural.meaning,/not a political boundary/);
  const context = describeInspectorFeature({...common,kind:'source-context'});
  assert.equal(context.type,'Source context'); assert.match(context.meaning,/not admitted political ownership/);
  const population = describeInspectorFeature({...common,kind:'aggregate-population'});
  assert.match(population.meaning,/does not establish a polity or a population total/);
  assert.match(describeInspectorFeature({...common,kind:'unknown',reviewStatus:'unreviewed'}).status,/unresolved/);
  assert.match(describeInspectorFeature({...common,kind:'synthetic',reviewStatus:'synthetic'}).meaning,/no historical claim/);
  assert.match(describeInspectorFeature({...common,reviewStatus:'independently-reviewed'}).status,/see recorded evidence and scope/);
});

test('basic-card source links admit pinned HTTPS and local assets but reject active content and credentials', () => {
  const local = 'http://127.0.0.1:4173/';
  assert.equal(safeInspectorSourceURL('./global-history/source.json', local), `${local}global-history/source.json`);
  assert.equal(safeInspectorSourceURL('https://example.org/pinned/source', local),'https://example.org/pinned/source');
  for (const value of ['javascript:alert(1)','data:text/html,test','file:///private','http://other.example/source','https://user:password@example.org','https://example.org/'+'a'.repeat(2048)]) assert.throws(() => safeInspectorSourceURL(value,local));
});
