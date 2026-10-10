// Metadata-only correction for the first local compilation. It does not reraster
// or alter a cell, assertion, MVT byte, valid interval, or source membership.
import { readFile,writeFile,readdir,stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { PMTiles } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
const app=fileURLToPath(new URL('../',import.meta.url)),out=join(app,'public/wave-b'),build=join(app,'.sites-runtime/wave-b-build');
const read=async path=>JSON.parse(await readFile(path,'utf8'));
const save=async(path,data)=>writeFile(path,JSON.stringify(data,null,2)+'\n');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const manifest=await read(join(out,'manifest.json')),record=await read(join(out,'build-record.json')),budget=await read(join(out,'resource-budget.json'));
const corrections=[];
for (const epoch of manifest.epochs) {
 const path=join(out,epoch.url),bytes=await readFile(path);
 if(hash(bytes)!==epoch.sha256)throw Error('Original archive changed');
 const archive=new PMTiles({getKey:()=>path,getBytes:async(o,l)=>({data:Uint8Array.from(bytes.subarray(o,o+l)).buffer})});
 const metadata=await archive.getMetadata(),tile=await archive.getZxy(0,0,0),decoded=new VectorTile(new Pbf(new Uint8Array(tile.data))).layers.territories,ids=new Set();
 for(let i=0;i<decoded.length;i++)ids.add(decoded.feature(i).properties.entity_id);
 const inactive=metadata.scene_metadata.labels.filter(l=>!ids.has(l.entity_id));
 if(!inactive.length)continue;
 metadata.scene_metadata.labels=metadata.scene_metadata.labels.filter(l=>ids.has(l.entity_id));
 metadata.scene_metadata.entities=Object.fromEntries(Object.entries(metadata.scene_metadata.entities).filter(([id])=>ids.has(id)));
 const mp=join(build,epoch.epoch_id+'.metadata-corrected.json'),tp=join(build,epoch.epoch_id+'.unchanged.mvt');
 await save(mp,metadata); await writeFile(tp,new Uint8Array(tile.data));
 const result=spawnSync(process.env.FIXTURE_PYTHON||join(app,'.sites-runtime/fixture-build/venv/bin/python'),[join(app,'scripts/build-wave-b-pmtiles.py'),tp,mp,path],{encoding:'utf8',timeout:budget.worker.deadlineMs,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
 if(result.error||result.status!==0)throw Error(result.error?.message||result.stderr);
 const replacement=await readFile(path);
 if(replacement.length>budget.caps.archiveBytes)throw Error('Byte cap exceeded');
 const rewritten=new PMTiles({getKey:()=>path+'new',getBytes:async(o,l)=>({data:Uint8Array.from(replacement.subarray(o,o+l)).buffer})});
 const check=await rewritten.getZxy(0,0,0);
 if(hash(new Uint8Array(check.data))!==hash(new Uint8Array(tile.data)))throw Error('Tile changed during metadata-only correction');
 corrections.push({epoch_id:epoch.epoch_id,reason:'Omit independent labels for assertions with no eligible grid cell; retain complete source evidence.',inactive_entities:inactive.map(l=>l.entity_id),previous_bytes:bytes.length,previous_sha256:epoch.sha256,new_bytes:replacement.length,new_sha256:hash(replacement),mvt_unchanged:true});
 epoch.byte_length=replacement.length;epoch.sha256=hash(replacement);
 const item=record.archives.find(r=>r.epoch_id===epoch.epoch_id);item.bytes=replacement.length;item.sha256=epoch.sha256;
}
record.total_archive_bytes=record.archives.reduce((n,r)=>n+r.bytes,0);
const metadataBytes=corrections.reduce((n,c)=>n+c.new_bytes,0);
const resource=record.cumulative_resources.newCompressedArtifactBytes;
resource.added+=metadataBytes;resource.used=resource.prior+resource.added;
const sourceTreeBytes=async dir=>(await Promise.all((await readdir(dir,{withFileTypes:true})).map(async e=>e.isDirectory()?sourceTreeBytes(join(dir,e.name)):(await stat(join(dir,e.name))).size))).reduce((a,b)=>a+b,0);
const sourceBytes=await sourceTreeBytes(join(out,'source'));const normalized=record.cumulative_resources.normalizedInputBytes;normalized.added=sourceBytes;normalized.used=normalized.prior+normalized.added;
if(Object.values(record.cumulative_resources).some(v=>v.used>v.limit)||sourceBytes>budget.caps.retainedDerivativeSourceBytes)throw Error('Aggregate cap exceeded');
record.metadata_corrections=corrections;record.metadata_correction_archive_bytes=metadataBytes;record.retained_derivative_source_bytes=sourceBytes;
await save(join(out,'manifest.json'),manifest);await save(join(out,'build-record.json'),record);
console.log(JSON.stringify({corrected:corrections.length,metadataBytes,totalArchiveBytes:record.total_archive_bytes,sourceBytes}));
