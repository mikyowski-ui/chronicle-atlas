import { boundedResponse } from './temporal.ts';
import { sha256 } from '@noble/hashes/sha2.js';
// Updated only by the offline compiler when retained inputs produce a new sidecar.
export const CONTEXT_METRICS_IDENTITY = Object.freeze({sha256:'784ed26eecfeb7565be58d865dd66c47251f71a43db1581799fc36a29c09c570',bytes:303546});
/** Compact compiler sidecar. Geometry remains exclusively in the compiler. */
export type ContextMetricsRow = readonly [entityId:string, areaKm2:number|null, sourceParts:number, kind:'political'|'cultural'|'context', reason?:string];
export interface ContextMetricsObservation {
  edition:string;epoch_id:string;t_start:number;t_end:number;scope:'world'|'regional';geometry_sha256:string;rows:readonly ContextMetricsRow[];
}
export interface ContextMetricsDocument {
  schema_version:1;method:'display-union-wgs84-v1';meaning:string;methodology:string;
  source:{title:string;revision:string;license:string;attribution:string};observations:readonly ContextMetricsObservation[];
}
export interface EntityMetricObservation {edition:string;epoch_id:string;t_start:number;t_end:number;scope:'world'|'regional';kind:ContextMetricsRow[3]}
export interface ContextMetric {
  entityId:string;areaKm2:number|null;sourceParts:number;kind:ContextMetricsRow[3];scope:'world'|'regional';
  label:'Approximate mapped footprint'|'Approximate regional footprint';meaning:string;methodology:string;
  observationStart:number;observationEnd:number;geometryHash:string;reason?:string;
}
export const CONTEXT_METRICS_LIMITS=Object.freeze({bytes:1_048_576,observations:80,entries:6_000});
export function createContextMetrics(value:unknown){
  const document=value as ContextMetricsDocument;
  if(!document||document.schema_version!==1||document.method!=='display-union-wgs84-v1'||typeof document.meaning!=='string'||typeof document.methodology!=='string'||!document.source||!Array.isArray(document.observations)||document.observations.length>CONTEXT_METRICS_LIMITS.observations)throw Error('Invalid context metrics document');
  const index=new Map<string,ReadonlyMap<string,ContextMetric>>();const entityObservations=new Map<string,EntityMetricObservation[]>();let count=0;
  for(const observation of document.observations){
    if(typeof observation.edition!=='string'||!observation.edition||typeof observation.epoch_id!=='string'||!observation.epoch_id||!Number.isSafeInteger(observation.t_start)||!Number.isSafeInteger(observation.t_end)||observation.t_start>=observation.t_end||!['world','regional'].includes(observation.scope)||! /^[a-f0-9]{64}$/.test(observation.geometry_sha256)||!Array.isArray(observation.rows))throw Error('Invalid context metrics observation');
    const key=JSON.stringify([observation.edition,observation.epoch_id]);if(index.has(key))throw Error('Duplicate context metrics scene');
    const entities=new Map<string,ContextMetric>();
    for(const row of observation.rows){
      if(!Array.isArray(row)||row.length<4||row.length>5||typeof row[0]!=='string'||!row[0]||entities.has(row[0])||(row[1]!==null&&(!Number.isSafeInteger(row[1])||row[1]<0))||!Number.isSafeInteger(row[2])||row[2]<1||!['political','cultural','context'].includes(row[3])||(row[4]!==undefined&&typeof row[4]!=='string')||(row[1]===null&&!row[4]))throw Error('Invalid context metrics row');
      entities.set(row[0],Object.freeze({entityId:row[0],areaKm2:row[1],sourceParts:row[2],kind:row[3],scope:observation.scope,label:observation.scope==='regional'?'Approximate regional footprint':'Approximate mapped footprint',meaning:document.meaning,methodology:document.methodology,observationStart:observation.t_start,observationEnd:observation.t_end,geometryHash:observation.geometry_sha256,reason:row[4]}));
      const history=entityObservations.get(row[0])??[];history.push(Object.freeze({edition:observation.edition,epoch_id:observation.epoch_id,t_start:observation.t_start,t_end:observation.t_end,scope:observation.scope,kind:row[3]}));entityObservations.set(row[0],history);
      if(++count>CONTEXT_METRICS_LIMITS.entries)throw Error('Context metrics entry budget exceeded');
    }
    index.set(key,entities);
  }
  for(const [id,history] of entityObservations)entityObservations.set(id,Object.freeze(history.sort((a,b)=>a.t_start-b.t_start||a.edition.localeCompare(b.edition))) as unknown as EntityMetricObservation[]);
  return Object.freeze({size:count,observations:index.size,observationsForEntity(entityId:string):readonly EntityMetricObservation[]{return entityObservations.get(entityId)??Object.freeze([]);},forScene(scene:{edition:string;epoch_id:string;time:number},entityId:string):ContextMetric|null{
    const row=index.get(JSON.stringify([scene.edition,scene.epoch_id]))?.get(entityId);
    return row&&row.observationStart<=scene.time&&scene.time<row.observationEnd?row:null;
  }});
}
export type ContextMetrics=ReturnType<typeof createContextMetrics>;
export function metricsForScene(metrics:ContextMetrics|null|undefined,scene:{edition:string;epoch_id:string;time:number}|null|undefined,entityId:string):ContextMetric|null{
  return metrics&&scene?metrics.forScene(scene,entityId):null;
}
/** One bounded static lookup fetch. A caller owns its lifetime and can cancel it. */
export async function loadContextMetrics(signal?:AbortSignal):Promise<ContextMetrics>{
  const response=await fetch(new URL('./glass/map-metrics.json',document.baseURI),{signal});
  const bytes=await boundedResponse(response,CONTEXT_METRICS_IDENTITY.bytes,signal);
  const digest=Array.from(sha256(new Uint8Array(bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  if(bytes.byteLength!==CONTEXT_METRICS_IDENTITY.bytes||digest!==CONTEXT_METRICS_IDENTITY.sha256)throw Error('Context metrics identity mismatch');
  signal?.throwIfAborted();
  return createContextMetrics(JSON.parse(new TextDecoder().decode(bytes)));
}
