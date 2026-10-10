/** Zod is the single source for runtime validation and inferred semantic types.
 * No renderer, model, DOM, database, network or filesystem capabilities live here. */
import { z } from 'zod';

// Zod 4 otherwise prepares a fast object parser through dynamic Function.
// Configure before constructing any schema; CSP-safe interpreted validation only.
z.config({jitless:true});

export const SEMANTIC_VERSIONS = Object.freeze({schema:1, compiler:'semantic-query-1', policy:'evidence-semantics-1', adapter:'retained-source-1'} as const);
export const SEMANTIC_LIMITS = Object.freeze({queryBytes:65536, fixtureBytes:10485760, rows:20000, entities:2000, views:5, depth:14, nodes:250000});
export class SemanticError extends Error {
  constructor(readonly code:'INVALID_SPEC'|'UNKNOWN_REFERENCE'|'OUT_OF_BOUNDS'|'EDITION_MISMATCH'|'INSUFFICIENT_EVIDENCE'|'INCOMPATIBLE_SEMANTICS'|'BUDGET_EXCEEDED', message:string) {super(message);this.name='SemanticError';}
}
const id = z.string().min(1).max(160).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().trim().min(1).max(4000);
const safeText = text.refine(v=>!/[<>\u0000-\u0008]/.test(v)&&!/```|javascript:|data:|https?:\/\//i.test(v),'Executable markup and resource addresses are not accepted in specifications.');
const year = z.number().int().min(-12000).max(3000);
export const IndicatorKeySchema = z.enum(['population','trade-node-description']);
export type IndicatorKey = z.infer<typeof IndicatorKeySchema>;
export const EpistemicStatusSchema = z.enum(['attested','interpolated','modeled']);
export type EpistemicStatus = z.infer<typeof EpistemicStatusSchema>;
export const BoundingBoxSchema = z.tuple([z.number().min(-180).max(180),z.number().min(-90).max(90),z.number().min(-180).max(180),z.number().min(-90).max(90)])
  .refine(v=>v[0]<=v[2]&&v[1]<=v[3],'Bounding box must be ordered; antimeridian queries require a separately registered region.');
export type BoundingBox = z.infer<typeof BoundingBoxSchema>;
export const EpochSchema = z.tuple([year,year]).refine(v=>v[0]<=v[1],'Epoch interval is reversed.');
export const TemporalSupportSchema = z.strictObject({startYear:year,endYear:year,precision:z.enum(['year','range']),meaning:text})
  .refine(v=>v.startYear<=v.endYear&&(v.precision==='range'||v.startYear===v.endYear),'A single year cannot conceal an interval.');
export type TemporalSupport = z.infer<typeof TemporalSupportSchema>;
export const ConfidenceSchema = z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('not-supplied'),note:text}),
  z.strictObject({kind:z.literal('qualitative'),label:text,note:text}),
  z.strictObject({kind:z.literal('source-interval'),lower:z.number().finite(),upper:z.number().finite(),level:z.number().gt(0).lte(1).nullable(),note:text})
    .refine(v=>v.lower<=v.upper,'Source uncertainty interval is reversed.'),
]);
export type Confidence = z.infer<typeof ConfidenceSchema>;
export const SourcePinSchema = z.strictObject({id,edition:text,sha256:hash,title:text,locator:text,rights:z.literal('authorized-local-preview'),modelProcessing:z.literal(false),republication:z.literal(false)});
export type SourcePin = z.infer<typeof SourcePinSchema>;
export const IndicatorSchema = z.strictObject({id:IndicatorKeySchema,label:text,kind:z.enum(['quantitative','qualitative']),unit:z.enum(['persons','qualitative-statement']),allowedEvidence:z.array(EpistemicStatusSchema).min(1).max(3)})
  .refine(v=>(v.kind==='quantitative'&&v.unit==='persons')||(v.kind==='qualitative'&&v.unit==='qualitative-statement'),'Unit and indicator kind disagree.');
export type Indicator = z.infer<typeof IndicatorSchema>;
export const EntitySchema = z.strictObject({id,label:text,coordinates:z.tuple([z.number().min(-180).max(180),z.number().min(-90).max(90)]),spatialSupport:z.strictObject({definition:text,comparability:z.enum(['fixed','definition-only','uncertain']),uncertaintyKm:z.number().nonnegative().max(20000).nullable()})});
export type SemanticEntity = z.infer<typeof EntitySchema>;
export const ObservationSchema = z.strictObject({
  id,entityId:id,indicatorId:IndicatorKeySchema,value:z.union([z.number().finite().nonnegative().max(300000000),text,z.null()]),epistemicStatus:EpistemicStatusSchema,
  time:TemporalSupportSchema,compositionTime:TemporalSupportSchema.nullable(),confidence:ConfidenceSchema,
  provenance:z.strictObject({sourceId:id,locator:text,sourceSha256:hash,recordSha256:hash,bibliographySourceIds:z.array(id).max(20)}),
  derivation:z.strictObject({methodId:id,inputObservationIds:z.array(id).min(2).max(100)}).nullable(),
  author:text.nullable(),perspective:text.nullable(),limitations:z.array(text).max(20),supportNote:text,reviewStatus:z.literal('source-attributed'),
}).refine(v=>v.epistemicStatus!=='interpolated'||v.derivation!==null,'Interpolated evidence requires explicit input references and method.');
export type SemanticObservation = z.infer<typeof ObservationSchema>;
export const FixtureSchema = z.strictObject({schemaVersion:z.literal(1),id,edition:text,coverageNote:text,sourcePins:z.array(SourcePinSchema).min(1).max(30),indicators:z.array(IndicatorSchema).min(1).max(2),bounds:z.strictObject({bbox:BoundingBoxSchema,epoch:EpochSchema}),entities:z.array(EntitySchema).min(1).max(SEMANTIC_LIMITS.entities),observations:z.array(ObservationSchema).min(1).max(SEMANTIC_LIMITS.rows)});
export type SemanticFixture = z.infer<typeof FixtureSchema>;
export const DatasetDescriptorSchema = z.strictObject({id,edition:text,dataHash:hash,sourcePins:z.array(SourcePinSchema).min(1).max(30),bounds:z.strictObject({bbox:BoundingBoxSchema,epoch:EpochSchema}),indicators:z.array(IndicatorSchema).min(1).max(2),entityIds:z.array(id).min(1).max(SEMANTIC_LIMITS.entities),rowCount:z.number().int().min(1).max(SEMANTIC_LIMITS.rows),permittedNormalizerIds:z.array(id).max(10),exportPolicy:z.literal('references-only')});
export type DatasetDescriptor = z.infer<typeof DatasetDescriptorSchema>;
const ScopeSchema = z.strictObject({datasetId:id,indicatorId:IndicatorKeySchema,bbox:BoundingBoxSchema,epoch:EpochSchema,entityIds:z.array(id).min(1).max(SEMANTIC_LIMITS.entities)});
export const QueryIntentSchema = z.strictObject({schemaVersion:z.literal(1),question:safeText,interpretation:safeText,scope:ScopeSchema,context:z.literal('explicit-bounds'),parentId:id.nullable()});
export type QueryIntent = z.infer<typeof QueryIntentSchema>;
export const QueryPlanSchema = z.strictObject({schemaVersion:z.literal(1),scope:ScopeSchema,edition:text,dataHash:hash,descriptorHash:hash,operation:z.literal('observations'),sort:z.literal('entity-time-id'),fields:z.tuple([z.literal('id'),z.literal('entityId'),z.literal('indicatorId'),z.literal('value'),z.literal('time'),z.literal('epistemicStatus'),z.literal('provenance')]),joins:z.array(id).max(0),maxRows:z.number().int().min(1).max(SEMANTIC_LIMITS.rows),policyVersion:z.literal(SEMANTIC_VERSIONS.policy)});
export type QueryPlan = z.infer<typeof QueryPlanSchema>;
export const DashboardSpecificationSchema = z.strictObject({schemaVersion:z.literal(1),id,title:safeText,intent:QueryIntentSchema,plan:QueryPlanSchema,views:z.array(z.strictObject({id,type:z.enum(['map','timeline','evidence','table','summary']),binding:z.literal('observations')})).min(1).max(SEMANTIC_LIMITS.views),selection:z.literal('entity-observation'),layout:z.literal('adaptive')});
export type DashboardSpecification = z.infer<typeof DashboardSpecificationSchema>;
export const ResolvedDataBundleSchema = z.strictObject({descriptor:DatasetDescriptorSchema,entities:z.array(EntitySchema).max(SEMANTIC_LIMITS.entities),observations:z.array(ObservationSchema).max(SEMANTIC_LIMITS.rows),sourcePins:z.array(SourcePinSchema).min(1).max(30),warnings:z.array(text).max(30),resultHash:hash});
export type ResolvedDataBundle = z.infer<typeof ResolvedDataBundleSchema>;
export const ReplayManifestSchema = z.strictObject({schemaVersion:z.literal(1),kind:z.literal('chronicle-semantic-replay'),plan:QueryPlanSchema,versions:z.strictObject({schema:z.literal(1),compiler:z.literal(SEMANTIC_VERSIONS.compiler),policy:z.literal(SEMANTIC_VERSIONS.policy),adapter:z.literal(SEMANTIC_VERSIONS.adapter)}),dependencies:z.array(z.strictObject({datasetId:id,edition:text,dataHash:hash,descriptorHash:hash,sourceHashes:z.array(hash).min(1).max(30)})).length(1),resultHash:hash,observationIds:z.array(id).max(SEMANTIC_LIMITS.rows),planner:z.literal('manual-prepared-example'),exportPolicy:z.literal('references-only')});
export type ReplayManifest = z.infer<typeof ReplayManifestSchema>;
/** Registered host code may describe a normalizer; query specs cannot author it. */
export const NormalizerSchema = z.strictObject({id,version:text,leftIndicator:IndicatorKeySchema,rightIndicator:IndicatorKeySchema,unit:z.enum(['persons','qualitative-statement']),geographyDefinition:text,epoch:EpochSchema,evidenceClasses:z.array(EpistemicStatusSchema).min(1).max(3),operation:z.literal('compare-only'),confidencePolicy:z.literal('preserve-source-unknown'),reviewStatus:z.literal('host-reviewed')});
export type RegisteredNormalizer = z.infer<typeof NormalizerSchema>;

/** Reject expansion/cycles and non-JSON values before Zod traverses nested input. */
export function boundedSemanticInput(input:unknown,maxBytes:number=SEMANTIC_LIMITS.queryBytes):unknown {
  let value=input;
  if(typeof value==='string'){
    if(new TextEncoder().encode(value).byteLength>maxBytes)throw new SemanticError('BUDGET_EXCEEDED','Input exceeds the byte budget.');
    try{value=JSON.parse(value);}catch{throw new SemanticError('INVALID_SPEC','Input must be JSON.');}
  }
  let nodes=0;
  const visit=(item:unknown,depth:number,parents:Set<object>):void=>{
    if(++nodes>SEMANTIC_LIMITS.nodes||depth>SEMANTIC_LIMITS.depth)throw new SemanticError('BUDGET_EXCEEDED','Input nesting or node budget exceeded.');
    if(typeof item==='number'&&!Number.isFinite(item))throw new SemanticError('INVALID_SPEC','Non-finite numbers are not JSON.');
    if(item===undefined||typeof item==='function'||typeof item==='bigint'||typeof item==='symbol')throw new SemanticError('INVALID_SPEC','Only JSON data is accepted.');
    if(item&&typeof item==='object'){
      if(parents.has(item))throw new SemanticError('INVALID_SPEC','Cyclic data is not accepted.');
      if(!Array.isArray(item)&&![Object.prototype,null].includes(Object.getPrototypeOf(item)))throw new SemanticError('INVALID_SPEC','Only plain JSON objects are accepted.');
      parents.add(item);
      for(const [key,child] of Object.entries(item)){
        if(['__proto__','constructor','prototype'].includes(key))throw new SemanticError('INVALID_SPEC','Unsafe object key.');
        visit(child,depth+1,parents);
      }
      parents.delete(item);
    }
  };
  visit(value,0,new Set());
  const json=JSON.stringify(value);
  if(typeof json!=='string')throw new SemanticError('INVALID_SPEC','JSON input required.');
  if(new TextEncoder().encode(json).byteLength>maxBytes)throw new SemanticError('BUDGET_EXCEEDED','Input exceeds the byte budget.');
  return value;
}
