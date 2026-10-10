import { ResearchController, type WorkspaceSnapshot } from './workspace-controller.ts';
import { PREPARED_EXAMPLES } from './examples.ts';
import type { LocalVerificationActions } from '../local-verification.ts';
import { PREMODERN_ID, MODERN_ID } from './workspace-engine.ts';
import { defaultViews } from '../../research-semantic/workspace-contract.ts';
import { teachingSource, safeTeachingURL } from '../teaching-data.ts';
import { mountMechanismView, mountChronicleOmnibar, mountHudDrag, mountMechanismGraph } from '@chronicle/view-adapters';
import { WATT_DATASET_ID } from '../domains/watt-mechanism/engine.ts';
import { matchesCursor } from '@chronicle/view-adapters/hud-state';
import { researchOverlayFor, evidenceOverlayFor, type ResearchOverlay } from '@chronicle/view-adapters/spatial';
import { mountEvidenceView, mountEvidenceIntake } from '@chronicle/view-adapters/evidence';
import './research.css';
import './semantic-view.css';

type Host = {
  workspace: HTMLElement;
  toolbar: HTMLElement;
  map: HTMLElement;
  initialYear: number;
  seekYear: (year: number) => Promise<unknown> | void;
  focus: (coordinates: [number, number], zoom: number) => void;
  project: (coordinates: [number, number]) => [number, number] | null;
  diagnostics: () => unknown;
  camera?:()=>{longitude:number;latitude:number;zoom:number}|undefined;
  buildIdentity?:()=>unknown;
  localVerification?: LocalVerificationActions;
  spatial?: { update(data: ResearchOverlay | null, year: number, selectedId: string | null): void; fit(bounds: readonly [number, number, number, number]): void };
};
type Active = NonNullable<WorkspaceSnapshot['active']>;
type Observation = Active['bundle']['observations'][number];
type Entity = Active['bundle']['entities'][number];
type ViewDiagnostics = { resources: { domListeners: number; observers: number; subscriptions: number }; controller: ReturnType<ResearchController['getDiagnostics']>; nodes: { panel: boolean; overlay: boolean; toggle: boolean; markers: number } };
export type ResearchWorkspace = { updateCursor(year: number): void; dispose(): void; getDiagnostics(): ViewDiagnostics; runLifecycle?: (spec: unknown) => Promise<boolean> };
let lifecycleSequence = 0;
const SVG_NS = 'http://www.w3.org/2000/svg';
const COLORS = ['#136c80', '#a05b24', '#655ca0', '#2e7852', '#a24761'];
const MARKER_WIDTH = 170, MARKER_HEIGHT = 46;
const ownedResources = new WeakMap<AbortSignal, { domListeners: number; observers: number; subscriptions: number }>();
function trackListener(signal: AbortSignal) { const resources = ownedResources.get(signal); if (resources) resources.domListeners++; }
const number = new Intl.NumberFormat('en-US');
const yearLabel = (year: number) => year <= 0 ? `${1 - year} BCE` : `${year} CE`;
const valueLabel = (o: Observation) => o.value === null ? 'Not recorded' : typeof o.value==='number'?`${number.format(o.value)} persons`:'Editorial account summary';
const periodLabel=(o:Observation)=>o.time.startYear===o.time.endYear?yearLabel(o.time.startYear):`${yearLabel(o.time.startYear)}–${yearLabel(o.time.endYear)}`;
const analysisWindow=(active:Active)=>({start:active.spec.plan.scope.epoch[0],end:active.spec.plan.scope.epoch[1]});
const lastYear=(active:Active)=>Math.max(...active.bundle.observations.map(o=>o.time.endYear));
function element<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.textContent = text;
  if (className) node.className = className; return node;
}
function button(text: string, action: () => void, signal: AbortSignal, className?: string) {
  const node = element('button', text, className); node.type = 'button';
  trackListener(signal); node.addEventListener('click', action, { signal }); return node;
}
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string | number>, text?: string) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}
function datum(node: Element, name: string, value: string) { node.setAttribute(`data-research-${name}`, value); }
function paintYear(year: number, start: number, end: number) { return 48 + (year - start) / Math.max(1, end - start) * 354; }

