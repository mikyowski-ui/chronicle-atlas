// Serve the built fixture locally, without installing development dependencies.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep, extname } from 'node:path';

const root = fileURLToPath(new URL('./dist/', import.meta.url));
const port = Number(process.env.PORT || 4173);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.gz': 'application/gzip', '.json': 'application/json', '.pmtiles': 'application/vnd.pmtiles', '.wasm': 'application/wasm' };
const server = createServer(async (request, response) => {
  try {
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root.endsWith(sep) ? root : root + sep)) { response.writeHead(403); response.end(); return; }
    const bytes = await readFile(file);
    const headers = { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Accept-Ranges': 'bytes' };
    const range = request.headers.range;
    if (range && request.method === 'GET') {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      let start = 0, end = bytes.length - 1;
      if (match && (match[1] || match[2])) {
        start = match[1] ? Number(match[1]) : Math.max(0, bytes.length - Number(match[2]));
        end = match[1] && match[2] ? Math.min(Number(match[2]), bytes.length - 1) : bytes.length - 1;
      }
      if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= bytes.length) {
        response.writeHead(416, { ...headers, 'Content-Range': `bytes */${bytes.length}` }); response.end(); return;
      }
      response.writeHead(206, { ...headers, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${bytes.length}` });
      response.end(bytes.subarray(start, end + 1)); return;
    }
    response.writeHead(200, { ...headers, 'Content-Length': bytes.length });
    response.end(request.method === 'HEAD' ? undefined : bytes);
  } catch {
    response.writeHead(404); response.end('Not found');
  }
});
server.listen(port, '127.0.0.1', () => console.log(`Chronicle Explorer: http://localhost:${server.address().port}/ — press Ctrl+C to stop.`));
