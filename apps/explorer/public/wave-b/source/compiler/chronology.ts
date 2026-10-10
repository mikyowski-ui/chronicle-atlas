/** Signed astronomical Gregorian years. UI/source civil dates never have a year zero. */
export const PRECISIONS=['exact-day','month','year','decade','century','circa','bounded-range','open-range'] as const;
export type Precision=typeof PRECISIONS[number];
export interface Extent {precision:Precision;start:{earliest:number|null;latest:number|null};end:{earliest:number|null;latest:number|null};originalCalendar:string;sourceText:string;conversionNote:string;}
export function dayFromAstronomical(year:number,month=1,day=1){
 if(!Number.isInteger(year)||year < -9999||year>9999)throw new Error('Year outside supported chronology');
 const d=new Date(0);d.setUTCFullYear(year,month-1,day);d.setUTCHours(0,0,0,0);
 if(d.getUTCFullYear()!==year||d.getUTCMonth()!==month-1||d.getUTCDate()!==day)throw new Error('Invalid Gregorian day');return d.getTime()/86400000;
}
export function astronomicalYear(day:number){return new Date(Math.floor(day)*86400000).getUTCFullYear();}
export function yearLabel(year:number){return year<=0?`${1-year} BCE`:`${year} CE`;}
export function formatHistoricalDay(day:number,precision:'day'|'year'='day'){
 const d=new Date(Math.floor(day)*86400000),year=yearLabel(d.getUTCFullYear());
 return precision==='year'?year:`${d.getUTCDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()]} ${year}`;
}
export function civilInput(day:number){const d=new Date(Math.floor(day)*86400000);return `${yearLabel(d.getUTCFullYear())}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;}
export function parseCivilInput(input:string){
 const match=/^(\d{1,4})\s*(BCE|BC|CE|AD)(?:-(\d{2})-(\d{2}))?$/i.exec(input.trim());
 if(match){const y=Number(match[1]);if(!y)throw new Error('Civil chronology has no year zero');return dayFromAstronomical(/BC/i.test(match[2])?1-y:y,Number(match[3]??1),Number(match[4]??1));}
 const iso=/^(\d{4}|[+-]\d{6})-(\d{2})-(\d{2})$/.exec(input);if(iso&&Number(iso[1])!==0)return dayFromAstronomical(Number(iso[1]),Number(iso[2]),Number(iso[3]));
 throw new Error('Use 200 BCE, 1 CE, or 200 BCE-06-05; year zero is internal only');
}
export function validateExtent(e:Extent){
 if(!PRECISIONS.includes(e.precision)||!e.originalCalendar||!e.sourceText)throw new Error('Date precision, calendar and original wording are required');
 for(const side of [e.start,e.end]){for(const v of [side.earliest,side.latest])if(v!==null&&!Number.isSafeInteger(v))throw new Error('Uncertainty bounds must be integer days or open');if(side.earliest!==null&&side.latest!==null&&side.earliest>side.latest)throw new Error('Inverted endpoint uncertainty');}
 if((e.start.earliest??-Infinity)>=(e.end.latest??Infinity))throw new Error('Empty possible interval');return e;
}
export function active(e:Extent,day:number,mode:'definite'|'possible'='possible'){
 return mode==='possible'?(e.start.earliest??-Infinity)<=day&&day<(e.end.latest??Infinity):(e.start.latest??Infinity)<=day&&day<(e.end.earliest??-Infinity);
}
export function exactExtent(from:number,to:number,sourceText:string):Extent{return validateExtent({precision:'exact-day',start:{earliest:from,latest:from},end:{earliest:to,latest:to},originalCalendar:'proleptic-gregorian',sourceText,conversionNote:'Source-coded days; end exclusive.'});}
/** Evidence somewhere within a year/month/etc. Boundaries are search bounds, NOT dated events. */
export function observationExtent(from:number,to:number,precision:Precision,sourceText:string,calendar='source-unspecified'):Extent{return validateExtent({precision,start:{earliest:from,latest:to-1},end:{earliest:from+1,latest:to},originalCalendar:calendar,sourceText,conversionNote:'Possible observation window; no exact onset or cessation inferred.'});}
export function extentLabel(e:Extent){return `${e.sourceText} · ${e.precision} · ${e.originalCalendar}`;}
export const GATE_START=dayFromAstronomical(-199),GATE_END=dayFromAstronomical(2026);
