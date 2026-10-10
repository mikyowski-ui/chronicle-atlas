/** Transport preparation only. There is deliberately no network implementation or live activation switch. */
import {z} from '@chronicle/contracts/schema';
import {boundedSemanticInput} from '@chronicle/contracts/research';
import {PlannerProviderError,type PlannerCode,type PlannerProvider,type PlannerProviderRequest,type PlannerProviderResponse} from './planner.ts';

export const PROVIDER_TRANSPORT_VERSION='chronicle-provider-transport-1' as const;
export const PROVIDER_PROCESSING_POLICY=Object.freeze({version:'m3-provider-closed-1',modelProcessing:false,liveServices:false,tools:0} as const);
export const PROVIDER_FIELDS=['question','context.catalogueVersion','context.parentRevisionId','context.datasets.id','context.datasets.indicatorIds','context.datasets.entityIds'] as const;
const id=z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const positive=(max:number)=>z.number().int().min(1).max(max);
const destination=z.string().max(2048).refine(value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash;}catch{return false;}},'An explicit HTTPS destination without credentials or query parameters is required.');
export const ProviderConfigurationSchema=z.strictObject({
  schemaVersion:z.literal(1),providerId:id,modelId:id,destination,credentialReference:id,
  budgets:z.strictObject({inputTokens:positive(64000),outputTokens:positive(64000),sessionTokens:positive(1000000),timeoutMs:positive(10000),outputBytes:positive(65536),toolCalls:z.literal(0),repairAttempts:z.number().int().min(0).max(2)}),
}).refine(v=>v.budgets.inputTokens+v.budgets.outputTokens<=v.budgets.sessionTokens,'Session budget must cover one reserved attempt.');
export type ProviderConfiguration=z.infer<typeof ProviderConfigurationSchema>;
export const ProviderConsentSchema=z.strictObject({
  schemaVersion:z.literal(1),policyVersion:id,modelProcessing:z.literal(false),
  purpose:z.enum(['offline-fixture','provider-processing-review']),
  fields:z.array(z.strictObject({field:z.enum(PROVIDER_FIELDS),allow:z.boolean(),decisionId:id})).length(PROVIDER_FIELDS.length),
  sourcePolicies:z.array(z.strictObject({datasetId:id,modelProcessing:z.literal(false)})).min(1).max(16),
}).refine(v=>new Set(v.fields.map(f=>f.field)).size===PROVIDER_FIELDS.length&&new Set(v.sourcePolicies.map(s=>s.datasetId)).size===v.sourcePolicies.length,'Field and source decisions must be unique.');
export type ProviderConsent=z.infer<typeof ProviderConsentSchema>;

/** A presence probe runs in trusted host code. Neither this module nor the browser receives a key value. */
export interface ProviderCredentialProbe {available(reference:string):boolean}
export interface ProviderConnectionInput {readonly configuration?:unknown;readonly consent?:unknown;readonly credentials?:ProviderCredentialProbe|null}
export type ProviderReadinessReason='MISSING_CONFIGURATION'|'INVALID_CONFIGURATION'|'MISSING_BUDGET'|'MISSING_CREDENTIAL'|'MISSING_CONSENT'|'INVALID_CONSENT'|'FIELD_CONSENT_DENIED'|'MODEL_PROCESSING_DISABLED';
export interface ProviderConnectionStatus {
  readonly code:'PROVIDER_UNAVAILABLE'|'LIVE_NOT_AUTHORIZED';readonly reason:ProviderReadinessReason;
  readonly modelProcessing:false;readonly liveServices:false;readonly configurationPresent:boolean;readonly credentialPresent:boolean;
}
export interface ProviderConnection extends PlannerProvider {readonly mode:'unavailable'|'live-disabled';readonly status:ProviderConnectionStatus}
export class ProviderTransportError extends PlannerProviderError {constructor(code:PlannerCode){super(code);this.name='ProviderTransportError';}}
function fail(code:PlannerCode):never {throw new ProviderTransportError(code);}
const freeze=<T>(value:T):T=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
/** JSON-only values: inspect descriptors before traversal so accessors are never invoked. */
export function checkedInput(input:unknown,maxBytes:number):unknown {
  if(typeof input==='string'){
    if(input.length>maxBytes)fail('INVALID_REQUEST');
    return decodeOutput(new TextEncoder().encode(input),maxBytes);
  }
  let nodes=0;const ancestors=new Set<object>();
  const visit=(value:unknown,depth:number):void=>{
    if(++nodes>250000||depth>14)fail('INVALID_REQUEST');
    if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return;
    if(typeof value!=='object'||ancestors.has(value))fail('INVALID_REQUEST');
    const prototype=Object.getPrototypeOf(value);
    if(Array.isArray(value)?prototype!==Array.prototype:![Object.prototype,null].includes(prototype))fail('INVALID_REQUEST');
    ancestors.add(value);
    for(const key of Reflect.ownKeys(value)){
      if(Array.isArray(value)&&key==='length')continue;
      const descriptor=Object.getOwnPropertyDescriptor(value,key);
      if(typeof key!=='string'||['__proto__','prototype','constructor'].includes(key)||!descriptor||!('value' in descriptor)||!descriptor.enumerable)fail('INVALID_REQUEST');
      visit(descriptor.value,depth+1);
    }
    ancestors.delete(value);
  };
  visit(input,0);return boundedSemanticInput(input,maxBytes);
}
function parseConfiguration(input:unknown):ProviderConfiguration {return freeze(ProviderConfigurationSchema.parse(checkedInput(input,16384)));}
function parseConsent(input:unknown):ProviderConsent {return freeze(ProviderConsentSchema.parse(checkedInput(input,16384)));}

