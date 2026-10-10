/** Provider-neutral proposal boundary. No live inference, retrieval, code or tools are enabled. */
import { boundedSemanticInput, type QueryIntent, type QueryPlan } from '@chronicle/contracts/research';

export type PlannerCode = 'PROVIDER_UNAVAILABLE'|'LIVE_NOT_AUTHORIZED'|'INVALID_REQUEST'|'INVALID_OUTPUT'|'PROVIDER_FAILURE'|'BUDGET_EXCEEDED'|'TIMEOUT'|'CANCELLED'|'STALE';
export type UnsupportedReason = 'UNSUPPORTED_QUANTITY'|'CONFLICTING_DEFINITIONS'|'INSUFFICIENT_EVIDENCE'|'UNSUPPORTED_SCOPE';
export interface PlannerSpecification {readonly intent:QueryIntent;readonly plan:QueryPlan}
/** Host-authored identifiers only, not descriptors, labels, passages, values or URLs. */
export interface PermittedPlannerContext {
  readonly disclosure:'offline-fixture-only'|'synthetic-opt-in';
  readonly catalogueVersion:string;
  readonly datasets:readonly {readonly id:string;readonly indicatorIds:readonly string[];readonly entityIds:readonly string[]}[];
  readonly parentRevisionId:string|null;
}
export interface PlannerBudgets {readonly timeoutMs:number;readonly tokens:number;readonly toolCalls:0;readonly repairs:number;readonly outputBytes:number}
export const DEFAULT_PLANNER_BUDGETS:PlannerBudgets=Object.freeze({timeoutMs:10000,tokens:16000,toolCalls:0,repairs:2,outputBytes:65536});
export interface PlannerProviderRequest {
  readonly question:string;readonly context:PermittedPlannerContext;readonly signal:AbortSignal;
  readonly attempt:number;readonly repairCode:'INVALID_OUTPUT'|null;
  readonly remainingTokens:number;readonly maxOutputBytes:number;readonly maxToolCalls:0;
}
export interface PlannerProviderResponse {readonly output:unknown;readonly usage:{readonly inputTokens:number;readonly outputTokens:number;readonly toolCalls:number}}
export interface PlannerProvider {
  readonly mode:'unavailable'|'offline-fixture'|'live-disabled'|'live-opt-in';
  propose(request:PlannerProviderRequest):Promise<PlannerProviderResponse>;
}
export class PlannerProviderError extends Error {constructor(readonly code:PlannerCode){super(code);this.name='PlannerProviderError';}}
export const unavailablePlanner:PlannerProvider=Object.freeze({mode:'unavailable',async propose(){throw new Error('Unavailable');}});
export interface PlannerReceipt {readonly attempts:number;readonly tokens:number;readonly toolCalls:0;readonly mode:PlannerProvider['mode']}
export type PlannerResult<S> =
  | {readonly status:'proposed';readonly specification:S;readonly receipt:PlannerReceipt}
  | {readonly status:'unsupported';readonly reason:UnsupportedReason;readonly receipt:PlannerReceipt}
  | {readonly status:'error';readonly code:PlannerCode;readonly receipt:PlannerReceipt};
