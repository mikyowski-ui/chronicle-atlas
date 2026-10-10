import { LIMITS, ResearchError, type ErrorCode, type ResearchEntity, type ResearchObservation, type ResearchSource, type TimeWindow } from './contracts.ts';
import { canonicalJSON, immutable, ResearchEngine, type DatasetRegistry, type PreparedResult } from './engine.ts';
import { createRegistry } from './registry.ts';

export interface Selection {entityId:string;observationId:string}
export interface WorkspaceSnapshot {
  revision:number;pendingRevision:number;status:'idle'|'loading'|'ready'|'error';message:string;errorCode:ErrorCode|null;
  cursorYear:number;analysisTimeWindow:TimeWindow|null;selection:Selection|null;active:PreparedResult|null;
  selectedEvidence:{observation:ResearchObservation;entity:ResearchEntity;source:ResearchSource;visible:boolean}|null;
}
export type WorkspaceAction =
  | {type:'cursor';year:number;origin:string;revision:number}
  | {type:'select';entityId:string;observationId:string;origin:string;revision:number}
  | {type:'clear-selection';origin:string;revision:number};
export interface ControllerOptions {registry?:DatasetRegistry;timeoutMs?:number}

/** Host-owned store: all research views subscribe to one atomic revision. */
export class ResearchController {
  private readonly engine:ResearchEngine;
  private readonly listeners=new Set<(state:WorkspaceSnapshot)=>void>();
  private readonly timeoutMs:number;
  private request=0;
  private pending:AbortController|null=null;
  private disposed=false;
  private commits=0;
  private state:WorkspaceSnapshot;
  constructor(initialCursorYear:number,options:ControllerOptions={}){
    if(!Number.isFinite(initialCursorYear)||initialCursorYear < -12000||initialCursorYear > 3000)throw new ResearchError('INVALID_SPEC','Invalid host year.');
    this.engine=new ResearchEngine(options.registry??createRegistry());
    this.timeoutMs=options.timeoutMs??LIMITS.timeoutMs;
    this.state=immutable({revision:0,pendingRevision:0,status:'idle',message:'Prepared example — planner not enabled.',errorCode:null,cursorYear:initialCursorYear,analysisTimeWindow:null,selection:null,active:null,selectedEvidence:null});
  }
  getSnapshot():WorkspaceSnapshot{return this.state;}
  subscribe(listener:(state:WorkspaceSnapshot)=>void):()=>void{
    if(this.disposed)throw new ResearchError('CANCELLED','Workspace disposed.');
    this.listeners.add(listener);listener(this.state);return()=>{this.listeners.delete(listener);};
  }
  private update(patch:Partial<WorkspaceSnapshot>):void{
    const next={...this.state,...patch};
    const evidence=next.active&&next.selection?this.engine.evidence(next.active.plan.datasetId,next.selection,next.active.bundle.descriptor):null;
    next.selectedEvidence=evidence?{...evidence,visible:next.active!.bundle.observations.some(r=>r.id===evidence.observation.id)}:null;
    this.state=immutable(next);
    for(const listener of this.listeners)listener(this.state);
  }
  dispatch(action:WorkspaceAction):boolean{
    if(this.disposed||!action||action.revision!==this.state.revision||typeof action.origin!=='string'||action.origin.length>120)return false;
    if(action.type==='cursor'){
      if(!Number.isFinite(action.year)||action.year < -12000||action.year > 3000)return false;
      if(action.year===this.state.cursorYear)return false;
      this.update({cursorYear:action.year});return true;
    }
    if(action.type==='clear-selection'){
      if(!this.state.selection)return false;
      this.update({selection:null});return true;
    }
    if(action.type==='select'){
      const active=this.state.active;
      if(!active||!this.engine.evidence(active.plan.datasetId,action,active.bundle.descriptor))return false;
      if(this.state.selection?.entityId===action.entityId&&this.state.selection.observationId===action.observationId)return false;
      this.update({selection:{entityId:action.entityId,observationId:action.observationId}});return true;
    }
    return false;
  }
  private async stage(input:unknown,replay:boolean):Promise<boolean>{
    if(this.disposed)return false;
    const request=++this.request;
    this.pending?.abort();
    const abort=new AbortController();this.pending=abort;
    this.update({pendingRevision:request,status:'loading',message:'Loading and validating the pinned evidence…',errorCode:null});
    let timer:ReturnType<typeof setTimeout>|undefined;
    let onAbort:(()=>void)|undefined;
    try{
      const cancellation=new Promise<never>((_,reject)=>{
        onAbort=()=>reject(new ResearchError('CANCELLED','Request superseded.'));
        abort.signal.addEventListener('abort',onAbort,{once:true});
        timer=setTimeout(()=>{reject(new ResearchError('DATA_TIMEOUT','The evidence request timed out. The last valid workspace is retained.'));abort.abort();},this.timeoutMs);
      });
      const operation=replay?this.engine.replay(input,abort.signal):this.engine.prepare(input,abort.signal);
      const active=await Promise.race([operation,cancellation]);
      if(this.disposed||request!==this.request||abort.signal.aborted)return false;
      this.commits++;
      // The selection intent survives filters; absence never selects a different city.
      this.update({revision:request,pendingRevision:request,active,analysisTimeWindow:active.plan.timeWindow,status:'ready',message:replay?'Pinned replay verified.':'Prepared example — planner not enabled.',errorCode:null});
      return true;
    }catch(error){
      if(this.disposed||request!==this.request)return false;
      const typed=error instanceof ResearchError?error:new ResearchError('UNKNOWN_REFERENCE','The pinned evidence could not be resolved. The last valid workspace is retained.');
      this.update({status:'error',message:`${typed.code}: ${typed.message}`,errorCode:typed.code});return false;
    }finally{
      if(timer!==undefined)clearTimeout(timer);
      if(onAbort)abort.signal.removeEventListener('abort',onAbort);
      if(this.pending===abort)this.pending=null;
    }
  }
  run(input:unknown):Promise<boolean>{return this.stage(input,false);}
  replay(input:unknown):Promise<boolean>{return this.stage(input,true);}
  exportManifest():string{
    if(!this.state.active)throw new ResearchError('INSUFFICIENT_EVIDENCE','Open a valid workspace before exporting.');
    // References only: no record values, source passages, credentials or UI input.
    return canonicalJSON(this.state.active.manifest)+'\n';
  }
  close():void{
    if(this.disposed)return;
    this.pending?.abort();this.pending=null;
    const revision=++this.request;
    this.update({revision,pendingRevision:revision,status:'idle',message:'Prepared example — planner not enabled.',errorCode:null,active:null,analysisTimeWindow:null});
  }
  getDiagnostics(){return{listeners:this.listeners.size,commits:this.commits,revision:this.state.revision,pending:!!this.pending,disposed:this.disposed,...this.engine.getDiagnostics()};}
  dispose():void{
    if(this.disposed)return;
    this.close();this.listeners.clear();this.engine.dispose();this.disposed=true;
  }
}
