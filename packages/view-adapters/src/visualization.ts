import { createRenderSpecification, validateRenderInput, VisualizationError, type SandboxedRenderSpecification, type SafeSVGNode } from '@chronicle/contracts/visualization';
import { evidenceAtCursor, type EvidenceWorkspace } from '@chronicle/contracts/evidence';
import type { ViewSelection } from './interfaces.ts';
import { VisualizationClient } from './visualization-client.ts';

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className?: string): HTMLElementTagNameMap[K] => { const node = document.createElement(tag); node.textContent = text; if (className) node.className = className; return node; };
export function preparedRenderSpecification(result: EvidenceWorkspace): SandboxedRenderSpecification {
  if (result.bundle.records.length > 12) throw new VisualizationError('INPUT_LIMIT');
  const height = Math.max(120, result.bundle.records.length * 52 + 20);
  const program = `const escape = value => String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\\\"":"&quot;","'":"&apos;"}[c]));
return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 ${height}">' + evidence.map((row,index) => '<g data-record-id="' + escape(row.id) + '" transform="translate(10 ' + (index*52+10) + ')"><rect x="0" y="0" width="620" height="46" rx="6" fill="#e8f3f5" stroke="#8db4bd"/><text x="12" y="20" font-size="14" fill="#183b49">' + escape(row.label) + '</text><text x="12" y="37" font-size="10" fill="#183b49">' + escape(row.variable) + '</text></g>').join('') + '</svg>';`;
  return createRenderSpecification(result.bundle, program, { width: 640, height });
}
function nativeSVG(node: SafeSVGNode): SVGElement {
  const result = document.createElementNS('http://www.w3.org/2000/svg', node.tag);
  for (const [name, value] of Object.entries(node.attributes)) result.setAttribute(name, value);
  if (node.text) result.append(document.createTextNode(node.text));
  for (const child of node.children) result.append(nativeSVG(child));
  return result;
}
export function mountVisualizationView(host: HTMLElement, select: (entityId: string, recordId: string) => void, signal: AbortSignal) {
  const root = element('details', '', 'visualization-preview'); root.append(element('summary', 'Sandboxed visualization'));
  const note = element('p', 'Optional local code preview: QuickJS/WASM, 50 ms, 8 MiB guest heap. Host-approved static SVG only; no network, files or host objects. This is an unreviewed record layout, not a numerical analysis or an inferred relationship.');
  const prepared = element('button', 'Run prepared sandbox layout'); prepared.type = 'button';
  const file = element('input'); file.type = 'file'; file.accept = '.json,application/json'; file.setAttribute('aria-label', 'Choose a sandboxed render specification');
  const run = element('button', 'Run loaded sandbox specification'); run.type = 'button'; run.disabled = true;
  const cancel = element('button', 'Cancel visualization'); cancel.type = 'button';
  const status = element('p', 'No generated code runs until a preview button is selected.', 'visualization-status'); status.setAttribute('role', 'status');
  const surface = element('div', '', 'visualization-surface'); surface.tabIndex = 0; surface.setAttribute('aria-label', 'Sandboxed record layout');
  const fallback = element('p', 'Static fallback: use the source-bound evidence table and inspector.', 'visualization-fallback');
  root.append(note, prepared, file, run, cancel, status, surface, fallback); host.append(root);
  const client = new VisualizationClient(); let current: EvidenceWorkspace | null = null, selected: ViewSelection | null = null, year = 0, loaded: SandboxedRenderSpecification | null = null, generation = 0;
  const controls = (busy: boolean) => { prepared.disabled = busy || !current; run.disabled = busy || !loaded; cancel.disabled = !busy; };
  const refresh = () => {
    for (const node of surface.querySelectorAll<SVGElement>('[data-record-id]')) {
      const record = current?.bundle.records.find(record => record.id === node.dataset.recordId); if (!record) continue;
      node.setAttribute('role', 'button'); node.setAttribute('tabindex', '0'); node.setAttribute('aria-label', `${record.label}: inspect source`);
      node.dataset.researchRow = record.id; node.dataset.atCursor = record.time ? String(evidenceAtCursor(record, year)) : 'unknown';
      node.setAttribute('aria-pressed', String(record.id === selected?.observationId));
    }
    const diagnostics = client.diagnostics(); root.dataset.activeWorkers = String(diagnostics.activeWorkers); root.dataset.launches = String(diagnostics.launches); root.dataset.terminations = String(diagnostics.terminations);
  };
  const execute = async (specification: SandboxedRenderSpecification) => {
    if (!current) return; const token = ++generation, result = current; root.open = true; surface.replaceChildren(); fallback.hidden = false; root.dataset.status = 'running'; status.textContent = 'Executing a bounded, local visualization guest…'; controls(true);
    const pending = client.execute(specification, result.bundle, signal); refresh(); const output = await pending;
    if (signal.aborted || token !== generation || current?.bundle.resultHash !== result.bundle.resultHash) return;
    if (output.status === 'rendered') { surface.replaceChildren(nativeSVG(output.tree)); fallback.hidden = true; status.textContent = 'Validated local SVG layout. No model call was made by this preview.'; root.dataset.status = 'rendered'; }
    else { status.textContent = `Static fallback: ${output.code}. No guest output was activated.`; root.dataset.status = 'fallback'; }
    root.dataset.elapsedMs = String(output.elapsedMs); controls(false); refresh();
  };
  prepared.addEventListener('click', () => { if (!current) return; try { void execute(preparedRenderSpecification(current)); } catch { status.textContent = 'Static fallback: the prepared layout supports up to 12 bounded records.'; root.dataset.status = 'fallback'; } }, { signal });
  file.addEventListener('change', async () => {
    const selected = file.files?.[0], result = current; if (!selected || !result) return; const token = ++generation; client.cancel(); loaded = null; surface.replaceChildren(); fallback.hidden = false; root.dataset.status = 'idle'; controls(false);
    try { if (selected.size > 32768) throw new Error('LIMIT'); const text = await selected.text(); if (signal.aborted || token !== generation || current !== result) return; loaded = validateRenderInput(text, result.bundle).specification; run.disabled = false; status.textContent = 'Specification validated against the current evidence. Select Run loaded sandbox specification to execute it.'; }
    catch { if (!signal.aborted && token === generation) { status.textContent = 'Specification rejected. Current evidence is unchanged.'; root.dataset.status = 'fallback'; } }
    file.value = ''; refresh();
  }, { signal });
  run.addEventListener('click', () => { if (loaded) void execute(loaded); }, { signal });
  cancel.addEventListener('click', () => { generation++; client.cancel(); surface.replaceChildren(); fallback.hidden = false; status.textContent = 'Static fallback: visualization cancelled.'; root.dataset.status = 'fallback'; controls(false); refresh(); }, { signal });
  const activate = (target: EventTarget | null) => { const mark = target instanceof Element ? target.closest<SVGElement>('[data-record-id]') : null, record = current?.bundle.records.find(record => record.id === mark?.dataset.recordId); if (record) select(record.entityId, record.id); };
  surface.addEventListener('click', event => activate(event.target), { signal });
  surface.addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key) && event.target instanceof Element && event.target.closest('[data-record-id]')) { event.preventDefault(); event.stopPropagation(); activate(event.target); } }, { signal });
  signal.addEventListener('abort', () => { generation++; client.dispose(); current = null; loaded = null; root.remove(); }, { once: true });
  return { listeners: 6, render(result: EvidenceWorkspace | null, selection: ViewSelection | null, cursorYear: number) {
    if (result?.bundle.resultHash !== current?.bundle.resultHash) { generation++; client.cancel(); loaded = null; surface.replaceChildren(); fallback.hidden = false; root.dataset.status = 'idle'; status.textContent = 'No generated code runs until a preview button is selected.'; }
    current = result; selected = selection; year = cursorYear; controls(root.dataset.status === 'running'); refresh();
  } };
}
