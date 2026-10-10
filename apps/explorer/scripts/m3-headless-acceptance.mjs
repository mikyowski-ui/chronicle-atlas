#!/usr/bin/env node
// Run the real built Atlas using a local Chromium installation. No package install,
// browser download, remote service, app hook or mock rendering occurs here.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, access, open } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import os from 'node:os';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, fallback) => { const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1]; };
const gateSet = option('--gates', 'm3'), publicSourceGate = ['ingestion-live', 'visualization-live'].includes(gateSet);
assert.ok(['m3', 'watt', 'hud', 'ingestion', 'ingestion-live', 'visualization', 'visualization-live'].includes(gateSet), 'Unknown acceptance gate');
const out = resolve(option('--out', join(app, gateSet.startsWith('visualization') ? `verification/m5/${gateSet}` : gateSet === 'ingestion-live' ? 'verification/m4/phase4-ingestion-live' : gateSet === 'ingestion' ? 'verification/m4/phase4-ingestion' : gateSet === 'watt' ? 'verification/m4/watt' : gateSet === 'hud' ? 'verification/m3/native/phase2-hud' : 'verification/m3/native/headless')));
const renderer = option('--renderer', 'canvas');
assert.ok(['canvas', 'maplibre'].includes(renderer), '--renderer must be canvas or maplibre');
await mkdir(out, { recursive: true });
const sha256 = value => createHash('sha256').update(value).digest('hex');
const receipt = {
  schemaVersion: 1, status: 'NOT RUN', startedAt: new Date().toISOString(),
  command: ['node', 'scripts/m3-headless-acceptance.mjs', '--renderer', renderer, ...(gateSet === 'm3' ? [] : ['--gates', gateSet])],
  runner: { node: process.version, platform: process.platform, arch: process.arch, kernel: os.release(),
    cpus: os.cpus().length, cpuModel: os.cpus()[0]?.model, memoryBytes: os.totalmem(), scriptSHA256: sha256(await readFile(fileURLToPath(import.meta.url))) },
  build: null, requestedRenderer: renderer, browser: null,
  isolation: { servedFrom: 'ephemeral 127.0.0.1 port', externalRequests: publicSourceGate ? 'permit exactly one explicit Q84 Wikidata query; abort other non-local requests; service workers blocked' : 'abort all non-local page requests; service workers blocked', externalAttempts: [] },
  gates: gateSet === 'visualization-live' ? { generatedVisualization: { status: 'NOT RUN' } } : gateSet === 'visualization' ? { boundedVisualization: { status: 'NOT RUN' } } : gateSet === 'ingestion-live' ? { liveEvidenceIngestion: { status: 'NOT RUN' } } : gateSet === 'ingestion' ? { evidenceIngestion: { status: 'NOT RUN' } } : gateSet === 'hud' ? { floatingHud: { status: 'NOT RUN' } } : gateSet === 'watt' ? { wattMechanism: { status: 'NOT RUN' } } : { responsive375: { status: 'NOT RUN' }, interactiveSaveReopen: { status: 'NOT RUN' }, original200Plus200: { status: 'NOT RUN' } },
  screenshots: [], artifacts: [], pageErrors: [], consoleErrors: [], guestCanaryRequests: 0,
  interpretation: 'Actual headless Chromium DOM and the requested Atlas renderer. No physical mobile, hardware GPU, scanout, or OS preference certification.',
  physicalGPU: 'NOT RUN', physicalMobile: 'NOT RUN', scanout: 'NOT MEASURED',
};
let server, browser, context;
let activeGate = null;
class EnvironmentBlocked extends Error {}
async function writeJSON(name, value) {
  const bytes = JSON.stringify(value, null, 2) + '\n';
  await writeFile(join(out, name), bytes);
  receipt.artifacts.push({ file: name, sha256: sha256(bytes) });
}
async function gate(name, action) {
  activeGate = name;
  try { receipt.gates[name] = { status: 'PASS', ...await action() }; }
  catch (error) { receipt.gates[name] = { status: 'FAIL', message: error.message, stack: error.stack }; }
  finally { activeGate = null; }
}
async function screenshot(page, name) {
  const bytes = await page.screenshot({ path: join(out, name), fullPage: true });
  receipt.screenshots.push({ file: name, sha256: sha256(bytes), width: page.viewportSize().width, height: page.viewportSize().height });
}
async function expand(page, selector) {
  const details = page.locator(selector);
  if (!(await details.getAttribute('open') !== null)) await details.locator(':scope > summary').click();
}
async function ready(page) {
  await page.waitForFunction(() => document.querySelector('#research-status')?.dataset.status === 'ready', undefined, { timeout: 30_000 });
}
async function visualizationState(page) {
  await page.waitForFunction(() => ['rendered', 'fallback'].includes(document.querySelector('.visualization-preview')?.dataset.status), undefined, { timeout: 10000 });
  return page.locator('.visualization-preview').evaluate(node => ({ status: node.dataset.status, elapsedMs: Number(node.dataset.elapsedMs), activeWorkers: Number(node.dataset.activeWorkers), launches: Number(node.dataset.launches), terminations: Number(node.dataset.terminations), message: node.querySelector('.visualization-status').textContent, svgCount: node.querySelectorAll('.visualization-surface svg').length, recordIds: [...node.querySelectorAll('.visualization-surface [data-record-id]')].map(mark => mark.dataset.recordId) }));
}
async function loadVisualization(page, specification) {
  await expand(page, '.visualization-preview');
  const launches = await page.locator('.visualization-preview').getAttribute('data-launches');
  await page.getByLabel('Choose a sandboxed render specification', { exact: true }).setInputFiles({ name: 'bounded-render.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(specification)) });
  await page.getByText('Specification validated against the current evidence. Select Run loaded sandbox specification to execute it.', { exact: true }).waitFor();
  assert.equal(await page.locator('.visualization-preview').getAttribute('data-launches'), launches, 'reading a specification does not execute code');
  await page.getByRole('button', { name: 'Run loaded sandbox specification', exact: true }).click();
  return visualizationState(page);
}
async function openPilot(page, title) {
  if (!(await page.locator('.research-workspace').isVisible())) { await page.locator('#research-toggle').click(); await ready(page); }
  await expand(page, '.research-query');
  await page.getByRole('button', { name: title, exact: true }).click();
  await ready(page);
}
async function downloadReplay(page, name) {
  await expand(page, '.research-replay');
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save replay JSON', exact: true }).click();
  const download = await pending;
  assert.equal(await download.failure(), null);
  const path = join(out, name);
  await download.saveAs(path);
  const bytes = await readFile(path);
  receipt.artifacts.push({ file: name, sha256: sha256(bytes) });
  return { path, replay: JSON.parse(bytes.toString('utf8')) };
}
async function layout(page) {
  return page.evaluate(() => {
    const rect = element => {
      const bounds = element.getBoundingClientRect();
      return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, right: bounds.right, bottom: bounds.bottom };
    };
    const panel = document.querySelector('.research-workspace');
    const timeline = document.querySelector('.workspace > .transport');
    const table = document.querySelector('.research-table-scroll');
    const controls = [...panel.querySelectorAll('button,input,select,textarea,summary')]
      .filter(element => element.getClientRects().length && !element.closest('.research-table-scroll'))
      .map(element => ({ label: element.getAttribute('aria-label') || element.textContent?.trim().slice(0, 100) || element.tagName, ...rect(element) }));
    return { viewport: [innerWidth, innerHeight], documentWidth: document.documentElement.scrollWidth,
      panel: rect(panel), panelClientWidth: panel.clientWidth, panelScrollWidth: panel.scrollWidth,
      timeline: timeline ? rect(timeline) : null,
      table: { clientWidth: table.clientWidth, scrollWidth: table.scrollWidth, overflowX: getComputedStyle(table).overflowX },
      controlsOutsidePanel: controls.filter(control => control.x < rect(panel).x - 1 || control.right > rect(panel).right + 1),
      title: panel.querySelector('.research-result > h3')?.textContent,
      renderer: document.querySelector('#renderer-status')?.textContent,
      activeAnimations: panel.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length,
    };
  });
}
async function hostPanelLayout(page, selector) {
  await page.locator(selector).waitFor({ state: 'visible' });
  const result = await page.locator(selector).evaluate(element => {
    const { x, y, width, height, right, bottom } = element.getBoundingClientRect();
    const timeline = document.querySelector('.workspace > .transport').getBoundingClientRect();
    return { x, y, width, height, right, bottom, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
      documentWidth: document.documentElement.scrollWidth, timelineTop: timeline.y, timelineBottom: timeline.bottom };
  });
  assert.ok(result.width >= 300 && result.height > 40, `${selector} is usable`);
  assert.ok(result.x >= 0 && result.right <= 375 && result.documentWidth <= 375, `${selector} fits the viewport`);
  assert.ok(result.scrollWidth <= result.clientWidth + 1, `${selector} does not overflow horizontally`);
  assert.ok(result.y >= 0 && result.bottom <= result.timelineTop + 1 && result.timelineBottom <= 813, `${selector} leaves the timeline visible`);
  return result;
}
function assertLayout(result) {
  assert.deepEqual(result.viewport, [375, 812]);
  assert.ok(result.documentWidth <= 375, 'document must not overflow horizontally');
  assert.ok(result.panel.x >= 0 && result.panel.right <= 375, 'research panel must fit viewport');
  assert.ok(result.panel.width > 300 && result.panel.height > 100, 'research panel must have usable area');
  assert.ok(result.panelScrollWidth <= result.panelClientWidth + 1, 'only inner table may scroll horizontally');
  assert.equal(result.controlsOutsidePanel.length, 0, JSON.stringify(result.controlsOutsidePanel));
  assert.ok(result.timeline, 'historical timeline dock must be present');
  assert.ok(result.timeline.height > 0 && result.timeline.y >= 0 && result.timeline.bottom <= 813, 'timeline dock must remain visible in viewport');
  assert.ok(result.panel.bottom <= result.timeline.y + 1, 'research panel must leave timeline dock visible');
  assert.ok(['auto', 'scroll'].includes(result.table.overflowX), 'table has a bounded horizontal scroll surface');
  assert.equal(result.activeAnimations, 0, 'emulated reduced motion must stop research animations');
}
try {
  try { receipt.build = JSON.parse(await readFile(join(app, 'dist/build-info.json'), 'utf8')); }
  catch { throw new EnvironmentBlocked('Built app missing. Run corepack pnpm run build first.'); }
  const require = createRequire(import.meta.url);
  const candidates = [process.env.CHRONICLE_PLAYWRIGHT_MODULE, join(app, 'verification-tools/node_modules/playwright'), 'playwright'].filter(Boolean);
  let playwright;
  for (const candidate of candidates) { try { playwright = require(candidate); break; } catch {} }
  if (!playwright?.chromium) throw new EnvironmentBlocked('Playwright module not installed. Supply CHRONICLE_PLAYWRIGHT_MODULE pointing at an existing installation.');
  const executable = process.env.CHRONICLE_CHROMIUM_EXECUTABLE || playwright.chromium.executablePath();
  receipt.runner.chromiumExecutable = executable;
  try { await access(executable, constants.X_OK); }
  catch { throw new EnvironmentBlocked('Chromium executable missing. Supply CHRONICLE_CHROMIUM_EXECUTABLE or provision the pinned Playwright browser before this offline test. No browser download was attempted by this runner.'); }
  receipt.runner.chromiumSHA256 = sha256(await readFile(executable));
  const hostEnvironment = Object.fromEntries(['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA', 'HOME', 'DISPLAY', 'XAUTHORITY', 'LANG'].filter(name => process.env[name] !== undefined).map(name => [name, process.env[name]]));
  server = spawn(process.execPath, ['serve.mjs'], { cwd: app, env: { ...hostEnvironment, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let serverLog = '';
  const base = await new Promise((resolveURL, reject) => {
    const timer = setTimeout(() => reject(new Error('Local app server did not start')), 10_000);
    server.on('exit', code => { clearTimeout(timer); reject(new Error(`Local server exited: ${code}`)); });
    server.stderr.on('data', data => { serverLog += data.toString(); });
    server.stdout.on('data', data => {
      serverLog += data.toString();
      const match = serverLog.match(/http:\/\/localhost:(\d+)\//);
      if (match) { clearTimeout(timer); resolveURL(`http://127.0.0.1:${match[1]}`); }
    });
  });
  const response = await fetch(`${base}/build-info.json`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), receipt.build);
  browser = await playwright.chromium.launch({ executablePath: executable, headless: true, env: hostEnvironment });
  receipt.browser = { version: browser.version(), engine: 'Chromium', headless: true };
  context = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 1, reducedMotion: 'reduce', acceptDownloads: true, serviceWorkers: 'block' });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === base && url.pathname === '/visualization-canary') { receipt.guestCanaryRequests++; return route.fulfill({ status: 200, contentType: 'text/plain', body: 'synthetic network canary' }); }
    if (url.origin === base) return route.continue();
    const headers = route.request().headers();
    if (publicSourceGate && url.origin === 'https://query.wikidata.org' && url.pathname === '/sparql' && url.searchParams.get('query')?.includes('VALUES ?item { wd:Q84 }') && url.searchParams.get('format') === 'json' && route.request().method() === 'GET' && !headers.cookie && !headers.authorization && !receipt.isolation.externalAttempts.some(entry => entry.action === 'continued')) {
      receipt.isolation.externalAttempts.push({ origin: url.origin, resourceType: route.request().resourceType(), action: 'continued', credentialsSent: false }); return route.continue();
    }
    receipt.isolation.externalAttempts.push({ origin: url.origin, resourceType: route.request().resourceType(), action: 'aborted' });
    return route.abort('blockedbyclient');
  });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
  const page = await context.newPage();
  page.on('pageerror', error => receipt.pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') receipt.consoleErrors.push(message.text()); });
  await page.goto(`${base}/?verify=1${renderer === 'canvas' ? '&renderer=canvas' : ''}`, { waitUntil: 'load', timeout: 30_000 });
  await page.waitForFunction(() => Number(document.querySelector('#scene-generation')?.textContent) > 0, undefined, { timeout: 30_000 });
  assert.equal(receipt.consoleErrors.length, 0, JSON.stringify(receipt.consoleErrors));
  await page.locator('#research-toggle').click();
  await ready(page);
  if (renderer === 'canvas') assert.match(await page.locator('#renderer-status').textContent(), /Canvas 2D/);
  else assert.match(await page.locator('#renderer-status').textContent(), /MapLibre/);
  if (gateSet === 'visualization') await gate('boundedVisualization', async () => {
    const { FileDropAdapter } = await import('@chronicle/planner/files');
    const { EvidenceSourceRegistry, GroundedEvidencePlanner } = await import('@chronicle/planner/evidence');
    const { createRenderSpecification } = await import('@chronicle/contracts/visualization');
    const { preparedRenderSpecification } = await import('@chronicle/view-adapters/visualization');
    const csv = 'id,label,variable,value,unit,startYear,endYear\nsynthetic-a,Synthetic zero,count,0,items,1769,1769\nsynthetic-b,Synthetic next,count,2,items,1800,1800\n';
    const files = new FileDropAdapter(), sources = new EvidenceSourceRegistry(); sources.register(files);
    const planner = new GroundedEvidencePlanner(sources), workspace = planner.fromRecords({ question: '', sourceIds: [files.id], bounds: null, temporalRange: null }, files.ingest('synthetic-visualization.csv', csv));
    await expand(page, '.evidence-intake'); await page.getByLabel('Import evidence file', { exact: true }).setInputFiles({ name: 'synthetic-visualization.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await page.waitForFunction(() => document.querySelector('.research-workspace')?.dataset.domain === 'imported-evidence' && document.querySelector('#research-status')?.dataset.status === 'ready');
    const widget = page.locator('.visualization-preview'); assert.equal(await widget.getAttribute('data-launches'), '0');
    await expand(page, '.visualization-preview'); await page.getByRole('button', { name: 'Run prepared sandbox layout', exact: true }).click();
    const prepared = await visualizationState(page); assert.equal(prepared.status, 'rendered', prepared.message); assert.equal(prepared.activeWorkers, 0); assert.ok(prepared.elapsedMs <= 50); assert.equal(prepared.svgCount, 1);
    const mark = page.locator('.visualization-surface [data-record-id]').first(), selected = await mark.getAttribute('data-record-id'); await mark.focus(); await mark.press('Enter');
    assert.equal(await page.locator('.imported-evidence-inspector').getAttribute('data-record-id'), selected);
    const launchesBeforeCursor = await widget.getAttribute('data-launches');
    const selectedRecord = workspace.bundle.records.find(record => record.id === selected);
    await page.getByRole('button', { name: `Browse ${selectedRecord.time.startYear} CE`, exact: true }).click();
    await page.waitForFunction(year => document.querySelector('.research-workspace')?.dataset.cursorYear === String(year), selectedRecord.time.startYear);
    assert.equal(await widget.getAttribute('data-launches'), launchesBeforeCursor, 'cursor/selection is host-owned and does not re-execute code');
    await page.getByRole('button', { name: 'Filter table to cursor', exact: true }).click(); assert.equal(await page.locator('.visualization-surface [data-record-id]:visible').count(), 1); await page.getByRole('button', { name: 'Show full analysis table', exact: true }).click();
    await widget.scrollIntoViewIfNeeded(); await screenshot(page, 'visualization-375.png');
    const spec = preparedRenderSpecification(workspace), dimensions = { width: spec.width, height: spec.height };
    const wrapped = expression => `const output=(function(evidence){${spec.program}\n})(evidence); return ${expression};`;
    const programs = [
      ['loop', 'for (;;) {}'], ['heap', `const heap = new Uint8Array(9 * 1024 * 1024); heap.fill(1); ${spec.program}`],
      ['network', `return fetch(${JSON.stringify(base + '/visualization-canary')});`], ['cookies', 'return document.cookie;'], ['node-host', 'return process.env;'],
      ['module-loader', 'return import("https://fixture.invalid/guest.js");'], ['output-flood', 'return "x".repeat(100000);'],
      ['event-handler', wrapped('output.replace("<svg ", "<svg onload=\\\"globalThis.guestCanary=true\\\" ")')],
      ['external-svg', wrapped('output.replace("#e8f3f5", "url(https://fixture.invalid/resource)")')],
      ['forged-record', wrapped('output.replace("data-record-id=\\\"", "data-record-id=\\\"forged-")')],
      ['invented-text', wrapped('output.replace("Synthetic zero", "Invented historical claim")')],
    ];
    const denied = [];
    for (const [name, program] of programs) {
      const result = await loadVisualization(page, createRenderSpecification(workspace.bundle, program, dimensions));
      assert.equal(result.status, 'fallback', name); assert.equal(result.svgCount, 0, name); assert.equal(result.activeWorkers, 0, name); assert.equal(result.launches, result.terminations, name);
      if (name === 'heap') assert.match(result.message, /GUEST_ERROR/);
      if (['event-handler', 'external-svg', 'forged-record', 'invented-text'].includes(name)) assert.match(result.message, /INVALID_OUTPUT/);
      if (name === 'output-flood') assert.match(result.message, /OUTPUT_LIMIT/);
      denied.push({ name, message: result.message, elapsedMs: result.elapsedMs });
    }
    assert.equal(receipt.guestCanaryRequests, 0); assert.equal(receipt.isolation.externalAttempts.length, 0);
    const beforeInvalid = await widget.getAttribute('data-launches');
    await page.getByLabel('Choose a sandboxed render specification', { exact: true }).setInputFiles({ name: 'bad-budget.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...spec, limits: { ...spec.limits, executionMs: 5000 } })) });
    await page.getByText('Specification rejected. Current evidence is unchanged.', { exact: true }).waitFor(); assert.equal(await widget.getAttribute('data-launches'), beforeInvalid);
    await page.getByRole('button', { name: 'Run prepared sandbox layout', exact: true }).click(); await visualizationState(page);
    const cancellation = await page.evaluate(() => { document.querySelector('.visualization-preview button').click(); const buttons = [...document.querySelectorAll('.visualization-preview button')]; buttons.find(button => button.textContent === 'Cancel visualization').click(); return document.querySelector('.visualization-preview').dataset.status; });
    assert.equal(cancellation, 'fallback'); assert.equal(await widget.getAttribute('data-active-workers'), '0');
    const cycles = []; for (let cycle = 0; cycle < 20; cycle++) { const result = await loadVisualization(page, spec); assert.equal(result.status, 'rendered', `cycle ${cycle}: ${result.message}`); assert.equal(result.activeWorkers, 0); assert.equal(result.launches, result.terminations); cycles.push(result.elapsedMs); }
    await page.setViewportSize({ width: 1440, height: 1000 }); await widget.scrollIntoViewIfNeeded(); await screenshot(page, 'visualization-desktop.png');
    await page.getByRole('button', { name: 'Close research workspace', exact: true }).click(); assert.equal(await widget.getAttribute('data-active-workers'), '0'); assert.equal(await page.locator('.visualization-surface svg').count(), 0);
    planner.dispose(); return { profile: 'Real QuickJS/WASM in actual browser workers; synthetic data only', limits: { executionMs: 50, guestHeapBytes: 8388608 }, prepared, denied, guestNetworkCanaryRequests: receipt.guestCanaryRequests, selectionAndCursorWithoutGuestOrModel: true, codeRequiresExplicitRun: true, budgetOverridesRejectedBeforeLaunch: true, sameTaskControlCancellation: true, cycleElapsedMs: cycles, cycles: 20, physicalGPU: 'NOT RUN' };
  });
  if (gateSet === 'visualization-live') await gate('generatedVisualization', async () => {
    assert.ok(args.includes('--live') && args.includes('--gemini-wikidata'), 'Explicit --live --gemini-wikidata flags are required');
    const { EvidenceSourceRegistry, GroundedEvidencePlanner } = await import('@chronicle/planner/evidence');
    const { WikidataHistoricalAdapter } = await import('@chronicle/planner/wikidata');
    const { GeminiEvidenceLayout } = await import('@chronicle/planner/gemini-evidence');
    let responsePromise;
    page.on('response', response => { if (new URL(response.url()).origin === 'https://query.wikidata.org') responsePromise = response.body().then(bytes => ({ bytes, url: response.url(), status: response.status() })); });
    await page.setViewportSize({ width: 1440, height: 1000 }); await expand(page, '.evidence-intake');
    await page.getByLabel('Evidence source', { exact: true }).selectOption('wikidata'); await page.getByLabel('Evidence search', { exact: true }).fill('Q84'); await page.getByRole('checkbox', { name: 'Allow this search text to be sent to Wikidata (not Gemini)', exact: true }).check(); await page.getByRole('button', { name: 'Retrieve evidence', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.research-workspace')?.dataset.domain === 'imported-evidence' && document.querySelector('#research-status')?.dataset.status === 'ready', undefined, { timeout: 20000 });
    const captured = await responsePromise; assert.equal(captured.status, 200);
    let environment = { GEMINI_API_KEY: process.env.GEMINI_API_KEY };
    if (!environment.GEMINI_API_KEY) {
      const handle = await open(resolve(app, '../../.env'), 'r'), buffer = Buffer.alloc(16385);
      try { const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0); if (bytesRead > 16384) throw Error('CREDENTIAL_FILE_INVALID'); const encoding = buffer[0] === 255 && buffer[1] === 254 ? 'utf-16le' : buffer[0] === 254 && buffer[1] === 255 ? 'utf-16be' : 'utf-8'; environment = { GEMINI_API_KEY: parseEnv(new TextDecoder(encoding, { fatal: true }).decode(buffer.subarray(0, bytesRead)).replace(/^\uFEFF/, '')).GEMINI_API_KEY }; }
      catch { throw Error('CREDENTIAL_FILE_INVALID'); } finally { buffer.fill(0); await handle.close(); }
    }
    const provider = new GeminiEvidenceLayout({ modelId: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash', allowWikidata: true, environment, budgets: { inputTokens: 16000, outputTokens: 8192, sessionTokens: 24192, timeoutMs: 30000, outputBytes: 32768, maximumRequests: 1 } });
    const sources = new EvidenceSourceRegistry(); let cacheReads = 0;
    sources.register(new WikidataHistoricalAdapter({ fetch: async (url, options) => { assert.equal(String(url), captured.url); assert.equal(options.credentials, 'omit'); cacheReads++; return new Response(captured.bytes, { status: 200, headers: { 'content-type': 'application/sparql-results+json' } }); } }));
    const planner = new GroundedEvidencePlanner(sources);
    try {
      const proposal = await planner.prepareVisualization({ question: 'Q84', sourceIds: ['wikidata'], bounds: null, temporalRange: null }, { allowRemote: true, allowWikidataModelProcessing: true, generator: provider });
      const archive = await downloadReplay(page, 'generated-input-references.json'); assert.equal(archive.replay.workspace.specification.resultHash, proposal.workspace.bundle.resultHash);
      await writeJSON('generated-render-specification.json', proposal.specification);
      const rendered = await loadVisualization(page, proposal.specification); assert.equal(rendered.status, 'rendered', rendered.message); assert.equal(rendered.activeWorkers, 0); assert.ok(rendered.elapsedMs <= 50);
      assert.deepEqual([...new Set(rendered.recordIds)].sort(), [...proposal.specification.recordIds].sort());
      const mark = page.locator('.visualization-surface [data-record-id]').first(), recordId = await mark.getAttribute('data-record-id'); await mark.focus(); await mark.press('Enter'); assert.equal(await page.locator('.imported-evidence-inspector').getAttribute('data-record-id'), recordId);
      await page.locator('.visualization-preview').scrollIntoViewIfNeeded(); await screenshot(page, 'generated-wikidata-visualization.png');
      const warm = await loadVisualization(page, proposal.specification); assert.equal(warm.status, 'rendered', warm.message); assert.equal(provider.diagnostics().requests, 1); assert.equal(cacheReads, 1); assert.equal(receipt.isolation.externalAttempts.length, 1); assert.equal(receipt.guestCanaryRequests, 0);
      return { source: 'Real browser-fetched Wikidata Q84 response, reused byte-identically by the Node grounding adapter', sourceHash: sha256(captured.bytes), sourceHTTPStatus: 200, sourceRecords: proposal.workspace.bundle.records.length, provider: provider.diagnostics(), programHash: proposal.specification.programHash, inputHash: proposal.specification.inputHash, rendered, warm, modelProcessing: 'Wikidata-only explicit grant', importedFileModelProcessing: false, guestNetworkCanaryRequests: 0, rawCredentialsLogged: false };
    } finally { receipt.liveProvider = provider.diagnostics(); provider.dispose(); planner.dispose(); }
  });
  if (gateSet === 'ingestion-live') await gate('liveEvidenceIngestion', async () => {
    const statuses = []; page.on('response', response => { if (new URL(response.url()).origin === 'https://query.wikidata.org') statuses.push(response.status()); });
    await page.setViewportSize({ width: 1440, height: 1000 }); await expand(page, '.evidence-intake');
    await page.getByLabel('Evidence source', { exact: true }).selectOption('wikidata'); await page.getByLabel('Evidence search', { exact: true }).fill('Q84');
    await page.getByRole('checkbox', { name: 'Allow this search text to be sent to Wikidata (not Gemini)', exact: true }).check();
    await page.getByRole('button', { name: 'Retrieve evidence', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.research-workspace')?.dataset.domain === 'imported-evidence' && document.querySelector('#research-status')?.dataset.status === 'ready', undefined, { timeout: 20000 });
    const records = await page.locator('.imported-evidence button[data-import-record]').evaluateAll(nodes => nodes.map(node => node.dataset.importRecord));
    assert.ok(records.length > 0 && records.every(id => id.startsWith('wikidata:Q84:'))); assert.deepEqual(statuses, [200]);
    assert.equal(receipt.isolation.externalAttempts.length, 1); assert.equal(receipt.isolation.externalAttempts[0].action, 'continued');
    await page.locator('.imported-evidence button[data-import-record]').first().click();
    assert.match(await page.locator('.imported-evidence-inspector').textContent(), /Wikidata Query Service response/);
    await page.locator('.imported-evidence').evaluate(node => node.scrollIntoView({ block: 'start' })); await screenshot(page, 'live-wikidata-browser.png');
    return { realSource: 'Wikidata Q84, unreviewed metadata; not canonical historical publication', records: records.length, recordIds: records, sourceHTTPStatus: 200, modelRequests: 0, credentialsSent: false };
  });
  if (gateSet === 'ingestion') await gate('evidenceIngestion', async () => {
    const externalBefore = receipt.isolation.externalAttempts.length;
    const csv = [
      ['id', 'label', 'variable', 'value', 'unit', 'startYear', 'endYear', 'longitude', 'latitude', 'source', 'edition', 'locator'],
      ['synthetic-a', 'Synthetic <img src=x onerror=alert(1)>', 'count', '0', 'items', '1769', '1769', '0', '0', 'Synthetic browser fixture only', 'test-v1', 'row 1'],
      ['synthetic-b', 'Synthetic later record', 'count', '2', 'items', '1800', '1800', '1', '1', 'Synthetic browser fixture only', 'test-v1', 'row 2'],
      ['synthetic-c', 'Synthetic undated reference', 'description', '', '', '', '', '', '', 'Synthetic browser fixture only', 'test-v1', 'row 3'],
    ].map(row => row.map(value => `"${value.replaceAll('"', '""')}"`).join(',')).join('\r\n');
    await expand(page, '.evidence-intake');
    await page.getByLabel('Import evidence file', { exact: true }).setInputFiles({ name: 'synthetic.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await page.waitForFunction(() => document.querySelector('.research-workspace')?.dataset.domain === 'imported-evidence' && document.querySelector('#research-status')?.dataset.status === 'ready');
    const imported = page.locator('.imported-evidence'), inspector = page.locator('.imported-evidence-inspector');
    assert.equal(await imported.locator('tbody tr').count(), 3); assert.equal(await imported.locator('img,script,iframe').count(), 0);
    const first = imported.getByRole('button', { name: 'Synthetic <img src=x onerror=alert(1)>', exact: true });
    await first.focus(); await first.press('Enter'); const selected = await first.getAttribute('data-import-record');
    assert.equal(await inspector.getAttribute('data-record-id'), selected); assert.match(await inspector.textContent(), /Source SHA-256/);
    await imported.getByRole('button', { name: 'Browse 1769 CE', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.research-workspace')?.dataset.cursorYear === '1769');
    await page.getByRole('button', { name: 'Filter table to cursor', exact: true }).click();
    assert.equal(await imported.locator('tbody tr:visible').count(), 2);
    if (renderer === 'maplibre') await page.waitForFunction(() => document.querySelector('.maplibregl-canvas')?.dataset.researchFeatures === '2' && document.querySelector('.maplibregl-canvas')?.dataset.researchVisible === '1');
    await page.getByRole('button', { name: 'Show full analysis table', exact: true }).click();
    const narrow = await page.locator('.research-workspace').evaluate(panel => { const box = panel.getBoundingClientRect(), timeline = document.querySelector('.workspace > .transport').getBoundingClientRect(); return { documentWidth: document.documentElement.scrollWidth, x: box.x, right: box.right, bottom: box.bottom, timelineTop: timeline.y, clientWidth: panel.clientWidth, scrollWidth: panel.scrollWidth }; });
    assert.ok(narrow.documentWidth <= 375 && narrow.x >= 0 && narrow.right <= 375 && narrow.bottom <= narrow.timelineTop + 1 && narrow.scrollWidth <= narrow.clientWidth + 1);
    await imported.locator('.research-table-scroll').evaluate(node => node.scrollIntoView({ block: 'start' })); await screenshot(page, 'ingestion-375-table.png');
    const original = await downloadReplay(page, 'ingestion-saved.json'); assert.equal(original.replay.kind, 'chronicle-evidence-session'); assert.equal(original.replay.cursorYear, 1769);
    assert.equal(JSON.stringify(original.replay).includes('Synthetic browser fixture only'), false); assert.equal(JSON.stringify(original.replay).includes('<img'), false);
    await openPilot(page, 'Watt separate-condenser mechanism');
    await expand(page, '.research-replay'); await page.getByLabel('Choose a saved research replay').setInputFiles(original.path);
    await page.getByText('File read. Select Reopen pinned result to validate it.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Reopen pinned result', exact: true }).click(); await page.getByText('Reopened against matching local source records.', { exact: true }).waitFor(); await ready(page);
    assert.equal(await inspector.getAttribute('data-record-id'), selected);
    const reopened = await downloadReplay(page, 'ingestion-reopened.json'); assert.equal(sha256(await readFile(reopened.path)), sha256(await readFile(original.path)));
    await expand(page, '.evidence-intake');
    await page.getByLabel('Import evidence file', { exact: true }).setInputFiles({ name: 'invalid.csv', mimeType: 'text/csv', buffer: Buffer.from('id,label\nbad,"unterminated') });
    await page.waitForFunction(() => document.querySelector('#research-status')?.dataset.status === 'error');
    assert.equal(await imported.locator('tbody tr').count(), 3); assert.equal(await inspector.getAttribute('data-record-id'), selected);
    await page.setViewportSize({ width: 1440, height: 1000 });
    const polygon = { type: 'FeatureCollection', features: [{ type: 'Feature', id: 'synthetic-polygon', geometry: { type: 'Polygon', coordinates: [[[-60, -30], [60, -30], [60, 30], [-60, 30], [-60, -30]]] }, properties: { label: 'Synthetic polygon reference' } }] };
    await page.evaluate(archive => { const transfer = new DataTransfer(); transfer.items.add(new File([JSON.stringify(archive)], 'synthetic.geojson', { type: 'application/geo+json' })); document.querySelector('.workspace').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer })); }, polygon);
    await imported.getByRole('button', { name: 'Synthetic polygon reference', exact: true }).waitFor(); await ready(page);
    assert.equal(await imported.locator('tbody tr').count(), 1); assert.match(await imported.locator('tbody').textContent(), /Unknown time/);
    const canvasSelector = renderer === 'maplibre' ? '.maplibregl-canvas' : '.flat-canvas';
    await page.waitForFunction(selector => document.querySelector(selector)?.dataset.researchFeatures === '1' && document.querySelector(selector)?.dataset.researchVisible === '1', canvasSelector);
    const canvas = await page.locator(canvasSelector).boundingBox(), polygonId = await imported.getByRole('button', { name: 'Synthetic polygon reference', exact: true }).getAttribute('data-import-record');
    await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
    await page.waitForFunction(id => document.querySelector('.imported-evidence-inspector')?.dataset.recordId === id, polygonId);
    const graph = { '@context': 'https://schema.org', '@graph': [{ '@id': 'synthetic-jsonld', '@type': 'Event', name: 'Synthetic JSON-LD event', startDate: '1800', endDate: '1800', description: 'Synthetic browser fixture only' }] };
    await page.getByLabel('Import evidence file', { exact: true }).setInputFiles({ name: 'synthetic.jsonld', mimeType: 'application/ld+json', buffer: Buffer.from(JSON.stringify(graph)) });
    await imported.getByRole('button', { name: 'Synthetic JSON-LD event', exact: true }).waitFor(); await ready(page);
    assert.equal(await imported.locator('tbody tr').count(), 1);
    await page.setViewportSize({ width: 1440, height: 1000 }); await imported.getByRole('button', { name: 'Synthetic JSON-LD event', exact: true }).click();
    await inspector.scrollIntoViewIfNeeded(); await screenshot(page, 'ingestion-desktop-evidence.png');
    await expand(page, '.evidence-intake');
    await page.getByLabel('Evidence source', { exact: true }).selectOption('wikidata'); await page.getByLabel('Evidence search', { exact: true }).fill('Q84'); await page.getByRole('button', { name: 'Retrieve evidence', exact: true }).click();
    await page.getByText('Wikidata requires a search term and explicit network consent.', { exact: true }).waitFor(); assert.equal(receipt.isolation.externalAttempts.length, externalBefore);
    await page.getByRole('button', { name: 'Clear imported evidence cache', exact: true }).click();
    await openPilot(page, 'Watt separate-condenser mechanism'); await expand(page, '.research-replay'); await page.getByLabel('Pinned replay JSON', { exact: true }).fill(JSON.stringify(original.replay)); await page.getByRole('button', { name: 'Reopen pinned result', exact: true }).click();
    await page.getByText('Replay was rejected. The previous valid result is retained.', { exact: true }).waitFor(); assert.equal(await page.locator('.research-workspace').getAttribute('data-domain'), 'technological-mechanism');
    assert.equal(receipt.isolation.externalAttempts.length, externalBefore);
    await page.goto(`${base}/?research=off${renderer === 'canvas' ? '&renderer=canvas' : ''}`, { waitUntil: 'load' }); await page.waitForFunction(() => Number(document.querySelector('#scene-generation')?.textContent) > 0);
    assert.equal(await page.locator('#chronicle-omnibar').count(), 0); assert.equal(await page.locator('.evidence-intake').count(), 0);
    return { fixture: 'Explicitly synthetic UI fixtures, not the real-evidence acceptance gate', csv: true, geojsonFileDrop: true, jsonld: true, keyboardSelection: true, literalMarkup: true, cursorFiltering: true, unknownSupportPreserved: true, narrow, referenceReplaySHA256: sha256(await readFile(original.path)), failedImportRetainsEvidence: true, coldReplayFailsWithoutNetwork: true, remoteConsentRequired: true, featureDisabledAtlas: true, modelRequests: 0 };
  });
  if (gateSet === 'hud') await gate('floatingHud', async () => {
    const externalBefore = receipt.isolation.externalAttempts.length;
    await page.locator('#research-toggle').click();
    const omnibar = page.locator('#chronicle-omnibar'), query = page.getByRole('searchbox', { name: 'Research query', exact: true });
    assert.equal(await omnibar.isVisible(), true);
    await page.keyboard.press('/'); assert.equal(await query.evaluate(node => node === document.activeElement), true);
    await query.fill('Editing'); await page.keyboard.press('/'); assert.equal(await query.inputValue(), 'Editing/');
    await page.keyboard.press('Escape'); await page.keyboard.press('Control+k'); assert.equal(await query.evaluate(node => node === document.activeElement), true);
    await query.fill('Watt separate-condenser mechanism'); await query.press('Enter'); await ready(page);
    assert.equal(await page.locator('.research-workspace').getAttribute('data-domain'), 'technological-mechanism');
    assert.equal(await page.locator('.mechanism-table tbody tr').count(), 16);
    const narrow = await page.evaluate(() => {
      const box = node => { const { x, y, right, bottom, width, height } = node.getBoundingClientRect(); return { x, y, right, bottom, width, height }; };
      return { omnibar: box(document.querySelector('#chronicle-omnibar')), panel: box(document.querySelector('.research-workspace')), timeline: box(document.querySelector('.workspace > .transport')), documentWidth: document.documentElement.scrollWidth };
    });
    assert.ok(narrow.documentWidth <= 375 && narrow.omnibar.x >= 0 && narrow.omnibar.right <= 375);
    assert.ok(narrow.omnibar.bottom <= narrow.panel.y && narrow.panel.bottom <= narrow.timeline.y, 'omnibar, result and timeline must not occlude each other');
    await screenshot(page, 'hud-375-omnibar.png');
    await page.setViewportSize({ width: 1440, height: 1000 });
    const graph = page.getByRole('region', { name: 'Mechanism relationship graph', exact: true });
    await graph.waitFor({ state: 'visible' });
    await graph.locator('[data-graph-row="condenser"]').click();
    assert.equal(await page.locator('.mechanism-evidence').getAttribute('data-row-id'), 'condenser');
    assert.ok(await graph.locator('line[data-selected="true"]').count() > 0);
    const panel = page.locator('.research-workspace'), handle = page.locator('.research-heading'), before = await panel.boundingBox();
    await handle.focus(); await page.keyboard.press('ArrowRight'); const keyboardMoved = await panel.boundingBox(); assert.ok(keyboardMoved.x > before.x);
    const header = await handle.boundingBox();
    await page.mouse.move(header.x + 35, header.y + 10); await page.mouse.down(); await page.mouse.move(header.x + 95, header.y + 10, { steps: 5 }); await page.mouse.up();
    const dragged = await panel.boundingBox(); assert.ok(dragged.x > keyboardMoved.x + 40, 'pointer dragging moves the result card');
    await screenshot(page, 'hud-desktop-graph.png');
    const saved = await downloadReplay(page, 'hud-watt-saved.json');
    await query.fill('Four Mexican urban centres'); await query.press('Enter'); await ready(page);
    await expand(page, '.research-table-section');
    await page.getByRole('button', { name: 'Filter table to cursor', exact: true }).click();
    assert.equal(await page.locator('.research-table-section tbody tr:visible').count(), 0);
    await page.getByRole('button', { name: 'Show 2025 CE', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.research-workspace')?.dataset.cursorYear === '2025');
    assert.equal(await page.locator('.research-workspace').getAttribute('data-cursor-matches'), '4');
    assert.equal(await page.locator('.research-table-section tbody tr:visible').count(), 4);
    if (renderer === 'maplibre') {
      await page.waitForFunction(() => document.querySelector('.maplibregl-canvas')?.dataset.researchFeatures === '44' && document.querySelector('.maplibregl-canvas')?.dataset.researchVisible === '4');
    }
    const calloutsClear = await page.evaluate(() => {
      const bar = document.querySelector('#chronicle-omnibar').getBoundingClientRect();
      return [...document.querySelectorAll('.research-map-marker:not([hidden])')].every(node => { const rect = node.getBoundingClientRect(); return rect.right <= bar.left || rect.left >= bar.right || rect.bottom <= bar.top || rect.top >= bar.bottom; });
    });
    assert.equal(calloutsClear, true, 'research callouts must not hide underneath the omnibar');
    await screenshot(page, 'hud-spatial-cursor.png');
    if (renderer === 'maplibre') {
      await expand(page, '.research-verification');
      await page.getByRole('button', { name: 'Verify basemap style reloads', exact: true }).click();
      await page.waitForFunction(() => { try { return ['PASS', 'FAIL'].includes(JSON.parse(document.querySelector('#research-environment-result')?.textContent ?? '').status); } catch { return false; } }, undefined, { timeout: 90000 });
      const restoredStyle = JSON.parse(await page.locator('#research-environment-result').textContent());
      await writeJSON('hud-style-reload.json', restoredStyle); assert.equal(restoredStyle.status, 'PASS');
      assert.equal(await page.locator('.maplibregl-canvas').getAttribute('data-research-features'), '44');
    }
    await expand(page, '.research-replay'); await page.getByLabel('Choose a saved research replay').setInputFiles(saved.path);
    await page.getByText('File read. Select Reopen pinned result to validate it.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Reopen pinned result', exact: true }).click();
    await page.getByText('Reopened against matching local source records.', { exact: true }).waitFor(); await ready(page);
    const reopened = await downloadReplay(page, 'hud-watt-reopened.json');
    const replayHash = sha256(await readFile(saved.path)); assert.equal(sha256(await readFile(reopened.path)), replayHash);
    assert.equal(await page.locator('.mechanism-evidence').getAttribute('data-row-id'), 'condenser');
    await query.fill('Invent an unsupported historical total'); await query.press('Enter');
    await page.waitForFunction(() => document.querySelector('.omnibar-status')?.textContent.includes('unavailable'));
    const retained = await downloadReplay(page, 'hud-unsupported-retained.json'); assert.equal(sha256(await readFile(retained.path)), replayHash);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.getByRole('button', { name: 'Open mechanism relationship graph', exact: true }).click();
    assert.equal(await graph.isVisible(), true); await graph.getByRole('button', { name: 'Close graph', exact: true }).click();
    assert.equal(await graph.isHidden(), true);
    assert.equal(receipt.isolation.externalAttempts.length, externalBefore);
    const disabled = await context.newPage(); disabled.on('pageerror', error => receipt.pageErrors.push(error.message));
    await disabled.goto(`${base}/?research=off&renderer=canvas`, { waitUntil: 'load' });
    await disabled.waitForFunction(() => Number(document.querySelector('#scene-generation')?.textContent) > 0);
    assert.equal(await disabled.locator('#chronicle-omnibar').count(), 0); await disabled.close();
    return { narrow, keyboardFocus: true, keyboardAndPointerDrag: true, graphCrossSelection: true, cursorFilterCount: 4, nativeGeoJSON: renderer === 'maplibre', replayHash, unsupportedQueryRetainsResult: true, featureDisabledAtlas: true, modelRequests: 0 };
  });
  if (gateSet === 'watt') await gate('wattMechanism', async () => {
    const records = JSON.parse(await readFile(join(app, 'src/domains/watt-mechanism/data/watt-1769-mechanism.json'), 'utf8'));
    const quote = id => records.claims.find(claim => claim.id === id).quote;
    const externalBefore = receipt.isolation.externalAttempts.length, sceneBefore = await page.locator('#scene-generation').textContent();
    await openPilot(page, 'Watt separate-condenser mechanism');
    const mechanism = page.locator('.mechanism-workspace');
    await mechanism.waitFor({ state: 'visible' });
    assert.equal(await page.locator('.research-workspace').getAttribute('data-domain'), 'technological-mechanism');
    assert.equal(await page.locator('.research-result:not(.mechanism-workspace)').isHidden(), true, 'geographic result views are hidden');
    const rows = async view => mechanism.locator(`.mechanism-table[data-view="${view}"] tbody tr`).count();
    const counts = { components: await rows('component-table'), functions: await rows('function-table') };
    assert.deepEqual(counts, { components: records.components.length, functions: records.functions.length });
    const map = await page.evaluate(() => ({ markers: document.querySelectorAll('.research-map-marker').length, overlayNodes: document.querySelector('#research-map-overlay')?.childElementCount ?? 0, scene: document.querySelector('#scene-generation')?.textContent }));
    assert.deepEqual(map, { markers: 0, overlayNodes: 0, scene: sceneBefore }, 'the non-map domain adds no markers and leaves the Atlas scene untouched');
    await mechanism.locator('button[data-mechanism-row="separate-condensation"][data-mechanism-claim="c-second-condensers"]').click();
    const evidence = mechanism.locator('.mechanism-evidence');
    assert.equal(await evidence.getAttribute('data-claim-id'), 'c-second-condensers');
    assert.equal(await evidence.locator('blockquote').textContent(), quote('c-second-condensers'));
    assert.deepEqual(await mechanism.locator('.mechanism-table[data-view="component-table"] tr[data-related="true"]').evaluateAll(items => items.map(item => item.dataset.mechanismRow)), ['steam-vessel', 'condenser']);
    await mechanism.locator('button[data-mechanism-row="condenser"][data-mechanism-claim="c-second-cold"]').click();
    assert.equal(await evidence.getAttribute('data-row-id'), 'condenser'); assert.equal(await evidence.locator('blockquote').textContent(), quote('c-second-cold'));
    const relatedFunctions = await mechanism.locator('.mechanism-table[data-view="function-table"] tr[data-related="true"]').evaluateAll(items => items.map(item => item.dataset.mechanismRow));
    assert.deepEqual(relatedFunctions, ['separate-condensation', 'cool-condenser', 'extract-uncondensed']);
    await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Enter');
    assert.equal(await evidence.getAttribute('data-claim-id'), 'c-second-condensers', 'keyboard activation dispatches the same typed selection');
    await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
    assert.equal(await evidence.getAttribute('data-claim-id'), 'c-second-cold');
    const narrow = await page.evaluate(() => {
      const panel = document.querySelector('.research-workspace'), box = panel.getBoundingClientRect(), timeline = document.querySelector('.workspace > .transport').getBoundingClientRect();
      const tables = [...document.querySelectorAll('.mechanism-workspace .research-table-scroll')].map(table => ({ clientWidth: table.clientWidth, scrollWidth: table.scrollWidth, overflowX: getComputedStyle(table).overflowX }));
      return { documentWidth: document.documentElement.scrollWidth, panel: { x: box.x, right: box.right, width: box.width, bottom: box.bottom }, panelClientWidth: panel.clientWidth, panelScrollWidth: panel.scrollWidth, timelineTop: timeline.y, timelineBottom: timeline.bottom, tables };
    });
    assert.ok(narrow.documentWidth <= 375 && narrow.panel.x >= 0 && narrow.panel.right <= 375 && narrow.panel.width > 300, 'panel fits 375px');
    assert.ok(narrow.panelScrollWidth <= narrow.panelClientWidth + 1, 'only inner tables may scroll horizontally');
    assert.ok(narrow.panel.bottom <= narrow.timelineTop + 1 && narrow.timelineBottom <= 813, 'timeline dock stays visible');
    assert.ok(narrow.tables.length === 2 && narrow.tables.every(table => ['auto', 'scroll'].includes(table.overflowX)), 'tables have bounded scroll surfaces');
    await page.locator('.research-heading').scrollIntoViewIfNeeded();
    await screenshot(page, 'watt-375-tables.png');
    await evidence.scrollIntoViewIfNeeded(); await screenshot(page, 'watt-375-evidence.png');
    const initial = await downloadReplay(page, 'watt-saved-replay.json');
    assert.equal(initial.replay.kind, 'chronicle-mechanism-replay');
    assert.deepEqual(initial.replay.selection, { entityId: 'condenser', observationId: 'c-second-cold' });
    await openPilot(page, 'Four Mexican urban centres');
    assert.equal(await page.locator('.research-workspace').getAttribute('data-domain'), 'geographic');
    await expand(page, '.research-replay');
    await page.getByLabel('Choose a saved research replay').setInputFiles(initial.path);
    await page.getByText('File read. Select Reopen pinned result to validate it.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Reopen pinned result', exact: true }).click();
    await page.getByText('Reopened against matching local source records.', { exact: true }).waitFor();
    await ready(page);
    const reopened = await downloadReplay(page, 'watt-reopened-replay.json');
    assert.deepEqual(reopened.replay, initial.replay);
    const originalHash = sha256(await readFile(initial.path)), reopenedHash = sha256(await readFile(reopened.path));
    assert.equal(reopenedHash, originalHash, 'deterministic mechanism replay bytes and hashes');
    assert.equal(await evidence.getAttribute('data-claim-id'), 'c-second-cold');
    const revision = await page.locator('.research-workspace').getAttribute('data-revision');
    await page.locator('#research-replay-json').fill('{invalid');
    await page.getByRole('button', { name: 'Reopen pinned result', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.research-replay-status')?.textContent.includes('valid JSON'));
    assert.equal(await page.locator('.research-workspace').getAttribute('data-revision'), revision);
    assert.equal(receipt.isolation.externalAttempts.length, externalBefore, 'mechanism tables and replay make no model or external requests');
    await page.setViewportSize({ width: 1440, height: 1000 });
    const desktopTables = await mechanism.locator('.research-table-scroll').evaluateAll(items => items.map(item => ({ clientWidth: item.clientWidth, scrollWidth: item.scrollWidth })));
    assert.ok(desktopTables.every(table => table.scrollWidth <= table.clientWidth + 1), 'desktop tables fit without horizontal scrolling');
    await page.locator('.research-heading').scrollIntoViewIfNeeded();
    await screenshot(page, 'watt-desktop-summary.png');
    for (const [view, file] of [['component-table', 'watt-desktop-components.png'], ['function-table', 'watt-desktop-functions.png']]) {
      await mechanism.locator(`.mechanism-table[data-view="${view}"] h4`).evaluate(item => item.scrollIntoView({ block: 'start' }));
      await screenshot(page, file);
    }
    await evidence.evaluate(item => item.scrollIntoView({ block: 'start' })); await screenshot(page, 'watt-desktop-evidence.png');
    return { counts, claims: records.claims.length, map, narrow, desktopTables, originalHash, reopenedHash, archiveKind: initial.replay.kind, selection: initial.replay.selection, invalidJSONRetainsPreviousResult: true, keyboardSelection: true, modelRequests: 0 };
  });
  if (gateSet === 'm3') await gate('responsive375', async () => {
    await page.locator('#research-toggle').click();
    await page.locator('#explore-toggle').click();
    const explorer = await hostPanelLayout(page, '#explore-drawer');
    await screenshot(page, 'responsive-375-explorer.png');
    await page.locator('#explore-toggle').click();
    await page.getByLabel('Search states and cities', { exact: true }).fill('Roman');
    await page.locator('#entity-legend button[data-entity]').first().click();
    const inspector = await hostPanelLayout(page, '#inspector');
    await screenshot(page, 'responsive-375-inspector.png');
    await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
    await page.locator('#research-toggle').click();
    await ready(page);
    await expand(page, '.research-table-section');
    const modern = await layout(page);
    await page.locator('.research-heading').scrollIntoViewIfNeeded();
    await screenshot(page, 'responsive-375-modern.png');
    assertLayout(modern);
    await openPilot(page, 'Premodern exchange accounts');
    await expand(page, '.research-table-section');
    const qualitative = await layout(page);
    await page.locator('.research-heading').scrollIntoViewIfNeeded();
    await screenshot(page, 'responsive-375-premodern.png');
    assertLayout(qualitative);
    await page.getByRole('button', { name: 'Collapse research panel to see the map' }).click();
    assert.equal(await page.getByRole('button', { name: 'Collapse research panel to see the map' }).getAttribute('aria-pressed'), 'true');
    await screenshot(page, 'responsive-375-map-mode.png');
    await page.getByRole('button', { name: 'Collapse research panel to see the map' }).click();
    return { explorer, inspector, modern, qualitative, mapModeToggle: 'PASS', reducedMotion: 'browser emulation only' };
  });
  if (gateSet === 'm3') await gate('interactiveSaveReopen', async () => {
    const cycles = [], externalBefore = receipt.isolation.externalAttempts.length;
    for (const [name, title, other] of [['modern', 'Four Mexican urban centres', 'Premodern exchange accounts'], ['premodern', 'Premodern exchange accounts', 'Four Mexican urban centres']]) {
      await openPilot(page, title);
      await expand(page, '.research-table-section');
      await page.locator('.research-table-scroll button[data-research-observation]').first().click();
      const selected = await page.locator('#research-evidence').getAttribute('data-observation-id');
      assert.ok(selected, 'table click selects actual evidence');
      const initial = await downloadReplay(page, `${name}-saved-replay.json`);
      await openPilot(page, other);
      await expand(page, '.research-replay');
      await page.getByLabel('Choose a saved research replay').setInputFiles(initial.path);
      await page.getByText('File read. Select Reopen pinned result to validate it.', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Reopen pinned result', exact: true }).click();
      await page.getByText('Reopened against matching local source records.', { exact: true }).waitFor();
      await ready(page);
      const reopened = await downloadReplay(page, `${name}-reopened-replay.json`);
      assert.deepEqual(reopened.replay, initial.replay, 'saved/reopened archive is identical including revision ancestry, views, cursor and selection');
      const originalHash = sha256(await readFile(initial.path)), reopenedHash = sha256(await readFile(reopened.path));
      assert.equal(reopenedHash, originalHash, 'deterministic replay bytes and hashes');
      assert.equal(await page.locator('#research-evidence').getAttribute('data-observation-id'), selected);
      await screenshot(page, `${name}-interactive-file-reopen.png`);
      const revision = await page.locator('.research-workspace').getAttribute('data-revision');
      await page.locator('#research-replay-json').fill('{invalid');
      await page.getByRole('button', { name: 'Reopen pinned result', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.research-replay-status')?.textContent.includes('valid JSON'));
      assert.equal(await page.locator('.research-workspace').getAttribute('data-revision'), revision);
      assert.equal(await page.locator('#research-evidence').getAttribute('data-observation-id'), selected);
      cycles.push({ pilot: name, archiveEqual: true, originalHash, reopenedHash, selectedObservation: selected, archiveKind: initial.replay.kind, invalidJSONRetainsPreviousResult: true });
    }
    assert.equal(receipt.isolation.externalAttempts.length, externalBefore, 'save/reopen must not attempt model or external requests');
    return { input: 'real browser downloads, file uploads and controls for both pilots', cycles, modelRequests: 0 };
  });
  if (gateSet === 'm3') await gate('original200Plus200', async () => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openPilot(page, 'Four Mexican urban centres');
    await page.getByRole('button', { name: 'Focus study area', exact: true }).click();
    await expand(page, '.research-verification');
    await page.getByRole('button', { name: 'Measure 200 selections, 200 combined updates + lifecycle', exact: true }).click();
    await page.waitForFunction(() => {
      try { const result = JSON.parse(document.querySelector('#research-verification-result')?.textContent || ''); return ['PASS', 'FAIL'].includes(result.status); } catch { return false; }
    }, undefined, { timeout: 180_000 });
    const benchmark = JSON.parse(await page.locator('#research-verification-result').textContent());
    await writeJSON('original-200-plus-200.json', benchmark);
    await screenshot(page, 'original-200-plus-200.png');
    assert.equal(benchmark.status, 'PASS', JSON.stringify({ failures: benchmark.failures, error: benchmark.error, selection: benchmark.phases?.selectionOnly.p95Ms, combined: benchmark.phases?.selectionAndCursor.p95Ms }));
    assert.deepEqual(benchmark.build, receipt.build);
    assert.equal(benchmark.workload.observations, 44); assert.equal(benchmark.workload.entities, 4);
    assert.equal(benchmark.phases.selectionOnly.interactionCount, 200); assert.equal(benchmark.phases.selectionAndCursor.interactionCount, 200);
    assert.equal(benchmark.phases.selectionOnly.targetP95Ms, 50); assert.equal(benchmark.phases.selectionAndCursor.targetP95Ms, 100);
    assert.equal(benchmark.phases.selectionOnly.samplesMs.length, 200); assert.equal(benchmark.phases.selectionAndCursor.samplesMs.length, 200);
    assert.equal(benchmark.workload.replaceCloseCycles, 20); assert.equal(benchmark.workload.mountDisposeCycles, 20);
    assert.ok(benchmark.hostSurface.sameCanvasObject);
    return { receipt: 'original-200-plus-200.json', observations: 44, entities: 4, selectionP95Ms: benchmark.phases.selectionOnly.p95Ms, combinedP95Ms: benchmark.phases.selectionAndCursor.p95Ms, selectionTargetMs: 50, combinedTargetMs: 100, selectionSamples: 200, combinedSamples: 200, closeReopenCycles: 20, mountDisposeCycles: 20 };
  });
  assert.equal(receipt.pageErrors.length, 0, JSON.stringify(receipt.pageErrors));
  assert.equal(receipt.consoleErrors.length, 0, JSON.stringify(receipt.consoleErrors));
  receipt.status = Object.values(receipt.gates).every(gate => gate.status === 'PASS') ? 'PASS' : 'FAIL';
  if (receipt.status === 'FAIL') process.exitCode = 1;
} catch (error) {
  receipt.status = error instanceof EnvironmentBlocked ? 'BLOCKED' : 'FAIL';
  receipt.error = { name: error.name, message: error.message };
  if (activeGate) receipt.gates[activeGate] = { status: 'FAIL', message: error.message };
  if (receipt.status === 'BLOCKED') for (const gate of Object.values(receipt.gates)) { gate.status = 'BLOCKED'; gate.reason = error.message; }
  process.exitCode = receipt.status === 'BLOCKED' ? 2 : 1;
} finally {
  if (context) {
    try {
      const path = join(out, 'headless-trace.zip');
      await context.tracing.stop({ path });
      receipt.artifacts.push({ file: 'headless-trace.zip', sha256: sha256(await readFile(path)) });
    } catch {}
  }
  await browser?.close();
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    const timeout = setTimeout(() => server.kill('SIGKILL'), 1000);
    await once(server, 'exit'); clearTimeout(timeout);
  }
  receipt.finishedAt = new Date().toISOString();
  await writeFile(join(out, 'acceptance.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify({ status: receipt.status, build: receipt.build?.build_id, gates: receipt.gates, error: receipt.error, receipt: join(out, 'acceptance.json') }, null, 2));
}
