import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PMTiles } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader.js';
import GeometryFactory from 'jsts/org/locationtech/jts/geom/GeometryFactory.js';
import RelateOp from 'jsts/org/locationtech/jts/operation/relate/RelateOp.js';
import { adaptAlphaManifest, createAlphaLoader, validateAlphaManifest } from '../src/alpha.ts';
import { validateGlobalCatalog } from '../src/global-catalog.ts';
const read = async (name:string)=>JSON.parse(await readFile(new URL('../public/'+name,import.meta.url),'utf8'));
const bytes = async (url:string)=>readFile(new URL('../public'+new URL(url).pathname,import.meta.url));
const hash=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex');
const fetcher:typeof fetch=async input=>new Response(await bytes(String(input)));
const catalog=async()=>validateGlobalCatalog(await read('global-history/catalog.json'),'https://example.test/global-history/catalog.json');

test('all49 original source observations reconcile to typed admission or explicit omission under frozen budgets',async()=>{
 const c=await catalog(), inputs=await read('global-history/source/input-manifest.json'), budget=await read('global-history/resource-budget.json');
 assert.equal(c.observations.length,49);assert.equal(c.failures.length,0);
 assert.equal(c.observations.filter(o=>o.year>=-200).length,40);
 const primary=JSON.parse(await readFile(new URL('../verification/global-history/primary-40/catalog.json',import.meta.url),'utf8'));
 const revisions=(await read('history/political-admission-receipt.json')).revisions;
 for(const before of primary.observations){
  const after=c.observations.find(o=>o.observation_id===before.observation_id)!;assert.ok(after);
  const amendment=revisions.find((r:any)=>r.observation_id===before.observation_id);
  if(amendment){assert.equal(amendment.previous_manifest_sha256,before.manifest_sha256);assert.equal(after.manifest_sha256,amendment.manifest_sha256);}
  else assert.equal(after.manifest_sha256,before.manifest_sha256);
  assert.equal(after.source_sha256,before.source_sha256);
 }
 assert.deepEqual(c.observations.map(o=>o.year),[-3000,-2000,-1500,-1000,-700,-500,-400,-323,-300,-200,-100,-1,100,200,300,400,500,600,700,800,900,1000,1100,1200,1279,1300,1400,1492,1500,1530,1600,1650,1700,1715,1783,1800,1815,1878,1880,1900,1914,1920,1930,1938,1945,1960,1994,2000,2010]);
 for(const o of c.observations){
  const input=inputs.observations.find((r:any)=>r.observation_id===o.observation_id);assert.ok(input);
  const sourceBytes=await readFile(new URL('../'+input.path,import.meta.url));assert.equal(hash(sourceBytes),o.source_sha256);
  const source=JSON.parse(sourceBytes.toString()), outcome=await read(`global-history/observations/${o.observation_id}/outcomes.json`);
  assert.equal(outcome.records.length,source.features.length);assert.equal(new Set(outcome.records.map((r:any)=>r.source_feature_index)).size,source.features.length);
  assert.equal(outcome.coverage.political+outcome.coverage.cultural+outcome.coverage.context+outcome.coverage.review+outcome.coverage.quarantine+outcome.coverage.excluded,source.features.length);
  assert.equal(outcome.coverage.independently_reviewed,0);assert.ok(outcome.coverage.admitted_features>0);assert.ok(outcome.coverage.admitted_parts<=budget.limits.parts_per_scene);
  for(const r of outcome.records){assert.deepEqual(r.original_properties,source.features[r.source_feature_index].properties);assert.equal(r.source_geometry_sha256,hash(Buffer.from(JSON.stringify(source.features[r.source_feature_index].geometry))));assert.equal(r.independently_historically_verified,false);}
 }
});

