import {
  SEMANTIC_LIMITS, boundedSemanticInput, type DashboardSpecification, type QueryIntent, type ResolvedDataBundle,
  type SemanticEntity, type SemanticObservation, type TemporalSupport,
} from '../../research-semantic/contracts.ts';
import {
  compileIntent, createCatalogue, registerFixture, registerModernPilot,
  validateSpecification, type RegisteredFixture,
} from '../../research-semantic/catalogue.ts';
import { beginRevision, refineRevision, restoreRevision, revisionIntent, RevisionArchiveSchema, type LocalRevision } from '../../research-semantic/revisions.ts';
import './semantic-view.css';

type PilotKey='modern'|'premodern';
const PREMODERN_HASH='8f2bf0e7672dac8fb7136fd5fe81147884c3faa31d441247ab823e01367d14d0';
const number=new Intl.NumberFormat('en-US');
const yearLabel=(year:number):string=>year<=0?`${1-year} BCE`:`${year} CE`;
const periodLabel=(time:TemporalSupport):string=>time.startYear===time.endYear?yearLabel(time.startYear):`${yearLabel(time.startYear)}–${yearLabel(time.endYear)}`;
function element<K extends keyof HTMLElementTagNameMap>(tag:K,text='',className?:string):HTMLElementTagNameMap[K]{
  const node=document.createElement(tag);node.textContent=text;if(className)node.className=className;return node;
}
function field(list:HTMLDListElement,label:string,value:string):void{
  const row=element('div');row.append(element('dt',label),element('dd',value));list.append(row);
}
function recordView(observation:SemanticObservation,entity:SemanticEntity,bundle:ResolvedDataBundle):HTMLDetailsElement{
  const details=element('details','','semantic-record');details.dataset.semanticObservationId=observation.id;
  const summary=element('summary');summary.append(element('strong',entity.label),element('span',periodLabel(observation.time)));
  if(typeof observation.value==='number')summary.append(element('span',`${number.format(observation.value)} persons`,'semantic-value'));
  else summary.append(element('span',observation.value===null?'Not recorded':'Account description','semantic-value'));
  details.append(summary);
  const evidence=element('div','','semantic-record-evidence');
  const scalar=observation.value===null?'Not recorded':typeof observation.value==='number'?`${number.format(observation.value)} persons`:observation.value;
  evidence.append(element('p',scalar,'semantic-statement'),element('p',observation.supportNote,'semantic-note'));
  const definitions=element('dl');
  field(definitions,'Evidence class',observation.epistemicStatus==='attested'?'Attested account description — historical reliability is not certified':observation.epistemicStatus==='modeled'?'Modeled / published estimate — cell-specific method not supplied':'Interpolated — inspect the declared method and inputs');
  field(definitions,'Event / observation',`${periodLabel(observation.time)}. ${observation.time.meaning}`);
  field(definitions,'Composition',observation.compositionTime?`${periodLabel(observation.compositionTime)}. ${observation.compositionTime.meaning}`:'Not supplied separately; see the dataset edition.');
  field(definitions,'Confidence',observation.confidence.kind==='not-supplied'?`Not supplied. ${observation.confidence.note}`:observation.confidence.kind==='qualitative'?`${observation.confidence.label}. ${observation.confidence.note}`:`Source interval ${number.format(observation.confidence.lower)}–${number.format(observation.confidence.upper)}; level ${observation.confidence.level===null?'not supplied':String(observation.confidence.level)}. ${observation.confidence.note}`);
  field(definitions,'Location support',`${entity.spatialSupport.definition} ${entity.spatialSupport.uncertaintyKm===null?'Positional uncertainty radius not supplied.':`Source positional uncertainty: ${number.format(entity.spatialSupport.uncertaintyKm)} km.`}`);
  field(definitions,'Review',observation.reviewStatus);
  if(observation.author)field(definitions,'Author',observation.author);
  if(observation.perspective)field(definitions,'Perspective',observation.perspective);
  const source=bundle.sourcePins.find(pin=>pin.id===observation.provenance.sourceId);
  field(definitions,'Source',source?.title??observation.provenance.sourceId);
  field(definitions,'Locator',`${source?.locator??''} ${observation.provenance.locator}`.trim());
  field(definitions,'Bibliography IDs',observation.provenance.bibliographySourceIds.join(', ')||'None retained.');
  field(definitions,'Source SHA-256',observation.provenance.sourceSha256);
  field(definitions,'Record SHA-256',observation.provenance.recordSha256);
  if(observation.derivation)field(definitions,'Derivation',`${observation.derivation.methodId}; inputs: ${observation.derivation.inputObservationIds.join(', ')}`);
  evidence.append(definitions);
  if(observation.limitations.length){const list=element('ul','','semantic-limitations');for(const limitation of observation.limitations)list.append(element('li',limitation));evidence.append(list);}
  details.append(evidence);return details;
}

