/** Trusted reference-only compiler. Registered fixtures are the only data source. */
import { canonicalJSON, hashText, immutable, validateDataset } from '../src/research/engine.ts';
import { PILOT_DESCRIPTOR } from '../src/research/registry.ts';
import {
  boundedSemanticInput, DashboardSpecificationSchema, DatasetDescriptorSchema, FixtureSchema,
  NormalizerSchema, QueryIntentSchema, QueryPlanSchema, ReplayManifestSchema, ResolvedDataBundleSchema,
  SemanticError, SEMANTIC_LIMITS, SEMANTIC_VERSIONS,
  type BoundingBox,type DashboardSpecification,type DatasetDescriptor,type QueryIntent,type QueryPlan,
  type RegisteredNormalizer,type ReplayManifest,type ResolvedDataBundle,type SemanticEntity,type SemanticFixture,type SemanticObservation,
} from './contracts.ts';

export interface RegisteredFixture {readonly descriptor:DatasetDescriptor;readonly fixture:SemanticFixture}
export type SemanticCatalogue = ReadonlyMap<string,RegisteredFixture>;
export type NormalizerCatalogue = ReadonlyMap<string,RegisteredNormalizer>;
const verifiedRegistrations=new WeakSet<RegisteredFixture>();
function error(code:ConstructorParameters<typeof SemanticError>[0],message:string):never {throw new SemanticError(code,message);}
const unique=(values:readonly string[],label:string):void=>{if(new Set(values).size!==values.length)error('INVALID_SPEC',`Repeated ${label} are not permitted.`);};
const pointWithin=(point:readonly [number,number],bbox:BoundingBox):boolean=>point[0]>=bbox[0]&&point[0]<=bbox[2]&&point[1]>=bbox[1]&&point[1]<=bbox[3];
const bboxWithin=(inner:BoundingBox,outer:BoundingBox):boolean=>inner[0]>=outer[0]&&inner[1]>=outer[1]&&inner[2]<=outer[2]&&inner[3]<=outer[3];
const descriptorHash=(descriptor:DatasetDescriptor):string=>hashText(canonicalJSON(descriptor));

/** Validates cross-record meaning in addition to structural schemas. It certifies consistency, not historical truth. */
export function validateFixture(input:unknown):SemanticFixture {
  const fixture=FixtureSchema.parse(boundedSemanticInput(input,SEMANTIC_LIMITS.fixtureBytes));
  unique(fixture.entities.map(x=>x.id),'entities');unique(fixture.observations.map(x=>x.id),'observations');
  unique(fixture.indicators.map(x=>x.id),'indicators');unique(fixture.sourcePins.map(x=>x.id),'source pins');
  const entities=new Map(fixture.entities.map(x=>[x.id,x])),indicators=new Map(fixture.indicators.map(x=>[x.id,x])),sources=new Map(fixture.sourcePins.map(x=>[x.id,x]));
  const observations=new Map(fixture.observations.map(x=>[x.id,x]));
  for(const entity of fixture.entities)if(!pointWithin(entity.coordinates,fixture.bounds.bbox))error('OUT_OF_BOUNDS','An entity reference point is outside the registered bounding box.');
  for(const row of fixture.observations){
    const indicator=indicators.get(row.indicatorId),source=sources.get(row.provenance.sourceId);
    if(!entities.has(row.entityId)||!indicator||!source)error('UNKNOWN_REFERENCE','Observation entity, indicator or source is not registered.');
    if(source.sha256!==row.provenance.sourceSha256)error('EDITION_MISMATCH','Observation source hash does not match its registered source.');
    if(!indicator.allowedEvidence.includes(row.epistemicStatus))error('INCOMPATIBLE_SEMANTICS','Evidence class is not allowed by this indicator.');
    if(row.value!==null&&((indicator.kind==='quantitative'&&typeof row.value!=='number')||(indicator.kind==='qualitative'&&typeof row.value!=='string')))error('INCOMPATIBLE_SEMANTICS','Value and indicator measurement class disagree.');
    if(row.time.startYear<fixture.bounds.epoch[0]||row.time.endYear>fixture.bounds.epoch[1])error('OUT_OF_BOUNDS','Observation date lies outside the registered epoch.');
    if(row.confidence.kind==='source-interval'&&(indicator.kind!=='quantitative'||typeof row.value!=='number'||row.value<row.confidence.lower||row.value>row.confidence.upper))error('INCOMPATIBLE_SEMANTICS','A quantitative source uncertainty interval must contain its value.');
    if(row.derivation){
      unique(row.derivation.inputObservationIds,'derivation inputs');
      for(const inputId of row.derivation.inputObservationIds){const inputRow=observations.get(inputId);
        if(!inputRow||inputId===row.id)error('UNKNOWN_REFERENCE','Derived evidence must resolve to distinct retained inputs.');
        if(inputRow.indicatorId!==row.indicatorId||inputRow.entityId!==row.entityId)error('INCOMPATIBLE_SEMANTICS','Derived evidence inputs have incompatible indicators or entities.');
        if(inputRow.derivation!==null)error('INCOMPATIBLE_SEMANTICS','Nested derivations are outside this bounded pilot.');
      }
    }
  }
  return immutable(fixture);
}

