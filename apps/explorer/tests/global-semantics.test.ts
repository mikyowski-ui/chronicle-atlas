import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const app = fileURLToPath(new URL('../', import.meta.url));
const read = (path: string) => JSON.parse(readFileSync(app + path, 'utf8'));
const probes = JSON.parse(execFileSync('python3', ['-c', `
import importlib.util,json,pathlib
p=pathlib.Path('scripts/classify-global-sources.py')
s=importlib.util.spec_from_file_location('classification',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
r={x['label']:x for x in json.loads(pathlib.Path('public/global-history/mappings/reusable-labels.json').read_text(encoding='utf-8'))['mappings']}
cases=[('United States of America',1900,{}),('United States',1815,{}),('United States of America',1700,{}),('Hausa States',1900,{}),('Amazon hunter-gatherers',-200,{}),('Pampas cultures',-200,{}),('Kingdom of France',1815,{}),('Kingdom of France',1800,{}),('Kingdom of Brazil',1900,{}),('Kingdom of Hawaii',1880,{}),('Otherwise mapped country',1900,{'SUBJECTO':'Kingdom of Hawaii'}),(' ',1900,{}),('?',1900,{}),('Bangladesh',1945,{}),('Israel',1938,{}),('United Arab Emirates',1960,{}),('Zaire',2000,{}),('Zaire',1994,{}),('West Germany',-200,{}),('Unmapped individual name',1900,{})]
print(json.dumps([{'label':n,'year':y,**m.classify(n,y,p,r)} for n,y,p in cases]))
`], { cwd: app, encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } }));
const probe = (name: string, year: number) => probes.find((x: { label: string, year: number }) => x.label === name && x.year === year);

test('deliberate dated States mappings precede aggregate lexical rules', () => {
  assert.equal(probe('United States of America', 1900).decision, 'political-association');
  assert.equal(probe('United States', 1815).decision, 'political-association');
  assert.equal(probe('Hausa States', 1900).decision, 'source-context');
  assert.equal(probe('Hausa States', 1900).assertion_kind, 'context');
});

test('culture and subsistence aggregates never acquire political ownership', () => {
  assert.equal(probe('Amazon hunter-gatherers', -200).assertion_kind, 'context');
  assert.equal(probe('Pampas cultures', -200).assertion_kind, 'cultural');
  assert.equal(probe('Unmapped individual name', 1900).decision, 'review-queue');
});

test('date scopes and known anomalies precede exact mappings', () => {
  for (const [name, year] of [['United States of America', 1700], ['Kingdom of Brazil', 1900], ['Bangladesh', 1945], ['Israel', 1938], ['United Arab Emirates', 1960], ['Zaire', 2000]] as const) {
    assert.equal(probe(name, year).decision, 'quarantined', `${name} ${year}`);
  }
  assert.equal(probe('Zaire', 1994).decision, 'political-association');
  assert.equal(probe('West Germany', -200).decision, 'review-queue');
});

test('France anomaly reassessment permits Restoration observation without fabricating daily continuity', () => {
  assert.equal(probe('Kingdom of France', 1815).decision, 'political-association');
  assert.equal(probe('Kingdom of France', 1800).decision, 'quarantined');
});

test('protected Hawaiʻi names and relationships remain quarantined before generic political wording', () => {
  assert.equal(probe('Kingdom of Hawaii', 1880).rule, 'protected-hawaii-quarantine');
  assert.equal(probe('Otherwise mapped country', 1900).decision, 'quarantined');
  assert.equal(probe(' ', 1900).decision, 'excluded');
  assert.equal(probe('?', 1900).decision, 'excluded');
});

test('all40 primary and admitted optional sources reconcile once with exact raw hashes and properties', () => {
  const targets = read('public/global-history/source/target-snapshots.json').snapshots;
  assert.equal(targets.filter((x: any) => x.source_year >= -200).length, 40);
  assert.ok(targets.length === 40 || targets.length === 49);
  let total = 0, primaryTotal = 0;
  for (const target of targets) {
    const bytes = readFileSync(app + 'public/global-history/source/input/' + target.filename);
    const source = JSON.parse(bytes.toString());
    const mapping = read('public/global-history/mappings/' + target.filename.replace('.geojson', '-mappings.json'));
    const hash = createHash('sha256').update(bytes).digest('hex');
    assert.equal(mapping.source_sha256, hash);
    assert.equal(mapping.mappings.length, source.features.length);
    assert.equal(new Set(mapping.mappings.map((x: { feature_index: number }) => x.feature_index)).size, source.features.length);
    assert.equal(Object.values(mapping.counts).reduce((a: number, b) => a + Number(b), 0), source.features.length);
    for (const row of mapping.mappings) {
      assert.equal(row.source_file_sha256, hash);
      assert.deepEqual(row.original_properties, source.features[row.feature_index].properties);
      assert.equal(row.independently_historically_verified, false);
      assert.ok(['political-association', 'cultural-presence', 'source-context', 'review-queue', 'quarantined', 'excluded'].includes(row.decision));
      if (row.decision === 'quarantined' || row.decision === 'review-queue' || row.decision === 'excluded') assert.equal(row.assertion_kind, null);
    }
    total += mapping.mappings.length;
    if (target.source_year >= -200) primaryTotal += mapping.mappings.length;
  }
  assert.equal(primaryTotal, 15462);
  assert.equal(read('public/global-history/mappings/classification-summary.json').raw_features, total);
});

