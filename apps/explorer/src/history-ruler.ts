import { formatFixtureYear } from './date-label.ts';
import { formatNavigationDate } from './time-entry.ts';

/** A source observation is a coverage marker, never a claim that an event occurred. */
export interface TimelineEvent {
  id: string;
  time: number;
  title: string;
  kind: 'observation' | 'event';
  entityIds?: string[];
  continents?: string[];
  civilization?: string;
  sourceURL?: string;
  description?: string;
  /** For approximate or year-only source precision, rather than inventing a day. */
  dateLabel?: string;
}
export interface HistoryRulerSnapshot { cursorTime: number; ready: boolean; pending?: boolean }
export interface RulerWindow { min: number; max: number }
export interface HistoryRulerOptions {
  host: HTMLElement;
  /** A sidebar host keeps geographic filters separate from temporal controls. */
  filtersHost?: HTMLElement;
  bounds(): RulerWindow;
  getSnapshot(): HistoryRulerSnapshot;
  /** Sends continuous presentation days to the existing TimeMotion owner. */
  seek(day: number): void;
  pause(): void;
  events?: TimelineEvent[];
}
export interface HistoryRuler {
  update(snapshot?: HistoryRulerSnapshot): void;
  setEvents(events: TimelineEvent[]): void;
  setSelection(selection: { entityId: string; name: string } | null): void;
  /** Explicit country-timeline action; source observations remain separately visible. */
  focusSelection(): void;
  revealTime(day:number): void;
  dispose(): void;
  receipt(): { window: RulerWindow; scope: string; selectedEntity: string | null; events: number; observationMarkers: number; visibleEvents: number; continuouslyScrubbed: boolean };
}
const YEAR = 365.2425;
const finite = (value: number): number => {
  if (!Number.isFinite(value)) throw new TypeError('Timeline values must be finite.');
  return value;
};
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Keep navigation windows bounded without changing any historical validity. */
export function boundRulerWindow(start: number, span: number, bounds: RulerWindow): RulerWindow {
  [start, span, bounds.min, bounds.max].forEach(finite);
  if (bounds.max <= bounds.min || span <= 0) throw new RangeError('Invalid timeline window.');
  const size = clamp(span, Math.min(7, bounds.max - bounds.min), bounds.max - bounds.min);
  const min = clamp(start, bounds.min, bounds.max - size);
  return { min, max: min + size };
}
export function rulerTimeAt(fraction: number, window: RulerWindow): number {
  [fraction, window.min, window.max].forEach(finite);
  if (window.max <= window.min) throw new RangeError('Invalid timeline window.');
  return window.min + clamp(fraction, 0, 1) * (window.max - window.min);
}
/** Preserve the day under the pointer when zooming, except at corpus limits. */
export function zoomRulerWindow(window: RulerWindow, factor: number, fraction: number, bounds: RulerWindow): RulerWindow {
  if (finite(factor) <= 0) throw new RangeError('Invalid timeline zoom.');
  const anchor = rulerTimeAt(fraction, window);
  const span = clamp((window.max - window.min) * factor, Math.min(7, bounds.max - bounds.min), bounds.max - bounds.min);
  return boundRulerWindow(anchor - clamp(fraction, 0, 1) * span, span, bounds);
}

function january(astronomicalYear: number): number {
  const date = new Date(0); date.setUTCFullYear(astronomicalYear, 0, 1); date.setUTCHours(0, 0, 0, 0);
  return date.getTime() / 86400000;
}
function niceStep(value: number): number {
  const power = 10 ** Math.floor(Math.log10(Math.max(1, value)));
  return ([1, 2, 5, 10].find(scale => scale * power >= value) ?? 10) * power;
}