/** Explicit host registration pins exact fixture bytes plus metadata. No plan can register a loader. */
export function registerFixture(raw:string,expectedHash:string,permittedNormalizerIds:readonly string[]=[]):RegisteredFixture {
  if(hashText(raw)!==expectedHash)error('EDITION_MISMATCH','Fixture bytes differ from the host-pinned edition.');
  const fixture=validateFixture(raw);
  const descriptor=DatasetDescriptorSchema.parse({id:fixture.id,edition:fixture.edition,dataHash:expectedHash,sourcePins:fixture.sourcePins,bounds:fixture.bounds,indicators:fixture.indicators,entityIds:fixture.entities.map(x=>x.id),rowCount:fixture.observations.length,permittedNormalizerIds:[...permittedNormalizerIds],exportPolicy:'references-only'});
  unique(descriptor.permittedNormalizerIds,'normalizers');
  const registration=immutable({descriptor,fixture});verifiedRegistrations.add(registration);return registration;
}
export function createCatalogue(registrations:readonly RegisteredFixture[]):SemanticCatalogue {
  unique(registrations.map(x=>x.descriptor.id),'catalogue IDs');
  if(registrations.some(x=>!verifiedRegistrations.has(x)))error('EDITION_MISMATCH','Only byte-verified immutable registrations enter the catalogue.');
  return new Map(registrations.map(x=>[x.descriptor.id,x]));
}

/** Adapt the already verified 44 UN observations without changing any canonical file. */
export function modernFixtureFromRaw(raw:string):SemanticFixture {
  const pilot=validateDataset(raw,PILOT_DESCRIPTOR);
  const lons=pilot.entities.map(x=>x.coordinates[0]),lats=pilot.entities.map(x=>x.coordinates[1]);
  return validateFixture({schemaVersion:1,id:pilot.id,edition:pilot.edition,coverageNote:pilot.coverageNote,
    sourcePins:[{id:pilot.source.id,edition:pilot.source.edition,sha256:pilot.source.sha256,title:pilot.source.title,locator:`${pilot.source.file} / ${pilot.source.sheet}`,rights:'authorized-local-preview',modelProcessing:false,republication:false},
      {id:'chronicle-canonical-cities',edition:pilot.edition,sha256:pilot.canonical.sha256,title:'Retained Chronicle city observations',locator:pilot.canonical.path,rights:'authorized-local-preview',modelProcessing:false,republication:false}],
    indicators:[{id:'population',label:'DEGURBA urban centre population estimate',kind:'quantitative',unit:'persons',allowedEvidence:['modeled']}],
    bounds:{bbox:[Math.min(...lons),Math.min(...lats),Math.max(...lons),Math.max(...lats)],epoch:[1975,2025]},
    entities:pilot.entities.map(entity=>({id:entity.id,label:entity.label,coordinates:entity.coordinates,spatialSupport:{definition:entity.geographicDefinition,comparability:'definition-only',uncertaintyKm:null}})),
    observations:pilot.observations.map(row=>({id:row.id,entityId:row.entityId,indicatorId:'population',value:row.value,epistemicStatus:'modeled',time:{startYear:row.year,endYear:row.year,precision:'year',meaning:row.dateMeaning},compositionTime:null,
      confidence:{kind:'not-supplied',note:'The retained UN table supplies no measurement interval, sampling confidence level or cell-specific estimation method. No confidence range is invented.'},
      provenance:{sourceId:pilot.source.id,locator:`Data!${row.locator.cell}; ${row.locator.jsonPointer}`,sourceSha256:pilot.source.sha256,recordSha256:hashText(canonicalJSON(row)),bibliographySourceIds:[pilot.source.id]},derivation:null,author:null,perspective:null,
      limitations:['Published UN estimate; modeled is the semantic umbrella for estimated population, not a claim that a specific model was verified for this cell.','Five-year observations are discrete. Unknown gap years are not interpolated.','Urban definitions are documented; constant geographic footprints are not established.','Source thousands converted to rounded persons; this is not person-level measurement accuracy.'],
      supportNote:'Source-linked population estimate retained by Chronicle. Arithmetic, pooled totals, growth rates and automatic joins remain disabled.',reviewStatus:'source-attributed'})),
  });
}
export function registerModernPilot(raw:string):RegisteredFixture {
  const semanticRaw=canonicalJSON(modernFixtureFromRaw(raw));
  return registerFixture(semanticRaw,hashText(semanticRaw));
}