/** Evidence catalogue only: no new Atlas clock, map layer or historical selection store. */
export function mountSemanticCatalogue(container:HTMLElement,parentSignal:AbortSignal):{dispose():void}{
  const lifetime=new AbortController(),signal=lifetime.signal;
  const registrations=new Map<PilotKey,Promise<RegisteredFixture>>();
  let revision=0,disposed=false;
  let active:LocalRevision|null=null;
  let activeRegistration:RegisteredFixture|null=null;
  const root=element('section','','semantic-catalogue');root.setAttribute('aria-label','Prepared semantic evidence catalogue');
  root.append(element('p','Prepared catalogue — planner not enabled','semantic-mode'));
  root.append(element('p','Inspect two evidence types through the same bounded semantic contracts. These catalogue records describe coverage; opening them does not change the Atlas time or map selection.','semantic-note'));
  const actions=element('div','','semantic-actions');
  const modernButton=element('button','Modern · UN urban estimates');modernButton.type='button';
  const premodernButton=element('button','Premodern · exchange accounts');premodernButton.type='button';
  const status=element('p','Choose an evidence pilot to load its pinned local records.','semantic-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const result=element('div','','semantic-results');result.setAttribute('aria-label','Semantic query results');
  const controls=element('form','','semantic-refine');controls.hidden=true;
  const place=element('select');place.setAttribute('aria-label','Study place');
  const start=element('input');start.type='number';start.step='1';start.required=true;start.setAttribute('aria-label','Study start year');
  const end=element('input');end.type='number';end.step='1';end.required=true;end.setAttribute('aria-label','Study end year');
  const apply=element('button','Narrow study');apply.type='submit';
  const save=element('button','Save study');save.type='button';
  const openLabel=element('label','Reopen study');const open=element('input');open.type='file';open.accept='.json,application/json';open.setAttribute('aria-label','Reopen saved study');openLabel.append(open);
  for(const [label,input] of [['Place',place],['From year',start],['To year',end]] as const){const wrapper=element('label',label);wrapper.append(input);controls.append(wrapper);}
  controls.append(apply,save,element('p','Narrow the current study, or select a pilot above to reset. Dates use astronomical years: 0 = 1 BCE.','semantic-note'));
  actions.append(modernButton,premodernButton);root.append(actions,controls,openLabel,status,result);container.append(root);
  function dispose():void{if(disposed)return;disposed=true;revision++;lifetime.abort();registrations.clear();parentSignal.removeEventListener('abort',dispose);root.remove();}
  parentSignal.addEventListener('abort',dispose,{once:true});
  if(parentSignal.aborted){dispose();return{dispose};}

  async function load(key:PilotKey):Promise<RegisteredFixture>{
    signal.throwIfAborted();
    const cached=registrations.get(key);if(cached)return cached;
    const task=(async()=>{
      const request=new AbortController(),cancel=()=>request.abort();signal.addEventListener('abort',cancel,{once:true});
      const timeout=setTimeout(cancel,5000);
      try{
        // URLs are host constants. No contract, record or replay can supply a loader.
        const url=key==='modern'?new URL('./pilot-data.json',import.meta.url):new URL('../../research-semantic/premodern-pilot.json',import.meta.url);
        const response=await fetch(url,{signal:request.signal,credentials:'same-origin'});
        if(!response.ok||!response.body)throw new Error('The pinned local fixture is unavailable.');
        const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
        try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>SEMANTIC_LIMITS.fixtureBytes){await reader.cancel();throw new Error('The fixture exceeds its bounded byte budget.');}chunks.push(value);}}finally{reader.releaseLock();}
        const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
        const raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
        return key==='modern'?registerModernPilot(raw):registerFixture(raw,PREMODERN_HASH);
      }finally{clearTimeout(timeout);signal.removeEventListener('abort',cancel);}
    })();
    registrations.set(key,task);
    try{return await task;}catch(error){registrations.delete(key);throw error;}
  }
  async function show(key:PilotKey):Promise<void>{
    const request=++revision;status.textContent='Loading and validating the pinned local evidence…';status.dataset.status='loading';
    try{
      const registered=await load(key);if(disposed||request!==revision)return;
      const catalogue=createCatalogue([registered]),descriptor=registered.descriptor;
      const intent:QueryIntent={schemaVersion:1,question:key==='modern'?'Which retained population estimates can be inspected?':'Which retained descriptions of exchange can be inspected?',interpretation:'Separate source-linked observations within this registered fixture.',context:'explicit-bounds',parentId:null,
        scope:{datasetId:descriptor.id,indicatorId:descriptor.indicators[0].id,bbox:descriptor.bounds.bbox,epoch:descriptor.bounds.epoch,entityIds:descriptor.entityIds}};
      const candidate:DashboardSpecification={schemaVersion:1,id:`semantic-${key}`,title:key==='modern'?'UN urban estimates':'Premodern exchange accounts',intent,plan:compileIntent(intent,catalogue),views:[{id:'scope',type:'summary',binding:'observations'},{id:'records',type:'table',binding:'observations'},{id:'source',type:'evidence',binding:'observations'}],selection:'entity-observation',layout:'adaptive'};
      validateSpecification(candidate,catalogue);
      const next=beginRevision(intent,catalogue);
      activate(next,registered,key);
    }catch(error){if(disposed||request!==revision)return;status.textContent=`This fixture could not be activated. Previous evidence remains visible. ${error instanceof Error&&error.name==='AbortError'?'The local load was cancelled or exceeded five seconds.':'Its availability, bounds or pinned edition did not validate.'}`;status.dataset.status='error';}
  }
  function activate(next:LocalRevision,registered:RegisteredFixture,key:PilotKey):void{
    const bundle=next.bundle,descriptor=bundle.descriptor;
    const staged=document.createDocumentFragment();staged.append(element('h4',key==='modern'?'UN urban estimates':'Premodern exchange accounts'));
    staged.append(element('p',`${bundle.observations.length} observations · ${bundle.entities.length} named places · ${yearLabel(next.plan.scope.epoch[0])}–${yearLabel(next.plan.scope.epoch[1])} · revision ${next.archive.revisions.length}`,'semantic-counts'));
    staged.append(element('p',registered.fixture.coverageNote,'semantic-note'));
    staged.append(element('p',`${descriptor.indicators[0].label} · ${descriptor.indicators[0].unit}. No automatic joins, interpolation or arithmetic.`,'semantic-policy'));
    const pins=element('details','','semantic-pins');pins.append(element('summary','Pinned scope and source editions'));
    const fields=element('dl');field(fields,'Edition',descriptor.edition);field(fields,'Fixture SHA-256',descriptor.dataHash);field(fields,'Result SHA-256',bundle.resultHash);field(fields,'Revision',next.archive.revisions.at(-1)!.id);
    field(fields,'Permissions','Local preview only. Model processing and republication disabled.');pins.append(fields);staged.append(pins);
    staged.append(element('p',bundle.observations.length?'Open a dated record for its evidence. Separate records do not imply continuous activity between dates.':'No retained observations overlap this scope. Missing evidence is not zero. Reset the pilot above to broaden the study.','semantic-note'));
    const records=element('div','','semantic-records');records.setAttribute('aria-label','Dated observations and source evidence');
    const entities=new Map(bundle.entities.map(entity=>[entity.id,entity]));
    for(const observation of bundle.observations){const entity=entities.get(observation.entityId);if(!entity)throw new Error('An observation has no resolved place.');records.append(recordView(observation,entity,bundle));}
    staged.append(records);result.replaceChildren(staged);result.dataset.semanticPilot=key;
    active=next;activeRegistration=registered;
    place.replaceChildren();const all=element('option','All current places');all.value='';place.append(all);
    for(const entity of registered.fixture.entities.filter(e=>next.plan.scope.entityIds.includes(e.id))){const option=element('option',entity.label);option.value=entity.id;place.append(option);}
    start.value=String(next.plan.scope.epoch[0]);end.value=String(next.plan.scope.epoch[1]);
    for(const input of [start,end]){input.min=String(next.plan.scope.epoch[0]);input.max=String(next.plan.scope.epoch[1]);}
    controls.hidden=false;modernButton.setAttribute('aria-pressed',String(key==='modern'));premodernButton.setAttribute('aria-pressed',String(key==='premodern'));
    status.textContent='Pinned local study validated. Follow-ups remain local; planner not enabled.';status.dataset.status='ready';
  }
  controls.addEventListener('submit',event=>{
    event.preventDefault();if(!active||!activeRegistration)return;revision++;
    try{const catalogue=createCatalogue([activeRegistration]),intent=revisionIntent(active,place.value?[place.value]:active.plan.scope.entityIds,[start.valueAsNumber,end.valueAsNumber]);
      const next=refineRevision(active,intent,catalogue);activate(next,activeRegistration,result.dataset.semanticPilot==='modern'?'modern':'premodern');
    }catch{status.textContent='Scope could not be narrowed. Check dates and places; the previous study remains visible.';status.dataset.status='error';}
  },{signal});
  save.addEventListener('click',()=>{
    if(!active)return;const url=URL.createObjectURL(new Blob([JSON.stringify(active.archive)],{type:'application/json'}));
    const link=element('a');link.href=url;link.download='Chronicle-Local-Study.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  },{signal});
  open.addEventListener('change',()=>{void (async()=>{
    const file=open.files?.[0];if(!file)return;const request=++revision;
    try{
      if(file.size>SEMANTIC_LIMITS.queryBytes)throw new Error('Oversized archive');
      const raw=await file.text();const archive=RevisionArchiveSchema.parse(boundedSemanticInput(raw));
      const ids=new Set(archive.revisions.map(item=>item.replay.plan.scope.datasetId));if(ids.size!==1)throw new Error('Mixed dependencies');
      const id=[...ids][0];if(!['un-wup-2025-mexico-four','premodern-exchange-accounts'].includes(id))throw new Error('Unknown dependency');
      const key=id==='premodern-exchange-accounts'?'premodern':'modern';const registered=await load(key);
      const next=restoreRevision(archive,createCatalogue([registered]));if(disposed||request!==revision)return;activate(next,registered,key);
    }catch{if(!disposed&&request===revision){status.textContent='Saved study rejected: unavailable edition, altered ancestry, invalid scope or exceeded budget. Previous evidence remains visible.';status.dataset.status='error';}}
    finally{open.value='';}
  })();},{signal});
  modernButton.setAttribute('aria-pressed','false');premodernButton.setAttribute('aria-pressed','false');
  modernButton.addEventListener('click',()=>{void show('modern');},{signal});premodernButton.addEventListener('click',()=>{void show('premodern');},{signal});
  return{dispose};
}