/** Calendar tick labels have no year zero. Only navigation spans use mean years. */
export function rulerTicks(window: RulerWindow, width: number): { time: number; label: string }[] {
  const span = window.max - window.min;
  const desired = Math.max(2, Math.min(12, Math.floor(width / 105)));
  const ticks: { time: number; label: string }[] = [];
  if (span > YEAR * 3) {
    const step = niceStep(span / YEAR / desired);
    const first = new Date(window.min * 86400000).getUTCFullYear();
    const last = new Date(window.max * 86400000).getUTCFullYear();
    const signedFirst = first <= 0 ? first - 1 : first;
    const signedLast = last <= 0 ? last - 1 : last;
    for (let historical = Math.floor(signedFirst / step) * step; historical <= signedLast + step && ticks.length < 32; historical += step) {
      if (historical === 0) continue;
      const day = january(historical < 0 ? historical + 1 : historical);
      if (day >= window.min && day <= window.max) ticks.push({ time: day, label: formatFixtureYear(day) });
    }
  } else if (span > 75) {
    const date = new Date(window.min * 86400000); date.setUTCDate(1); date.setUTCHours(0, 0, 0, 0);
    const monthsPerLabel = span / 30.436875 / desired;
    const step = [1, 2, 3, 6, 12].find(value => value >= monthsPerLabel) ?? 12;
    for (let index = 0; index < 48; index++) {
      const day = date.getTime() / 86400000;
      if (day > window.max) break;
      if (day >= window.min) ticks.push({ time: day, label: `${date.toLocaleString('en', { month: 'short', timeZone: 'UTC' })} ${formatFixtureYear(day)}` });
      date.setUTCMonth(date.getUTCMonth() + step);
    }
  } else {
    const step = niceStep(span / desired);
    for (let day = Math.ceil(window.min / step) * step; day <= window.max && ticks.length < 32; day += step) {
      const date = new Date(day * 86400000);
      ticks.push({ time: day, label: `${date.getUTCDate()} ${date.toLocaleString('en', { month: 'short', timeZone: 'UTC' })}` });
    }
  }
  return ticks;
}

export type TimelineScope = { kind: 'all' } | { kind: 'country'; id: string } | { kind: 'continent' | 'civilization'; name: string };
type Scope = TimelineScope;
const CONTINENTS = ['Africa', 'Antarctica', 'Asia', 'Europe', 'North America', 'Oceania', 'South America'];
/** Coverage determines events, not whether a continent is available to explore. */
export function timelineContinents(events: readonly TimelineEvent[]): string[] {
  return [...new Set([...CONTINENTS, ...events.flatMap(event => event.continents ?? [])])].sort();
}
function matches(event: TimelineEvent, scope: Scope): boolean {
  if (scope.kind === 'all' || (event.kind === 'observation' && scope.kind !== 'country')) return true;
  if (scope.kind === 'country') return event.entityIds?.includes(scope.id) ?? false;
  if (scope.kind === 'continent') return event.continents?.includes(scope.name) ?? false;
  return event.civilization === scope.name;
}

export function rulerEmptyMessage(events: readonly TimelineEvent[], scope: TimelineScope, window: RulerWindow): string {
  const researched = events.filter(event => event.kind === 'event' && matches(event, scope));
  if (researched.some(event => event.time >= window.min && event.time <= window.max)) return '';
  if (researched.length) return 'No researched events in this time window · zoom out to explore.';
  if (scope.kind === 'continent' || scope.kind === 'civilization') return `No researched events for ${scope.name} yet.`;
  return scope.kind === 'country' ? 'No researched events for this selected entity yet.' : 'No researched events available yet.';
}

/** Nearby dates share a node at the first date; every event remains available in its list. */
export function layoutRulerEvents(events: readonly TimelineEvent[], window: RulerWindow, width: number) {
  const pixels = Math.max(280, finite(width));
  const spacing = Math.max(14, pixels / 96);
  const nodes: { event: TimelineEvent; anchor: number; events: TimelineEvent[] }[] = [];
  const visible = events.filter(event => event.kind === 'event' && event.time >= window.min && event.time <= window.max)
    .sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
  for (const event of visible) {
    const anchor = (event.time - window.min) / (window.max - window.min) * 100;
    const last = nodes[nodes.length - 1];
    if (last && (anchor - last.anchor) / 100 * pixels < spacing) last.events.push(event);
    else nodes.push({ event, anchor, events: [event] });
  }
  return nodes;
}

