import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WorkspaceEngine, createWorkspaceRegistry, MODERN_ID, PREMODERN_ID, PREMODERN_HASH, type WorkspaceRegistry } from '../src/research/workspace-engine.ts';
import { ResearchController } from '../src/research/workspace-controller.ts';
import { ResearchEngine, canonicalJSON, type DatasetRegistry } from '../src/research/engine.ts';
import { PILOT_DESCRIPTOR } from '../src/research/registry.ts';
import { PREPARED_EXAMPLES } from '../src/research/examples.ts';
import { registerModernPilot, registerFixture, createCatalogue } from '../research-semantic/catalogue.ts';
import { specForStudy, validateWorkspace, WorkspaceReplaySchema } from '../research-semantic/workspace-contract.ts';
const modern=readFileSync(new URL('../src/research/pilot-data.json',import.meta.url),'utf8');
const premodern=readFileSync(new URL('../research-semantic/premodern-pilot.json',import.meta.url),'utf8');
function legacyRegistry():DatasetRegistry{return new Map([[MODERN_ID,{descriptor:PILOT_DESCRIPTOR,load:async()=>modern}]]);}
function registry(loads:string[]=[],unavailable=''):WorkspaceRegistry{return new Map([[MODERN_ID,{load:async()=>{loads.push(MODERN_ID);if(unavailable===MODERN_ID)throw Error('Unavailable');return modern;},register:registerModernPilot}],[PREMODERN_ID,{load:async()=>{loads.push(PREMODERN_ID);if(unavailable===PREMODERN_ID)throw Error('Unavailable');return premodern;},register:raw=>registerFixture(raw,PREMODERN_HASH)}]]);}
function controller(loads:string[]=[],unavailable=''){return new ResearchController(2000,new WorkspaceEngine(registry(loads,unavailable),legacyRegistry()));}
const signal=()=>new AbortController().signal;
test('same store stages real modern and qualitative pilots with one cursor and explicit selection',async()=>{
 const c=controller();assert.equal(await c.openPilot(MODERN_ID),true);assert.equal(c.getSnapshot().active!.bundle.observations.length,44);
 assert.equal(await c.openPilot(PREMODERN_ID),true);const before=c.getSnapshot(),row=before.active!.bundle.observations[0];
 assert.equal(before.active!.bundle.observations.length,10);assert.ok(before.active!.spec.views.some(v=>v.type==='interval'));
 assert.equal(c.dispatch({type:'select',entityId:row.entityId,observationId:row.id,origin:'map',revision:before.revision}),true);
 assert.equal(c.getSnapshot().cursorYear,2000);assert.equal(c.getSnapshot().selectedEvidence!.observation.id,row.id);
 assert.equal(c.dispatch({type:'cursor',year:1331,origin:'atlas',revision:before.revision}),true);
 assert.equal(c.getSnapshot().active,before.active);assert.deepEqual(c.getSnapshot().analysisTimeWindow,{start:40,end:1516});c.dispose();
});
test('original v1 specs and exact v1 replays adapt only after original validation',async()=>{
 const old=new ResearchEngine(legacyRegistry()),saved=await old.prepare(PREPARED_EXAMPLES[0],signal());
 const c=controller();assert.equal(await c.run(PREPARED_EXAMPLES[0]),true);
 assert.deepEqual(c.getSnapshot().active!.bundle.observations.map(r=>[r.id,r.value]),saved.bundle.observations.map(r=>[r.id,r.value]));
 assert.equal(await c.replay(saved.manifest),true);assert.equal(canonicalJSON(c.getSnapshot().active!.legacy!.manifest),canonicalJSON(saved.manifest));
 const prior=c.getSnapshot().active;const bad=structuredClone(saved.manifest);bad.dependencies[0].dataHash='f'.repeat(64);
 assert.equal(await c.replay(bad),false);assert.equal(c.getSnapshot().active,prior);c.dispose();
});
test('single-pilot complete and narrowing-only replays do not load an unavailable unrelated pilot',async()=>{
 for(const [id,unavailable] of [[MODERN_ID,PREMODERN_ID],[PREMODERN_ID,MODERN_ID]]){
  const initial=controller();await initial.openPilot(id);const full=initial.exportManifest(),old=initial.getSnapshot().active!.study.archive;
  const loads:string[]=[];const target=controller(loads,unavailable);
  assert.equal(await target.replay(full),true);assert.deepEqual(loads,[id]);assert.equal(await target.replay(old),true);assert.deepEqual(loads,[id]);initial.dispose();target.dispose();
 }
});
test('complete replay persists view choices, source versions, selection and cursor without values/passages',async()=>{
 const c=controller();await c.openPilot(PREMODERN_ID);let state=c.getSnapshot();const row=state.active!.bundle.observations[0];
 c.dispatch({type:'select',entityId:row.entityId,observationId:row.id,origin:'interval',revision:state.revision});
 c.dispatch({type:'cursor',year:630,origin:'atlas',revision:state.revision});
 assert.equal(await c.setViews([{id:'records',type:'table',binding:'observations'},{id:'evidence',type:'evidence',binding:'observations'}]),true);
 const text=c.exportManifest();for(const value of ['"value":','"question":','"interpretation":','"locator":'])assert.equal(text.includes(value),false);
 const saved=WorkspaceReplaySchema.parse(JSON.parse(text));assert.deepEqual(saved.views.map(v=>v.type),['table','evidence']);
 const target=controller();assert.equal(await target.replay(text),true);assert.equal(target.getSnapshot().cursorYear,630);assert.equal(target.getSnapshot().selection!.observationId,row.id);assert.deepEqual(target.getSnapshot().active!.spec.views,saved.views);c.dispose();target.dispose();
});
test('unsupported renderer capabilities and qualitative scatter fail before activation',async()=>{
 const c=controller();await c.openPilot(PREMODERN_ID);const prior=c.getSnapshot().active!;
 assert.equal(await c.setViews([{id:'bad',type:'scatter',binding:'observations'}]),false);assert.equal(c.getSnapshot().active,prior);
 const registration=registerFixture(premodern,PREMODERN_HASH),cat=createCatalogue([registration]);
 assert.throws(()=>validateWorkspace(prior.spec,cat,['table','evidence']),/active renderer/);
 assert.throws(()=>validateWorkspace({...prior.spec,views:[{id:'sql',type:'execute',binding:'observations'}]},cat));
 assert.throws(()=>validateWorkspace({...prior.spec,views:[{id:'a',type:'table',binding:'observations'},{id:'b',type:'table',binding:'observations'}]},cat),/Duplicate/);c.dispose();
});
test('empty, invalid, broadening and changed-policy attempts retain prior active revision and evidence',async()=>{
 const c=controller();await c.openPilot(MODERN_ID);let state=c.getSnapshot();const row=state.active!.bundle.observations[0];c.dispatch({type:'select',entityId:row.entityId,observationId:row.id,origin:'table',revision:state.revision});
 const prior=c.getSnapshot();assert.equal(await c.refine(prior.active!.spec.plan.scope.entityIds,[2001,2001]),false);assert.equal(c.getSnapshot().active,prior.active);assert.match(c.getSnapshot().message,/No observations/);
 assert.equal(c.getSnapshot().selection!.observationId,row.id);
 assert.equal(await c.refine([row.entityId],[2000,2010]),true);const narrowed=c.getSnapshot().active;
 assert.equal(await c.refine([row.entityId],[1975,2025]),false);assert.equal(c.getSnapshot().active,narrowed);
 const bad=JSON.parse(c.exportManifest());bad.versions.renderer='changed';assert.equal(await c.replay(bad),false);assert.equal(c.getSnapshot().active,narrowed);c.dispose();
});
test('no-op follow-ups do not consume ancestry or change committed revision',async()=>{
 const c=controller();await c.openPilot(MODERN_ID);const state=c.getSnapshot(),p=state.active!.spec.plan;
 assert.equal(await c.refine([...p.scope.entityIds].reverse(),p.scope.epoch),true);assert.equal(c.getSnapshot().active,state.active);assert.equal(c.getSnapshot().revision,state.revision);assert.match(c.getSnapshot().message,/unchanged/);c.dispose();
});
test('out-of-window selection retains source identity and roundtrips complete replay',async()=>{
 const c=controller();await c.openPilot(PREMODERN_ID);const original=c.getSnapshot(),row=original.active!.bundle.observations.find(o=>o.time.startYear===630)!;
 c.dispatch({type:'select',entityId:row.entityId,observationId:row.id,origin:'table',revision:original.revision});
 assert.equal(await c.refine([row.entityId],[1400,1410]),true);assert.equal(c.getSnapshot().selectedEvidence!.visible,false);assert.equal(c.getSnapshot().selectedEvidence!.observation.time.endYear,631);
 const target=controller();assert.equal(await target.replay(c.exportManifest()),true);assert.equal(target.getSnapshot().selectedEvidence!.observation.id,row.id);assert.equal(target.getSnapshot().selectedEvidence!.visible,false);c.dispose();target.dispose();
});
test('stale asynchronous completion cannot replace a later pilot or reset its selection',async()=>{
 let release:(raw:string)=>void=()=>{};const slow=new Promise<string>(resolve=>{release=resolve;});
 const registrations=new Map(registry());registrations.set(MODERN_ID,{load:()=>slow,register:registerModernPilot});
 const c=new ResearchController(2000,new WorkspaceEngine(registrations,legacyRegistry()));const first=c.openPilot(MODERN_ID);assert.equal(await c.openPilot(PREMODERN_ID),true);
 const active=c.getSnapshot().active;release(modern);assert.equal(await first,false);assert.equal(c.getSnapshot().active,active);assert.equal(c.getDiagnostics().pending,false);c.dispose();
});
test('explicit cancellation and loading timeout preserve previous usable workspace',async()=>{
 const registrations=new Map(registry());registrations.set(PREMODERN_ID,{load:()=>new Promise(()=>{}),register:raw=>registerFixture(raw,PREMODERN_HASH)});
 const c=new ResearchController(2000,new WorkspaceEngine(registrations,legacyRegistry()),15);await c.openPilot(MODERN_ID);const active=c.getSnapshot().active;
 const pending=c.openPilot(PREMODERN_ID);c.cancel();assert.equal(await pending,false);assert.equal(c.getSnapshot().active,active);
 assert.equal(await c.openPilot(PREMODERN_ID),false);assert.equal(c.getSnapshot().errorCode,'DATA_TIMEOUT');assert.equal(c.getSnapshot().active,active);c.dispose();
});
test('malformed, unregistered, oversized and executable archives never invoke a loader',async()=>{
 const loads:string[]=[];const c=controller(loads);
 for(const bad of ['x'.repeat(1048577),{schemaVersion:2,kind:'chronicle-workspace-replay',url:'https://invalid.test'},'{"__proto__":{"x":1}}'])assert.equal(await c.replay(bad),false);
 const original=controller();await original.openPilot(PREMODERN_ID);const saved=JSON.parse(original.exportManifest());saved.study.revisions[0].replay.plan.scope.datasetId='missing';assert.equal(await c.replay(saved),false);assert.deepEqual(loads,[]);c.dispose();original.dispose();
});
test('unavailable natural-language planner leaves existing workspace untouched',async()=>{
 const c=controller();await c.openPilot(MODERN_ID);const active=c.getSnapshot().active;
 const result=await c.requestProposal('What was the trade volume through Samarkand?');assert.equal(result.status,'error');if(result.status==='error')assert.equal(result.code,'PROVIDER_UNAVAILABLE');assert.equal(result.receipt.attempts,0);assert.equal(c.getSnapshot().active,active);c.dispose();
});
test('dispose prevents future work and releases owned subscribers',async()=>{
 const loads:string[]=[];const c=controller(loads);c.subscribe(()=>{});c.dispose();assert.equal(await c.openPilot(MODERN_ID),false);assert.deepEqual(loads,[]);assert.equal(c.getDiagnostics().listeners,0);
});
test('mixed v2 dependency ancestry rejects before loading even its valid first dataset',async()=>{
 const original=controller();await original.openPilot(MODERN_ID);const active=original.getSnapshot().active!;await original.refine([active.bundle.entities[0].id],[2000,2010]);
 const archive=JSON.parse(original.exportManifest());archive.study.revisions[1].replay.plan.scope.datasetId='unregistered';
 const loads:string[]=[];const target=controller(loads);assert.equal(await target.replay(archive),false);assert.deepEqual(loads,[]);original.dispose();target.dispose();
});
test('failed render activation rolls back the complete snapshot and committed count',async()=>{
 const c=controller();await c.openPilot(MODERN_ID);const before=c.getSnapshot(),commits=c.getDiagnostics().commits;let rejectOnce=true;const observed:string[]=[];
 c.subscribe(state=>{if(state.active){observed.push(state.active.spec.plan.scope.datasetId);if(rejectOnce&&state.active!==before.active){rejectOnce=false;throw new Error('Test-only renderer failure');}}});
 assert.equal(await c.openPilot(PREMODERN_ID),false);assert.equal(c.getSnapshot().active,before.active);assert.equal(c.getSnapshot().revision,before.revision);assert.equal(c.getSnapshot().errorCode,'RENDER_FAILED');assert.equal(c.getDiagnostics().commits,commits);assert.equal(observed.at(-1),MODERN_ID);c.dispose();
});
