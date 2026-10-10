// Run from apps/explorer with its pinned dependencies and pmtiles Python 3.8.1:
// FIXTURE_PYTHON=path/to/python node public/wave-b/source/rebuild-pmtiles.mjs
// Output goes to the ignored app cache; existing delivery is never overwritten.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join,resolve} from 'node:path';
import geojsonvt from 'geojson-vt';
import {fromGeojsonVt} from '@maplibre/vt-pbf';
const here=fileURLToPath(new URL('./',import.meta.url)),app=resolve(here,'../../..'),output=join(app,'.sites-runtime/wave-b-reproduced');
await mkdir(output,{recursive:true});await mkdir(join(app,'.sites-runtime/wave-b-build/tmp'),{recursive:true});
const manifest=JSON.parse(await readFile(join(here,'../manifest.json'),'utf8'));
let bytesProduced=0;
for(const epoch of manifest.epochs){
 const featureCollection=JSON.parse(await readFile(join(here,'cells',epoch.epoch_id+'.geojson'),'utf8'));
 const extent=65536,tile=geojsonvt(featureCollection,{maxZoom:0,indexMaxZoom:0,tolerance:0,extent,buffer:0}).getTile(0,0,0);
 const tilePath=join(output,epoch.epoch_id+'.mvt'),archivePath=join(output,epoch.epoch_id+'.pmtiles');
 await writeFile(tilePath,fromGeojsonVt({territories:tile},{version:2,extent}));
 const processResult=spawnSync(process.env.FIXTURE_PYTHON||join(app,'.sites-runtime/fixture-build/venv/bin/python'),[join(here,'compiler/build-wave-b-pmtiles.py'),tilePath,join(here,'cells',epoch.epoch_id+'.metadata.json'),archivePath],{encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',TMPDIR:output}});
 if(processResult.error||processResult.status!==0)throw Error(processResult.error?.message||processResult.stderr);
 const bytes=await readFile(archivePath);bytesProduced+=bytes.length;
 if(createHash('sha256').update(bytes).digest('hex')!==epoch.sha256)throw Error('Reproduction differs: '+epoch.epoch_id);
}
console.log(JSON.stringify({archives:manifest.epochs.length,byte_identical:true,bytes:bytesProduced}));
