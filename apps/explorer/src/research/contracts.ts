/** Research contracts: no DOM, map, network, database or model-vendor imports. */
export const VERSIONS = Object.freeze({schema: 1, compiler: 'research-query-1', policy: 'historical-semantics-1', transform: 'source-observations-1'});
export const LIMITS = Object.freeze({specBytes: 1024 * 1024, dataBytes: 10 * 1024 * 1024, depth: 12, nodes: 250000, entities: 2000, rows: 20000, views: 5, timeoutMs: 5000});
export type ErrorCode = 'INVALID_SPEC' | 'UNKNOWN_REFERENCE' | 'INCOMPATIBLE_GEOGRAPHY' | 'UNSUPPORTED_OPERATION' | 'INSUFFICIENT_EVIDENCE' | 'BUDGET_EXCEEDED' | 'EDITION_MISMATCH' | 'DATA_TIMEOUT' | 'CANCELLED';
export class ResearchError extends Error {
  constructor(readonly code: ErrorCode, message: string) { super(message); this.name = 'ResearchError'; }
}
function fail(message: string): never { throw new ResearchError('INVALID_SPEC', message); }

/** This small strict schema vocabulary is also the TypeScript type source. */
export interface Schema<T> { parse(value: unknown, path?: string): T }
export type Infer<S> = S extends Schema<infer T> ? T : never;
const schema = <T>(parse: (value: unknown, path: string) => T): Schema<T> => ({parse: (value, path = '$') => parse(value, path)});
const str = (max = 240, pattern?: RegExp) => schema<string>((v,p) => {
  if (typeof v !== 'string' || !v.trim() || v.length > max || (pattern && !pattern.test(v))) fail(`${p}: invalid text`);
  return v;
});
const num = (min: number, max: number, integer = false) => schema<number>((v,p) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || (integer && !Number.isSafeInteger(v))) fail(`${p}: invalid number`);
  return v;
});
const one = <const T extends readonly (string | number | boolean | null)[]>(...values: T) => schema<T[number]>((v,p) => {
  if (!values.includes(v as T[number])) fail(`${p}: unsupported value`);
  return v as T[number];
});
const arr = <T>(item: Schema<T>, max: number, min = 0) => schema<T[]>((v,p) => {
  if (!Array.isArray(v) || v.length < min || v.length > max) fail(`${p}: invalid array size`);
  return v.map((x,i) => item.parse(x, `${p}[${i}]`));
});
const nullable = <T>(item: Schema<T>) => schema<T | null>((v,p) => v === null ? null : item.parse(v,p));
const optional = <T>(item: Schema<T>) => schema<T | undefined>((v,p) => v === undefined ? undefined : item.parse(v,p));
const obj = <T extends Record<string, Schema<unknown>>>(shape: T) => schema<{[K in keyof T]: Infer<T[K]>}>((v,p) => {
  if (!v || typeof v !== 'object' || Array.isArray(v) || ![Object.prototype, null].includes(Object.getPrototypeOf(v))) fail(`${p}: object required`);
  const record = v as Record<string, unknown>;
  for (const key of Object.keys(record)) if (!Object.hasOwn(shape,key)) fail(`${p}: unknown field ${key}`);
  const out: Record<string, unknown> = {};
  for (const [key, validator] of Object.entries(shape)) {
    const value = validator.parse(record[key], `${p}.${key}`);
    if (value !== undefined) out[key] = value;
  }
  return out as {[K in keyof T]: Infer<T[K]>};
});

