import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { politicalCivilDay as day, politicalContinuityKey, resolvePoliticalContinuity, reviewPoliticalContinuity, POLITICAL_RULES } from '../src/political-continuity.ts';
import type { SceneData } from '../src/temporal.ts';

test('BCE chronology has no year zero and does not shift cessation by one year', () => {
  assert.equal(day('0001-01-01') - day('-0001-01-01'), 366);
  assert.throws(() => day('0000-01-01'));
  assert.equal(resolvePoliticalContinuity('Achaemenid Empire',day('-0330-12-31'),day('-0400-01-01')).allowed,true);
  assert.equal(resolvePoliticalContinuity('Achaemenid Empire',day('-0329-01-01'),day('-0400-01-01')).allowed,false);
});
test('known extinct polities are not held to a future observation or revived by backwards navigation', () => {
  for(const [name,source,request] of [['Byzantine Empire','1400-01-01','1453-05-29'],['Ottoman Sultanate','1920-01-01','1922-11-01'],['East Germany','1960-01-01','1990-10-03'],['USSR','1960-01-01','1992-01-01'],['Mauryan Empire','-0200-01-01','-0100-01-01']]) {
    assert.equal(resolvePoliticalContinuity(name,day(request),day(source)).allowed,false,name);
    assert.equal(resolvePoliticalContinuity(name,day(source),day(source)).allowed,true,name);
  }
  assert.equal(resolvePoliticalContinuity('Inca Empire',day('1600-01-01'),day('1600-01-01')).reason,'source-outside-reviewed-period');
});
test('Han interregnum is a gap; familiar names and modern Benin are not merged', () => {
  assert.equal(resolvePoliticalContinuity('Han',day('0015-01-01'),day('-0001-01-01')).allowed,false);
  assert.equal(resolvePoliticalContinuity('Han',day('0030-01-01'),day('-0001-01-01')).reason,'reference-crosses-reviewed-discontinuity');
  assert.equal(resolvePoliticalContinuity('Han',day('0100-01-01'),day('0100-01-01')).allowed,true);
  assert.equal(resolvePoliticalContinuity('Han culture',day('2500-01-01')).rule,undefined);
  assert.equal(resolvePoliticalContinuity('Benin',day('1900-01-01'),day('1880-01-01')).allowed,false);
  assert.equal(resolvePoliticalContinuity('Benin',day('2000-01-01'),day('1960-01-01')).rule,undefined);
});
test('guards change materialization keys only at documented date boundaries', () => {
  assert.equal(politicalContinuityKey(day('1453-05-27')),politicalContinuityKey(day('1453-05-28')));
  assert.notEqual(politicalContinuityKey(day('1453-05-28')),politicalContinuityKey(day('1453-05-29')));
});
test('scene filter preserves originals, evidence, cultural presence and unrelated states, and provides native blocked IDs', () => {
  const props=(id:string,kind='political')=>({entity_id:id,territory_state_id:id,render_id:id,t_start:day('1400-01-01'),t_end:day('1401-01-01'),kind});
  const scene={edition:'x',epoch_id:'x',time:day('1400-01-01'),territories:[{properties:props('byz')},{properties:props('other')},{properties:props('culture','cultural')}],parts:[{properties:props('byz')},{properties:props('other')},{properties:props('culture','cultural')}],population:[],migration:[],entities:{byz:{name:'Byzantine Empire'},other:{name:'Unreviewed polity'},culture:{name:'Byzantine Empire',kind:'cultural'}},labels:[{entity_id:'byz'},{entity_id:'other'},{entity_id:'culture'}],evidence:{original:true}} as unknown as SceneData & {time:number};
  const result=reviewPoliticalContinuity(scene,day('1500-01-01'));
  assert.deepEqual(result.suppressedEntityIds,['byz']);
  assert.equal(result.scene.parts!.length,2);
  assert.equal(result.scene.territories.length,2);
  assert.equal(result.scene.labels!.length,2);
  assert.equal(result.scene.evidence,scene.evidence);
  assert.equal(scene.parts!.length,3);
  assert.equal(reviewPoliticalContinuity(scene,day('1400-01-01')).scene,scene);
});
test('every negative chronology constraint includes supporting sources and a clear scope',()=>{
  assert.ok(POLITICAL_RULES.length>=20);
  for(const rule of POLITICAL_RULES) {assert.ok(rule.labels.length);assert.ok(rule.note);assert.ok(rule.sources.every(s=>s.url.startsWith('https://')));}
});
test('targeted missing-state admissions use retained source shapes and scoped source years',()=>{
  const receipt=JSON.parse(readFileSync(new URL('../public/history/political-admission-receipt.json',import.meta.url),'utf8'));
  assert.equal(receipt.changes.length,16);
  assert.equal(receipt.source_originals_modified,false);
  assert.equal(receipt.public_ledger_modified,false);
  for(const change of receipt.changes) {
    const outcomes=JSON.parse(readFileSync(new URL('../public/global-history/observations/'+change.observation_id+'/outcomes.json',import.meta.url),'utf8'));
    const row=outcomes.records.find((r:{source_feature_index:number})=>r.source_feature_index===change.feature_index);
    assert.equal(row.decision,'political',change.observation_id+':'+change.label);
    assert.equal(outcomes.source_sha256,change.source_sha256);
  }
});

