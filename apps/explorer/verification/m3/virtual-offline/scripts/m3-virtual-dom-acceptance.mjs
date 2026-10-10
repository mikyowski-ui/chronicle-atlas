#!/usr/bin/env node
/** User-approved virtual DOM substitute. Exercises the real research view and
 * controllers; geometry, map/camera, frame clock and download browser APIs are
 * explicit test doubles. This is not browser rendering or performance evidence. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, mkdtemp, rm, readdir } from 'node:fs/promises';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { checkNarrowLayoutPolicy } from './m3-virtual-layout-policy.mjs';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputIndex = process.argv.indexOf('--out');
const out = resolve(outputIndex < 0 ? join(app, 'verification/m3/virtual-dom') : process.argv[outputIndex + 1]);
await mkdir(out, { recursive: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const require = createRequire(import.meta.url);
const offline = process.argv.includes('--offline');
const happyDOM = await import(pathToFileURL(join(app, offline ? 'runtime/happy-dom-runtime.mjs' : 'verification-tools/node_modules/happy-dom/lib/index.js')).href);
const { Window } = happyDOM;
let esbuild;
if (!offline) {
  const esbuildDirectory = (await readdir(join(app, 'node_modules/.pnpm'))).find(name => /^esbuild@/.test(name));
  assert.ok(esbuildDirectory, 'existing app esbuild dependency required');
  esbuild = require(join(app, 'node_modules/.pnpm', esbuildDirectory, 'node_modules/esbuild'));
}
const temporary = await mkdtemp(join(tmpdir(), 'chronicle-m3-virtual-'));
const moduleFile = offline ? join(app, 'runtime/compiled-workspace.mjs') : join(temporary, 'view.mjs');
const build = JSON.parse(await readFile(join(app, 'dist/build-info.json'), 'utf8'));
const receipt = {
  schemaVersion: 1, status: 'RUNNING', acceptanceProfile: 'user-approved-virtual-dom-substitute-v1', build,
  interpretation: 'PASS means actual research view/controller DOM behavior and CSS policy pass under explicit geometry and timing mocks. No browser layout engine, rasterization, Atlas renderer execution, GPU, mobile hardware or real responsiveness is measured.',
  runtime: { node: process.version, happyDOM: happyDOM.happyDOMVersion ?? JSON.parse(await readFile(join(app, 'verification-tools/node_modules/happy-dom/package.json'), 'utf8')).version, esbuild: esbuild?.version ?? 'precompiled exact-source bundle', offlineBundle: offline },
  mocks: { geometry: '375×812 policy fixture; map and panel rectangles supplied by test adapter', renderer: 'host Canvas element only; no rendering engine', clock: 'deterministic virtual clock; requestAnimationFrame advances 1000/60 ms per callback', cursor: 'host seek increments virtual clock by 2 ms and calls actual workspace.updateCursor', download: 'capture actual view-created Blob via createObjectURL/anchor click', upload: 'Happy DOM File/DataTransfer and actual change event', fetch: 'only two pinned local fixture files; all other fetches throw; no network transport' },
  gates: {}, checks: [], artifacts: [], errors: [], sources: [], physicalGPU: 'NOT RUN', physicalMobile: 'NOT RUN', nativeBrowser: 'BLOCKED; retained separately in ../headless', realPerformance: 'NOT MEASURED',
};
let research, window;
async function artifact(name, contents) { await writeFile(join(out, name), contents); receipt.artifacts.push({ file: name, sha256: hash(contents) }); }
async function json(name, value) { await artifact(name, JSON.stringify(value, null, 2) + '\n'); }
function check(name, action) { action(); receipt.checks.push({ name, status: 'PASS' }); }
async function until(predicate, label) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) { if (predicate()) { await new Promise(setImmediate); return; } await new Promise(resolve => setTimeout(resolve, 1)); }
  throw new Error(`Timed out: ${label}; status=${window?.document.querySelector('#research-status')?.textContent}`);
}
try {
  const layoutPolicy = checkNarrowLayoutPolicy({ app, width: 375, height: 812, ...(offline ? { parserModule: require(join(app, 'runtime/postcss-runtime.cjs')) } : {}) });
  await json('layout-policy.json', layoutPolicy);
  if (offline) {
    const manifest = JSON.parse(await readFile(join(app, 'runtime/source-manifest.json'), 'utf8'));
    assert.equal(manifest.buildId, build.build_id); assert.equal(manifest.compiledSHA256, hash(await readFile(moduleFile)));
    for (const file of manifest.runtimes) assert.equal(hash(await readFile(join(app, file.path))), file.sha256, `offline runtime hash: ${file.path}`);
    for (const file of manifest.copiedInputs) assert.equal(hash(await readFile(join(app, file.path))), file.sha256, `offline input hash: ${file.path}`);
    receipt.sources = manifest.sources;
  } else {
    const bundled = await esbuild.build({ absWorkingDir: app, entryPoints: ['src/research/view.ts'], outfile: moduleFile, bundle: true, platform: 'node', format: 'esm', target: 'es2022', loader: { '.css': 'empty' }, define: { 'import.meta.env.DEV': 'false' }, metafile: true, logLevel: 'silent' });
    for (const name of Object.keys(bundled.metafile.inputs).sort()) {
      if (name.includes('node_modules')) continue;
      const bytes = await readFile(resolve(app, name)); receipt.sources.push({ path: name, sha256: hash(bytes) });
    }
  receipt.sources.push({ path: 'scripts/m3-virtual-dom-acceptance.mjs', sha256: hash(await readFile(fileURLToPath(import.meta.url))) });
  receipt.sources.push({ path: 'scripts/m3-virtual-layout-policy.mjs', sha256: hash(await readFile(join(app, 'scripts/m3-virtual-layout-policy.mjs'))) });
  }
  receipt.sourceInputFingerprint = hash(JSON.stringify(receipt.sources));
  window = new Window({ url: 'http://chronicle.virtual/?verify=1&renderer=canvas', width: 375, height: 812, settings: { disableCSSFileLoading: true, disableJavaScriptFileLoading: true, disableComputedStyleRendering: true } });
  const document = window.document;
  for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLButtonElement', 'SVGElement', 'Element', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'AbortController', 'AbortSignal', 'File', 'Blob', 'DataTransfer', 'navigator', 'location']) Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? window : window[key] });
  let width = 375, height = 812, clock = 0, rafCount = 0, seekCount = 0;
  const frameStep = 1000 / 60, resources = [], fetches = [], objectURLs = new Map(), downloads = [], raf = new Map();
  const virtualPerformance = { now: () => clock, setResourceTimingBufferSize: () => {}, getEntriesByType: type => type === 'resource' ? resources.slice() : [], mark: () => {}, measure: () => {}, clearMarks: () => {}, clearMeasures: () => {} };
  Object.defineProperty(globalThis, 'performance', { configurable: true, value: virtualPerformance });
  Object.defineProperty(window, 'performance', { configurable: true, value: virtualPerformance });
  Object.defineProperty(globalThis, 'innerWidth', { configurable: true, get: () => width });
  Object.defineProperty(globalThis, 'innerHeight', { configurable: true, get: () => height });
  Object.defineProperty(globalThis, 'devicePixelRatio', { configurable: true, value: 1 });
  globalThis.requestAnimationFrame = callback => { const id = ++rafCount; raf.set(id, callback); queueMicrotask(() => { const task = raf.get(id); if (task) { raf.delete(id); clock += frameStep; task(clock); } }); return id; };
  globalThis.cancelAnimationFrame = id => raf.delete(id);
  window.requestAnimationFrame = globalThis.requestAnimationFrame; window.cancelAnimationFrame = globalThis.cancelAnimationFrame;
  globalThis.matchMedia = query => ({ matches: query.includes('prefers-reduced-motion') || /max-width:\s*(\d+)px/.test(query) && width <= Number(query.match(/max-width:\s*(\d+)px/)[1]), media: query, addEventListener() {}, removeEventListener() {} });
  globalThis.getComputedStyle = node => ({ ...node.style, animationName: 'none', animationDuration: '0s', transitionDuration: '0s', scrollBehavior: 'auto' });
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.Element.prototype.scrollIntoView = function () {};
  window.Element.prototype.getAnimations = function () { return []; };
  const rect = (x, y, w, h) => ({ x, y, width: w, height: h, left: x, top: y, right: x + w, bottom: y + h, toJSON() { return { x, y, width: w, height: h }; } });
  window.Element.prototype.getBoundingClientRect = function () {
    if (this.classList.contains('research-workspace')) return width === 375 ? rect(10, 172, 355, this.classList.contains('research-map-mode') ? 60 : 414) : rect(20, 142, 530, 650);
    if (this.id === 'map' || this.tagName === 'CANVAS' || this.classList.contains('research-map-overlay')) return rect(0, 56, width, height - 268);
    if (this.classList.contains('transport')) return rect(0, height - 212, width, 212);
    return rect(10, 172, Math.min(325, width - 50), 24);
  };
  for (const key of ['clientWidth', 'offsetWidth']) Object.defineProperty(window.HTMLElement.prototype, key, { configurable: true, get() { return this.getBoundingClientRect().width; } });
  for (const key of ['clientHeight', 'offsetHeight']) Object.defineProperty(window.HTMLElement.prototype, key, { configurable: true, get() { return this.getBoundingClientRect().height; } });
  globalThis.URL.createObjectURL = blob => { const url = `blob:chronicle-virtual/${objectURLs.size + 1}`; objectURLs.set(url, blob); return url; };
  globalThis.URL.revokeObjectURL = url => { objectURLs.delete(url); };
  window.HTMLAnchorElement.prototype.click = function () { if (this.download) { assert.ok(objectURLs.has(this.href)); downloads.push({ name: this.download, blob: objectURLs.get(this.href) }); } else throw new Error('External navigation is disabled by virtual acceptance harness'); };
  const allowed = new Map([
    [new URL('./pilot-data.json', pathToFileURL(moduleFile)).href, join(app, 'src/research/pilot-data.json')],
    [new URL('../../research-semantic/premodern-pilot.json', pathToFileURL(moduleFile)).href, join(app, 'research-semantic/premodern-pilot.json')],
  ]);
  globalThis.fetch = async (input, options) => {
    options?.signal?.throwIfAborted(); const url = String(input), path = allowed.get(url);
    if (!path) throw new Error(`NETWORK_DISABLED: ${url}`);
    const data = await readFile(path); options?.signal?.throwIfAborted();
    fetches.push({ file: relative(app, path), sha256: hash(data) }); resources.push({ name: url, initiatorType: 'fetch' });
    return new Response(data, { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  window.fetch = globalThis.fetch;
  document.body.innerHTML = '<main class="chronicle-glass"><div class="workspace"><nav id="toolbar"><button id="debug-toggle">Debug</button></nav><div id="map"><canvas></canvas></div><section class="transport" aria-label="Historical timeline"></section></div></main>';
  const qs = selector => { const element = document.querySelector(selector); assert.ok(element, `element exists: ${selector}`); return element; };
  const byText = text => { const element = [...document.querySelectorAll('button')].find(button => button.textContent === text); assert.ok(element, `button exists: ${text}`); return element; };
  const expand = selector => { qs(selector).open = true; };
  let camera = { longitude: -102, latitude: 23, zoom: 4.2 }, currentYear = 2025;
  const { mountResearchWorkspace } = await import(pathToFileURL(moduleFile).href);
  research = mountResearchWorkspace({
    workspace: qs('.workspace'), toolbar: qs('#toolbar'), map: qs('#map'), initialYear: currentYear,
    seekYear: async year => { seekCount++; clock += 2; currentYear = year; research.updateCursor(year); },
    focus: (coordinates, zoom) => { camera = { longitude: coordinates[0], latitude: coordinates[1], zoom }; qs('#map').dispatchEvent(new window.Event('camera-change')); },
    project: coordinates => [width * .65 + (coordinates[0] + 102) * 2, (height - 268) * .45 - (coordinates[1] - 23) * 2],
    diagnostics: () => ({ renderer: 'mock-canvas-host', actualAtlasRenderer: false, mapInstances: 1 }), camera: () => camera, buildIdentity: () => build,
  });
  const ready = () => until(() => qs('#research-status').dataset.status === 'ready', 'real controller ready');
  const openPilot = async title => { expand('.research-query'); byText(title).click(); await ready(); };
  qs('#research-toggle').click(); await ready();
  check('Actual production view loads 44 modern observations', () => assert.equal(document.querySelectorAll('.research-table-scroll tbody tr').length, 44));
  const policyDOM = [];
  for (const [title, rows] of [['Four Mexican urban centres', 44], ['Premodern exchange accounts', 10]]) {
    await openPilot(title); expand('.research-table-section');
    const panel = qs('.research-workspace').getBoundingClientRect(), timeline = qs('.transport').getBoundingClientRect();
    check(`${title}: actual DOM and declared 375px geometry`, () => {
      assert.equal(document.querySelectorAll('.research-table-scroll tbody tr').length, rows);
      assert.equal(panel.width, 355); assert.equal(panel.left, 10); assert.ok(panel.right <= 375); assert.ok(panel.bottom <= timeline.top);
      assert.ok(qs('[aria-label="Study place"]')); assert.ok(qs('[aria-label="Workspace views"]')); assert.ok(qs('.research-table-scroll table'));
    });
    qs('[aria-label="Collapse research panel to see the map"]').click();
    check(`${title}: actual map/panel toggle`, () => { assert.ok(qs('.research-workspace').classList.contains('research-map-mode')); assert.equal(qs('[aria-label="Collapse research panel to see the map"]').getAttribute('aria-pressed'), 'true'); });
    qs('[aria-label="Collapse research panel to see the map"]').click();
    policyDOM.push({ pilot: title, rows, suppliedPanelGeometry: panel.toJSON(), suppliedTimelineGeometry: timeline.toJSON() });
    await artifact(title.startsWith('Four') ? 'modern-dom.html' : 'premodern-dom.html', '<!doctype html><meta charset="utf-8"><title>Virtual DOM snapshot; no rendering certification</title>' + document.body.innerHTML);
  }
  receipt.gates.responsive375 = { status: 'PASS', classification: 'actual stylesheet policy plus mocked375geometry; not rendered layout', policyReceipt: 'layout-policy.json', pilots: policyDOM };
  async function save(name) {
    expand('.research-replay'); const count = downloads.length; byText('Save replay JSON').click();
    assert.equal(downloads.length, count + 1); const text = await downloads.at(-1).blob.text();
    assert.equal(text, qs('#research-replay-json').value); await artifact(name, text); return { text, json: JSON.parse(text) };
  }
  async function upload(text) {
    const transfer = new window.DataTransfer(); transfer.items.add(new window.File([text], 'reopen.json', { type: 'application/json' }));
    const input = qs('[aria-label="Choose a saved research replay"]'); input.files = transfer.files; input.dispatchEvent(new window.Event('change', { bubbles: true }));
    await until(() => qs('.research-replay-status').textContent === 'File read. Select Reopen pinned result to validate it.', 'actual file change reads JSON');
    byText('Reopen pinned result').click();
    await until(() => qs('.research-replay-status').textContent === 'Reopened against matching local source records.', 'actual reopen button commits'); await ready();
  }
  const replayCycles = [];
  for (const [name, title, other] of [['modern', 'Four Mexican urban centres', 'Premodern exchange accounts'], ['premodern', 'Premodern exchange accounts', 'Four Mexican urban centres']]) {
    await openPilot(title); expand('.research-table-section'); qs('.research-table-scroll button[data-research-observation]').click();
    const selected = qs('#research-evidence').dataset.observationId;
    if (name === 'modern') {
      const place = qs('[aria-label="Study place"]'); place.value = place.options[1].value;
      qs('[aria-label="Study end year"]').value = '2000'; qs('.semantic-refine').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); await ready();
      const views = qs('[aria-label="Workspace views"]'); views.value = 'table'; views.dispatchEvent(new window.Event('change')); await ready();
    }
    await (async () => { currentYear = name === 'modern' ? 2000 : -650; clock += 2; research.updateCursor(currentYear); })();
    const before = await save(`${name}-saved-replay.json`); await openPilot(other); await upload(before.text); const after = await save(`${name}-reopened-replay.json`);
    check(`${name}: actual export, file upload, reopen, export round trip`, () => {
      assert.deepEqual(after.json, before.json); assert.equal(qs('#research-evidence').dataset.observationId, selected);
      assert.equal(after.json.cursorYear, currentYear); assert.equal(after.json.kind, 'chronicle-workspace-replay');
      if (name === 'modern') { assert.equal(after.json.study.revisions.length, 2); assert.deepEqual(after.json.views.map(view => view.type), ['table', 'evidence']); }
    });
    const stableRevision = qs('.research-workspace').dataset.revision, stableEvidence = qs('#research-evidence').textContent;
    qs('#research-replay-json').value = '{invalid'; byText('Reopen pinned result').click();
    check(`${name}: invalid JSON reopen retains current result`, () => { assert.match(qs('.research-replay-status').textContent, /valid JSON/); assert.equal(qs('.research-workspace').dataset.revision, stableRevision); assert.equal(qs('#research-evidence').textContent, stableEvidence); });
    replayCycles.push({ pilot: name, status: 'PASS', archiveIdentical: true, revisions: after.json.study.revisions.length, selectedObservation: selected, cursorYear: after.json.cursorYear, views: after.json.views.map(view => view.type) });
  }
  receipt.gates.interactiveSaveReopen = { status: 'PASS', classification: 'actual DOM controls/controller; simulated browser download/upload APIs', cycles: replayCycles, invalidJSONRetainsPreviousResult: true };
  width = 1440; height = 1000;
  await openPilot('Four Mexican urban centres'); byText('Focus study area').click(); expand('.research-verification');
  const rafBefore = rafCount, seeksBefore = seekCount;
  byText('Measure 200 selections, 200 combined updates + lifecycle').click();
  await until(() => { try { return ['PASS', 'FAIL'].includes(JSON.parse(qs('#research-verification-result').textContent).status); } catch { return false; } }, 'original200+200UIbenchmark');
  const benchmark = JSON.parse(qs('#research-verification-result').textContent);
  await json('original-200-plus-200-simulated.json', { classification: 'SIMULATED timing; no real latency or rendered-frame claim', assumption: { rafStepMs: frameStep, mockHostSeekMs: 2, synchronousDOMCostMs: 0 }, productionReceiptUnmodified: benchmark });
  check('Original production 200+200 contract and all coordinated selections', () => {
    assert.equal(benchmark.status, 'PASS', JSON.stringify(benchmark.failures)); assert.deepEqual(benchmark.build, build);
    assert.equal(benchmark.workload.observations, 44); assert.equal(benchmark.workload.entities, 4); assert.equal(benchmark.workload.interactions, 400);
    for (const phase of [benchmark.phases.selectionOnly, benchmark.phases.selectionAndCursor]) { assert.equal(phase.interactionCount, 200); assert.equal(phase.samplesMs.length, 200); assert.equal(phase.failures.length, 0); }
    assert.equal(benchmark.phases.selectionOnly.targetP95Ms, 50); assert.equal(benchmark.phases.selectionAndCursor.targetP95Ms, 100);
    assert.ok(Math.abs(benchmark.phases.selectionOnly.p95Ms - frameStep * 2) < 1e-6); assert.ok(Math.abs(benchmark.phases.selectionAndCursor.p95Ms - (frameStep * 2 + 2)) < 1e-6);
    assert.equal(benchmark.workload.replaceCloseCycles, 20); assert.equal(benchmark.workload.mountDisposeCycles, 20); assert.ok(benchmark.hostSurface.sameCanvasObject);
    for (const cycle of benchmark.mountDisposeCycles) { assert.equal(cycle.after.resources.domListeners, 0); assert.equal(cycle.after.resources.observers, 0); assert.equal(cycle.after.resources.subscriptions, 0); }
    assert.equal(benchmark.warmNetworkResources.length, 0);
  });
  receipt.gates.original200Plus200 = { status: 'PASS', classification: 'actual productionmeasure function with simulatedRAF and mockedAtlas host; not performance evidence', rawReceipt: 'original-200-plus-200-simulated.json', selectionInteractions: 200, combinedInteractions: 200, retainedTargetsMs: [50, 100], syntheticP95Ms: [benchmark.phases.selectionOnly.p95Ms, benchmark.phases.selectionAndCursor.p95Ms], rafCallbacks: rafCount - rafBefore, hostSeeks: seekCount - seeksBefore, closeReopenCycles: 20, mountDisposeCycles: 20, coordinatedSelectionFailures: 0 };
  const fetchCount = fetches.length; expand('.research-query'); qs('#research-question').value = 'Please make a live model request'; byText('Open prepared question').click();
  await until(() => qs('.research-input-status').textContent.includes('unavailable'), 'disabled provider UI status');
  check('Actual unsupported question remains unavailable with zero additional fetches', () => assert.equal(fetches.length, fetchCount));
  research.dispose();
  check('Final actual view/controller disposal releases owned resources', () => { const d = research.getDiagnostics(); assert.equal(d.resources.domListeners, 0); assert.equal(d.resources.observers, 0); assert.equal(d.resources.subscriptions, 0); assert.equal(d.controller.listeners, 0); assert.equal(d.nodes.panel, false); assert.equal(d.nodes.overlay, false); assert.equal(d.nodes.toggle, false); });
  receipt.fetches = fetches; receipt.networkCalls = 0; receipt.virtualClock = { elapsedMs: clock, rafCallbacks: rafCount, hostSeeks: seekCount }; receipt.status = 'PASS';
} catch (error) { receipt.status = 'FAIL'; receipt.errors.push({ name: error.name, message: error.message, stack: error.stack }); if (window) receipt.lastVerificationText = window.document.querySelector('#research-verification-result')?.textContent; process.exitCode = 1; }
finally {
  try { research?.dispose(); } catch {}
  await window?.happyDOM.abort();
  await rm(temporary, { recursive: true, force: true });
  await writeFile(join(out, 'acceptance.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify({ status: receipt.status, build: build.build_id, gates: receipt.gates, checks: receipt.checks.length, errors: receipt.errors.map(error => error.message), receipt: join(out, 'acceptance.json') }, null, 2));
}