/** Host-rendered prepared research views. No generated markup, executable expressions or external loaders. */
export function mountResearchWorkspace(host: Host, verificationChild = false): ResearchWorkspace {
  const namespace = verificationChild ? `research-lifecycle-${++lifecycleSequence}-` : '';
  const idFor = (id: string) => namespace + id;
  let disposed = false;
  const lifetime = new AbortController(), signal = lifetime.signal;
  const resources = { domListeners: 0, observers: 0, subscriptions: 0 }; ownedResources.set(signal, resources);
  signal.addEventListener('abort', () => { resources.domListeners = 0; }, { once: true });
  const controller = new ResearchController(host.initialYear);
  let current = controller.getSnapshot();
  let previousBundle: Active['bundle'] | null = null;
  let spatialBundle: Active['bundle'] | NonNullable<WorkspaceSnapshot['imported']>['bundle'] | null = null, spatialRevision = -1, spatialData: ResearchOverlay | null = null;
  let previousViews='';
  let previousEvidenceKey = '';
  let paintedSelection = '';
  let paintedObservation: string | null = null;
  const observationMarks = new Map<string, Element[]>();
  const observationRows = new Map<string, Element>();
  let paintedCursor = Number.NaN;
  let markerLayoutKey = '';
  let markerBounds: { width: number; height: number; blocked: { x: number; y: number; width: number; height: number }[] } | undefined;
  let paintedStatus = '';
  let open = false;
  let measured = false;
  const executionTimings: { example: string; path: string; elapsedMs: number; success: boolean }[] = [];
  const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  async function runSpecification(spec: unknown, fit = false) {
    const first = executionTimings.length === 0, start = performance.now();
    const success = await controller.run(spec); await frame();
    if (success && fit && current.active?.spec.views.some(view => view.type === 'map')) {
      const coordinates = current.active.bundle.entities.map(entity => entity.coordinates);
      if (coordinates.length) host.spatial?.fit([Math.min(...coordinates.map(point => point[0])), Math.min(...coordinates.map(point => point[1])), Math.max(...coordinates.map(point => point[0])), Math.max(...coordinates.map(point => point[1]))]);
    }
    executionTimings.push({ example: current.active?.spec.id ?? 'rejected', path: first ? 'first prepared execution including local dataset load' : 'loaded prepared execution', elapsedMs: performance.now() - start, success });
    return success;
  }
  const markerNodes = new Map<string, HTMLButtonElement>();
  const anchorNodes = new Map<string, HTMLSpanElement>(), stemNodes = new Map<string, HTMLSpanElement>();
  const toggle = element('button', 'Research'); toggle.type = 'button'; toggle.id = idFor('research-toggle');
  toggle.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-controls', idFor('research-workspace'));
  toggle.hidden = verificationChild;
  host.toolbar.insertBefore(toggle, host.toolbar.querySelector('#debug-toggle'));
  const panel = element('section', '', 'research-workspace'); panel.id = idFor('research-workspace'); panel.hidden = true;
  panel.setAttribute('aria-label', 'Research workspace');
  const heading = element('div', '', 'research-heading');
  const headingText = element('div'); headingText.append(element('p', 'CHRONICLE · RESEARCH', 'eyebrow'), element('h2', 'Evidence, in context'));
  const close = button('×', closePanel, signal, 'research-close'); close.setAttribute('aria-label', 'Close research workspace');
  const mapMode = button('Map', () => {
    const compact = panel.classList.toggle('research-map-mode'); mapMode.textContent = compact ? 'Research' : 'Map';
    mapMode.setAttribute('aria-pressed', String(compact)); layoutMarkers();
  }, signal, 'research-map-mode-toggle');
  mapMode.setAttribute('aria-label', 'Collapse research panel to see the map'); mapMode.setAttribute('aria-pressed', 'false');
  const graphToggle = button('Graph', () => graphView?.show(), signal, 'research-graph-toggle'); graphToggle.hidden = true; graphToggle.setAttribute('aria-label', 'Open mechanism relationship graph');
  heading.append(headingText, graphToggle, mapMode, close);
  const mode = element('p', 'Prepared example — planner not enabled', 'research-mode');
  const questionLabel = element('label', 'Research question', 'research-question-label'); questionLabel.htmlFor = idFor('research-question');
  const question = element('textarea'); question.id = idFor('research-question'); question.rows = 2; question.maxLength = 1000;
  question.placeholder = 'Choose a prepared question below';
  const ask = button('Open prepared question', () => {
    const text = question.value.trim();
    const spec = PREPARED_EXAMPLES.find(candidate => candidate.intent.question === text);
    if (!spec) { void controller.requestProposal(text).then(result=>{if(signal.aborted)return;inputStatus.textContent=result.status==='error'&&result.code==='PROVIDER_UNAVAILABLE'?'The natural-language planner is unavailable. No question or source data was sent; your current workspace is unchanged.':'No proposal was activated.';inputStatus.hidden=false;omnibar?.setStatus(inputStatus.textContent);});return; }
    inputStatus.hidden = true; void runSpecification(spec);
  }, signal);
  const examples = element('div', '', 'research-examples');
  for (const spec of PREPARED_EXAMPLES) {
    const item = button(spec.title, () => { question.value = spec.intent.question; inputStatus.hidden = true; void runSpecification(spec); }, signal);
    item.dataset.exampleId = spec.id; examples.append(item);
  }
  examples.append(button('Premodern exchange accounts',()=>{inputStatus.hidden=true;void controller.openPilot(PREMODERN_ID);},signal));
  const watt=button('Watt separate-condenser mechanism',()=>{inputStatus.hidden=true;void controller.openMechanism(WATT_DATASET_ID);},signal);watt.dataset.exampleId=WATT_DATASET_ID;examples.append(watt);
  const inputStatus = element('p', '', 'research-input-status'); inputStatus.setAttribute('role', 'status'); inputStatus.hidden = true;
  const querySection = element('details', '', 'research-query'); querySection.open = true;
  querySection.append(element('summary', 'Choose or edit prepared question'), questionLabel, question, ask, examples, inputStatus);
  const status = element('p', '', 'research-status'); status.id = idFor('research-status'); status.setAttribute('role', 'status');
  const hudCursor = element('p', '', 'hud-cursor-context');
  const cursorFilter = button('Filter table to cursor', () => { const enabled = panel.classList.toggle('hud-follow-cursor'); cursorFilter.setAttribute('aria-pressed', String(enabled)); cursorFilter.textContent = enabled ? 'Show full analysis table' : 'Filter table to cursor'; }, signal, 'hud-cursor-filter'); cursorFilter.setAttribute('aria-pressed', 'false');
  const body = element('div', '', 'research-result');
  const title = element('h3');
  const scope = element('p', '', 'research-scope');
  const summary = element('div', '', 'research-summary');
  const caveats = element('div', '', 'research-caveats');
  const definitions = element('details', '', 'research-definitions'); definitions.append(element('summary', 'Definitions & limits'), caveats);
  const caution = element('p', 'Source estimates · changing urban extents · no inferred growth', 'research-short-caveat');
  const focus = button('Focus study area', () => {
    const entities = current.active?.bundle.entities;
    if (!entities?.length) return;
    const longitude = entities.reduce((sum, entity) => sum + entity.coordinates[0], 0) / entities.length;
    const latitude = entities.reduce((sum, entity) => sum + entity.coordinates[1], 0) / entities.length;
    const zoom = current.active?.spec.plan.scope.indicatorId==='trade-node-description'?1.8:4.2;
    host.focus([longitude, latitude], zoom);
    if (host.map.clientWidth > 760 && !panel.classList.contains('research-map-mode')) {
      const mapBox = host.map.getBoundingClientRect(), panelBox = panel.getBoundingClientRect();
      const visibleLeft = Math.max(0, panelBox.right - mapBox.left + 20), desiredX = (visibleLeft + host.map.clientWidth - 25) / 2;
      const point = host.project([longitude, latitude]), oneDegree = host.project([longitude + 1, latitude]);
      if (point && oneDegree && Math.abs(oneDegree[0] - point[0]) > 0.01) {
        // Offset the camera using the adapter's actual projection. Source coordinates stay unchanged.
        const centreLongitude = longitude + (point[0] - desiredX) / (oneDegree[0] - point[0]);
        host.focus([Math.max(-180, Math.min(180, centreLongitude)), latitude], zoom);
      }
    }
  }, signal);
  const latest = button('Show latest observation year', () => { if (current.active) void host.seekYear(lastYear(current.active)); }, signal);
  const mapActions = element('div', '', 'research-map-actions'); mapActions.append(focus, latest);
  const selectedSource = button('Select an observation to inspect its source', () => evidence.querySelector('h4')?.scrollIntoView({ block: 'start' }), signal, 'research-selected-source'); selectedSource.disabled = true;
  const cursorNote = element('p', '', 'research-cursor-note'); cursorNote.id = idFor('research-cursor-note');
  const chart = element('section', '', 'research-chart'); chart.setAttribute('aria-label', 'Population observations chart');
  const tableSection = element('details', '', 'research-table-section');
  tableSection.append(element('summary', 'Read the observation table'));
  const tableWrap = element('div', '', 'research-table-scroll'); tableWrap.tabIndex = 0;
  tableWrap.setAttribute('aria-label', 'Scrollable observation table');
  tableSection.append(tableWrap);
  const evidence = element('section', '', 'research-evidence'); evidence.id = idFor('research-evidence');
  evidence.setAttribute('aria-label', 'Selected observation evidence');
  body.append(title, scope, summary, caution, definitions, mapActions, cursorNote, selectedSource, chart, tableSection, evidence);
  // The non-map domain shares this store's typed selection actions, revision barrier, replay controls and panel; it never touches the map.
  const mechanismBody = element('div');
  const mechanismView = mountMechanismView(mechanismBody, (rowId, claimId, origin) => { controller.dispatch({ type: 'select', entityId: rowId, observationId: claimId, origin, revision: current.revision }); }, signal); trackListener(signal);

  const replay = element('details', '', 'research-replay'); replay.append(element('summary', 'Save or reopen this research'));
  replay.append(element('p', 'Replay pins the specification, edition and source hashes. It includes references, not source documents or model credentials.'));
  const exportButton = button('Save replay JSON', () => {
    try {
      const text = controller.exportManifest(); replayInput.value = text;
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const anchor = element('a'); anchor.href = url; anchor.download = 'Chronicle-Research-Replay.json'; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      replayStatus.textContent = 'Pinned replay is ready. The same JSON is available below.';
    } catch (error) { replayStatus.textContent = error instanceof Error ? error.message : 'No result is ready to save.'; }
  }, signal);
  const replayLabel = element('label', 'Pinned replay JSON'); replayLabel.htmlFor = idFor('research-replay-json');
  const replayInput = element('textarea'); replayInput.id = idFor('research-replay-json'); replayInput.rows = 4; replayInput.maxLength = 1_048_576;
  let replayReadGeneration=0;
  const replayFile = element('input'); replayFile.type = 'file'; replayFile.accept = '.json,application/json'; replayFile.setAttribute('aria-label', 'Choose a saved research replay');
  trackListener(signal); replayFile.addEventListener('change', async () => {
    const file = replayFile.files?.[0]; if (!file) return;const generation=++replayReadGeneration;
    if (file.size > 1_048_576) { replayStatus.textContent = 'Replay is too large. Maximum file size is 1 MiB.'; return; }
    const text=await file.text();if(signal.aborted||generation!==replayReadGeneration)return;replayInput.value=text; replayStatus.textContent = 'File read. Select Reopen pinned result to validate it.';
  }, { signal });
  const reopen = button('Reopen pinned result', () => {
    let input: unknown;
    try { if (new TextEncoder().encode(replayInput.value).length > 1_048_576) throw new Error('Replay exceeds the 1 MiB limit.'); input = JSON.parse(replayInput.value); }
    catch { replayStatus.textContent = 'Replay must be valid JSON within the 1 MiB limit. The current result is unchanged.'; return; }
    void controller.replay(input).then(ok => { if(ok)void host.seekYear(current.cursorYear);replayStatus.textContent = ok ? 'Reopened against matching local source records.' : 'Replay was rejected. The previous valid result is retained.'; });
  }, signal);
  const replayStatus = element('p', '', 'research-replay-status'); replayStatus.setAttribute('role', 'status');
  replay.append(exportButton, replayLabel, replayInput, replayFile, reopen, replayStatus);
  const refine=element('form','','semantic-refine');
  const place=element('select');place.setAttribute('aria-label','Study place');
  const from=element('input');from.type='number';from.step='1';from.required=true;from.setAttribute('aria-label','Study start year');
  const to=element('input');to.type='number';to.step='1';to.required=true;to.setAttribute('aria-label','Study end year');
  for(const [label,input] of [['Place',place],['From year',from],['To year',to]] as const){const field=element('label',label);field.append(input);refine.append(field);}
  const narrow=element('button','Narrow study');narrow.type='submit';
  const reset=button('Reset pilot',()=>{if(current.active)void controller.openPilot(current.active.spec.plan.scope.datasetId);},signal);
  refine.append(narrow,reset,element('p','Narrowing preserves this study’s scope. Reset starts a new root. Dates use 0 = 1 BCE.','research-chart-note'));
  trackListener(signal);refine.addEventListener('submit',event=>{event.preventDefault();if(!current.active)return;void controller.refine(place.value?[place.value]:current.active.spec.plan.scope.entityIds,[from.valueAsNumber,to.valueAsNumber]);},{signal});
  const arrangement=element('select');arrangement.setAttribute('aria-label','Workspace views');
  for(const [value,label] of [['linked','Map, chart, table and evidence'],['table','Table and evidence']]){const option=element('option',label);option.value=value;arrangement.append(option);}
  trackListener(signal);arrangement.addEventListener('change',()=>{if(!current.active)return;const views=defaultViews(current.active.spec.plan.scope.indicatorId==='trade-node-description');void controller.setViews(arrangement.value==='table'?views.filter(v=>v.type==='table'||v.type==='evidence'):views);},{signal});
  const layoutLabel=element('label','Workspace views');layoutLabel.append(arrangement);
  body.prepend(layoutLabel,refine);
  const importedBody = element('div'), intakeHost = element('div');
  const importedView = mountEvidenceView(importedBody, (entityId, observationId) => { controller.dispatch({ type: 'select', entityId, observationId, origin: 'imported-evidence', revision: current.revision }); }, signal, year => { void host.seekYear(year); });
  panel.append(heading,mode,querySection,intakeHost,status,hudCursor,cursorFilter,body,mechanismBody,importedBody,replay);
  host.workspace.append(panel);
  const fitImported = () => {
    if (signal.aborted || !current.imported) return;
    const points = current.imported.bundle.records.flatMap(record => record.geometry?.type === 'Point' ? [record.geometry.coordinates] : record.geometry?.coordinates.flat() ?? []);
    if (points.length) host.spatial?.fit([Math.min(...points.map(point => point[0])), Math.min(...points.map(point => point[1])), Math.max(...points.map(point => point[0])), Math.max(...points.map(point => point[1]))]);
  };
  const intake = mountEvidenceIntake(intakeHost, verificationChild ? panel : host.workspace, {
    async importFile(file) { openPanel(false); const ok = await controller.importEvidence(file); if (ok) fitImported(); return ok; },
    async search(question, sourceId, allowRemote) { openPanel(false); const ok = await controller.queryEvidence({ question, sourceIds: [sourceId], bounds: null, temporalRange: null }, allowRemote); if (ok) fitImported(); return ok; },
    clear() { controller.clearImportedEvidence(); },
  }, signal);
  resources.domListeners += importedView.listeners + intake.listeners;
  const overlay = element('div', '', 'research-map-overlay'); overlay.setAttribute('aria-label', 'Research observation locations');
  overlay.id = idFor('research-map-overlay'); overlay.hidden = true; host.map.append(overlay);
  const graphView = verificationChild ? null : mountMechanismGraph(host.workspace, (entityId, observationId) => { controller.dispatch({ type: 'select', entityId, observationId, origin: 'mechanism-graph', revision: current.revision }); }, signal);
  const omnibar = verificationChild ? null : mountChronicleOmnibar(host.workspace, [
    ...PREPARED_EXAMPLES.map(spec => ({ id: spec.id, title: spec.title, question: spec.intent.question })),
    { id: PREMODERN_ID, title: 'Premodern exchange accounts', question: 'Premodern exchange accounts' },
    { id: WATT_DATASET_ID, title: 'Watt separate-condenser mechanism', question: 'Watt separate-condenser mechanism' },
    { id: 'evidence-intake', title: 'Import or retrieve evidence', question: 'Import or retrieve evidence' },
  ], (text, choice) => {
    openPanel(false); question.value = text; inputStatus.hidden = true;
    if (choice === 'evidence-intake') { intake.show(); return; }
    if (choice === WATT_DATASET_ID || text === 'Watt separate-condenser mechanism') { void controller.openMechanism(WATT_DATASET_ID); return; }
    if (choice === PREMODERN_ID || text === 'Premodern exchange accounts') { void controller.openPilot(PREMODERN_ID); return; }
    const spec = PREPARED_EXAMPLES.find(item => item.id === choice || item.intent.question === text || item.title === text);
    if (spec) void runSpecification(spec, true);
    else if (current.imported?.intent.sourceIds.every(id => id === 'local-files')) void controller.queryEvidence({ ...current.imported.intent, question: text });
    else ask.click();
  }, signal);
  if (!verificationChild) resources.domListeners += mountHudDrag(panel, heading, host.workspace, () => { markerBounds = undefined; layoutMarkers(); }, signal).listeners + (graphView?.listeners ?? 0) + (omnibar?.listeners ?? 0);

  function closePanel() {
    replayReadGeneration++;open = false; panel.hidden = true; overlay.hidden = true; toggle.setAttribute('aria-expanded', 'false');
    host.workspace.classList.remove('research-open'); controller.close(); markerNodes.clear(); overlay.replaceChildren();
    previousBundle = null; previousEvidenceKey = ''; markerLayoutKey = ''; markerBounds = undefined; anchorNodes.clear(); stemNodes.clear(); toggle.focus();
  }
  function openPanel(loadDefault = true) {
    open = true; panel.hidden = false; panel.scrollTop = 0; overlay.hidden = false; toggle.setAttribute('aria-expanded', 'true');
    host.workspace.classList.add('research-open');
    panel.classList.remove('research-map-mode'); mapMode.textContent = 'Map'; mapMode.setAttribute('aria-pressed', 'false');
    if (loadDefault && !current.active && !current.mechanism && !current.imported && current.status !== 'loading') { question.value = PREPARED_EXAMPLES[0].intent.question; void runSpecification(PREPARED_EXAMPLES[0]); }
  }
  trackListener(signal); toggle.addEventListener('click', () => {
    if (open) { closePanel(); return; }
    openPanel(); question.focus();
  }, { signal });
  trackListener(signal); host.map.addEventListener('research-map-select', event => {
    if (!(event instanceof CustomEvent)) return;
    const value = event.detail;
    if (value && typeof value.entityId === 'string' && typeof value.observationId === 'string' && value.revision === current.revision) controller.dispatch({ type: 'select', entityId: value.entityId, observationId: value.observationId, origin: 'native-research-layer', revision: value.revision });
  }, { signal });
  trackListener(signal); panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closePanel(); } }, { signal });

  function select(observationId: string, origin: string) {
    const observation = current.active?.bundle.observations.find(row => row.id === observationId);
    if (!observation) return;
    controller.dispatch({ type: 'select', entityId: observation.entityId, observationId: observation.id, origin, revision: current.revision });
    if (origin === 'map') { panel.classList.remove('research-map-mode'); mapMode.textContent = 'Map'; mapMode.setAttribute('aria-pressed', 'false'); layoutMarkers(); evidence.scrollIntoView({ block: 'nearest' }); }
  }
  trackListener(signal); evidence.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-show-observation-year]') : null;
    if (!target) return;
    const year = Number(target.dataset.showObservationYear);
    if (current.selectedEvidence?.observation.time.startYear === year) host.seekYear(year);
  }, { signal });
  for (const [target, origin] of [[chart, 'chart'], [tableWrap, 'table'], [overlay, 'map']] as const) {
    trackListener(signal); target.addEventListener('click', event => {
      const mark = event.target instanceof Element ? event.target.closest('[data-research-observation]') : null;
      if (!mark || !target.contains(mark)) return;
      event.stopPropagation(); select(mark.getAttribute('data-research-observation')!, origin);
    }, { signal });
    trackListener(signal); target.addEventListener('keydown', event => {
      if (!(event instanceof KeyboardEvent) || !(event.target instanceof SVGElement) || !['Enter', ' '].includes(event.key)) return;
      const mark = event.target.closest('[data-research-observation]'); if (!mark) return;
      event.preventDefault(); event.stopPropagation(); select(mark.getAttribute('data-research-observation')!, origin);
    }, { signal });
  }

  function renderRows(active: Active) {
    // Build detached replacements before the synchronous installation below.
    const nextSummary = element('div'), nextCaveats = element('div'), nextChart = element('div');
    const types = new Set(active.spec.views.map(view => view.type));
    const window = analysisWindow(active);

    for (const [count, label] of [[active.bundle.observations.length, 'source observations'], [active.bundle.entities.length, 'settlements']] as const) {
      const cell = element('div'); cell.append(element('strong', number.format(count)), element('span', label)); nextSummary.append(cell);
    }
    nextCaveats.append(element('p', 'Separate source records. No arithmetic, interpolated history or automatic joins are inferred.'));
    for (const warning of active.bundle.warnings) nextCaveats.append(element('p', warning));
    nextChart.append(element('h4', 'Population observations'), element('p', 'Mid-year estimates · rounded persons from source thousands. Separate vertical scales; gaps remain unmeasured.', 'research-chart-note'));
    if(types.has('scatter')) for (const [index, entity] of active.bundle.entities.entries()) {
      const rows = active.bundle.observations.filter(row => row.entityId === entity.id && typeof row.value === 'number');
      const facet = element('div', '', 'research-facet');
      facet.append(element('h5', entity.label));
      const max = Math.max(1, ...rows.map(row => typeof row.value==='number'?row.value:0));
      const image = svg('svg', { viewBox: '0 0 430 158', role: 'group', 'aria-label': `${entity.label}: population observations in persons; separate vertical scale` });
      const x = (year: number) => paintYear(year, window.start, window.end);
      const y = (value: number) => 110 - value / max * 76;
      for (const fraction of [0, 0.5, 1]) {
        const value = max * fraction, position = y(value);
        image.append(svg('line', { x1: 48, y1: position, x2: 402, y2: position, class: 'research-grid-line' }));
        image.append(svg('text', { x: 43, y: position + 3, 'text-anchor': 'end', class: 'research-axis-label' }, new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value)));
      }
      image.append(svg('text', { x: 48, y: 20, class: 'research-axis-label' }, 'persons'));
      for (const year of [...new Set([window.start, Math.round((window.start + window.end) / 2), window.end])]) {
        image.append(svg('text', { x: x(year), y: 136, 'text-anchor': 'middle', class: 'research-axis-label' }, yearLabel(year)));
      }
      const cursor = svg('line', { x1: 48, y1: 28, x2: 48, y2: 116, class: 'research-chart-cursor' }); cursor.dataset.researchCursor = 'true'; image.append(cursor);
      for (const row of rows) {
        const point = svg('circle', { cx: x(row.time.startYear), cy: y(typeof row.value==='number'?row.value:0), r: 5, fill: COLORS[index % COLORS.length], role: 'button', tabindex: 0,
          'aria-label': `${entity.label}, ${periodLabel(row)}, ${valueLabel(row)}. Inspect source.`, class: 'research-chart-point' });
        datum(point, 'observation', row.id); datum(point, 'entity', row.entityId);
        point.append(svg('title', {}, `${entity.label} · ${periodLabel(row)} · ${valueLabel(row)}`)); image.append(point);
      }
      facet.append(image); nextChart.append(facet);
    }
    if(types.has('interval')){
      nextChart.replaceChildren(element('h4','Account event windows'),element('p','Intervals describe the discussed period, not continuous activity. Composition dates appear separately in evidence.','research-chart-note'));
      const image=svg('svg',{viewBox:`0 0 430 ${active.bundle.observations.length*42+45}`,role:'group','aria-label':'Qualitative event intervals'});
      active.bundle.observations.forEach((row,index)=>{
        const label=active.bundle.entities.find(e=>e.id===row.entityId)?.label??row.entityId,y=22+index*42;
        image.append(svg('text',{x:48,y:y-7,class:'research-axis-label'},`${label} · ${periodLabel(row)}`));
        const lo=Math.max(window.start,row.time.startYear),hi=Math.min(window.end,row.time.endYear);
        const mark=svg('rect',{x:paintYear(lo,window.start,window.end),y,width:Math.max(7,paintYear(hi,window.start,window.end)-paintYear(lo,window.start,window.end)),height:12,rx:3,fill:COLORS[index%COLORS.length],role:'button',tabindex:0,'aria-label':`${label}, ${periodLabel(row)}. Inspect account.`,class:'research-chart-point'});
        datum(mark,'observation',row.id);datum(mark,'entity',row.entityId);image.append(mark);
      });
      const cursor=svg('line',{x1:48,x2:48,y1:10,y2:active.bundle.observations.length*42+15,class:'research-chart-cursor'});cursor.dataset.researchCursor='true';image.append(cursor);
      for(const year of [window.start,window.end])image.append(svg('text',{x:paintYear(year,window.start,window.end),y:active.bundle.observations.length*42+35,'text-anchor':'middle',class:'research-axis-label'},yearLabel(year)));
      nextChart.append(image);
    }
    const table = element('table'); table.append(element('caption', 'All source observations in the analysis window. Select a row to inspect its record.'));
    const head = element('thead'), header = element('tr');
    for (const label of ['Place', 'Event support', 'Observation', 'Evidence']) header.append(element('th', label));
    head.append(header); table.append(head);
    const rows = element('tbody');
    for (const row of active.bundle.observations) {
      const name = active.bundle.entities.find(entity => entity.id === row.entityId)?.label ?? row.entityId;
      const tr = element('tr'); datum(tr, 'row', row.id);
      const cell = element('td'), inspect = element('button', name); inspect.type = 'button'; datum(inspect, 'observation', row.id); datum(inspect, 'entity', row.entityId);
      inspect.setAttribute('aria-label', `Inspect ${name}, ${periodLabel(row)}, ${valueLabel(row)}`); cell.append(inspect);
      tr.append(cell, element('td', periodLabel(row)), element('td', valueLabel(row)), element('td', row.epistemicStatus)); rows.append(tr);
    }
    table.append(rows);
    title.textContent = active.spec.title;
    scope.textContent = `${yearLabel(window.start)}–${yearLabel(window.end)} · analysis window`;
    caution.textContent=active.spec.plan.scope.indicatorId==='population'?'Source estimates · changing urban extents · no inferred growth':'Editorial account summaries · uncertain place references · no inferred routes';
    place.replaceChildren();const all=element('option','All current places');all.value='';place.append(all);
    for(const entity of active.fixture.entities.filter(e=>active.spec.plan.scope.entityIds.includes(e.id))){const option=element('option',entity.label);option.value=entity.id;place.append(option);}
    from.value=String(window.start);to.value=String(window.end);for(const input of [from,to]){input.min=String(window.start);input.max=String(window.end);}
    arrangement.value=types.has('map')?'linked':'table';
    latest.textContent = `Show ${yearLabel(lastYear(active))}`;
    summary.hidden = !types.has('summary'); chart.hidden = !types.has('scatter')&&!types.has('interval'); tableSection.hidden = !types.has('table');
    evidence.hidden = !types.has('evidence'); mapActions.hidden = !types.has('map');selectedSource.hidden=!types.has('evidence');
    summary.replaceChildren(...nextSummary.childNodes); caveats.replaceChildren(...nextCaveats.childNodes);
    chart.replaceChildren(...nextChart.childNodes); tableWrap.replaceChildren(table);
    observationMarks.clear(); observationRows.clear(); paintedObservation = null;
    for (const mark of panel.querySelectorAll('[data-research-observation]')) {
      const id = mark.getAttribute('data-research-observation')!;
      const marks = observationMarks.get(id) ?? []; marks.push(mark); observationMarks.set(id, marks);
      mark.setAttribute('aria-pressed', 'false'); mark.setAttribute('data-selected', 'false');
    }
    for (const row of tableWrap.querySelectorAll('[data-research-row]')) {
      observationRows.set(row.getAttribute('data-research-row')!, row); row.setAttribute('data-selected', 'false');
    }
    querySection.open = false; panel.scrollTop = 0;
    previousEvidenceKey = ''; paintedSelection = ''; paintedCursor = Number.NaN;
  }

  function currentMarkerObservation(entity: Entity): Observation | undefined {
    const rows = current.active?.bundle.observations.filter(row => row.entityId === entity.id) ?? [];
    // A deliberate selection remains visible as its own dated observation, never an assertion at cursor time.
    const selected = current.selection?.entityId === entity.id ? rows.find(row => row.id === current.selection!.observationId) : undefined;
    return selected ?? rows.filter(row => row.time.startYear <= current.cursorYear).sort((a, b) => b.time.startYear - a.time.startYear)[0] ?? (current.active?.spec.plan.scope.indicatorId==='trade-node-description'?rows[0]:undefined);
  }

  function layoutMarkers() {
    const active = current.active;
    if (disposed || !open || !active || !active.spec.views.some(view => view.type === 'map')) { overlay.replaceChildren(); markerNodes.clear(); anchorNodes.clear(); stemNodes.clear(); markerLayoutKey = ''; return; }
    type Box = { x: number; y: number; width: number; height: number };
    const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
    const placed: Box[] = [];
    if (!markerBounds) {
      const blocked: Box[] = [], mapBox = host.map.getBoundingClientRect();
      const surfaces = [panel, ...host.workspace.querySelectorAll<HTMLElement>('.chronicle-omnibar,.chronicle-graph-card,.map-tools')];
      for (const surface of surfaces) if (!surface.hidden && surface.getClientRects().length) { const b = surface.getBoundingClientRect(); blocked.push({ x: b.left - mapBox.left - 8, y: b.top - mapBox.top - 8, width: b.width + 16, height: b.height + 16 }); }
      markerBounds = { width: host.map.clientWidth, height: host.map.clientHeight, blocked };
    }
    const { width, height, blocked } = markerBounds;
    const retained = new Set<string>();
    const ordered = active.bundle.entities.map((entity, index) => ({ entity, index })).sort((a, b) => Number(b.entity.id === current.selection?.entityId) - Number(a.entity.id === current.selection?.entityId));
    const projected = ordered.map(item => ({ ...item, observation: currentMarkerObservation(item.entity), point: host.project(item.entity.coordinates) }));
    const nextLayoutKey = JSON.stringify([current.revision, current.selection, width, height, blocked, projected.map(item => [item.entity.id, item.observation?.id, item.observation ? [item.observation.time.startYear<=current.cursorYear,item.observation.time.endYear>=current.cursorYear] : null, item.point])]);
    if (markerLayoutKey === nextLayoutKey) return;
    markerLayoutKey = nextLayoutKey;
    const visibleMarkers: { point: [number, number]; marker: HTMLButtonElement; anchor: HTMLSpanElement; stem: HTMLSpanElement }[] = [];
    for (const { entity, index, observation, point } of projected) {
      if (!observation) continue;
      retained.add(entity.id);
      let marker = markerNodes.get(entity.id), anchor = anchorNodes.get(entity.id), stem = stemNodes.get(entity.id);
      if (!marker || !anchor || !stem) {
        marker = element('button', '', 'research-map-marker'); marker.type = 'button'; datum(marker, 'marker', entity.id);
        marker.style.width = `${MARKER_WIDTH}px`; marker.style.height = `${MARKER_HEIGHT}px`;
        anchor = element('span', '', 'research-map-anchor'); anchor.setAttribute('aria-hidden', 'true');
        stem = element('span', '', 'research-map-stem'); stem.setAttribute('aria-hidden', 'true');
        overlay.append(stem, anchor, marker); markerNodes.set(entity.id, marker); anchorNodes.set(entity.id, anchor); stemNodes.set(entity.id, stem);
      }
      datum(marker, 'observation', observation.id); datum(marker, 'entity', entity.id);
      const isSelected = current.selection?.entityId === entity.id && current.selection.observationId === observation.id;
      marker.dataset.selected = String(isSelected); marker.setAttribute('aria-pressed', String(isSelected));
      const meaning = isSelected ? 'selected record' : observation.time.startYear<=current.cursorYear&&observation.time.endYear>=current.cursorYear?'event window':observation.time.startYear>current.cursorYear?'later reference':'earlier reference';
      const labelKey = `${observation.id}:${meaning}`;
      if (marker.dataset.labelKey !== labelKey) {
        marker.replaceChildren(element('span', entity.label), element('small', `${periodLabel(observation)} · ${meaning}`));
        marker.dataset.labelKey = labelKey;
      }
      marker.setAttribute('aria-label', `${entity.label}, ${periodLabel(observation)}, ${valueLabel(observation)}; ${meaning}. Inspect source.`);
      for (const node of [marker, anchor, stem]) node.style.setProperty('--research-mark', COLORS[index % COLORS.length]);
      const hidden = !point || point[0] < 0 || point[1] < 0 || point[0] > width || point[1] > height;
      marker.hidden = anchor.hidden = stem.hidden = hidden;
      if (!point || hidden) continue;
      visibleMarkers.push({ point, marker, anchor, stem });
    }
    // Bounded two-line callouts have known dimensions. Selection no longer
    // forces browser layout to measure each changed label.
    for (const { point, marker, anchor, stem } of visibleMarkers) {
      const w = MARKER_WIDTH, h = MARKER_HEIGHT;
      anchor.style.left = `${point[0]}px`; anchor.style.top = `${point[1]}px`;
      const raw = [[-w / 2, -h - 14], [-w / 2, 14], [14, -h / 2], [-w - 14, -h / 2], [14, -h - 14], [-w - 14, -h - 14], [14, 14], [-w - 14, 14], [-w / 2, -h - 65], [-w / 2, 65]];
      const candidates = raw.map(([dx, dy]) => ({ x: Math.max(6, Math.min(width - w - 6, point[0] + dx)), y: Math.max(80, Math.min(height - h - 6, point[1] + dy)), width: w, height: h }));
      const score = (box: Box) => [...placed, ...blocked].reduce((sum, other) => sum + overlap(box, other) * 10, 0) + Math.hypot(box.x + w / 2 - point[0], box.y + h / 2 - point[1]);
      candidates.sort((a, b) => score(a) - score(b)); const box = candidates[0];
      placed.push({ x: box.x - 5, y: box.y - 5, width: w + 10, height: h + 10 });
      marker.style.left = `${box.x}px`; marker.style.top = `${box.y}px`;
      const endpoint = [Math.max(box.x, Math.min(box.x + w, point[0])), Math.max(box.y, Math.min(box.y + h, point[1]))];
      const dx = endpoint[0] - point[0], dy = endpoint[1] - point[1];
      stem.style.left = `${point[0]}px`; stem.style.top = `${point[1]}px`; stem.style.width = `${Math.hypot(dx, dy)}px`; stem.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
    }
    for (const [id, marker] of markerNodes) if (!retained.has(id)) { marker.remove(); markerNodes.delete(id); anchorNodes.get(id)?.remove(); anchorNodes.delete(id); stemNodes.get(id)?.remove(); stemNodes.delete(id); }
    overlay.dataset.revision = String(current.revision);
    overlay.dataset.selectedEntity = current.selection?.entityId ?? '';
    overlay.dataset.selectedObservation = current.selection?.observationId ?? '';
  }

  function renderEvidence() {
    const selected = current.selectedEvidence;
    const key = `${current.revision}:${current.selection?.observationId ?? ''}:${selected?.visible ?? ''}`;
    if (key === previousEvidenceKey) return; previousEvidenceKey = key;
    evidence.replaceChildren(element('h4', 'Trace an observation'));
    evidence.dataset.observationId = current.selection?.observationId ?? '';
    evidence.dataset.entityId = current.selection?.entityId ?? '';
    selectedSource.disabled = !selected;
    if (!selected) { selectedSource.textContent = 'Select an observation to inspect its source'; evidence.append(element('p', 'Select a dot, map marker or table row to inspect the exact source record.')); return; }
    const { observation, entity, source } = selected;
    selectedSource.textContent = `${entity.label} · ${periodLabel(observation)} · inspect source ↓`;
    evidence.append(element('h5', `${entity.label} · ${periodLabel(observation)}`), element('strong', valueLabel(observation), 'research-evidence-value'));
    if (!selected.visible) evidence.append(element('p', 'Selection is outside the current result. Its identity is retained; it has not been replaced.', 'research-selection-outside'));
    const details = element('dl');
    const composition=observation.compositionTime;
    const fields:[string,string][]=[
      ['Event support',`${periodLabel(observation)} · ${observation.time.precision}. ${observation.time.meaning}`],
      ['Composition support',composition?`${yearLabel(composition.startYear)}–${yearLabel(composition.endYear)}. ${composition.meaning}`:'Not supplied separately'],
      ['Evidence',`${observation.epistemicStatus} · ${observation.reviewStatus}`],
      ['Geographic definition',entity.spatialSupport.definition],
      ['Positional uncertainty',entity.spatialSupport.uncertaintyKm===null?'Not supplied; reference point only':`${entity.spatialSupport.uncertaintyKm} km`],
      ['Source',source.title],['Edition',source.edition],['Record locator',observation.provenance.locator],['Source SHA-256',observation.provenance.sourceSha256],['Record SHA-256',observation.provenance.recordSha256],
      ['Measurement uncertainty',observation.confidence.note],['Support',observation.supportNote],
    ];
    if(typeof observation.value==='string')evidence.append(element('p',observation.value,'research-account-text'));
    for(const [name,value] of fields){const group=element('div');group.append(element('dt',name),element('dd',value));details.append(group);}evidence.append(details);
    if(observation.author)evidence.append(element('p',`Author: ${observation.author}`));
    if(observation.perspective)evidence.append(element('p',observation.perspective));
    for(const limitation of observation.limitations)evidence.append(element('p',limitation));
    if(observation.provenance.bibliographySourceIds.length)evidence.append(element('p',`Bibliography: ${observation.provenance.bibliographySourceIds.join(', ')}`));
    const legacySource=current.active?.legacy?.bundle.sources[0];
    const links=observation.provenance.bibliographySourceIds.map(id=>teachingSource(id)).filter(source=>source!==undefined);
    if(observation.provenance.sourceId==='un-wup-2025')links.push({id:'un-wup-2025',title:'UN World Urbanization Prospects · original File 21',publisher:'United Nations',kind:'dataset',url:legacySource?.url??'https://population.un.org/wup/assets/Download/Cities/WUP2025-F21-DEGURBA-Cities_Pop.xlsx'});
    for(const sourceLink of links){const link=element('a',sourceLink.title);link.href=safeTeachingURL(sourceLink.url);link.target='_blank';link.rel='noopener noreferrer';evidence.append(link);}

    const label=observation.time.precision==='range'?`Browse start of ${periodLabel(observation)} (navigation anchor)`:`Browse ${periodLabel(observation)}`;
    evidence.append(element('p','This action moves the Atlas cursor for browsing; it does not assert an exact event day.','research-chart-note'));
    const showDate=element('button',label,'research-show-date');showDate.type='button';showDate.dataset.showObservationYear=String(observation.time.startYear);evidence.append(showDate);
  }

  function render(snapshot: WorkspaceSnapshot) {
    current = snapshot;
    const statusKey = JSON.stringify([snapshot.revision, snapshot.status, snapshot.message, !!snapshot.active, !!snapshot.mechanism, !!snapshot.imported]);
    if (paintedStatus !== statusKey) {
      paintedStatus = statusKey;
      panel.dataset.revision = String(snapshot.revision); panel.dataset.status = snapshot.status;
      panel.dataset.domain = snapshot.imported ? 'imported-evidence' : snapshot.mechanism ? 'technological-mechanism' : snapshot.active ? 'geographic' : '';
      mode.textContent = snapshot.imported ? 'Unreviewed evidence preview · host-controlled views' : 'Prepared example — planner not enabled';
      hudCursor.hidden = !!snapshot.imported; if (snapshot.imported) querySection.open = false;
      status.textContent = snapshot.message || (snapshot.status === 'loading' ? 'Validating and resolving source records…' : 'Choose a prepared research question.');
      status.dataset.status = snapshot.status;
      body.hidden = !snapshot.active; exportButton.disabled = !snapshot.active && !snapshot.mechanism && !snapshot.imported;
      graphToggle.hidden = !snapshot.mechanism; cursorFilter.hidden = !snapshot.active && !snapshot.imported;
      omnibar?.setStatus(snapshot.message || 'Local prepared catalogue · model processing is off', snapshot.status === 'loading');
    }
    mechanismView.render({ revision: snapshot.revision, cursorYear: snapshot.cursorYear, result: snapshot.mechanism, selection: snapshot.mechanism ? snapshot.selection : null });
    graphView?.render(snapshot.mechanism?.bundle ?? null, snapshot.selection, snapshot.cursorYear, open);
    importedView.render(snapshot.imported, snapshot.imported ? snapshot.selection : null, snapshot.cursorYear);
    const spatial = snapshot.imported?.specification.views.includes('map') ? snapshot.imported.bundle : snapshot.active?.spec.views.some(view => view.type === 'map') ? snapshot.active.bundle : null;
    if (!verificationChild && host.spatial) {
      if (spatialBundle !== spatial || spatialRevision !== snapshot.revision) { spatialBundle = spatial; spatialRevision = snapshot.revision; spatialData = spatial ? snapshot.imported ? evidenceOverlayFor(snapshot.imported.bundle.records, snapshot.revision) : researchOverlayFor(snapshot.active!.bundle, snapshot.revision) : null; }
      host.spatial.update(spatialData, snapshot.cursorYear, snapshot.selection?.observationId ?? null);
    }
    const supported = snapshot.imported ? snapshot.imported.bundle.records.filter(row => row.time && matchesCursor(row.time.startYear, row.time.endYear, snapshot.cursorYear)).length : snapshot.active?.bundle.observations.filter(row => matchesCursor(row.time.startYear, row.time.endYear, snapshot.cursorYear)).length ?? 0;
    panel.dataset.cursorMatches = String(supported); panel.dataset.cursorYear = String(snapshot.cursorYear);
    hudCursor.textContent = snapshot.imported ? `Browsing ${yearLabel(Math.floor(snapshot.cursorYear))}. Undated geometry remains reference-only; no historical validity is inferred.` : snapshot.mechanism ? `Browsing ${yearLabel(Math.floor(snapshot.cursorYear))}. The patent year is source context, not an attested operating interval.` : snapshot.active ? `${supported} of ${snapshot.active.bundle.observations.length} source observations at ${yearLabel(Math.floor(snapshot.cursorYear))}. Analysis bounds stay pinned; a selected record remains its own dated reference.` : '';
    if (!snapshot.active) { layoutMarkers(); return; }
    const viewKey=JSON.stringify(snapshot.active.spec.views);
    if (previousBundle !== snapshot.active.bundle||previousViews!==viewKey) { previousBundle = snapshot.active.bundle;previousViews=viewKey; renderRows(snapshot.active); }
    const window = analysisWindow(snapshot.active);
    if (paintedCursor !== snapshot.cursorYear) {
    for (const row of snapshot.active.bundle.observations) {
      const at = String(matchesCursor(row.time.startYear, row.time.endYear, snapshot.cursorYear));
      observationRows.get(row.id)?.setAttribute('data-at-cursor', at);
      for (const mark of observationMarks.get(row.id) ?? []) mark.setAttribute('data-at-cursor', at);
    }
    cursorNote.textContent = `Timeline cursor: ${yearLabel(Math.floor(snapshot.cursorYear))}. Chart window stays ${yearLabel(window.start)}–${yearLabel(window.end)}.`;
    for (const cursor of chart.querySelectorAll<SVGLineElement>('[data-research-cursor]')) {
      const visible = snapshot.cursorYear >= window.start && snapshot.cursorYear <= window.end;
      cursor.style.display = visible ? '' : 'none';
      const x = paintYear(snapshot.cursorYear, window.start, window.end); cursor.setAttribute('x1', String(x)); cursor.setAttribute('x2', String(x));
    }
    paintedCursor = snapshot.cursorYear;
    }
    const selectionKey = `${snapshot.revision}:${snapshot.selection?.observationId ?? ''}`;
    if (paintedSelection !== selectionKey) {
      const nextObservation = snapshot.selection?.observationId ?? null;
      for (const id of new Set([paintedObservation, nextObservation])) {
        if (!id) continue;
        const selected = String(id === nextObservation);
        for (const mark of observationMarks.get(id) ?? []) { mark.setAttribute('aria-pressed', selected); mark.setAttribute('data-selected', selected); }
        observationRows.get(id)?.setAttribute('data-selected', selected);
      }
      paintedObservation = nextObservation; paintedSelection = selectionKey;
    }
    layoutMarkers(); renderEvidence();
  }
  const unsubscribe = controller.subscribe(render); resources.subscriptions++;
  trackListener(signal); host.map.addEventListener('camera-change', layoutMarkers, { signal });
  const resize = new ResizeObserver(() => { markerBounds = undefined; layoutMarkers(); }); resize.observe(host.map); resize.observe(panel); resources.observers++;
  render(current);

  // A trusted development-only test drive invokes the normal selection/render path.
  // No arbitrary commands, specs or global execution API are exposed.
  if ((import.meta.env.DEV || new URL(location.href).searchParams.get('verify')==='1') && !verificationChild) {
    const checks = element('details', '', 'research-verification'); checks.append(element('summary', 'Local verification tools'));
    const result = element('pre'); result.id = idFor('research-verification-result'); result.tabIndex = 0;
    const run = button('Measure 200 selections, 200 combined updates + lifecycle', () => {
      if (measured || !current.active) return;
      measured = true; run.disabled = true; result.textContent = 'Running the loaded interaction workload…';
      void measure().then(receipt => { result.textContent = JSON.stringify(receipt, null, 2); }).catch(error => { result.textContent = JSON.stringify({ status: 'FAIL', error: String(error) }, null, 2); }).finally(() => { measured = false; run.disabled = false; });
    }, signal);
    if (host.localVerification) {
      const actions = host.localVerification;
      const environmentResult = element('pre'); environmentResult.id = idFor('research-environment-result'); environmentResult.tabIndex = 0;
      const runEnvironment = (label: string, action: () => Promise<unknown>) => {
        const control = button(label, () => {
          if (measured) return;
          measured = true; control.disabled = true; run.disabled = true; environmentResult.textContent = 'Running the local environment check…';
          void action().then(receipt => { environmentResult.textContent = JSON.stringify(receipt, null, 2); }).catch(error => { environmentResult.textContent = JSON.stringify({ status: 'FAIL', error: String(error) }, null, 2); }).finally(() => { measured = false; control.disabled = false; run.disabled = false; });
        }, signal);
        return control;
      };
      checks.append(runEnvironment('Measure continuous timeline scrub', () => actions.runScrub()), runEnvironment('Verify basemap style reloads', () => actions.runStyleReloads()), environmentResult);
    }
    checks.append(button('Measure checkpoint, multi-year, pan and qualitative workloads',()=>{if(measured||!current.active)return;measured=true;result.textContent='Running extended workload (200 interactions per phase)…';void measureExtended().then(receipt=>{result.textContent=JSON.stringify(receipt,null,2);}).catch(()=>{result.textContent='Extended workload interrupted; no pass recorded.';}).finally(()=>{measured=false;});},signal),element('p', 'Opt-in local verification. Measures DOM updates through animation-frame opportunities; this is not physical GPU or scanout certification.'), run, result); panel.append(checks);
  }
  async function measure() {
    const active = current.active!;
    const before = host.diagnostics();
    const originalCanvas = host.map.querySelector('canvas'), originalCanvasCount = host.map.querySelectorAll('canvas').length;
    const resourcesBefore = { ...resources }, controllerBefore = controller.getDiagnostics();
    const initialCursor = current.cursorYear, initialSelection = current.selection;
    const cursorA = Math.floor((analysisWindow(active).start + analysisWindow(active).end) / 2), cursorB = cursorA + 1;
    await host.seekYear(cursorA); await frame(); await host.seekYear(cursorB); await frame();
    const rows = active.bundle.observations;
    if (!rows.length) throw new Error('The loaded result has no observations.');
    performance.setResourceTimingBufferSize(10000);
    const resourceStart = performance.getEntriesByType('resource').length;
    const failures: string[] = [];
    const measurePhase = async (includeCursor: boolean) => {
      const samples: number[] = [], selectionCpuSamples: number[] = [], phaseFailures: string[] = [];
      const rendererBefore = host.diagnostics();
      const resourceOffset = performance.getEntriesByType('resource').length;
      for (let index = 0; index < 200; index++) {
        if (disposed || !open) throw new Error('Verification cancelled because the workspace was closed.');
        let rowIndex = index % 2 === 0 ? index % rows.length : rows.length - 1 - index % rows.length;
        if (rows[rowIndex].id === current.selection?.observationId) rowIndex = (rowIndex + 1) % rows.length;
        const row = rows[rowIndex];
        const start = performance.now(); select(row.id, 'local-verification');
        selectionCpuSamples.push(performance.now() - start);
        if (includeCursor) await host.seekYear(index % 2 ? cursorA : cursorB);
        await frame(); samples.push(performance.now() - start);
        const chartSelection = chart.querySelector('[data-selected="true"][data-research-observation]')?.getAttribute('data-research-observation');
        const mapSelection = overlay.querySelector('[data-selected="true"][data-research-observation]')?.getAttribute('data-research-observation');
        if (evidence.dataset.observationId !== row.id || overlay.dataset.selectedObservation !== row.id || chartSelection !== row.id || mapSelection !== row.id) phaseFailures.push(`Coordinated selection failed at interaction ${index}`);
      }
      const sorted = [...samples].sort((a, b) => a - b), p95 = sorted[Math.ceil(sorted.length * .95) - 1];
      failures.push(...phaseFailures);
      return {
        status: phaseFailures.length || p95 > (includeCursor ? 100 : 50) ? 'FAIL' as const : 'PASS' as const,
        interactionCount: samples.length, cursorChanges: includeCursor ? samples.length : 0,
        endpoints: includeCursor ? 'Before normal selection plus host cursor action to two animation-frame opportunities after awaited host seek and coordinated DOM update' : 'Before normal selection to two animation-frame opportunities after chart, map callout and evidence DOM update; host cursor fixed',
        p95Ms: p95, minMs: sorted[0], maxMs: sorted.at(-1), targetP95Ms: includeCursor ? 100 : 50, targetMet: p95 <= (includeCursor ? 100 : 50), samplesMs: samples,
        selectionCpuSamplesMs: selectionCpuSamples, selectionCpuP95Ms: [...selectionCpuSamples].sort((a, b) => a - b)[Math.ceil(selectionCpuSamples.length * .95) - 1],
        resourceTimingCount: performance.getEntriesByType('resource').length - resourceOffset,
        rendererBefore, rendererAfter: host.diagnostics(), failures: phaseFailures,
      };
    };
    const selectionOnly = await measurePhase(false);
    const selectionAndCursor = await measurePhase(true);
    const networkResources = performance.getEntriesByType('resource').slice(resourceStart) as PerformanceResourceTiming[];
    const cycles: { cycle: number; markersAfterClose: number; markersAfterRun: number; controllerListeners: number; resources: typeof resources }[] = [];
    for (let index = 0; index < 20; index++) {
      controller.close(); const markersAfterClose = overlay.childElementCount;
      const ok = await controller.run(PREPARED_EXAMPLES[index % PREPARED_EXAMPLES.length]);
      if (!ok) failures.push(`Replace cycle ${index + 1} failed`);
      if (markersAfterClose !== 0) failures.push(`Overlay resources remain after close cycle ${index + 1}`);
      const diagnostics = controller.getDiagnostics();
      if (diagnostics.listeners !== controllerBefore.listeners || JSON.stringify(resources) !== JSON.stringify(resourcesBefore)) failures.push(`Owned listener resources changed at cycle ${index + 1}`);
      cycles.push({ cycle: index + 1, markersAfterClose, markersAfterRun: overlay.childElementCount, controllerListeners: diagnostics.listeners, resources: { ...resources } });
    }
    const mountDisposeCycles: { cycle: number; loaded: boolean; before: ViewDiagnostics; after: ViewDiagnostics }[] = [];
    for (let index = 0; index < 20; index++) {
      // Hidden test mounts use the exact adapter and real data, then tear down all owned resources.
      // They never change the authoritative host cursor, camera or historical scene.
      const instance = mountResearchWorkspace({ ...host, initialYear: lastYear(active) }, true);
      const loaded = await instance.runLifecycle!(PREPARED_EXAMPLES[index % PREPARED_EXAMPLES.length]);
      const mounted = instance.getDiagnostics(); instance.dispose(); const removed = instance.getDiagnostics();
      if (!loaded || removed.resources.domListeners || removed.resources.observers || removed.resources.subscriptions || removed.controller.listeners || removed.nodes.panel || removed.nodes.overlay || removed.nodes.toggle || removed.nodes.markers) failures.push(`Full mount/dispose cycle ${index + 1} did not return resources to zero`);
      mountDisposeCycles.push({ cycle: index + 1, loaded, before: mounted, after: removed });
    }
    await controller.run(active.spec);
    if (initialSelection) controller.dispatch({ type: 'select', ...initialSelection, origin: 'local-verification-restore', revision: current.revision });
    else controller.dispatch({ type: 'clear-selection', origin: 'local-verification-restore', revision: current.revision });
    await host.seekYear(initialCursor); await frame();
    const sameCanvas = host.map.querySelector('canvas') === originalCanvas, finalCanvasCount = host.map.querySelectorAll('canvas').length;
    if (!sameCanvas || finalCanvasCount !== originalCanvasCount) failures.push('The host map surface changed during the workload');
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const motionStyles = [panel, ...Array.from(panel.querySelectorAll('button,svg')).slice(0, 5)].map(node => { const style = getComputedStyle(node); return { tag: node.tagName, animationName: style.animationName, animationDuration: style.animationDuration, transitionDuration: style.transitionDuration, scrollBehavior: style.scrollBehavior }; });
    return {
      build:host.buildIdentity?.()??null,status: failures.length || selectionOnly.status === 'FAIL' || selectionAndCursor.status === 'FAIL' ? 'FAIL' : 'PASS', workload: { observations: rows.length, entities: active.bundle.entities.length, interactions: selectionOnly.interactionCount + selectionAndCursor.interactionCount, cursorChanges: selectionAndCursor.cursorChanges, cursorYears: [cursorA, cursorB], replaceCloseCycles: cycles.length, mountDisposeCycles: mountDisposeCycles.length, lifecycleMeaning: '20 result close/reopen cycles plus 20 hidden complete view/controller mount/dispose cycles on the unchanged host map.' },
      environment: { userAgent: navigator.userAgent, viewport: [innerWidth, innerHeight], devicePixelRatio, renderer: before, reducedMotion: { mediaQueryMatches: reducedMotion, computedStyles: motionStyles, runningAnimations: panel.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length } },
      timing: selectionAndCursor, phases: { selectionOnly, selectionAndCursor }, performanceInterpretation: 'The dual-track sprint requires selection <=50 ms and combined selection plus host-year <=100 ms. Endpoints and 200 samples per phase are unchanged from M1; either miss remains an aggregate FAIL.' ,
      preparedExecutions: executionTimings,
      warmNetworkResources: networkResources.map(entry => ({ name: entry.name, initiatorType: entry.initiatorType, classification: entry.name.includes('pilot-data') ? 'research-data' : /\/(global-history|alpha|integrated|detail|people)\//.test(entry.name) ? 'atlas-map-context' : 'other' })),
      cycles, mountDisposeCycles, resources: { before: resourcesBefore, after: { ...resources }, overlayNodes: host.map.querySelectorAll('#research-map-overlay').length, markerNodes: overlay.childElementCount },
      hostSurface: { sameCanvasObject: sameCanvas, beforeCanvasCount: originalCanvasCount, afterCanvasCount: finalCanvasCount },
      controllerBefore, controllerAfter: controller.getDiagnostics(), after: host.diagnostics(), failures, physicalGPU: 'NOT RUN', physicalMobile: 'NOT RUN', scanout: 'NOT MEASURED',
    };
  }
  async function measureExtended(){
    const initial=current.active!,cursor=current.cursorYear,selection=current.selection,camera=host.camera?.();
    const phases:unknown[]=[];
    try{
      await controller.openPilot(MODERN_ID);
      for(const mode of ['checkpoints','multi-year-cache','pan-plus-scrub','qualitative-nine-places'] as const){
        if(mode==='qualitative-nine-places')await controller.openPilot(PREMODERN_ID);
        const active=current.active!,rows=active.bundle.observations,samples:number[]=[],frames:string[]=[],failures:string[]=[],resourcesBefore=performance.getEntriesByType('resource').length;
        const before=host.diagnostics();
        for(let index=0;index<200;index++){
          if(disposed||!open)throw new Error('Cancelled');const row=rows[index%rows.length];
          const year=mode==='multi-year-cache'||mode==='pan-plus-scrub'?[1975,1985,1995,2005,2015,2025][index%6]:row.time.startYear;
          const start=performance.now();select(row.id,'extended-verification');
          if(mode==='pan-plus-scrub'&&camera)host.focus([camera.longitude+(index%2?1:-1),camera.latitude],camera.zoom);
          await host.seekYear(year);await frame();samples.push(performance.now()-start);frames.push(row.id);
          if(evidence.dataset.observationId!==row.id||overlay.dataset.selectedObservation!==row.id)failures.push(`Selection mismatch ${index}`);
        }
        const sorted=[...samples].sort((a,b)=>a-b);phases.push({mode,rows:rows.length,entities:active.bundle.entities.length,samplesMs:samples,observationIds:frames,p95Ms:sorted[189],targetP95Ms:100,status:sorted[189]<=100&&!failures.length?'PASS':'FAIL',failures,rendererBefore:before,rendererAfter:host.diagnostics(),resourceCount:performance.getEntriesByType('resource').length-resourcesBefore,cacheMeaning:'Sequential run; first encounter and revisits both retained. Not independently certified cold cache.',endpoints:'Before selection (and pan where named) to two RAF opportunities after awaited host seek'});
      }
      return{build:host.buildIdentity?.()??null,environment:{userAgent:navigator.userAgent,viewport:[innerWidth,innerHeight],dpr:devicePixelRatio},phases,scope:'Largest registered numerical pilot is 44 rows / four places; qualitative pilot adds nine reference places. No synthetic larger dataset.',physicalScanout:'NOT MEASURED'};
    }finally{
      if(!disposed){await controller.run(initial.spec);if(selection)controller.dispatch({type:'select',...selection,origin:'verification-restore',revision:current.revision});await host.seekYear(cursor);if(camera)host.focus([camera.longitude,camera.latitude],camera.zoom);}
    }
  }
  return {
    runLifecycle: verificationChild ? async (spec: unknown) => { open = true; return controller.run(spec); } : undefined,
    getDiagnostics: () => ({ resources: { ...resources }, controller: controller.getDiagnostics(), nodes: { panel: panel.isConnected, overlay: overlay.isConnected, toggle: toggle.isConnected, markers: overlay.childElementCount } }),
    updateCursor(year: number) { controller.dispatch({ type: 'cursor', year, origin: 'atlas-timeline', revision: current.revision }); },
    dispose() { if (disposed) return; disposed = true; open = false; unsubscribe(); resources.subscriptions--; controller.dispose(); lifetime.abort(); resize.disconnect(); resources.observers--; markerNodes.clear(); anchorNodes.clear(); stemNodes.clear(); observationMarks.clear(); observationRows.clear(); overlay.replaceChildren(); overlay.remove(); panel.remove(); toggle.remove(); if (!verificationChild) host.workspace.classList.remove('research-open'); },
  };
}