function checkScope(scope:QueryIntent['scope'],descriptor:DatasetDescriptor):void {
  unique(scope.entityIds,'selected entities');
  if(scope.datasetId!==descriptor.id||!descriptor.indicators.some(x=>x.id===scope.indicatorId)||scope.entityIds.some(id=>!descriptor.entityIds.includes(id)))error('UNKNOWN_REFERENCE','Dataset, indicator or entity is not registered for this scope.');
  if(!bboxWithin(scope.bbox,descriptor.bounds.bbox)||scope.epoch[0]<descriptor.bounds.epoch[0]||scope.epoch[1]>descriptor.bounds.epoch[1])error('OUT_OF_BOUNDS','Requested geography or epoch exceeds verified catalogue bounds.');
}
export function compileIntent(input:unknown,catalogue:SemanticCatalogue):QueryPlan {
  const intent=QueryIntentSchema.parse(boundedSemanticInput(input)),registered=catalogue.get(intent.scope.datasetId);
  if(!registered)error('UNKNOWN_REFERENCE','Requested dataset is absent from the local catalogue.');
  if(!verifiedRegistrations.has(registered))error('EDITION_MISMATCH','Catalogue registration is not byte-verified.');
  const descriptor=DatasetDescriptorSchema.parse(registered.descriptor);checkScope(intent.scope,descriptor);
  return immutable(QueryPlanSchema.parse({schemaVersion:1,scope:{...intent.scope,entityIds:[...intent.scope.entityIds].sort()},edition:descriptor.edition,dataHash:descriptor.dataHash,descriptorHash:descriptorHash(descriptor),operation:'observations',sort:'entity-time-id',fields:['id','entityId','indicatorId','value','time','epistemicStatus','provenance'],joins:[],maxRows:descriptor.rowCount,policyVersion:SEMANTIC_VERSIONS.policy}));
}
export function validateSpecification(input:unknown,catalogue:SemanticCatalogue):DashboardSpecification {
  const spec=DashboardSpecificationSchema.parse(boundedSemanticInput(input));
  unique(spec.views.map(x=>x.id),'view IDs');unique(spec.views.map(x=>x.type),'view types');
  const expected=compileIntent(spec.intent,catalogue);
  if(canonicalJSON(expected)!==canonicalJSON(spec.plan))error('INVALID_SPEC','The declarative plan does not match its intent and registered policy.');
  return immutable(spec);
}
export function resolvePlan(input:unknown,catalogue:SemanticCatalogue):ResolvedDataBundle {
  const plan=QueryPlanSchema.parse(boundedSemanticInput(input)),registered=catalogue.get(plan.scope.datasetId);
  if(!registered)error('UNKNOWN_REFERENCE','Requested pinned dataset is unavailable.');
  if(!verifiedRegistrations.has(registered))error('EDITION_MISMATCH','Catalogue registration is not byte-verified.');
  const descriptor=DatasetDescriptorSchema.parse(registered.descriptor);checkScope(plan.scope,descriptor);
  if(plan.edition!==descriptor.edition||plan.dataHash!==descriptor.dataHash||plan.descriptorHash!==descriptorHash(descriptor))error('EDITION_MISMATCH','Pinned data or semantic metadata changed; replay will not use the latest edition.');
  if(plan.maxRows>descriptor.rowCount)error('BUDGET_EXCEEDED','Requested row budget exceeds the registered fixture.');
  const fixture=registered.fixture;
  const entityIds=new Set(plan.scope.entityIds),entities=fixture.entities.filter(x=>entityIds.has(x.id)&&pointWithin(x.coordinates,plan.scope.bbox));
  const visible=new Set(entities.map(x=>x.id));
  const observations=fixture.observations.filter(row=>visible.has(row.entityId)&&row.indicatorId===plan.scope.indicatorId&&row.time.startYear<=plan.scope.epoch[1]&&row.time.endYear>=plan.scope.epoch[0])
    .sort((a,b)=>a.entityId.localeCompare(b.entityId)||a.time.startYear-b.time.startYear||a.id.localeCompare(b.id));
  if(observations.length>plan.maxRows)error('BUDGET_EXCEEDED','Result exceeds the requested row budget; rows are not silently truncated.');
  const warnings=[fixture.coverageNote,'Missing values are not zero. No interpolation, arithmetic or automatic dataset join is performed.'];
  const content={descriptor,entities,observations,sourcePins:fixture.sourcePins,warnings};
  return immutable(ResolvedDataBundleSchema.parse({...content,resultHash:hashText(canonicalJSON(content))}));
}

