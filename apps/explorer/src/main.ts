import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import './dossier-inspector.css';
import './v2-shell.css';
import './detail.css';
import './glass-shell.css';
import './history-ruler.css';
import './teaching-studies.css';
import { TeachingStudies, type StudyState } from './teaching-studies.ts';
import { STATE_COVERAGE, STATE_COVERAGE_SOURCES, stateCoverageSources, findStateCoverage } from './state-coverage.ts';
import { TEACHING_CATEGORIES, TEACHING_FEATURES, teachingFeaturesAtYear, type TeachingCategory, type TeachingFeature } from './teaching-data.ts';
import { mountHistoryRuler, mountTimelineDock, type HistoryRuler, type TimelineEvent } from './history-ruler.ts';
import { PolityContextCard, type PolityCardMetric } from './polity-context-card.ts';
import './polity-context-card.css';
import { loadContextMetrics, metricsForScene, type ContextMetrics } from './context-metrics.ts';
import { findHistoricalContext, historicalEvents } from './historical-context.ts';
import { findStateHistory, getStateHistory, STATE_HISTORY_EVENTS, toHistoricalYear, toAstronomicalYear } from './state-histories.ts';
import { DetailManager } from './detail-manager.ts';
import { nearestDetailPlace, type DetailPlace, type DetailFrame } from './detail-context.ts';
import { DossierInspector, type InspectorMode, type InspectorFeatureContext, type InspectorPointAssertion } from './dossier-inspector.ts';
import { DisplayResolver, chooseTrack, type DisplayPlan, type DisplayPolicy, type DisplayTrack } from './display-policy.ts';
import type { AlphaManifest, SceneSnapshot, TemporalManifest } from '../../../packages/contracts/src/index.ts';
import { fetchAlphaManifest, adaptAlphaManifest, createAlphaLoader, loadAlphaBase, alphaDeliveryMeasurements } from './alpha.ts';
import { fetchGlobalCatalog, GlobalCatalogStore, resolveGlobalObservation, type GlobalCatalog, type GlobalObservation } from './global-catalog.ts';
import type { SceneData } from './temporal.ts';
import { loadPopulationLookup } from './population-lookup.ts';
import { fixtureEntities } from './fixture-metadata.ts';
import { CanvasMap, type EntityStyle } from './canvas-map.ts';
import { GLMap } from './gl-map.ts';
import { formatFixtureYear } from './date-label.ts';
import { createState, shouldHandleSpace } from './state.ts';
import { TimeMotion, type MotionMode, type MotionSnapshot } from '@chronicle/runtime';
import { formatNavigationDate, parseNavigationDate } from './time-entry.ts';
import { TemporalController } from './temporal.ts';
import { reconcileSelection, resolvePick, selectEntity, type RawPickHit, type TerritorySelection } from './picking.ts';
import { mountResearchWorkspace } from './research/view.ts';
import { HostWorkProfile } from './host-work-profile.ts';
import { ReducedMotionPreference } from './reduced-motion.ts';
import { createLocalVerification } from './local-verification.ts';

// Synthetic research fixtures remain test assets, never a product route.
const synthetic: boolean = false;
const entities: Record<string, EntityStyle> = { ...fixtureEntities };
let minYear = 950, maxYear = 1149;
let minTime = -372547, maxTime = -299500;
let motion: TimeMotion | undefined;
let alphaManifest: AlphaManifest;
let worldManifest: AlphaManifest;
let catalog: GlobalCatalog | undefined;
let catalogStore: GlobalCatalogStore | undefined;
let neutralWorldTrack: DisplayTrack;
const sceneCache = new Map<string,SceneData>();
let navigationKey = '';
let locationRouteNote = '';
let firstViewDelivery: ReturnType<typeof alphaDeliveryMeasurements>|undefined;
let restoringURL = false;
let restoreSerial = 0;
let tracks: Record<string, DisplayTrack> = {};
let route = 'isles';
const policy: DisplayPolicy = 'reference';
let resolver: DisplayResolver;
let currentPlan: DisplayPlan | null = null;
let pendingPlan: DisplayPlan | null = null;
let intent: { entityId?: string; name?: string; historyId?: string; coordinates: [number,number] | null; mode: InspectorMode } | null = null;
let inspector: DossierInspector;
let overview: string | null = null;
let buildInfo: unknown = { status: 'development build' };
let traceTotal = 0;
let lastURLWrite = 0;
let urlWriteTimer: number | undefined;
const restored = new URLSearchParams(location.hash.slice(1));
let timelineWindow = 0;
let lastPrefetchedEpoch: string | undefined;
const rates = [1, 30, 365.2425, 3652.425, 36524.25];
let evidenceOpen = false;
let speed = 3;
let inspectorBinding = '';
let inspectorMatches: InspectorPointAssertion[] = [];
let populationLookup: Awaited<ReturnType<typeof loadPopulationLookup>> | undefined;
const trace: Record<string, unknown>[] = [];
const record = (event: string, details: Record<string, unknown>) => { traceTotal++; trace.push({at:performance.now(),event,...details}); if(trace.length>256) trace.shift(); };
const properties = (s: SceneSnapshot) => s.parts?.map(p=>p.properties) ?? s.territories.map(f=>f.properties);
let selectionMessage = '';
let state = createState(-354285);
let scene: SceneSnapshot | null = null;
let selection: TerritorySelection | null = null;
let manifest: TemporalManifest;
let delivery: TemporalController | undefined;
let flat: CanvasMap | undefined;
let glMap: GLMap | undefined;
let layers = { population: false, migration: false };
let details: DetailManager | undefined;
let ruler: HistoryRuler | undefined;
let researchWorkspace: ReturnType<typeof mountResearchWorkspace> | undefined;
let polityCard: PolityContextCard;
let contextMetrics: ContextMetrics | undefined;
let teachingStudies:TeachingStudies;
let teachingRenderKey="";
let timelineEventsKey = '';
let timelineEventsMetrics: ContextMetrics | undefined;
const hostWorkProfile = new HostWorkProfile();
const reducedMotion = new ReducedMotionPreference();
reducedMotion.subscribe(reduced => { if (reduced) motion?.setPlaying(false); });
let selectedTeachingId:string|undefined=restored.get("teachingFeature")??undefined;
const teachingCategories=new Set<TeachingCategory>((restored.get("teaching")??"").split(",").filter((key):key is TeachingCategory=>key in TEACHING_CATEGORIES));
let interpretiveBorders=restored.get("softBorders")!=="0";
let detailPlaceId: string | null = restored.get('place');
let detailCardKey = '';
let detailMarkerId = '';
let detailLoading: Promise<void> | undefined;
let frame: number | undefined;
let pending = false;
let deliveryError: string | null = null;
const lifetime = new AbortController();
const options = { signal: lifetime.signal };
const yearDay = (year: number) => { const d = new Date(0); d.setUTCFullYear(year, 0, 1); return d.getTime() / 86400000; };
const yearOf = (day: number) => new Date(day * 86400000).getUTCFullYear();

