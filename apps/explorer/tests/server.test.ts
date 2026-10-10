import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('built fixture server supports complete PMTiles bytes, ranges, suffixes, HEAD and invalid ranges', async () => {
  const process = spawn(globalThis.process.execPath, ['serve.mjs'], { cwd: new URL('..', import.meta.url), env: { ...globalThis.process.env, PORT:'0' }, stdio:['ignore','pipe','pipe'] });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const output = await Promise.race([once(process.stdout, 'data'), new Promise<never>((_,reject) => { timer = setTimeout(() => reject(new Error('Server startup timed out')), 5000); })]);
    clearTimeout(timer);
    const port = /localhost:(\d+)/.exec(String(output[0]))![1];
    const base = `http://127.0.0.1:${port}/`;
    const index = await fetch(base); assert.equal(index.status, 200);
    const manifest = await (await fetch(base + 'fixtures/manifest.json')).json();
    for (const epoch of manifest.epochs) {
      const url = new URL(epoch.url, base+'fixtures/manifest.json');
      const whole = await fetch(url); assert.equal(whole.status, 200);
      const bytes = new Uint8Array(await whole.arrayBuffer()); assert.equal(bytes.length, epoch.byte_length);
      const range = await fetch(url, { headers: { Range:'bytes=0-126' } });
      assert.equal(range.status,206); assert.equal(range.headers.get('content-range'), `bytes 0-126/${bytes.length}`);
      assert.deepEqual(new Uint8Array(await range.arrayBuffer()), bytes.slice(0,127));
      const suffix = await fetch(url, { headers: { Range:'bytes=-8' } });
      assert.equal(suffix.status,206); assert.deepEqual(new Uint8Array(await suffix.arrayBuffer()), bytes.slice(-8));
      const invalid = await fetch(url, { headers: { Range:'bytes=999999-' } }); assert.equal(invalid.status,416);
      const head = await fetch(url, { method:'HEAD' }); assert.equal(head.status,200); assert.equal(head.headers.get('content-length'),String(bytes.length)); assert.equal((await head.arrayBuffer()).byteLength,0);
    }
  } finally { clearTimeout(timer); process.kill(); }
});
