/** The V2 shell is an input adapter, never an owner of historical time. */
export interface V2ShellSnapshot {
  cursorTime: number;
  ready: boolean;
  dateLabel: string;
  pending?: boolean;
}

export interface V2ShellOptions {
  root: HTMLElement;
  transport: HTMLElement;
  header?: HTMLElement;
  getSnapshot(): V2ShellSnapshot;
  bounds(): { min: number; max: number };
  /** Presentation-day input; the existing TimeMotion.scrub applies canonical rounding. */
  seek(cursorTime: number): void;
  pause(): void;
  openDateEntry(): void;
  enabled?: boolean;
}

export interface V2Shell {
  update(snapshot?: V2ShellSnapshot): void;
  setAppearance(enabled: boolean): void;
  dispose(): void;
}

const TAU = Math.PI * 2;
function finite(value: number): number {
  if (!Number.isFinite(value)) throw new TypeError('Jog values must be finite.');
  return value;
}

export function clampJogTime(time: number, min: number, max: number): number {
  [time, min, max].forEach(finite);
  if (max < min) throw new RangeError('Invalid chronology bounds.');
  return Math.max(min, Math.min(max, time));
}

/** Shortest signed angle avoids a date jump at the ±π seam. */
export function jogAngleDelta(previous: number, current: number): number {
  return Math.atan2(Math.sin(finite(current) - finite(previous)), Math.cos(current - previous));
}

export function jogRotationTime(time: number, previous: number, current: number, daysPerTurn: number, min: number, max: number): number {
  if (finite(daysPerTurn) <= 0) throw new RangeError('Jog scale must be positive.');
  return clampJogTime(time + jogAngleDelta(previous, current) / TAU * daysPerTurn, min, max);
}

/** Navigation only: there is no inertia or extrapolation after the input event. */
export function jogWheelTurns(delta: number, mode = 0): number {
  const pixels = finite(delta) * (mode === 1 ? 16 : mode === 2 ? 240 : 1);
  return Math.max(-0.25, Math.min(0.25, -pixels / 1200));
}