test('primary mapping bytes remain preserved; later dated review changes only its sealed feature rows', () => {
  const original = read('verification/global-history/primary-40/semantic-mappings/archive-hashes.json').files;
  for (const [name, hash] of Object.entries(original)) {
    if (!name.endsWith('-mappings.json') && name !== 'reusable-labels.json') continue;
    const bytes = readFileSync(app + 'public/global-history/mappings/' + name);
    const amendment=read('public/history/political-admission-receipt.json').revisions.find((r:any)=>r.mapping_filename===name);
    if(amendment){
      const previous=readFileSync(app+amendment.previous_mapping_path);
      assert.equal(createHash('sha256').update(previous).digest('hex'),hash,name+' preserved baseline');
      assert.equal(createHash('sha256').update(bytes).digest('hex'),amendment.mapping_sha256,name+' reviewed mapping');
      const oldRows=JSON.parse(previous.toString()).mappings,newRows=JSON.parse(bytes.toString()).mappings;
      for(let i=0;i<oldRows.length;i++)if(!amendment.reviewed_feature_indices.includes(i))assert.deepEqual(newRows[i],oldRows[i],name+':'+i);
    }else assert.equal(createHash('sha256').update(bytes).digest('hex'), hash, name);
  }
});

test('known Isles identity joins matching dated fragments while unknown continuity stays scoped', () => {
  const rows = (year: string) => read(`public/global-history/mappings/world_${year}-mappings.json`).mappings;
  const france = rows('1900').filter((x: any) => x.original_properties.NAME === 'France');
  assert.ok(france.length > 1);
  assert.deepEqual([...new Set(france.map((x: any) => x.entity_id))], ['isles:political:7a1ca4ef7515f7276bae']);
  const us = ['1783', '1815', '1900', '2010'].map(y => rows(y).find((x: any) => ['United States', 'United States of America'].includes(x.original_properties.NAME)).entity_id);
  assert.equal(new Set(us).size, 1);
  const identity = ['1783', '1800'].map(y => rows(y).find((x: any) => x.original_properties.NAME === 'Afghanistan').entity_id);
  assert.equal(new Set(identity).size, 2);
});

test('nine earlier observations have explicitly amended typed semantics, never prehistoric ownership by default', () => {
  const targets = read('public/global-history/source/target-snapshots.json').snapshots.filter((x: any) => x.source_year < -200);
  if (!targets.length) return;
  assert.equal(targets.length, 9);
  let total = 0;
  const rows = (year: string) => read(`public/global-history/mappings/world_bc${year}-mappings.json`).mappings;
  for (const target of targets) {
    const doc = read('public/global-history/mappings/' + target.filename.replace('.geojson', '-mappings.json'));
    assert.equal(doc.rules_version, 'global-basemap-earlier-semantics-v4');
    assert.ok(doc.mappings.some((x: any) => ['political', 'cultural', 'context'].includes(x.assertion_kind)));
    total += doc.mappings.length;
  }
  assert.equal(total, 1466);
  for (const label of ['Minoan', 'Cycladic', 'Jōmon']) {
    assert.equal(rows('3000').find((x: any) => x.original_properties.NAME === label).assertion_kind, 'cultural');
  }
  assert.equal(rows('3000').find((x: any) => x.original_properties.NAME === 'Ur').assertion_kind, 'context');
  assert.equal(rows('1500').find((x: any) => x.original_properties.NAME === 'Urartu').decision, 'quarantined');
  assert.equal(rows('700').find((x: any) => x.original_properties.NAME === 'Urartu').decision, 'political-association');
  assert.equal(rows('700').find((x: any) => x.original_properties.NAME === 'La Tène culture').decision, 'quarantined');
  assert.equal(rows('300').find((x: any) => x.original_properties.NAME === 'Kingdom of Antigonus').decision, 'quarantined');
  assert.equal(rows('1000').find((x: any) => x.original_properties.NAME === 'Kingdom of David and Solomon').decision, 'review-queue');
});
