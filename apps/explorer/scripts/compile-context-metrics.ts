/** Offline only. Run: node --import tsx scripts/compile-context-metrics.ts */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import clipping from 'polygon-clipping';
import GeographicLib from 'geographiclib-geodesic';
import type { Geometry, Position } from 'geojson';
import type { ContextMetricsDocument, ContextMetricsObservation, ContextMetricsRow } from '../src/context-metrics.ts';
const root = fileURLToPath(new URL('../', import.meta.url));
const hash=(bytes: string|Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
type Ring = [number,number][];
type Polygon = Ring[];
const strip: Polygon = [[[-180,-90],[180,-90],[180,90],[-180,90],[-180,-90]]];
function unwrap(ring: Position[], reference?: number): Ring {
  if(ring.length<4)throw Error('Degenerate ring');
  const result:Ring=[];
  for(const point of ring){
    if(point.length<2||!point.slice(0,2).every(Number.isFinite)||Math.abs(point[1])>90)throw Error('Invalid coordinates');
    let longitude=point[0];
    const previous=result.at(-1)?.[0]??reference??longitude;
    while(longitude-previous>180)longitude-=360;
    while(longitude-previous< -180)longitude+=360;
    result.push([longitude,point[1]]);
  }
  if(Math.abs(result.at(-1)![0]-result[0][0])>1e-7||Math.abs(result.at(-1)![1]-result[0][1])>1e-7)throw Error('Ambiguous pole winding or unclosed ring');
  if(Math.max(...result.map(p=>p[0]))-Math.min(...result.map(p=>p[0]))>360)throw Error('Ambiguous longitude winding');
  return result;
}
/** Put seam-crossing rings into a common longitude strip before unioning duplicate/overlapping parts. */
function canonicalPolygon(input: Position[][]): Polygon[] {
  const outer=unwrap(input[0]);
  const reference=outer.reduce((sum,p)=>sum+p[0],0)/outer.length;
  const polygon=[outer,...input.slice(1).map(r=>unwrap(r,reference))];
  const low=Math.min(...outer.map(p=>p[0])),high=Math.max(...outer.map(p=>p[0]));
  const pieces:Polygon[]=[];
  for(let shift=Math.ceil((-180-high)/360);shift<=Math.floor((180-low)/360);shift++){
    const shifted=polygon.map(r=>r.map(([x,y]):[number,number]=>[x+shift*360,y]));
    if(low+shift*360>=-180&&high+shift*360<=180)pieces.push(shifted);
    else pieces.push(...clipping.intersection(shifted,strip));
  }
  return pieces;
}
function ringArea(ring: Ring):number {
  const polygon=GeographicLib.Geodesic.WGS84.Polygon(false);
  for(const [longitude,latitude] of ring.slice(0,-1))polygon.AddPoint(latitude,longitude);
  return Math.abs(polygon.Compute(false,true).area!)/1e6;
}
/** Explicitly approximate display footprint; does not change the retained display or audit mesh. */
export function displayFootprintKm2(geometries: readonly Geometry[]):number {
  const polygons:Polygon[]=[];
  for(const geometry of geometries){
    if(geometry.type==='Polygon')polygons.push(...canonicalPolygon(geometry.coordinates));
    else if(geometry.type==='MultiPolygon')for(const polygon of geometry.coordinates)polygons.push(...canonicalPolygon(polygon));
    else throw Error('Non-polygon display geometry');
  }
  if(!polygons.length)throw Error('No area geometry');
  const union=clipping.union(polygons);
  let area=0;
  for(const polygon of union){
    const value=ringArea(polygon[0])-polygon.slice(1).reduce((sum,ring)=>sum+ringArea(ring),0);
    if(!Number.isFinite(value)||value< -0.01)throw Error('Ambiguous geodesic ring area');
    area+=Math.max(0,value);
  }
  if(!Number.isFinite(area)||area>255_000_000)throw Error('Ambiguous hemisphere area');
  return area;
}
export async function compileContextMetrics(){
  const start=performance.now();
  const budget=JSON.parse(await readFile(resolve(root,'public/glass/metrics-budget.json'),'utf8'));
  let inputBytes=0;let entryCount=0;let unavailable=0;let peakRss=process.memoryUsage().rss;
  const inputs:{path:string;sha256:string;byte_length:number}[]=[];
  async function read(path:string,expected?:{sha256:string;byte_length:number},geometry=false){
    const bytes=await readFile(path);
    if(geometry&&bytes.length>budget.maximum_geometry_file_bytes)throw Error('Geometry file budget exceeded');
    const digest=hash(bytes);
    if(expected&&(expected.sha256!==digest||expected.byte_length!==bytes.length))throw Error('Retained manifest identity mismatch: '+path);
    inputs.push({path:path.slice(root.length),sha256:digest,byte_length:bytes.length});inputBytes+=bytes.length;
    return JSON.parse(bytes.toString());
  }
  const catalogPath=resolve(root,'public/global-history/catalog.json');
  const catalog=await read(catalogPath);
  const descriptors:{manifestPath:string;epochId?:string;scope:'world'|'regional';expected?:{sha256:string;byte_length:number}}[]=catalog.observations.map((o:any)=>({manifestPath:resolve(dirname(catalogPath),o.manifest),scope:'world',expected:{sha256:o.manifest_sha256,byte_length:o.manifest_bytes}}));
  const islesPath=resolve(root,'public/alpha/historical-manifest.json');
  const isles=await read(islesPath);
  const manifests=descriptors;
  const observations:ContextMetricsObservation[]=[];
  async function processEpoch(manifest:any,manifestPath:string,epoch:any,scope:'world'|'regional'){
    const fallback=epoch.fallback;
    const document=await read(resolve(dirname(manifestPath),fallback.url),fallback,true);
    if(document.edition!==manifest.edition||document.epoch_id!==epoch.epoch_id)throw Error('Geometry scene identity mismatch');
    const entities=new Map<string,{kind:string;geometries:Geometry[];parts:number}>();
    for(const f of document.territories){
      const p=f.properties;
      if(!['political','cultural','context'].includes(p.kind))throw Error('Unrecognized classification');
      const group:{kind:string;geometries:Geometry[];parts:number}=entities.get(p.entity_id)??{kind:p.kind,geometries:[],parts:0};
      if(group.kind!==p.kind)throw Error('Mixed semantic entity');
      group.geometries.push(f.geometry);group.parts++;entities.set(p.entity_id,group);
    }
    const rows:ContextMetricsRow[]=[];
    for(const [id,group] of [...entities.entries()].sort(([a],[b])=>a.localeCompare(b))){
      let area:number|null=null,reason:string|undefined;
      try{area=Math.round(displayFootprintKm2(group.geometries));}
      catch(error){unavailable++;reason=String(error instanceof Error?error.message:error).slice(0,160);}
      rows.push(reason?[id,area,group.parts,group.kind as ContextMetricsRow[3],reason]:[id,area,group.parts,group.kind as ContextMetricsRow[3]]);
      entryCount++;
      peakRss=Math.max(peakRss,process.memoryUsage().rss,process.resourceUsage().maxRSS*1024);
      if(peakRss>budget.max_rss_bytes)throw Error('Frozen RSS budget exceeded');
      if(entryCount>budget.maximum_entries)throw Error('Entry budget exceeded');
    }
    observations.push({edition:manifest.edition,epoch_id:epoch.epoch_id,t_start:epoch.t_start,t_end:epoch.t_end,scope,geometry_sha256:fallback.sha256,rows});
  }
  for(const descriptor of manifests){
    const manifest=await read(descriptor.manifestPath,descriptor.expected);
    for(const epoch of manifest.epochs)if(epoch.stream.source_layers.includes('territories'))await processEpoch(manifest,descriptor.manifestPath,epoch,descriptor.scope);
  }
  for(const epoch of isles.epochs)if(epoch.stream.source_layers.includes('territories'))await processEpoch(isles,islesPath,epoch,'regional');
  if(observations.length>budget.maximum_observations)throw Error('Observation budget exceeded');
  const result:ContextMetricsDocument={schema_version:1,method:'display-union-wgs84-v1',meaning:'Approximate source display footprint, not sovereign territory or independently reviewed historical area.',methodology:'Offline longitude-unwrapped polygon union removes overlapping/duplicate parts; GeographicLib 2.2.0 WGS84 geodesic exterior area minus holes. Input is the complete untiled retained display product, including its existing Mercator polar limit. Ring winding that cannot be represented unambiguously is unavailable. Rounded to whole square kilometres; source precision is much coarser. Regional rows cover only the Isles/Channel clipping window. No runtime intersections or population inference.',source:{title:'Historical Basemaps',revision:'da7a4b735ecef70aebdc9c73e409d8a2500d50f3',license:'GPL-3.0',attribution:'André Ourednik and contributors; bounded Chronicle display derivative'},observations};
  const output=JSON.stringify(result)+'\n';
  if(Buffer.byteLength(output)>budget.maximum_lookup_bytes)throw Error('Frozen output budget exceeded');
  await writeFile(resolve(root,'public/glass/map-metrics.json'),output);
  const loaderPath=resolve(root,'src/context-metrics.ts');
  const loader=await readFile(loaderPath,'utf8');
  const updated=loader.replace(/export const CONTEXT_METRICS_IDENTITY = Object.freeze\(\{sha256:'[a-f0-9]{64}',bytes:\d+\}\);/,`export const CONTEXT_METRICS_IDENTITY = Object.freeze({sha256:'${hash(output)}',bytes:${Buffer.byteLength(output)}});`);
  if(!updated.includes(`sha256:'${hash(output)}',bytes:${Buffer.byteLength(output)}`))throw Error('Could not update static loader identity');
  if(updated!==loader)await writeFile(loaderPath,updated);
  const receipt={schema_version:1,budget:'./metrics-budget.json',observations:observations.length,entries:entryCount,unavailable,output_bytes:Buffer.byteLength(output),output_sha256:hash(output),input_bytes:inputBytes,elapsed_ms:Math.round(performance.now()-start),peak_rss_bytes:Math.max(peakRss,process.resourceUsage().maxRSS*1024),inputs,public_ledger_mutations:false};
  await writeFile(resolve(root,'public/glass/metrics-receipt.json'),JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify({...receipt,inputs:inputs.length},null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await compileContextMetrics();
