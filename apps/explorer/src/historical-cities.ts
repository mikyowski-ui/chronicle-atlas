import type { DetailCapitalPeriod, DetailPlace } from './detail-context.ts';

/** Population observations describe evidence at a date, never foundation or abandonment. */
export interface CitySource { id:string; title:string; url:string; [key:string]:unknown }
export interface CityPopulation { year:number; value:number; sourceId:string; alternativeValues?:{value:number;sourceId:string}[] }
export interface CityName { name:string; from:number; to?:number; sourceId?:string }
export interface HistoricalCity {
  id:string; name:string; lat:number; lon:number; validFrom?:number; validTo?:number;
  names:CityName[]; population:CityPopulation[]; capitalPeriods:DetailCapitalPeriod[];
  sourceIds:string[]; summary?:string; existenceNote?:string; nameStatus?:string;
  modernReferenceCoordinates?:[number,number];populationDefinition?:string;aliases?:string[];modernName?:string;
}
export interface HistoricalCities { version:1; yearNumbering:'astronomical'; sources:CitySource[]; cities:HistoricalCity[] }
export interface HistoricalCapital { id:string; cityId?:string; name:string; coordinates:[number,number]; periods:DetailCapitalPeriod[]; sourceIds:string[]; note?:string }
export interface HistoricalCapitals { version:1; yearNumbering:'astronomical'; sources:CitySource[]; capitals:HistoricalCapital[] }
export const CITY_HISTORY_LIMITS=Object.freeze({bytes:24*1024*1024,cities:20000,observations:300000,capitalBytes:1024*1024,capitals:1000});

const emptyCities=():HistoricalCities=>({version:1,yearNumbering:'astronomical',sources:[],cities:[]});
const emptyCapitals=():HistoricalCapitals=>({version:1,yearNumbering:'astronomical',sources:[],capitals:[]});
export { emptyCities,emptyCapitals };