export interface PlannerLog {readonly event:'started'|'repair'|'completed'|'rejected';readonly attempt:number;readonly code:PlannerCode|null;readonly tokens:number}
const reasons:readonly string[]=['UNSUPPORTED_QUANTITY','CONFLICTING_DEFINITIONS','INSUFFICIENT_EVIDENCE','UNSUPPORTED_SCOPE'];
const idPattern=/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/;
const ownKeys=(value:object,keys:readonly string[]):boolean=>Object.keys(value).length===keys.length&&Object.keys(value).every(key=>keys.includes(key));
class PlannerFault extends Error {constructor(readonly code:PlannerCode){super(code);}}
const fail=(code:PlannerCode):never=>{throw new PlannerFault(code);};
function validateContext(value:PermittedPlannerContext,disclosure:PermittedPlannerContext['disclosure']):PermittedPlannerContext {
  const context=boundedSemanticInput(value,32768) as PermittedPlannerContext;
  if(!context||typeof context!=='object'||!ownKeys(context,['disclosure','catalogueVersion','datasets','parentRevisionId'])||context.disclosure!==disclosure||typeof context.catalogueVersion!=='string'||!idPattern.test(context.catalogueVersion)||!(context.parentRevisionId===null||typeof context.parentRevisionId==='string'&&idPattern.test(context.parentRevisionId))||!Array.isArray(context.datasets)||context.datasets.length<1||context.datasets.length>16)fail('INVALID_REQUEST');
  const seen=new Set<string>();
  for(const dataset of context.datasets){
    if(!dataset||typeof dataset!=='object'||!ownKeys(dataset,['id','indicatorIds','entityIds'])||typeof dataset.id!=='string'||!idPattern.test(dataset.id)||seen.has(dataset.id))fail('INVALID_REQUEST');
    seen.add(dataset.id);
    for(const values of [dataset.indicatorIds,dataset.entityIds])if(!Array.isArray(values)||values.length<1||values.length>2000||new Set(values).size!==values.length||values.some(value=>typeof value!=='string'||!idPattern.test(value)))fail('INVALID_REQUEST');
  }
  // The provider gets its own frozen copy; host input changes cannot alter an in-flight request.
  const copy=JSON.parse(JSON.stringify(context)) as PermittedPlannerContext;
  for(const dataset of copy.datasets){Object.freeze(dataset.indicatorIds);Object.freeze(dataset.entityIds);Object.freeze(dataset);}Object.freeze(copy.datasets);return Object.freeze(copy);
}
function validateBudgets(input:Partial<PlannerBudgets>):PlannerBudgets {
  if(Object.keys(input).some(key=>!Object.keys(DEFAULT_PLANNER_BUDGETS).includes(key)))fail('INVALID_REQUEST');
  const b={...DEFAULT_PLANNER_BUDGETS,...input};
  if(!Number.isInteger(b.timeoutMs)||b.timeoutMs<1||b.timeoutMs>60000||!Number.isInteger(b.tokens)||b.tokens<1||b.tokens>64000||b.toolCalls!==0||!Number.isInteger(b.repairs)||b.repairs<0||b.repairs>2||!Number.isInteger(b.outputBytes)||b.outputBytes<1||b.outputBytes>65536)fail('INVALID_REQUEST');
  return b;
}
function parseEnvelope(value:unknown):{kind:'proposal';specification:unknown}|{kind:'unsupported';reason:UnsupportedReason} {
  if(!value||typeof value!=='object'||Array.isArray(value))fail('INVALID_OUTPUT');
  const v=value as {kind?:unknown;specification?:unknown;reason?:unknown};
  if(v.kind==='proposal'&&ownKeys(v,['kind','specification']))return {kind:'proposal',specification:v.specification};
  if(v.kind==='unsupported'&&ownKeys(v,['kind','reason'])&&typeof v.reason==='string'&&reasons.includes(v.reason))return {kind:'unsupported',reason:v.reason as UnsupportedReason};
  return fail('INVALID_OUTPUT');
}
/** Trusted caller injects the SAME complete runtime validator used before workspace activation.
 * This boundary never executes a plan or changes the current workspace. */
