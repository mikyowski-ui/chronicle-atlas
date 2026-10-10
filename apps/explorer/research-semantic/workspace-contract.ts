/** Authoritative dashboard boundary for new prepared/planner outputs; v1 schemas stay pinned. */
import { z } from '@chronicle/contracts/schema';
import { boundedSemanticInput, SemanticError, type ResolvedDataBundle } from './contracts.ts';
import { compileIntent, type SemanticCatalogue } from './catalogue.ts';
import { RevisionArchiveSchema, restoreRevision, type LocalRevision } from './revisions.ts';
import { canonicalJSON, immutable } from '../src/research/engine.ts';
import { WORKSPACE_VERSIONS, ViewSchema, RENDERER_CAPABILITIES, WorkspaceSpecificationSchema, SelectionSchema, type ViewType, type WorkspaceSpecification, type Selection } from '@chronicle/contracts/workspace';
export { WORKSPACE_VERSIONS, ViewSchema, RENDERER_CAPABILITIES, WorkspaceSpecificationSchema, SelectionSchema, type ViewType, type WorkspaceSpecification, type Selection };
export const WorkspaceReplaySchema=z.strictObject({schemaVersion:z.literal(2),kind:z.literal('chronicle-workspace-replay'),versions:z.strictObject({schema:z.literal(2),renderer:z.literal(WORKSPACE_VERSIONS.renderer),compatibility:z.literal(WORKSPACE_VERSIONS.compatibility)}),study:RevisionArchiveSchema,views:z.array(ViewSchema).min(1).max(5),cursorYear:z.number().int().min(-12000).max(3000),cursorPrecision:z.literal('year-navigation-anchor'),selection:SelectionSchema.nullable()});
export type WorkspaceReplay=z.infer<typeof WorkspaceReplaySchema>;
export function validateWorkspace(input:unknown,catalogue:SemanticCatalogue,capabilities:readonly ViewType[]=RENDERER_CAPABILITIES):WorkspaceSpecification{
 const spec=WorkspaceSpecificationSchema.parse(boundedSemanticInput(input));
 if(new Set(spec.views.map(v=>v.id)).size!==spec.views.length||new Set(spec.views.map(v=>v.type)).size!==spec.views.length)throw new SemanticError('INVALID_SPEC','Duplicate view IDs or types.');
 if(spec.views.some(v=>!capabilities.includes(v.type)))throw new SemanticError('INVALID_SPEC','The active renderer cannot implement this view.');
 if(canonicalJSON(compileIntent(spec.intent,catalogue))!==canonicalJSON(spec.plan))throw new SemanticError('INVALID_SPEC','Plan differs from its compiled intent.');
 const indicator=catalogue.get(spec.plan.scope.datasetId)!.descriptor.indicators.find(i=>i.id===spec.plan.scope.indicatorId)!;
 if(spec.views.some(v=>(v.type==='scatter'&&indicator.kind!=='quantitative')||(v.type==='interval'&&indicator.kind!=='qualitative')))throw new SemanticError('INCOMPATIBLE_SEMANTICS','Chart capability does not match the indicator class.');
 return immutable(spec);
}
export function defaultViews(qualitative:boolean):WorkspaceSpecification['views']{return (['summary','map',qualitative?'interval':'scatter','table','evidence'] as ViewType[]).map(type=>({id:`view-${type}`,type,binding:'observations'}));}
export function specForStudy(study:LocalRevision,views:WorkspaceSpecification['views']=defaultViews(study.plan.scope.indicatorId==='trade-node-description')):WorkspaceSpecification{
 const qualitative=study.plan.scope.indicatorId==='trade-node-description';
 return {schemaVersion:2,id:'source-backed-workspace',title:qualitative?'Premodern exchange accounts':'Population observations',intent:{schemaVersion:1,question:'Which retained observations are available in this scope?',interpretation:'Source-backed local prepared workspace; planner not enabled.',scope:study.plan.scope,context:'explicit-bounds',parentId:study.archive.revisions.at(-1)!.parentId},plan:study.plan,views,selection:'entity-observation',layout:'adaptive'};
}
export function validateSavedSelection(selection:Selection|null,bundle:ResolvedDataBundle):void{
 if(selection&&!bundle.observations.some(r=>r.id===selection.observationId&&r.entityId===selection.entityId))throw new SemanticError('UNKNOWN_REFERENCE','Saved selection is not present in the pinned result.');
}
export function restoreWorkspace(input:unknown,catalogue:SemanticCatalogue):{archive:WorkspaceReplay;study:LocalRevision;spec:WorkspaceSpecification}{
 const archive=WorkspaceReplaySchema.parse(boundedSemanticInput(input));const study=restoreRevision(archive.study,catalogue);
 const spec=validateWorkspace(specForStudy(study,archive.views),catalogue);validateSavedSelection(archive.selection,{...study.bundle,observations:catalogue.get(study.plan.scope.datasetId)!.fixture.observations});
 return immutable({archive,study,spec});
}