function text(value:unknown,max=200):string {
  if(typeof value!=='string'||!value.trim()||value.length>max)throw Error('Invalid city history text');
  return value;
}
function numbering(value:any):boolean {
  if(value.version!==1||!['astronomical','historical'].includes(value.yearNumbering))throw Error('Unsupported city history version or year numbering');
  return value.yearNumbering==='historical';
}
function year(value:unknown,historical:boolean):number {
  if(!Number.isSafeInteger(value)||Number(value)<-12000||Number(value)>3000||(historical&&value===0))throw Error('Invalid city history year');
  return Number(value)+(historical&&Number(value)<0?1:0);
}
function optionalYear(value:unknown,historical:boolean):number|undefined { return value===undefined||value===null?undefined:year(value,historical); }
function sources(value:unknown):CitySource[] {
  if(!Array.isArray(value)||value.length>2000)throw Error('Invalid city history sources');
  const ids=new Set<string>();
  return value.map(source=>{
    const id=text(source.id),title=text(source.title,1000),url=text(source.url,3000);
    if(ids.has(id)||!/^https?:\/\//.test(url))throw Error('Invalid city history source');
    ids.add(id);return{...source,id,title,url};
  });
}
function sourceId(value:unknown,known:Set<string>):string { const id=text(value);if(!known.has(id))throw Error('Unknown city history source');return id; }
function periods(value:unknown,historical:boolean,known:Set<string>):DetailCapitalPeriod[] {
  if(value===undefined)return[];
  if(!Array.isArray(value)||value.length>200)throw Error('Invalid capital periods');
  return value.map(p=>{
    const from=year(p.from,historical),to=year(p.to,historical);
    if(to<from)throw Error('Inverted capital period');
    return{from,to,polityId:text(p.polityId),label:p.label===undefined?undefined:text(p.label,1000),sourceId:sourceId(p.sourceId,known),note:p.note===undefined?undefined:text(p.note,3000)};
  });
}
function coordinates(lon:unknown,lat:unknown):[number,number] {
  if(!Number.isFinite(lon)||!Number.isFinite(lat)||Math.abs(Number(lon))>180||Math.abs(Number(lat))>90)throw Error('Invalid historical city coordinates');
  return[Number(lon),Number(lat)];
}
export function parseHistoricalCities(value:any):HistoricalCities {
  const historical=numbering(value),sourceRows=sources(value.sources),known=new Set(sourceRows.map(s=>s.id));
  if(!Array.isArray(value.cities)||value.cities.length>CITY_HISTORY_LIMITS.cities)throw Error('Historical city limit exceeded');
  let observations=0;const ids=new Set<string>();
  const cities=value.cities.map((c:any):HistoricalCity=>{
    const id=text(c.id),name=text(c.name),[lon,lat]=coordinates(c.lon,c.lat);
    if(ids.has(id))throw Error('Duplicate historical city');ids.add(id);
    if(!Array.isArray(c.population)||!Array.isArray(c.sourceIds)||c.sourceIds.length>100)throw Error('Invalid historical city evidence');
    observations+=c.population.length;if(observations>CITY_HISTORY_LIMITS.observations)throw Error('City observation limit exceeded');
    const population=c.population.map((p:any)=>{
      if(!Number.isFinite(p.value)||p.value<0||p.value>300000000)throw Error('Invalid historical city population');
      if(p.alternativeValues!==undefined&&(!Array.isArray(p.alternativeValues)||p.alternativeValues.length>20))throw Error('Invalid alternative city estimates');
      const alternativeValues=p.alternativeValues?.map((alternative:any)=>{
        if(!Number.isFinite(alternative.value)||alternative.value<0||alternative.value>300000000)throw Error('Invalid alternative city population');
        return{value:alternative.value,sourceId:sourceId(alternative.sourceId,known)};
      });
      return{year:year(p.year,historical),value:p.value,sourceId:sourceId(p.sourceId,known),alternativeValues};
    }).sort((a:CityPopulation,b:CityPopulation)=>a.year-b.year);
    if(c.names!==undefined&&(!Array.isArray(c.names)||c.names.length>100))throw Error('Invalid city name periods');
    const names=(c.names??[]).map((n:any)=>{
      const from=year(n.from,historical),to=optionalYear(n.to,historical);
      if(to!==undefined&&to<from)throw Error('Inverted city name period');
      return{name:text(n.name),from,to,sourceId:n.sourceId===undefined?undefined:sourceId(n.sourceId,known)};
    }).sort((a:CityName,b:CityName)=>a.from-b.from);
    const validFrom=optionalYear(c.validFrom,historical),validTo=optionalYear(c.validTo,historical);
    if(validFrom!==undefined&&validTo!==undefined&&validTo<validFrom)throw Error('Inverted settlement extent');
    if(c.modernReferenceCoordinates!==undefined&&(!Array.isArray(c.modernReferenceCoordinates)||c.modernReferenceCoordinates.length!==2))throw Error('Invalid modern reference coordinates');
    const modernReferenceCoordinates=c.modernReferenceCoordinates===undefined?undefined:coordinates(...c.modernReferenceCoordinates as [number,number]);
    if(c.aliases!==undefined&&(!Array.isArray(c.aliases)||c.aliases.length>100))throw Error('Invalid city reference names');
    return{id,name,lon,lat,validFrom,validTo,names,population,capitalPeriods:periods(c.capitalPeriods,historical,known),sourceIds:c.sourceIds.map((id:unknown)=>sourceId(id,known)),summary:c.summary===undefined?undefined:text(c.summary,6000),existenceNote:c.existenceNote===undefined?undefined:text(c.existenceNote,6000),nameStatus:c.nameStatus===undefined?'modern-reference':text(c.nameStatus),modernReferenceCoordinates,populationDefinition:c.populationDefinition===undefined?undefined:text(c.populationDefinition,3000),aliases:(c.aliases??[]).map((a:unknown)=>text(a)),modernName:c.modernName===undefined?undefined:text(c.modernName)};
  });
  return{version:1,yearNumbering:'astronomical',sources:sourceRows,cities};
}
export function parseHistoricalCapitals(value:any):HistoricalCapitals {
  const historical=numbering(value),sourceRows=sources(value.sources),known=new Set(sourceRows.map(s=>s.id));
  if(!Array.isArray(value.capitals)||value.capitals.length>CITY_HISTORY_LIMITS.capitals)throw Error('Historical capital limit exceeded');
  const ids=new Set<string>();
  return{version:1,yearNumbering:'astronomical',sources:sourceRows,capitals:value.capitals.map((c:any):HistoricalCapital=>{
    const id=text(c.id);if(ids.has(id))throw Error('Duplicate capital location');ids.add(id);
    if(!Array.isArray(c.coordinates)||c.coordinates.length!==2)throw Error('Invalid capital coordinates');
    return{id,cityId:c.cityId===undefined?undefined:text(c.cityId),name:text(c.name),coordinates:coordinates(...c.coordinates as [number,number]),periods:periods(c.periods,historical,known),sourceIds:(c.sourceIds??[]).map((id:unknown)=>sourceId(id,known)),note:c.note===undefined?undefined:text(c.note,6000)};
  })};
}

export function cityEstimateAgeLimit(year:number):number { return year<=500?150:year<=1700?75:30; }
function canonicalName(value:string):string { return value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,''); }
function matchingCity(capital:HistoricalCapital,cities:readonly HistoricalCity[]):HistoricalCity|undefined {
  if(capital.cityId){const exact=cities.find(c=>c.id===capital.cityId);if(exact)return exact;}
  const name=canonicalName(capital.name);
  return cities.find(c=>Math.abs(c.lat-capital.coordinates[1])<.3&&Math.abs(c.lon-capital.coordinates[0])<.3&&[c.name,...(c.aliases??[]),...c.names.map(n=>n.name)].some(n=>canonicalName(n)===name));
}
/** Assemble stable capital joins once after loading; all dates are astronomical inclusive years. */
export function combineCityHistory(product:HistoricalCities,capitalProduct:HistoricalCapitals):HistoricalCities {
  const cities=product.cities.map(c=>({...c,capitalPeriods:[...c.capitalPeriods]}));
  for(const capital of capitalProduct.capitals){
    const city=matchingCity(capital,cities);
    if(city){city.capitalPeriods.push(...capital.periods.map(p=>({...p,cityName:capital.name})));continue;}
    cities.push({id:capital.id,name:capital.name,lon:capital.coordinates[0],lat:capital.coordinates[1],names:capital.periods.map(p=>({name:capital.name,from:p.from,to:p.to,sourceId:p.sourceId})),population:[],capitalPeriods:[...capital.periods],sourceIds:capital.sourceIds.length?capital.sourceIds:[...new Set(capital.periods.map(p=>p.sourceId))],existenceNote:capital.note,nameStatus:'period-name'});
  }
  const allSources=new Map([...product.sources,...capitalProduct.sources].map(s=>[s.id,s]));
  return{version:1,yearNumbering:'astronomical',sources:[...allSources.values()],cities};
}

