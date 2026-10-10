import { TEACHING_CATEGORIES, TEACHING_FEATURES, TEACHING_SOURCES, PRIMARY_ACCOUNTS, nearbyAccounts, accountDistanceInYears, accountCompositionDistanceInYears, distanceKm, safeTeachingURL, teachingSource, type TeachingCategory, type TeachingFeature, type PrimaryAccount, type TeachingSource } from './teaching-data.ts';
import { STATE_HISTORIES, formatHistoryYear, type StateHistory } from './state-histories.ts';

export interface StudyStateObservation {year:number; entityId:string; scope:string; sourceUrl?:string; historyId?:string|null; chronologyReview?:{allowed:boolean; note?:string}}
export interface StudyState {id:string; title:string; kind:string; summary:string; observations:StudyStateObservation[]; histories:StateHistory[]; sources:TeachingSource[]}
export interface StudyContext {year:number; observationYear:number|null; coordinates?:readonly number[]|null; placeName?:string; entityId?:string; name?:string}
/** A repeated atlas name does not transfer an ancient biography to a modern namesake. */
export function studyHistoriesAtObservation(entry:StudyState,year:number|null,allDates=false):StateHistory[]{
  if(allDates)return entry.histories;
  const ids=new Set(entry.observations.filter(o=>o.year===year&&o.chronologyReview?.allowed!==false).map(o=>o.historyId).filter(Boolean));
  return entry.histories.filter(h=>ids.has(h.id));
}
interface Callbacks {
  onFeature:(feature:TeachingFeature)=>void;
  onAccount:(account:PrimaryAccount)=>void;
  onObservation:(entry:StudyState,observation:StudyStateObservation)=>void;
}
type Tab='states'|'accounts'|'connections'|'sources';
const make=<K extends keyof HTMLElementTagNameMap>(tag:K,text='',className=''):HTMLElementTagNameMap[K]=>{const n=document.createElement(tag);n.textContent=text;n.className=className;return n;};
const years=(from:number,to:number)=>from===to?formatHistoryYear(from):`${formatHistoryYear(from)} – ${formatHistoryYear(to)}`;
function sourceLink(source:Pick<TeachingSource,'title'|'url'|'publisher'>):HTMLAnchorElement {
  const a=make('a',`${source.title} ↗`);a.href=safeTeachingURL(source.url);a.target='_blank';a.rel='noopener noreferrer';a.title=source.publisher;return a;
}
function evidence(parent:HTMLElement,ids:readonly string[]){
  const list=make('div','','study-source-links');
  for(const id of ids){const s=teachingSource(id);if(s)list.append(sourceLink(s));}parent.append(list);
}
/** All excerpts are text nodes. External sources are HTTPS-only and never embedded. */
export class TeachingStudies {
  private tab:Tab='states';private query='';private allDates=false;private limit=20;private key='';
  private context:StudyContext={year:1415,observationYear:1400};
  private heading=make('p','','study-date-context');private list=make('div','','study-results');private count=make('p','','study-result-count');
  private tabs=make('nav','','study-tabs');private search=make('input');private filter=make('label','','study-date-filter');private filterBox=make('input');private filterText=make('span');
  private stats=make('p','','study-library-stats');
  constructor(private host:HTMLElement,private states:StudyState[],private callbacks:Callbacks){
    this.host.classList.add('teaching-studies');
    const h=make('div','','study-library-heading');h.append(make('span','THE STUDY ROOM','eyebrow'),make('h2','People, places & power'),make('p','Read the evidence behind the map. Follow a state through time, listen to contemporary accounts, or explore the networks between places.'));
    this.stats.textContent=`${states.length.toLocaleString()} atlas entries · ${STATE_HISTORIES.length} researched histories · ${PRIMARY_ACCOUNTS.length} primary accounts`;
    this.tabs.setAttribute('aria-label','Study collections');
    for(const [id,label] of [['states','States'],['accounts','Accounts'],['connections','Connections'],['sources','Sources']] as const){const b=make('button',label);b.type='button';b.dataset.tab=id;b.addEventListener('click',()=>this.openTab(id));this.tabs.append(b);}
    this.search.type='search';this.search.placeholder='Search this collection';this.search.setAttribute('aria-label','Search studies');this.search.addEventListener('input',()=>{this.query=this.search.value;this.limit=20;this.renderResults();});
    this.filterBox.type='checkbox';this.filterBox.checked=true;this.filterBox.addEventListener('change',()=>{this.allDates=!this.filterBox.checked;this.limit=20;this.renderResults();});this.filter.append(this.filterBox,this.filterText);
    const controls=make('div','','study-search-controls');controls.append(this.search,this.filter);
    this.host.append(h,this.stats,this.heading,this.tabs,controls,this.count,this.list);this.render();
  }
  update(context:StudyContext){const key=JSON.stringify(context);this.context=context;if(key===this.key)return;this.key=key;this.render();}
  openTab(tab:Tab){this.tab=tab;this.query='';this.search.value='';this.allDates=false;this.filterBox.checked=true;this.limit=20;this.render();this.host.parentElement?.scrollTo({top:0});}
  private render(){
    this.heading.textContent=`Browsing ${formatHistoryYear(this.context.year)}${this.context.placeName?' · '+this.context.placeName:''}`;
    for(const b of this.tabs.querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.tab===this.tab));
    this.filter.hidden=this.tab==='sources';
    this.filterText.textContent=this.tab==='states'?`At map observation ${this.context.observationYear===null?'(none)':formatHistoryYear(this.context.observationYear)}`:this.tab==='accounts'?'Events & writing within 35 years':'Within the study window';
    this.renderResults();
  }
  private matches(...parts:(string|undefined)[]){const q=this.query.trim().toLocaleLowerCase();return !q||parts.some(p=>p?.toLocaleLowerCase().includes(q));}
  private renderResults(){
    this.list.replaceChildren();let total=0;
    if(this.tab==='states'){
      const entries=this.states.filter(s=>this.matches(s.title,s.summary,...s.histories.map(h=>h.title))&&(this.allDates||s.observations.some(o=>o.year===this.context.observationYear&&o.chronologyReview?.allowed!==false))).sort((a,b)=>Number(b.observations.some(o=>o.entityId===this.context.entityId))-Number(a.observations.some(o=>o.entityId===this.context.entityId))||a.title.localeCompare(b.title));
      total=entries.length;for(const entry of entries.slice(0,this.limit))this.list.append(this.stateCard(entry));
      if(!total)this.list.append(make('p','No entries match this observation and search. Clear the date filter to browse the full atlas catalog.','study-empty'));
      this.count.textContent=`${total.toLocaleString()} ${total===1?'entry':'entries'} · a map observation is not a founding or ending date`;
    }else if(this.tab==='accounts'){
      const entries=nearbyAccounts(this.context.year,this.context.coordinates,this.allDates).filter(a=>this.matches(a.title,a.author,a.place,a.summary));total=entries.length;
      if(this.context.coordinates)this.list.append(make('p','Ordered by distance from the selected place; nearby accounts may describe another city.','study-helper'));
      for(const account of entries.slice(0,this.limit))this.list.append(this.accountCard(account));
      if(!total)this.list.append(make('p','No collected accounts match this generation and search. Clear the date filter to browse other periods. An empty result is a gap in this collection, not an absence of historical records.','study-empty'));
      this.count.textContent=`${total} accounts · witnessed dates and writing dates are shown separately`;
    }else if(this.tab==='connections'){
      const entries=TEACHING_FEATURES.filter(f=>this.matches(f.title,f.summary,TEACHING_CATEGORIES[f.category].title)&&(this.allDates||f.fromYear<=this.context.year&&this.context.year<=f.toYear));total=entries.length;
      for(const f of entries.slice(0,this.limit))this.list.append(this.featureCard(f));
      if(!total)this.list.append(make('p','No collected networks match this period and search. Browse all dates to see the collection.','study-empty'));
      this.count.textContent=`${total} connections & contexts · study windows are not exact opening or ending dates`;
    }else{
      const combined:TeachingSource[]=[...TEACHING_SOURCES,...STATE_HISTORIES.flatMap(h=>h.sources.map(s=>({...s,kind:'State history',notes:h.title}))),...this.states.flatMap(s=>s.sources)];
      const sources=[...new Map(combined.map(s=>[s.url,s])).values()].filter(s=>this.matches(s.title,s.publisher,s.kind,s.notes)).sort((a,b)=>a.publisher.localeCompare(b.publisher));total=sources.length;
      for(const source of sources.slice(0,this.limit)){const card=make('article','','study-record');card.append(make('span',source.kind,'study-tag'),make('h3',source.publisher),sourceLink(source));if(source.notes)card.append(make('p',source.notes));this.list.append(card);}
      this.count.textContent=`${total} distinct source links · institutional records, scholarship & primary texts`;
    }
    if(total>this.limit){const more=make('button',`Show ${Math.min(20,total-this.limit)} more`,'study-more');more.addEventListener('click',()=>{this.limit+=20;this.renderResults();});this.list.append(more);}
  }
  private stateCard(entry:StudyState){
    const histories=studyHistoriesAtObservation(entry,this.context.observationYear,this.allDates);
    const card=make('details','','study-record');if(this.context.entityId&&entry.observations.some(o=>o.entityId===this.context.entityId))card.open=true;
    const summary=make('summary');summary.append(make('span',histories.length?(this.allDates?'Researched periods':'Researched history'):'Atlas description','study-tag'),make('strong',entry.title),make('small',entry.kind.replaceAll('-',' ')));card.append(summary,make('p',entry.summary));
    if(!histories.length)card.append(make('p','This entry describes what the atlas source represents. A separately researched life history for this dated identity has not yet been added.','study-evidence-note'));
    if(this.allDates&&histories.length)card.append(make('p','The researched periods below apply only to their dated identities. A shared atlas label does not establish one continuous state.','study-evidence-note'));
    for(const h of histories){const section=make('section','','study-history');section.append(make('h3',h.title),make('small',h.periodLabel),make('p',h.summary),make('p',h.continuity,'study-evidence-note'));
      if(this.context.year<h.fromYear||this.context.year>h.toYear)section.append(make('p','This researched period lies outside the browsing year. It is listed for the dated reference observation or the all-dates view.','study-evidence-note'));
      if(h.transitions.length){const list=make('ol','','study-lifecycle');for(const t of h.transitions){const item=make('li');item.append(make('strong',t.dateLabel+' · '+t.title),make('p',t.summary));list.append(item);}section.append(list);}
      const links=make('div','','study-source-links');h.sources.forEach(s=>links.append(sourceLink(s)));section.append(links);card.append(section);}
    const dates=make('div','','study-observations');dates.append(make('span','Map observations','study-subheading'));
    for(const o of entry.observations){const suppressed=o.chronologyReview?.allowed===false;const b=make('button',formatHistoryYear(o.year)+(suppressed?' †':''));b.title=suppressed?'Excluded source claim: '+o.chronologyReview?.note:o.scope+' source observation';if(suppressed)b.className='study-excluded';b.addEventListener('click',()=>this.callbacks.onObservation(entry,o));dates.append(b);}if(entry.observations.some(o=>o.chronologyReview?.allowed===false))dates.append(make('small','† A retained source claim excluded from the map by a documented chronology check. Selecting its date does not restore that claim.'));card.append(dates);
    const links=make('div','','study-source-links');for(const s of entry.sources)links.append(sourceLink(s));card.append(links);return card;
  }
  private accountCard(a:PrimaryAccount){
    const card=make('details','','study-record');const summary=make('summary');summary.append(make('span','PRIMARY ACCOUNT','study-tag'),make('strong',a.title),make('small',`${a.place} · ${years(a.eventFromYear,a.eventToYear)}`));card.append(summary,make('p',a.author,'study-author'));
    const dt=make('dl','','study-account-dates');for(const [label,value] of [['Described events',years(a.eventFromYear,a.eventToYear)],['Composed / compiled',years(a.writtenFromYear,a.writtenToYear)]]){const row=make('div');row.append(make('dt',label),make('dd',value));dt.append(row);}card.append(dt,make('p',a.summary));
    if(a.excerpt){card.append(make('span',a.excerptKind==='quotation'?'SHORT EXCERPT':'ACCOUNT IN BRIEF · PARAPHRASE','study-subheading'),make(a.excerptKind==='quotation'?'blockquote':'p',a.excerpt));}
    card.append(make('h4','Whose view is this?'),make('p',a.perspective),make('h4','What can it establish?'),make('p',a.limitations,'study-evidence-note'));
    const distance=accountDistanceInYears(a,this.context.year),compositionDistance=accountCompositionDistanceInYears(a,this.context.year);if(distance>35||compositionDistance>35)card.append(make('p',`Outside this generation: described events are ${distance.toLocaleString()} years from the browsing date; composition is ${compositionDistance.toLocaleString()} years away. A later retrospective account is not contemporary testimony for the earlier date.`,'study-evidence-note'));
    if(this.context.coordinates)card.append(make('small',`${Math.round(distanceKm(a.coordinates,this.context.coordinates)).toLocaleString()} km from the selected place · straight-line distance`));
    evidence(card,a.sourceIds);const b=make('button','Visit place & date','study-visit');b.addEventListener('click',()=>this.callbacks.onAccount(a));card.append(b);return card;
  }
  private featureCard(f:TeachingFeature){
    const card=make('details','','study-record');const summary=make('summary');summary.append(make('span',TEACHING_CATEGORIES[f.category].title,'study-tag'),make('strong',f.title),make('small',years(f.fromYear,f.toYear)));card.append(summary,make('p',f.summary));
    if(f.relationship)card.append(make('p','Relationship: '+f.relationship,'study-subheading'));
    card.append(make('p','Display window: '+years(f.fromYear,f.toYear)+'. These editorial bounds select a useful period of evidence; they do not establish an exact beginning or end.','study-helper'),make('h4','How to read this layer'),make('p',f.limitations,'study-evidence-note'));evidence(card,f.sourceIds);const b=make('button','Show on map','study-visit');b.addEventListener('click',()=>this.callbacks.onFeature(f));card.append(b);return card;
  }
}
