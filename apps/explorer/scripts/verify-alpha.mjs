/** Read-only production artifact and HTTP checks. No browser or GPU pass is inferred. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import os from 'node:os';

const app = fileURLToPath(new URL('..', import.meta.url));
const dist = resolve(app, 'dist');
const args = process.argv.slice(2);
const outputFlag = args.indexOf('--out');
const output = resolve(app, outputFlag < 0 ? 'verification/alpha/artifact-check.json' : args[outputFlag + 1]);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function hashFile(path) { const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest('hex'); }
async function walk(path) { const out = []; for (const row of (await readdir(path, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) { const p = resolve(path,row.name); if (row.isDirectory()) out.push(...await walk(p)); else if (row.isFile()) out.push(p); } return out; }
const descriptorKeys = item => item && typeof item === 'object' && typeof item.url === 'string' && typeof item.sha256 === 'string' && Number.isSafeInteger(item.byte_length);
function assetPath(manifestPath, url) { const path = fileURLToPath(new URL(url, pathToFileURL(manifestPath))); assert.ok(path.startsWith(dist + sep), 'Asset must stay inside production dist'); return path; }
function descriptors(value, out = []) { if (!value || typeof value !== 'object') return out; if (descriptorKeys(value)) out.push(value); for (const child of Object.values(value)) if (child && typeof child === 'object') descriptors(child,out); return out; }
function header(bytes) { assert.equal(bytes.subarray(0,7).toString(),'PMTiles'); assert.equal(bytes[7],3); assert.ok(bytes.length >= 127); const number = offset => { const n = bytes.readBigUInt64LE(offset); assert.ok(n <= BigInt(Number.MAX_SAFE_INTEGER)); return Number(n); }; return { version: bytes[7], addressed_tiles:number(72), tile_entries:number(80), tile_contents:number(88), minzoom:bytes[100], maxzoom:bytes[101], tile_type:bytes[99], archive_bytes:bytes.length }; }
const report = { schema_version:1, kind:'Chronicle VP07 production artifact and HTTP verification', recorded_at:new Date().toISOString(), environment:{ os:os.platform(), release:os.release(), architecture:os.arch(), node:process.version }, status:'RUNNING', scope:'Artifact integrity, identity sidecars, PMTiles header inventory and Node HTTP ranges only. This is not a browser, shader, physical GPU or frame-rate receipt.', production_inventory:[], manifests:[], assets:[], http:[], browser_profiles:{ canvas:'NOT RUN by this script', maplibre_software:'NOT RUN by this script', maplibre_physical_windows:'NOT RUN by this script' } };
let server;
try {
 const files = await walk(dist); let total = 0;
 for (const path of files) { const bytes = (await stat(path)).size; total += bytes; assert.ok(total <= 256 * 1024 * 1024,'Verification input exceeds 256 MiB bounded read budget'); report.production_inventory.push({ path:relative(dist,path).split(sep).join('/'), byte_length:bytes, sha256:await hashFile(path) }); }
 report.production_bytes = total;
 const manifestPaths = [];
 for (const path of files.filter(path => path.includes(sep+'alpha'+sep) && path.endsWith('.json'))) { if ((await stat(path)).size > 1024*1024) continue; let json; try { json = JSON.parse(await readFile(path,'utf8')); } catch { continue; } if (json.schema_version === 2 && Array.isArray(json.epochs) && json.base_geography) manifestPaths.push([path,json]); }
 assert.ok(manifestPaths.length >= 2,'Expected historical and synthetic Alpha manifests');
 const checked = new Map();
 for (const [path,manifest] of manifestPaths) {
  assert.ok(manifest.epochs.length > 0); const epochs = [...manifest.epochs].sort((a,b) => a.t_start-b.t_start);
  epochs.forEach((epoch,i) => { assert.ok(Number.isSafeInteger(epoch.t_start) && Number.isSafeInteger(epoch.t_end) && epoch.t_start < epoch.t_end); if(i) assert.ok(epochs[i-1].t_end <= epoch.t_start,'Epoch windows overlap'); });
  report.manifests.push({ path:relative(dist,path), edition:manifest.edition, kind:manifest.fixture_kind, epochs:epochs.length, first_day:epochs[0].t_start, last_exclusive_day:epochs.at(-1).t_end });
  for (const descriptor of descriptors(manifest)) {
   const target = assetPath(path,descriptor.url); const cacheKey = target+'|'+descriptor.sha256; if(checked.has(cacheKey)) continue;
   const bytes = await readFile(target); assert.equal(bytes.length,descriptor.byte_length,relative(dist,target)+' byte length'); assert.equal(sha(bytes),descriptor.sha256,relative(dist,target)+' SHA-256');
   const row = {path:relative(dist,target),byte_length:bytes.length,sha256:descriptor.sha256,integrity:'PASS'};
   if(descriptor.integrity) { const {chunk_size,sha256:hashes} = descriptor.integrity; assert.ok(Number.isSafeInteger(chunk_size) && chunk_size>0); assert.equal(hashes.length,Math.ceil(bytes.length/chunk_size)); hashes.forEach((value,index) => assert.equal(sha(bytes.subarray(index*chunk_size,Math.min((index+1)*chunk_size,bytes.length))),value,'Chunk '+index+' hash')); row.chunk_hashes_verified=hashes.length; }
   if(target.endsWith('.pmtiles')) { assert.ok(descriptor.integrity,'Every streamed archive must declare chunk integrity'); row.pmtiles=header(bytes); assert.equal(row.pmtiles.tile_type,1); assert.equal(row.pmtiles.minzoom,descriptor.minzoom); assert.equal(row.pmtiles.maxzoom,descriptor.maxzoom); assert.ok(row.pmtiles.addressed_tiles>1,'Alpha requires multi-tile archives'); assert.ok(row.pmtiles.maxzoom>row.pmtiles.minzoom,'Alpha requires multi-zoom archives'); }
   if(epochs.some(epoch => assetPath(path,epoch.metadata.url) === target)) { const metadata=JSON.parse(bytes); assert.ok(Array.isArray(metadata.parts),'Canonical parts are required'); const renderIds=metadata.parts.map(part=>part.properties.render_id); assert.equal(new Set(renderIds).size,renderIds.length,'Duplicate canonical render IDs'); metadata.parts.forEach(part=>{ assert.ok(part.properties.entity_id && part.properties.territory_state_id); assert.ok(part.areaKm2>=0 && Number.isFinite(part.areaKm2)); assert.match(part.geometry_hash,/^[a-f0-9]{64}$/); }); row.canonical_parts=renderIds.length; }
   checked.set(cacheKey,row); report.assets.push(row);
  }
 }
 if (!args.includes('--no-http')) {
  server = spawn(process.execPath,['serve.mjs'],{cwd:app,env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});
  let startup = ''; let errors = ''; server.stderr.on('data',chunk=>{errors+=chunk;});
  const base = await new Promise((resolveBase,reject) => { const timer=setTimeout(()=>reject(new Error('Server startup timed out: '+errors)),5000); server.stdout.on('data',chunk=>{startup+=chunk; const match=/localhost:(\d+)/.exec(startup); if(match){clearTimeout(timer); resolveBase('http://127.0.0.1:'+match[1]+'/');}}); server.on('error',error=>{clearTimeout(timer);reject(error);}); });
  const index = await fetch(base); assert.equal(index.status,200); const html=await index.text(); assert.ok(!html.includes('/src/main.ts'),'Must inspect built production HTML');
  report.http.push({path:'/',status:200,production_html:true});
  for(const asset of report.assets.filter(asset=>asset.pmtiles)) {
   const url = new URL(asset.path.replaceAll(sep,'/'),base); const response=await fetch(url,{headers:{Range:'bytes=0-126'}}); assert.equal(response.status,206); assert.equal(response.headers.get('content-range'),`bytes 0-126/${asset.byte_length}`); const bytes=Buffer.from(await response.arrayBuffer()); assert.equal(bytes.length,127); assert.equal(bytes.subarray(0,7).toString(),'PMTiles');
   const head=await fetch(url,{method:'HEAD'}); assert.equal(head.status,200); assert.equal(Number(head.headers.get('content-length')),asset.byte_length); assert.equal((await head.arrayBuffer()).byteLength,0);
   const invalid=await fetch(url,{headers:{Range:`bytes=${asset.byte_length}-`}}); assert.equal(invalid.status,416);
   report.http.push({path:asset.path,header_range_status:206,header_bytes:127,head_status:200,invalid_range_status:416});
  }
 }
 report.status='PASS';
} catch(error) { report.status='FAIL'; report.error=String(error.stack || error); process.exitCode=1; }
finally { if(server && server.exitCode === null && server.signalCode === null){const exited=once(server,'exit');server.kill();await exited.catch(()=>{});} report.finished_at=new Date().toISOString(); await mkdir(dirname(output),{recursive:true}); await writeFile(output,JSON.stringify(report,null,2)+'\n'); console.log(JSON.stringify({status:report.status,manifests:report.manifests.length,assets:report.assets.length,production_bytes:report.production_bytes,receipt:output,error:report.error},null,2)); }
