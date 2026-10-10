import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { Protocol } from 'pmtiles';
import { WarmArchiveCache, WARM_ARCHIVE_BUDGET } from '../src/warm-archive-cache.ts';
import { PinnedRangeSource } from '../src/streaming-range.ts';

const digest = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
function fixture(identity: number, length = 786_449) {
  const data = Uint8Array.from({ length }, (_, index) => (index * 43 + identity) % 256);
  const hashes = [];
  for (let index = 0; index < length; index += 65_536) hashes.push(digest(data.subarray(index, index + 65_536)));
  return { data, archive: { url: `https://fixture.invalid/${identity}.pmtiles`, sha256: digest(data), byte_length: length, integrity: { chunk_size: 65_536, sha256: hashes } } };
}
function transport(fixtures: ReturnType<typeof fixture>[]): typeof fetch {
  return (async (url, options) => {
    const data = fixtures.find(item => item.archive.url === String(url))!.data;
    const [, first, last] = /^bytes=(\d+)-(\d+)$/.exec(new Headers(options?.headers).get('range')!)!;
    return new Response(data.subarray(Number(first), Number(last) + 1), { status: 206, headers: {
      'Content-Range': `bytes ${first}-${last}/${data.length}`, 'Content-Length': String(Number(last) - Number(first) + 1),
    } });
  }) as typeof fetch;
}