/** Production entry point. Even complete configuration and consent cannot override source/modelProcessing:false. */
export function createProviderConnection(input:ProviderConnectionInput={}):ProviderConnection {
  let configurationPresent=false,credentialPresent=false;
  const closed=(reason:ProviderReadinessReason):ProviderConnection=>{
    const code=reason==='MODEL_PROCESSING_DISABLED'?'LIVE_NOT_AUTHORIZED':'PROVIDER_UNAVAILABLE';
    const status=Object.freeze({code,reason,modelProcessing:false,liveServices:false,configurationPresent,credentialPresent} as const);
    return Object.freeze({mode:code==='PROVIDER_UNAVAILABLE'?'unavailable':'live-disabled',status,async propose(){return fail(code);}});
  };
  if(input.configuration===null||input.configuration===undefined)return closed('MISSING_CONFIGURATION');
  let configuration:ProviderConfiguration;
  try{
    const raw=checkedInput(input.configuration,16384);
    if(raw&&typeof raw==='object'&&!Array.isArray(raw)&&(!Object.hasOwn(raw,'budgets')||(raw as {budgets?:unknown}).budgets===null))return closed('MISSING_BUDGET');
    configuration=parseConfiguration(raw);configurationPresent=true;
  }catch{return closed('INVALID_CONFIGURATION');}
  try{credentialPresent=input.credentials?.available(configuration.credentialReference)===true;}catch{/* Presence-probe details and errors never leave trusted host code. */}
  if(!credentialPresent)return closed('MISSING_CREDENTIAL');
  if(input.consent===null||input.consent===undefined)return closed('MISSING_CONSENT');
  let consent:ProviderConsent;try{consent=parseConsent(input.consent);}catch{return closed('INVALID_CONSENT');}
  if(consent.fields.some(field=>!field.allow))return closed('FIELD_CONSENT_DENIED');
  return closed('MODEL_PROCESSING_DISABLED');
}

const dataset=z.strictObject({id,indicatorIds:z.array(id).min(1).max(2000),entityIds:z.array(id).min(1).max(2000)})
  .refine(v=>new Set(v.indicatorIds).size===v.indicatorIds.length&&new Set(v.entityIds).size===v.entityIds.length,'Duplicate identifiers.');
