/** Host-rendered mechanism tables and evidence. DOM text only: no map, canvas, SVG, markup strings or external loads. */
import { resolveMechanismSelection } from '@chronicle/runtime/mechanism';
import type { MechanismResult } from '@chronicle/runtime/mechanism-engine';
import './mechanism.css';

export interface MechanismViewState {
  readonly revision: number;
  readonly cursorYear: number;
  readonly result: MechanismResult | null;
  readonly selection: { readonly entityId: string; readonly observationId: string } | null;
}
export type MechanismSelect = (rowId: string, claimId: string, origin: 'component-table' | 'function-table') => void;
const yearLabel = (year: number) => year <= 0 ? `${1 - year} BCE` : `${year} CE`;
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag); element.textContent = text;
  if (className) element.className = className;
  return element;
}

export function mountMechanismView(container: HTMLElement, select: MechanismSelect, signal: AbortSignal): { render(state: MechanismViewState): void } {
  container.classList.add('research-result', 'mechanism-workspace'); container.hidden = true;
  container.dataset.domain = 'technological-mechanism';
  const title = node('h3'), scope = node('p', '', 'research-scope'), summary = node('div', '', 'research-summary');
  const notes = node('div', '', 'mechanism-notes');
  const tables = new Map<'component-table' | 'function-table', { section: HTMLElement; body: HTMLTableSectionElement }>();
  for (const [type, label, columns] of [
    ['component-table', 'Components', ['Component · patent term', 'Role (paraphrase)', 'Functions', 'Evidence']],
    ['function-table', 'Operational functions', ['Principle', 'Function (paraphrase)', 'Components', 'Evidence']],
  ] as const) {
    const section = node('section', '', 'mechanism-table'); section.dataset.view = type; section.setAttribute('aria-label', label);
    const wrap = node('div', '', 'research-table-scroll'); wrap.tabIndex = 0; wrap.dataset.origin = type; wrap.setAttribute('aria-label', `Scrollable ${label.toLowerCase()} table`);
    const table = node('table'), head = node('thead'), headRow = node('tr'), body = node('tbody');
    table.append(node('caption', 'Row wording is a host paraphrase. Every evidence link opens a quotation verified verbatim against the pinned excerpt.'));
    for (const column of columns) { const cell = node('th', column); cell.scope = 'col'; headRow.append(cell); }
    head.append(headRow); table.append(head, body); wrap.append(table); section.append(node('h4', label), wrap);
    tables.set(type, { section, body });
  }
  const evidence = node('section', '', 'research-evidence mechanism-evidence'); evidence.setAttribute('aria-label', 'Selected mechanism evidence');
  container.append(title, scope, summary, notes, tables.get('component-table')!.section, tables.get('function-table')!.section, evidence);
  container.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button[data-mechanism-claim]') : null;
    const origin = target?.closest<HTMLElement>('[data-origin]')?.dataset.origin;
    if (!target || !container.contains(target) || (origin !== 'component-table' && origin !== 'function-table')) return;
    event.stopPropagation(); select(target.dataset.mechanismRow!, target.dataset.mechanismClaim!, origin);
  }, { signal });

  let paintedResult: MechanismResult | null = null, paintedSelection = '', paintedCursor = Number.NaN;
  const rows = new Map<string, HTMLTableRowElement>(), claimButtons: HTMLButtonElement[] = [];
  function heading(label: string, detail: string) {
    const cell = node('th'); cell.scope = 'row';
    cell.append(node('span', label), node('small', detail, 'mechanism-detail')); return cell;
  }
  function list(items: readonly string[], empty: string) {
    const cell = node('td');
    if (!items.length) { cell.textContent = empty; return cell; }
    const values = node('ul', '', 'mechanism-list'); values.append(...items.map(item => node('li', item))); cell.append(values); return cell;
  }
  function claimCell(rowId: string, claimIds: readonly string[], result: MechanismResult) {
    const cell = node('td'), list = node('div', '', 'mechanism-claims');
    for (const claimId of claimIds) {
      const claim = result.bundle.claims.find(item => item.id === claimId)!;
      const control = node('button', claim.locator); control.type = 'button';
      control.dataset.mechanismRow = rowId; control.dataset.mechanismClaim = claimId; control.setAttribute('aria-pressed', 'false');
      control.setAttribute('aria-label', `Inspect evidence: ${claim.locator}`);
      claimButtons.push(control); list.append(control);
    }
    cell.append(list); return cell;
  }
  function paintRows(result: MechanismResult) {
    const { bundle, spec } = result, labels = new Map(bundle.components.map(item => [item.id, item.label]));
    rows.clear(); claimButtons.length = 0;
    title.textContent = spec.title;
    scope.textContent = 'Technological mechanism · no map geometry · component and function tables linked to source quotations';
    const verified = bundle.claims.length, attested = bundle.claims.filter(item => item.evidence === 'attested-specification-text').length;
    const metrics: [string, string][] = [[String(bundle.components.length), 'components'], [String(bundle.functions.length), 'functions'], [String(verified), `quotations verified (${attested} specification text)`]];
    summary.replaceChildren(...metrics.map(([value, label]) => { const item = node('div'); item.append(node('strong', value), node('span', label)); return item; }));
    const purpose = bundle.claims.find(item => item.id === bundle.statedPurposeClaimId)!;
    notes.replaceChildren(
      node('p', `Stated purpose (quoted): “${purpose.quote}”`, 'mechanism-note'),
      node('p', `Spatial support: not applicable. ${bundle.spatialSupport.note}`, 'mechanism-note'),
      node('p', bundle.coverage.note, 'mechanism-note'),
      ...bundle.coverage.omissions.map(item => node('p', `Coverage gap: ${item.label}`, 'mechanism-note mechanism-gap')),
    );
    const usedBy = new Map<string, string[]>();
    for (const fn of bundle.functions) for (const component of fn.componentIds) usedBy.set(component, [...(usedBy.get(component) ?? []), fn.label]);
    const componentBody = tables.get('component-table')!.body, functionBody = tables.get('function-table')!.body;
    componentBody.replaceChildren(...bundle.components.map(component => {
      const row = node('tr'); row.dataset.mechanismRow = component.id; row.dataset.rowKind = 'component';
      row.append(heading(component.label, `Patent term: ${component.sourceTerm}`), node('td', component.role), list(usedBy.get(component.id) ?? [], 'None'), claimCell(component.id, component.claimIds, result));
      rows.set(component.id, row); return row;
    }));
    functionBody.replaceChildren(...bundle.functions.map(fn => {
      const row = node('tr'); row.dataset.mechanismRow = fn.id; row.dataset.rowKind = 'function';
      row.append(node('td', fn.principle), heading(fn.label, fn.statement), list(fn.componentIds.map(id => labels.get(id)!), fn.componentNote ?? ''), claimCell(fn.id, fn.claimIds, result));
      rows.set(fn.id, row); return row;
    }));
    const visible = new Set(spec.views.map(view => view.type));
    for (const [type, table] of tables) table.section.hidden = !visible.has(type);
    evidence.hidden = !visible.has('evidence'); summary.hidden = !visible.has('summary');
  }
  function paintSelection(state: MechanismViewState, result: MechanismResult) {
    const resolved = resolveMechanismSelection(result.bundle, state.selection);
    const related = new Set<string>();
    if (resolved?.kind === 'component') for (const fn of result.bundle.functions) { if (fn.componentIds.includes(resolved.row.id)) related.add(fn.id); }
    if (resolved?.kind === 'function') for (const id of (resolved.row as { componentIds: readonly string[] }).componentIds) related.add(id);
    for (const [id, row] of rows) { row.dataset.selected = String(resolved?.row.id === id); row.dataset.related = String(related.has(id)); }
    for (const control of claimButtons) control.setAttribute('aria-pressed', String(resolved?.row.id === control.dataset.mechanismRow && resolved?.claim.id === control.dataset.mechanismClaim));
    evidence.dataset.rowId = resolved?.row.id ?? ''; evidence.dataset.claimId = resolved?.claim.id ?? '';
    evidence.replaceChildren(node('h4', 'Trace a mechanism claim'));
    if (!resolved) { evidence.append(node('p', 'Select an evidence link in either table to read the exact quotation and its source pins.')); return; }
    const { bundle } = result, source = bundle.source, passage = source.passages.find(item => item.id === resolved.claim.passageId)!;
    evidence.append(node('h5', `${resolved.row.label} · ${resolved.kind}`), node('blockquote', resolved.claim.quote, 'mechanism-quote'));
    evidence.append(node('p', 'Row wording is a host paraphrase. The quotation is the evidence; it has not been scholarly reviewed.', 'research-chart-note'));
    const details = node('dl');
    const fields: [string, string][] = [
      ['Locator', resolved.claim.locator],
      ['Evidence', resolved.claim.evidence === 'attested-specification-text' ? 'Patent specification text, as reprinted' : 'Reprint editorial statement, not patent text'],
      ['Review', resolved.claim.reviewStatus],
      ['Passage', `${passage.id} · bytes ${passage.byteRange[0]}–${passage.byteRange[1]} · SHA-256 ${passage.sha256}`],
      ['Source', source.title], ['Edition', source.edition],
      ['Retrieved', `${source.retrieval.url} · ${source.retrieval.retrievedOn}`], ['Upstream SHA-256', source.retrieval.upstreamSha256],
      ['Primary record', `${source.primaryRecord.label} · ${source.primaryRecord.status} · SHA-256 ${source.primaryRecord.sha256}`],
      ['Rights', 'Public-domain text · model processing disabled · republication not approved'],
      ['Time support', `${yearLabel(bundle.temporalSupport.startYear)}. ${bundle.temporalSupport.meaning}`],
    ];
    for (const [name, value] of fields) { const group = node('div'); group.append(node('dt', name), node('dd', value)); details.append(group); }
    evidence.append(details, ...source.limitations.map(limitation => node('p', limitation, 'mechanism-note')));
  }
  return {
    render(state) {
      const result = state.result;
      container.hidden = !result;
      if (!result) { paintedResult = null; paintedSelection = ''; return; }
      if (paintedResult !== result) { paintedResult = result; paintedSelection = ''; paintRows(result); }
      if (paintedCursor !== state.cursorYear || paintedSelection === '') {
        paintedCursor = state.cursorYear;
        container.dataset.cursorYear = String(state.cursorYear);
        scope.title = `Browsing cursor ${yearLabel(Math.floor(state.cursorYear))}; mechanism rows are not filtered by the cursor.`;
      }
      const key = `${state.revision}:${state.selection?.entityId ?? ''}:${state.selection?.observationId ?? ''}`;
      if (key !== paintedSelection) { paintedSelection = key; paintSelection(state, result); }
      container.dataset.revision = String(state.revision);
    },
  };
}
