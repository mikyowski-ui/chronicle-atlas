import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { canonicalJSON, hashText } from '../src/research/engine.ts';
import {
  boundedSemanticInput, DashboardSpecificationSchema, EpistemicStatusSchema, FixtureSchema,
  QueryIntentSchema, QueryPlanSchema, SemanticError, SEMANTIC_LIMITS,
  type DashboardSpecification,type QueryIntent,type RegisteredNormalizer,
} from '../research-semantic/contracts.ts';
import {
  compileIntent,createCatalogue,makeReplay,modernFixtureFromRaw,registerFixture,registerModernPilot,
  replay,requireRegisteredNormalizer,resolvePlan,validateFixture,validateSpecification,
} from '../research-semantic/catalogue.ts';

const raw=readFileSync(new URL('../src/research/pilot-data.json',import.meta.url),'utf8');
const modern=registerModernPilot(raw),catalogue=createCatalogue([modern]);
function intent():QueryIntent{return QueryIntentSchema.parse({schemaVersion:1,question:'Which population estimates are retained?',interpretation:'Separate dated UN population estimates.',context:'explicit-bounds',parentId:null,scope:{datasetId:modern.descriptor.id,indicatorId:'population',bbox:modern.descriptor.bounds.bbox,epoch:[1975,2025],entityIds:modern.descriptor.entityIds}});}
function specification():DashboardSpecification{const i=intent();return DashboardSpecificationSchema.parse({schemaVersion:1,id:'modern-observations',title:'Retained urban estimates',intent:i,plan:compileIntent(i,catalogue),views:[{id:'map',type:'map',binding:'observations'},{id:'table',type:'table',binding:'observations'},{id:'evidence',type:'evidence',binding:'observations'}],selection:'entity-observation',layout:'adaptive'});}
const code=(expected:string)=>(error:unknown):boolean=>error instanceof SemanticError&&error.code===expected;