const requestSchema=z.strictObject({question:z.string().min(1).max(4000).refine(v=>v.trim().length>0&&new TextEncoder().encode(v).length<=4000&&!/[\u0000-\u0008]/.test(v)),
  context:z.strictObject({disclosure:z.literal('offline-fixture-only'),catalogueVersion:id,datasets:z.array(dataset).min(1).max(16),parentRevisionId:id.nullable()})
    .refine(v=>new Set(v.datasets.map(d=>d.id)).size===v.datasets.length,'Duplicate datasets.'),
  attempt:z.number().int().min(0).max(2),repairCode:z.literal('INVALID_OUTPUT').nullable(),remainingTokens:positive(64000),maxOutputBytes:positive(65536),maxToolCalls:z.literal(0),
}).refine(v=>v.repairCode===(v.attempt===0?null:'INVALID_OUTPUT'),'Repair sequence mismatch.');
export interface ProviderWireRequest {
  readonly protocol:typeof PROVIDER_TRANSPORT_VERSION;readonly providerId:string;readonly modelId:string;
  readonly question:string;readonly context:PlannerProviderRequest['context'];readonly attempt:number;readonly repairCode:'INVALID_OUTPUT'|null;
  readonly limits:{readonly inputTokens:number;readonly outputTokens:number;readonly outputBytes:number;readonly toolCalls:0};
  readonly consent:{readonly policyVersion:string;readonly purpose:'offline-fixture';readonly modelProcessing:false};
}
/** Controlled fixture transport, not a sandbox for hostile host adapter functions. No credentials or URL are passed. */
export interface OfflineProviderTransport {
  exchange(request:ProviderWireRequest,signal:AbortSignal):Promise<{
    readonly status:number;readonly contentType:string;readonly bytes:Uint8Array;
    readonly usage:{readonly inputTokens:number;readonly outputTokens:number;readonly toolCalls:number};
  }>;
}
export interface OfflineProviderFixture extends PlannerProvider {
  readonly mode:'offline-fixture';diagnostics():{readonly mode:'offline-fixture';readonly remainingSessionTokens:number;readonly active:boolean;readonly exchanges:number;readonly modelProcessing:false};
}

/** Bounded strict JSON decoding rejects invalid UTF-8, duplicate/unsafe keys before envelope validation. */
export function decodeOutput(bytes:Uint8Array,limit:number):unknown {
  if(!(bytes instanceof Uint8Array)||bytes.byteLength>limit)fail('BUDGET_EXCEEDED');
  let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{return fail('INVALID_OUTPUT');}
  const stack:{kind:'object'|'array';keys:Set<string>}[]=[];
  try{
    for(let i=0;i<text.length;i++){
      const c=text[i];
      if(c==='{'||c==='['){stack.push({kind:c==='{'?'object':'array',keys:new Set()});if(stack.length>14)fail('INVALID_OUTPUT');}
      else if(c==='}'||c===']')stack.pop();
      else if(c==='"'){
        const start=i;for(i++;i<text.length;i++){if(text[i]==='\\')i++;else if(text[i]==='"')break;}
        let next=i+1;while(/\s/.test(text[next]??'')&&next<text.length)next++;
        if(text[next]===':'){
          const key:unknown=JSON.parse(text.slice(start,i+1)),frame=stack.at(-1);
          if(typeof key!=='string'||frame?.kind!=='object'||frame.keys.has(key)||['__proto__','prototype','constructor'].includes(key))fail('INVALID_OUTPUT');
          frame.keys.add(key);
        }
      }
    }
    return boundedSemanticInput(JSON.parse(text),limit);
  }catch{return fail('INVALID_OUTPUT');}
}

