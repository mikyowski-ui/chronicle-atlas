/** Run: node --import tsx scripts/measure-warm-cache.mjs. No browser/GPU is inferred. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { Protocol } from 'pmtiles';
import { WarmArchiveCache, WARM_ARCHIVE_BUDGET } from '../src/warm-archive-cache.ts';

const app = fileURLToPath(new URL('..', import.meta.url));
const output = new URL('../verification/motion/warm-cache.json', import.meta.url);
const receipt = {
  schema_version: 1,
  kind: 'Chronicle VP08 bounded warm archive transport measurement',
  recorded_at: new Date().toISOString(),
  environment: { os: os.platform(), release: os.release(), architecture: os.arch(), node: process.version },
  profile: 'Local Node HTTP 206 transport with native PMTiles 4.5.0; decoded MVT delivery only',
  status: 'RUNNING',
  browser: 'NOT RUN by this script', hardware: 'NOT RUN by this script',
  budget: WARM_ARCHIVE_BUDGET,
  cache_scope: 'Verified compressed chunks plus native bounded header/directory cache. Timings exclude MapLibre rendering, shader work and browser layout.',
  prefetch_alignment: 'A 16 KiB requested header fetches one verified integrity chunk: 16 KiB for these fixtures; up to 64 KiB for products with a 64 KiB integrity index.',
  tiles: [[5, 16, 12], [5, 17, 12], [7, 67, 50]],
  stages: [], ranges: [],
};
let server, cache;
const compact = diagnostics => ({
  requests: diagnostics.requests, transferred_bytes: diagnostics.bytes,
  compressed_cache_bytes: diagnostics.cachedBytes, compressed_cache_chunks: diagnostics.cachedChunks,
  idle_archives: diagnostics.idleArchives, active_archives: diagnostics.activeArchives,
  cache_hits: diagnostics.cacheHits, cache_misses: diagnostics.cacheMisses,
  archive_evictions: diagnostics.archiveEvictions, chunk_evictions: diagnostics.chunkEvictions,
  outstanding_ranges: diagnostics.outstanding, peak_outstanding_ranges: diagnostics.peakOutstanding,
});
try {
  server = spawn(process.execPath, ['serve.mjs'], { cwd: app, env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let startup = '', errors = '';
  server.stderr.on('data', chunk => { errors += chunk; });
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server startup timed out: ' + errors)), 5000);
    server.stdout.on('data', chunk => {
      startup += chunk; const match = /localhost:(\d+)/.exec(startup);
      if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}/`); }
    });
    server.on('error', error => { clearTimeout(timer); reject(error); });
  });
  const manifest = JSON.parse(await readFile(new URL('../dist/alpha/fixture-manifest.json', import.meta.url), 'utf8'));
  const manifestURL = new URL('alpha/fixture-manifest.json', base);
  const streams = manifest.epochs.map(epoch => ({ ...epoch.stream, url: new URL(epoch.stream.url, manifestURL).href }));
  const protocol = new Protocol();
  const fetcher = async (url, options) => {
    const started = performance.now(), response = await fetch(url, options);
    receipt.ranges.push({
      archive: new URL(String(url)).pathname.split('/').at(-1),
      range: new Headers(options?.headers).get('range'), status: response.status,
      content_range: response.headers.get('content-range'), declared_bytes: Number(response.headers.get('content-length')),
      response_headers_ms: Number((performance.now() - started).toFixed(3)),
    });
    return response;
  };
  cache = new WarmArchiveCache(protocol, fetcher);
  receipt.edition = manifest.edition;
  receipt.archives = streams.map(stream => ({ url: new URL(stream.url).pathname, sha256: stream.sha256, byte_length: stream.byte_length }));
  let active = null;
  async function present(index, label) {
    const before = cache.getDiagnostics(), started = performance.now(), stream = streams[index];
    if (active) cache.release(active, manifest.edition);
    const handle = cache.retain(stream, manifest.edition);
    active = stream;
    await handle.pmtiles.getHeader();
    let decoded = 0;
    for (const [z, x, y] of receipt.tiles) {
      const tile = await handle.pmtiles.getZxy(z, x, y);
      assert.ok(tile?.data.byteLength, `${label} tile ${z}/${x}/${y} must exist`);
      decoded += tile.data.byteLength;
    }
    const after = cache.getDiagnostics();
    const row = {
      label, epoch: manifest.epochs[index].epoch_id,
      tile_delivery_ms: Number((performance.now() - started).toFixed(3)),
      new_requests: after.requests - before.requests, new_transferred_bytes: after.bytes - before.bytes,
      decoded_mvt_bytes: decoded, ...compact(after),
    };
    receipt.stages.push(row);
    assert.ok(after.cachedBytes <= WARM_ARCHIVE_BUDGET.compressedBytes);
    assert.ok(after.idleArchives <= WARM_ARCHIVE_BUDGET.idleArchives);
    return row;
  }
  await present(0, 'cold_A');
  await present(1, 'cold_B');
  const reverse = await present(0, 'warm_reverse_A');
  assert.equal(reverse.new_requests, 0); assert.equal(reverse.new_transferred_bytes, 0);
  for (let index = 0; index < 20; index++) {
    const row = await present(index % 2 ? 0 : 1, `reversal_${index + 1}`);
    assert.equal(row.new_requests, 0); assert.equal(row.new_transferred_bytes, 0);
  }
  cache.release(active, manifest.edition); active = null;
  receipt.final = cache.getDiagnostics();
  receipt.maxima = {
    compressed_cache_bytes: Math.max(...receipt.stages.map(row => row.compressed_cache_bytes)),
    idle_archives: Math.max(...receipt.stages.map(row => row.idle_archives)),
    active_archives: Math.max(...receipt.stages.map(row => row.active_archives)),
    warm_reversal_delivery_ms: Math.max(...receipt.stages.slice(2).map(row => row.tile_delivery_ms)),
  };
  receipt.status = 'PASS';
} catch (error) {
  receipt.status = 'FAIL'; receipt.error = String(error.stack || error); process.exitCode = 1;
} finally {
  cache?.dispose();
  if (server && server.exitCode === null && server.signalCode === null) { const exited = once(server, 'exit'); server.kill(); await exited.catch(() => undefined); }
  receipt.finished_at = new Date().toISOString();
  await mkdir(new URL('.', output), { recursive: true });
  await writeFile(output, JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify({ status: receipt.status, receipt: fileURLToPath(output), maxima: receipt.maxima, error: receipt.error }, null, 2));
}