test('real HTTP cold epoch → next epoch → warm reverse retains PMTiles directories and verified bytes', async () => {
  const manifestFile = new URL('../public/alpha/fixture-manifest.json', import.meta.url);
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  const assets = new Map<string, Buffer>();
  for (const epoch of manifest.epochs) assets.set('/' + epoch.stream.url.slice(2), await readFile(new URL(epoch.stream.url, manifestFile)));
  const ranges: string[] = [];
  const server = createServer((request, response) => {
    const bytes = assets.get(request.url!), match = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range ?? '');
    if (!bytes || !match) { response.writeHead(400).end(); return; }
    const start = Number(match[1]), end = Number(match[2]);
    ranges.push(`${request.url}:${request.headers.range}`);
    response.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${bytes.length}`, 'Content-Length': end - start + 1 });
    response.end(bytes.subarray(start, end + 1));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port, protocol = new Protocol(), cache = new WarmArchiveCache(protocol);
  const streams = manifest.epochs.map((epoch: { stream: object & { url: string } }) => ({ ...epoch.stream, url: new URL(epoch.stream.url, `http://127.0.0.1:${port}/manifest.json`).href }));
  try {
    const first = cache.retain(streams[0], manifest.edition);
    await protocol.tilev4({ url: `pmtiles://${streams[0].url}`, type: 'json' }, new AbortController());
    await protocol.tilev4({ url: `pmtiles://${streams[0].url}/5/16/12`, type: 'arrayBuffer' }, new AbortController());
    const cold = cache.getDiagnostics();
    cache.release(streams[0], manifest.edition);
    const second = cache.retain(streams[1], manifest.edition);
    await second.pmtiles.getHeader();
    cache.release(streams[1], manifest.edition);
    const requestsBeforeReverse = ranges.length, bytesBeforeReverse = cache.getDiagnostics().bytes;
    const reversed = cache.retain(streams[0], manifest.edition);
    assert.equal(reversed.pmtiles, first.pmtiles, 'The existing bounded PMTiles directory cache survives GPU retirement.');
    assert.equal(reversed.source, first.source);
    await protocol.tilev4({ url: `pmtiles://${streams[0].url}`, type: 'json' }, new AbortController());
    await protocol.tilev4({ url: `pmtiles://${streams[0].url}/5/16/12`, type: 'arrayBuffer' }, new AbortController());
    assert.equal(ranges.length, requestsBeforeReverse);
    assert.equal(cache.getDiagnostics().bytes, bytesBeforeReverse);
    assert.ok(cache.getDiagnostics().cacheHits > cold.cacheHits);
    assert.ok(cold.bytes > 0 && cold.bytes < streams[0].byte_length);
    assert.equal(cache.getDiagnostics().warmRetains, 1);
    cache.release(streams[0], manifest.edition);
  } finally {
    cache.dispose(); server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('aggregate compressed bytes obey 1 MiB even for referenced sources and idle handles evict at four', async () => {
  const fixtures = [1, 2, 3, 4, 5, 6].map(identity => fixture(identity)), protocol = new Protocol(), cache = new WarmArchiveCache(protocol, transport(fixtures));
  for (const item of fixtures.slice(0, 3)) {
    const { source } = cache.retain(item.archive, 'recorded-v1');
    for (let index = 0; index < 8; index++) await source.getBytes(index * 65_536, 10);
    assert.ok(cache.getDiagnostics().cachedBytes <= WARM_ARCHIVE_BUDGET.compressedBytes);
  }
  assert.equal(cache.getDiagnostics().cachedBytes, 1_048_576);
  assert.equal(cache.getDiagnostics().chunkEvictions, 8);
  for (const item of fixtures.slice(0, 3)) cache.release(item.archive, 'recorded-v1');
  for (const item of fixtures.slice(3)) { cache.retain(item.archive, 'recorded-v1'); cache.release(item.archive, 'recorded-v1'); }
  assert.equal(cache.getDiagnostics().idleArchives, 4);
  assert.equal(cache.getDiagnostics().archiveEvictions, 2);
  assert.equal(protocol.tiles.has(fixtures[0].archive.url), false);
  assert.equal(protocol.tiles.size, 4);
  cache.dispose(); assert.equal(protocol.tiles.size, 0); assert.equal(cache.getDiagnostics().cachedBytes, 0);
});

test('a failed native header request is retryable after warm release and reacquisition', async () => {
  const manifestFile = new URL('../public/alpha/fixture-manifest.json', import.meta.url);
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8')), stream = manifest.epochs[0].stream;
  const item = { archive: { ...stream, url: 'https://fixture.invalid/retry.pmtiles' }, data: new Uint8Array(await readFile(new URL(stream.url, manifestFile))) };
  let calls = 0;
  const reply = transport([item]);
  const fetcher = (async (url, options) => ++calls === 1 ? new Response('transient', { status: 503 }) : reply(url, options)) as typeof fetch;
  const cache = new WarmArchiveCache(new Protocol(), fetcher);
  const original = cache.retain(item.archive, manifest.edition);
  await assert.rejects(original.pmtiles.getHeader(), /HTTP206|HTTP 206/);
  cache.release(item.archive, manifest.edition);
  const retry = cache.retain(item.archive, manifest.edition);
  assert.equal(retry.pmtiles, original.pmtiles);
  assert.equal((await retry.pmtiles.getHeader()).specVersion, 3);
  assert.equal(calls, 2);
  cache.dispose();
});

test('same URL cannot reuse bytes or directory promises across changed pinned editions', async () => {
  const item = fixture(7), cache = new WarmArchiveCache(new Protocol(), transport([item]));
  const first = cache.retain(item.archive, 'edition-one');
  await first.source.getBytes(0, 10);
  assert.throws(() => cache.retain({ ...item.archive, sha256: '0'.repeat(64) }, 'edition-one'), /conflicting pinned editions/);
  assert.throws(() => cache.retain(item.archive, 'edition-two'), /conflicting pinned editions/);
  cache.release(item.archive, 'edition-one');
  const second = cache.retain(item.archive, 'edition-two');
  assert.notEqual(second.source, first.source);
  assert.notEqual(second.pmtiles, first.pmtiles);
  assert.equal(second.source.cachedBytes, 0);
  await second.source.getBytes(0, 10);
  assert.equal(cache.getDiagnostics().requests, 2);
  cache.dispose();
});

test('shared chunk delivery deduplicates reads and isolates a cancelled seeker', async () => {
  const item = fixture(8), reply = transport([item]);
  let resume!: () => void, aborted = false;
  const gate = new Promise<void>(resolve => { resume = resolve; });
  const request = (async (url, options) => {
    options?.signal?.addEventListener('abort', () => { aborted = true; });
    await gate; return reply(url, options);
  }) as typeof fetch;
  const source = new PinnedRangeSource(item.archive, request), cancelled = new AbortController();
  const previous = source.getBytes(0, 10, cancelled.signal), latest = source.getBytes(5, 20);
  cancelled.abort();
  await assert.rejects(previous, { name: 'AbortError' });
  assert.equal(aborted, false);
  resume();
  assert.deepEqual(new Uint8Array((await latest).data), item.data.slice(5, 25));
  assert.equal(source.measurements.requests, 1);
  assert.equal(source.measurements.sharedReads, 1);
  assert.equal(source.cachedChunks, 1);
  source.dispose();
});

test('cancelled prefetch cannot poison a shared live range and only adjacent headers are warmed', async () => {
  const fixtures = [fixture(10), fixture(11), fixture(12)], reply = transport(fixtures);
  let resume!: () => void;
  const gate = new Promise<void>(resolve => { resume = resolve; });
  const request = (async (url, options) => { await gate; return reply(url, options); }) as typeof fetch;
  const cache = new WarmArchiveCache(new Protocol(), request);
  const warming = cache.prefetchNeighbors(fixtures.slice(0, 2).map(item => ({ archive: item.archive, edition: 'edition-one' })));
  await Promise.resolve();
  const { source } = cache.retain(fixtures[0].archive, 'edition-one');
  const visible = source.getBytes(5, 20);
  cache.cancelPrefetch(); resume();
  await warming;
  assert.deepEqual(new Uint8Array((await visible).data), fixtures[0].data.slice(5, 25));
  const receipt = cache.getDiagnostics();
  assert.equal(receipt.peakPrefetch, 2);
  assert.equal(receipt.requests, 2);
  assert.ok(receipt.bytes <= 2 * 65_536, 'Header verification downloads no more than one indexed chunk per neighbor.');
  assert.equal(receipt.prefetchAborted, 2);
  assert.equal(receipt.activePrefetch, 0);
  assert.throws(() => cache.prefetchNeighbors(fixtures.map(item => ({ archive: item.archive, edition: 'edition-one' }))), /previous and next/);
  cache.dispose();
});

test('reversing prefetch waits for aborted transport settlement before using either budget slot', async () => {
  const fixtures = [fixture(20), fixture(21), fixture(22), fixture(23)], reply = transport(fixtures);
  const resolvers: (() => void)[] = [];
  const request = (async (url, options) => {
    await new Promise<void>(resolve => { resolvers.push(resolve); });
    return reply(url, options);
  }) as typeof fetch;
  const cache = new WarmArchiveCache(new Protocol(), request);
  const forward = cache.prefetchNeighbors(fixtures.slice(0, 2).map(item => ({ archive: item.archive, edition: 'v1' })));
  await Promise.resolve();
  const reverse = cache.prefetchNeighbors(fixtures.slice(2).map(item => ({ archive: item.archive, edition: 'v1' })));
  await Promise.resolve(); await Promise.resolve();
  assert.equal(cache.getDiagnostics().requests, 2, 'The new batch cannot outrun unresolved old ranges.');
  resolvers[0](); resolvers[1](); await forward;
  await Promise.resolve();
  assert.equal(cache.getDiagnostics().requests, 4);
  resolvers[2](); resolvers[3](); await reverse;
  assert.equal(cache.getDiagnostics().peakPrefetch, 2);
  assert.equal(cache.getDiagnostics().peakOutstanding, 2);
  cache.dispose();
});

test('one adjacent-header batch preserves both neighbors across different recorded editions', async () => {
  const fixtures = [fixture(31), fixture(32)], cache = new WarmArchiveCache(new Protocol(), transport(fixtures));
  await cache.prefetchNeighbors(fixtures.map((item, index) => ({ archive: item.archive, edition: `observation-${index}` })));
  const receipt = cache.getDiagnostics();
  assert.equal(receipt.prefetchCompleted, 2);
  assert.equal(receipt.prefetchAborted, 0);
  assert.equal(receipt.peakPrefetch, 2);
  assert.deepEqual(receipt.entries.map(entry => entry.edition).sort(), ['observation-0', 'observation-1']);
  for (const [index, item] of fixtures.entries()) {
    const warm = cache.retain(item.archive, `observation-${index}`);
    await warm.source.getBytes(0, 10);
    cache.release(item.archive, `observation-${index}`);
  }
  assert.equal(cache.getDiagnostics().requests, 2, 'Both neighbors reuse verified header bytes without another request.');
  cache.dispose();
});
