import type { LineString, Point, Polygon } from 'geojson';
import exchange from '../public/history/exchange-networks.json';
import foundations from '../public/history/historical-foundations.json';
import accounts from '../public/history/primary-accounts.json';

export type TeachingCategory = 'trade' | 'diffusion' | 'power' | 'ecology' | 'belief' | 'language';
export interface TeachingSource { id: string; title: string; publisher: string; url: string; kind: string; notes?: string }
export interface TeachingFeature {
  id: string; title: string; category: TeachingCategory; fromYear: number; toYear: number;
  summary: string; limitations: string; geometry: LineString | Point | Polygon;
  sourceIds: string[]; certainty: string; directional?: boolean; relationship?: 'core' | 'tributary' | 'influence' | 'autonomous';
  polityNames?: string[]; places?: string[]; datePrecision?: string;
}
export interface PrimaryAccount {
  id: string; title: string; author: string; place: string; coordinates: [number, number];
  eventFromYear: number; eventToYear: number; writtenFromYear: number; writtenToYear: number;
  summary: string; excerpt?: string; excerptKind: 'quotation' | 'paraphrase';
  sourceIds: string[]; perspective: string; limitations: string;
}
export const TEACHING_CATEGORIES: Record<TeachingCategory, {title: string; note: string; color: string}> = {
  trade: {title:'Trade networks', note:'Overland & maritime corridors', color:'#087b83'},
  diffusion: {title:'Ideas, crops & disease', note:'Dated evidence of movement', color:'#ad5c36'},
  power: {title:'Power & relationships', note:'Core, tribute, influence & autonomy', color:'#8056a0'},
  ecology: {title:'Ecological foundations', note:'Broad steppe, desert & monsoon zones', color:'#71844a'},
  belief: {title:'Religious life', note:'Sites & networks of evidence', color:'#a07925'},
  language: {title:'Languages & writing', note:'Dated texts and language contact', color:'#4365a0'},
};
export const TEACHING_SOURCES = [...exchange.sources, ...foundations.sources, ...accounts.sources] as TeachingSource[];
export const TEACHING_FEATURES = [...exchange.features, ...foundations.features] as TeachingFeature[];
export const PRIMARY_ACCOUNTS = accounts.accounts as PrimaryAccount[];
export function teachingFeaturesAtYear(year:number, categories:ReadonlySet<TeachingCategory>):TeachingFeature[] {
  return TEACHING_FEATURES.filter(f=>categories.has(f.category) && f.fromYear<=year && year<=f.toYear);
}
/** Years are historical BCE/CE: cross the missing year zero correctly. */
const serialYear = (year:number) => year < 0 ? year + 1 : year;
function intervalDistance(fromYear:number,toYear:number,year:number):number {
  const y=serialYear(year),from=serialYear(fromYear),to=serialYear(toYear);
  return y<from?from-y:y>to?y-to:0;
}
export function accountDistanceInYears(account:PrimaryAccount,year:number):number {
  return intervalDistance(account.eventFromYear,account.eventToYear,year);
}
export function accountCompositionDistanceInYears(account:PrimaryAccount,year:number):number {
  return intervalDistance(account.writtenFromYear,account.writtenToYear,year);
}
export function distanceKm(a:readonly number[],b:readonly number[]):number {
  const rad=Math.PI/180,lat=(b[1]-a[1])*rad,lon=(b[0]-a[0])*rad;
  const h=Math.sin(lat/2)**2+Math.cos(a[1]*rad)*Math.cos(b[1]*rad)*Math.sin(lon/2)**2;
  return 12742*Math.asin(Math.min(1,Math.sqrt(h)));
}
export function nearbyAccounts(year:number,coordinates?:readonly number[]|null,allDates=false):PrimaryAccount[] {
  return PRIMARY_ACCOUNTS.filter(a=>allDates||(accountDistanceInYears(a,year)<=35&&accountCompositionDistanceInYears(a,year)<=35)).sort((a,b)=>
    coordinates?distanceKm(a.coordinates,coordinates)-distanceKm(b.coordinates,coordinates):accountDistanceInYears(a,year)-accountDistanceInYears(b,year));
}
export function teachingSource(id:string):TeachingSource|undefined{return TEACHING_SOURCES.find(s=>s.id===id);}
export function safeTeachingURL(value:string):string {
  const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password)throw new Error('Teaching sources require public HTTPS URLs');return url.href;
}
/** Authoring gate: no unbounded geometry, orphan evidence, inverted dates or invented year zero. */
export function validateTeachingData(sources:readonly TeachingSource[],features:readonly TeachingFeature[],records:readonly PrimaryAccount[]):void {
  const ids=new Set<string>();
  for(const s of sources){if(!s.id||ids.has(s.id)||!s.title||!s.publisher)throw new Error('Invalid or duplicate teaching source');ids.add(s.id);safeTeachingURL(s.url);}
  const checkYears=(from:number,to:number)=>{if(!Number.isInteger(from)||!Number.isInteger(to)||!from||!to||from>to||from < -10000||to>2026)throw new Error('Invalid historical interval');};
  const evidence=(record:{id:string;sourceIds:string[]})=>{if(!record.sourceIds.length||record.sourceIds.some(id=>!ids.has(id)))throw new Error('Missing evidence for '+record.id);};
  const featureIds=new Set<string>();
  for(const f of features){
    if(!f.id||featureIds.has(f.id)||!TEACHING_CATEGORIES[f.category]||!f.summary||!f.limitations||!f.certainty)throw new Error('Invalid teaching feature');featureIds.add(f.id);checkYears(f.fromYear,f.toYear);evidence(f);
    const points=f.geometry.type==='Point'?[f.geometry.coordinates]:f.geometry.type==='LineString'?f.geometry.coordinates:f.geometry.type==='Polygon'?f.geometry.coordinates.flat():[];
    if(!points.length||points.length>1024||points.some(p=>p.length!==2||!p.every(Number.isFinite)||Math.abs(p[0])>180||Math.abs(p[1])>90))throw new Error('Invalid teaching geometry');
    if(f.geometry.type==='LineString'&&points.length<2)throw new Error('A corridor requires two points');
    if(f.geometry.type==='Polygon'&&f.geometry.coordinates.some(r=>r.length<4||r[0][0]!==r.at(-1)![0]||r[0][1]!==r.at(-1)![1]))throw new Error('An ecological zone requires closed rings');
  }
  const accountIds=new Set<string>();
  for(const a of records){if(!a.id||accountIds.has(a.id)||!a.author||!a.summary||!a.perspective||!a.limitations)throw new Error('Invalid primary account');accountIds.add(a.id);checkYears(a.eventFromYear,a.eventToYear);checkYears(a.writtenFromYear,a.writtenToYear);evidence(a);if(a.coordinates.length!==2||!a.coordinates.every(Number.isFinite)||Math.abs(a.coordinates[0])>180||Math.abs(a.coordinates[1])>90)throw new Error('Invalid account location');}
}
