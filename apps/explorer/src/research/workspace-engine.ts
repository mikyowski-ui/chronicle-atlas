/** The v2 host path; v1 executes against its original validator before explicit adaptation. */
import { boundedInput, ExecutionManifestSchema, parseSpecification } from './contracts.ts';
import { canonicalJSON, ResearchEngine, immutable, type DatasetRegistry, type PreparedResult } from './engine.ts';
import { createRegistry, PILOT_DESCRIPTOR } from './registry.ts';
import { boundedSemanticInput, QueryIntentSchema, SEMANTIC_LIMITS, SemanticError, type SemanticFixture } from '../../research-semantic/contracts.ts';
import { createCatalogue, registerFixture, registerModernPilot, type RegisteredFixture } from '../../research-semantic/catalogue.ts';
import { beginRevision, restoreRevision, RevisionArchiveSchema, type LocalRevision } from '../../research-semantic/revisions.ts';
import { defaultViews, specForStudy, validateWorkspace, WorkspaceReplaySchema, WorkspaceSpecificationSchema, restoreWorkspace, type Selection, type WorkspaceSpecification } from '../../research-semantic/workspace-contract.ts';
export const MODERN_ID=PILOT_DESCRIPTOR.id, PREMODERN_ID='premodern-exchange-accounts';
export const PREMODERN_HASH='8f2bf0e7672dac8fb7136fd5fe81147884c3faa31d441247ab823e01367d14d0';
export type PilotId=typeof PREMODERN_ID|string;
export interface WorkspaceRegistration{load(signal:AbortSignal):Promise<string>;register(raw:string):RegisteredFixture}
export type WorkspaceRegistry=ReadonlyMap<string,WorkspaceRegistration>;
export interface UnifiedResult {spec:WorkspaceSpecification;study:LocalRevision;bundle:LocalRevision['bundle'];fixture:SemanticFixture;legacy:PreparedResult|null;restored:{cursorYear:number;selection:Selection|null}|null}
export function createWorkspaceRegistry(legacy:DatasetRegistry=createRegistry()):WorkspaceRegistry{
 return new Map([[MODERN_ID,{load:signal=>legacy.get(MODERN_ID)!.load(signal),register:registerModernPilot}],[PREMODERN_ID,{load:async(signal:AbortSignal)=>{
  const response=await fetch(new URL('../../research-semantic/premodern-pilot.json',import.meta.url),{signal,credentials:'same-origin'});
  if(!response.ok||!response.body)throw new SemanticError('UNKNOWN_REFERENCE','Pinned premodern fixture is unavailable.');
  const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>SEMANTIC_LIMITS.fixtureBytes){await reader.cancel();throw new SemanticError('BUDGET_EXCEEDED','Fixture exceeds its byte limit.');}chunks.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
 },register:raw=>registerFixture(raw,PREMODERN_HASH)}]]);
}
export class WorkspaceEngine{
 private registrations=new Map<string,RegisteredFixture>();private legacy:ResearchEngine;
 constructor(readonly registry:WorkspaceRegistry=createWorkspaceRegistry(),legacyRegistry:DatasetRegistry=createRegistry()){this.legacy=new ResearchEngine(legacyRegistry);}
 async registration(id:string,signal:AbortSignal):Promise<RegisteredFixture>{
  if(signal.aborted)throw new Error('CANCELLED');const cached=this.registrations.get(id);if(cached)return cached;
  const loader=this.registry.get(id);if(!loader)throw new SemanticError('UNKNOWN_REFERENCE','Dataset is not host-registered.');
  const raw=await loader.load(signal);if(signal.aborted)throw new Error('CANCELLED');const value=loader.register(raw);this.registrations.set(id,value);return value;
 }
 async prepared(id:string,signal:AbortSignal):Promise<UnifiedResult>{
  const registration=await this.registration(id,signal),d=registration.descriptor,catalogue=createCatalogue([registration]);
  const study=beginRevision({schemaVersion:1,question:'Which retained observations are available?',interpretation:'Local prepared evidence.',scope:{datasetId:d.id,indicatorId:d.indicators[0].id,...d.bounds,entityIds:d.entityIds},context:'explicit-bounds',parentId:null},catalogue);
  return this.finish(study,specForStudy(study),registration);
 }
 finish(study:LocalRevision,spec:WorkspaceSpecification,registration:RegisteredFixture,legacy:PreparedResult|null=null,restored:UnifiedResult['restored']=null):UnifiedResult{
  const checked=validateWorkspace(spec,createCatalogue([registration]));
  if(canonicalJSON(checked.plan)!==canonicalJSON(study.plan))throw new SemanticError('INVALID_SPEC','Workspace and study plans differ.');
  if(!study.bundle.observations.length)throw new SemanticError('INSUFFICIENT_EVIDENCE','No observations overlap this scope. Previous workspace remains visible; missing is not zero.');
  return immutable({spec:checked,study,bundle:study.bundle,fixture:registration.fixture,legacy,restored});
 }
 async adaptLegacy(result:PreparedResult,signal:AbortSignal):Promise<UnifiedResult>{
  const registration=await this.registration(result.plan.datasetId,signal),d=registration.descriptor,catalogue=createCatalogue([registration]);
  const study=beginRevision({schemaVersion:1,question:'Which retained population estimates are available?',interpretation:'Explicit compatibility adaptation after original v1 validation.',context:'explicit-bounds',parentId:null,scope:{datasetId:d.id,indicatorId:'population',bbox:d.bounds.bbox,epoch:[result.plan.timeWindow.start,result.plan.timeWindow.end],entityIds:result.plan.entityIds}},catalogue);
  if(canonicalJSON(result.bundle.observations.map(r=>[r.id,r.value]))!==canonicalJSON(study.bundle.observations.map(r=>[r.id,r.value])))throw new SemanticError('EDITION_MISMATCH','Compatibility observations disagree.');
  return this.finish(study,{...specForStudy(study,result.spec.views.map(v=>({id:`view-${v.type}`,type:v.type,binding:'observations'}))),id:result.spec.id,title:result.spec.title},registration,result);
 }
 async prepare(input:unknown,signal:AbortSignal):Promise<UnifiedResult>{
  const raw=boundedInput(input);if(WorkspaceSpecificationSchema.safeParse(raw).success){
   const spec=WorkspaceSpecificationSchema.parse(boundedSemanticInput(raw)),r=await this.registration(spec.plan.scope.datasetId,signal),c=createCatalogue([r]);
   validateWorkspace(spec,c);const study=beginRevision(spec.intent,c);return this.finish(study,spec,r);
  }
  return this.adaptLegacy(await this.legacy.prepare(parseSpecification(raw),signal),signal);
 }
 async reopen(input:unknown,signal:AbortSignal):Promise<UnifiedResult>{
  const raw=boundedInput(input);
  // Strict shape preflight occurs before dependency loading. Only one host-allowlisted fixture is needed.
  if(WorkspaceReplaySchema.safeParse(raw).success){const archive=WorkspaceReplaySchema.parse(boundedSemanticInput(raw)),ids=new Set(archive.study.revisions.map(item=>item.replay.plan.scope.datasetId));
   if(ids.size!==1||[...ids].some(id=>!this.registry.has(id)))throw new SemanticError('UNKNOWN_REFERENCE','Replay dependencies are mixed or unregistered.');const id=[...ids][0];
   const r=await this.registration(id,signal),restored=restoreWorkspace(archive,createCatalogue([r]));return this.finish(restored.study,restored.spec,r,null,{cursorYear:archive.cursorYear,selection:archive.selection});}
  if(RevisionArchiveSchema.safeParse(raw).success){const archive=RevisionArchiveSchema.parse(boundedSemanticInput(raw));const ids=new Set(archive.revisions.map(r=>r.replay.plan.scope.datasetId));if(ids.size!==1)throw new SemanticError('INVALID_SPEC','Narrowing archive crosses datasets.');
   const r=await this.registration([...ids][0],signal),study=restoreRevision(archive,createCatalogue([r]));return this.finish(study,specForStudy(study),r);}
  const legacy=ExecutionManifestSchema.parse(raw);return this.adaptLegacy(await this.legacy.replay(legacy,signal),signal);
 }
 catalogue(id:string){const r=this.registrations.get(id);if(!r)throw new SemanticError('UNKNOWN_REFERENCE','Catalogue not loaded.');return createCatalogue([r]);}
 getDiagnostics(){return{datasets:this.registrations.size,results:0};}
 dispose(){this.registrations.clear();this.legacy.dispose();}
}