test('modern Sudan continues but a pre-partition map cannot masquerade as its current border',()=>{
  assert.equal(resolvePoliticalContinuity('Sudan',day('2011-07-08'),day('2010-01-01')).allowed,true);
  assert.equal(resolvePoliticalContinuity('Sudan',day('2011-07-09'),day('2010-01-01')).allowed,false);
  assert.equal(resolvePoliticalContinuity('Sudan',day('2025-01-01'),day('2020-01-01')).rule,undefined);
});
test('retained source contradictions are suppressed without rewriting their evidence',()=>{
  for(const [observation,name] of [['world_1200','Sultanate of Delhi'],['world_1400','Seljuk Caliphate'],['world_1600','Inca Empire'],['world_1900','Benin'],['world_1914','Manchu Empire']]){
    const metadata=JSON.parse(readFileSync(new URL('../public/global-history/observations/'+observation+'/metadata.json',import.meta.url),'utf8'));
    const data={...metadata,territories:[],population:[],migration:[]};
    const result=reviewPoliticalContinuity(data,metadata.t_start,metadata.t_start);
    assert.ok(result.findings.some(f=>f.name===name));
    assert.equal(result.scene.evidence,data.evidence);
  }
});

test('adding reviewed states preserves every pre-existing polygon shape',()=>{
  const baseline=JSON.parse(readFileSync(new URL('../verification/history-continuity/previous-geometry-hashes.json',import.meta.url),'utf8'));
  for(const observation of baseline.observations){
    const metadata=JSON.parse(readFileSync(new URL('../public/global-history/observations/'+observation.observation_id+'/metadata.json',import.meta.url),'utf8'));
    const current=new Map(metadata.parts.map((part:any)=>[part.properties.render_id,part.geometry_hash]));
    for(const [id,hash] of Object.entries(observation.previous_parts))assert.equal(current.get(id),hash,observation.observation_id+':'+id);
  }
});

test('teaching-era chronology suppresses anachronistic source appearances and ends held regimes without inventing successors', () => {
  const check = (name: string, requested: string, observation: string) => resolvePoliticalContinuity(name, day(requested), day(observation));
  assert.equal(check('Sultanate of Delhi', '1200-01-01', '1200-01-01').allowed, false);
  assert.equal(check('Sultanate of Delhi', '1415-01-01', '1400-01-01').allowed, true);
  assert.equal(check('Sultanate of Delhi', '1527-01-01', '1500-01-01').allowed, false);
  assert.equal(check('Seljuk Caliphate', '1400-01-01', '1400-01-01').allowed, false);
  assert.equal(check('Seljuk Caliphate', '1300-01-01', '1300-01-01').allowed, true);
  assert.equal(check('Mamluke Sultanate', '1518-01-01', '1500-01-01').allowed, false);
  assert.equal(check('Timurid Empire', '1415-01-01', '1400-01-01').allowed, true, 'Timur’s death does not end all Timurid rule');
  assert.equal(check('Timurid Empire', '1508-01-01', '1400-01-01').allowed, false);
  assert.equal(check('Japan', '1900-01-01', '1800-01-01').rule, undefined, 'a generic national label does not inherit a dynasty-specific cutoff');
  assert.equal(check('White Horde', '1415-01-01', '1400-01-01').rule, undefined, 'contested Horde vocabulary is annotated rather than assigned invented dates');
  assert.equal(check('Toba Wei', '0535-12-31', '0500-01-01').allowed, true);
  assert.equal(check('Toba Wei', '0536-01-01', '0500-01-01').allowed, false);
  assert.equal(check('Xixia', '1000-01-01', '1000-01-01').allowed, true, 'generic source vocabulary may mean the Tangut predecessor');
  assert.equal(check('Xixia', '1228-01-01', '1200-01-01').allowed, false);
  assert.equal(check('Champa', '1833-01-01', '1800-01-01').allowed, false);
  assert.equal(check('Pagan', '1400-01-01', '1400-01-01').rule, undefined, 'the end of an imperial phase does not prove the end of all later political associations');
});
