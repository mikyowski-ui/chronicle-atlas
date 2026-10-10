import type { FeatureCollection } from 'geojson';

export interface DetailCamera { x:number; y:number; scale:number }
export interface DetailCapitalPeriod { from:number; to:number; polityId:string; label?:string; sourceId:string; note?:string; sourceUrl?:string; cityName?:string }
export interface DetailPlace {
  id:string; title:string; coordinates:[number,number]; sourceId:string; sourceUrl:string;
  locationUrl?:string; placeTypes?:string[]; validFromYear:number|null; validToYear:number|null;
  sourceStartYear?:number; sourceEndYear?:number; accuracyMeters?:number|null; rank:number; minZoom?:number; description?:string;
  temporalMode:'source-envelope'|'modern-context'|'historical-city';
  firstObservationYear?:number; lastObservationYear?:number; populationRank?:number;
  populationEstimate?:{value:number;year:number;ageYears:number;sourceId:string;sourceUrl?:string;stale:boolean;alternativeValues?:{value:number;sourceId:string}[]};
  capital?:DetailCapitalPeriod[]; nameNote?:string; existenceNote?:string; populationDefinition?:string; locationNote?:string; referenceNames?:string[];
  temporalStatus?:'documented'|'dated-estimate'|'location-reference'|'outside-evidence';
}
export interface TerrainDescriptor { tiles:string; minzoom:number; maxzoom:number; tileSize:number; [key:string]:unknown }
export interface PopulationGrid { year:number; grid:{width:number;height:number;west:number;north:number;cellDegrees:number}; counts:(number|null)[]; densities:(number|null)[]; [key:string]:unknown }
export interface DetailOptions { terrain:boolean; water:boolean; cities:boolean; density:boolean; modernCities:boolean }
export interface DetailFrame {
  terrain:TerrainDescriptor|null; hydro:FeatureCollection|null; places:readonly DetailPlace[]; selectedPlace?:DetailPlace|null;
  population:PopulationGrid|null; options:DetailOptions; requestedYear:number; populationLabel:string;
}
export const DETAIL_LIMITS=Object.freeze({rasterTiles:48,rasterRequests:4,cityLabels:80,populationCells:20000,jsonBytes:16*1024*1024});
export function activePlaces(places:readonly DetailPlace[],year:number,modern=false):DetailPlace[] {
  return places.filter(p=>p.temporalMode==='modern-context'?modern:p.temporalMode==='historical-city'?p.temporalStatus!=='outside-evidence':p.validFromYear!==null&&p.validToYear!==null&&p.validFromYear<=year&&year<=p.validToYear);
}
export function precedingPopulation<T extends {year:number}>(rows:readonly T[],year:number):T|undefined { return rows.filter(r=>r.year<=year).sort((a,b)=>b.year-a.year)[0]; }
export function densityColor(value:number|null):string {
  if(value===null||value<=0)return 'rgba(0,0,0,0)';
  // Fixed logarithmic scale shared by every observation: people / full grid-cell km².
  const t=Math.min(1,Math.log1p(value)/Math.log(1001));
  const stops=[[239,217,132],[233,139,55],[186,53,46],[113,30,75]];
  const s=t*3,i=Math.min(2,Math.floor(s)),f=s-i;
  const c=stops[i].map((v,k)=>Math.round(v+(stops[i+1][k]-v)*f));
  return `rgba(${c.join(',')},${(.18+t*.65).toFixed(3)})`;
}
export async function boundedJSON(url:string,max=DETAIL_LIMITS.jsonBytes,signal?:AbortSignal,compression?:string):Promise<any> {
  const r=await fetch(url,{signal});if(!r.ok||!r.body)throw Error(`Detail asset unavailable: ${new URL(url,location.href).pathname}`);
  let stream:ReadableStream<Uint8Array>=r.body;
  if(compression==='gzip')stream=stream.pipeThrough(new DecompressionStream('gzip') as unknown as TransformStream<Uint8Array,Uint8Array>);
  const reader=stream.getReader(),chunks:Uint8Array[]=[];let total=0;
  try{while(true){const x=await reader.read();if(x.done)break;total+=x.value.length;if(total>max)throw Error('Detail asset exceeds bounded input');chunks.push(x.value);}}catch(error){await reader.cancel();throw error;}
  const out=new Uint8Array(total);let offset=0;for(const c of chunks){out.set(c,offset);offset+=c.length;}
  return JSON.parse(new TextDecoder().decode(out));
}
export function nearestDetailPlace(places:readonly DetailPlace[],coordinates:readonly number[],scale:number):DetailPlace|undefined {
  const p=projectDetail(coordinates);let best:DetailPlace|undefined,bestDistance=11;
  for(const place of places){if(place.minZoom!==undefined&&Math.log2(scale/512)<place.minZoom)continue;const q=projectDetail(place.coordinates);let dx=q[0]-p[0];dx-=Math.round(dx);const distance=Math.hypot(dx,q[1]-p[1])*scale;if(distance<bestDistance){best=place;bestDistance=distance;}}
  return best;
}
export function projectDetail(p:readonly number[]):[number,number] { const lat=Math.max(-85.05112878,Math.min(85.05112878,p[1]))*Math.PI/180;return[(p[0]+180)/360,(1-Math.log(Math.tan(Math.PI/4+lat/2))/Math.PI)/2]; }