const root = document.querySelector<HTMLDivElement>('#app')!;
document.body.classList.add('chronicle-glass');
root.innerHTML = `
<header class="app-header">
  <div class="brand"><img src="./compass.svg" alt="" width="34" height="34"><div><strong>Chronicle</strong><span>EXPLORER · BETA</span></div></div>
  <div class="header-rule"></div><span class="edition">A study in time & place</span>

</header>
<main class="workspace">
  <div id="map" aria-label="Interactive temporal atlas"></div>
  <details id="atlas-about" class="atlas-about"><summary>About this map</summary><section class="map-heading"><p id="atlas-kind" class="eyebrow"></p><h1 id="atlas-title">Chronicle Atlas</h1><p id="atlas-subtitle"></p></section>
  </details><div class="map-tools"><label class="search-field"><span>⌕</span><input id="entity-search" type="search" placeholder="Find a state or city" aria-label="Search states and cities"></label><button id="explore-toggle" aria-expanded="false" aria-controls="explore-drawer">Explore</button><button id="studies-toggle">Studies</button><button id="tools-toggle" aria-expanded="false" aria-controls="tools-drawer">Layers</button><button id="debug-toggle" aria-expanded="false" aria-controls="debug-drawer" aria-label="Open diagnostics">···</button></div>
  <section class="meaning-key" aria-label="Map interpretation"><span class="meaning-political">Political association</span><span class="meaning-cultural">Cultural presence</span><span class="meaning-context">Source context</span><small>Source-attributed · not independently corroborated</small></section><section id="tools-drawer" class="tools-drawer" aria-label="Map layers" hidden>
    <div class="inspector-top"><span class="eyebrow">EXPLORE THE LAYERS</span><span id="layer-kind" class="small-label"></span></div>
    <div id="context-controls" class="layer-controls">
      <label><input id="terrain-toggle" type="checkbox" checked><span>Relief & land<small>Modern physical context · Natural Earth</small></span></label>
      <label><input id="water-toggle" type="checkbox" checked><span>Rivers & lakes<small>More detail as you zoom · modern hydrography</small></span></label>
      <p class="cities-in-timeline">Cities & capitals follow the timeline.<small>Major recorded cities appear at world scale; zoom in for smaller places.</small></p>
    </div><div id="layer-controls" class="layer-controls">
      <label><input id="population-toggle" type="checkbox"><span>Population density<small>Illustrative people / km²</small></span></label>

    </div>
    <div id="population-controls" class="population-controls"><label>Population date <select id="population-year" aria-label="Population observation"><option value="follow">Follow map time</option></select></label><p>Fixed 2° grid. Density is people per full cell km², including water. No route is inferred from change.</p></div>
    <p id="layer-unavailable" class="muted" hidden>No population or migration source is admitted for this candidate.</p>
    <div id="density-key" class="density-key" hidden><span>0</span><i></i><span>400 people / km²</span></div>
    <p id="migration-key" class="migration-key" hidden></p>
    </section><aside id="inspector" class="inspector" aria-label="Selected historical entity" hidden><button id="clear-selection" class="inspector-close icon-button" aria-label="Clear selection">×</button><div id="polity-context"></div><section id="coverage-context" class="coverage-context"></section><p id="selection-status" role="status" class="selection-status"></p></aside>
  <section id="study-drawer" class="study-drawer" aria-label="Study room and place details" hidden><button id="close-study" class="inspector-close icon-button" aria-label="Close study">×</button><section id="detail-place-card" class="detail-place-card" hidden></section><div id="teaching-studies"></div><details class="study-legacy"><summary>Selected area & regional dossiers</summary><div id="dated-inspector"></div></details></section>
  <button id="point-chip" class="point-chip" hidden></button>
  <div id="study-map-caption" aria-live="polite"></div><section id="detail-key" class="detail-key" aria-label="Physical context and population"><span id="physical-key">Loading relief and cities…</span><span id="city-key"></span><div id="heatmap-legend" hidden><strong id="population-date-label"></strong><div class="heat-scale"><span>1</span><i></i><span>1,000+ / km²</span></div><small>Modeled · 2° grid · zero / unknown cells uncolored</small></div></section>
  <section id="explore-drawer" class="explore-drawer" hidden><p class="eyebrow">GO TO A REGION</p><div id="timeline-filters"></div><nav class="world-tools" aria-label="Geographic overview"><button id="world-view">World overview</button><button id="isles-view">Isles detail</button><button data-region="americas">Americas</button><button data-region="africa">Africa</button><button data-region="asia">Asia</button></nav></section>
  <section id="debug-drawer" class="debug-drawer" aria-label="Diagnostics" hidden><section class="scene-details"><h3>Scene & delivery</h3><dl><div><dt>Edition</dt><dd id="scene-edition">Loading</dd></div><div><dt>Epoch</dt><dd id="scene-epoch">—</dd></div><div><dt>Committed generation</dt><dd id="scene-generation">—</dd></div><div><dt>Layer generations</dt><dd id="layer-generations">—</dd></div></dl><label class="slow-check"><input id="slow-delivery" type="checkbox"> Simulate 500 ms delivery</label><p>Retains the current scene while loading the next.</p></section><details class="part-details"><summary>Identity & active parts</summary><dl class="identity"><div><dt>entity_id</dt><dd id="card-entity"></dd></div><div><dt>Picked render_id</dt><dd id="card-render"></dd></div><div><dt>territory_state_id</dt><dd id="card-state"></dd></div></dl>
        <ul id="card-render-parts"></ul></details><pre id="gpu-diagnostics"></pre><pre id="runtime-diagnostics"></pre><label>Scenario <input id="receipt-scenario" value="integrated-exploration" maxlength="100"></label><button id="reset-trace">Start receipt trace</button><button id="export-receipt">Export interaction receipt</button><details id="receipt-preview" hidden><summary>Receipt JSON · copy or save</summary><pre id="receipt-json" tabindex="0" aria-label="Interaction receipt JSON"></pre></details><p>Render callbacks and animation-frame opportunities are not physical display evidence. A complete hardware profile requires driver and performance receipts.</p></section><section id="evidence-drawer" class="evidence-drawer" aria-label="Evidence and methodology" hidden><div class="drawer-heading"><span class="eyebrow">BEHIND THE MAP</span><button id="close-evidence" class="icon-button" aria-label="Close evidence">×</button></div><h2>Evidence & methodology</h2><div id="evidence-content"></div></section>
  <nav id="entity-legend" class="map-legend" aria-label="Select territory"></nav>
  <button id="reset-view" class="reset-button" disabled><span aria-hidden="true">⌖</span> Reset view</button>
  <section class="transport" aria-label="Historical timeline">
    <div class="transport-row">
      <button id="play-toggle" aria-label="Play timeline" aria-pressed="false" disabled><span id="play-icon" aria-hidden="true">▶</span></button>
      <div class="time-display"><span class="eyebrow">BROWSING</span><strong id="committed-date">Loading…</strong></div>
      <div class="transport-divider"></div>
      <div class="playback-readout"><strong id="playback-status" role="status">Paused</strong><span id="playback-rate">1 year / second</span></div>
      <span id="reference-date" class="reference-date"></span>
    </div>
    <div id="history-ruler"></div><div class="scrubber" hidden><input id="year-slider" type="range" min="950" max="1149" step="1" value="1000" aria-label="Requested date"><div id="coverage-track" class="coverage-track"></div><div id="epoch-band" class="epoch-band"></div></div>
    <details class="precise-time"><summary>Date & playback settings</summary><div class="advanced-transport"><div class="advanced-row">      <div class="year-entry"><label for="requested-year">Year (− = BCE)</label><div><input id="requested-year" type="number" min="950" max="1149" value="1000" step="1" aria-label="Requested year"><span id="year-era">CE</span></div></div>
      <div class="speed-controls" aria-label="Playback speed"><button data-speed="1" aria-label="Playback speed 1" aria-pressed="false">1</button><button data-speed="2" aria-label="Playback speed 2" aria-pressed="false">2</button><button data-speed="3" aria-label="Playback speed 3" aria-pressed="true">3</button><button data-speed="4" aria-label="Playback speed 4" aria-pressed="false">4</button><button data-speed="5" aria-label="Playback speed 5" aria-pressed="false">5</button></div>
    </div>
    <div class="motion-controls"><label>Playback <select id="playback-mode"><option value="chronological">Continuous time</option><option value="observation-tour">Observation tour</option></select></label><label hidden>Window <select id="time-window"><option value="0">Full range</option><option value="36525">Century</option><option value="3653">Decade</option><option value="366">Year</option></select></label><span id="cursor-date"></span></div>
</div><div><button id="previous-day" aria-label="Previous day">−1 day</button><input id="requested-date" type="text" aria-label="Exact requested date" placeholder="1050-01-01 CE"><button id="go-date">Go</button><button id="next-day" aria-label="Next day">+1 day</button></div><p id="date-help">Navigation dates use the proleptic Gregorian calendar. Source precision is unchanged.</p></details>
    <div class="timeline-status"><span id="delivery-status" role="status">Loading temporal archives…</span><span id="coverage-note"></span></div>
  </section>
  <div id="map-message" class="map-message" role="status">Loading the atlas…</div>
</main>
<footer><span id="map-status">Initializing</span><span id="camera-readout"></span><span id="renderer-status">Web Mercator</span></footer>`;
for(const button of document.querySelectorAll<HTMLButtonElement>('.world-tools button'))button.disabled=true;
function el<T extends HTMLElement = HTMLElement>(id: string): T { return document.getElementById(id) as T; }
function setText(id:string,value:string):void { const element=el(id);if(element.textContent!==value)element.textContent=value; }
const timelineDock=mountTimelineDock({workspace:document.querySelector<HTMLElement>('.workspace')!,transport:document.querySelector<HTMLElement>('.transport')!});
if(import.meta.hot)import.meta.hot.dispose(()=>timelineDock.dispose());
const studyStates:StudyState[]=STATE_COVERAGE.map(entry=>({id:entry.id,title:entry.title,kind:entry.kind,summary:entry.summary+' '+entry.continuity,
  observations:entry.observations,histories:entry.historyIds.map(getStateHistory).filter((h):h is NonNullable<typeof h>=>!!h),
  sources:[...stateCoverageSources(entry).map(s=>({...s,kind:'Atlas source',notes:s.limitations})),...entry.sources.map(s=>({...s,kind:'Historical interpretation',notes:entry.title}))]}));
teachingStudies=new TeachingStudies(el('teaching-studies'),studyStates,{
  onFeature:feature=>{motion?.setPlaying(false);selectedTeachingId=feature.id;teachingCategories.add(feature.category);syncTeachingControls();const y=toHistoricalYear(yearOf(state.requestedTime));const target=Math.max(feature.fromYear,Math.min(feature.toYear,y));if(target!==y)void seekTime(yearDay(toAstronomicalYear(target)));const points=feature.geometry.type==='Point'?[feature.geometry.coordinates]:feature.geometry.type==='LineString'?feature.geometry.coordinates:feature.geometry.coordinates.flat();const middle=points[Math.floor(points.length/2)];setView({longitude:middle[0],latitude:middle[1],zoom:feature.geometry.type==='Point'?4:1.7});renderTeaching(true);writeURL(true);},
  onAccount:account=>{motion?.setPlaying(false);detailPlaceId=null;intent={coordinates:account.coordinates,mode:'place'};setView({longitude:account.coordinates[0],latitude:account.coordinates[1],zoom:4.5});inspector.setMode('place');void seekTime(yearDay(toAstronomicalYear(account.eventFromYear)));renderTeaching(true);writeURL(true);},
  onObservation:(entry,observation)=>{motion?.setPlaying(false);detailPlaceId=null;intent={entityId:observation.entityId,name:entry.title,coordinates:null,mode:'polity'};inspector.setMode('polity');if(observation.scope==='isles')setView({longitude:-4.5,latitude:54,zoom:4.3});else{setView({longitude:5,latitude:20,zoom:.55});route='world';updateNavigation();}void seekTime(yearDay(toAstronomicalYear(observation.year)));}
});
function syncTeachingControls(){for(const key of Object.keys(TEACHING_CATEGORIES) as TeachingCategory[]){const input=document.getElementById('teaching-'+key) as HTMLInputElement|null;if(input)input.checked=teachingCategories.has(key);}}
const teachingLayerControls=node('section','','teaching-layer-list');teachingLayerControls.append(node('h3','Connections & foundations'),node('p','These layers follow the browsing year. Open Studies for their evidence, dates and limits.'));
for(const [key,value] of Object.entries(TEACHING_CATEGORIES) as [TeachingCategory,typeof TEACHING_CATEGORIES[TeachingCategory]][]){const label=node('label',''),input=document.createElement('input');input.type='checkbox';input.id='teaching-'+key;input.checked=teachingCategories.has(key);const text=node('span',value.title);text.append(node('small',value.note));const count=node('span','','layer-count');count.id='teaching-count-'+key;input.addEventListener('change',()=>{if(input.checked)teachingCategories.add(key);else teachingCategories.delete(key);renderTeaching(true);writeURL(true);},options);label.append(input,text,count);teachingLayerControls.append(label);}
const borderLabel=node('label',''),borderInput=document.createElement('input');borderInput.type='checkbox';borderInput.checked=interpretiveBorders;borderInput.id='interpretive-borders';const borderText=node('span','Soften reference boundaries');borderText.append(node('small','A visual reminder that atlas outlines do not establish uniform or exclusive control. This style is not a reconstruction of each frontier.'));borderLabel.append(borderInput,borderText);borderInput.addEventListener('change',()=>{interpretiveBorders=borderInput.checked;renderTeaching(true);writeURL(true);},options);teachingLayerControls.append(borderLabel);
const key=node('div','','teaching-key');key.append(node('span','Corridors are schematic connections; belief and language markers show evidence, not population shares.'));
for(const [id,label] of [['core','Core / direct relation'],['tributary','Tributary relation'],['influence','Influence / contested tie'],['autonomous','Autonomy / frontier context']]){const row=node('span',label,id);row.prepend(document.createElement('i'));key.append(row);}teachingLayerControls.append(key);el('tools-drawer').append(teachingLayerControls);
function renderTeaching(force=false){return hostWorkProfile.measure('teaching',()=>renderTeachingNow(force));}
function renderTeachingNow(force=false){
  const year=toHistoricalYear(yearOf(state.requestedTime)),observationYear=currentPlan?.displayedTime===null||currentPlan?.displayedTime===undefined?null:toHistoricalYear(yearOf(currentPlan.displayedTime));
  const identity=JSON.stringify([year,[...teachingCategories].sort(),selectedTeachingId,interpretiveBorders]);
  if(force||identity!==teachingRenderKey){teachingRenderKey=identity;const features=teachingFeaturesAtYear(year,teachingCategories);flat?.setTeachingFeatures(features,selectedTeachingId);glMap?.setTeachingFeatures(features,selectedTeachingId);flat?.setInterpretiveBorders(interpretiveBorders);glMap?.setInterpretiveBorders(interpretiveBorders);
    for(const category of Object.keys(TEACHING_CATEGORIES) as TeachingCategory[]){el('teaching-count-'+category).textContent=String(TEACHING_FEATURES.filter(f=>f.category===category&&f.fromYear<=year&&year<=f.toYear).length)+' dated';}
    const caption=el('study-map-caption'),selected=features.find(f=>f.id===selectedTeachingId);caption.replaceChildren();if(selected){caption.append(node('strong',selected.title),node('span',TEACHING_CATEGORIES[selected.category].title+' · schematic evidence layer'));}else if(features.length){caption.append(node('span',features.length+' dated connections & contexts · see Studies for evidence'));}else if(teachingCategories.size){caption.append(node('span','No collected layer records for this year · explore other dates in Studies'));}root.dataset.teachingActive=String(features.length);
  }
  if(!el('study-drawer').hidden||force)teachingStudies.update({year,observationYear,coordinates:intent?.coordinates,placeName:detailPlaceId?details?.getPlace(detailPlaceId)?.title:undefined,entityId:intent?.entityId,name:intent?.name});
}

