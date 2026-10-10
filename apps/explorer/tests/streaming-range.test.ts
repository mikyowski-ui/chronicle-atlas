import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PinnedRangeSource } from '../src/streaming-range.ts';
const digest = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
function fixture(size = 786_449) {
  const data = Uint8Array.from({ length: size }, (_, index) => (index * 43 + 7) % 256), hashes = [];
  for (let start = 0; start < data.length; start += 65_536) hashes.push(digest(data.slice(start, start + 65_536)));
  return { data, archive: { url: `https://fixture.invalid/${digest(data)}.pmtiles`, byte_length: data.length, sha256: digest(data), integrity: { chunk_size: 65_536, sha256: hashes } } };
}
function transport(data: Uint8Array, transform = (response: Response): Response => response): typeof fetch {
  return (async (_url, options) => {
    const [, first, last] = /^bytes=(\d+)-(\d+)$/.exec(new Headers(options?.headers).get('range')!)!;
    const start = Number(first), end = Number(last);
    return transform(new Response(data.slice(start, end + 1), { status: 206, headers: {
      'Content-Range': `bytes ${start}-${end}/${data.length}`, 'Content-Length': String(end - start + 1), ETag: 'pinned-product',
    } }));
  }) as typeof fetch;
}
test('native PMTiles receives exact requested bytes from verified aligned HTTP ranges', async () => {
  const { data, archive } = fixture(), source = new PinnedRangeSource(archive, transport(data));
  assert.deepEqual(new Uint8Array((await source.getBytes(65_500, 100)).data), data.slice(65_500, 65_600));
  assert.equal(source.measurements.requests, 2);
  assert.equal(source.measurements.bytes, 131_072);
  await source.getBytes(65_520, 200);
  assert.equal(source.measurements.requests, 2);
  assert.ok(source.measurements.bytes < archive.byte_length);
});
test('streaming cache is bounded and the final partial chunk preserves exact length', async () => {
  const { data, archive } = fixture(), source = new PinnedRangeSource(archive, transport(data));
  for (let offset = 0; offset < data.length; offset += 65_536) await source.getBytes(offset, 20);
  assert.equal(source.cachedChunks, 8);
  assert.deepEqual(new Uint8Array((await source.getBytes(data.length - 9, 16_384)).data), data.slice(-9));
  source.dispose(); assert.equal(source.cachedChunks, 0);
  await assert.rejects(source.getBytes(0, 10), { name: 'AbortError' });
});
test('streaming rejects whole-archive fallback, incorrect product length, corruption and truncation', async () => {
  const { data, archive } = fixture();
  await assert.rejects(new PinnedRangeSource(archive, (async () => new Response(data)) as typeof fetch).getBytes(0, 10), /HTTP 206/);
  const incorrect = new PinnedRangeSource(archive, transport(data, response => {
    response.headers.set('content-range', 'bytes 0-65535/900000'); return response;
  }));
  await assert.rejects(incorrect.getBytes(0, 10), /Content-Range/);
  const corrupted = data.slice(); corrupted[12] ^= 255;
  await assert.rejects(new PinnedRangeSource(archive, transport(corrupted)).getBytes(0, 10), /SHA-256/);
  const truncated = new PinnedRangeSource(archive, transport(data, response => new Response(data.slice(0, 65_500), { status: 206, headers: response.headers })));
  await assert.rejects(truncated.getBytes(0, 10), /truncated/);
});
test('removing a staged archive aborts in-flight ranges and releases transport listeners', async () => {
  const { archive } = fixture();
  let started!: () => void;
  const starting = new Promise<void>(resolve => { started = resolve; });
  const request = (async (_url, options) => new Promise<Response>((_resolve, reject) => {
    options!.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }); started();
  })) as typeof fetch;
  const source = new PinnedRangeSource(archive, request), pending = source.getBytes(0, 10);
  await starting; source.dispose();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(source.measurements.outstanding, 0); assert.equal(source.measurements.aborted, 1);
});
test('integrity index coverage and range allocation budgets fail closed', async () => {
  const { archive, data } = fixture();
  assert.throws(() => new PinnedRangeSource({ ...archive, integrity: undefined }), /integrity index/);
  assert.throws(() => new PinnedRangeSource({ ...archive, integrity: { chunk_size: 65_536, sha256: [] } }), /integrity index/);
  const source = new PinnedRangeSource(archive, transport(data));
  await assert.rejects(source.getBytes(0, 2_097_153), /budget/);
  await assert.rejects(source.getBytes(-1, 10), /bounds/);
  assert.equal(source.measurements.requests, 0);
});
