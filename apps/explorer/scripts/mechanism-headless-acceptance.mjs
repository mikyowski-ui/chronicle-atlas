import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const explorer = fileURLToPath(new URL('../', import.meta.url)), app = fileURLToPath(new URL('../../mechanism-explorer/', import.meta.url));
const outIndex = process.argv.indexOf('--out'), out = outIndex < 0 ? join(explorer, 'verification/m4/mechanism-explorer') : resolve(process.argv[outIndex + 1]); await mkdir(out, { recursive: true });
const { chromium } = createRequire(import.meta.url)(join(explorer, 'verification-tools/node_modules/playwright'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const environment = Object.fromEntries(['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA', 'HOME', 'LANG'].filter(name => process.env[name] !== undefined).map(name => [name, process.env[name]]));
const report = { schemaVersion: 1, status: 'NOT RUN', startedAt: new Date().toISOString(), platform: process.platform, node: process.version, browser: null, build: null, checks: [], screenshots: [], externalRequests: [], pageErrors: [], consoleErrors: [] };
let server, browser, context;
try {
  report.build = JSON.parse(await readFile(join(app, 'dist/build-info.json'), 'utf8'));
  assert.equal(report.build.mapDependencies, false); assert.equal(report.build.nodeProviderBundled, false);
  server = spawn(process.execPath, ['serve.mjs'], { cwd: app, env: { ...environment, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('SERVER_START_TIMEOUT')), 10000);
    server.on('exit', () => { clearTimeout(timer); reject(Error('SERVER_EXIT')); });
    server.stdout.on('data', bytes => { const match = bytes.toString().match(/http:\/\/localhost:(\d+)\//); if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`); } });
  });
  browser = await chromium.launch({ headless: true, env: environment }); report.browser = browser.version();
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', acceptDownloads: true, serviceWorkers: 'block' });
  await context.route('**/*', route => { const url = new URL(route.request().url()); if (url.origin === base) return route.continue(); report.externalRequests.push(url.origin); return route.abort(); });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
  const page = await context.newPage(); page.on('pageerror', error => report.pageErrors.push(error.message)); page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
  const ready = () => page.waitForFunction(() => document.querySelector('.mechanism-demo')?.dataset.status === 'ready');
  const picture = async name => { const bytes = await page.screenshot({ path: join(out, name), fullPage: true }); report.screenshots.push({ file: name, sha256: sha256(bytes) }); };
  const expand = async () => { const details = page.locator('.research-replay'); if (await details.getAttribute('open') === null) await details.locator('summary').click(); };
  const save = async name => {
    await expand(); const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Save replay JSON', exact: true }).click();
    const download = await pending, path = join(out, name); assert.equal(await download.failure(), null); await download.saveAs(path); return { path, bytes: await readFile(path) };
  };
  await page.goto(base, { waitUntil: 'load' }); await ready();
  assert.equal(await page.locator('canvas').count(), 0);
  assert.equal(await page.locator('.mechanism-table[data-view="component-table"] tbody tr').count(), 8);
  assert.equal(await page.locator('.mechanism-table[data-view="function-table"] tbody tr').count(), 8);
  await page.locator('button[data-mechanism-row="condenser"][data-mechanism-claim="c-second-cold"]').click();
  assert.equal(await page.locator('.mechanism-evidence').getAttribute('data-claim-id'), 'c-second-cold');
  await page.getByRole('spinbutton', { name: 'Browsing year', exact: true }).fill('1800');
  assert.equal(await page.locator('.mechanism-demo').getAttribute('data-cursor-year'), '1800');
  const original = await save('standalone-saved.json');
  await page.getByRole('button', { name: 'Reset mechanism', exact: true }).click(); await ready(); await expand();
  await page.getByLabel('Choose a saved research replay').setInputFiles(original.path);
  await page.getByText('File read. Select Reopen pinned result to validate it.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Reopen pinned result', exact: true }).click();
  await page.getByText('Reopened against matching local source records.', { exact: true }).waitFor(); await ready();
  const reopened = await save('standalone-reopened.json'); assert.equal(sha256(reopened.bytes), sha256(original.bytes));
  report.checks.push({ name: 'standalone-save-reopen', status: 'PASS', sha256: sha256(original.bytes), selection: JSON.parse(original.bytes).selection });
  const atlasPath = join(explorer, 'verification/m4/watt/watt-saved-replay.json'), atlas = await readFile(atlasPath);
  await page.getByLabel('Choose a saved research replay').setInputFiles(atlasPath);
  await page.getByText('File read. Select Reopen pinned result to validate it.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Reopen pinned result', exact: true }).click(); await ready();
  const crossApp = await save('atlas-reopened-in-standalone.json'); assert.equal(sha256(crossApp.bytes), sha256(atlas));
  report.checks.push({ name: 'atlas-to-standalone-replay', status: 'PASS', sha256: sha256(atlas) });
  await page.locator('.research-heading').scrollIntoViewIfNeeded(); await picture('standalone-desktop.png');
  await page.getByLabel('Pinned replay JSON').fill('{invalid'); await page.getByRole('button', { name: 'Reopen pinned result', exact: true }).click();
  await page.getByText('Replay rejected. Previous evidence is retained.', { exact: true }).waitFor();
  assert.equal(await page.locator('.mechanism-evidence').getAttribute('data-claim-id'), 'c-second-cold');
  await picture('standalone-invalid-replay-retained.png');
  await page.getByLabel('Pinned replay JSON').fill(atlas.toString('utf8')); await page.getByRole('button', { name: 'Reopen pinned result', exact: true }).click(); await ready();
  await page.setViewportSize({ width: 375, height: 812 });
  const layout = await page.evaluate(() => {
    const bounds = node => { const { x, y, right, bottom, width } = node.getBoundingClientRect(); return { x, y, right, bottom, width }; };
    return { width: document.documentElement.scrollWidth, bar: bounds(document.querySelector('.chronicle-omnibar')), card: bounds(document.querySelector('.research-workspace')), dock: bounds(document.querySelector('.mechanism-time')) };
  });
  assert.ok(layout.width <= 375 && layout.card.x >= 0 && layout.card.right <= 375 && layout.bar.bottom <= layout.card.y && layout.card.bottom <= layout.dock.y);
  await picture('standalone-375.png');
  await page.keyboard.press('Control+k'); assert.equal(await page.getByRole('searchbox', { name: 'Research query', exact: true }).evaluate(node => node === document.activeElement), true);
  report.checks.push({ name: 'non-map-rendering-and-responsive-layout', status: 'PASS', components: 8, functions: 8, canvasCount: 0, layout });
  assert.deepEqual(report.externalRequests, []); assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.consoleErrors, []);
  report.status = 'PASS';
} catch (error) { report.status = 'FAIL'; report.error = error instanceof Error ? error.message : 'ACCEPTANCE_FAILED'; process.exitCode = 1; }
finally {
  if (context) await context.tracing.stop({ path: join(out, 'trace.zip') }).catch(() => {});
  await browser?.close();
  if (server && server.exitCode === null) { server.kill(); await once(server, 'exit'); }
  await writeFile(join(out, 'acceptance.json'), JSON.stringify({ ...report, finishedAt: new Date().toISOString() }, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, build: report.build?.buildId, checks: report.checks, error: report.error, receipt: join(out, 'acceptance.json') }, null, 2));
}