// General context is available on request; the right panel is reserved for the selected entity.
el('tools-drawer').append(document.querySelector('.meaning-key')!,el('detail-key'));
el('debug-drawer').append(document.querySelector('footer')!);
el('close-study').addEventListener('click',()=>{el('study-drawer').hidden=true;},options);
el('point-chip').addEventListener('click',()=>{el('study-drawer').hidden=false;inspector.setMode('place');teachingStudies.openTab('accounts');renderTeaching(true);},options);
el('explore-toggle').addEventListener('click',()=>{const box=el('explore-drawer');box.hidden=!box.hidden;el('explore-toggle').setAttribute('aria-expanded',String(!box.hidden));},options);
function refreshTimelineEvents(){
  if(!ruler)return;
  // Dates and sources are immutable for this edition. A scene-generation change
  // alone must not rebuild thousands of event nodes and every filter option.
  const key=JSON.stringify([route,catalog?.catalog_id,manifest.edition,intent?.entityId,intent?.historyId]);
  if(key===timelineEventsKey && contextMetrics===timelineEventsMetrics)return;
  timelineEventsKey=key;timelineEventsMetrics=contextMetrics;
  const selectedDates=new Set(intent?.entityId?contextMetrics?.observationsForEntity(intent.entityId).map(o=>o.t_start)??[]:[]);
  const observations:TimelineEvent[]=availableObservations().map(e=>{const source=STATE_COVERAGE_SOURCES.find(s=>s.id==='atlas:'+toHistoricalYear(yearOf(e.t_start)));return {id:'observation-'+e.t_start,time:e.t_start,title:'Map observation '+formatFixtureYear(e.t_start),kind:'observation',description:'A modern atlas reconstruction for this dated source window. It is not a contemporary surveyed map, and its outlines do not establish uniform control. Between observations, the preceding source is retained as a dated reference; boundaries are not interpolated.',sourceURL:source?.url,entityIds:intent?.entityId&&selectedDates.has(e.t_start)?[intent.entityId]:[]};});
  const lifecycleEvents = STATE_HISTORY_EVENTS.map(event => ({ ...event,
    entityIds: intent?.entityId && intent.historyId && event.id.startsWith(`state-history:${intent.historyId}:`) ? [intent.entityId] : [],
  }));
  // The expanded lifecycle edition supplies these period transitions, including its
  // explicit Egyptian chronology; keep distinct day-precision/general events.
  const replacedEvents=new Set(['old-kingdom','middle-kingdom','new-kingdom','roman-egypt','principate','rome-divided','tang-begins']);
  ruler.setEvents([...observations,...(synthetic?[]:[...historicalEvents.filter(event=>!replacedEvents.has(event.id)),...lifecycleEvents])]);
}

