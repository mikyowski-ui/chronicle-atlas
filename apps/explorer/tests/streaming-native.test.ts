import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { PMTiles, Protocol, SharedPromiseCache } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import { PinnedRangeSource } from '../src/streaming-range.ts';

/** Actual HTTP range transport and the pinned native protocol; this is not a GPU test. */
test('two compiled epochs stream through native PMTiles protocol with stable identity across adjacent spatial tiles', async () => {
  const manifestFile = new URL('../public/alpha/fixture-manifest.json', import.meta.url);
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  const assets = new Map<string, Buffer>();
  for (const epoch of manifest.epochs) assets.set('/' + epoch.stream.url.slice(2), await readFile(new URL(epoch.stream.url, manifestFile)));
  const requests: string[] = [];
  const server = createServer((request, response) => {
    const data = assets.get(request.url!);
    const match = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range ?? '');
    if (!data || !match) { response.writeHead(400).end(); return; }
    const start = Number(match[1]), end = Number(match[2]);
    requests.push(request.headers.range!);
    response.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${data.length}`, 'Content-Length': end - start + 1 });
    response.end(data.subarray(start, end + 1));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  try {
    for (const epoch of manifest.epochs) {
      const url = new URL(epoch.stream.url, `http://127.0.0.1:${port}/manifest.json`).href;
      const source = new PinnedRangeSource({ ...epoch.stream, url });
      const protocol = new Protocol();
      protocol.add(new PMTiles(source, new SharedPromiseCache(16)));
      const response = await protocol.tilev4({ url: `pmtiles://${url}`, type: 'json' }, new AbortController());
      const tileJson = response.data as { minzoom: number; maxzoom: number; tiles: string[] };
      assert.equal(tileJson.minzoom, 0); assert.equal(tileJson.maxzoom, 7);
      assert.ok(source.measurements.bytes < source.archive.byte_length, 'Header hydration must not download the complete epoch.');
      const decoded = [];
      for (const [z, x, y] of [[5, 16, 12], [5, 17, 12], [7, 67, 50]]) {
        const tile = await protocol.tilev4({ url: `pmtiles://${url}/${z}/${x}/${y}`, type: 'arrayBuffer' }, new AbortController());
        const layer = new VectorTile(new Pbf(tile.data as Uint8Array)).layers.territories;
        assert.ok(layer?.length);
        const parts = Array.from({ length: layer.length }, (_, index) => layer.feature(index).properties);
        for (const part of parts) {
          assert.equal(typeof part.render_id, 'string'); assert.equal(typeof part.entity_id, 'string');
          assert.equal(part.t_start, epoch.t_start); assert.equal(part.t_end, epoch.t_end);
        }
        decoded.push(parts);
      }
      const samePart = decoded[0].find(part => part.entity_id === 'synthetic:cedar')!;
      assert.ok(decoded[1].some(part => part.render_id === samePart.render_id), 'A tile-clipped polygon preserves one canonical render ID.');
      assert.ok(decoded[1].some(part => part.entity_id === 'synthetic:cedar' && part.render_id !== samePart.render_id), 'Disconnected entity parts remain separately addressable.');
      assert.ok(source.cachedChunks <= 8);
      source.dispose();
    }
    assert.ok(new Set(requests).size > 1, 'Spatial delivery accesses more than one byte range.');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
