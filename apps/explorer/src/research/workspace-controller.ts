import { InteractionRuntime, type InteractionAction, type InteractionState } from '@chronicle/runtime';
import { PlannerBoundary, createProviderConnection, type ProviderConnection, type ProviderConnectionInput } from '@chronicle/planner';
import { EvidenceSourceRegistry, GroundedEvidencePlanner } from '@chronicle/planner/evidence';
import { FileDropAdapter, type EvidenceFile } from '@chronicle/planner/files';
import { WikidataHistoricalAdapter } from '@chronicle/planner/wikidata';
import { EvidenceSessionReplaySchema, boundedEvidence, type EvidenceWorkspace } from '@chronicle/contracts/evidence';
import { boundedJSON, canonicalJSON } from '@chronicle/contracts/canonical';
import { LIMITS } from './contracts.ts';
import { WorkspaceEngine, type UnifiedResult } from './workspace-engine.ts';
import { createCatalogue, compileIntent } from '../../research-semantic/catalogue.ts';
import { refineRevision, revisionIntent } from '../../research-semantic/revisions.ts';
import { specForStudy, validateWorkspace, WorkspaceReplaySchema, WORKSPACE_VERSIONS, type WorkspaceSpecification } from '../../research-semantic/workspace-contract.ts';
import type { SemanticEntity, SemanticObservation, SourcePin } from '@chronicle/contracts/research';
import { MechanismEngine, exportMechanismReplay, isMechanismReplay, resolveMechanismSelection, type MechanismResult } from '../domains/watt-mechanism/index.ts';
export interface WorkspaceSnapshot extends InteractionState {
 analysisTimeWindow:{start:number;end:number}|null;active:UnifiedResult|null;
 /** Non-map domain result. At most one of `active` and `mechanism` is set; both share revision, cursor and selection. */
 mechanism:MechanismResult|null;
 imported:EvidenceWorkspace|null;
 selectedEvidence:{observation:SemanticObservation;entity:SemanticEntity;source:SourcePin;visible:boolean}|null;
}
export type WorkspaceAction=InteractionAction;
/** One store for both pilots, the non-map mechanism domain, all views and the existing Atlas cursor adapter. */
export class ResearchController extends InteractionRuntime<WorkspaceSnapshot> {
 private readonly provider:ProviderConnection;
 private readonly files=new FileDropAdapter();
 private readonly sources=new EvidenceSourceRegistry();
 private readonly evidencePlanner=new GroundedEvidencePlanner(this.sources);
 constructor(initialYear:number,private readonly engine=new WorkspaceEngine(),timeoutMs=5000,providerInput:ProviderConnectionInput={},private readonly mechanisms=new MechanismEngine()){
  super({revision:0,pendingRevision:0,status:'idle',message:'Prepared example — planner not enabled.',errorCode:null,cursorYear:initialYear,analysisTimeWindow:null,selection:null,active:null,mechanism:null,imported:null,selectedEvidence:null},{
   timeoutMs,hasResult:state=>!!(state.active||state.mechanism||state.imported),clear:()=>({active:null,mechanism:null,imported:null,analysisTimeWindow:null,selectedEvidence:null}),
   acceptsSelection:(state,action)=>state.imported?state.imported.bundle.records.some(row=>row.id===action.observationId&&row.entityId===action.entityId):state.mechanism?!!resolveMechanismSelection(state.mechanism.bundle,action):!!state.active?.fixture.observations.some(row=>row.id===action.observationId&&row.entityId===action.entityId),
   derive:next=>{
    const s=next.selection,f=next.active?.fixture;
    const observation=f?.observations.find(o=>o.id===s?.observationId&&o.entityId===s?.entityId),entity=f?.entities.find(e=>e.id===s?.entityId),source=f?.sourcePins.find(p=>p.id===observation?.provenance.sourceId);
    return {...next,selectedEvidence:observation&&entity&&source?{observation,entity,source,visible:!!next.active?.bundle.observations.some(row=>row.id===observation.id)}:null};
   },
  });
  this.provider=createProviderConnection(providerInput);this.sources.register(this.files);this.sources.register(new WikidataHistoricalAdapter());
 }
 getProviderStatus(){return this.provider.status;}
 private readonly commitWorkspace=(active:UnifiedResult,revision:number):Partial<WorkspaceSnapshot>|null=>active===this.state.active?null:{revision,active,mechanism:null,imported:null,analysisTimeWindow:{start:active.spec.plan.scope.epoch[0],end:active.spec.plan.scope.epoch[1]},status:'ready',message:'Source-backed prepared workspace · edition pinned',errorCode:null,...(active.restored?{cursorYear:active.restored.cursorYear,selection:active.restored.selection}:this.state.mechanism||this.state.imported?{selection:null}:{})};
 private readonly commitMechanism=(mechanism:MechanismResult,revision:number):Partial<WorkspaceSnapshot>=>({revision,active:null,mechanism,imported:null,analysisTimeWindow:{start:mechanism.bundle.temporalSupport.startYear,end:mechanism.bundle.temporalSupport.endYear},status:'ready',message:'Source-backed prepared mechanism · excerpt pinned',errorCode:null,...(mechanism.restored?{cursorYear:mechanism.restored.cursorYear,selection:mechanism.restored.selection}:{selection:null})});
 private readonly commitImported=(imported:EvidenceWorkspace,revision:number):Partial<WorkspaceSnapshot>=>({revision,active:null,mechanism:null,imported,analysisTimeWindow:imported.intent.temporalRange?{start:imported.intent.temporalRange[0],end:imported.intent.temporalRange[1]}:null,selection:null,status:'ready',message:'Unreviewed source evidence · browser-local cache · model processing off',errorCode:null});
 run(input:unknown){return this.stage(signal=>this.engine.prepare(input,signal),this.commitWorkspace);}
 openPilot(id:string){return this.stage(signal=>this.engine.prepared(id,signal),this.commitWorkspace);}
 openMechanism(id:string){return this.stage(signal=>this.mechanisms.prepared(id,signal),this.commitMechanism);}
 importEvidence(file:EvidenceFile){return this.stage(async signal=>{
  const records=await this.files.ingestFile(file,{signal});if(signal.aborted)throw new Error('CANCELLED');
  return this.evidencePlanner.fromRecords({question:'',sourceIds:[this.files.id],bounds:null,temporalRange:null},records);
 },this.commitImported);}
 queryEvidence(input:unknown,allowRemote=false){return this.stage(signal=>this.evidencePlanner.prepare(input,{signal,allowRemote}),this.commitImported);}
 clearImportedEvidence(){this.cancel();this.evidencePlanner.dispose();if(this.state.imported)this.close();}
 replay(input:unknown){
  return this.stage(async signal=>{
   const candidate=boundedEvidence(input,1048576);
   if(candidate&&typeof candidate==='object'&&'kind' in candidate&&candidate.kind==='chronicle-evidence-session'){
    const archive=EvidenceSessionReplaySchema.parse(candidate),imported=this.evidencePlanner.reopen(archive.workspace);
    if(archive.selection&&!imported.bundle.records.some(row=>row.id===archive.selection!.observationId&&row.entityId===archive.selection!.entityId))throw new Error('INVALID_EVIDENCE_SELECTION');
    return {imported,cursorYear:archive.cursorYear,selection:archive.selection};
   }
   const raw=boundedJSON(candidate,{bytes:LIMITS.specBytes,depth:LIMITS.depth,nodes:LIMITS.nodes});
   return isMechanismReplay(raw)?this.mechanisms.reopen(raw,signal):this.engine.reopen(raw,signal);
  },(result,revision)=>'imported' in result?{...this.commitImported(result.imported,revision),cursorYear:result.cursorYear,selection:result.selection}:'domain' in result?this.commitMechanism(result,revision):this.commitWorkspace(result,revision));
 }
 refine(entityIds:string[],epoch:[number,number]){
  const parent=this.state.active;if(!parent)return Promise.resolve(false);
  return this.stage(async signal=>{const r=await this.engine.registration(parent.spec.plan.scope.datasetId,signal),intent=revisionIntent(parent.study,entityIds,epoch);
   const catalogue=createCatalogue([r]);if(canonicalJSON(compileIntent(intent,catalogue))===canonicalJSON(parent.study.plan))return parent;
   const next=refineRevision(parent.study,intent,catalogue);
   return this.engine.finish(next,{...specForStudy(next,parent.spec.views),title:parent.spec.title},r);
  },this.commitWorkspace);
 }
 setViews(views:WorkspaceSpecification['views']){
  const parent=this.state.active;if(!parent)return Promise.resolve(false);
  return this.stage(async signal=>{const r=await this.engine.registration(parent.spec.plan.scope.datasetId,signal);return this.engine.finish(parent.study,{...parent.spec,views},r,parent.legacy);},this.commitWorkspace);
 }
 async requestProposal(question:string){
  const active=this.state.active;const planner=new PlannerBoundary(this.provider,(input)=>validateWorkspace(input,this.engine.catalogue(active?.spec.plan.scope.datasetId??'')));
  return planner.propose(question,{disclosure:'offline-fixture-only',catalogueVersion:'local-workspace-v2',datasets:active?[{id:active.spec.plan.scope.datasetId,indicatorIds:[active.spec.plan.scope.indicatorId],entityIds:active.spec.plan.scope.entityIds}]:[],parentRevisionId:active?.study.archive.revisions.at(-1)?.id??null});
 }
 exportManifest():string{
  const imported=this.state.imported;
  if(imported){const archive=EvidenceSessionReplaySchema.parse({schemaVersion:1,kind:'chronicle-evidence-session',workspace:JSON.parse(this.evidencePlanner.export(imported)),cursorYear:this.state.cursorYear,selection:this.state.selection});return canonicalJSON(boundedEvidence(archive,1048576))+'\n';}
  const m=this.state.mechanism;if(m)return exportMechanismReplay(m.spec,m.bundle,this.state.cursorYear,this.state.selection);
  const a=this.state.active;if(!a)throw new Error('Open a workspace before saving.');
  const archive=WorkspaceReplaySchema.parse({schemaVersion:2,kind:'chronicle-workspace-replay',versions:WORKSPACE_VERSIONS,study:a.study.archive,views:a.spec.views,cursorYear:this.state.cursorYear,cursorPrecision:'year-navigation-anchor',selection:this.state.selectedEvidence?this.state.selection:null});
  const text=canonicalJSON(archive);if(new TextEncoder().encode(text).length>65536)throw new Error('Workspace replay exceeds 64 KiB.');return text+'\n';
 }
 getDiagnostics(){return{...super.getDiagnostics(),...this.engine.getDiagnostics(),mechanisms:this.mechanisms.getDiagnostics()};}
 dispose(){if(this.disposed)return;super.dispose();this.engine.dispose();this.mechanisms.dispose();this.evidencePlanner.dispose();}
}
