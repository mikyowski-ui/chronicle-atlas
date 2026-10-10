import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PlannerBoundary,type PlannerProviderRequest} from '../research-semantic/planner.ts';
import {createProviderConnection,createOfflineProviderFixture,PROVIDER_FIELDS,PROVIDER_PROCESSING_POLICY,ProviderTransportError,type ProviderConfiguration,type ProviderConsent,type OfflineProviderTransport,type ProviderWireRequest} from '../research-semantic/provider-transport.ts';

const configuration=():ProviderConfiguration=>({schemaVersion:1,providerId:'synthetic-provider',modelId:'fixture-model',destination:'https://fixture.invalid/plan',credentialReference:'host-env-provider-key',budgets:{inputTokens:4096,outputTokens:4096,sessionTokens:32768,timeoutMs:1000,outputBytes:65536,toolCalls:0,repairAttempts:2}});
const consent=():ProviderConsent=>({schemaVersion:1,policyVersion:'synthetic-consent-1',modelProcessing:false,purpose:'offline-fixture',fields:PROVIDER_FIELDS.map(field=>({field,allow:true,decisionId:'synthetic-review'})),sourcePolicies:[{datasetId:'synthetic-dataset',modelProcessing:false}]});
const request=():PlannerProviderRequest=>({question:'Synthetic fixture question',context:{disclosure:'offline-fixture-only',catalogueVersion:'synthetic-catalogue',parentRevisionId:null,datasets:[{id:'synthetic-dataset',indicatorIds:['population'],entityIds:['synthetic-place']}]},signal:new AbortController().signal,attempt:0,repairCode:null,remainingTokens:16000,maxOutputBytes:65536,maxToolCalls:0});
const envelope={kind:'unsupported',reason:'UNSUPPORTED_SCOPE'};
const reply=(body:unknown=envelope)=>({status:200,contentType:'application/json',bytes:new TextEncoder().encode(JSON.stringify(body)),usage:{inputTokens:1,outputTokens:20,toolCalls:0}});
const fixture=(transport:OfflineProviderTransport={async exchange(){return reply();}},config=configuration(),permission=consent())=>createOfflineProviderFixture(config,permission,transport);
const fault=(code:string)=>(error:unknown)=>error instanceof ProviderTransportError&&error.code===code&&error.message===code;