test('semantic contracts parse source-backed 44-record modern pilot with unknown confidence',()=>{
  const data=modern.fixture,bundle=resolvePlan(compileIntent(intent(),catalogue),catalogue);
  assert.equal(bundle.observations.length,44);assert.equal(bundle.entities.length,4);
  assert.ok(data.observations.every(row=>row.epistemicStatus==='modeled'&&row.confidence.kind==='not-supplied'&&row.derivation===null));
  assert.ok(data.entities.every(entity=>entity.spatialSupport.uncertaintyKm===null&&entity.spatialSupport.comparability==='definition-only'));
  assert.equal(data.sourcePins.length,2);
  assert.deepEqual(bundle.observations.map(x=>x.value).sort((a,b)=>Number(a)-Number(b)),JSON.parse(raw).observations.map((x:{value:number})=>x.value).sort((a:number,b:number)=>a-b));
});
test('modern adapter rejects altered source bytes before semantic conversion',()=>{
  assert.throws(()=>modernFixtureFromRaw(raw+' '),/pinned edition/);
});
test('strict Zod declarations reject executable fields and nested loaders',()=>{
  assert.throws(()=>QueryIntentSchema.parse({...intent(),sql:'select *'}));
  const spec=specification();assert.throws(()=>DashboardSpecificationSchema.parse({...spec,views:[{...spec.views[0],loader:{url:'https://example.invalid'}}]}));
  assert.throws(()=>QueryIntentSchema.parse({...intent(),question:'<script>alert(1)</script>'}));
  assert.throws(()=>QueryPlanSchema.parse({...spec.plan,operation:'eval'}));
  assert.throws(()=>QueryPlanSchema.parse({...spec.plan,joins:['inferred-link']}));
});
test('bounded input rejects huge, cyclic, unsafe and deeply nested data before validation',()=>{
  assert.throws(()=>boundedSemanticInput('x'.repeat(SEMANTIC_LIMITS.queryBytes+1)),code('BUDGET_EXCEEDED'));
  const cycle:{child?:unknown}={};cycle.child=cycle;assert.throws(()=>boundedSemanticInput(cycle),code('INVALID_SPEC'));
  let deep:unknown=null;for(let i=0;i<20;i++)deep={child:deep};assert.throws(()=>boundedSemanticInput(deep),code('BUDGET_EXCEEDED'));
  assert.throws(()=>boundedSemanticInput('{"__proto__":{"role":"admin"}}'),code('INVALID_SPEC'));
  assert.throws(()=>boundedSemanticInput({fn:()=>1}),code('INVALID_SPEC'));
  assert.throws(()=>boundedSemanticInput({x:Infinity}),code('INVALID_SPEC'));
});
test('Zod import and object construction run with dynamic Function disabled',()=>{
  const moduleURL=new URL('../research-semantic/contracts.ts',import.meta.url).href;
  const script=`let attempts=0;globalThis.Function=new Proxy(globalThis.Function,{construct(){attempts++;throw Error('Dynamic Function prohibited');},apply(){attempts++;throw Error('Dynamic Function prohibited');}});const c=await import(${JSON.stringify(moduleURL)});c.QueryIntentSchema.parse(${JSON.stringify(intent())});if(attempts!==0)throw Error('Dynamic Function attempted');`;
  const run=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',script],{cwd:fileURLToPath(new URL('..',import.meta.url)),encoding:'utf8',timeout:10000});
  assert.equal(run.status,0,run.stderr);assert.equal(run.error,undefined);
});
test('query compiler refuses unregistered indicators/entities/datasets and unverified geography',()=>{
  const i=intent();
  assert.throws(()=>compileIntent({...i,scope:{...i.scope,datasetId:'absent'}},catalogue),code('UNKNOWN_REFERENCE'));
  assert.throws(()=>compileIntent({...i,scope:{...i.scope,indicatorId:'trade-node-description'}},catalogue),code('UNKNOWN_REFERENCE'));
  assert.throws(()=>compileIntent({...i,scope:{...i.scope,indicatorId:'GDP'}},catalogue));
  assert.throws(()=>compileIntent({...i,scope:{...i.scope,entityIds:['synthetic-city']}},catalogue),code('UNKNOWN_REFERENCE'));
  assert.throws(()=>compileIntent({...i,scope:{...i.scope,bbox:[-180,-90,180,90]}},catalogue),code('OUT_OF_BOUNDS'));
  assert.throws(()=>compileIntent({...i,scope:{...i.scope,epoch:[1900,2025]}},catalogue),code('OUT_OF_BOUNDS'));
  assert.throws(()=>compileIntent({...i,scope:{...i.scope,epoch:[2025,1975]}},catalogue));
});
test('compiler normalizes entity order while preserving exact requested bounds',()=>{
  const i=intent(),plan=compileIntent({...i,scope:{...i.scope,entityIds:[...i.scope.entityIds].reverse()}},catalogue);
  assert.deepEqual(plan,compileIntent(i,catalogue));assert.deepEqual(plan.scope.bbox,i.scope.bbox);
  assert.ok(Object.isFrozen(plan));assert.ok(Object.isFrozen(plan.scope));
  assert.throws(()=>compileIntent({...i,scope:{...i.scope,entityIds:[i.scope.entityIds[0],i.scope.entityIds[0]]}},catalogue),code('INVALID_SPEC'));
});
test('query execution honors temporal/bounding-box filtering without interpolation',()=>{
  const i=intent(),entity=modern.fixture.entities[1];
  const plan=compileIntent({...i,scope:{...i.scope,entityIds:[entity.id],epoch:[1991,2004],bbox:[...entity.coordinates,...entity.coordinates]}},catalogue);
  const result=resolvePlan(plan,catalogue);assert.deepEqual(result.observations.map(x=>x.time.startYear),[1995,2000]);
  assert.equal(result.entities.length,1);
  assert.equal(resolvePlan(compileIntent({...i,scope:{...i.scope,epoch:[1991,1994]}},catalogue),catalogue).observations.length,0);
});
test('specification rejects mismatched plan, duplicate views and unsupported independent queries',()=>{
  const spec=specification();assert.equal(validateSpecification(spec,catalogue).id,spec.id);
  assert.throws(()=>validateSpecification({...spec,plan:{...spec.plan,maxRows:1}},catalogue),code('INVALID_SPEC'));
  assert.throws(()=>validateSpecification({...spec,views:[spec.views[0],spec.views[0]]},catalogue),code('INVALID_SPEC'));
  assert.throws(()=>validateSpecification({...spec,views:[{...spec.views[0],query:'SELECT'}]},catalogue));
});
test('fixture references, indicator classes, source pins and bounds must agree',()=>{
  const f=structuredClone(modern.fixture),row=f.observations[0];
  assert.throws(()=>validateFixture({...f,observations:[{...row,entityId:'absent'}]}),code('UNKNOWN_REFERENCE'));
  assert.throws(()=>validateFixture({...f,observations:[{...row,value:'eleven million'}]}),code('INCOMPATIBLE_SEMANTICS'));
  assert.throws(()=>validateFixture({...f,observations:[{...row,epistemicStatus:'attested'}]}),code('INCOMPATIBLE_SEMANTICS'));
  assert.throws(()=>validateFixture({...f,observations:[{...row,provenance:{...row.provenance,sourceSha256:'0'.repeat(64)}}]}),code('EDITION_MISMATCH'));
  assert.throws(()=>validateFixture({...f,observations:[{...row,time:{...row.time,startYear:1950,endYear:1950}}]}),code('OUT_OF_BOUNDS'));
  assert.throws(()=>registerFixture(canonicalJSON(f),'0'.repeat(64)),code('EDITION_MISMATCH'));
});
test('missing remains null, real zero remains zero, and neither acquires an uncertainty interval',()=>{
  const f=structuredClone(modern.fixture);f.observations[0].value=null;f.observations[1].value=0;
  const result=validateFixture(f);assert.equal(result.observations[0].value,null);assert.equal(result.observations[1].value,0);
  assert.equal(result.observations[0].confidence.kind,'not-supplied');
});
test('attested/interpolated/modeled remain distinct and unsupported interpolation has no silent defaults',()=>{
  for(const status of ['attested','interpolated','modeled'])assert.equal(EpistemicStatusSchema.parse(status),status);
  assert.throws(()=>EpistemicStatusSchema.parse('certain'));
  const f=structuredClone(modern.fixture);f.indicators[0].allowedEvidence.push('interpolated');f.observations[0].epistemicStatus='interpolated';
  assert.throws(()=>FixtureSchema.parse(f),/input references/);
  f.observations[0].derivation={methodId:'test-only-linear',inputObservationIds:['missing-a','missing-b']};
  assert.throws(()=>validateFixture(f),code('UNKNOWN_REFERENCE'));
});
test('source confidence is separate from spatial uncertainty and never inferred from it',()=>{
  const f=structuredClone(modern.fixture);f.entities[0].spatialSupport.uncertaintyKm=10;
  assert.equal(validateFixture(f).observations[0].confidence.kind,'not-supplied');
  f.observations[0].confidence={kind:'source-interval',lower:0,upper:1,level:0.95,note:'Invalid test-only interval'};
  assert.throws(()=>validateFixture(f),code('INCOMPATIBLE_SEMANTICS'));
});
test('replay exports contain references/hashes only and deterministically reproduce results',()=>{
  const i={...intent(),question:'PRIVATE QUESTION sentinel',interpretation:'PRIVATE NOTE sentinel'},plan=compileIntent(i,catalogue),manifest=makeReplay(plan,catalogue);
  assert.equal(replay(manifest,catalogue).resultHash,resolvePlan(plan,catalogue).resultHash);
  assert.equal(canonicalJSON(manifest),canonicalJSON(makeReplay(plan,catalogue)));
  const serialized=JSON.stringify(manifest);assert.ok(!serialized.includes('PRIVATE'));assert.ok(!serialized.includes('"value":'));assert.ok(!serialized.includes('sourcePins'));assert.ok(!serialized.includes('supportNote'));
  assert.throws(()=>replay({...manifest,resultHash:'0'.repeat(64)},catalogue),code('EDITION_MISMATCH'));
  assert.throws(()=>replay({...manifest,dependencies:[{...manifest.dependencies[0],sourceHashes:['0'.repeat(64)]}]},catalogue),code('EDITION_MISMATCH'));
  assert.throws(()=>replay(manifest,createCatalogue([])),code('UNKNOWN_REFERENCE'));
});
test('replay fails closed on metadata-only changes and exact fixture-byte repins',()=>{
  const plan=compileIntent(intent(),catalogue),f=structuredClone(modern.fixture);f.coverageNote+=' Changed edition semantics.';
  const changedRaw=canonicalJSON(f),changed=createCatalogue([registerFixture(changedRaw,hashText(changedRaw))]);
  assert.throws(()=>replay(makeReplay(plan,catalogue),changed),code('EDITION_MISMATCH'));
  const normalizerChanged=createCatalogue([registerFixture(canonicalJSON(modern.fixture),modern.descriptor.dataHash,['new-rule'])]);
  assert.throws(()=>resolvePlan(plan,normalizerChanged),code('EDITION_MISMATCH'));
});
test('joins default deny even for same pilot and same indicator',()=>{
  const entity=modern.fixture.entities[0],observation=modern.fixture.observations[0],item={descriptor:modern.descriptor,entity,observation};
  assert.throws(()=>requireRegisteredNormalizer(item,item,'not-registered',new Map()),code('INCOMPATIBLE_SEMANTICS'));
});
test('explicit normalizer also requires matching fixed geography, units, time and evidence',()=>{
  const entity=structuredClone(modern.fixture.entities[0]),observation=modern.fixture.observations[0];
  const descriptor={...modern.descriptor,permittedNormalizerIds:['test-only-comparable']};
  const rule:RegisteredNormalizer={id:'test-only-comparable',version:'1',leftIndicator:'population',rightIndicator:'population',unit:'persons',geographyDefinition:entity.spatialSupport.definition,epoch:[1975,2025],evidenceClasses:['modeled'],operation:'compare-only',confidencePolicy:'preserve-source-unknown',reviewStatus:'host-reviewed'};
  const rules=new Map([[rule.id,rule]]),item={descriptor,entity,observation};
  assert.throws(()=>requireRegisteredNormalizer(item,item,rule.id,rules),code('INCOMPATIBLE_SEMANTICS'));
  entity.spatialSupport.comparability='fixed';assert.equal(requireRegisteredNormalizer(item,item,rule.id,rules).id,rule.id);
  assert.throws(()=>requireRegisteredNormalizer(item,{...item,observation:{...observation,value:null}},rule.id,rules),code('INSUFFICIENT_EVIDENCE'));
  assert.throws(()=>requireRegisteredNormalizer(item,{...item,observation:{...observation,time:{...observation.time,startYear:1980,endYear:1980}}},rule.id,rules),code('INCOMPATIBLE_SEMANTICS'));
  assert.equal(observation.confidence.kind,'not-supplied');
});