function updateSelection(next: TerritorySelection | null, updateCard=true) {
  selection = next;
  if(next&&intent&&scene?.entities?.[next.entityId]){
    intent.name=scene.entities[next.entityId].name;
    intent.historyId=findStateHistory(intent.name,yearOf(scene.time),featureContext(next.entityId)?.kind)?.id;
  }
  refreshTimelineEvents();
  state = { ...state, selectedRenderId: next?.renderId ?? null };
  flat?.setSelected(next?.renderIds ?? []); glMap?.setSelected(next?.renderIds ?? []);
  root.dataset.selectedEntity = intent?.entityId ?? '';
  root.dataset.representedSelection = next?.entityId ?? '';
  if(updateCard)renderCard();
  for (const button of el('entity-legend').querySelectorAll<HTMLButtonElement>('button')) button.setAttribute('aria-pressed', String(button.dataset.entity === intent?.entityId));
}
function clearSelection() { detailPlaceId=null; detailCardKey=''; el('detail-place-card').hidden=true; el('inspector').hidden=true; el('study-drawer').hidden=true; el('point-chip').hidden=true; intent = null; updateSelection(null); setEvidenceOpen(false); inspector.closeOverview(); overview = null; writeURL(true); }
function hover(hits: RawPickHit[]) { const hovered = scene ? resolvePick(hits,scene) : null; flat?.setHovered(hovered?.renderIds ?? []); glMap?.setHovered(hovered?.renderIds ?? []); root.dataset.hoveredEntity = hovered?.entityId ?? ''; }
function pick(hits: RawPickHit[]) {
  detailPlaceId=null;
  if (!scene) return;
  el('inspector').hidden=false;
  const selected = resolvePick(hits,scene); motion?.setPlaying(false);
  intent = selected ? {entityId:selected.entityId,name:scene.entities?.[selected.entityId]?.name ?? selected.entityId,coordinates:null,mode:'polity'} : null;
  inspector.setMode('polity'); updateSelection(selected); writeURL(true);
}
function inspectPoint(hit: {coordinates:[number,number];renderIds:string[];mode:InspectorMode}) {
  if (!scene) return; el('inspector').hidden=false; motion?.setPlaying(false);
  const selected=resolvePick(hit.renderIds.map(render_id=>({render_id,generation:scene!.generation})),scene);
  intent={entityId:selected?.entityId,name:selected ? scene.entities?.[selected.entityId]?.name ?? selected.entityId : undefined, coordinates:hit.coordinates,mode:hit.mode};
  detailPlaceId=hit.mode==='place' && details?.frame.options.cities ? nearestDetailPlace(details.frame.places,hit.coordinates,512*2**(view()?.zoom??2))?.id??null : null;
  inspector.setMode(hit.mode); updateSelection(selected); writeURL(true);
  record('point-selection',{coordinates:hit.coordinates,mode:hit.mode,entity:selected?.entityId,time:state.requestedTime,displayTime:scene.time});
}
function currentObservation(): GlobalObservation | undefined {
  return catalog?.observations.find(o=>'world:'+o.observation_id===currentPlan?.track.id);
}
function coverageNote():string {
  if(synthetic)return 'Synthetic intervals · no interpolation';
  const count=catalog?.observations.length??0;
  const o=currentObservation();
  return `${locationRouteNote}${count} world observations · 31 Isles · dated source maps${o?` · ${o.coverage.review} review / ${o.coverage.quarantine} quarantine`:''}`;
}
function featureContext(entityId:string):InspectorFeatureContext|undefined {
  if(!scene)return;
  const p=properties(scene).find(p=>p.entity_id===entityId);if(!p)return;
  const evidence=scene.evidence?.[p.territory_state_id];if(!evidence)return;
  const extra=p as typeof p & Record<string,unknown>;
  return {sourceName:typeof extra.source_name==='string'?extra.source_name:scene.entities?.[entityId]?.name??entityId,
    kind:synthetic?'synthetic':p.kind==='context'?'source-context':p.kind==='cultural'?'cultural-presence':'political-association',
    reviewStatus:synthetic?'synthetic':p.review_status==='independently-reviewed'?'independently-reviewed':'source-attributed',
    sourceTitle:evidence.source_title,attribution:evidence.attribution,sourceEdition:evidence.source_edition,sourceURL:evidence.source_url,
    datePrecision:evidence.valid_extent?.precision??'year',classificationNote:evidence.methodology[0],coverageNote:coverageNote()};
}
function resolveTarget(time:number):{id:string;track?:DisplayTrack;observation?:GlobalObservation;note:string} {
  if(synthetic)return {id:'isles',track:tracks.isles,note:''};
  const world=resolveGlobalObservation(catalog!,time,policy);
  if(route==='isles'){
    const regional=resolver.resolve(tracks.isles,time,policy,layers);
    if(regional.political&&(!world||regional.political.t_start>=world.t_start))return {id:'isles',track:tracks.isles,note:''};
    if(!world)return {id:'isles',track:tracks.isles,note:''};
  }
  if(world)return {id:'world:'+world.observation_id,observation:world,note:route==='isles'?'World context replaces unavailable or older Isles detail · ':''};
  return {id:neutralWorldTrack.id,track:neutralWorldTrack,note:''};
}
function availableObservations():{t_start:number;t_end:number}[] {
  if(synthetic)return [...manifest.epochs];
  const world=catalog?.observations??[];
  const list=route==='world'?world:[...world,...manifest.epochs];
  return [...new Map(list.map(e=>[e.t_start,{t_start:e.t_start,t_end:e.t_end}])).values()].sort((a,b)=>a.t_start-b.t_start);
}
function updateNavigation(){
  if(synthetic||!manifest)return;
  const available=availableObservations();const key=JSON.stringify([route,available]);if(key===navigationKey)return;navigationKey=key;
  motion?.setObservationTimes(available.map(e=>e.t_start));
  el('coverage-track').replaceChildren(...available.map(e=>{const button=node('button','');button.dataset.time=String(e.t_start);button.title=formatFixtureYear(e.t_start);button.setAttribute('aria-label',`Snapshot ${formatFixtureYear(e.t_start)}`);button.addEventListener('click',()=>void seekTime(e.t_start),options);return button;}));
  configureTimeWindow();refreshTimelineEvents();
}
function renderCard() {return hostWorkProfile.measure('card',renderCardNow);}
function renderCardNow() {
  if (!inspector || !scene || !currentPlan) return;
  if(!intent){el('inspector').hidden=true;el('point-chip').hidden=true;ruler?.setSelection(null);return;}
  const coords=intent?.coordinates;
  const binding=JSON.stringify([scene.generation,coords,selection]);
  if(binding!==inspectorBinding){
    inspectorBinding=binding;
    const hits=coords ? (glMap?.hitsAtCoordinates(coords) ?? flat?.hitsAtCoordinates(coords) ?? []) : [];
    const matches=properties(scene).filter(p=>hits.includes(p.render_id));
    inspectorMatches=[...new Set(matches.map(p=>p.entity_id))].map(entityId=>({entityId,name:scene!.entities?.[entityId]?.name ?? entityId,assertionIds:[...new Set(matches.filter(p=>p.entity_id===entityId).flatMap(p=>scene!.evidence?.[p.territory_state_id]?.assertion_ids ?? []))],feature:featureContext(entityId)}));
    el('card-render-parts').replaceChildren(...(selection?.renderIds ?? []).map(id=>node('li',id)));
  }
  const assertions=inspectorMatches;
  const comparison=selection?populationLookup?.forScene(scene,selection.entityId,selection.territoryStateId):null;
  const populationSummary=comparison?`Historical territory footprint: ${comparison.historical.population===null?'unavailable':comparison.historical.population.toLocaleString('en-US')}. ${comparison.referenceLabel}: ${comparison.fixed.population===null?'unavailable':comparison.fixed.population.toLocaleString('en-US')}. ${comparison.observationDateLabel}. ${synthetic?'Illustrative covered-area subtotals; not complete territory totals.':'England and Wales only; not a whole-UK or point population.'}`:undefined;
  selectionMessage=intent?.entityId && !selection ? 'Selection retained · this entity has no representation at the browsing date.' : '';
  el('selection-status').textContent=selectionMessage;
  const cardContext={requestedTime:state.requestedTime,displayedTime:currentPlan.displayedTime,edition:scene.edition,policy,representation:currentPlan.representation,pending:!!motion?.snapshot.pending||pending,selection:intent?.entityId?{entityId:intent.entityId,name:intent.name ?? intent.entityId}:null,coordinates:coords,assertions,populationSummary,selectionRepresented:!!selection,feature:selection?featureContext(selection.entityId):undefined,coverageNote:coverageNote()};
  inspector.update(cardContext);
  el('inspector').hidden=!intent?.entityId;
  ruler?.setSelection(intent?.entityId?{entityId:intent.entityId,name:intent.name??intent.entityId}:null);
  const metrics:PolityCardMetric[]=[];
  const footprint=selection?metricsForScene(contextMetrics,scene,selection.entityId):null;
  if(footprint?.areaKm2!==null&&footprint?.areaKm2!==undefined)metrics.push({label:footprint.label,value:footprint.areaKm2.toLocaleString('en-US')+' km²',qualifier:footprint.scope==='regional'?'Within the regional source window; not a whole-state total.':'Source-vector area; approximate, not a sovereignty measurement.'});
  if(comparison?.historical.population!==null&&comparison?.historical.population!==undefined)metrics.push({label:synthetic?'Illustrative population':'England & Wales population',value:comparison.historical.population.toLocaleString('en-US'),qualifier:comparison.observationDateLabel+(synthetic?' · synthetic covered-area subtotal':' · not the whole UK'),sourceLabel:comparison.source.source_title,sourceURL:comparison.source.source_url});
  if(comparison?.fixed.population!==null&&comparison?.fixed.population!==undefined)metrics.push({label:synthetic?'Fixed-area reference':comparison.referenceLabel+' · regional population',value:comparison.fixed.population.toLocaleString('en-US'),qualifier:comparison.observationDateLabel+(synthetic?' · illustrative reference area':' · regional subset, not a whole-UK population'),sourceLabel:comparison.source.source_title,sourceURL:comparison.source.source_url});
  polityCard.update({...cardContext,metrics,stateHistory:intent?.historyId?getStateHistory(intent.historyId):undefined,historicalContext:selection&&currentPlan.displayedTime!==null?findHistoricalContext(scene.entities?.[selection.entityId]?.name??'',yearOf(currentPlan.displayedTime),cardContext.feature?.kind):undefined,dossierAvailable:inspector.getRecords().some(r=>r.entity_id===intent?.entityId&&currentPlan!.displayedTime!==null&&r.t_start<=currentPlan!.displayedTime!&&currentPlan!.displayedTime!<r.t_end)});
  const coverageBox=el('coverage-context');coverageBox.replaceChildren();
  const coverageMatch=selection&&currentPlan.displayedTime!==null?findStateCoverage({entityId:selection.entityId,observationYear:toHistoricalYear(yearOf(currentPlan.displayedTime))}):undefined;
  if(coverageMatch){
    if(!coverageMatch.history)coverageBox.append(node('h3','About this atlas entry'),node('p',coverageMatch.entry.summary),node('p',coverageMatch.entry.continuity,'study-evidence-note'));
    for(const note of coverageMatch.entry.researchNotes)if(coverageMatch.history||!coverageMatch.entry.summary.includes(note.summary))coverageBox.append(node('p',note.summary,'study-evidence-note'));
    const open=node('button','Read state study & sources');open.addEventListener('click',()=>{el('study-drawer').hidden=false;teachingStudies.openTab('states');renderTeaching(true);});coverageBox.append(open);
  }
  const placeName=detailPlaceId?details?.getPlace(detailPlaceId)?.title:undefined;
  el('point-chip').hidden=!coords;
  el('point-chip').textContent=coords?`⌖ ${placeName??'Inspect Area'}`:'';
  el('point-chip').title=coords?`${coords[1].toFixed(2)}°, ${coords[0].toFixed(2)}° · open place evidence`:'';
  el('card-entity').textContent=intent?.entityId ?? '';
  el('card-render').textContent=selection?.renderId ?? '';
  el('card-state').textContent=selection?.territoryStateId ?? '';
  renderDetailPlace();
  renderTeaching();
}
function applyDetailFrame(frame:DetailFrame) {
  const decorated={...frame,selectedPlace:detailPlaceId?details?.getPlace(detailPlaceId)??null:null};
  flat?.setDetailContext(decorated);glMap?.setDetailContext(decorated);
}
function renderDetail(frame:DetailFrame) {
  applyDetailFrame(frame);
  root.dataset.detailReady=String(!!frame.terrain&&!!frame.hydro&&frame.places.length>0);
  root.dataset.populationYear=String(frame.population?.year??'');
  root.dataset.populationVisible=String(frame.options.density);
  setText('physical-key',frame.options.terrain?'Relief & waterways · modern physical context':'Physical geography · modern context');
  setText('city-key','● Cities by dated population · ★ Dated capitals · zoom for smaller places');
  el('heatmap-legend').hidden=!frame.options.density;
  setText('population-date-label',frame.populationLabel);
  const select=el<HTMLSelectElement>('population-year');
  if(details&&select.options.length!==details.observations.length+1){select.replaceChildren(new Option('Follow map time','follow'),...details.observations.map(o=>new Option(String(o.year)+' · separate layer',String(o.year))));select.value=details.populationChoice;}
  renderDetailPlace();
  if(el<HTMLInputElement>('entity-search').value)renderLegend();
}
function restoreDetailOptions(params:URLSearchParams) {
  detailPlaceId=params.get('place')?.slice(0,200)??null;
  if(!details)return;
  const flags=params.get('context');
  if(flags&&/^[01]{5}$/.test(flags))details.setOptions({terrain:flags[0]==='1',water:flags[1]==='1',cities:true,modernCities:false,density:flags[4]==='1'});
  for(const name of ['terrain','water'] as const)el<HTMLInputElement>(`${name}-toggle`).checked=details.frame.options[name];
  el<HTMLInputElement>('population-toggle').checked=details.frame.options.density;
  const pop=params.get('population');if(pop==='follow'||['1910','1950','2000','2010'].includes(pop??''))details.setPopulationYear(pop!);
}
function selectDetailPlace(place:DetailPlace) {
  motion?.setPlaying(false);setView({longitude:place.coordinates[0],latitude:place.coordinates[1],zoom:Math.max(view()?.zoom??3,5)});
  const ids=glMap?.hitsAtCoordinates(place.coordinates)??flat?.hitsAtCoordinates(place.coordinates)??[];
  inspectPoint({coordinates:place.coordinates,renderIds:ids,mode:'place'});detailPlaceId=place.id;el('study-drawer').hidden=false;renderDetailPlace();teachingStudies.openTab('accounts');renderTeaching(true);writeURL(true);
  el<HTMLInputElement>('entity-search').value='';renderLegend();
}
function renderDetailPlace() {
  const place=detailPlaceId?details?.getPlace(detailPlaceId):undefined;
  const markerId=place?.id??'';if(details&&markerId!==detailMarkerId){detailMarkerId=markerId;applyDetailFrame(details.frame);}
  const box=el('detail-place-card');box.hidden=!place||intent?.mode==='polity';
  if(!place)return;
  const active=details!.frame.places.some(p=>p.id===place.id),year=details!.frame.requestedYear;
  const key=JSON.stringify([place,active,year]);if(key===detailCardKey)return;detailCardKey=key;
  const modern=place.temporalMode==='modern-context', historical=place.temporalMode==='historical-city';
  const yearLabel=(n:number)=>n<=0?`${1-n} BCE`:`${n} CE`;
  box.replaceChildren(node('span',historical?(place.capital?.length?'DATED CAPITAL & CITY':'CITY THROUGH TIME'):modern?'MODERN CITY REFERENCE':'ANCIENT PLACE','eyebrow'),node('h2',place.title));
  if(historical){
    const estimate=place.populationEstimate;
    if(estimate) {
      box.append(node('p',`Recorded population: ${Math.round(estimate.value).toLocaleString('en-US')} · ${yearLabel(estimate.year)}`,'city-population-value'));
      box.append(node('p',estimate.stale?'This estimate is too old to rank this city at the browsing date. The marker is a location reference.':estimate.ageYears?`Latest preceding estimate, ${estimate.ageYears.toLocaleString()} years before the browsing date. No population is inferred between observations.`:'Population estimate for this year.','city-evidence-note'));
      if(estimate.alternativeValues?.length)box.append(node('p',`Other source estimates for that year: ${estimate.alternativeValues.map(v=>Math.round(v.value).toLocaleString('en-US')).join('; ')}. Estimates use differing historical definitions.`,'city-evidence-note'));
    }
    for(const capital of place.capital??[])box.append(node('p',`★ ${capital.label??capital.polityId} · ${yearLabel(capital.from)}–${yearLabel(capital.to)}${capital.note?'. '+capital.note:''}`,'city-capital-tenure'));
    const notes=node('details','','city-history-notes');notes.append(node('summary','History & sources'));
    if(place.nameNote&&place.nameNote!=='Dated historical name.')notes.append(node('p',place.nameNote,'city-evidence-note'));
    if(place.existenceNote)notes.append(node('p',place.existenceNote,'city-evidence-note'));
    if(place.populationDefinition)notes.append(node('p',place.populationDefinition,'city-evidence-note'));
    if(place.locationNote)notes.append(node('p',place.locationNote,'city-evidence-note'));
    if(place.firstObservationYear!==undefined)notes.append(node('p',`Population records: ${yearLabel(place.firstObservationYear)}–${yearLabel(place.lastObservationYear!)}. These dates do not establish founding or abandonment.`,'city-evidence-note'));
    box.append(notes);
  } else box.append(node('p',modern?'Present-day orientation label. This name and settlement are not asserted for the historical map date.':`Approximate source envelope: ${yearLabel(place.validFromYear!)}–${yearLabel(place.validToYear!)}. This is not proof of continuous occupation.`));
  if(!modern&&!active)box.append(node('p','Place selection retained; no active evidence at the browsing date.','selection-status'));
  if(place.description)box.append(node('p',place.description));
  box.append(node('small',`${place.coordinates[1].toFixed(3)}°, ${place.coordinates[0].toFixed(3)}°${place.accuracyMeters!==null&&place.accuracyMeters!==undefined?` · source accuracy ${place.accuracyMeters.toLocaleString()} m`:''}`));
  const a=node('a',historical?'Population / location source':modern?'Natural Earth place record':'Read the Pleiades place record');
  try{const url=new URL(place.sourceUrl);if(['https:','http:'].includes(url.protocol)){a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';box.append(a);}}catch{}
  for(const capital of place.capital??[]){if(!capital.sourceUrl||capital.sourceUrl===place.sourceUrl)continue;const link=node('a','Capital history source');try{const url=new URL(capital.sourceUrl);if(['https:','http:'].includes(url.protocol)){link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';box.append(link);}}catch{}}
}
function renderLayers() {
  renderTeaching();
  flat?.setLayers(layers); glMap?.setLayers(layers);
  el('density-key').hidden = !synthetic || !layers.population;
  el('migration-key').hidden = !layers.migration;
  el('migration-key').textContent = scene?.migration.length ? `⇢ ${synthetic ? 'Invented movement' : 'Reported arrivals · 1847'}: ${scene.migration[0].properties.magnitude.toLocaleString('en-US')} people. Select the route for evidence.` : 'No movement in this interval';
  el('layer-generations').textContent = scene ? `${scene.generation} / ${layers.population ? scene.generation : 'off'} / ${layers.migration ? scene.generation : 'off'}` : '—';
}
function renderPlayback() {
  el('play-toggle').setAttribute('aria-pressed', String(state.isPlaying));
  el('play-toggle').setAttribute('aria-label', state.isPlaying ? 'Pause timeline' : 'Play timeline');
  setText('play-icon',state.isPlaying ? 'Ⅱ' : '▶');
  setText('playback-status',state.isPlaying ? 'Playing' : 'Paused');
  el('playback-status').classList.toggle('playing', state.isPlaying);
}
/** Exact canonical-day entry. Playback and observation stepping never round-trip through a year. */
export function seekTime(canonicalTime: number) {
  ruler?.revealTime(canonicalTime);
  record('input', {time:canonicalTime});
  return motion?.seekTime(canonicalTime);
}
function seekYear(year: number) {
  if (!Number.isInteger(year) || year < minYear || year > maxYear) return;
  // A year entry means January 1, even when its first admitted observation is later.
  void seekTime(Math.max(minTime, Math.min(maxTime, yearDay(year))));
}
function renderCursor(snapshot: MotionSnapshot) {return hostWorkProfile.measure('cursor',()=>renderCursorNow(snapshot));}
function renderCursorNow(snapshot: MotionSnapshot) {
  if (!snapshot.error && !snapshot.pending && snapshot.requestedTime === snapshot.committedTime) deliveryError = null;
  state = { ...state, requestedTime: snapshot.requestedTime, isPlaying: snapshot.isPlaying };
  hostWorkProfile.measure('research-cursor',()=>researchWorkspace?.updateCursor(yearOf(snapshot.cursorTime)));
  root.dataset.cursorTime = String(snapshot.cursorTime);
  root.dataset.requestedTime = String(snapshot.requestedTime);
  root.dataset.motionPending = String(snapshot.pending);
  root.dataset.playbackMode = snapshot.mode;
  const slider = el<HTMLInputElement>('year-slider');
  if (snapshot.cursorTime < Number(slider.min) || snapshot.cursorTime > Number(slider.max)) configureTimeWindow(snapshot.cursorTime);
  slider.value = String(snapshot.cursorTime);
  slider.setAttribute('aria-valuetext', formatNavigationDate(snapshot.cursorTime));
  setText('cursor-date',formatNavigationDate(snapshot.cursorTime));
  setText('committed-date',formatFixtureYear(snapshot.requestedTime));
  const year = yearOf(snapshot.requestedTime);
  if (document.activeElement !== el('requested-year')) el<HTMLInputElement>('requested-year').value = String(year <= 0 ? year - 1 : year);
  if (document.activeElement !== el('requested-date')) el<HTMLInputElement>('requested-date').value = formatNavigationDate(snapshot.requestedTime);
  setText('year-era',year <= 0 ? '' : 'CE');
  hostWorkProfile.measure('detail-time',()=>details?.setTime(year));
  renderTeaching();
  hostWorkProfile.measure('ruler-update',()=>ruler?.update());
  renderPlayback();
  setText('playback-status',snapshot.isPlaying ? pending ? 'Buffering' : 'Playing' : 'Paused');
  setPending(pending);
  hostWorkProfile.measure('presentation',renderPresentation);
  writeURL();
}
function configureTimeWindow(center = motion?.snapshot.cursorTime ?? manifest.initial_time) {
  const slider = el<HTMLInputElement>('year-slider');
  const half = timelineWindow / 2;
  slider.min = String(timelineWindow ? Math.max(minTime, Math.min(maxTime - timelineWindow, center - half)) : minTime);
  slider.max = String(timelineWindow ? Math.min(maxTime, Number(slider.min) + timelineWindow) : maxTime);
  slider.step = 'any';
  const occupied: number[]=[];
  for (const button of el('coverage-track').querySelectorAll<HTMLButtonElement>('button')) {
    const day = Number(button.dataset.time);
    button.hidden = day < Number(slider.min) || day > Number(slider.max);
    const percent=(day - Number(slider.min)) / (Number(slider.max) - Number(slider.min))*100;
    button.style.left = `${percent}%`;
    if(!button.hidden){
      const x=percent/100*(slider.clientWidth||850);
      let row=occupied.findIndex(last=>x-last>=7);if(row<0)row=occupied.length;
      row=Math.min(row,2);occupied[row]=x;button.style.top=`${row*12}px`;
    }
  }
  el('coverage-track').style.height=`${Math.max(14,Math.min(3,occupied.length)*12)}px`;
}
function tick(now: number) {
  motion?.tick(now);
  frame = requestAnimationFrame(tick);
}
function toggle() {
  if (!scene || !motion) return;
  motion.setPlaying(!motion.snapshot.isPlaying);
  console.info('[Chronicle Explorer] isPlaying =', motion.snapshot.isPlaying);
}
function setPending(value: boolean) {
  pending = value; root.dataset.pending = String(value);
  if (value) setText('delivery-status',`Target ${formatNavigationDate(state.requestedTime)} · loaded ${scene ? formatNavigationDate(scene.time) : 'initial scene'}`);
  else if (deliveryError) setText('delivery-status',deliveryError);
  else if (scene) setText('delivery-status',currentPlan?.representation === 'missing' ? 'Political coverage gap · neutral physical context' : currentPlan?.representation === 'reference' ? 'Earlier observation retained as reference context' : 'Source observation ready');
}
function renderPresentation() {
  if (!scene || !currentPlan) return;
  const p=currentPlan;
  // Queued same-scene cursor movement is not a loading operation. Only the
  // actual asynchronous delivery toggles loaded-map wording and layout.
  setText('reference-date',pending?`Loaded ${p.displayedTime===null?'neutral map':formatFixtureYear(p.displayedTime)}`:p.representation==='reference' ? `Reference map ${formatFixtureYear(p.displayedTime!)}` : p.representation==='exact' ? `Observation ${formatFixtureYear(p.displayedTime!)}` : policy==='exact'?'No exact observation':'No earlier observation');
  root.dataset.displayPolicy=policy;root.dataset.committedPolicy=p.policy;root.dataset.representation=p.representation;root.dataset.displayedTime=p.displayedTime===null?'':String(p.displayedTime);
  root.dataset.committedTime=String(scene.time);root.dataset.committedGeneration=String(scene.generation);root.dataset.epoch=scene.epoch_id;root.dataset.route=currentPlan.track.id.startsWith('world')?'world':'isles';root.dataset.preferredRoute=route;
  el('map-message').hidden=p.representation!=='missing';
  setText('map-message',policy==='exact'?'No exact political observation. Physical context remains visible. Switch to Atlas reference to retain earlier borders.':'No earlier political observation. Physical context remains visible.');
  setText('coverage-note',coverageNote());
  renderCard();
}
/** Only a researched identity can bridge differently named source observations. */
function selectionForIntent(next:SceneSnapshot):TerritorySelection|null {
  if(!intent?.entityId)return null;
  const exact=selectEntity(intent.entityId,next);
  if(!intent.historyId)return exact;
  const belongs=(id:string)=>findStateHistory(next.entities?.[id]?.name??'',yearOf(next.time),next.entities?.[id]?.kind)?.id===intent!.historyId;
  if(exact&&belongs(exact.entityId))return exact;
  const matches=[...new Set(properties(next).map(p=>p.entity_id))].filter(belongs);
  return matches.length===1?selectEntity(matches[0],next):null;
}
function commit(next: SceneSnapshot) {return hostWorkProfile.measure('commit',()=>commitNow(next));}
function commitNow(next: SceneSnapshot) {
  scene=next;
  firstViewDelivery??=alphaDeliveryMeasurements();
  if(pendingPlan) currentPlan=resolver.resolve(pendingPlan.track,pendingPlan.requestedTime,pendingPlan.policy,pendingPlan.layers,synthetic?undefined:tracks.isles);
  hover([]);
  state={...state,committed:Object.freeze({time:next.time,activeFeatures:next.territories})};
  record('commit-callback',{generation:next.generation,time:next.time,requestedTime:currentPlan?.requestedTime,epoch:next.epoch_id,parts:properties(next).length,policy});
  const retained = selectionForIntent(next);
  if(retained&&intent)intent.entityId=retained.entityId;
  updateSelection(retained,false);
  renderLayers();renderPresentation();renderLegend();
  if(evidenceOpen){if(selection)renderEvidence();else setEvidenceOpen(false);}
  el('scene-edition').textContent=next.edition;el('scene-epoch').textContent=next.epoch_id;el('scene-generation').textContent=String(next.generation);
  const world=currentPlan?.track.id.startsWith('world')??false;
  const observation=currentObservation();
  el('map-status').textContent=`${new Set(properties(next).map(p=>p.entity_id)).size} entities · source-attributed candidate · ${world?'world overview':'regional detail'} · modern neutral land`;
  el('atlas-title').textContent=world?'A world through time':'The British Isles';
  el('atlas-kind').textContent=synthetic?'SYNTHETIC RESEARCH FIXTURE':world?`WORLD OVERVIEW · ${observation?formatFixtureYear(observation.t_start):'COVERAGE GAP'}`:'ISLES DETAIL · RESEARCH CANDIDATE';
  el('atlas-subtitle').textContent=world&&observation ? `${observation.coverage.political} political · ${observation.coverage.cultural} cultural · ${observation.coverage.context} context · ${observation.coverage.review+observation.coverage.quarantine+observation.coverage.excluded} omitted of ${observation.coverage.source_features} source features` : 'Political associations & cultural approximations.';
  updateNavigation();
  for(const button of document.querySelectorAll<HTMLButtonElement>('.world-tools button'))button.disabled=false;
  el<HTMLButtonElement>('play-toggle').disabled=false;el<HTMLButtonElement>('reset-view').disabled=false;
  prefetchNeighbors(currentPlan?.displayedTime ?? next.time);writeURL(true);
  const committed=next.generation;
  requestAnimationFrame(()=>record('frame-opportunity',{generation:committed,currentGeneration:scene?.generation,evidence:'animation frame callback only; not physical presented-frame proof',canvasDrawAt:el('map').querySelector('canvas')?.dataset.lastDrawAt}));
}
function view() { return glMap?.getView() ?? flat?.getView(); }
function setView(v:{longitude:number;latitude:number;zoom:number}) { glMap?.setView(v);flat?.setView(v); }
function refreshRoute() {
  if(synthetic || !motion || restoringURL) return;
  const camera=view();if(!camera)return;
  const next=chooseTrack(camera,manifest.bounds!);
  if(next!==route){route=next;lastPrefetchedEpoch=undefined;updateNavigation();void motion.seekTime(state.requestedTime,{force:true});}
}
function writeURL(force=false) {
  if(restoringURL || !scene)return;
  const elapsed=performance.now()-lastURLWrite;
  if(!force&&elapsed<250){if(urlWriteTimer===undefined)urlWriteTimer=window.setTimeout(()=>{urlWriteTimer=undefined;writeURL(true);},250-elapsed);return;}
  if(urlWriteTimer!==undefined){clearTimeout(urlWriteTimer);urlWriteTimer=undefined;}
  lastURLWrite=performance.now();
  const hash=new URLSearchParams({time:String(state.requestedTime),policy,mode:intent?.mode??inspector.getMode()});
  if(intent?.entityId)hash.set('entity',intent.entityId);if(intent?.name)hash.set('name',intent.name);if(intent?.historyId)hash.set('history',intent.historyId);
  if(intent?.coordinates)hash.set('point',intent.coordinates.join(','));
  const camera=view();if(camera)hash.set('camera',[camera.longitude,camera.latitude,camera.zoom].map(n=>n.toFixed(5)).join(','));
  if(detailPlaceId)hash.set('place',detailPlaceId);
  if(details){hash.set('context',[details.frame.options.terrain,details.frame.options.water,details.frame.options.cities,details.frame.options.modernCities,details.frame.options.density].map(v=>v?'1':'0').join(''));hash.set('population',details.populationChoice);}
  if(teachingCategories.size)hash.set('teaching',[...teachingCategories].sort().join(','));if(selectedTeachingId)hash.set('teachingFeature',selectedTeachingId);if(!interpretiveBorders)hash.set('softBorders','0');
  hash.set('edition',scene.edition);if(overview)hash.set('overview',overview);
  history.replaceState(null,'',`${location.pathname}${location.search}#${hash}`);
}
/** Browser back/forward and a same-page permalink use the existing time engine. */
function restoreHistoryIntent(params:URLSearchParams) {
  const profile=getStateHistory(params.get('history')??'');
  if(intent&&profile&&profile.aliases.some(alias=>alias.name.toLocaleLowerCase('en')===intent!.name?.toLocaleLowerCase('en')))intent.historyId=profile.id;
}
async function restoreHash() {
  if(!motion)return;
  const serial=++restoreSerial, params=new URLSearchParams(location.hash.slice(1));
  const time=Number(params.get('time'));
  if(!params.has('time')||!Number.isSafeInteger(time)||time<minTime||time>maxTime)return;
  restoringURL=true;motion.setPlaying(false);
  try {
    restoreDetailOptions(params);
    teachingCategories.clear();for(const key of (params.get('teaching')??'').split(','))if(key in TEACHING_CATEGORIES)teachingCategories.add(key as TeachingCategory);
    selectedTeachingId=params.get('teachingFeature')??undefined;interpretiveBorders=params.get('softBorders')!=='0';syncTeachingControls();el<HTMLInputElement>('interpretive-borders').checked=interpretiveBorders;renderTeaching(true);
    // Legacy exact-mode links now use the single continuous atlas experience.
    const point=params.get('point')?.split(',').map(Number);
    const coordinates: [number,number]|null=point?.length===2&&point.every(Number.isFinite)&&Math.abs(point[0])<=180&&Math.abs(point[1])<=85?[point[0],point[1]]:null;
    intent=params.has('entity')||coordinates?{entityId:params.get('entity')?.slice(0,200),name:params.get('name')?.slice(0,200),coordinates,mode:params.get('mode')==='polity'?'polity':'place'}:null;
    restoreHistoryIntent(params);
    el('inspector').hidden=!intent;inspector.setMode(intent?.mode??'place');inspector.closeOverview();overview=null;
    const camera=params.get('camera')?.split(',').map(Number);
    if(camera?.length===3&&camera.every(Number.isFinite)&&Math.abs(camera[0])<=180&&Math.abs(camera[1])<=85&&camera[2]>=0&&camera[2]<=12)setView({longitude:camera[0],latitude:camera[1],zoom:camera[2]});
    route=synthetic?'isles':chooseTrack(view()!,manifest.bounds!);updateNavigation();
    const result=await motion.seekTime(time,{force:true});
    if(serial!==restoreSerial||result.status!=='committed')return;
    const requestedOverview=params.get('overview');
    if(requestedOverview&&inspector.getRecords().some(r=>r.id===requestedOverview&&r.entity_id===intent?.entityId&&currentPlan?.displayedTime!==null&&r.t_start<=currentPlan!.displayedTime!&&currentPlan!.displayedTime!<r.t_end)){overview=requestedOverview;inspector.openOverview(requestedOverview);}
  } finally {if(serial===restoreSerial){restoringURL=false;writeURL(true);}}
}
window.addEventListener('hashchange',()=>{void restoreHash().catch(error=>console.error('[Chronicle Explorer] permalink',error));},options);
function selectDossier(entityId:string,time:number) {
  detailPlaceId=null;
  el('inspector').hidden=false;
  motion?.setPlaying(false);intent={entityId,name:inspector.getRecords().find(r=>r.entity_id===entityId)?.title??entityId,coordinates:null,mode:'polity'};
  inspector.setMode('polity');setView({longitude:-4.5,latitude:54,zoom:4.3});route='isles';void motion?.seekTime(time,{force:true});
}
inspector=new DossierInspector(el('dated-inspector'),{onEvidence:()=>{renderEvidence();setEvidenceOpen(true);},onSelectDossier:selectDossier,onOpenOverview:id=>{overview=id;writeURL(true);},onReturnMap:()=>{overview=null;writeURL(true);},onModeChange:mode=>{
  if(intent){intent.mode=mode;if(mode==='polity'&&intent.coordinates&&scene){
    const ids=glMap?.hitsAtCoordinates(intent.coordinates)??flat?.hitsAtCoordinates(intent.coordinates)??[];
    const selected=resolvePick(ids.map(render_id=>({render_id,generation:scene!.generation})),scene);
    intent.entityId=selected?.entityId;intent.name=selected?scene.entities?.[selected.entityId]?.name??selected.entityId:undefined;
    updateSelection(selected);
  }}writeURL(true);
}});
polityCard=new PolityContextCard(el('polity-context'),{
  onEvidence:()=>{renderEvidence();setEvidenceOpen(true);},
  onDossier:()=>{el('study-drawer').hidden=false;inspector.setMode('polity');teachingStudies.openTab('states');renderTeaching(true);},
  onFocusTimeline:()=>{ruler?.focusSelection();},
  onNavigate:(time,entityId,name)=>{motion?.setPlaying(false);if(entityId){intent={entityId,name:name??entityId,coordinates:null,mode:'polity'};}void seekTime(time);}
});

el('map').addEventListener('camera-change',()=>{const camera=view();if(camera)el('camera-readout').textContent=`${camera.latitude.toFixed(1)}° · ${camera.longitude.toFixed(1)}° · z${camera.zoom.toFixed(1)}`;refreshRoute();writeURL();},options);
el('world-view').addEventListener('click',()=>{motion?.setPlaying(false);setView({longitude:5,latitude:20,zoom:0.55});route='world';updateNavigation();void motion?.seekTime(state.requestedTime,{force:true});},options);
el('isles-view').addEventListener('click',()=>{setView({longitude:-4.5,latitude:54,zoom:4.3});refreshRoute();},options);
for(const button of document.querySelectorAll<HTMLButtonElement>('[data-region]'))button.addEventListener('click',()=>{const target={americas:[-85,18],africa:[20,0],asia:[100,30]}[button.dataset.region!]!;setView({longitude:target[0],latitude:target[1],zoom:1.55});refreshRoute();},options);
el('play-toggle').addEventListener('click', toggle, options);
el('clear-selection').addEventListener('click', clearSelection, options);
el('studies-toggle').addEventListener('click',()=>{el('study-drawer').hidden=false;inspector.setMode('polity');renderCard();renderTeaching(true);},options);
el('reset-view').addEventListener('click', () => { setView({longitude:-4.5,latitude:54,zoom:4.3}); }, options);
window.addEventListener('resize',()=>{if(manifest)configureTimeWindow();},options);
el('year-slider').addEventListener('input', () => { const cursor = Number(el<HTMLInputElement>('year-slider').value); record('input', {time:Math.floor(cursor),cursor}); void motion?.scrub(cursor); }, options);
el('year-slider').addEventListener('pointerdown', event => { const input = event.currentTarget as HTMLInputElement; input.setPointerCapture(event.pointerId); motion?.setPlaying(false); }, options);
el('playback-mode').addEventListener('change', () => { motion?.setMode(el<HTMLSelectElement>('playback-mode').value as MotionMode); setSpeed(speed); }, options);
el('time-window').addEventListener('change', () => { timelineWindow = Number(el<HTMLSelectElement>('time-window').value); configureTimeWindow(); }, options);
function exactDate() {
  const time = parseNavigationDate(el<HTMLInputElement>('requested-date').value);
  if (time === null || time < minTime || time > maxTime) { el('date-help').textContent = `Use YYYY-MM-DD CE or BCE between ${formatNavigationDate(minTime)} and ${formatNavigationDate(maxTime)}.`; return; }
  el('date-help').textContent = 'Navigation dates use the proleptic Gregorian calendar. Source precision is unchanged.';
  void seekTime(time);
}
el('go-date').addEventListener('click', exactDate, options);
el('requested-date').addEventListener('keydown', event => { if (event.key === 'Enter') exactDate(); }, options);
for (const [id, direction] of [['previous-day', -1], ['next-day', 1]] as const) el(id).addEventListener('click', () => { void seekTime(Math.max(minTime, Math.min(maxTime, state.requestedTime + direction))); }, options);
el('requested-year').addEventListener('input', () => { const value = Number(el<HTMLInputElement>('requested-year').value); if (value !== 0) seekYear(value < 0 ? value + 1 : value); }, options);

for (const name of ['population'] as const) el(`${name}-toggle`).addEventListener('change', () => {
  const checked=el<HTMLInputElement>(`${name}-toggle`).checked;
  if(name==='population'&&!synthetic){details?.setOptions({density:checked});writeURL(true);return;}
  layers = { ...layers, [name]: checked }; if(!layers[name])renderLayers(); void motion?.seekTime(state.requestedTime,{force:true});
}, options);
for(const name of ['terrain','water'] as const)el(`${name}-toggle`).addEventListener('change',()=>{details?.setOptions({[name]:el<HTMLInputElement>(`${name}-toggle`).checked});writeURL(true);},options);
el('population-year').addEventListener('change',()=>{details?.setPopulationYear(el<HTMLSelectElement>('population-year').value);writeURL(true);},options);


function stepObservation(direction: number) { const available=availableObservations();const epochs = direction>0 ? available : [...available].reverse(); const next=epochs.find(e=>direction>0?e.t_start>state.requestedTime:e.t_start<state.requestedTime); if(next) void seekTime(next.t_start); }
function setSpeed(value: number) { speed=value; document.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.speed)===speed))); motion?.setRate(rates[speed-1]); motion?.setTourInterval([2400,1600,900,450,180][speed-1]); el('playback-rate').textContent = motion?.snapshot.mode === 'observation-tour' ? `${[2.4,1.6,.9,.45,.18][speed-1]} s / observation` : `${['1 day','30 days','1 year','10 years','100 years'][speed-1]} / second`; record('speed',{speed}); }
document.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach(b=>b.addEventListener('click',()=>setSpeed(Number(b.dataset.speed)),options));
document.addEventListener('keydown', event => {
  const target = event.target;
  const editing = target instanceof HTMLElement && (target.isContentEditable || !!target.closest('input, textarea, select, [role="textbox"]'));
  const interactive = target instanceof Element && !!target.closest('button, a[href], summary, [role="button"], [role="link"], [role="checkbox"], [role="switch"], [role="tab"], [role="menuitem"], [role="slider"], [role="spinbutton"], [role="combobox"], [role="listbox"], [role="treeitem"]');
  if(event.defaultPrevented || editing || event.altKey || event.ctrlKey || event.metaKey) return;
  if(event.code==='Escape') { clearSelection(); setEvidenceOpen(false); el('tools-drawer').hidden=true; el('debug-drawer').hidden=true; el('study-drawer').hidden=true; el('explore-drawer').hidden=true;el('tools-toggle').setAttribute('aria-expanded','false');el('debug-toggle').setAttribute('aria-expanded','false'); hover([]); }
  if(event.repeat) return;
  if(shouldHandleSpace(event, editing, interactive)) { event.preventDefault(); toggle(); }
  else if(event.code==='ArrowLeft' || event.code==='ArrowRight') { event.preventDefault(); if(manifest) stepObservation(event.code==='ArrowRight'?1:-1); }
  else if(/^[1-5]$/.test(event.key)) setSpeed(Number(event.key));
}, options);
document.addEventListener('visibilitychange', () => { if(document.hidden) motion?.suspend(); else motion?.resume(); }, options);

async function simulatedDelay() {
  if (!el<HTMLInputElement>('slow-delivery').checked) return false;
  // Deliberately finish obsolete requests to exercise the generation commit guard.
  await new Promise<void>(resolve => setTimeout(resolve, 500));
  return true;
}

try {
  const manifestURL=new URL(synthetic?'./alpha/fixture-manifest.json':'./alpha/historical-manifest.json',location.href).href;
  const worldURL=new URL('./integrated/world-manifest.json',location.href).href;
  const [alpha,world,globalCatalog]=await Promise.all([fetchAlphaManifest(manifestURL,lifetime.signal),fetchAlphaManifest(worldURL,lifetime.signal),synthetic?Promise.resolve(undefined):fetchGlobalCatalog(new URL('./global-history/catalog.json',location.href).href,lifetime.signal),synthetic?Promise.resolve():inspector.load()]);
  catalog=globalCatalog;
  alphaManifest=alpha;worldManifest=world;manifest=adaptAlphaManifest(alpha);configureAtlas();
  (document.querySelector('.world-tools') as HTMLElement).hidden=synthetic;el('studies-toggle').hidden=synthetic;
  const probe=document.createElement('canvas');
  const gl=new URL(location.href).searchParams.get('renderer')==='canvas'?null:probe.getContext('webgl2');
  const available=!!gl;
  el('gpu-diagnostics').textContent=JSON.stringify({userAgent:navigator.userAgent,webgl2Context:available,profile:available?'MapLibre actual canvas diagnostics required':'Canvas fallback',physicalPerformanceProfile:'NOT RUN in this session'},null,2);
  gl?.getExtension('WEBGL_lose_context')?.loseContext();
  if(available){glMap=new GLMap(el('map'),entities,pick,manifest.bounds,hover,undefined,inspectPoint);el('renderer-status').textContent='MapLibre · vector streaming';}
  else{flat=new CanvasMap(el('map'),entities,ids=>pick(ids.map(render_id=>({render_id,generation:scene?.generation??-1}))),manifest.bounds,ids=>hover(ids.map(render_id=>({render_id,generation:scene?.generation??-1}))),undefined,inspectPoint);el('renderer-status').textContent='Canvas 2D · source vectors';}
  if(!synthetic){void loadContextMetrics(lifetime.signal).then(v=>{contextMetrics=v;refreshTimelineEvents();renderCard();}).catch(error=>record('metrics-unavailable',{message:String(error)}));details=new DetailManager(renderDetail);restoreDetailOptions(restored);detailLoading=details.load(lifetime.signal);}
  if(flat)flat.setBaseGeography((await loadAlphaBase(world,worldURL,lifetime.signal)).features);
  tracks={isles:{id:'isles',manifest:alpha,loader:createAlphaLoader(alpha,manifestURL,!available,fetch,sceneCache)},world:{id:'world',manifest:world,loader:createAlphaLoader(world,worldURL,!available)}};
  if(catalog)catalogStore=new GlobalCatalogStore(catalog,!available,sceneCache);
  neutralWorldTrack={id:'world:uncovered',manifest:{...world,edition:catalog?.catalog_id??world.edition,epochs:[]},loader:async()=>{throw Error('No observation exists for this neutral scene.');}};
  resolver=new DisplayResolver(world.base_geography);
  const peopleManifest=await fetch(new URL('./people/manifest.json',location.href)).then(r=>{if(!r.ok)throw new Error('Population lookup manifest unavailable');return r.json();});
  const populationAsset=peopleManifest.datasets?.find((d:{edition:string})=>d.edition===manifest.edition);
  if(populationAsset)populationLookup=await loadPopulationLookup(new URL(populationAsset.url,new URL('./people/manifest.json',location.href)).href,populationAsset,lifetime.signal);
  delivery=new TemporalController(manifest,{
    onRequest(time,generation){deliveryError=null;state={...state,requestedTime:time};root.dataset.requestedGeneration=String(generation);record('request',{generation,time});},
    onPending:setPending,
    async prepare(next,signal){record('prepare',{generation:next.generation,time:next.time});const apply=glMap?await glMap.prepare(next,signal,()=>selectionForIntent(next)?.renderIds??[],pendingPlan?.layers):()=>flat!.setScene(next);record('ready',{generation:next.generation,time:next.time});return apply;},
    onCommit:commit,
    onError(error){deliveryError=`Could not load requested scene: ${error instanceof Error?error.message:String(error)}`;el('delivery-status').textContent=deliveryError;console.error('[Chronicle Explorer] delivery failed',error);},
  },tracks.isles.loader);
  const initialRaw=Number(restored.get('time'));const initial=restored.has('time')&&Number.isSafeInteger(initialRaw)&&initialRaw>=minTime&&initialRaw<=maxTime?initialRaw:synthetic?manifest.initial_time:yearDay(700);

  const camera=restored.get('camera')?.split(',').map(Number);
  if(camera?.length===3 && camera.every(Number.isFinite)&&Math.abs(camera[0])<=180&&Math.abs(camera[1])<=85&&camera[2]>=0&&camera[2]<=12)setView({longitude:camera[0],latitude:camera[1],zoom:camera[2]});
  else if(!synthetic)setView({longitude:32,latitude:32,zoom:3.2});
  route=synthetic?'isles':chooseTrack(view()!,manifest.bounds!);
  const point=restored.get('point')?.split(',').map(Number);
  if(restored.has('entity')||point)intent={entityId:restored.get('entity')?.slice(0,200),name:restored.get('name')?.slice(0,200),coordinates:point?.length===2&&point.every(Number.isFinite)&&Math.abs(point[0])<=180&&Math.abs(point[1])<=85?[point[0],point[1]]:null,mode:restored.get('mode')==='polity'?'polity':'place'};
  restoreHistoryIntent(restored);
  el('inspector').hidden=!intent;
  if(intent)inspector.setMode(intent.mode);
  motion=new TimeMotion({initialTime:initial,minTime,maxTime,changeTimes:[...manifest.epochs,...(catalog?.observations??[])].flatMap(e=>[e.t_start,e.t_end]),observationTimes:availableObservations().map(e=>e.t_start),daysPerSecond:rates[speed-1],tourIntervalMs:900,
    invalidatePending:()=>delivery?.invalidatePending(),
    tryAdvance(time){const target=resolveTarget(time);if(!scene||!currentPlan||target.id!==currentPlan.track.id)return false;const plan=resolver.resolve(currentPlan.track,time,policy,layers,synthetic?undefined:tracks.isles);if(plan.key!==currentPlan.key)return false;scene=resolver.advance(scene,plan);currentPlan=plan;glMap?.updatePresentation(scene);flat?.updatePresentation(scene);renderPresentation();return true;},
    async deliver(time){const target=resolveTarget(time);const result=await delivery!.seekView(time,async signal=>{await simulatedDelay();signal.throwIfAborted();const track=target.observation?await catalogStore!.track(target.observation,signal):target.track!;signal.throwIfAborted();const plan=resolver.resolve(track,time,policy,layers,synthetic?undefined:tracks.isles);pendingPlan=plan;locationRouteNote=target.note;return resolver.materialize(plan,signal);});record('delivery-outcome',{time,status:result.status});return result.status==='committed'?{status:'committed',scene:{time}}:result;},
    onChange:renderCursor,
  });
  ruler=mountHistoryRuler({host:el('history-ruler'),filtersHost:el('timeline-filters'),bounds:()=>({min:minTime,max:maxTime}),getSnapshot:()=>({cursorTime:motion?.snapshot.cursorTime??initial,ready:!!scene,pending:motion?.snapshot.pending}),seek:time=>{void motion?.scrub(time);},pause:()=>motion?.setPlaying(false)});
  if (new URL(location.href).searchParams.get('research') !== 'off') researchWorkspace = mountResearchWorkspace({
    workspace: document.querySelector<HTMLElement>('.workspace')!, toolbar: document.querySelector<HTMLElement>('.map-tools')!, map: el('map'),
    initialYear: yearOf(initial),
    seekYear: year => { motion?.setPlaying(false); return seekTime(yearDay(year)); },
    focus: (coordinates, zoom) => setView({ longitude: coordinates[0], latitude: coordinates[1], zoom }),
    project: coordinates => glMap?.projectCoordinates(coordinates) ?? flat?.projectCoordinates(coordinates) ?? null,
    spatial: { update: (data, year, selected) => { glMap?.setResearchOverlay(data, year, selected); flat?.setResearchOverlay(data, year, selected); }, fit: bounds => { glMap?.fitResearchBounds(bounds); flat?.fitResearchBounds(bounds); } },
    camera:()=>view(),buildIdentity:()=>buildInfo,
    diagnostics: () => ({...(glMap?.getDiagnostics() ?? flat?.getDiagnostics()),hostWork:hostWorkProfile.snapshot()}),
    ...((import.meta.env.DEV||new URL(location.href).searchParams.get('verify')==='1') ? {localVerification:createLocalVerification({
      motion:()=>motion,gl:()=>glMap,canvas:()=>el('map').querySelector<HTMLCanvasElement>('canvas'),signal:lifetime.signal,
      snapshot:()=>({motion:motion?.snapshot,renderer:glMap?.getDiagnostics()??flat?.getDiagnostics(),detail:details?.diagnostics(),hostWork:hostWorkProfile.snapshot(),
        scene:{time:scene?.time,generation:scene?.generation,requestedTime:state.requestedTime,representation:currentPlan?.representation,displayedTime:currentPlan?.displayedTime}}),
    })}:{}),
  });
  refreshTimelineEvents();
  frame=requestAnimationFrame(tick);await seekTime(initial);ruler.update();
  void detailLoading?.then(()=>renderDetailPlace());
  if(restored.has('overview')){el('study-drawer').hidden=false;overview=restored.get('overview');inspector.openOverview(overview!);writeURL(true);}
  void fetch('./build-info.json').then(r=>r.ok?r.json():null).then(info=>{if(info)buildInfo=info;}).catch(()=>{});
} catch(error){el('map-message').textContent=`Unable to start: ${error instanceof Error?error.message:String(error)}`;console.error(error);}

if (import.meta.hot) import.meta.hot.dispose(() => { researchWorkspace?.dispose();reducedMotion.dispose();lifetime.abort();if(urlWriteTimer!==undefined)clearTimeout(urlWriteTimer); motion?.dispose(); delivery?.dispose(); details?.destroy();ruler?.dispose();polityCard?.destroy(); if (frame !== undefined) cancelAnimationFrame(frame); flat?.destroy(); glMap?.destroy(); inspector.destroy();catalogStore?.dispose(); });

function setEvidenceOpen(open: boolean) {
  evidenceOpen = open && !!selection;
  el('evidence-drawer').hidden = !evidenceOpen;

  if (evidenceOpen) el('close-evidence').focus();
}
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text: string, className?: string) {
  const element = document.createElement(tag); element.textContent = text; if (className) element.className = className; return element;
}
function renderEvidence() {
  if (!scene || !selection) return;
  const box = el('evidence-content'); box.replaceChildren();
  const states = [...new Set(properties(scene).filter(p => p.entity_id === selection!.entityId).map(p => p.territory_state_id))];
  box.append(node('p', `${scene.entities?.[selection.entityId]?.name ?? selection.entityId} · ${formatFixtureYear(scene.time)}`, 'evidence-context'));
  for (const stateId of states) {
    const evidence = scene.evidence?.[stateId];
    if (!evidence) { box.append(node('p', 'No linked assertion is available for this state.')); continue; }
    const group = node('section', '', 'evidence-group');
    group.append(node('h3', evidence.source_title));
    const source = document.createElement('a'); source.textContent = 'Inspect source';
    try { const url = new URL(evidence.source_url, location.href); if (['http:','https:'].includes(url.protocol)) { source.href = url.href; source.target = '_blank'; source.rel = 'noopener noreferrer'; } } catch {}
    group.append(source, node('p', `Edition: ${evidence.source_edition}`), node('p', `Valid time: ${formatFixtureYear(evidence.valid_from)} to ${formatFixtureYear(evidence.valid_to)} (end exclusive). ${synthetic ? 'Authored interval.' : 'Nominal year observation; no exact beginning or end is asserted.'}`), node('p', `Recorded from: ${evidence.recorded_from}`), node('p', `Recorded to: ${evidence.recorded_to ?? 'open in this candidate edition'}`));
    if (evidence.valid_extent) {
      group.append(node('p', `Source precision: ${evidence.valid_extent.precision}. ${evidence.valid_extent.conversionNote}`), node('p', evidence.valid_extent.sourceText));
      const uncertainty = node('details', '', 'assertion-references'); uncertainty.append(node('summary', 'Full temporal uncertainty'));
      uncertainty.append(node('p', `Start: ${evidence.valid_extent.start.earliest} to ${evidence.valid_extent.start.latest}; end: ${evidence.valid_extent.end.earliest} to ${evidence.valid_extent.end.latest}. Integer days since 1970-01-01. Original calendar: ${evidence.valid_extent.originalCalendar}.`)); group.append(uncertainty);
    }
    const references = node('details', '', 'assertion-references'); references.append(node('summary', `${evidence.assertion_ids.length} assertion references`));
    const list = node('ul', ''); for (const id of evidence.assertion_ids) list.append(node('li', id)); references.append(list); group.append(references);
    group.append(node('h4', 'Methodology')); for (const text of evidence.methodology) group.append(node('p', text));
    group.append(node('h4', 'Precision & limitations')); for (const text of evidence.limitations) group.append(node('p',text === 'Population and migration data are unavailable.' ? 'This geometry source provides no demographics. Independently admitted observations are listed separately below.' : text));
    group.append(node('h4', 'Rights & attribution'), node('p', evidence.license), node('p', evidence.attribution)); box.append(group);
  }
  const footprint=metricsForScene(contextMetrics,scene,selection.entityId);
  if(footprint){const section=node('section','','evidence-group');section.append(node('h3',footprint.label),node('p',footprint.meaning),node('p',footprint.methodology),node('p',`Geometry SHA-256: ${footprint.geometryHash}`));box.append(section);}
  const demographic=populationLookup?.forScene(scene,selection.entityId,selection.territoryStateId);
  if(demographic) { const section=node('section','','evidence-group');section.append(node('h3','Population observation'),node('p',demographic.observationDateLabel),node('p',demographic.methodology));for(const note of demographic.notes)section.append(node('p',note)); const source=node('a',demographic.source.source_title);source.href=demographic.source.source_url;source.target='_blank';source.rel='noopener noreferrer';section.append(source,node('p',demographic.source.license),node('p',demographic.source.attribution));box.append(section); }
  box.dataset.generation = String(scene.generation); box.dataset.entity = selection.entityId;
}
function renderLegend() {
  if (!scene) return;
  const query=el<HTMLInputElement>('entity-search').value.trim().toLocaleLowerCase();
  el('entity-legend').hidden=!query;
  if(!query){el('entity-legend').replaceChildren();return;}
  const ids = [...new Set(properties(scene).map(p => p.entity_id))].filter(id=>!query||(scene!.entities?.[id]?.name??id).toLocaleLowerCase().includes(query));
  el('entity-legend').replaceChildren(...ids.slice(0,15).map(id => {
    const e = scene!.entities?.[id] ?? entities[id]; const button = node('button', ''); button.dataset.entity = id;
    const color = node('i',''); color.style.background = e?.color ?? '#b4c6bf'; button.append(color, document.createTextNode(e?.name ?? id));
    button.setAttribute('aria-pressed', String(selection?.entityId === id));
    button.addEventListener('click', () => { const chosen=selectEntity(id,scene!);if(chosen){pick([{render_id:chosen.renderId,generation:scene!.generation}]);el<HTMLInputElement>('entity-search').value='';renderLegend();} }, options); return button;
  }));
  if(query&&details)for(const place of details.search(query)){
    const button=node('button','');button.dataset.place=place.id;const dot=node('i','');dot.className=place.temporalMode==='modern-context'?'modern-place-dot':'ancient-place-dot';
    button.append(dot,node('span',`${place.title} · ${place.capital?.length?'capital':place.temporalMode==='historical-city'?'dated city':place.temporalMode==='modern-context'?'modern reference':'ancient place'} · ${place.coordinates[1].toFixed(1)}°, ${place.coordinates[0].toFixed(1)}°`));
    button.addEventListener('click',()=>selectDetailPlace(place),options);el('entity-legend').append(button);
  }
  if(query&&!el('entity-legend').childElementCount)el('entity-legend').append(node('p','No matching state or active place.'));
}
function configureAtlas() {
  const all=[...manifest.epochs,...(catalog?.observations??[])];
  minTime=Math.min(yearDay(-3699),...all.map(e=>e.t_start));maxTime=Math.max(yearDay(2026),...all.map(e=>e.t_end))-1;
  minYear = yearOf(minTime); maxYear = yearOf(maxTime);

  el('atlas-title').textContent = 'The British Isles';
  el('atlas-kind').textContent = synthetic ? 'SYNTHETIC RESEARCH FIXTURE' : 'BRITISH ISLES · RESEARCH CANDIDATE';
  el('atlas-subtitle').textContent = synthetic ? 'Territory, people and movement.' : 'Political associations & cultural approximations.';
  el('layer-kind').textContent = synthetic ? 'SYNTHETIC' : 'CANDIDATE';
  el('layer-controls').hidden = false; el('layer-unavailable').hidden = true;
  el<HTMLInputElement>('population-toggle').disabled = false;
  el('context-controls').hidden=synthetic;el('population-controls').hidden=synthetic;el('detail-key').hidden=synthetic;
  if(!synthetic) { const label=el('population-toggle').parentElement!.querySelector('small')!; label.textContent='ISIMIP / HYDE modeled grids · 1910, 1950, 2000, 2010'; }

  el('coverage-note').textContent = synthetic ? 'Discrete borders · no interpolation' : '31 political / cultural snapshots';

  el<HTMLInputElement>('requested-year').min = String(minYear <= 0 ? minYear - 1 : minYear); el<HTMLInputElement>('requested-year').max = String(maxYear);
  configureTimeWindow();
  const initialYear = yearOf(manifest.initial_time); el<HTMLInputElement>('year-slider').value = String(manifest.initial_time); el<HTMLInputElement>('requested-year').value = String(initialYear <= 0 ? initialYear - 1 : initialYear);
  const band = el('epoch-band');
  if (synthetic) band.replaceChildren(...manifest.epochs.map(epoch => { const button = node('button', `${formatFixtureYear(epoch.t_start)} – ${formatFixtureYear(epoch.t_end - 1)}`); button.dataset.epoch = epoch.epoch_id; button.addEventListener('click',()=>{ void seekTime(epoch.t_start); },options); return button; }));
  else {
    band.classList.add('historical-band');
    for (const [title,direction] of [['← Previous snapshot',-1],['Next snapshot →',1]] as const) { const button=node('button',title);button.addEventListener('click',()=>stepObservation(direction),options);band.append(button); }
    updateNavigation();
  }
}