export function makeReplay(planInput:unknown,catalogue:SemanticCatalogue):ReplayManifest {
  const plan=QueryPlanSchema.parse(boundedSemanticInput(planInput)),bundle=resolvePlan(plan,catalogue),d=bundle.descriptor;
  return immutable(ReplayManifestSchema.parse({schemaVersion:1,kind:'chronicle-semantic-replay',plan,versions:SEMANTIC_VERSIONS,dependencies:[{datasetId:d.id,edition:d.edition,dataHash:d.dataHash,descriptorHash:descriptorHash(d),sourceHashes:d.sourcePins.map(x=>x.sha256)}],resultHash:bundle.resultHash,observationIds:bundle.observations.map(x=>x.id),planner:'manual-prepared-example',exportPolicy:'references-only'}));
}
export function replay(input:unknown,catalogue:SemanticCatalogue):ResolvedDataBundle {
  const manifest=ReplayManifestSchema.parse(boundedSemanticInput(input));
  const expected=makeReplay(manifest.plan,catalogue);
  if(canonicalJSON(manifest)!==canonicalJSON(expected))error('EDITION_MISMATCH','Replay source pins, result identities or policy differ.');
  return resolvePlan(manifest.plan,catalogue);
}

/** No normalizer is installed for either pilot. This explicit gate never executes arithmetic. */
export function requireRegisteredNormalizer(
  left:{descriptor:DatasetDescriptor;entity:SemanticEntity;observation:SemanticObservation},
  right:{descriptor:DatasetDescriptor;entity:SemanticEntity;observation:SemanticObservation},
  normalizerId:string,catalogue:NormalizerCatalogue,
):RegisteredNormalizer {
  const candidate=catalogue.get(normalizerId);
  if(!candidate||!left.descriptor.permittedNormalizerIds.includes(normalizerId)||!right.descriptor.permittedNormalizerIds.includes(normalizerId))error('INCOMPATIBLE_SEMANTICS','No explicitly registered normalizer permits this comparison.');
  const rule=NormalizerSchema.parse(candidate),li=left.descriptor.indicators.find(x=>x.id===left.observation.indicatorId),ri=right.descriptor.indicators.find(x=>x.id===right.observation.indicatorId);
  if(!li||!ri||li.id!==rule.leftIndicator||ri.id!==rule.rightIndicator||li.kind!==ri.kind||li.unit!==ri.unit||li.unit!==rule.unit)error('INCOMPATIBLE_SEMANTICS','Normalizer indicators or measurement units are incompatible.');
  if(left.observation.value===null||right.observation.value===null||!rule.evidenceClasses.includes(left.observation.epistemicStatus)||!rule.evidenceClasses.includes(right.observation.epistemicStatus))error('INSUFFICIENT_EVIDENCE','Normalizer requires observed values and explicitly allowed evidence classes.');
  if(left.entity.id!==left.observation.entityId||right.entity.id!==right.observation.entityId||left.entity.id!==right.entity.id||left.entity.spatialSupport.comparability!=='fixed'||right.entity.spatialSupport.comparability!=='fixed'||left.entity.spatialSupport.definition!==rule.geographyDefinition||right.entity.spatialSupport.definition!==rule.geographyDefinition)error('INCOMPATIBLE_SEMANTICS','Matching documented fixed geography is required.');
  const a=left.observation.time,b=right.observation.time;
  if(a.startYear!==b.startYear||a.endYear!==b.endYear||a.precision!==b.precision||a.meaning!==b.meaning||a.startYear<rule.epoch[0]||a.endYear>rule.epoch[1])error('INCOMPATIBLE_SEMANTICS','Normalizer temporal support does not match.');
  return immutable(rule);
}