const premodernRaw=readFileSync(new URL('../research-semantic/premodern-pilot.json',import.meta.url),'utf8');
const premodern=registerFixture(premodernRaw,'8f2bf0e7672dac8fb7136fd5fe81147884c3faa31d441247ab823e01367d14d0');
function premodernIntent():QueryIntent{return QueryIntentSchema.parse({schemaVersion:1,question:'Which descriptions of exchange are retained?',interpretation:'Separately dated primary-account descriptions, with no inferred continuous network.',context:'explicit-bounds',parentId:null,scope:{datasetId:premodern.descriptor.id,indicatorId:'trade-node-description',bbox:premodern.descriptor.bounds.bbox,epoch:premodern.descriptor.bounds.epoch,entityIds:premodern.descriptor.entityIds}});}

test('the same compiler/executor validates the 10 sparse premodern observations and 44 modern observations',()=>{
  const both=createCatalogue([modern,premodern]);
  const result=resolvePlan(compileIntent(premodernIntent(),both),both);
  assert.equal(result.observations.length,10);assert.equal(result.entities.length,9);
  assert.equal(resolvePlan(compileIntent(intent(),both),both).observations.length,44);
  assert.ok(result.observations.every(row=>row.epistemicStatus==='attested'&&row.derivation===null&&typeof row.value==='string'));
  assert.ok(result.entities.every(entity=>entity.spatialSupport.uncertaintyKm===null));
  assert.equal(replay(makeReplay(compileIntent(premodernIntent(),both),both),both).resultHash,result.resultHash);
});
test('premodern source lineage matches all ten original retained records, not a fabricated demonstration',()=>{
  const sourceRaw=readFileSync(new URL('../public/history/primary-accounts.json',import.meta.url),'utf8');
  assert.equal(hashText(sourceRaw),premodern.fixture.sourcePins[0].sha256);
  const source: {accounts: {summary:string;eventFromYear:number;eventToYear:number;writtenFromYear:number;writtenToYear:number;sourceIds:string[]}[]}=JSON.parse(sourceRaw);
  for(const row of premodern.fixture.observations){
    const match=/^\/accounts\/(\d+)$/.exec(row.provenance.locator);assert.ok(match,row.provenance.locator);
    const retained=source.accounts[Number(match[1])];assert.ok(retained);
    assert.equal(row.provenance.recordSha256,hashText(canonicalJSON(retained)));
    assert.equal(row.value,retained.summary);assert.equal(row.time.startYear,retained.eventFromYear);assert.equal(row.time.endYear,retained.eventToYear);
    assert.equal(row.compositionTime?.startYear,retained.writtenFromYear);assert.equal(row.compositionTime?.endYear,retained.writtenToYear);
    assert.deepEqual(row.provenance.bibliographySourceIds,retained.sourceIds);
  }
});
test('sparse intervals overlap query bounds inclusively, but do not fill centuries between Samarkand records',()=>{
  const both=createCatalogue([premodern]),i=premodernIntent(),scope={...i.scope,entityIds:['account-place-samarkand']};
  const query=(epoch:[number,number])=>resolvePlan(compileIntent({...i,scope:{...scope,epoch}},both),both);
  assert.equal(query([631,631]).observations.length,1);assert.equal(query([632,1403]).observations.length,0);
  assert.equal(query([1404,1404]).observations.length,1);assert.equal(query([630,1404]).observations.length,2);
});
test('event support and composition support remain separate and uncertainty does not become invented radii',()=>{
  const ib=premodern.fixture.observations.find(row=>row.id==='account-ibn-kilwa-1331');assert.ok(ib);
  assert.notDeepEqual(ib.compositionTime,ib.time);assert.equal(ib.confidence.kind,'not-supplied');
  assert.ok(premodern.fixture.entities.every(entity=>entity.spatialSupport.uncertaintyKm===null));
  assert.ok(premodern.fixture.sourcePins.every(source=>source.modelProcessing===false&&source.republication===false));
});
test('BCE and year-zero support uses the host astronomical-year convention without date fabrication',()=>{
  // Unmistakably synthetic test fixture: does not enter the registered real-data catalogue.
  const fixture=structuredClone(premodern.fixture);fixture.id='synthetic-bce-test';fixture.bounds.epoch=[-2,0];fixture.observations=[fixture.observations[0]];
  fixture.observations[0].time={startYear:-2,endYear:0,precision:'range',meaning:'Synthetic chronology test only'};
  const bytes=canonicalJSON(fixture),registered=registerFixture(bytes,hashText(bytes)),c=createCatalogue([registered]);
  const i=premodernIntent();i.scope={...i.scope,datasetId:registered.descriptor.id,entityIds:[fixture.observations[0].entityId],epoch:[0,0]};
  const result=resolvePlan(compileIntent(i,c),c);assert.equal(result.observations.length,1);assert.equal(result.observations[0].time.startYear,-2);
});
test('population and account descriptions cannot join through a made-up normalizer',()=>{
  const left={descriptor:modern.descriptor,entity:modern.fixture.entities[0],observation:modern.fixture.observations[0]};
  const right={descriptor:premodern.descriptor,entity:premodern.fixture.entities[0],observation:premodern.fixture.observations[0]};
  assert.throws(()=>requireRegisteredNormalizer(left,right,'population-to-trade',new Map()),code('INCOMPATIBLE_SEMANTICS'));
});
test('direct fabricated catalogue entries cannot bypass exact-byte registration',()=>{
  const forged={descriptor:modern.descriptor,fixture:{...modern.fixture,coverageNote:'Fabricated replacement'}};
  assert.throws(()=>createCatalogue([forged]),code('EDITION_MISMATCH'));
  assert.throws(()=>resolvePlan(compileIntent(intent(),catalogue),new Map([[modern.descriptor.id,forged]])),code('EDITION_MISMATCH'));
});