test('every catalog entry loads full validated Canvas geometry and a native PMTiles tile with the same temporal identity',async()=>{
 for(const o of (await catalog()).observations){
  const manifestBytes=await bytes(o.manifest);assert.equal(hash(manifestBytes),o.manifest_sha256);assert.equal(manifestBytes.length,o.manifest_bytes);
  const m=validateAlphaManifest(JSON.parse(manifestBytes.toString()),o.manifest), a=adaptAlphaManifest(m), e=m.epochs[0];
  if(o.year< -200){assert.equal((m as any).scope_authorization.scope_id,'global-history-earlier-nine-v2');assert.equal((m as any).scope_authorization.original_pilot_authorization_preserved,true);}
  assert.equal(m.epochs.length,1);assert.equal(e.t_start,o.t_start);assert.equal(e.t_end,o.t_end);
  const scene=await createAlphaLoader(m,o.manifest,true,fetcher)(a.epochs[0],a,new AbortController().signal);
  assert.equal(scene.territories.length,o.coverage.admitted_parts);
  assert.equal(Object.keys(scene.entities!).length,o.coverage.admitted_entities);
  const kinds=new Set(scene.territories.map(f=>(f.properties as any).kind));assert.ok([...kinds].every(k=>['political','cultural','context'].includes(k)));
  assert.ok(Object.values(scene.evidence!).every(e=>e.valid_from===o.t_start&&e.valid_to===o.t_end&&e.valid_extent?.precision==='year'));
  const archived=await bytes(e.stream.url);assert.equal(hash(archived),e.stream.sha256);assert.ok(archived.length<=1_000_000);
  const archive=new PMTiles({getKey:()=>e.stream.sha256,getBytes:async(offset,length)=>({data:Uint8Array.from(archived.subarray(offset,offset+length)).buffer})});
  const tile=await archive.getZxy(0,0,0);assert.ok(tile,o.observation_id+' missingworldtile');
  const layer=new VectorTile(new Pbf(tile.data)).layers.territories;assert.ok(layer.length>0);
  const canonical=new Map(scene.parts!.map(p=>[p.properties.render_id,p.properties]));
  for(let i=0;i<layer.length;i++){const props=layer.feature(i).properties;const expected=canonical.get(String(props.render_id));assert.ok(expected);assert.equal(props.entity_id,expected.entity_id);assert.equal(props.t_start,o.t_start);assert.equal(props.t_end,o.t_end);}
 }
});

test('source-context and cultural presence never use a political relation, and protected Hawaiian components stay omitted',async()=>{
 let cultural=0,context=0,quarantinedParts=0;
 const reader=new GeoJSONReader(new GeometryFactory()),scope=reader.read({type:'Polygon',coordinates:[[[-161,18],[-154,18],[-154,23],[-161,23],[-161,18]]]});
 for(const o of (await catalog()).observations){
  const data=await read(`global-history/observations/${o.observation_id}/geometry.geojson.json`),outcome=await read(`global-history/observations/${o.observation_id}/outcomes.json`);
  for(const f of data.territories){const p=f.properties;if(p.kind==='cultural'){cultural++;assert.equal(p.relation,'source_attributed_cultural_presence');}if(p.kind==='context'){context++;assert.equal(p.relation,'source_context_only');}
   let box=[Infinity,Infinity,-Infinity,-Infinity];for(const ring of f.geometry.coordinates)for(const [x,y]of ring)box=[Math.min(box[0],x),Math.min(box[1],y),Math.max(box[2],x),Math.max(box[3],y)];if(box[0]<=-154&&box[2]>=-161&&box[1]<=23&&box[3]>=18)assert.ok(!RelateOp.intersects(reader.read(f.geometry),scope),'Protected Hawaiian component entered display');
  }
  quarantinedParts+=outcome.coverage.quarantined_parts;
  for(const r of outcome.records.filter((r:any)=>r.decision==='quarantine'))assert.ok(!data.territories.some((f:any)=>f.properties.source_feature_index===r.source_feature_index));
 }
 assert.ok(cultural>0&&context>0&&quarantinedParts>0);
});

test('BCE, modern and reference chronology remain nominal observations with real intervening gaps',async()=>{
 const obs=(await catalog()).observations;
 const first=new Date(obs[0].t_start*86400000);assert.equal(first.getUTCFullYear(),-2999);
 assert.equal(new Date(obs.find(o=>o.year===-200)!.t_start*86400000).getUTCFullYear(),-199);
 const one=obs.find(o=>o.year===-1)!;assert.equal(new Date(one.t_start*86400000).getUTCFullYear(),0);
 const last=obs.at(-1)!;assert.equal(new Date(last.t_start*86400000).getUTCFullYear(),2010);assert.equal(new Date(last.t_end*86400000).getUTCFullYear(),2011);
 assert.ok(obs.slice(1).some((o,i)=>obs[i].t_end<o.t_start));
 const coverage=await read('global-history/coverage.json'),budget=await read('global-history/resource-budget.json');
 assert.ok(coverage.resources.maximum_archive_bytes<=budget.limits.archive_bytes);assert.ok(coverage.resources.max_process_rss_bytes<=budget.limits.process_rss_bytes);assert.ok(coverage.resources.cumulative_compressed_bytes<=budget.limits.cumulative_compressed_bytes);
});
