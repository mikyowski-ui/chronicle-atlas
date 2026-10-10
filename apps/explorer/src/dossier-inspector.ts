import { sha256 } from '@noble/hashes/sha2.js';
import { formatNavigationDate } from './time-entry.ts';
import { formatFixtureYear } from './date-label.ts';
export type InspectorMode = 'place' | 'polity';
export type InspectorMeaning = 'political-association' | 'cultural-presence' | 'source-context' | 'aggregate-population' | 'unknown' | 'synthetic';
export type InspectorReviewStatus = 'source-attributed' | 'independently-reviewed' | 'unreviewed' | 'synthetic';
/** Presentation metadata for one represented assertion, never inferred from a label. */
export interface InspectorFeatureContext {
  sourceName: string; kind: InspectorMeaning; reviewStatus: InspectorReviewStatus;
  sourceTitle: string; attribution: string; sourceEdition?: string; sourceURL?: string;
  datePrecision?: string; classificationNote?: string; coverageNote?: string;
}
export interface InspectorPointAssertion {
  entityId: string; name: string; assertionIds: readonly string[]; feature?: InspectorFeatureContext;
}
export interface InspectorContext {
  requestedTime: number; displayedTime: number | null; edition: string; policy: 'exact' | 'reference';
  selection?: { entityId: string; name: string } | null; coordinates?: readonly [number, number] | null;
  assertions?: readonly InspectorPointAssertion[];
  representation: 'exact' | 'reference' | 'missing'; pending?: boolean; populationSummary?: string;
  selectionRepresented?: boolean; feature?: InspectorFeatureContext; coverageNote?: string;
}
export interface DossierCallbacks {
  onEvidence?: () => void; onSelectDossier: (entityId: string, time: number) => void;
  onOpenOverview?: (dossierId: string) => void; onReturnMap?: () => void; onModeChange?: (mode: InspectorMode) => void;
}
export interface DossierSource { id: string; title: string; publisher: string; url: string; verified_at: string; scope: string; rights: string }
export interface DossierField { label: string; text: string; source_ids: string[]; scope: string }
export interface DossierSummary {
  id: string; title: string; entity_id: string; date_label: string; t_start: number; t_end: number;
  observation_time: number; url: string; sha256: string; byte_length: number;
}
export interface DossierRecord extends Omit<DossierSummary, 'url' | 'sha256' | 'byte_length'> {
  schema_version: 1; edition: string; recorded_at: string; date_precision: 'year'; historical_scope: string; representation: string;
  map_binding: { edition: string; epoch_id: string; assertion_ids: string[] };
  lead: DossierField; organization: DossierField[]; changes: DossierField[]; population: DossierField;
  overview: DossierField[]; sources: DossierSource[]; article_source_id: string;
}
export interface DossierManifest { schema_version: 1; edition: string; recorded_at: string; max_records: 3; records: DossierSummary[] }
export const DOSSIER_BUDGET = Object.freeze({ manifestBytes: 8192, recordBytes: 32768, records: 3 });
export const INSPECTOR_LIMITS = Object.freeze({ label: 250, note: 1200, pointAssertions: 100 });
const displayText = (value: string, cap: number) => value.length <= cap ? value : `${value.slice(0, cap - 1)}…`;
/** Semantic descriptions are explicit and cannot promote a cultural/unknown polygon into a polity. */
export function describeInspectorFeature(feature: InspectorFeatureContext): { type: string; status: string; meaning: string } {
  const types: Record<InspectorMeaning, readonly [string, string]> = {
    'political-association': ['Political association', 'The source associates this area with a political entity. This does not establish universal or exclusive sovereignty.'],
    'cultural-presence': ['Cultural presence', 'A source-defined cultural approximation. It is not a political boundary or an assertion of ownership.'],
    'source-context': ['Source context', 'A region shown as attributed context. It is not admitted political ownership.'],
    'aggregate-population': ['Aggregate population region', 'A source-defined collective or population region. It does not establish a polity or a population total.'],
    unknown: ['Unclassified source region', 'Its historical meaning is unresolved. It must not be read as political ownership.'],
    synthetic: ['Synthetic fixture', 'Invented demonstration geometry; no historical claim.'],
  };
  const statuses: Record<InspectorReviewStatus, string> = {
    'source-attributed': 'Source-attributed overview · not independently corroborated',
    'independently-reviewed': 'Independently reviewed assertion · see recorded evidence and scope',
    unreviewed: 'Interpretation unresolved · not independently reviewed',
    synthetic: 'Synthetic demonstration · not historical evidence',
  };
  const [type, meaning] = types[feature.kind] ?? types.unknown;
  return { type, meaning, status: statuses[feature.reviewStatus] ?? statuses.unreviewed };
}
/** Same-origin assets or public HTTPS sources only; content is always rendered through textContent. */
export function safeInspectorSourceURL(value: string, baseURL: string): string {
  if (!value || value.length > 2048) throw new Error('Invalid source URL.');
  const base = new URL(baseURL), url = new URL(value, base);
  if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.origin === base.origin))) throw new Error('Unsafe source URL.');
  return url.href;
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max = 4000): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
export function safeArticleURL(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Invalid article URL.');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Only verified HTTPS article links are allowed.');
  return url.href;
}
function interval(v: Record<string, unknown>): void {
  if (!Number.isSafeInteger(v.t_start) || !Number.isSafeInteger(v.t_end) || Number(v.t_start) >= Number(v.t_end) || !Number.isSafeInteger(v.observation_time) || Number(v.observation_time) < Number(v.t_start) || Number(v.observation_time) >= Number(v.t_end)) throw new Error('Invalid dossier historical interval.');
}
export function validateDossierManifest(value: unknown): DossierManifest {
  if (!object(value) || value.schema_version !== 1 || !text(value.edition, 150) || !text(value.recorded_at, 40) || value.max_records !== 3 || !Array.isArray(value.records) || value.records.length !== 3) throw new Error('Invalid bounded dossier manifest.');
  const ids = new Set();
  for (const entry of value.records) {
    if (!object(entry) || !text(entry.id, 80) || !/^[a-z0-9-]+$/.test(entry.id) || ids.has(entry.id) || !text(entry.title, 150) || !text(entry.entity_id, 150) || !text(entry.date_label, 50) || entry.url !== `${entry.id}.json` || !/^[a-f0-9]{64}$/.test(String(entry.sha256)) || !Number.isSafeInteger(entry.byte_length) || Number(entry.byte_length) < 1 || Number(entry.byte_length) > DOSSIER_BUDGET.recordBytes) throw new Error('Invalid dossier manifest entry.');
    interval(entry); ids.add(entry.id);
  }
  return value as unknown as DossierManifest;
}
export function validateDossier(value: unknown, summary: DossierSummary, edition: string): DossierRecord {
  if (!object(value) || value.schema_version !== 1 || value.edition !== edition || value.id !== summary.id || value.entity_id !== summary.entity_id || value.title !== summary.title || value.date_label !== summary.date_label || value.t_start !== summary.t_start || value.t_end !== summary.t_end || value.observation_time !== summary.observation_time || value.date_precision !== 'year' || !text(value.recorded_at, 40) || !text(value.historical_scope) || !text(value.representation)) throw new Error('Dossier identity differs from its manifest.');
  interval(value); const binding = value.map_binding;
  if (!object(binding) || !text(binding.edition, 150) || !text(binding.epoch_id, 150) || !Array.isArray(binding.assertion_ids) || !binding.assertion_ids.length || binding.assertion_ids.length > 100 || !binding.assertion_ids.every(v => text(v, 150))) throw new Error('Missing dossier map binding.');
  if (!Array.isArray(value.sources) || !value.sources.length || value.sources.length > 12) throw new Error('Invalid dossier source count.');
  const sources = new Set<string>();
  for (const source of value.sources) {
    if (!object(source) || !text(source.id, 50) || sources.has(source.id) || !text(source.title, 250) || !text(source.publisher, 200) || !text(source.scope) || !text(source.rights) || !text(source.verified_at, 40)) throw new Error('Invalid dossier source.');
    safeArticleURL(source.url); sources.add(source.id);
  }
  if (!sources.has(String(value.article_source_id))) throw new Error('Unverified dossier overview link.');
  const field = (f: unknown) => {
    if (!object(f) || !text(f.label, 100) || !text(f.text) || !text(f.scope, 400) || !Array.isArray(f.source_ids) || f.source_ids.length > 12 || !f.source_ids.every(id => typeof id === 'string' && sources.has(id))) throw new Error('Invalid field-level dossier evidence.');
  };
  field(value.lead); field(value.population);
  for (const key of ['organization', 'changes', 'overview']) { const fields = value[key]; if (!Array.isArray(fields) || !fields.length || fields.length > 12) throw new Error('Incomplete dossier content.'); fields.forEach(field); }
  return value as unknown as DossierRecord;
}
export function dossierForTime(records: readonly DossierSummary[], entityId: string | undefined, time: number | null): DossierSummary | undefined {
  if (time === null || !entityId) return undefined;
  return records.find(r => r.entity_id === entityId && r.t_start <= time && time < r.t_end);
}
export function dossierForContext(records: readonly DossierSummary[], context: InspectorContext): DossierSummary | undefined {
  if (context.representation === 'missing' || context.selectionRepresented === false) return undefined;
  return dossierForTime(records, context.selection?.entityId, context.displayedTime);
}
async function boundedJSON(url: string, cap: number, signal: AbortSignal, expected?: DossierSummary): Promise<unknown> {
  const response = await fetch(url, { signal, credentials: 'same-origin' });
  if (!response.ok || !response.body) throw new Error(`Dossier unavailable (${response.status}).`);
  const length = response.headers.get('content-length'); if (length && Number(length) > cap) throw new Error('Dossier response exceeds its budget.');
  const reader = response.body.getReader(); let total = 0; const chunks: Uint8Array[] = [];
  try { while (true) { const next = await reader.read(); if (next.done) break; total += next.value.byteLength; if (total > cap) throw new Error('Dossier response exceeds its budget.'); chunks.push(next.value); } }
  catch (error) { await reader.cancel(); throw error; }
  const bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  if (expected && (total !== expected.byte_length || Array.from(sha256(bytes), b => b.toString(16).padStart(2, '0')).join('') !== expected.sha256)) throw new Error('Dossier bytes differ from the pinned manifest.');
  return JSON.parse(new TextDecoder().decode(bytes));
}
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', content?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.className = className; if (content !== undefined) node.textContent = content; return node;
}
function button(label: string, fn: () => void, className = ''): HTMLButtonElement { const b = el('button', className, label); b.type = 'button'; b.addEventListener('click', fn); return b; }
function external(source: DossierSource, label = source.title): HTMLAnchorElement {
  const link = el('a', 'dossier-source-link', label); link.href = safeArticleURL(source.url); link.target = '_blank'; link.rel = 'noopener noreferrer'; link.title = `${source.publisher} · ${source.scope}`; return link;
}
/** Bounded static inspector. No dossier HTML is evaluated; textContent is the content boundary. */
export class DossierInspector {
  private context: InspectorContext | null = null; private mode: InspectorMode = 'place'; private manifest: DossierManifest | null = null;
  private baseURL = ''; private records = new Map<string, DossierRecord>(); private inFlight = new Map<string, Promise<DossierRecord>>(); private failures = new Map<string,string>();
  private error = ''; private overviewId: string | null = null; private life = new AbortController(); private contentKey = '';
  private body: HTMLElement; private status: HTMLElement; private dates: HTMLElement; private tabs: HTMLButtonElement[];
  constructor(private host: HTMLElement, private callbacks: DossierCallbacks) {
    host.classList.add('dossier-inspector'); const top = el('div', 'dossier-tabs');
    this.tabs = [button('Place', () => this.setMode('place')), button('Polity', () => this.setMode('polity'))];
    top.append(...this.tabs); this.status = el('p', 'dossier-representation'); this.dates = el('p', 'dossier-dates'); this.body = el('div', 'dossier-body');
    host.replaceChildren(top, this.dates, this.status, this.body);
  }
  async load(url = './integrated/dossiers/manifest.json'): Promise<void> {
    this.baseURL = new URL(url, document.baseURI).href;
    try { this.manifest = validateDossierManifest(await boundedJSON(this.baseURL, DOSSIER_BUDGET.manifestBytes, this.life.signal)); this.error = ''; }
    catch (error) { if (!this.life.signal.aborted) this.error = `Dossiers unavailable. ${error instanceof Error ? error.message : 'Offline or invalid content.'}`; }
    this.contentKey = ''; this.render();
  }
  update(context: InspectorContext): void { this.context = context; this.render(); }
  setMode(mode: InspectorMode): void { this.mode = mode; this.overviewId = null; this.contentKey = ''; this.callbacks.onModeChange?.(mode); this.render(); }
  getMode(): InspectorMode { return this.mode; }
  getRecords(): readonly DossierSummary[] { return this.manifest?.records ?? []; }
  openOverview(id: string): void { if (!this.context || dossierForContext(this.manifest?.records ?? [], this.context)?.id !== id) return; this.mode = 'polity'; this.overviewId = id; this.contentKey = ''; this.render(); }
  closeOverview(): void { this.overviewId = null; this.contentKey = ''; this.render(); }
  destroy(): void { this.life.abort(); this.host.replaceChildren(); this.records.clear(); this.inFlight.clear(); }
  private async getRecord(summary: DossierSummary): Promise<DossierRecord> {
    const retained = this.records.get(summary.id); if (retained) return retained;
    let task = this.inFlight.get(summary.id);
    if (!task) { task = boundedJSON(new URL(summary.url, this.baseURL).href, DOSSIER_BUDGET.recordBytes, this.life.signal, summary).then(v => { const record = validateDossier(v, summary, this.manifest!.edition); this.records.set(summary.id, record); return record; }).finally(() => this.inFlight.delete(summary.id)); this.inFlight.set(summary.id, task); }
    return task;
  }
  private render(): void {
    if (!this.context || this.life.signal.aborted) return;
    const c = this.context; this.tabs.forEach((b,i) => b.setAttribute('aria-pressed', String(this.mode === (i ? 'polity' : 'place'))));
    const dated = dossierForContext(this.manifest?.records ?? [], c);
    // A pinned reading must not survive a map/date/identity change as if it described the new scene.
    if (this.overviewId && dated?.id !== this.overviewId) { this.overviewId = null; this.callbacks.onReturnMap?.(); }
    this.host.dataset.mode = this.mode; this.host.dataset.overview = String(!!this.overviewId); this.host.dataset.representation = c.representation; this.host.dataset.entityId = c.selection?.entityId ?? '';
    this.host.dataset.empty = String(!c.selection && !c.coordinates);
    this.dates.textContent = `Browsing ${formatNavigationDate(c.requestedTime)}${c.displayedTime === null ? '' : ` · ${c.pending ? 'Loaded map' : c.representation === 'reference' ? 'Reference map' : 'Map observation'} ${formatFixtureYear(c.displayedTime)}`}`;
    this.status.textContent = c.pending ? 'Loading the requested view. The map and card still describe the explicitly dated loaded observation.' : c.representation === 'missing' ? 'No political observation at this date. Physical context and your selected question are retained.' : c.representation === 'reference' ? 'Earlier observation shown as context. It does not establish borders on the browsing date.' : 'Source observation; its original precision and uncertainty remain.';
    const chosen = dated;
    const key = JSON.stringify([this.mode, this.overviewId, chosen?.id, c.selection, c.selectionRepresented, c.feature, c.coverageNote, c.coordinates, c.assertions, c.representation, c.edition, c.populationSummary, this.error, !!chosen && this.records.has(chosen.id), chosen && this.failures.get(chosen.id)]);
    if (key === this.contentKey) return;
    this.contentKey = key; this.body.replaceChildren(); this.host.scrollTop = 0; if (this.host.parentElement) this.host.parentElement.scrollTop = 0; this.host.dataset.dossierId = chosen?.id ?? '';
    if (!c.selection && !c.coordinates) {
      this.body.append(el('h2', '', 'Explore the map'), el('p', 'dossier-note', 'Select a location to inspect the source assertions there. Right-click, or choose Polity after selecting, to inspect its entity.'));
      this.renderPilots(); return;
    }
    if (this.mode === 'place') this.renderPlace(c);
    else if (chosen) {
      const record = this.records.get(chosen.id), failure = this.failures.get(chosen.id);
      if (record) this.renderPolity(record, !!this.overviewId);
      else if (failure) this.body.append(el('h2', '', chosen.title), el('p', 'dossier-note', failure), button('Retry dossier', () => { this.failures.delete(chosen.id); this.contentKey=''; this.render(); }));
      else {
        this.body.append(el('h2', '', chosen.title), el('p', '', 'Loading the dated overview…'));
        void this.getRecord(chosen).then(() => { this.contentKey = ''; this.render(); }).catch(error => { if (!this.life.signal.aborted) { this.failures.set(chosen.id, `Dossier unavailable. ${error instanceof Error ? error.message : 'Offline.'}`); this.contentKey = ''; this.render(); } });
      }
    } else this.body.append(el('h2', '', displayText(c.selection?.name ?? 'Explore an entity', INSPECTOR_LIMITS.label)), el('p', 'dossier-note', c.selection && (c.selectionRepresented === false || c.representation === 'missing') ? 'Selection retained. This entity has no admitted representation in the displayed observation; no identity continuity is inferred from a matching name.' : c.selection ? 'Source identity and map evidence are available below. No enriched organization dossier is admitted for this entity at this observation.' : 'Select an assertion on the map or open one of the three dated studies.'));
    if (c.feature && c.selectionRepresented !== false && c.representation !== 'missing') this.renderFeature(c.feature);
    else if (c.selectionRepresented !== false && c.representation !== 'missing' && c.selection) this.body.append(el('p', 'dossier-note', 'Classification and review status are not supplied for this selected assertion. Consult its map evidence; no independent review is implied.'));
    const featureCoverageVisible = c.feature && c.selectionRepresented !== false && c.representation !== 'missing';
    if (c.coverageNote && (!featureCoverageVisible || c.coverageNote !== c.feature?.coverageNote)) this.body.append(el('p', 'dossier-coverage', displayText(c.coverageNote, INSPECTOR_LIMITS.note)));
    if (this.mode === 'polity' && c.populationSummary) this.body.append(el('h3', '', 'Precomputed population comparison'), el('p', 'dossier-note', c.populationSummary));
    if (this.error) this.body.append(el('p', 'dossier-note', this.error));
    if (!this.overviewId) this.renderPilots();
    const footer = el('div', 'dossier-actions'); if (this.callbacks.onEvidence && c.selection) footer.append(button('Map evidence', () => this.callbacks.onEvidence?.()));
    const details = el('details', 'dossier-binding'); details.append(el('summary', '', 'Map edition & context'), el('p', '', c.edition)); footer.append(details); this.body.append(footer);
  }
  private renderPlace(c: InspectorContext): void {
    this.body.append(el('h2', '', 'Selected location'));
    this.body.append(el('p', c.coordinates ? 'dossier-coordinates' : 'dossier-note', c.coordinates ? `${c.coordinates[1].toFixed(4)}° latitude · ${c.coordinates[0].toFixed(4)}° longitude` : 'Click the map to retain an actual location. No location is inferred from an entity label.'));
    const matches = c.assertions ?? []; this.body.append(el('h3', '', 'Assertions at this point'));
    if (!c.coordinates || !matches.length) this.body.append(el('p', '', !c.coordinates ? 'No point has been selected.' : 'No matching assertion is available at this point in the loaded map. Offscreen native tiles may be unavailable. Neutral land is physical context.'));
    else {
      const ul = el('ul', 'dossier-matches');
      for (const match of matches.slice(0, INSPECTOR_LIMITS.pointAssertions)) {
        const li = el('li'); li.append(el('strong', '', displayText(match.name, INSPECTOR_LIMITS.label)));
        const description = match.feature ? describeInspectorFeature(match.feature) : null;
        if (description) li.append(el('p', 'dossier-match-kind', `${description.type} · ${description.status}`));
        const detail = el('details'); detail.append(el('summary', '', `${match.assertionIds.length} matching assertion${match.assertionIds.length === 1 ? '' : 's'}`), el('p', '', displayText(match.assertionIds.join('\n'), 12000)));
        if (match.feature) detail.append(el('p', '', displayText(`${match.feature.sourceTitle} · ${match.feature.attribution}`, INSPECTOR_LIMITS.note)));
        li.append(detail); ul.append(li);
      }
      this.body.append(ul, button('Inspect polity', () => this.setMode('polity'), 'dossier-primary'));
      if (matches.length > INSPECTOR_LIMITS.pointAssertions) this.body.append(el('p', 'dossier-note', `Showing ${INSPECTOR_LIMITS.pointAssertions} of ${matches.length} matching entities. The evidence inventory retains the remaining records.`));
    }
    this.body.append(el('p', 'dossier-note', 'Political borders supply no settlement names or point population. Source-linked place records are shown separately when selected.'));
  }
  private renderFeature(feature: InspectorFeatureContext): void {
    const description = describeInspectorFeature(feature), section = el('section', 'dossier-source-summary');
    section.dataset.kind = feature.kind; section.dataset.reviewStatus = feature.reviewStatus;
    section.append(el('p', 'dossier-kind', description.type), el('p', 'dossier-review-status', description.status));
    const fields = el('dl', 'dossier-source-identity');
    for (const [label, value] of [['Source name', feature.sourceName], ['Map source', feature.sourceTitle], ['Attribution', feature.attribution], ...(feature.datePrecision ? [['Source precision', feature.datePrecision]] : [])]) {
      const row = el('div'); row.append(el('dt', '', label), el('dd', '', displayText(value, label === 'Attribution' ? INSPECTOR_LIMITS.note : INSPECTOR_LIMITS.label))); fields.append(row);
    }
    section.append(fields, el('p', 'dossier-meaning', description.meaning));
    if (feature.coverageNote) section.append(el('p', 'dossier-coverage', displayText(feature.coverageNote, INSPECTOR_LIMITS.note)));
    const details = el('details', 'dossier-binding'); details.append(el('summary', '', 'Classification & source record'));
    if (feature.classificationNote) details.append(el('p', '', displayText(feature.classificationNote, INSPECTOR_LIMITS.note)));
    if (feature.sourceEdition) details.append(el('p', '', displayText(feature.sourceEdition, INSPECTOR_LIMITS.label)));
    if (feature.sourceURL) {
      try { const link = el('a', 'dossier-source-link', 'Open map source ↗'); link.href = safeInspectorSourceURL(feature.sourceURL, document.baseURI); link.target = '_blank'; link.rel = 'noopener noreferrer'; details.append(link); }
      catch { details.append(el('p', '', 'The supplied source link is unavailable. Its attribution is retained above.')); }
    }
    section.append(details); this.body.append(section);
  }
  private addField(field: DossierField, record: DossierRecord, full: boolean): void {
    const section = el('section', 'dossier-field'); section.append(el('h3', '', field.label), el('p', '', field.text)); if (full) section.append(el('p', 'dossier-scope', field.scope));
    const refs = el('div', 'dossier-field-sources'); for (const id of field.source_ids) { const source = record.sources.find(s=>s.id === id)!; refs.append(external(source, source.publisher)); }
    if (field.source_ids.length) section.append(refs); this.body.append(section);
  }
  private renderPolity(record: DossierRecord, full: boolean): void {
    if (full) this.body.append(button('← Return to map', () => { this.closeOverview(); this.callbacks.onReturnMap?.(); }, 'dossier-return'));
    this.body.append(el('p', 'dossier-kicker', `DATED STUDY · ${record.date_label}`), el('h2', '', record.title), el('p', 'dossier-lead', record.lead.text));
    const article = record.sources.find(s=>s.id === record.article_source_id)!; const actions = el('div', 'dossier-actions');
    if (!full) actions.append(button('Read local overview', () => { this.openOverview(record.id); this.callbacks.onOpenOverview?.(record.id); }, 'dossier-primary'));
    actions.append(external(article, 'Further reading ↗')); this.body.append(actions);
    if (full) for (const field of record.overview) this.addField(field, record, true);
    for (const field of full ? record.organization : record.organization.filter(f=>['Government','Institutions'].includes(f.label))) this.addField(field, record, full);
    for (const field of full ? record.changes : record.changes.slice(-1)) this.addField(field, record, full);
    this.addField(record.population, record, full);
    this.body.append(el('p', 'dossier-note', `${record.historical_scope} The linked article is a broader reading, not a dated map reconstruction.`));
    if (full) {
      this.body.append(el('h3', '', 'Sources & editorial scope'));
      for (const source of record.sources) { const p = el('p', 'dossier-source-record'); p.append(external(source), document.createTextNode(` — ${source.publisher}. ${source.scope} Link checked ${source.verified_at}.`)); this.body.append(p); }
      const a = el('details', 'dossier-binding'); a.append(el('summary', '', 'Dossier identity & assertion binding'), el('p', '', `${record.id} · ${record.edition}\nRecorded ${record.recorded_at}\n${record.map_binding.edition} / ${record.map_binding.epoch_id}\n${record.map_binding.assertion_ids.join('\n')}`)); this.body.append(a);
    }
  }
  private renderPilots(): void {
    if (!this.manifest) return;
    const details = el('details', 'dossier-pilots'); details.append(el('summary', '', 'Three dated studies'));
    for (const entry of this.manifest.records) details.append(button(`${entry.title} · ${entry.date_label}`, () => { this.mode = 'polity'; this.overviewId = null; this.callbacks.onModeChange?.('polity'); this.callbacks.onSelectDossier(entry.entity_id, entry.observation_time); }));
    this.body.append(details);
  }
}
