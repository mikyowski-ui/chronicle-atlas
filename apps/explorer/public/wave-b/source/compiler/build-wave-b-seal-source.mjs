// Retain editable corresponding source for the delivered PMTiles, including the
// normalized input and compiler, without changing any rendered candidate bytes.
import { readFile,writeFile,mkdir,copyFile,readdir,stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve,join } from 'node:path';
import { createHash } from 'node:crypto';
import { PMTiles } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
const app=fileURLToPath(new URL('../',import.meta.url)),root=resolve(app,'../..'),out=join(app,'public/wave-b'),source=join(out,'source');
const read=async path=>JSON.parse(await readFile(path,'utf8')),save=async(path,value)=>writeFile(path,JSON.stringify(value,null,2)+'\n');
const manifest=await read(join(out,'manifest.json')),record=await read(join(out,'build-record.json')),budget=await read(join(out,'resource-budget.json'));
await mkdir(join(source,'compiler'),{recursive:true});await mkdir(join(source,'cells'),{recursive:true});
for(const [from,to] of [['scripts/history/rasterize.ts','rasterize.ts'],['scripts/readiness/coverage.ts','coverage.ts'],['scripts/history/canonical.ts','canonical.ts'],['lib/readiness/chronology.ts','chronology.ts']])await copyFile(join(root,from),join(source,'compiler',to));
for(const name of ['build-wave-b.mjs','build-wave-b-worker.mjs','build-wave-b-pmtiles.py','build-wave-b-label-fix.mjs','build-wave-b-seal-source.mjs'])await copyFile(join(app,'scripts',name),join(source,'compiler',name));
await copyFile(join(app,'package.json'),join(source,'compiler','package-pins.json'));
await copyFile(join(app,'fixtures/WAVE-B.md'),join(source,'WAVE-B.md'));
for(const epoch of manifest.epochs){
 const bytes=await readFile(join(out,epoch.url));
 if(createHash('sha256').update(bytes).digest('hex')!==epoch.sha256)throw Error('Archive changed before source retention');
 const archive=new PMTiles({getKey:()=>epoch.epoch_id,getBytes:async(o,l)=>({data:Uint8Array.from(bytes.subarray(o,o+l)).buffer})});
 const metadata=await archive.getMetadata(),encoded=await archive.getZxy(0,0,0),tile=new VectorTile(new Pbf(new Uint8Array(encoded.data))).layers.territories,features=[];
 for(let i=0;i<tile.length;i++){const properties=tile.feature(i).properties,cell=properties.cell_id,w=((cell-1)%720)*.5-180,s=Math.floor((cell-1)/720)*.5-90;features.push({type:'Feature',properties,geometry:{type:'Polygon',coordinates:[[[w,s],[w+.5,s],[w+.5,s+.5],[w,s+.5],[w,s]]]}});}
 await save(join(source,'cells',epoch.epoch_id+'.geojson'),{type:'FeatureCollection',features});
 await save(join(source,'cells',epoch.epoch_id+'.metadata.json'),metadata);
}
const sourceTreeBytes=async dir=>(await Promise.all((await readdir(dir,{withFileTypes:true})).map(async e=>e.isDirectory()?sourceTreeBytes(join(dir,e.name)):(await stat(join(dir,e.name))).size))).reduce((a,b)=>a+b,0);
const bytes=await sourceTreeBytes(source);if(bytes>budget.caps.retainedDerivativeSourceBytes)throw Error('Corresponding-source byte cap exceeded');
const usage=record.cumulative_resources.normalizedInputBytes;usage.added=bytes;usage.used=usage.prior+bytes;if(usage.used>usage.limit)throw Error('Aggregate source cap exceeded');
record.retained_derivative_source_bytes=bytes;await save(join(out,'build-record.json'),record);
console.log(JSON.stringify({sourceBytes:bytes,aggregateUsed:usage.used,aggregateLimit:usage.limit}));