export class PlannerBoundary<S extends PlannerSpecification> {
  private generation=0;
  private active:AbortController|null=null;
  constructor(private readonly provider:PlannerProvider,private readonly validateSpecification:(value:unknown)=>S,private readonly log:(entry:PlannerLog)=>void=()=>{}){}
  cancel():void {this.active?.abort();}
  async propose(question:string,contextInput:PermittedPlannerContext,options:{signal?:AbortSignal;budgets?:Partial<PlannerBudgets>;allowLiveSynthetic?:boolean}={}):Promise<PlannerResult<S>> {
    const generation=++this.generation;this.active?.abort();
    const controller=new AbortController();this.active=controller;
    let attempts=0,tokens=0,timer:ReturnType<typeof setTimeout>|undefined,abortListener:(()=>void)|undefined,externalListener:(()=>void)|undefined;
    let timedOut=false;
    const receipt=():PlannerReceipt=>({attempts,tokens,toolCalls:0,mode:this.provider.mode});
    const emit=(event:PlannerLog['event'],code:PlannerCode|null=null):void=>{try{this.log(Object.freeze({event,attempt:attempts,code,tokens}));}catch{/* Observability cannot override the result. */}};
    const check=():void=>{if(generation!==this.generation)fail('STALE');if(timedOut)fail('TIMEOUT');if(controller.signal.aborted)fail('CANCELLED');};
    try{
      if(this.provider.mode==='unavailable')fail('PROVIDER_UNAVAILABLE');
      if(this.provider.mode!=='offline-fixture'&&!(this.provider.mode==='live-opt-in'&&options.allowLiveSynthetic===true))fail('LIVE_NOT_AUTHORIZED');
      const budgets=validateBudgets(options.budgets??{}),context=validateContext(contextInput,this.provider.mode==='live-opt-in'?'synthetic-opt-in':'offline-fixture-only');
      if(this.provider.mode==='live-opt-in'&&(!context.catalogueVersion.startsWith('synthetic-')||context.parentRevisionId!==null&&!context.parentRevisionId.startsWith('synthetic-')||context.datasets.some(dataset=>!dataset.id.startsWith('synthetic-')||dataset.entityIds.some(id=>!id.startsWith('synthetic-')))))fail('INVALID_REQUEST');
      if(typeof question!=='string'||question.trim().length===0||new TextEncoder().encode(question).byteLength>4000||/[\u0000-\u0008]/.test(question))fail('INVALID_REQUEST');
      if(options.signal?.aborted)controller.abort();
      externalListener=()=>controller.abort();options.signal?.addEventListener('abort',externalListener,{once:true});
      check();
      const deadline=new Promise<never>((_,reject)=>{
        abortListener=()=>reject(new PlannerFault(generation!==this.generation?'STALE':timedOut?'TIMEOUT':'CANCELLED'));
        controller.signal.addEventListener('abort',abortListener,{once:true});
        timer=setTimeout(()=>{timedOut=true;controller.abort();},budgets.timeoutMs);
      });
      emit('started');
      for(let attempt=0;attempt<=budgets.repairs;attempt++){
        check();attempts++;
        // UTF-8 bytes are a deliberately conservative preflight charge, not a tokenizer measurement.
        const preflight=new TextEncoder().encode(JSON.stringify({question,context,attempt,repairCode:attempt?'INVALID_OUTPUT':null})).byteLength;
        if(preflight>budgets.tokens-tokens)fail('BUDGET_EXCEEDED');
        let response:PlannerProviderResponse;
        try{response=await Promise.race([this.provider.propose(Object.freeze({question,context,signal:controller.signal,attempt,repairCode:attempt?'INVALID_OUTPUT':null,remainingTokens:budgets.tokens-tokens,maxOutputBytes:budgets.outputBytes,maxToolCalls:0})),deadline]);}
        catch(error){if(error instanceof PlannerFault)throw error;check();if(this.provider.mode==='live-opt-in'&&error instanceof PlannerProviderError)return fail(error.code);return fail('PROVIDER_FAILURE');}
        check();
        if(!response||typeof response!=='object'||!ownKeys(response,['output','usage'])||!response.usage||typeof response.usage!=='object'||!ownKeys(response.usage,['inputTokens','outputTokens','toolCalls']))fail('INVALID_OUTPUT');
        const usage=response.usage;
        if([usage.inputTokens,usage.outputTokens,usage.toolCalls].some(value=>!Number.isSafeInteger(value)||value<0))fail('INVALID_OUTPUT');
        tokens+=Math.max(preflight,usage.inputTokens)+usage.outputTokens;
        if(tokens>budgets.tokens||usage.toolCalls!==0)fail('BUDGET_EXCEEDED');
        try{
          const envelope=parseEnvelope(boundedSemanticInput(response.output,budgets.outputBytes));
          if(envelope.kind==='unsupported'){emit('completed');return {status:'unsupported',reason:envelope.reason,receipt:receipt()};}
          const specification=this.validateSpecification(envelope.specification);
          check();
          if(specification.intent.question!==question||specification.intent.parentId!==context.parentRevisionId)fail('INVALID_OUTPUT');
          const scope=specification.plan.scope,permitted=context.datasets.find(dataset=>dataset.id===scope.datasetId);
          if(!permitted||!permitted.indicatorIds.includes(scope.indicatorId)||scope.entityIds.some(id=>!permitted.entityIds.includes(id)))fail('INVALID_OUTPUT');
          emit('completed');return {status:'proposed',specification,receipt:receipt()};
        }catch(error){
          if(error instanceof PlannerFault&&error.code!=='INVALID_OUTPUT')throw error;
          if(attempt===budgets.repairs)fail('INVALID_OUTPUT');
          emit('repair','INVALID_OUTPUT');
        }
      }
      return fail('INVALID_OUTPUT');
    }catch(error){const code=error instanceof PlannerFault?error.code:'INVALID_REQUEST';emit('rejected',code);return {status:'error',code,receipt:receipt()};}
    finally{if(timer!==undefined)clearTimeout(timer);if(abortListener)controller.signal.removeEventListener('abort',abortListener);if(externalListener)options.signal?.removeEventListener('abort',externalListener);if(this.active===controller)this.active=null;}
  }
}

