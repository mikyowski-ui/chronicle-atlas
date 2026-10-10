import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canonicalJSON, hashText } from '../src/research/engine.ts';
import { createCatalogue, registerFixture, registerModernPilot } from '../research-semantic/catalogue.ts';
import { beginRevision, refineRevision, restoreRevision, revisionIntent, type LocalRevision } from '../research-semantic/revisions.ts';
import type { QueryIntent } from '../research-semantic/contracts.ts';
const modern=registerModernPilot(readFileSync(new URL('../src/research/pilot-data.json',import.meta.url),'utf8'));
const raw=readFileSync(new URL('../research-semantic/premodern-pilot.json',import.meta.url),'utf8');
const premodern=registerFixture(raw,hashText(raw)),catalogue=createCatalogue([modern,premodern]);
function root(registration=modern):LocalRevision{const d=registration.descriptor;const intent:QueryIntent={schemaVersion:1,question:'Which retained records exist?',interpretation:'Local source-backed study.',scope:{datasetId:d.id,indicatorId:d.indicators[0].id,bbox:d.bounds.bbox,epoch:d.bounds.epoch,entityIds:d.entityIds},context:'explicit-bounds',parentId:null};return beginRevision(intent,catalogue);}
test('both pilots support deterministic follow-up replay with exact source lineage',()=>{
 for(const registration of [modern,premodern]){
  const original=root(registration),entity=registration.fixture.entities[0],row=registration.fixture.observations.find(r=>r.entityId===entity.id)!;
  const intent=revisionIntent(original,[entity.id],[row.time.startYear,row.time.endYear]);
  const next=refineRevision(original,intent,catalogue),again=refineRevision(original,intent,catalogue);
  assert.equal(canonicalJSON(next),canonicalJSON(again));
  assert.equal(canonicalJSON(restoreRevision(JSON.stringify(next.archive),catalogue)),canonicalJSON(next));
  assert.equal(next.archive.revisions.length,2);assert.equal(original.archive.revisions.length,1);
  assert.ok(next.bundle.observations.length>0);assert.ok(next.bundle.observations.every(r=>r.entityId===entity.id));
  assert.ok(next.bundle.observations.every(r=>registration.fixture.observations.some(source=>canonicalJSON(source)===canonicalJSON(r))));
 }
});
test('follow-ups reject widening, cross-dataset changes, stale parents and incompatible metrics',()=>{
 const first=root(),next=refineRevision(first,revisionIntent(first,[modern.fixture.entities[0].id],[2000,2010]),catalogue);
 for(const bad of [revisionIntent(next,modern.descriptor.entityIds,[2000,2010]),revisionIntent(next,next.plan.scope.entityIds,[1975,2025]),{...revisionIntent(next,next.plan.scope.entityIds,[2000,2010]),parentId:'revision-'+'0'.repeat(64)}])assert.throws(()=>refineRevision(next,bad,catalogue));
 const cross=revisionIntent(next,next.plan.scope.entityIds,[2000,2010]);cross.scope.datasetId=premodern.descriptor.id;assert.throws(()=>refineRevision(next,cross,catalogue));
 assert.throws(()=>refineRevision(next,{...cross,scope:{...cross.scope,indicatorId:'GDP'}},catalogue));
 assert.equal(next.bundle.observations.length,3);
});
test('empty gap years remain empty and do not manufacture interpolated estimates',()=>{
 const initial=root(),next=refineRevision(initial,revisionIntent(initial,initial.plan.scope.entityIds,[2001,2001]),catalogue);
 assert.equal(next.bundle.observations.length,0);assert.equal(restoreRevision(next.archive,catalogue).bundle.observations.length,0);
});
test('archive rejects tampered ancestors, source/result hashes, injected resources and secret fields',()=>{
 const first=root(),next=refineRevision(first,revisionIntent(first,[modern.fixture.entities[0].id],[2000,2010]),catalogue);
 const altered=structuredClone(next.archive);altered.revisions[0].replay.resultHash='0'.repeat(64);assert.throws(()=>restoreRevision(altered,catalogue));
 const disconnected=structuredClone(next.archive);disconnected.revisions[1].parentId=null;assert.throws(()=>restoreRevision(disconnected,catalogue));
 assert.throws(()=>restoreRevision({...next.archive,apiKey:'secret'},catalogue));
 assert.throws(()=>restoreRevision({...next.archive,revisions:[...next.archive.revisions,{url:'https://invalid.test'}]},catalogue));
 assert.throws(()=>restoreRevision('x'.repeat(65537),catalogue));
 assert.throws(()=>restoreRevision(next.archive,createCatalogue([premodern])));
});
test('replay export contains references, no passages, free-form questions or source values',()=>{
 for(const registration of [modern,premodern]){
  const serialized=JSON.stringify(root(registration).archive);
  for(const key of ['question','interpretation','value','author','perspective','locator'])assert.ok(!serialized.includes(`"${key}":`));
  assert.ok(serialized.includes('sourceHashes'));assert.ok(serialized.includes('local-prepared'));
 }
});
test('revision count is bounded and previous state stays immutable on rejection',()=>{
 let current=root();
 current=refineRevision(current,revisionIntent(current,[modern.fixture.entities[0].id],[2000,2000]),catalogue);
 for(let i=2;i<32;i++)current=refineRevision(current,revisionIntent(current,current.plan.scope.entityIds,[2000,2000]),catalogue);
 const before=canonicalJSON(current);assert.throws(()=>refineRevision(current,revisionIntent(current,current.plan.scope.entityIds,[2000,2000]),catalogue),/32 revisions/);
 assert.equal(canonicalJSON(current),before);assert.ok(Object.isFrozen(current.archive));
});