el('close-evidence').addEventListener('click',()=>{setEvidenceOpen(false);},options);


for(const name of ['tools','debug']) el(`${name}-toggle`).addEventListener('click',()=>{const drawer=el(`${name}-drawer`);drawer.hidden=!drawer.hidden;el(`${name}-toggle`).setAttribute('aria-expanded',String(!drawer.hidden)); if(name==='debug') el('runtime-diagnostics').textContent=JSON.stringify({detail:details?.diagnostics(),motion:motion?.snapshot,recentEvents:trace,renderer:glMap?.getDiagnostics?.()??flat?.getDiagnostics?.()},null,2);},options);
el('entity-search').addEventListener('input',renderLegend,options);
el('reset-trace').addEventListener('click',()=>{trace.length=0;traceTotal=0;record('scenario-start',{scenario:el<HTMLInputElement>('receipt-scenario').value,camera:view(),cache:glMap?.getDiagnostics()??flat?.getDiagnostics()});},options);
el('export-receipt').addEventListener('click',()=>{
  const body={created_at:new Date().toISOString(),build:buildInfo,scenario:el<HTMLInputElement>('receipt-scenario').value,mode:motion?.snapshot.mode,display_policy:policy,artificial_delay_ms:el<HTMLInputElement>('slow-delivery').checked?500:0,viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},camera:view(),environment:JSON.parse(el('gpu-diagnostics').textContent||'{}'),profile:glMap?'MapLibre — classify actual canvas renderer':'Canvas fallback',scene:{edition:scene?.edition,recorded_at:currentPlan?.track.manifest.recorded_at,source:currentPlan?.track.manifest.source,display_observation:currentPlan?.political?{start:currentPlan.political.t_start,end_exclusive:currentPlan.political.t_end}:null,time:scene?.time,requestedTime:state.requestedTime,generation:scene?.generation,representation:currentPlan?.representation,geometry_included:false,reference_context_is_exact_history:false},selection:intent,motion:motion?.snapshot,renderer:glMap?.getDiagnostics()??flat?.getDiagnostics(),detail:details?.diagnostics(),detailPlace:detailPlaceId,timeline:ruler?.receipt(),delivery:{firstView:firstViewDelivery,current:alphaDeliveryMeasurements()},catalog:{id:catalog?.catalog_id,observations:catalog?.observations.length,activeObservation:currentObservation(),preferredRoute:route,routeNote:locationRouteNote,cache:catalogStore?.diagnostics()},trace:{total:traceTotal,retained:trace.length,dropped:traceTotal-trace.length,events:trace},frame_evidence:'Callback timestamps and animation-frame opportunities only. No physical scanout or hardware performance claim.'};
  el('receipt-json').textContent=JSON.stringify(body,null,2);el('receipt-preview').hidden=false;el<HTMLDetailsElement>('receipt-preview').open=true;
  const url=URL.createObjectURL(new Blob([JSON.stringify(body,null,2)],{type:'application/json'}));const a=node('a','');a.href=url;a.download='Chronicle-Integrated-interaction-receipt.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
},options);