/** Resize the actual map viewport whenever the dock grows, including date settings. */
export function mountTimelineDock(options: { workspace: HTMLElement; transport: HTMLElement }): { dispose(): void } {
  const win = options.workspace.ownerDocument.defaultView;
  let previousHeight = -1, frame: number | null = null;
  const measure = () => {
    frame = null;
    const height = Math.ceil(options.transport.getBoundingClientRect().height);
    if (height === previousHeight) return;
    previousHeight = height;
    options.workspace.style.setProperty('--timeline-dock-height', `${height}px`);
    // MapLibre follows window resize; CanvasMap observes the map element directly.
    win?.dispatchEvent(new Event('resize'));
  };
  const observer = new ResizeObserver(() => { if (frame === null) frame = requestAnimationFrame(measure); });
  options.workspace.classList.add('timeline-docked');
  observer.observe(options.transport); measure();
  return { dispose() { observer.disconnect(); if (frame !== null) cancelAnimationFrame(frame); options.workspace.classList.remove('timeline-docked'); options.workspace.style.removeProperty('--timeline-dock-height'); } };
}

export function mountHistoryRuler(options: HistoryRulerOptions): HistoryRuler {
  const doc = options.host.ownerDocument;
  const abort = new AbortController(), signal = abort.signal;
  let snapshot = options.getSnapshot();
  let bounds = options.bounds();
  let window = boundRulerWindow(snapshot.cursorTime - YEAR * 600, YEAR * 1200, bounds);
  let events: TimelineEvent[] = [];
  let eventIndex = new Map<string, TimelineEvent>();
  let selection: { entityId: string; name: string } | null = null;
  let scope: Scope = { kind: 'all' };
  let frame: number | null = null, queued: number | null = null, paintQueued = false;
  let disposed = false, following = true, continuouslyScrubbed = false;
  let drag: { id: number; x: number; window: RulerWindow; pan: boolean } | null = null;
  let eventCount = 0, observationCount = 0;
  const root = doc.createElement('section'); root.className = 'history-ruler'; root.setAttribute('aria-label', 'Historical timeline');
  root.innerHTML = `<div class="history-ruler-toolbar"><div class="history-ruler-zoom"><button type="button" data-action="out" title="Zoom out" aria-label="Zoom timeline out">−</button><button type="button" data-action="in" title="Zoom in" aria-label="Zoom timeline in">+</button><button type="button" data-action="full" title="Show every supported era">All eras</button><button type="button" data-action="center" title="Center timeline on current date" aria-label="Center timeline on current date">⌖</button></div></div><div class="history-ruler-viewport"><div class="history-ruler-input" tabindex="0" role="slider" aria-label="Browse historical time" aria-orientation="horizontal" aria-describedby="history-ruler-help"></div><div class="history-ruler-ticks" aria-hidden="true"></div><div class="history-ruler-observations" aria-label="Source observations"></div><div class="history-ruler-events" aria-label="Researched historical events"></div><div class="history-ruler-cursor" aria-hidden="true"><span class="history-ruler-date"></span><i></i></div></div><div class="history-ruler-foot"><span class="history-ruler-key"><i></i> Source observations <b></b> Historical events</span><span class="history-ruler-hint" id="history-ruler-help">Drag to explore · scroll to zoom · Shift-drag to pan</span></div><div class="history-ruler-tooltip" role="tooltip" hidden></div><div class="history-ruler-event-card" aria-label="Historical event details" hidden><button type="button" class="history-event-close" aria-label="Close event">×</button><span class="history-event-date"></span><strong class="history-event-title"></strong><p class="history-event-description"></p><div class="history-event-list" hidden></div><a target="_blank" rel="noopener noreferrer">View historical source ↗</a></div>`;
  options.host.append(root);
  const filters = doc.createElement('section'); filters.className = 'history-ruler-filters';
  filters.setAttribute('aria-label', 'Historical event filters');
  filters.innerHTML = `<p class="history-filter-heading">Event filters</p><div class="history-ruler-scopes" aria-label="Timeline event scope"><button type="button" class="history-scope-all" aria-pressed="true">All history</button><button type="button" class="history-scope-country" aria-pressed="false" disabled>Selected state</button><select class="history-scope-continent" aria-label="Timeline continent"><option value="">Continent</option></select><select class="history-scope-civilization" aria-label="Timeline civilization"><option value="">Civilization</option></select></div><p class="history-filter-help">Filter researched timeline events. Map coverage and the browsing date stay unchanged.</p>`;
  if (options.filtersHost) options.filtersHost.append(filters);
  // Consumers without a sidebar can still use the temporal ruler; never put filters back in the dock.
  else filters.hidden = true;
  const find = <T extends Element = HTMLElement>(selector: string): T => (root.querySelector<T>(selector) ?? filters.querySelector<T>(selector))!;
  const viewport = find<HTMLElement>('.history-ruler-viewport');
  const empty = doc.createElement('p'); empty.className = 'history-ruler-empty'; empty.hidden = true; empty.setAttribute('role', 'status'); viewport.append(empty);
  const input = find<HTMLElement>('.history-ruler-input');
  const tickLayer = find('.history-ruler-ticks'), observations = find('.history-ruler-observations'), markers = find('.history-ruler-events');
  const cursor = find<HTMLElement>('.history-ruler-cursor'), cursorDate = find('.history-ruler-date');
  let viewportPixels=Math.max(280,viewport.clientWidth);
  cursor.style.left='0';cursor.style.willChange='transform';
  const allButton = find<HTMLButtonElement>('.history-scope-all'), countryButton = find<HTMLButtonElement>('.history-scope-country');
  const continent = find<HTMLSelectElement>('.history-scope-continent'), civilization = find<HTMLSelectElement>('.history-scope-civilization');
  const card = find<HTMLElement>('.history-ruler-event-card');
  const hint = find<HTMLElement>('.history-ruler-hint');
  const tooltip = find<HTMLElement>('.history-ruler-tooltip');
  const eventList = find<HTMLElement>('.history-event-list');
  const clusters = new Map<string, TimelineEvent[]>();
  let tooltipButton: HTMLButtonElement | null = null;
  let lastOpenedId: string | null = null;
  tooltip.id = `history-event-tooltip-${Math.random().toString(36).slice(2, 9)}`;
  function eventTitle(event: TimelineEvent): string {
    const date = event.dateLabel ?? formatFixtureYear(event.time);
    return event.title.startsWith(date) ? event.title : `${date} · ${event.title}`;
  }
  function hideTooltip(): void {
    tooltip.hidden = true; tooltipButton?.removeAttribute('aria-describedby'); tooltipButton = null;
  }
  function showTooltip(button: HTMLButtonElement): void {
    const group = clusters.get(button.dataset.eventId ?? '');
    const event = eventIndex.get(button.dataset.eventId ?? '');
    if (!event) return;
    hideTooltip(); tooltipButton = button;
    tooltip.textContent = group && group.length > 1
      ? `${group.length} events · ${group.slice(0, 3).map(eventTitle).join(' / ')}${group.length > 3 ? ' / Tap to see all' : ''}`
      : event.kind === 'observation' ? `Source observation · ${event.dateLabel ?? formatFixtureYear(event.time)}` : eventTitle(event);
    if ((!group || group.length === 1) && event.sourceURL) { try { tooltip.textContent += ` · Source: ${new URL(event.sourceURL).hostname}`; } catch { /* Preserve the sourced title when a URL is absent or invalid. */ } }
    const markerRect = button.getBoundingClientRect(), rootRect = root.getBoundingClientRect();
    tooltip.style.left = `${clamp(markerRect.left + markerRect.width / 2 - rootRect.left, 16, rootRect.width - 16)}px`;
    tooltip.classList.toggle('near-left', markerRect.left - rootRect.left < 180);
    tooltip.classList.toggle('near-right', rootRect.right - markerRect.right < 180);
    tooltip.hidden = false; button.setAttribute('aria-describedby', tooltip.id);
  }

  function percent(day: number): number { return 100 * (day - window.min) / (window.max - window.min); }
  function width(): number { return Math.max(280, viewport.clientWidth); }
  function schedule(): void { if (frame === null && !disposed) frame = requestAnimationFrame(flush); }
  function flush(): void {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    const day = queued; queued = null;
    if (disposed) return;
    if (day !== null && options.getSnapshot().ready) options.seek(day);
    if (paintQueued) { paintQueued = false; paint(); }
    paintCursor();
  }
  function seek(day: number): void {
    if (!options.getSnapshot().ready || disposed) return;
    queued = clamp(day, bounds.min, bounds.max);
    snapshot = { ...snapshot, cursorTime: queued };
    options.pause(); schedule();
  }
  function queuePaint(): void { paintQueued = true; schedule(); }
  function paintCursor(): void {
    const value = queued ?? snapshot.cursorTime;
    const left = percent(value);
    cursor.style.transform = `translate3d(${clamp(left, 0, 100)/100*viewportPixels}px,0,0)`;
    cursor.classList.toggle('offscreen', left < 0 || left > 100);
    cursor.classList.toggle('near-left', left < 12);
    cursor.classList.toggle('near-right', left > 88);
    const dateText=window.max - window.min < YEAR * 3 ? formatNavigationDate(value) : formatFixtureYear(value);
    if(cursorDate.textContent!==dateText)cursorDate.textContent=dateText;
    root.dataset.pending = String(snapshot.pending ?? false);
    input.setAttribute('aria-disabled', String(!snapshot.ready));
    input.setAttribute('aria-valuemin', String(bounds.min)); input.setAttribute('aria-valuemax', String(bounds.max));
    input.setAttribute('aria-valuenow', String(Math.floor(value))); input.setAttribute('aria-valuetext', formatNavigationDate(value));
  }
  function hideCard(): void { card.hidden = true; hideTooltip(); }
  function showEvent(event: TimelineEvent): void {
    hideTooltip(); lastOpenedId = event.id; eventList.hidden = true; eventList.replaceChildren();
    seek(event.time); flush();
    if (event.kind === 'observation') { hideCard(); return; }
    find('.history-event-date').textContent = event.dateLabel ?? formatFixtureYear(event.time);
    find('.history-event-title').textContent = event.title;
    find('.history-event-description').textContent = event.description ?? '';
    const link = find<HTMLAnchorElement>('.history-ruler-event-card a');
    let valid = false;
    try { const url = new URL(event.sourceURL ?? ''); if (url.protocol === 'https:' && !url.username && !url.password) { link.href = url.href; valid = true; } } catch { /* no invented link */ }
    link.hidden = !valid; if (!valid) link.removeAttribute('href');
    card.hidden = false; card.tabIndex = -1; card.focus({ preventScroll: true });
  }
  function showCluster(group: TimelineEvent[]): void {
    if (group.length === 1) { showEvent(group[0]); return; }
    hideTooltip(); lastOpenedId = group[0].id; options.pause();
    find('.history-event-date').textContent = `${group[0].dateLabel ?? formatFixtureYear(group[0].time)} – ${group[group.length - 1].dateLabel ?? formatFixtureYear(group[group.length - 1].time)}`;
    find('.history-event-title').textContent = `${group.length} nearby events`;
    find('.history-event-description').textContent = 'Choose an event to visit its date and read its source.';
    find<HTMLAnchorElement>('.history-ruler-event-card a').hidden = true;
    eventList.replaceChildren(...group.map(event => {
      const button = doc.createElement('button'); button.type = 'button'; button.dataset.eventId = event.id;
      button.textContent = eventTitle(event); return button;
    }));
    eventList.hidden = false; card.hidden = false; card.tabIndex = -1; card.focus({ preventScroll: true });
  }
  function paint(): void {
    hideTooltip(); clusters.clear();
    const pixels = viewportPixels=width(), ticks = rulerTicks(window, pixels);
    const tickFragment = doc.createDocumentFragment();
    ticks.forEach(tick => {
      const node = doc.createElement('span'); node.className = 'history-ruler-tick'; node.style.left = `${percent(tick.time)}%`; node.textContent = tick.label; tickFragment.append(node);
    });
    // Minor ticks are presentation-only divisions; they make no historical assertion.
    for (let x = 0; x <= 100; x += 2.5) {
      const node = doc.createElement('i'); node.className = 'history-ruler-minor'; node.style.left = `${x}%`; tickFragment.append(node);
    }
    tickLayer.replaceChildren(tickFragment);
    const filtered = events.filter(event => event.time >= window.min && event.time <= window.max && matches(event, scope));
    const observationFragment = doc.createDocumentFragment(), eventFragment = doc.createDocumentFragment();
    observationCount = 0; eventCount = 0;
    let lastObservationPixel = -Infinity;
    for (const event of filtered) {
      const x = percent(event.time) / 100 * pixels;
      if (event.kind === 'observation') {
        // Dense observations remain accessible by zooming; markers never form an unbounded DOM list.
        if (x - lastObservationPixel < 7 || observationCount >= 96) continue;
        lastObservationPixel = x; observationCount++;
        const button = doc.createElement('button'); button.type = 'button'; button.className = 'history-observation'; button.style.left = `${percent(event.time)}%`;
        button.title = `Source observation · ${event.dateLabel ?? formatFixtureYear(event.time)}`; button.setAttribute('aria-label', button.title);
        button.dataset.eventId = event.id; observationFragment.append(button);
        continue;
      }
    }
    for (const { event, anchor, events: group } of layoutRulerEvents(filtered, window, pixels)) {
      const title = group.length > 1 ? `${group.length} nearby historical events · ${eventTitle(event)}. Open event list.` : eventTitle(event);
      const dot = doc.createElement('button'); dot.type = 'button'; dot.className = 'history-event-date-marker';
      dot.style.left = `${anchor}%`; dot.setAttribute('aria-label', title); dot.dataset.eventId = event.id;
      if (group.length > 1) { dot.classList.add('history-event-cluster'); dot.dataset.count = String(group.length); }
      clusters.set(event.id, group); eventCount += group.length; eventFragment.append(dot);
    }
    observations.replaceChildren(observationFragment); markers.replaceChildren(eventFragment);
    const emptyMessage = rulerEmptyMessage(events, scope, window);
    if (empty.textContent !== emptyMessage) empty.textContent = emptyMessage;
    empty.hidden = !emptyMessage;
    const researched = filtered.filter(event => event.kind === 'event').length;
    hint.textContent = researched > eventCount ? 'Zoom in for more events · Shift-drag to pan' : 'Hover or focus nodes · tap for sources · drag to explore · scroll to zoom';
  }
  function chooseScope(next: Scope): void {
    scope = next; allButton.setAttribute('aria-pressed', String(next.kind === 'all')); countryButton.setAttribute('aria-pressed', String(next.kind === 'country'));
    continent.value = next.kind === 'continent' ? next.name : ''; civilization.value = next.kind === 'civilization' ? next.name : '';
    hideCard(); queuePaint();
  }
  allButton.addEventListener('click', () => chooseScope({ kind: 'all' }), { signal });
  countryButton.addEventListener('click', () => { if (selection) chooseScope({ kind: 'country', id: selection.entityId }); }, { signal });
  continent.addEventListener('change', () => chooseScope(continent.value ? { kind: 'continent', name: continent.value } : { kind: 'all' }), { signal });
  civilization.addEventListener('change', () => chooseScope(civilization.value ? { kind: 'civilization', name: civilization.value } : { kind: 'all' }), { signal });
  function closeCard(): void {
    hideCard();
    const anchorId = [...clusters.entries()].find(([, group]) => group.some(event => event.id === lastOpenedId))?.[0] ?? lastOpenedId;
    const anchor = [...markers.querySelectorAll<HTMLButtonElement>('button[data-event-id]')].find(button => button.dataset.eventId === anchorId);
    (anchor ?? input).focus({ preventScroll: true });
  }
  find('.history-event-close').addEventListener('click', closeCard, { signal });
  card.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeCard(); }
  }, { signal });
  // One delegated listener also bounds retained handlers while windows repaint.
  viewport.addEventListener('click', event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-event-id]');
    const marker = button ? eventIndex.get(button.dataset.eventId!) : undefined;
    if (marker) showCluster(clusters.get(marker.id) ?? [marker]);
  }, { signal });

  viewport.addEventListener('pointerover', event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-event-id]');
    if (button && event.pointerType !== 'touch') showTooltip(button);
  }, { signal });
  viewport.addEventListener('pointerout', event => {
    if (!(event.relatedTarget instanceof Node) || !tooltipButton?.contains(event.relatedTarget)) hideTooltip();
  }, { signal });
  viewport.addEventListener('focusin', event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-event-id]');
    if (button) showTooltip(button);
  }, { signal });
  viewport.addEventListener('focusout', hideTooltip, { signal });
  eventList.addEventListener('click', event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-event-id]');
    const chosen = button ? eventIndex.get(button.dataset.eventId!) : undefined;
    if (chosen) showEvent(chosen);
  }, { signal });

  function zoom(factor: number, anchor = .5): void {
    window = zoomRulerWindow(window, factor, anchor, bounds);
    if (snapshot.cursorTime < window.min || snapshot.cursorTime > window.max) following = false;
    hideCard(); queuePaint();
  }
  root.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(button => button.addEventListener('click', () => {
    const action = button.dataset.action;
    if (action === 'in' || action === 'out') zoom(action === 'in' ? .5 : 2);
    else if (action === 'full') { window = { ...bounds }; following = true; queuePaint(); }
    else { const span = window.max - window.min; window = boundRulerWindow(snapshot.cursorTime - span / 2, span, bounds); following = true; queuePaint(); }
  }, { signal }));
  viewport.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !snapshot.ready || (event.target as Element).closest('button')) return;
    event.preventDefault(); input.focus({ preventScroll: true }); options.pause(); hideCard();
    drag = { id: event.pointerId, x: event.clientX, window: { ...window }, pan: event.shiftKey };
    viewport.setPointerCapture(event.pointerId); root.dataset.dragging = event.shiftKey ? 'pan' : 'seek';
    if (!event.shiftKey) {
      const rect = viewport.getBoundingClientRect(); seek(rulerTimeAt((event.clientX - rect.left) / rect.width, window)); continuouslyScrubbed = true;
    } else following = false;
  }, { signal });
  viewport.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    const rect = viewport.getBoundingClientRect();
    if (drag.pan) { const span = drag.window.max - drag.window.min; window = boundRulerWindow(drag.window.min - (event.clientX - drag.x) / rect.width * span, span, bounds); queuePaint(); }
    else seek(rulerTimeAt((event.clientX - rect.left) / rect.width, window));
  }, { signal });
  function release(event: PointerEvent): void {
    if (!drag || drag.id !== event.pointerId) return;
    flush(); drag = null; delete root.dataset.dragging;
    if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
  }
  viewport.addEventListener('pointerup', release, { signal }); viewport.addEventListener('pointercancel', release, { signal }); viewport.addEventListener('lostpointercapture', release, { signal });
  viewport.addEventListener('wheel', event => {
    if (event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.width : 1);
    zoom(Math.exp(clamp(delta, -250, 250) * .004), clamp((event.clientX - rect.left) / rect.width, 0, 1));
  }, { signal, passive: false });
  viewport.addEventListener('keydown', event => {
    if ((event.target as Element).closest('button') || event.ctrlKey || event.metaKey) return;
    const direction = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 0;
    if (direction) seek(snapshot.cursorTime + direction * (event.altKey ? 1 : YEAR) * (event.shiftKey ? 10 : 1));
    else if (event.key === '+' || event.key === '=') zoom(.5);
    else if (event.key === '-') zoom(2);
    else if (event.key === 'Home' || event.key === 'End') seek(event.key === 'Home' ? bounds.min : bounds.max);
    else if (event.key === 'PageUp' || event.key === 'PageDown') { const span = window.max - window.min; window = boundRulerWindow(window.min + (event.key === 'PageUp' ? -1 : 1) * span * .8, span, bounds); following = false; queuePaint(); }
    else if (event.key === 'Escape' && !card.hidden) hideCard();
    else return;
    event.preventDefault(); event.stopPropagation(); flush();
  }, { signal });
  const observer = new ResizeObserver(queuePaint); observer.observe(viewport);

  function setEvents(next: TimelineEvent[]): void {
    events = next.filter(event => Number.isFinite(event.time)).map(event => ({ ...event })).sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
    eventIndex = new Map(events.map(event => [event.id, event]));
    function optionsFor(select: HTMLSelectElement, values: string[], placeholder: string): void {
      const old = select.value; select.replaceChildren(); const first = doc.createElement('option'); first.value = ''; first.textContent = placeholder; select.append(first);
      [...new Set(values)].sort().forEach(value => { const option = doc.createElement('option'); option.value = value; option.textContent = value; select.append(option); }); select.value = old;
    }
    optionsFor(continent, timelineContinents(events), 'Continent');
    optionsFor(civilization, events.flatMap(event => event.civilization ? [event.civilization] : []), 'Civilization');
    if ((scope.kind === 'continent' && !continent.value) || (scope.kind === 'civilization' && !civilization.value)) chooseScope({ kind: 'all' });
    queuePaint();
  }
  function update(next = options.getSnapshot()): void {
    if (disposed) return;
    snapshot = next;
    const latest = options.bounds();
    if (bounds.min !== latest.min || bounds.max !== latest.max) { bounds = latest; window = boundRulerWindow(snapshot.cursorTime - YEAR * 600, YEAR * 1200, bounds); queuePaint(); }
    if (!drag && following && (snapshot.cursorTime < window.min || snapshot.cursorTime > window.max)) {
      const span = window.max - window.min; window = boundRulerWindow(snapshot.cursorTime - span / 2, span, bounds); queuePaint();
    }
    schedule();
  }
  setEvents(options.events ?? []); update();
  return {
    update, setEvents,
    revealTime(day){
      following=true;
      if(day<window.min||day>window.max){const span=window.max-window.min;window=boundRulerWindow(day-span/2,span,bounds);queuePaint();}
    },
    setSelection(next) {
      if (selection?.entityId === next?.entityId && selection?.name === next?.name) return;
      selection = next; countryButton.disabled = next === null;
      countryButton.textContent = next ? next.name : 'Selected country'; countryButton.title = next ? `Events associated with ${next.name}` : 'Select a polity on the map to filter its events';
      if (scope.kind === 'country') chooseScope(next ? { kind: 'country', id: next.entityId } : { kind: 'all' });
    },
    focusSelection() {
      if (!selection) return;
      chooseScope({ kind: 'country', id: selection.entityId });
      const selectedEvents = events.filter(event => event.kind === 'event' && event.entityIds?.includes(selection!.entityId));
      if (selectedEvents.length) {
        const first = selectedEvents[0].time, last = selectedEvents[selectedEvents.length - 1].time;
        const span = Math.max(YEAR * 80, (last - first) * 1.3);
        window = boundRulerWindow((first + last) / 2 - span / 2, span, bounds);
        following = false; queuePaint();
      }
    },
    receipt: () => ({ window: { ...window }, scope: scope.kind === 'all' ? 'all' : scope.kind === 'country' ? `country:${scope.id}` : `${scope.kind}:${scope.name}`, selectedEntity: selection?.entityId ?? null, events: events.filter(event => event.kind === 'event').length, observationMarkers: observationCount, visibleEvents: eventCount, continuouslyScrubbed }),
    dispose() { if (disposed) return; disposed = true; abort.abort(); observer.disconnect(); if (frame !== null) cancelAnimationFrame(frame); root.remove(); filters.remove(); queued = null; },
  };
}