const id = str(120, /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);
const hash = str(64, /^[a-f0-9]{64}$/);
const text = schema<string>((v,p) => {
  const value = str(1200).parse(v,p);
  if (/[<>\u0000-\u0008]/.test(value) || /```|javascript:|data:|https?:\/\//i.test(value)) fail(`${p}: executable markup or resource text is not permitted`);
  return value;
});
const year = num(-12000, 3000, true);
const TimeWindowSchema = obj({start: year, end: year});
export type TimeWindow = Infer<typeof TimeWindowSchema>;
export const QueryIntentSchema = obj({question: text, interpretation: text, timeWindow: TimeWindowSchema, context: one('explicit-entities'), parentId: nullable(id)});
export type QueryIntent = Infer<typeof QueryIntentSchema>;
const fields = one('id','entityId','year','value','unit','locator');
export const QueryPlanSchema = obj({
  version: one(1), datasetId: id, edition: str(200), dataHash: hash,
  entityIds: arr(id, LIMITS.entities, 1), timeWindow: TimeWindowSchema,
  fields: arr(fields, 6, 6), sort: one('entity-year'), operation: one('observations'),
  joins: arr(id,0), maxRows: num(1, LIMITS.rows,true),
});
export type QueryPlan = Infer<typeof QueryPlanSchema>;
const ViewSchema = obj({id, type: one('summary','map','scatter','table','evidence'), binding: one('observations')});
export const DashboardSpecificationSchema = obj({
  schemaVersion: one(1), id, title: text, intent: QueryIntentSchema, query: QueryPlanSchema,
  views: arr(ViewSchema, LIMITS.views,1), interaction: one('entity-observation'), layout: one('adaptive'),
});
export type DashboardSpecification = Infer<typeof DashboardSpecificationSchema>;
const CoordSchema = schema<[number,number]>((v,p) => {
  if (!Array.isArray(v) || v.length !== 2) fail(`${p}: coordinate pair required`);
  return [num(-180,180).parse(v[0],p),num(-90,90).parse(v[1],p)];
});
export const ResearchEntitySchema = obj({id,label: str(200),coordinates: CoordSchema,geographicDefinition: str(1200),definitionStatus: one('explicit','unknown'),spatialComparability: one('definition-only','fixed-boundary','unknown')});
export type ResearchEntity = Infer<typeof ResearchEntitySchema>;
export const ResearchSourceSchema = obj({
  id,title: str(500),url: str(2000),edition: str(200),sha256: hash,license: str(200),rights: one('authorized-local-preview'),
  file: str(300),sheet: str(100),sourceUnit: one('thousands of persons'),conversion: one('round(value * 1000)'),
});
export type ResearchSource = Infer<typeof ResearchSourceSchema>;
export const ResearchObservationSchema = obj({
  id,entityId: id,year,timeEnd: optional(year),value: nullable(num(0,300000000)),sourceValue: nullable(num(0,300000)),
  unit: one('persons','unknown'),precision: one('year','range'),dateMeaning: str(200),evidenceType: one('estimate','model','recorded'),
  reviewStatus: one('source-attributed'),uncertainty: one(null),
  locator: obj({row: num(1,2000000,true),column: str(4,/^[A-Z]+$/),cell: str(20,/^[A-Z]+[1-9][0-9]*$/),jsonPointer: str(300,/^\/cities\/[0-9]+\/population\/[0-9]+$/)}),
});
export type ResearchObservation = Infer<typeof ResearchObservationSchema>;
export const ResearchDatasetSchema = obj({
  schemaVersion: one(1),id,edition: str(200),definition: str(2000),coverageNote: str(3000),source: ResearchSourceSchema,
  canonical: obj({path: one('public/history/cities.json'),sha256: hash}),
  entities: arr(ResearchEntitySchema,LIMITS.entities,1),observations: arr(ResearchObservationSchema,LIMITS.rows,1),
});
export type ResearchDataset = Infer<typeof ResearchDatasetSchema>;
export const DatasetDescriptorSchema = obj({
  id,edition: str(200),dataHash: hash,sourceHash: hash,canonicalHash: hash,variableId: one('population'),unit: one('persons'),
  geographicSupport: str(2000),temporalSupport: one('nominal astronomical year; mid-year estimates; inclusive analysis window'),
  nullSemantics: one('missing is not zero'),evidenceType: one('estimate'),reviewStatus: one('source-attributed'),
  coverage: obj({entityCount: num(1,LIMITS.entities,true),rowCount: num(1,LIMITS.rows,true),firstYear: year,lastYear: year}),
  sourceId: id,license: str(200),operators: arr(one('filter','sort','count','observations'),4,4),joins: arr(id,0),
  arithmetic: one('disabled-changing-urban-extents'),exportPolicy: one('references-only'),
});
export type DatasetDescriptor = Infer<typeof DatasetDescriptorSchema>;
export const ResolvedDataBundleSchema = obj({
  descriptor: DatasetDescriptorSchema, entities: arr(ResearchEntitySchema,LIMITS.entities,1),
  observations: arr(ResearchObservationSchema,LIMITS.rows,1), sources: arr(ResearchSourceSchema,1,1),
  warnings: arr(str(3000),20),summary: obj({observationCount:num(1,LIMITS.rows,true),entityCount:num(1,LIMITS.entities,true),firstYear:year,lastYear:year}),
  lineage: arr(obj({id,operation:one('source-unit-conversion'),inputCell:str(150),sourceHash:hash,canonicalPointer:str(300)}),LIMITS.rows,1),
  resultHash:hash,
});
export type ResolvedDataBundle = Infer<typeof ResolvedDataBundleSchema>;
export const ExecutionManifestSchema = obj({
  schemaVersion: one(1),kind: one('chronicle-research-replay'),specification: DashboardSpecificationSchema,plan: QueryPlanSchema,
  versions: obj({schema: one(1),compiler: one(VERSIONS.compiler),policy: one(VERSIONS.policy),transform: one(VERSIONS.transform)}),
  dependencies: arr(obj({datasetId: id,edition: str(200),dataHash: hash,sourceHash: hash,canonicalHash: hash}),1,1),
  resultHash: hash,observationIds: arr(id,LIMITS.rows),warnings: arr(str(3000),20),
  planner: one('manual-prepared-example'),exportPolicy: one('references-only'),
});
export type ExecutionManifest = Infer<typeof ExecutionManifestSchema>;

/** Reject size/depth/expansion hazards before strict contract parsing, including cycles. */
export function boundedInput(value: unknown, maxBytes = LIMITS.specBytes): unknown {
  let candidate = value;
  if (typeof candidate === 'string') {
    if (new TextEncoder().encode(candidate).byteLength > maxBytes) throw new ResearchError('BUDGET_EXCEEDED','Input exceeds its byte budget.');
    try { candidate = JSON.parse(candidate); } catch { fail('Invalid JSON.'); }
  }
  let nodes = 0;
  const visit = (v: unknown, depth: number, parents: Set<object>) => {
    if (++nodes > LIMITS.nodes || depth > LIMITS.depth) throw new ResearchError('BUDGET_EXCEEDED','Input is too large or deeply nested.');
    if (v && typeof v === 'object') {
      if (parents.has(v)) fail('Cyclic input is not supported.');
      if (!Array.isArray(v) && ![Object.prototype,null].includes(Object.getPrototypeOf(v))) fail('Only plain JSON objects are supported.');
      parents.add(v);
      for (const [key, val] of Object.entries(v)) {
        if (['__proto__','constructor','prototype'].includes(key)) fail('Unsafe object key.');
        if (typeof val === 'function' || typeof val === 'symbol' || typeof val === 'bigint') fail('Executable/non-JSON values are not supported.');
        visit(val,depth+1,parents);
      }
      parents.delete(v);
    }
  };
  visit(candidate,0,new Set());
  const encoded = JSON.stringify(candidate);
  if (typeof encoded !== 'string') fail('JSON input required.');
  if (new TextEncoder().encode(encoded).byteLength > maxBytes) throw new ResearchError('BUDGET_EXCEEDED','Input exceeds its byte budget.');
  return candidate;
}
export function validateWindow(window: TimeWindow): void {
  if (window.start > window.end) fail('Analysis window is reversed.');
}
export function parseSpecification(input: unknown): DashboardSpecification {
  const spec = DashboardSpecificationSchema.parse(boundedInput(input));
  validateWindow(spec.intent.timeWindow); validateWindow(spec.query.timeWindow);
  if (spec.intent.timeWindow.start !== spec.query.timeWindow.start || spec.intent.timeWindow.end !== spec.query.timeWindow.end) fail('Question and query windows differ.');
  if (new Set(spec.views.map(v=>v.id)).size !== spec.views.length || new Set(spec.views.map(v=>v.type)).size !== spec.views.length) fail('Duplicate view.');
  if (new Set(spec.query.entityIds).size !== spec.query.entityIds.length) fail('Duplicate entity IDs would multiply rows.');
  if (new Set(spec.query.fields).size !== 6) fail('Repeated or missing fields.');
  return spec;
}