function prefetchNeighbors(time: number) {
  if (!glMap || !currentPlan) return;
  const current = currentObservation();
  if(current&&catalogStore){
    if(lastPrefetchedEpoch===current.observation_id)return;lastPrefetchedEpoch=current.observation_id;
    void catalogStore.neighbors(current).then(async neighbors=>{
      if(lastPrefetchedEpoch!==current.observation_id)return;
      // Each recorded edition keeps its own range-cache identity.
      await glMap?.prefetchArchives(neighbors.flatMap(track=>track.manifest.epochs.map(e=>({archive:e.stream,edition:track.manifest.edition}))));
    }).catch(error=>record('prefetch-error',{message:String(error)}));return;
  }
  const alphaManifest=currentPlan.track.manifest;
  const epoch=alphaManifest.epochs.find(e=>e.t_start<=time&&time<e.t_end);
  const key=epoch?.epoch_id??'gap';if(key===lastPrefetchedEpoch)return;lastPrefetchedEpoch=key;
  const previous=[...alphaManifest.epochs].reverse().find(e=>e.t_end<=(epoch?.t_start??time));
  const next=alphaManifest.epochs.find(e=>e.t_start>=(epoch?.t_end??time));
  void glMap.prefetchNeighbors([previous?.stream,next?.stream].filter((v):v is NonNullable<typeof v>=>!!v),alphaManifest.edition).catch(error=>record('prefetch-error',{message:String(error)}));
}
