import { evidenceAtCursor, type EvidenceRecord, type EvidenceWorkspace } from '@chronicle/contracts/evidence';
import type { ViewSelection } from './interfaces.ts';
import { mountVisualizationView } from './visualization.ts';

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className?: string): HTMLElementTagNameMap[K] => { const node = document.createElement(tag); node.textContent = text; if (className) node.className = className; return node; };
const yearLabel = (year: number) => year <= 0 ? `${1 - year} BCE` : `${year} CE`;
const timeLabel = (record: EvidenceRecord) => record.time ? record.time.startYear === record.time.endYear ? yearLabel(record.time.startYear) : `${yearLabel(record.time.startYear)}–${yearLabel(record.time.endYear)}` : 'Unknown time · reference only';
export function mountEvidenceView(host: HTMLElement, select: (entityId: string, recordId: string) => void, signal: AbortSignal, seekYear?: (year: number) => void) {
  const root = element('section', '', 'imported-evidence'); root.hidden = true; root.setAttribute('aria-label', 'Imported source evidence');
  const title = element('h3', 'Retrieved evidence'), note = element('p', '', 'research-chart-note'), context = element('p', '', 'hud-cursor-context');
  const wrap = element('div', '', 'research-table-scroll'); wrap.tabIndex = 0; wrap.setAttribute('aria-label', 'Imported evidence table');
  const evidence = element('section', '', 'research-evidence imported-evidence-inspector'); evidence.setAttribute('aria-label', 'Imported record source');
  const visualizationHost = element('div');
  root.append(title, note, context, visualizationHost, wrap, evidence); host.append(root);
  const visualization = mountVisualizationView(visualizationHost, select, signal);
  let previous: EvidenceWorkspace | null = null, selectedKey = '';
  const rows = new Map<string, HTMLTableRowElement>();
  wrap.addEventListener('click', event => { const id = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-import-record]')?.dataset.importRecord : undefined; const row = previous?.bundle.records.find(record => record.id === id); if (row) select(row.entityId, row.id); }, { signal });
  root.addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key) && event.target instanceof Element && event.target.closest('button')) event.stopPropagation(); }, { signal });
  evidence.addEventListener('click', event => { const id = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-import-browse]')?.dataset.importBrowse : undefined; const record = previous?.bundle.records.find(record => record.id === id); if (record?.time) seekYear?.(record.time.startYear); }, { signal });
  signal.addEventListener('abort', () => { rows.clear(); previous = null; root.remove(); }, { once: true });
  return { listeners: 3 + visualization.listeners, render(result: EvidenceWorkspace | null, selection: ViewSelection | null, cursorYear: number) {
    visualization.render(result, selection, cursorYear); root.hidden = result === null;
    if (result !== previous) {
      previous = result; rows.clear(); wrap.replaceChildren(); selectedKey = '';
      if (result) {
        title.textContent = `${result.bundle.records.length} unreviewed source records`;
        note.textContent = 'Unreviewed local preview, not published history. Select a record for source metadata, unknown support and limitations.';
        const table = element('table'), head = element('thead'), header = element('tr'), body = element('tbody');
        table.append(element('caption', 'Source observations without inferred arithmetic or joins. Select a record for provenance.'));
        for (const text of ['Entity / record', 'Temporal support', 'Value / unit', 'Spatial support']) header.append(element('th', text)); head.append(header);
        for (const record of result.bundle.records) {
          const row = element('tr'); row.dataset.researchRow = record.id;
          const label = element('td'), button = element('button', record.label); button.type = 'button'; button.dataset.importRecord = record.id; button.setAttribute('aria-pressed', 'false'); label.append(button);
          row.append(label, element('td', timeLabel(record)), element('td', record.value === null ? 'Not supplied' : `${record.value}${record.unit ? ` ${record.unit}` : ' · unit not supplied'}`), element('td', record.geometry?.type ?? 'Unknown'));
          rows.set(record.id, row); body.append(row);
        }
        table.append(head, body); wrap.append(table);
      }
    }
    if (!result) return;
    const known = result.bundle.records.filter(record => evidenceAtCursor(record, cursorYear)).length, unknown = result.bundle.records.filter(record => !record.time).length;
    context.textContent = `${known} dated records at ${yearLabel(Math.floor(cursorYear))}; ${unknown} undated references remain explicitly unknown. Analysis scope stays pinned.`;
    for (const record of result.bundle.records) {
      const row = rows.get(record.id)!, selected = selection?.observationId === record.id && selection.entityId === record.entityId;
      row.dataset.atCursor = record.time ? String(evidenceAtCursor(record, cursorYear)) : 'unknown'; row.dataset.selected = String(selected); row.querySelector('button')!.setAttribute('aria-pressed', String(selected));
    }
    const record = result.bundle.records.find(record => record.id === selection?.observationId && record.entityId === selection?.entityId), key = `${result.bundle.resultHash}:${record?.id ?? ''}`;
    if (key === selectedKey) return; selectedKey = key;
    evidence.replaceChildren(element('h4', 'Trace the imported record')); evidence.dataset.recordId = record?.id ?? '';
    if (!record) { evidence.append(element('p', 'Select a row or a mapped record to inspect its source.')); return; }
    evidence.append(element('h5', record.label)); const details = element('dl');
    for (const [name, value] of [['Variable', record.variable], ['Value', record.value === null ? 'Not supplied' : String(record.value)], ['Unit', record.unit ?? 'Not supplied; arithmetic unavailable'], ['Temporal support', `${timeLabel(record)}${record.time ? ` · ${record.time.meaning}` : ''}`], ['Spatial support', record.geometry ? JSON.stringify(record.geometry) : 'Unknown; never geocoded'], ['Evidence', `${record.evidenceType} · ${record.reviewStatus}`], ['Uncertainty', record.uncertainty ?? 'Not supplied'], ['Source', record.source.title], ['Locator', record.source.locator], ['Edition', record.source.edition], ['Source SHA-256', record.source.contentHash], ['Record SHA-256', record.recordHash], ['Model processing', 'Not authorized; source data stays out of model requests']]) {
      const group = element('div'); group.append(element('dt', name), element('dd', value)); details.append(group);
    }
    evidence.append(details); for (const limitation of record.limitations) evidence.append(element('p', limitation));
    const qid = record.source.adapterId === 'wikidata' ? /^wikidata:(Q[1-9]\d{0,11})$/.exec(record.entityId)?.[1] : undefined;
    if (qid) { const link = element('a', `Inspect Wikidata ${qid}`); link.href = `https://www.wikidata.org/wiki/${qid}`; link.target = '_blank'; link.rel = 'noopener noreferrer'; evidence.append(link); }
    if (record.time && seekYear) { const browse = element('button', `Browse ${yearLabel(record.time.startYear)}`); browse.type = 'button'; browse.dataset.importBrowse = record.id; evidence.append(element('p', 'Moves the Atlas browsing cursor only; no exact event day or operating interval is asserted.'), browse); }
  } };
}
export interface EvidenceIntakeActions {
  importFile(file: File): Promise<boolean>;
  search(question: string, sourceId: string, allowRemote: boolean): Promise<boolean>;
  clear(): void;
}
export function mountEvidenceIntake(host: HTMLElement, dropHost: HTMLElement, actions: EvidenceIntakeActions, signal: AbortSignal) {
  const root = element('details', '', 'evidence-intake'); root.append(element('summary', 'Import or retrieve evidence'));
  const note = element('p', 'Drop one CSV, GeoJSON or JSON-LD file here, or choose a file. Maximum 4 MiB / 2,000 records. Imports remain in browser memory and disappear on reload; no automatic uploads.');
  const file = element('input'); file.type = 'file'; file.accept = '.csv,.geojson,.jsonld,.json,text/csv,application/geo+json,application/ld+json'; file.setAttribute('aria-label', 'Import evidence file');
  const help = element('details'); help.append(element('summary', 'Accepted fields and limitations'), element('p', 'CSV requires id,label. Optional: variable,value,unit,startYear,endYear,longitude,latitude,source,edition,locator,uncertainty,evidenceType. A value requires its variable. Years use astronomical numbering (0 = 1 BCE); coordinates require both longitude and latitude. Blank metadata remains unknown.'), element('p', 'GeoJSON accepts a FeatureCollection of Point or Polygon features with these properties and stable IDs. JSON-LD accepts a schema.org @graph with @id,@type,name,description,startDate,endDate,citation,version,geo; dates must be integer years. Remote contexts and unsupported fields are rejected, not fetched or silently discarded.'));
  const form = element('form'), query = element('input'); query.type = 'search'; query.maxLength = 500; query.setAttribute('aria-label', 'Evidence search'); query.placeholder = 'Search imported records or Wikidata';
  const source = element('select'); source.setAttribute('aria-label', 'Evidence source'); for (const [id, label] of [['local-files', 'Imported files (local)'], ['wikidata', 'Wikidata (public network)']]) { const option = element('option', label); option.value = id; source.append(option); }
  const consentLabel = element('label'), consent = element('input'); consent.type = 'checkbox'; consentLabel.append(consent, document.createTextNode(' Allow this search text to be sent to Wikidata (not Gemini)'));
  const submit = element('button', 'Retrieve evidence'); submit.type = 'submit'; const status = element('p', '', 'research-input-status'); status.setAttribute('role', 'status');
  const clear = element('button', 'Clear imported evidence cache'); clear.type = 'button';
  let generation = 0;
  const run = async (operation: () => Promise<boolean>) => {
    const current = ++generation; root.open = true; status.textContent = 'Validating source evidence…';
    try { const ok = await operation(); if (!signal.aborted && current === generation) { status.textContent = ok ? 'Source records loaded. They are unreviewed and were not sent to a model.' : 'Evidence rejected or unavailable. The previous valid result is retained.'; if (ok) root.open = false; } }
    catch { if (!signal.aborted && current === generation) status.textContent = 'Evidence unavailable. The previous valid result is retained.'; }
  };
  file.addEventListener('change', () => { const selected = file.files?.[0]; if (selected) void run(() => actions.importFile(selected)); file.value = ''; }, { signal });
  form.addEventListener('submit', event => { event.preventDefault(); if (source.value === 'wikidata' && (!consent.checked || !query.value.trim())) { status.textContent = 'Wikidata requires a search term and explicit network consent.'; return; } void run(() => actions.search(query.value.trim(), source.value, source.value === 'wikidata' && consent.checked)); }, { signal });
  dropHost.addEventListener('dragover', event => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault(); }, { signal });
  dropHost.addEventListener('drop', event => { if (!event.dataTransfer?.types.includes('Files')) return; event.preventDefault(); event.stopPropagation(); root.open = true; if (event.dataTransfer.files.length !== 1) { status.textContent = 'Import one evidence file at a time.'; return; } void run(() => actions.importFile(event.dataTransfer!.files[0])); }, { signal });
  clear.addEventListener('click', () => { generation++; actions.clear(); status.textContent = 'Browser-local imported evidence cache cleared. Reimport matching files before reopening a saved reference-only replay.'; }, { signal });
  signal.addEventListener('abort', () => { generation++; root.remove(); }, { once: true });
  form.append(query, source, consentLabel, submit); root.append(note, file, help, form, clear, status); host.append(root);
  return { listeners: 5, show() { root.open = true; root.scrollIntoView({ block: 'nearest' }); file.focus(); } };
}