function lastMatch<T>(rows:readonly T[],match:(row:T)=>boolean):T|undefined { for(let i=rows.length-1;i>=0;i--)if(match(rows[i]))return rows[i];return; }
function projectCity(city:HistoricalCity,year:number,sourceRows:Map<string,CitySource>,retained=false):DetailPlace|undefined {
  const population=lastMatch(city.population,p=>p.year<=year);
  const capital=city.capitalPeriods.filter(p=>p.from<=year&&year<=p.to);
  const firstObservationYear=city.population[0]?.year,lastObservationYear=city.population.at(-1)?.year;
  const start=city.validFrom??Math.min(firstObservationYear??Infinity,...city.capitalPeriods.map(p=>p.from));
  const explicitActive=city.validFrom!==undefined&&city.validFrom<=year&&(city.validTo===undefined||year<=city.validTo);
  const active=year>=start&&(city.validTo===undefined||year<=city.validTo)&&(!!population||capital.length>0||explicitActive);
  if(!active&&!retained)return;
  const name=lastMatch(city.names,n=>n.from<=year&&(n.to===undefined||year<=n.to));
  const estimateAge=population?year-population.year:undefined;
  const stale=estimateAge===undefined||estimateAge>cityEstimateAgeLimit(year);
  const temporalStatus:DetailPlace['temporalStatus']=!active?'outside-evidence':capital.length||explicitActive?'documented':stale?'location-reference':'dated-estimate';
  const evidenceId=population?.sourceId??capital[0]?.sourceId??city.sourceIds[0],source=sourceRows.get(evidenceId);
  const modernPosition=population?.sourceId==='un-wup-2025'?city.modernReferenceCoordinates:undefined;
  const modernName=population?.sourceId==='un-wup-2025'&&year>=2025?city.modernName:undefined;
  return{
    id:city.id,title:name?.name??(active?capital[0]?.cityName:undefined)??modernName??city.name,coordinates:modernPosition??[city.lon,city.lat],sourceId:evidenceId??'',sourceUrl:source?.url??'',placeTypes:['historical-city'],
    validFromYear:city.validFrom??null,validToYear:city.validTo??null,rank:100,minZoom:capital.length?0:stale?3.8:2.5,temporalMode:'historical-city',
    description:city.summary,firstObservationYear,lastObservationYear,temporalStatus,
    populationEstimate:population?{...population,ageYears:estimateAge!,stale,sourceUrl:sourceRows.get(population.sourceId)?.url}:undefined,
    capital:active?capital.map(c=>({...c,sourceUrl:sourceRows.get(c.sourceId)?.url})):[],
    nameNote:name||city.nameStatus==='period-name'||(active&&capital[0]?.cityName)?'Dated historical name.':modernName?'UN 2025 urban-centre reference name.':'Dataset identification name; the name used at this date has not been verified.',
    referenceNames:[city.name,...(city.aliases??[]),...city.names.map(n=>n.name),...(city.modernName?[city.modernName]:[])],
    populationDefinition:city.populationDefinition??(typeof source?.definition==='string'?source.definition:undefined),
    locationNote:modernPosition?'UN urban-centre reference point for this population estimate; not a historical city boundary.':'Gazetteer reference point; not a reconstruction of the inhabited city footprint.',
    existenceNote:city.existenceNote??'Population records attest this location at particular dates. The first and last estimates are not founding or abandonment dates; continued occupation between or after them is not established by this dataset.',
  };
}
/** Only already-observed estimates influence labels. An old peak never stays a world-level city forever. */
export function historicalPlaces(product:HistoricalCities,year:number):DetailPlace[] {
  const sourceRows=new Map(product.sources.map(s=>[s.id,s]));
  const places=product.cities.map(c=>projectCity(c,year,sourceRows)).filter((p):p is DetailPlace=>!!p);
  const largest=places.filter(p=>p.populationEstimate&&!p.populationEstimate.stale).sort((a,b)=>b.populationEstimate!.value-a.populationEstimate!.value||a.id.localeCompare(b.id));
  largest.forEach((place,index)=>{
    place.populationRank=index+1;
    place.rank=index<12?index/12:index<32?1+(index-12)/20:2+(index-32)/150;
    place.minZoom=index<12?-2:index<32?.8:index<80?1.7:index<200?2.6:3.3;
  });
  for(const place of places){if(place.capital?.length){place.rank=Math.min(place.rank,1.3);place.minZoom=Math.min(place.minZoom!,0);}}
  return places;
}
export function retainedHistoricalPlace(product:HistoricalCities,id:string,year:number):DetailPlace|undefined {
  const city=product.cities.find(c=>c.id===id);return city?projectCity(city,year,new Map(product.sources.map(s=>[s.id,s])),true):undefined;
}

/** The curated population city wins over a nearby same-name gazetteer point. */
export function mergeHistoricalPlaces(historical:readonly DetailPlace[],gazetteer:readonly DetailPlace[]):DetailPlace[] {
  const byName=new Map<string,DetailPlace[]>();
  for(const place of historical){for(const name of new Set([place.title,...(place.referenceNames??[])])){const key=canonicalName(name);byName.set(key,[...(byName.get(key)??[]),place]);}}
  return[...historical,...gazetteer.filter(place=>!(byName.get(canonicalName(place.title))??[]).some(city=>Math.abs(city.coordinates[0]-place.coordinates[0])<.3&&Math.abs(city.coordinates[1]-place.coordinates[1])<.3))];
}