/** Explicit test seam. Only synthetic .invalid destinations and offline consent enter this path. */
export function createOfflineProviderFixture(configurationInput:unknown,consentInput:unknown,transport:OfflineProviderTransport):OfflineProviderFixture {
  let configuration:ProviderConfiguration,consent:ProviderConsent;
  try{configuration=parseConfiguration(configurationInput);consent=parseConsent(consentInput);}catch{return fail('INVALID_REQUEST');}
  if(!configuration.providerId.startsWith('synthetic-')||!new URL(configuration.destination).hostname.endsWith('.invalid')||consent.purpose!=='offline-fixture'||consent.fields.some(f=>!f.allow))fail('INVALID_REQUEST');
  let remainingSessionTokens=configuration.budgets.sessionTokens,active=false,exchanges=0;
  return Object.freeze({mode:'offline-fixture' as const,diagnostics:()=>Object.freeze({mode:'offline-fixture' as const,remainingSessionTokens,active,exchanges,modelProcessing:false as const}),
    async propose(input:PlannerProviderRequest):Promise<PlannerProviderResponse>{
      if(active)fail('PROVIDER_UNAVAILABLE');
      let request:z.infer<typeof requestSchema>;
      try{
        if(!input||typeof input!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(input)))fail('INVALID_REQUEST');
        const descriptors=Object.getOwnPropertyDescriptors(input);
        if(Reflect.ownKeys(input).some(k=>typeof k!=='string'||!['question','context','signal','attempt','repairCode','remainingTokens','maxOutputBytes','maxToolCalls'].includes(k))||Object.values(descriptors).some(d=>!('value' in d)||!d.enumerable)||!(descriptors.signal?.value instanceof AbortSignal))fail('INVALID_REQUEST');
        const {signal:_,...data}=input;request=requestSchema.parse(checkedInput(data,65536));
      }catch{return fail('INVALID_REQUEST');}
      if(input.signal.aborted)fail('CANCELLED');
      if(request.attempt>configuration.budgets.repairAttempts)fail('BUDGET_EXCEEDED');
      if(request.context.datasets.some(d=>!consent.sourcePolicies.some(p=>p.datasetId===d.id&&p.modelProcessing===false)))fail('INVALID_REQUEST');
      const limits={inputTokens:configuration.budgets.inputTokens,outputTokens:Math.min(configuration.budgets.outputTokens,request.remainingTokens-configuration.budgets.inputTokens),outputBytes:Math.min(configuration.budgets.outputBytes,request.maxOutputBytes),toolCalls:0 as const};
      if(limits.outputTokens<1)fail('BUDGET_EXCEEDED');
      const wire=freeze({protocol:PROVIDER_TRANSPORT_VERSION,providerId:configuration.providerId,modelId:configuration.modelId,question:request.question,context:request.context,attempt:request.attempt,repairCode:request.repairCode,limits,consent:{policyVersion:consent.policyVersion,purpose:'offline-fixture' as const,modelProcessing:false as const}});
      const inputCharge=new TextEncoder().encode(JSON.stringify(wire)).byteLength,reservation=limits.inputTokens+limits.outputTokens;
      if(inputCharge>limits.inputTokens||reservation>remainingSessionTokens)fail('BUDGET_EXCEEDED');
      remainingSessionTokens-=reservation;active=true;
      const controller=new AbortController();let timedOut=false,timer:ReturnType<typeof setTimeout>|undefined,abort:()=>void=()=>{},rejectAbort:()=>void=()=>{};
      try{
        const cancelled=new Promise<never>((_,reject)=>{rejectAbort=()=>reject(new ProviderTransportError(timedOut?'TIMEOUT':'CANCELLED'));controller.signal.addEventListener('abort',rejectAbort,{once:true});});
        abort=()=>controller.abort();input.signal.addEventListener('abort',abort,{once:true});
        timer=setTimeout(()=>{timedOut=true;controller.abort();},configuration.budgets.timeoutMs);exchanges++;
        const reply=await Promise.race([transport.exchange(wire,controller.signal),cancelled]);
        if(controller.signal.aborted)fail(timedOut?'TIMEOUT':'CANCELLED');
        if(!reply||typeof reply!=='object'||Object.keys(reply).length!==4||Object.keys(reply).some(k=>!['status','contentType','bytes','usage'].includes(k))||reply.status!==200||reply.contentType!=='application/json')fail('PROVIDER_FAILURE');
        if(!reply.usage||typeof reply.usage!=='object'||Object.keys(reply.usage).length!==3||Object.keys(reply.usage).some(k=>!['inputTokens','outputTokens','toolCalls'].includes(k)))fail('INVALID_OUTPUT');
        const usage=reply.usage;
        if([usage.inputTokens,usage.outputTokens,usage.toolCalls].some(n=>!Number.isSafeInteger(n)||n<0))fail('INVALID_OUTPUT');
        if(usage.inputTokens>limits.inputTokens||usage.outputTokens>limits.outputTokens||usage.toolCalls!==0)fail('BUDGET_EXCEEDED');
        const output=decodeOutput(reply.bytes,limits.outputBytes),inputTokens=Math.max(inputCharge,usage.inputTokens),outputTokens=Math.max(reply.bytes.byteLength,usage.outputTokens);
        if(outputTokens>limits.outputTokens)fail('BUDGET_EXCEEDED');
        remainingSessionTokens+=reservation-inputTokens-outputTokens;
        return {output,usage:{inputTokens,outputTokens,toolCalls:0}};
      }catch(error){if(error instanceof ProviderTransportError)throw error;return fail('PROVIDER_FAILURE');}
      finally{if(timer!==undefined)clearTimeout(timer);input.signal.removeEventListener('abort',abort);controller.signal.removeEventListener('abort',rejectAbort);controller.abort();active=false;}
    },
  });
}
