import { MechanismController, MechanismEngine } from '@chronicle/runtime/mechanism-engine';
import { MECHANISM_LIMITS } from '@chronicle/contracts/mechanism';
import { mountChronicleOmnibar, mountHudDrag, mountMechanismGraph, mountMechanismView } from '@chronicle/view-adapters';
import '@chronicle/view-adapters/styles.css';
import './style.css';

const lifetime = new AbortController(), signal = lifetime.signal;
const sourceURL = new URL('../../explorer/src/domains/watt-mechanism/source/watt-1769-specification.json', import.meta.url);
const datasetURL = new URL('../../explorer/src/domains/watt-mechanism/data/watt-1769-mechanism.json', import.meta.url);
async function load(url: URL, limit: number, signal: AbortSignal): Promise<string> {
  const response = await fetch(url, { signal, credentials: 'same-origin', redirect: 'error' });
  if (!response.ok || !response.body) throw new Error('PINNED_DATA_UNAVAILABLE');
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > limit) { await reader.cancel(); throw new Error('DATA_BUDGET_EXCEEDED'); } chunks.push(value); }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
const engine = new MechanismEngine({
  datasetId: 'watt-separate-condenser-1769', workspaceId: 'watt-separate-condenser-workspace',
  pins: { sourceHash: '26954b0bad98e7e7e99c2ad1fae2c0039cc82320269a2eb0283c152276310f90', datasetHash: '82bb7090501b0a1ced4d49634f291a9f6d67bdc732791952b735f1f07eb90ad8' },
  loader: { source: signal => load(sourceURL, MECHANISM_LIMITS.sourceBytes, signal), dataset: signal => load(datasetURL, MECHANISM_LIMITS.datasetBytes, signal) },
});
const controller = new MechanismController(1769, engine);
const create = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag); node.textContent = text; if (className) node.className = className; return node;
};
document.body.classList.add('chronicle-glass', 'mechanism-app');
const workspace = create('main', '', 'workspace mechanism-demo');
const brand = create('header', '', 'mechanism-brand'); brand.append(create('h1', 'Chronicle · Mechanism Explorer'), create('p', 'Shared runtime and view adapters · no geographic renderer'));
const card = create('section', '', 'research-workspace'); card.setAttribute('aria-label', 'Mechanism workspace');
const heading = create('div', '', 'research-heading'); heading.append(create('h2', 'Evidence without a map'));
const graphButton = create('button', 'Graph'); graphButton.type = 'button'; heading.append(graphButton);
const status = create('p', '', 'research-status'); status.id = 'mechanism-status'; status.setAttribute('role', 'status');
const content = create('div');
const replay = create('details', '', 'research-replay'); replay.append(create('summary', 'Save or reopen this research'));
const save = create('button', 'Save replay JSON'); save.type = 'button';
const input = create('textarea'); input.rows = 4; input.maxLength = MECHANISM_LIMITS.replayBytes; input.setAttribute('aria-label', 'Pinned replay JSON');
const file = create('input'); file.type = 'file'; file.accept = '.json,application/json'; file.setAttribute('aria-label', 'Choose a saved research replay');
const reopen = create('button', 'Reopen pinned result'); reopen.type = 'button';
const replayStatus = create('p', '', 'research-replay-status'); replayStatus.setAttribute('role', 'status');
replay.append(save, input, file, reopen, replayStatus); card.append(heading, status, content, replay);
const dock = create('section', '', 'mechanism-time'); dock.setAttribute('aria-label', 'Historical browsing context');
const yearLabel = create('label', 'Browsing year (0 = 1 BCE) '), year = create('input'); year.type = 'number'; year.min = '-12000'; year.max = '3000'; year.step = '1'; year.value = '1769'; year.setAttribute('aria-label', 'Browsing year'); yearLabel.append(year);
const cursor = create('input'); cursor.type = 'range'; cursor.min = '-12000'; cursor.max = '3000'; cursor.step = '1'; cursor.value = '1769'; cursor.setAttribute('aria-label', 'Historical context slider');
const reset = create('button', 'Reset mechanism'); reset.type = 'button';
dock.append(yearLabel, cursor, reset, create('p', 'The patent year is source context, not a claim of construction or continuous operation. Browsing does not invent a validity interval.'));
workspace.append(brand, card, dock); document.querySelector('#app')!.append(workspace);
const select = (entityId: string, observationId: string, origin: string) => controller.dispatch({ type: 'select', entityId, observationId, origin, revision: controller.getSnapshot().revision });
const view = mountMechanismView(content, select, signal);
const graph = mountMechanismGraph(workspace, (row, claim) => { select(row, claim, 'mechanism-graph'); }, signal);
mountHudDrag(card, heading, workspace, () => {}, signal);
const omnibar = mountChronicleOmnibar(workspace, [{ id: engine.datasetId, title: 'Watt separate-condenser mechanism', question: 'Watt separate-condenser mechanism' }], (question, choice) => {
  if (choice === engine.datasetId || question === 'Watt separate-condenser mechanism') void controller.open();
  else omnibar.setStatus('Unsupported prepared question. No model request was made; the current evidence is retained.');
}, signal);
graphButton.addEventListener('click', () => graph.show(), { signal });
reset.addEventListener('click', () => { void controller.open(); }, { signal });
for (const control of [year, cursor]) control.addEventListener('input', () => { controller.dispatch({ type: 'cursor', year: control.valueAsNumber, origin: 'mechanism-context', revision: controller.getSnapshot().revision }); }, { signal });
save.addEventListener('click', () => {
  try {
    const text = controller.exportManifest(); input.value = text;
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' })), anchor = create('a'); anchor.href = url; anchor.download = 'Chronicle-Mechanism-Replay.json'; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); replayStatus.textContent = 'Pinned replay is ready.';
  } catch { replayStatus.textContent = 'No validated mechanism is ready to save.'; }
}, { signal });
let readGeneration = 0;
file.addEventListener('change', async () => {
  const selected = file.files?.[0], generation = ++readGeneration; if (!selected) return;
  if (selected.size > MECHANISM_LIMITS.replayBytes) { replayStatus.textContent = 'Replay exceeds 64 KiB.'; return; }
  const text = await selected.text(); if (signal.aborted || generation !== readGeneration) return;
  input.value = text; replayStatus.textContent = 'File read. Select Reopen pinned result to validate it.';
}, { signal });
reopen.addEventListener('click', () => { void controller.replay(input.value).then(ok => { if (!signal.aborted) replayStatus.textContent = ok ? 'Reopened against matching local source records.' : 'Replay rejected. Previous evidence is retained.'; }); }, { signal });
const unsubscribe = controller.subscribe(state => {
  workspace.dataset.status = state.status; workspace.dataset.revision = String(state.revision); workspace.dataset.cursorYear = String(state.cursorYear);
  status.dataset.status = state.status; status.textContent = state.message; save.disabled = !state.active;
  year.value = cursor.value = String(state.cursorYear);
  view.render({ revision: state.revision, cursorYear: state.cursorYear, result: state.active, selection: state.selection });
  graph.render(state.active?.bundle ?? null, state.selection, state.cursorYear, true);
  omnibar.setStatus(state.message, state.status === 'loading');
});
void controller.open();
function dispose() { if (signal.aborted) return; readGeneration++; unsubscribe(); controller.dispose(); lifetime.abort(); }
window.addEventListener('pagehide', dispose, { once: true });
if (import.meta.hot) import.meta.hot.dispose(dispose);
