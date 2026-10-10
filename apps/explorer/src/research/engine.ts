import {
  boundedInput, DatasetDescriptorSchema, ExecutionManifestSchema, LIMITS, parseSpecification, QueryPlanSchema,
  ResearchDatasetSchema, ResearchError, ResolvedDataBundleSchema, VERSIONS, validateWindow,
  type DashboardSpecification, type DatasetDescriptor, type ExecutionManifest, type QueryPlan, type ResearchDataset,
  type ResearchEntity, type ResearchObservation, type ResolvedDataBundle, type TimeWindow,
} from './contracts.ts';

import { canonicalJSON, hashText, immutable } from './canonical.ts';
export { canonicalJSON, hashText, immutable };
export interface DatasetRegistration { descriptor: DatasetDescriptor; load(signal: AbortSignal): Promise<string> }
export type DatasetRegistry = ReadonlyMap<string,DatasetRegistration>;
export interface PreparedResult { spec: DashboardSpecification; plan: QueryPlan; bundle: ResolvedDataBundle; manifest: ExecutionManifest }
const datasetIdentity=(descriptor:DatasetDescriptor)=>hashText(canonicalJSON({descriptor,policy:VERSIONS.policy}));

export function validateDataset(raw:string, descriptor:DatasetDescriptor):ResearchDataset {
  if (hashText(raw) !== descriptor.dataHash) throw new ResearchError('EDITION_MISMATCH','The registered dataset bytes do not match this pinned edition.');
  const data = ResearchDatasetSchema.parse(boundedInput(raw,LIMITS.dataBytes));
  if (data.id !== descriptor.id || data.edition !== descriptor.edition || data.source.sha256 !== descriptor.sourceHash || data.canonical.sha256 !== descriptor.canonicalHash || data.source.id !== descriptor.sourceId) throw new ResearchError('EDITION_MISMATCH','Dataset/source identities differ from the registered edition.');
  let url:URL;
  try { url = new URL(data.source.url); } catch { throw new ResearchError('UNKNOWN_REFERENCE','Source link is invalid.'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new ResearchError('UNKNOWN_REFERENCE','Source link is not a permitted HTTPS citation.');
  if (data.source.license !== descriptor.license || data.source.rights !== 'authorized-local-preview') throw new ResearchError('INSUFFICIENT_EVIDENCE','Source permissions do not match this local preview.');
  const entities = new Map(data.entities.map(e=>[e.id,e]));
  if (entities.size !== data.entities.length) throw new ResearchError('INVALID_SPEC','Duplicate entity identities.');
  const ids = new Set<string>(), keys = new Set<string>(), pointers = new Set<string>();
  for (const row of data.observations) {
    const key = `${row.entityId}:${row.year}`;
    if (!entities.has(row.entityId)) throw new ResearchError('UNKNOWN_REFERENCE','An observation has no registered entity.');
    if (ids.has(row.id) || keys.has(key) || pointers.has(row.locator.jsonPointer)) throw new ResearchError('INVALID_SPEC','Duplicate observations or source joins are not permitted.');
    ids.add(row.id);keys.add(key);pointers.add(row.locator.jsonPointer);
    if (row.locator.cell !== row.locator.column + row.locator.row) throw new ResearchError('UNKNOWN_REFERENCE','Source row and cell locator disagree.');
    if (row.precision === 'range' && (row.timeEnd === undefined || row.timeEnd < row.year)) throw new ResearchError('INVALID_SPEC','Uncertain date requires an ordered interval.');
    if (row.precision === 'year' && row.timeEnd !== undefined && row.timeEnd !== row.year) throw new ResearchError('INVALID_SPEC','Year precision cannot hide a date range.');
    if (row.evidenceType !== descriptor.evidenceType || row.precision !== 'year' || row.dateMeaning !== 'mid-year estimate') throw new ResearchError('INSUFFICIENT_EVIDENCE','These records do not match the registered yearly estimate semantics.');
    if ((row.value === null) !== (row.sourceValue === null)) throw new ResearchError('INSUFFICIENT_EVIDENCE','Missing is not zero; value and source missingness differ.');
    if (row.value !== null && row.sourceValue !== null && Math.round(row.sourceValue * 1000) !== row.value) throw new ResearchError('INSUFFICIENT_EVIDENCE','Displayed persons do not match the declared source-unit conversion.');
  }
  const years = data.observations.map(r=>r.year), c = descriptor.coverage;
  if (c.entityCount !== data.entities.length || c.rowCount !== data.observations.length || c.firstYear !== Math.min(...years) || c.lastYear !== Math.max(...years)) throw new ResearchError('EDITION_MISMATCH','Registered coverage differs from loaded records.');
  return immutable(data);
}

export function observationInWindow(row:ResearchObservation, window:TimeWindow):boolean {
  return row.year <= window.end && (row.timeEnd ?? row.year) >= window.start;
}
export function observationAtCursor(rows:readonly ResearchObservation[], entityId:string, cursorYear:number):{observation:ResearchObservation;status:'same-year-estimate'|'dated-reference'|'uncertain-interval'}|null {
  const eligible = rows.filter(r=>r.entityId === entityId && r.year <= cursorYear).sort((a,b)=>b.year-a.year || a.id.localeCompare(b.id));
  const row = eligible[0];
  if (!row) return null;
  return {observation:row,status:row.precision === 'range' && cursorYear <= (row.timeEnd ?? row.year) ? 'uncertain-interval' : row.year === Math.floor(cursorYear) ? 'same-year-estimate' : 'dated-reference'};
}

/** Optional trusted arithmetic guard; the first pilot's query vocabulary never enables arithmetic. */
export function requireComparable(a:ResearchObservation,b:ResearchObservation,ea:ResearchEntity,eb:ResearchEntity,denominator:number|null):void {
  if (a.unit === 'unknown' || b.unit === 'unknown' || a.unit !== b.unit || a.value === null || b.value === null || denominator === null || !Number.isFinite(denominator) || denominator <= 0) throw new ResearchError('INSUFFICIENT_EVIDENCE','Known units, observed values and a positive declared denominator are required.');
  if (a.entityId !== ea.id || b.entityId !== eb.id || ea.id !== eb.id || ea.definitionStatus !== 'explicit' || eb.definitionStatus !== 'explicit' || ea.spatialComparability !== 'fixed-boundary' || eb.spatialComparability !== 'fixed-boundary' || ea.geographicDefinition !== eb.geographicDefinition) throw new ResearchError('INCOMPATIBLE_GEOGRAPHY','Arithmetic requires matching entity metadata and a documented compatible fixed geography.');
}

export function compilePlan(spec:DashboardSpecification,registry:DatasetRegistry):QueryPlan {
  const plan = QueryPlanSchema.parse(spec.query); validateWindow(plan.timeWindow);
  const registration = registry.get(plan.datasetId);
  if (!registration) throw new ResearchError('UNKNOWN_REFERENCE','This dataset is not in the approved local catalogue.');
  const d = DatasetDescriptorSchema.parse(registration.descriptor);
  if (plan.edition !== d.edition || plan.dataHash !== d.dataHash) throw new ResearchError('EDITION_MISMATCH','The requested dataset edition/hash is not available.');
  if (plan.entityIds.length > LIMITS.entities || plan.maxRows > LIMITS.rows || plan.entityIds.length * d.coverage.rowCount > LIMITS.entities * LIMITS.rows) throw new ResearchError('BUDGET_EXCEEDED','Projected query expansion exceeds the declared budget.');
  // No joins or expression strings reach execution. Sorting IDs normalizes equivalent plans.
  return {...plan,entityIds:[...plan.entityIds].sort(),fields:[...plan.fields].sort()};
}

export function executePlan(plan:QueryPlan,data:ResearchDataset,descriptor:DatasetDescriptor):ResolvedDataBundle {
  const entities = new Map(data.entities.map(e=>[e.id,e]));
  for (const id of plan.entityIds) if (!entities.has(id)) throw new ResearchError('UNKNOWN_REFERENCE','A requested settlement is absent from the registered edition.');
  const allowed = new Set(plan.entityIds);
  const observations = data.observations.filter(r=>allowed.has(r.entityId) && observationInWindow(r,plan.timeWindow)).sort((a,b)=>a.entityId.localeCompare(b.entityId) || a.year-b.year || a.id.localeCompare(b.id));
  if (!observations.length) throw new ResearchError('INSUFFICIENT_EVIDENCE','No observations cover this analysis window. The last valid workspace is retained.');
  if (observations.length > plan.maxRows || observations.length > LIMITS.rows) throw new ResearchError('BUDGET_EXCEEDED','The query exceeds its row budget; it has not been silently truncated.');
  if (observations.some(r=>r.unit !== descriptor.unit)) throw new ResearchError('INSUFFICIENT_EVIDENCE','Unknown or incompatible units cannot share the population chart.');
  const used = new Set(observations.map(r=>r.entityId));
  const selectedEntities = plan.entityIds.filter(id=>used.has(id)).map(id=>entities.get(id)!);
  const warnings = [data.coverageNote,'Points are source estimates, not continuous measurements. First available estimate does not mean founding date.','Changing urban extents: growth rates, totals, ratios and cross-dataset joins are disabled.','Source-attributed estimates; software validation is not independent scholarly review.'];
  const summary = {observationCount:observations.length,entityCount:selectedEntities.length,firstYear:Math.min(...observations.map(r=>r.year)),lastYear:Math.max(...observations.map(r=>r.timeEnd ?? r.year))};
  const lineage = observations.map(r=>({id:r.id,operation:'source-unit-conversion' as const,inputCell:`${data.source.sheet}!${r.locator.cell}`,sourceHash:data.source.sha256,canonicalPointer:r.locator.jsonPointer}));
  const body = {descriptor,entities:selectedEntities,observations,sources:[data.source],warnings,summary,lineage};
  return immutable(ResolvedDataBundleSchema.parse(boundedInput({...body,resultHash:hashText(canonicalJSON(body))},LIMITS.dataBytes)));
}

export function makeManifest(spec:DashboardSpecification,plan:QueryPlan,bundle:ResolvedDataBundle):ExecutionManifest {
  const d=bundle.descriptor;
  // Free-form labels/question text are deliberately not exported. A replay carries only
  // host-authored labels plus resolved catalogue references, never arbitrary user prose.
  const normalizedSpec:DashboardSpecification={...spec,id:'saved-population-workspace',title:'Saved population observations',
    intent:{question:'What population observations are available in this saved scope?',interpretation:'Registered population observations with declared source definitions.',timeWindow:plan.timeWindow,context:'explicit-entities',parentId:null},
    query:plan,views:spec.views.map(v=>({...v,id:`view-${v.type}`}))};
  return immutable(ExecutionManifestSchema.parse({schemaVersion:1,kind:'chronicle-research-replay',specification:normalizedSpec,plan,versions:VERSIONS,
    dependencies:[{datasetId:d.id,edition:d.edition,dataHash:d.dataHash,sourceHash:d.sourceHash,canonicalHash:d.canonicalHash}],
    resultHash:bundle.resultHash,observationIds:bundle.observations.map(r=>r.id),warnings:bundle.warnings,planner:'manual-prepared-example',exportPolicy:'references-only'}));
}
export class ResearchEngine {
  private readonly datasets=new Map<string,ResearchDataset>();
  private readonly results=new Map<string,PreparedResult>();
  constructor(readonly registry:DatasetRegistry) {}
  async prepare(input:unknown,signal:AbortSignal):Promise<PreparedResult> {
    const spec=parseSpecification(input), plan=compilePlan(spec,this.registry);
    const key=hashText(canonicalJSON({plan,spec,descriptor:this.registry.get(plan.datasetId)!.descriptor,versions:VERSIONS}));
    if(signal.aborted) throw new ResearchError('CANCELLED','Request cancelled.');
    const cached=this.results.get(key); if(cached) return cached;
    const registration=this.registry.get(plan.datasetId)!;
    const datasetKey=datasetIdentity(registration.descriptor);
    let data=this.datasets.get(datasetKey);
    if(!data){
      const raw=await registration.load(signal);
      if(signal.aborted) throw new ResearchError('CANCELLED','Request cancelled.');
      data=validateDataset(raw,registration.descriptor);
      this.datasets.set(datasetKey,data);
    }
    const bundle=executePlan(plan,data,registration.descriptor);
    const result=immutable({spec,plan,bundle,manifest:makeManifest(spec,plan,bundle)});
    if(this.results.size>=8)this.results.delete(this.results.keys().next().value!);
    this.results.set(key,result);return result;
  }
  async replay(input:unknown,signal:AbortSignal):Promise<PreparedResult>{
    const m=ExecutionManifestSchema.parse(boundedInput(input));
    const result=await this.prepare(m.specification,signal);
    // Full deterministic equality catches substituted lineage, policies, warnings and output IDs.
    if(canonicalJSON(m)!==canonicalJSON(result.manifest))throw new ResearchError('EDITION_MISMATCH','Replay dependencies or results differ from the pinned manifest. Nothing was replaced.');
    return result;
  }
  evidence(datasetId:string,selection:{entityId:string;observationId:string},pinnedDescriptor?:DatasetDescriptor){
    const d=pinnedDescriptor??this.registry.get(datasetId)?.descriptor;
    if(!d)return null;
    const data=this.datasets.get(datasetIdentity(d));
    const observation=data?.observations.find(r=>r.id===selection.observationId && r.entityId===selection.entityId);
    const entity=data?.entities.find(e=>e.id===selection.entityId);
    return data&&observation&&entity?{observation,entity,source:data.source}:null;
  }
  getDiagnostics(){return{datasets:this.datasets.size,results:this.results.size};}
  dispose(){this.datasets.clear();this.results.clear();}
}