test('missing configuration, key and token budgets degrade to PROVIDER_UNAVAILABLE before invocation',async()=>{
  const inputs=[{}, {configuration:null}, {configuration:{...configuration(),budgets:undefined}}, {configuration:{...configuration(),budgets:null}}, {configuration:{...configuration(),budgets:{...configuration().budgets,sessionTokens:0}}}, {configuration:configuration()}];
  for(const input of inputs){const connection=createProviderConnection(input);assert.equal(connection.mode,'unavailable');assert.equal(connection.status.code,'PROVIDER_UNAVAILABLE');await assert.rejects(connection.propose(request()),fault('PROVIDER_UNAVAILABLE'));}
  const noBudget={...configuration()} as Partial<ProviderConfiguration>;delete noBudget.budgets;
  assert.equal(createProviderConnection({configuration:noBudget}).status.reason,'MISSING_BUDGET');
});
test('production connection never reads a key value and consent cannot enable model processing',async()=>{
  let probes=0;const connection=createProviderConnection({configuration:configuration(),consent:{...consent(),purpose:'provider-processing-review'},credentials:{available(reference){probes++;assert.equal(reference,'host-env-provider-key');return true;}}});
  assert.equal(probes,1);assert.equal(connection.mode,'live-disabled');assert.equal(connection.status.reason,'MODEL_PROCESSING_DISABLED');
  assert.deepEqual(PROVIDER_PROCESSING_POLICY,{version:'m3-provider-closed-1',modelProcessing:false,liveServices:false,tools:0});
  await assert.rejects(connection.propose(request()),fault('LIVE_NOT_AUTHORIZED'));
  const result=await new PlannerBoundary(connection,()=>{throw Error('Validator must not run');}).propose('Private question',request().context);
  assert.equal(result.status,'error');if(result.status==='error')assert.equal(result.code,'LIVE_NOT_AUTHORIZED');assert.equal(result.receipt.attempts,0);
});
test('every transmitted field needs a distinct explicit consent decision',()=>{
  for(const field of PROVIDER_FIELDS){const permission=consent();permission.fields.find(f=>f.field===field)!.allow=false;const connection=createProviderConnection({configuration:configuration(),consent:permission,credentials:{available:()=>true}});assert.equal(connection.status.reason,'FIELD_CONSENT_DENIED');assert.throws(()=>fixture(undefined,configuration(),permission),fault('INVALID_REQUEST'));}
  for(const permission of [null,{...consent(),fields:consent().fields.slice(1)},{...consent(),fields:PROVIDER_FIELDS.map(()=>consent().fields[0])}])assert.equal(createProviderConnection({configuration:configuration(),consent:permission,credentials:{available:()=>true}}).mode,'unavailable');
});
test('source or global modelProcessing:true cannot be supplied as a consent override',()=>{
  for(const permission of [{...consent(),modelProcessing:true},{...consent(),sourcePolicies:[{datasetId:'synthetic-dataset',modelProcessing:true}]},{...consent(),liveServices:true}]){
    const connection=createProviderConnection({configuration:configuration(),consent:permission,credentials:{available:()=>true}});assert.equal(connection.status.reason,'INVALID_CONSENT');assert.throws(()=>createOfflineProviderFixture(configuration(),permission,{async exchange(){throw Error('never');}}),fault('INVALID_REQUEST'));
  }
});
test('configuration rejects secrets, URL credentials, query parameters, insecure endpoints and unknown controls',()=>{
  for(const config of [{...configuration(),apiKey:'SYNTHETIC_SECRET'},{...configuration(),destination:'http://provider.invalid/plan'},{...configuration(),destination:'https://user:secret@provider.invalid/plan'},{...configuration(),destination:'https://provider.invalid/plan?key=secret'},{...configuration(),liveEnabled:true},{...configuration(),budgets:{...configuration().budgets,toolCalls:1}}])assert.equal(createProviderConnection({configuration:config}).status.reason,'INVALID_CONFIGURATION');
});
test('production readiness diagnostics retain neither destinations, credential references nor error messages',()=>{
  const connection=createProviderConnection({configuration:configuration(),credentials:{available(){throw Error('SYNTHETIC_SECRET');}},consent:consent()});
  assert.equal(connection.status.reason,'MISSING_CREDENTIAL');const serialized=JSON.stringify(connection);assert.ok(!/SECRET|fixture.invalid|host-env|question|sourcePolicies/.test(serialized));assert.equal(Object.isFrozen(connection),true);assert.equal(Object.isFrozen(connection.status),true);
});
test('input duplicate keys, prototype pollution and accessors are rejected without executing getters',()=>{
  let reads=0;const config={...configuration()};Object.defineProperty(config,'providerId',{enumerable:true,get(){reads++;return 'synthetic-provider';}});
  const inheritedAccessor:unknown[]=[];Object.setPrototypeOf(inheritedAccessor,Object.create(Array.prototype,{toJSON:{get(){reads++;return undefined;}}}));
  for(const value of [config,inheritedAccessor,'{"schemaVersion":1,"schemaVersion":1}',JSON.parse('{"__proto__":{"polluted":true}}'),{...configuration(),constructor:{prototype:{polluted:true}}}])assert.equal(createProviderConnection({configuration:value}).mode,'unavailable');
  assert.equal(reads,0);assert.equal(Object.hasOwn(Object.prototype,'polluted'),false);
});
test('offline transport receives frozen minimized request and explicit caps, never credentials or source values',async()=>{
  let received:ProviderWireRequest|undefined;const adapter=fixture({async exchange(wire){received=wire;assert.equal(Object.isFrozen(wire),true);assert.equal(Object.isFrozen(wire.context.datasets[0].entityIds),true);return reply();}});
  const result=await adapter.propose(request());assert.deepEqual(result.output,envelope);assert.ok(received);assert.equal(received.limits.toolCalls,0);assert.equal(received.consent.modelProcessing,false);assert.equal(received.consent.purpose,'offline-fixture');
  const serialized=JSON.stringify(received);assert.ok(!/credential|destination|apiKey|sourcePins|observation|passage|locator/.test(serialized));assert.ok(result.usage.inputTokens>1);assert.equal(adapter.diagnostics().exchanges,1);
});
test('offline transport cannot be constructed for live destinations, review consent or non-synthetic providers',()=>{
  for(const config of [{...configuration(),destination:'https://api.example.com/plan'},{...configuration(),providerId:'production-provider'}])assert.throws(()=>fixture(undefined,config),fault('INVALID_REQUEST'));
  assert.throws(()=>fixture(undefined,configuration(),{...consent(),purpose:'provider-processing-review'}),fault('INVALID_REQUEST'));
});
test('configuration and consent are copied at construction; later host mutation cannot raise caps',async()=>{
  const config=configuration(),permission=consent();const adapter=fixture({async exchange(wire){assert.equal(wire.limits.outputTokens,4096);assert.equal(wire.consent.policyVersion,'synthetic-consent-1');return reply();}},config,permission);
  config.budgets.outputTokens=64000;permission.policyVersion='changed';permission.sourcePolicies[0].modelProcessing=false;await adapter.propose(request());
});
test('unreviewed dataset IDs, values, paths and getters never reach the offline transport',async()=>{
  let exchanges=0,reads=0;const adapter=fixture({async exchange(){exchanges++;return reply();}}),r=request();
  const getter={...r};Object.defineProperty(getter,'question',{enumerable:true,get(){reads++;return 'leak';}});
  for(const invalid of [getter,{...r,context:{...r.context,values:['restricted']}},{...r,context:{...r.context,datasets:[{...r.context.datasets[0],id:'unreviewed'}]}},{...r,tools:['file.read']},{...r,maxToolCalls:1}])await assert.rejects(adapter.propose(invalid as PlannerProviderRequest),fault('INVALID_REQUEST'));
  assert.equal(exchanges,0);assert.equal(reads,0);
});
test('session reservation, input byte accounting and attempt limits bound fixture calls',async()=>{
  let exchanges=0;const config=configuration();config.budgets.sessionTokens=8192;
  const adapter=fixture({async exchange(){exchanges++;throw Error('Unknown completion cost');}},config);
  await assert.rejects(adapter.propose(request()),fault('PROVIDER_FAILURE'));assert.equal(adapter.diagnostics().remainingSessionTokens,0);
  await assert.rejects(adapter.propose(request()),fault('BUDGET_EXCEEDED'));assert.equal(exchanges,1);
  await assert.rejects(fixture().propose({...request(),remainingTokens:4096}),fault('BUDGET_EXCEEDED'));
  await assert.rejects(fixture(undefined,{...configuration(),budgets:{...configuration().budgets,inputTokens:10}}).propose(request()),fault('BUDGET_EXCEEDED'));
  await assert.rejects(fixture(undefined,{...configuration(),budgets:{...configuration().budgets,repairAttempts:0}}).propose({...request(),attempt:1,repairCode:'INVALID_OUTPUT'}),fault('BUDGET_EXCEEDED'));
});
test('reported tool calls, token overrun, malformed usage and oversized output fail closed',async()=>{
  for(const usage of [{inputTokens:1,outputTokens:1,toolCalls:1},{inputTokens:4097,outputTokens:1,toolCalls:0},{inputTokens:1,outputTokens:4097,toolCalls:0}])await assert.rejects(fixture({async exchange(){return {...reply(),usage};}}).propose(request()),fault('BUDGET_EXCEEDED'));
  await assert.rejects(fixture({async exchange(){return {...reply(),usage:{inputTokens:-1,outputTokens:1,toolCalls:0}};}}).propose(request()),fault('INVALID_OUTPUT'));
  await assert.rejects(fixture({async exchange(){return {...reply(),bytes:new Uint8Array(65537)};}}).propose(request()),fault('BUDGET_EXCEEDED'));
});
test('duplicate and unsafe JSON keys, non-finite numbers, invalid UTF-8 and deep output are rejected',async()=>{
  const values=['{"kind":"unsupported","kind":"proposal"}','{"__proto__":{"polluted":true}}','{"constructor":{}}','{"value":1e999}','['.repeat(15)+'0'+']'.repeat(15),'not JSON'];
  for(const text of values)await assert.rejects(fixture({async exchange(){return {...reply(),bytes:new TextEncoder().encode(text)};}}).propose(request()),fault('INVALID_OUTPUT'));
  await assert.rejects(fixture({async exchange(){return {...reply(),bytes:new Uint8Array([0xc0,0xaf])};}}).propose(request()),fault('INVALID_OUTPUT'));assert.equal(Object.hasOwn(Object.prototype,'polluted'),false);
});
test('timeout settles an uncooperative fixture and retains its reservation',async()=>{
  const config=configuration();config.budgets.timeoutMs=10;const adapter=fixture({exchange:()=>new Promise(()=>{})},config);
  await assert.rejects(adapter.propose(request()),fault('TIMEOUT'));assert.equal(adapter.diagnostics().active,false);assert.equal(adapter.diagnostics().remainingSessionTokens,24576);
});
test('cancellation and one active exchange suppress late completion without claiming remote termination',async()=>{
  let complete:(r:ReturnType<typeof reply>)=>void=()=>{};const adapter=fixture({exchange:()=>new Promise(resolve=>{complete=resolve;})}),controller=new AbortController();
  const pending=adapter.propose({...request(),signal:controller.signal});await assert.rejects(adapter.propose(request()),fault('PROVIDER_UNAVAILABLE'));controller.abort();await assert.rejects(pending,fault('CANCELLED'));complete(reply());assert.equal(adapter.diagnostics().active,false);assert.equal(adapter.diagnostics().exchanges,1);
  await assert.rejects(adapter.propose({...request(),signal:controller.signal}),fault('CANCELLED'));assert.equal(adapter.diagnostics().exchanges,1);
});
test('provider failures and unsupported content types are sanitized without repair or raw output',async()=>{
  for(const transport of [{async exchange(){throw Error('PRIVATE_KEY_SENTINEL');}},{async exchange(){return {...reply(),status:429};}},{async exchange(){return {...reply(),contentType:'text/html'};}}])await assert.rejects(fixture(transport).propose(request()),fault('PROVIDER_FAILURE'));
});
test('offline wire adapter works behind unchanged planner validation and production has no network path',async()=>{
  const adapter=fixture(),r=request();const result=await new PlannerBoundary(adapter,()=>{throw Error('Unsupported envelopes do not validate a specification');}).propose(r.question,r.context);assert.equal(result.status,'unsupported');assert.equal(result.receipt.mode,'offline-fixture');assert.equal(result.receipt.attempts,1);
  const source=readFileSync(new URL('../research-semantic/provider-transport.ts',import.meta.url),'utf8');assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|node:https|node:http|process\.env|localStorage/.test(source));
  console.log('PROVIDER_TRANSPORT_VERIFICATION',JSON.stringify({policy:PROVIDER_PROCESSING_POLICY,liveRequests:0,fixtures:'synthetic-only',sourceProcessingConsentOverride:'rejected',networkImplementation:'absent'}));
});
