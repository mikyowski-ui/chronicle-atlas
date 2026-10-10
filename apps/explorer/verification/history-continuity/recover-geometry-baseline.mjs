/** Reconstruct missing pre-admission geometry evidence from hash-pinned old mappings.
 * This is a new recovery record, not a claim that the omitted old receipt survived.
 * No current observation metadata is read while deriving the baseline.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader.js';
import RelateOp from 'jsts/org/locationtech/jts/operation/relate/RelateOp.js';
const app=fileURLToPath(new URL('../../',import.meta.url));
const python=process.argv[2];
if(!python)throw Error('Usage: node recover-geometry-baseline.mjs PATH_TO_PYTHON_WITH_SHAPELY_2_1_2');
const sha=data=>createHash('sha256').update(data).digest('hex');
const read=async path=>JSON.parse(await readFile(path,'utf8'));
const receipt=await read(join(app,'public/history/political-admission-receipt.json'));
const pins=(await read(join(app,'verification/global-history/primary-40/semantic-mappings/archive-hashes.json'))).files;
const normalizer=join(app,'scripts/build-global-history-normalize.py');
const normalizerHash=sha(await readFile(normalizer));
assert.equal(normalizerHash,sha(await readFile(join(app,'verification/global-history/primary-40/compiler/build-global-history-normalize.py'))));
const reader=new GeoJSONReader();
const scope=reader.read({type:'Polygon',coordinates:[[[-161,18],[-154,18],[-154,23],[-161,23],[-161,18]]]});
function bounds(coordinates){const b=[Infinity,Infinity,-Infinity,-Infinity];for(const ring of coordinates)for(const p of ring){b[0]=Math.min(b[0],p[0]);b[1]=Math.min(b[1],p[1]);b[2]=Math.max(b[2],p[0]);b[3]=Math.max(b[3],p[1]);}return b;}
const scratch=await mkdtemp(join(tmpdir(),'chronicle-geometry-recovery-'));
const observations=[];
try {
 for(const revision of receipt.revisions){
  const mappingPath=join(app,revision.previous_mapping_path);
  const mappingBytes=await readFile(mappingPath);const mapping=JSON.parse(mappingBytes);
  assert.equal(sha(mappingBytes),revision.previous_mapping_sha256);
  assert.equal(sha(mappingBytes),pins[revision.mapping_filename]);
  const sourcePath=join(app,'public/global-history/source/input',mapping.source);
  assert.equal(sha(await readFile(sourcePath)),revision.source_sha256);
  const output=join(scratch,revision.observation_id+'.json');
  const run=spawnSync(python,[normalizer,sourcePath,mappingPath,output],{encoding:'utf8',timeout:60000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
  if(run.error||run.status!==0)throw Error(run.error?.message??run.stderr);
  const normalized=await read(output);
  assert.deepEqual(normalized.engine,{shapely:'2.1.2',geos:'3.13.1'});
  const previous_parts={};const componentQuarantine=[];const failures=[];
  for(const row of normalized.rows){
   if(row.error){failures.push({feature_index:row.feature_index,error:row.error});continue;}
   for(const [partIndex,coordinates] of row.polygons.entries()){
    const b=bounds(coordinates);const geometry={type:'Polygon',coordinates};
    if(b[0]<=-154&&b[2]>=-161&&b[1]<=23&&b[3]>=18&&RelateOp.intersects(reader.read(geometry),scope)){
     componentQuarantine.push({feature_index:row.feature_index,part_index:partIndex,geometry_sha256:sha(JSON.stringify(coordinates))});continue;
    }
    const id=`global-display:${revision.observation_id}:${row.feature_index}:part:${partIndex}`;
    assert.equal(previous_parts[id],undefined);
    previous_parts[id]=sha(JSON.stringify(geometry));
   }
  }
  observations.push({observation_id:revision.observation_id,source_sha256:revision.source_sha256,previous_mapping_sha256:revision.previous_mapping_sha256,previous_parts,component_quarantine:componentQuarantine,normalization_failures:failures});
 }
 const result={schema_version:1,record_kind:'regenerated-pre-admission-geometry-baseline',recovery_date:'2026-09-27',original_receipt_recovered:false,method:'Independently normalize exact retained raw GeoJSON selected by SHA-pinned pre-admission mappings, using the unchanged retained normalizer and exact Shapely/GEOS versions; apply the compiler’s protected Hawaii component test and stable render IDs. Current compiled metadata is not used to derive these hashes.',engine:{shapely:'2.1.2',geos:'3.13.1'},normalizer_sha256:normalizerHash,observations};
 const destination=join(app,'verification/history-continuity/previous-geometry-hashes.json');
 await writeFile(destination,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({output:destination,observations:observations.length,parts:observations.reduce((n,r)=>n+Object.keys(r.previous_parts).length,0),original_receipt_recovered:false}));
}finally{await rm(scratch,{recursive:true,force:true});}
