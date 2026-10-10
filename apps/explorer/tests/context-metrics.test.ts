import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { Polygon } from 'geojson';
import { displayFootprintKm2 } from '../scripts/compile-context-metrics.ts';
import { createContextMetrics, metricsForScene, CONTEXT_METRICS_IDENTITY } from '../src/context-metrics.ts';
const box=(west:number,south:number,east:number,north:number):Polygon=>({type:'Polygon',coordinates:[[[west,south],[east,south],[east,north],[west,north],[west,south]]]});
test('display footprint handles seam-crossing islands, holes and duplicate/overlapping parts',()=>{
  const square=displayFootprintKm2([box(0,0,1,1)]);
  assert.ok(Math.abs(square-12308.778361)<0.001,'WGS84 equatorial one-degree reference area');
  assert.equal(displayFootprintKm2([box(0,0,1,1),box(0,0,1,1)]),square);
  assert.equal(displayFootprintKm2([box(0,0,1,1),box(0.5,0,1,1)]),square,'overlapping piece must not add area');
  assert.ok(Math.abs(displayFootprintKm2([box(179,0,-179,1)])-2*square)<0.001);
  assert.ok(Math.abs(displayFootprintKm2([box(179,0,-179,1),box(179,0,180,1)])-2*square)<0.001,'seam duplicate deduplicated');
  const holed=box(0,0,3,3);holed.coordinates.push(box(1,1,2,2).coordinates[0]);
  assert.ok(Math.abs(displayFootprintKm2([holed])-(displayFootprintKm2([box(0,0,3,3)])-displayFootprintKm2([box(1,1,2,2)])))<0.001);
  assert.ok(Math.abs(displayFootprintKm2([box(0,0,1,1),box(20,0,21,1)])-2*square)<0.001);
});
test('ambiguous pole-winding cannot silently become a footprint',()=>{
  assert.throws(()=>displayFootprintKm2([{type:'Polygon',coordinates:[[[0,80],[120,80],[-120,80],[0,80]]]}]),/Ambiguous/);
});
test('retained sidecar covers all 80 scenes and keys reference metrics by committed source identity',async()=>{
  const bytes=await readFile(new URL('../public/glass/map-metrics.json',import.meta.url));
  assert.equal(bytes.length,CONTEXT_METRICS_IDENTITY.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),CONTEXT_METRICS_IDENTITY.sha256);
  const document=JSON.parse(bytes.toString());const lookup=createContextMetrics(document);
  assert.equal(lookup.observations,80);assert.equal(lookup.size,4664);
  const observation=document.observations.find((o:any)=>o.epoch_id==='isles-1900');
  const id='isles:political:d577c358bc0b8a4cb477';
  const scene={edition:observation.edition,epoch_id:observation.epoch_id,time:observation.t_start};
  const row=metricsForScene(lookup,scene,id)!;
  const history=lookup.observationsForEntity(id);assert.ok(history.length>1);assert.ok(Object.isFrozen(history));
  assert.ok(history.some(o=>o.epoch_id==='isles-1900'));assert.ok(history.every((o,i)=>i===0||o.t_start>=history[i-1].t_start));
  assert.deepEqual(lookup.observationsForEntity('no-such-entity'),[]);
  assert.equal(row.scope,'regional');assert.equal(row.kind,'political');
  assert.equal(row.label,'Approximate regional footprint');assert.ok(row.areaKm2!>200_000&&row.areaKm2!<400_000);
  assert.equal(metricsForScene(lookup,{...scene,edition:'another-edition'},id),null);
  assert.equal(metricsForScene(lookup,{...scene,time:observation.t_end},id),null,'requested cursor must not extend source observation');
  assert.equal(metricsForScene(lookup,{...scene,epoch_id:'uncovered'},id),null);
  const cultural=document.observations[0].rows.find((r:any)=>r[3]==='cultural');
  assert.ok(cultural);assert.equal(metricsForScene(lookup,{edition:document.observations[0].edition,epoch_id:document.observations[0].epoch_id,time:document.observations[0].t_start},cultural[0])?.kind,'cultural');
});
test('duplicate scene identities and unsupported unknown areas fail validation',async()=>{
  const original=JSON.parse(await readFile(new URL('../public/glass/map-metrics.json',import.meta.url),'utf8'));
  assert.throws(()=>createContextMetrics({...original,observations:[original.observations[0],original.observations[0]]}),/Duplicate/);
  const scene={...original.observations[0],rows:[['entity',null,1,'political']]};
  assert.throws(()=>createContextMetrics({...original,observations:[scene]}),/Invalid/);
});


test('all reviewed state admissions have source-matched area metrics',async()=>{
  const document=JSON.parse(await readFile(new URL('../public/glass/map-metrics.json',import.meta.url),'utf8'));
  const admissions=JSON.parse(await readFile(new URL('../public/history/political-admission-receipt.json',import.meta.url),'utf8'));
  for(const admission of admissions.changes){
    const metadata=JSON.parse(await readFile(new URL('../public/global-history/observations/'+admission.observation_id+'/metadata.json',import.meta.url),'utf8'));
    const entry=document.observations.find((o:any)=>o.epoch_id===metadata.epoch_id&&o.edition===metadata.edition);
    const id=metadata.parts.find((p:any)=>p.properties.source_feature_index===admission.feature_index).properties.entity_id;
    const row=entry.rows.find((r:any)=>r[0]===id);
    assert.ok(row[1]>0,admission.label+' has a bounded area estimate');
    assert.equal(row[3],'political');
  }
});
