import { clampHudPosition, queryShortcut, type HudPosition } from './hud-contract.ts';
import type { MechanismBundle } from '@chronicle/runtime/mechanism';
import './hud.css';

const create = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag); node.textContent = text; if (className) node.className = className; return node;
};
export interface OmnibarChoice { readonly id: string; readonly title: string; readonly question: string }
export function mountChronicleOmnibar(host: HTMLElement, choices: readonly OmnibarChoice[], request: (question: string, choice?: string) => void, signal: AbortSignal) {
  const root = create('section', '', 'chronicle-omnibar'); root.id = 'chronicle-omnibar'; root.setAttribute('aria-label', 'Research query omnibar');
  const form = create('form'), input = create('input'); input.type = 'search'; input.maxLength = 1000; input.placeholder = 'Ask the local evidence catalogue'; input.setAttribute('aria-label', 'Research query'); input.autocomplete = 'off';
  const submit = create('button', 'Research'); submit.type = 'submit';
  const shortcut = create('kbd', '/ · Ctrl K', 'omnibar-shortcut'); shortcut.setAttribute('aria-hidden', 'true');
  const examples = create('details', '', 'omnibar-examples'), summary = create('summary', 'Examples'), menu = create('div', '', 'omnibar-options'); examples.append(summary, menu);
  for (const choice of choices) { const button = create('button', choice.title); button.type = 'button'; button.dataset.omnibarChoice = choice.id; menu.append(button); }
  const status = create('p', 'Local prepared catalogue · model processing is off', 'omnibar-status'); status.setAttribute('role', 'status');
  form.append(input, shortcut, submit, examples); root.append(form, status); host.append(root);
  form.addEventListener('submit', event => { event.preventDefault(); const question = input.value.trim(); if (question) { examples.open = false; request(question); } }, { signal });
  menu.addEventListener('click', event => {
    const id = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-omnibar-choice]')?.dataset.omnibarChoice : undefined;
    const choice = choices.find(item => item.id === id); if (!choice) return;
    input.value = choice.question; examples.open = false; request(choice.question, choice.id);
  }, { signal });
  document.addEventListener('keydown', event => {
    const editing = event.target instanceof Element && !!event.target.closest('input,textarea,select,[contenteditable="true"]');
    if (!queryShortcut({ key: event.key, ctrlKey: event.ctrlKey, metaKey: event.metaKey, altKey: event.altKey, isComposing: event.isComposing, editing })) return;
    event.preventDefault(); event.stopPropagation(); input.focus(); input.select();
  }, { signal, capture: true });
  root.addEventListener('keydown', event => { if (event.key === 'Escape') { examples.open = false; input.blur(); event.stopPropagation(); } }, { signal });
  signal.addEventListener('abort', () => root.remove(), { once: true });
  return { listeners: 4, focus: () => input.focus(), setStatus(text: string, loading = false) { if (status.textContent !== text) status.textContent = text; submit.disabled = loading; } };
}
export function mountHudDrag(card: HTMLElement, handle: HTMLElement, host: HTMLElement, moved: () => void, signal: AbortSignal) {
  let drag: { pointer: number; start: HudPosition; position: HudPosition } | null = null;
  handle.classList.add('hud-drag-handle'); handle.tabIndex = 0; handle.setAttribute('aria-label', 'Move research card with arrow keys or drag');
  const apply = (position: HudPosition) => {
    const root = host.getBoundingClientRect(), size = card.getBoundingClientRect(), dock = Number.parseFloat(getComputedStyle(host).getPropertyValue('--timeline-dock-height')) || 212;
    const top = Number.parseFloat(getComputedStyle(host).getPropertyValue('--research-hud-top')) || (root.width <= 760 ? 186 : 160);
    const clamped = clampHudPosition(position, size, { width: root.width, height: root.height, top, bottom: dock });
    card.style.left = `${clamped.x}px`; card.style.top = `${clamped.y}px`; card.style.right = 'auto';
    card.style.maxHeight = `${Math.max(80, root.height - dock - clamped.y - 10)}px`; moved();
  };
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target instanceof Element && event.target.closest('button,input,summary,a')) return;
    const root = host.getBoundingClientRect(), rect = card.getBoundingClientRect();
    drag = { pointer: event.pointerId, start: { x: event.clientX, y: event.clientY }, position: { x: rect.x - root.x, y: rect.y - root.y } };
    handle.setPointerCapture(event.pointerId); event.preventDefault(); event.stopPropagation();
  }, { signal });
  handle.addEventListener('pointermove', event => { if (drag?.pointer === event.pointerId) apply({ x: drag.position.x + event.clientX - drag.start.x, y: drag.position.y + event.clientY - drag.start.y }); }, { signal });
  const finish = () => { drag = null; };
  handle.addEventListener('pointerup', finish, { signal }); handle.addEventListener('pointercancel', finish, { signal });
  handle.addEventListener('keydown', event => {
    if (event.target !== handle || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const root = host.getBoundingClientRect(), rect = card.getBoundingClientRect(), amount = event.shiftKey ? 40 : 10;
    apply({ x: rect.x - root.x + (event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0), y: rect.y - root.y + (event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0) });
    event.preventDefault(); event.stopPropagation();
  }, { signal });
  window.addEventListener('resize', () => { card.style.removeProperty('left'); card.style.removeProperty('top'); card.style.removeProperty('right'); card.style.removeProperty('max-height'); moved(); }, { signal });
  return { listeners: 6 };
}
export function mountMechanismGraph(host: HTMLElement, select: (rowId: string, claimId: string) => void, signal: AbortSignal) {
  const card = create('section', '', 'chronicle-graph-card'); card.hidden = true; card.setAttribute('aria-label', 'Mechanism relationship graph');
  const heading = create('div', '', 'hud-graph-heading'), title = create('h3', 'Declared mechanism links'), close = create('button', 'Close graph'); close.type = 'button'; heading.append(title, close);
  const note = create('p', 'Component/function associations from cited claims; not a simulation or an inferred operating sequence.', 'research-chart-note');
  const context = create('p', '', 'hud-cursor-context'), surface = create('div', '', 'hud-graph-surface'); surface.tabIndex = 0;
  card.append(heading, note, context, surface); host.append(card);
  let bundle: MechanismBundle | null = null, dismissed = false;
  const xmlns = 'http://www.w3.org/2000/svg';
  const svg = (tag: string, attributes: Record<string, string>, text = '') => { const item = document.createElementNS(xmlns, tag); for (const [name, value] of Object.entries(attributes)) item.setAttribute(name, value); item.textContent = text; return item; };
  close.addEventListener('click', () => { dismissed = true; card.hidden = true; }, { signal });
  surface.addEventListener('click', event => {
    const node = event.target instanceof Element ? event.target.closest('[data-graph-row]') : null;
    if (node) select(node.getAttribute('data-graph-row')!, node.getAttribute('data-graph-claim')!);
  }, { signal });
  surface.addEventListener('keydown', event => {
    if (!['Enter', ' '].includes(event.key) || !(event.target instanceof Element)) return;
    const node = event.target.closest('[data-graph-row]'); if (!node) return;
    event.preventDefault(); event.stopPropagation(); select(node.getAttribute('data-graph-row')!, node.getAttribute('data-graph-claim')!);
  }, { signal });
  const drag = mountHudDrag(card, heading, host, () => {}, signal);
  signal.addEventListener('abort', () => card.remove(), { once: true });
  return {
    listeners: 3 + drag.listeners,
    show() { dismissed = false; card.dataset.expanded = 'true'; if (bundle) card.hidden = false; },
    render(next: MechanismBundle | null, selection: { entityId: string; observationId: string } | null, year: number, open: boolean) {
      if (next !== bundle) {
        bundle = next; dismissed = false; surface.replaceChildren();
        if (next) {
          const height = Math.max(next.components.length, next.functions.length) * 58 + 20;
          const image = svg('svg', { viewBox: `0 0 540 ${height}`, role: 'group', 'aria-label': 'Declared component and function relationships' });
          const componentY = new Map(next.components.map((component, index) => [component.id, 30 + index * 58]));
          next.functions.forEach((fn, index) => { for (const id of fn.componentIds) image.append(svg('line', { x1: '225', y1: String(componentY.get(id)), x2: '315', y2: String(30 + index * 58), class: 'hud-graph-link', 'data-graph-component': id, 'data-graph-function': fn.id })); });
          for (const [items, x] of [[next.components, 0], [next.functions, 315]] as const) items.forEach((row, index) => {
            const group = svg('g', { transform: `translate(${x},${10 + index * 58})`, tabindex: '0', role: 'button', 'aria-label': `${row.label}: inspect evidence`, 'aria-pressed': 'false', 'data-graph-row': row.id, 'data-graph-claim': row.claimIds[0] });
            group.append(svg('rect', { width: '225', height: '42', rx: '7' }), svg('text', { x: '10', y: '25' }, row.label.length > 31 ? row.label.slice(0, 29) + '…' : row.label)); image.append(group);
          });
          surface.append(image);
        }
      }
      card.hidden = !next || !open || dismissed;
      if (!next) return;
      const label = (value: number) => Math.floor(value) <= 0 ? `${1 - Math.floor(value)} BCE` : `${Math.floor(value)} CE`;
      context.textContent = `Browsing ${label(year)} · patent context ${label(next.temporalSupport.startYear)}; no operating interval is asserted.`;
      for (const mark of surface.querySelectorAll('[data-graph-row]')) mark.setAttribute('aria-pressed', String(mark.getAttribute('data-graph-row') === selection?.entityId));
      for (const link of surface.querySelectorAll('[data-graph-component]')) link.setAttribute('data-selected', String(link.getAttribute('data-graph-component') === selection?.entityId || link.getAttribute('data-graph-function') === selection?.entityId));
    },
  };
}