export function mountV2Shell(options: V2ShellOptions): V2Shell {
  const { root, transport, header } = options;
  const abort = new AbortController();
  const signal = abort.signal;
  const body = root.ownerDocument.body;
  let disposed = false;
  let desired: number | null = null;
  let queued: number | null = null;
  let frame: number | null = null;
  let angle = 0;
  let drag: { id: number; angle: number; fine: boolean } | null = null;
  let snapshot = options.getSnapshot();

  const control = document.createElement('section');
  control.className = 'v2-time-console';
  control.setAttribute('aria-label', 'Fine and fast historical time control');
  control.innerHTML = `<div class="v2-jog" tabindex="0" role="slider" aria-label="Historical time jog wheel" aria-orientation="horizontal" aria-describedby="v2-dial-help" title="Drag the outer ring to travel; inner ring or Shift for finer control.">
    <svg class="v2-dial-art" viewBox="0 0 112 112" aria-hidden="true"><circle class="v2-dial-rim" cx="56" cy="56" r="51"/><circle class="v2-dial-track" cx="56" cy="56" r="44"/><circle class="v2-dial-inner" cx="56" cy="56" r="29"/><g class="v2-dial-needle"><path d="M56 7 L56 18"/><circle cx="56" cy="18" r="2"/></g><circle class="v2-dial-axle" cx="56" cy="56" r="3"/></svg>
    <span class="v2-dial-label">TIME<small>FINE / FAST</small></span></div>`;
  transport.prepend(control);
  const dial = control.querySelector<HTMLElement>('.v2-jog')!;
  const needle = control.querySelector<SVGElement>('.v2-dial-needle')!;

  const settings = document.createElement('div');
  settings.className = 'v2-dial-settings';
  settings.innerHTML = `<div class="v2-dial-options"><label>Outer turn<select aria-label="Jog outer turn"><option value="365.2425">1 year</option><option value="3652.425">10 years</option><option value="36524.25" selected>100 years</option><option value="365242.5">1,000 years</option></select></label><label>Inner turn<select aria-label="Jog inner turn"><option value="1">1 day</option><option value="30.436875">1 month</option><option value="365.2425" selected>1 year</option></select></label><button type="button">Go to date</button><span class="v2-gear-state">Outer ring · fast</span></div><p id="v2-dial-help">Drag the outer ring to travel; the inner ring or Shift to refine. Arrow keys move one year; Alt + arrows one day. Turn sizes are navigation spans, not source precision.</p>`;
  const advanced = transport.querySelector<HTMLElement>('.advanced-transport');
  if (advanced) advanced.append(settings);
  else {
    const disclosure = document.createElement('details');
    disclosure.className = 'v2-extra-settings';
    const summary = document.createElement('summary'); summary.textContent = 'Fine / fast time settings';
    disclosure.append(summary, settings); transport.append(disclosure);
  }
  const outer = settings.querySelector<HTMLSelectElement>('select[aria-label="Jog outer turn"]')!;
  const inner = settings.querySelector<HTMLSelectElement>('select[aria-label="Jog inner turn"]')!;
  const gear = settings.querySelector<HTMLElement>('.v2-gear-state')!;
  settings.querySelector('button')!.addEventListener('click', options.openDateEntry, { signal });

  const appearance = document.createElement('button');
  appearance.className = 'v2-skin-switch'; appearance.type = 'button'; appearance.textContent = 'Appearance';
  appearance.title = 'Switch between the V2 and classic appearance';
  header?.append(appearance);
  const badge = header?.querySelector<HTMLElement>('.fixture-badge');
  const previousBadge = badge?.textContent ?? '';
  if (badge) badge.textContent = 'ALPHA · BETA PREVIEW';
  const previousShell = root.dataset.interface;
  root.dataset.interface = 'chronicle-v2-integrated';

  function setAppearance(enabled: boolean): void {
    body.classList.toggle('chronicle-v2', enabled);
    appearance.setAttribute('aria-pressed', String(enabled));
  }
  appearance.addEventListener('click', () => setAppearance(!body.classList.contains('chronicle-v2')), { signal });
  setAppearance(options.enabled ?? true);

  function current(): number { return desired ?? options.getSnapshot().cursorTime; }
  function flush(): void {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    const value = queued; queued = null;
    if (!disposed && value !== null && options.getSnapshot().ready) options.seek(value);
  }
  function seek(value: number): void {
    if (disposed || !options.getSnapshot().ready) return;
    options.pause();
    const bounds = options.bounds();
    desired = clampJogTime(value, bounds.min, bounds.max);
    queued = desired;
    if (frame === null) frame = requestAnimationFrame(flush);
  }
  function polar(event: PointerEvent): { angle: number; fraction: number } {
    const rect = dial.getBoundingClientRect();
    const dx = event.clientX - rect.left - rect.width / 2;
    const dy = event.clientY - rect.top - rect.height / 2;
    return { angle: Math.atan2(dy, dx), fraction: Math.hypot(dx, dy) / (Math.min(rect.width, rect.height) / 2) };
  }
  function rotate(delta: number): void {
    angle = (angle + delta) % TAU;
    needle.style.transform = `rotate(${angle}rad)`;
  }
  dial.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !options.getSnapshot().ready) return;
    const point = polar(event);
    if (point.fraction < .17) return;
    event.preventDefault(); options.pause(); dial.focus({ preventScroll: true });
    dial.setPointerCapture(event.pointerId);
    desired = current();
    drag = { id: event.pointerId, angle: point.angle, fine: event.shiftKey || point.fraction < .67 };
    dial.dataset.dragging = 'true';
    gear.textContent = drag.fine ? 'Inner ring · fine' : 'Outer ring · fast';
  }, { signal });
  dial.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    const point = polar(event);
    if (point.fraction < .17) { drag.angle = point.angle; return; }
    const bounds = options.bounds();
    const days = Number(drag.fine || event.shiftKey ? inner.value : outer.value);
    seek(jogRotationTime(current(), drag.angle, point.angle, days, bounds.min, bounds.max));
    rotate(jogAngleDelta(drag.angle, point.angle));
    drag.angle = point.angle;
  }, { signal });
  function release(event: PointerEvent): void {
    if (!drag || event.pointerId !== drag.id) return;
    flush(); drag = null; desired = null; delete dial.dataset.dragging;
    if (dial.hasPointerCapture(event.pointerId)) dial.releasePointerCapture(event.pointerId);
  }
  dial.addEventListener('pointerup', release, { signal });
  dial.addEventListener('pointercancel', release, { signal });
  dial.addEventListener('lostpointercapture', release, { signal });
  dial.addEventListener('wheel', event => {
    if (event.ctrlKey || !options.getSnapshot().ready) return;
    event.preventDefault();
    const turns = jogWheelTurns(event.deltaY, event.deltaMode);
    const scale = Number(event.shiftKey ? inner.value : outer.value);
    gear.textContent = event.shiftKey ? 'Fine wheel control' : 'Fast wheel control';
    seek(current() + turns * scale); rotate(turns * TAU); flush(); desired = null;
  }, { signal, passive: false });
  dial.addEventListener('keydown', event => {
    if (!options.getSnapshot().ready || event.ctrlKey || event.metaKey) return;
    const sign = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 0;
    let next: number | null = null;
    if (sign) next = current() + sign * (event.altKey ? 1 : 365.2425) * (event.shiftKey ? 10 : 1);
    else if (event.key === 'PageUp' || event.key === 'PageDown') next = current() + (event.key === 'PageUp' ? 1 : -1) * Number(outer.value);
    else if (event.key === 'Home' || event.key === 'End') next = event.key === 'Home' ? options.bounds().min : options.bounds().max;
    if (next !== null) { event.preventDefault(); event.stopPropagation(); seek(next); flush(); desired = null; }
  }, { signal });
  // Another control takes input ownership before its own event handler runs.
  transport.addEventListener('pointerdown', event => {
    if (event.target instanceof Node && !control.contains(event.target)) { flush(); desired = null; }
  }, { signal, capture: true });

  function update(next = options.getSnapshot()): void {
    if (disposed) return;
    snapshot = next;
    const bounds = options.bounds();
    dial.setAttribute('aria-disabled', String(!snapshot.ready));
    dial.setAttribute('aria-valuemin', String(bounds.min));
    dial.setAttribute('aria-valuemax', String(bounds.max));
    dial.setAttribute('aria-valuenow', String(snapshot.cursorTime));
    dial.setAttribute('aria-valuetext', snapshot.dateLabel);
    control.dataset.pending = String(snapshot.pending ?? false);
  }
  update();
  return {
    update, setAppearance,
    dispose() {
      if (disposed) return;
      disposed = true; abort.abort();
      if (frame !== null) cancelAnimationFrame(frame);
      queued = desired = null; frame = null; drag = null;
      control.remove(); appearance.remove();
      if (settings.parentElement?.classList.contains('v2-extra-settings')) settings.parentElement.remove();
      else settings.remove();
      if (badge) badge.textContent = previousBadge;
      if (previousShell === undefined) delete root.dataset.interface; else root.dataset.interface = previousShell;
      body.classList.remove('chronicle-v2');
    },
  };
}