export const EVALUATION_METRICS=['planValidity','answerabilityHandling','numericalCorrectness','evidenceClaimSupport','followupFidelity'] as const;
export type EvaluationMetric=typeof EVALUATION_METRICS[number];
export type EvaluationScores=Readonly<Record<EvaluationMetric,boolean|null>>;
export interface OfflineEvaluationCase<S> {readonly id:string;readonly category:string;run():Promise<PlannerResult<S>>;score(result:PlannerResult<S>):EvaluationScores}
/** Fixtures exercise mechanics and trusted execution only; they do not evaluate a live model. */
export async function evaluateOfflinePlanner<S>(cases:readonly OfflineEvaluationCase<S>[]):Promise<{mode:'offline-fixtures';liveGenerationEvaluated:false;cases:readonly {id:string;category:string;status:PlannerResult<S>['status'];scores:EvaluationScores}[];metrics:Record<EvaluationMetric,{passed:number;failed:number;notApplicable:number}>}> {
  if(cases.length>1000||new Set(cases.map(c=>c.id)).size!==cases.length||cases.some(c=>!idPattern.test(c.id)||!idPattern.test(c.category)))throw new Error('Invalid offline evaluation suite');
  const metrics=Object.fromEntries(EVALUATION_METRICS.map(key=>[key,{passed:0,failed:0,notApplicable:0}])) as Record<EvaluationMetric,{passed:number;failed:number;notApplicable:number}>;
  const rows=[];
  for(const item of cases){const result=await item.run(),scores=item.score(result);for(const key of EVALUATION_METRICS){if(scores[key]===null)metrics[key].notApplicable++;else if(scores[key]===true)metrics[key].passed++;else if(scores[key]===false)metrics[key].failed++;else throw new Error('Invalid evaluation score');}rows.push({id:item.id,category:item.category,status:result.status,scores});}
  return {mode:'offline-fixtures',liveGenerationEvaluated:false,cases:rows,metrics};
}
