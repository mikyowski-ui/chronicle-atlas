/** One reusable, bounded Historical Basemaps observation compiler. Never touches a ledger. */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { readFile, writeFile, mkdir, rename, stat, readdir, unlink } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import geojsonvt from 'geojson-vt';
import { fromGeojsonVt } from '@maplibre/vt-pbf';
import { PMTiles } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader.js';
import RelateOp from 'jsts/org/locationtech/jts/operation/relate/RelateOp.js';
import InteriorPointArea from 'jsts/org/locationtech/jts/algorithm/InteriorPointArea.js';
import { validateAlphaManifest, validateAlphaMetadata } from '../src/alpha.ts';
import { validateFeature } from '../src/temporal.ts';
export const app = fileURLToPath(new URL('../', import.meta.url));
export const root = join(app, 'public/global-history');
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const read = async path => JSON.parse(await readFile(path, 'utf8'));
export const json = async (path, value) => writeFile(path, JSON.stringify(value) + '\n');
export const VERSION = 'global-history-compiler-v1';
const bounds = [-180, -85.05112878, 180, 85.05112878], recorded = '2026-09-23T00:00:00.000Z';
const REV = 'da7a4b735ecef70aebdc9c73e409d8a2500d50f3';
const METHOD = 'Separate direct-source vectors; immutable audit cells and ledger unchanged. Full normalized source longitude/latitude and holes in Canvas; optional altitude omitted from two-dimensional display and polar latitude clamped at the Web Mercator limit, with exact originals archived; cartographic tile simplification only at zooms0–4. No temporal interpolation, no inferred intervening validity.';
const decisions = { 'political-association':'political', 'cultural-presence':'cultural', 'source-context':'context' };
const hawaiiReader=new GeoJSONReader(),hawaiiScope=hawaiiReader.read({type:'Polygon',coordinates:[[[-161,18],[-154,18],[-154,23],[-161,23],[-161,18]]]});
const regions = { Americas:[-180,-60,-30,84], Europe:[-30,34,60,84], Africa:[-20,-36,55,38], Asia:[26,-12,180,84], Oceania:[110,-60,180,15], Antarctica:[-180,-90,180,-60] };
export function dayFromAstronomical(year) { const d=new Date(0);d.setUTCFullYear(year,0,1);d.setUTCHours(0,0,0,0);return d.getTime()/86400000; }
export function yearName(astronomical) { return astronomical<=0?`${1-astronomical} BCE`:`${astronomical} CE`; }
function areaKm2(coordinates) {
 const rad=Math.PI/180,radius=6371.0088;
 const areas=coordinates.map(ring=>{let sum=0;for(let i=0;i<ring.length-1;i++){let delta=ring[i+1][0]-ring[i][0];if(delta>180)delta-=360;if(delta< -180)delta+=360;sum+=delta*rad*(2+Math.sin(ring[i][1]*rad)+Math.sin(ring[i+1][1]*rad));}return Math.abs(sum)*radius*radius/2;});
 return Math.max(0,areas[0]-areas.slice(1).reduce((a,b)=>a+b,0));
}
function featureBounds(geometry) { let box=[Infinity,Infinity,-Infinity,-Infinity];function scan(v){if(typeof v?.[0]==='number'){box=[Math.min(box[0],v[0]),Math.min(box[1],v[1]),Math.max(box[2],v[0]),Math.max(box[3],v[1])];}else if(Array.isArray(v))v.forEach(scan);}scan(geometry?.coordinates);return box; }
async function asset(path) {const bytes=await readFile(path);return {url:'./'+path.split('/').at(-1),sha256:sha(bytes),byte_length:bytes.length};}
export async function compileObservation(input) {
 const began=performance.now(),budgetBytes=await readFile(join(root,'resource-budget.json')),budget=JSON.parse(budgetBytes),limits=budget.limits,encoding=budget.encoding;
 const filename=input.source_filename??input.filename,id=input.observation_id??filename.replace('.geojson',''),year=input.astronomical_year??(input.year<0?input.year+1:input.year);
 if(year< -199&&!budget.scope.optional_enabled)throw Error('Earlier-source scope is not enabled in the frozen budget');
 const sourcePath=input.path?.startsWith('public/')?resolve(app,input.path):resolve(root,'source',input.path??'input/'+filename),mappingPath=join(root,'mappings',filename.replace('.geojson','-mappings.json'));
 const sourceBytes=await readFile(sourcePath),mappingBytes=await readFile(mappingPath);
 if(sourceBytes.length>limits.source_file_bytes||sha(sourceBytes)!==input.sha256)throw Error('Pinned source hash or byte budget differs: '+filename);
 const source=JSON.parse(sourceBytes),mapping=JSON.parse(mappingBytes),sourceHash=sha(sourceBytes),mappingHash=sha(mappingBytes);
 if(mapping.source_sha256!==sourceHash||mapping.mappings.length!==source.features.length)throw Error('Mapping/source reconciliation failed: '+filename);
 const config={version:VERSION,encoding,limits:{archive_bytes:limits.archive_bytes,metadata_bytes:limits.metadata_bytes,fallback_bytes:limits.fallback_bytes,parts_per_scene:limits.parts_per_scene},normalizer_sha256:sha(await readFile(join(app,'scripts/build-global-history-normalize.py'))),compiler_sha256:sha(await readFile(fileURLToPath(import.meta.url)))};
 const configHash=sha(JSON.stringify(config)),resumeKey=sha(JSON.stringify([sourceHash,mappingHash,mapping.rules_version,configHash]));
 const out=join(root,'observations',id),build=join(app,'.sites-runtime/global-history',id);await mkdir(out,{recursive:true});await mkdir(build,{recursive:true});
 try { const prior=await read(join(out,'receipt.json'));if(prior.resume_key===resumeKey){for(const a of prior.assets){const bytes=await readFile(resolve(out,a.url));if(bytes.length!==a.byte_length||sha(bytes)!==a.sha256)throw Error('Resume product differs');}return {...prior,resumed:true};} }catch{}
 const check=()=>{const rss=process.resourceUsage().maxRSS*1024;if(rss>limits.process_rss_bytes)throw Error('Frozen RSS budget exceeded');if(performance.now()-began>limits.job_deadline_ms)throw Error('Frozen per-job deadline exceeded');return rss;};
 const python=process.env.CHRONICLE_GEOMETRY_PYTHON??join(app,'.sites-runtime/fixture-build/venv/bin/python');
 const normalizedPath=join(build,'normalized.json');const repair=spawnSync(python,[join(app,'scripts/build-global-history-normalize.py'),sourcePath,mappingPath,normalizedPath],{encoding:'utf8',timeout:limits.job_deadline_ms,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
 if(repair.error||repair.status!==0)throw Error(repair.error?.message??repair.stderr);check();
 const normalized=await read(normalizedPath),geometryRows=new Map(normalized.rows.map(r=>[r.feature_index,r]));
 if(normalized.peak_rss_bytes>limits.process_rss_bytes)throw Error('Normalizer RSS budget exceeded');
 const start=dayFromAstronomical(year),end=dayFromAstronomical(year+1),edition=`global-history-${id}-da7a4b7-${mapping.rules_version}`,epochId=`global-${id}`;
 const territory=[],parts=[],entities={},evidence={},labels=[],groups={},outcomes=[],bestLabel=new Map(),reader=new GeoJSONReader();
 const coverage={source_features:source.features.length,political:0,cultural:0,context:0,review:0,quarantine:0,excluded:0,admitted_features:0,admitted_parts:0,admitted_entities:0,independently_reviewed:0,quarantined_parts:0};
 const regional=Object.fromEntries(Object.entries(regions).map(([k,b])=>[k,{bounds:b,source_features:0,political:0,cultural:0,context:0,review:0,quarantine:0,excluded:0}]));
 for(const row of mapping.mappings) {
  const index=row.feature_index,feature=source.features[index],name=String(feature.properties?.NAME??feature.properties?.Name??feature.properties?.name??'').trim();
  if(row.source_file_sha256!==sourceHash||!isDeepStrictEqual(feature.properties,row.original_properties))throw Error('Mapping row differs from source '+index);
  let kind=decisions[row.decision],outcome=kind??(row.decision==='quarantined'?'quarantine':row.decision==='excluded'?'excluded':'review'),failure;
  const nr=geometryRows.get(index);
  if(kind&&nr?.polygons){
   nr.quarantined_parts=[];nr.original_part_indices=[];const kept=[];nr.polygons.forEach((coordinates,partIndex)=>{const b=featureBounds({coordinates});if(b[0]<=-154&&b[2]>=-161&&b[1]<=23&&b[3]>=18&&RelateOp.intersects(hawaiiReader.read({type:'Polygon',coordinates}),hawaiiScope)){nr.quarantined_parts.push({part_index:partIndex,rule:'protected-hawaii-component-scope',bounds:b,geometry_sha256:sha(JSON.stringify(coordinates)),rationale:'Component intersects protected Hawaiian scope; omitted from staged historical display pending exact documentary approval.'});}else{kept.push(coordinates);nr.original_part_indices.push(partIndex);}});nr.polygons=kept;coverage.quarantined_parts+=nr.quarantined_parts.length;
   if(!kept.length&&!nr.error){kind=undefined;outcome='quarantine';failure='All polygon components intersect the protected Hawaiian scope';}
  }
  if(kind&&(!nr||nr.error)){failure=nr?.error??'Missing normalizer output';kind=undefined;outcome='review';}
  const record={source_feature_index:index,stable_source_feature_id:row.stable_source_feature_id??`${REV}:${filename}:${index}`,name,semantic_decision:row.decision,decision:outcome,component_quarantine:nr?.quarantined_parts??[],rule:failure?(outcome==='quarantine'?'protected-hawaii-component-scope':'geometry-normalization-review'):row.rule,rationale:failure??row.rationale,original_properties:feature.properties,source_geometry_sha256:sha(JSON.stringify(feature.geometry)),independently_historically_verified:false};
  const box=featureBounds(feature.geometry);
  for(const r of Object.values(regional)){if(box[0]<=r.bounds[2]&&box[2]>=r.bounds[0]&&box[1]<=r.bounds[3]&&box[3]>=r.bounds[1]){r.source_features++;r[outcome]++;}}
  coverage[outcome]++;
  if(!kind){outcomes.push(record);continue;}
  const entity=row.entity_id??`world:${kind}:scoped:${sha(`${sourceHash}:${index}`).slice(0,20)}`,state=`global-source:${sha(`${sourceHash}:${index}:${mappingHash}`).slice(0,32)}`;
  const hue=parseInt(sha(entity).slice(0,6),16),color=row.entity_color??'#'+[90+(hue&127),80+((hue>>7)&127),85+((hue>>14)&127)].map(v=>Math.min(230,v).toString(16).padStart(2,'0')).join('');
  entities[entity]??={name,color,number:String(Object.keys(entities).length+1).padStart(2,'0'),kind,identity_scope:row.entity_identity_scope,review_status:'source-attributed'};
  const sourceEdition=`overview:da7a4b7:${filename}`;
  evidence[state]={assertion_ids:[state],source_title:'Historical boundaries of world countries and cultural regions',source_edition:sourceEdition,source_url:`https://github.com/aourednik/historical-basemaps/blob/${REV}/geojson/${filename}`,license:'GPL-3.0',attribution:'André Ourednik and Historical Basemaps contributors; documented classification and display compilation by Chronicle',valid_from:start,valid_to:end,recorded_from:recorded,recorded_to:null,valid_extent:{precision:'year',start:{earliest:start,latest:end-1},end:{earliest:start+1,latest:end},originalCalendar:'source-unspecified; nominal civil year',sourceText:`Nominal ${yearName(year)} source observation; annual search envelope, not exact onset or cessation.`,conversionNote:'BCE civil year maps to1−year astronomical numbering; no intervening coverage.'},methodology:[row.rationale,METHOD,`Typed ${kind} source attribution; ${kind==='political'?'political association does not certify sovereignty or effective control.':kind==='cultural'?'cultural presence is not political ownership.':'source context is not ownership, a population estimate or a verified polity.'}`, 'PARTOF/SUBJECTO remain uninterpreted original source properties.'],limitations:['Source-attributed overview, not independent historical certification.','No inferred government institutions, control, population or settlement identity.','Snapshot year only; unsupported intervening dates remain gaps or explicitly dated reference maps.','Source boundary precision is heterogeneous; small components may be subpixel in low-zoom tiles.'],assertion_kind:kind,independently_historically_verified:false,source_feature_index:index,source_properties:feature.properties};
  let totalArea=0,bestPart;
  for(const [partIndex,coordinates] of nr.polygons.entries()){
   const geometry={type:'Polygon',coordinates},properties={entity_id:entity,territory_state_id:state,render_id:`global-display:${id}:${index}:part:${nr.original_part_indices?.[partIndex]??partIndex}`,t_start:start,t_end:end,assertion_id:state,kind,relation:kind==='political'?'source_attributed_association':kind==='cultural'?'source_attributed_cultural_presence':'source_context_only',status:'uncertain',source_edition:sourceEdition,recorded_from:recorded,recorded_to:'',pick_priority:kind==='political'?3:kind==='cultural'?2:1,geometry_role:'source-display',fill_color:color,source_feature_index:index,source_name:name,classification_rule:row.rule,review_status:'source-attributed',source_borderprecision:feature.properties.BORDERPRECISION??0};
   const area=areaKm2(coordinates);totalArea+=area;if(!bestPart||bestPart.area<area)bestPart={geometry,area};
   const f={type:'Feature',properties,geometry};validateFeature(f,'territories',{t_start:start,t_end:end},true);territory.push(f);parts.push({properties,areaKm2:area,geometry_hash:sha(JSON.stringify(geometry))});(groups[`${entity}|${state}`]??=[]).push(geometry);
  }
  if(bestPart&&(!bestLabel.has(entity)||bestLabel.get(entity).area<totalArea)){
   const anchor=InteriorPointArea.getInteriorPoint(reader.read(bestPart.geometry));
   if(anchor&&Number.isFinite(anchor.x)&&Number.isFinite(anchor.y))bestLabel.set(entity,{area:totalArea,position:[anchor.x,Math.max(bounds[1],Math.min(bounds[3],anchor.y))]});
  }
  Object.assign(record,{entity_id:entity,territory_state_id:state,parts:nr.polygons.length,geometry_normalization:nr.receipt});outcomes.push(record);coverage.admitted_features++;check();
 }
 coverage.admitted_parts=parts.length;coverage.admitted_entities=Object.keys(entities).length;
 if(coverage.political+coverage.cultural+coverage.context+coverage.review+coverage.quarantine+coverage.excluded!==coverage.source_features)throw Error('Coverage does not reconcile');
 await json(join(out,'outcomes.json'),{schema_version:1,source_filename:filename,source_sha256:sourceHash,mapping_sha256:mappingHash,mapping_version:mapping.rules_version,coverage,regions:regional,regional_method:'Counts of source-feature bounding boxes intersecting these overlapping diagnostic windows; not area, completeness, sovereignty or exclusive allocation.',records:outcomes});
 if(parts.length>limits.parts_per_scene)throw Error(`Spatial sharding required: admitted ${parts.length} parts exceeds retained ${limits.parts_per_scene} scene cap`);
 if(!parts.length)throw Error('No admitted display polygons; cannot count this as a visible map');
 for(const [entity,label] of bestLabel)labels.push({label_id:`label:${id}:${entity}`,entity_id:entity,text:entities[entity].name,position:label.position,priority:Math.max(1,Math.min(9,Math.floor(Math.log10(label.area||1))))});
 const geometry_hashes=Object.fromEntries(Object.entries(groups).map(([k,g])=>[k,sha(JSON.stringify(g))]));
 const metadata={schema_version:2,fixture_kind:'historical-candidate',edition,epoch_id:epochId,t_start:start,t_end:end,parts,geometry_hashes,entities,labels,evidence,migration:[],display_method:METHOD,coverage};
 const mp=join(out,'metadata.json'),fp=join(out,'geometry.geojson.json');await json(mp,metadata);await json(fp,{schema_version:2,edition,epoch_id:epochId,territories:territory,population:[],migration:[]});
 if((await stat(mp)).size>limits.metadata_bytes)throw Error('Metadata needs bounded split');if((await stat(fp)).size>limits.fallback_bytes)throw Error('Canvas fallback needs bounded split');
 const index=geojsonvt({type:'FeatureCollection',features:territory},{...encoding,maxZoom:encoding.maxzoom,indexMaxZoom:0,indexMaxPoints:0}),expected=new Map(territory.map(f=>[f.properties.render_id,f.properties])),entries=[],tileCounts={},vertices={},seen=new Set();let largestTile=0;
 for(let z=0;z<=encoding.maxzoom;z++){tileCounts[z]=vertices[z]=0;for(let x=0;x<2**z;x++)for(let y=0;y<2**z;y++){
  const tile=index.getTile(z,x,y);if(!tile?.features.length)continue;
  const bytes=fromGeojsonVt({territories:tile},{version:2,extent:encoding.extent});largestTile=Math.max(largestTile,bytes.length);if(bytes.length>limits.tile_bytes)throw Error('Tile byte cap exceeded');
  const decoded=new VectorTile(new Pbf(bytes)).layers.territories;for(let i=0;i<decoded.length;i++){const f=decoded.feature(i),props=expected.get(f.properties.render_id);if(!props||Object.entries(props).some(([k,v])=>v!=null&&f.properties[k]!==v))throw Error('MVT changed canonical identity');vertices[z]+=f.loadGeometry().reduce((n,r)=>n+r.length,0);if(z===encoding.maxzoom)seen.add(f.properties.render_id);}
  const path=`${z}-${x}-${y}.mvt`;await writeFile(join(build,path),bytes);entries.push({tile:[z,x,y],path});tileCounts[z]++;
 }check();}
 if(entries.length>limits.tiles_per_archive)throw Error('Archive tile count exceeds budget');
 await json(join(build,'index.json'),entries);await json(join(build,'metadata.json'),{edition,epoch_id:epochId,t_start:start,t_end:end,name:`World overview ${yearName(year)}`,fixture_kind:'historical-candidate',format:'pbf',type:'overlay',minzoom:0,maxzoom:encoding.maxzoom,bounds:bounds.join(','),bounds_array:bounds,geometry_encoding:encoding,vector_layers:[{id:'territories',minzoom:0,maxzoom:encoding.maxzoom,fields:{render_id:'String',entity_id:'String',kind:'String'}}]});
 const target=join(out,'geometry.pmtiles'),encoded=spawnSync(python,[join(app,'scripts/build-alpha-pmtiles.py'),join(build,'index.json'),join(build,'metadata.json'),target],{encoding:'utf8',timeout:limits.job_deadline_ms,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});if(encoded.error||encoded.status!==0)throw Error(encoded.error?.message??encoded.stderr);
 const bytes=await readFile(target),hash=sha(bytes),archiveName=`geometry.${hash}.pmtiles`;if(bytes.length>limits.archive_bytes)throw Error(`Archive ${bytes.length} exceeds retained1MB cap; spatial split required`);await rename(target,join(out,archiveName));
 const pm=new PMTiles({getKey:()=>archiveName,getBytes:async(offset,count)=>({data:Uint8Array.from(bytes.subarray(offset,offset+count)).buffer})}),header=await pm.getHeader();if(header.specVersion!==3||header.numAddressedTiles!==entries.length||header.maxZoom!==encoding.maxzoom)throw Error('PMTiles header mismatch');
 for(const row of [entries[0],entries[Math.floor(entries.length/2)],entries.at(-1)]){const back=await pm.getZxy(...row.tile);if(!back||sha(new Uint8Array(back.data))!==sha(await readFile(join(build,row.path))))throw Error('PMTiles round-trip mismatch');}
 const chunks=[];for(let offset=0;offset<bytes.length;offset+=16384)chunks.push(sha(bytes.subarray(offset,offset+16384)));
 const stream={url:'./'+archiveName,sha256:hash,byte_length:bytes.length,minzoom:0,maxzoom:encoding.maxzoom,bounds,source_layers:['territories'],integrity:{chunk_size:16384,sha256:chunks}};
 const base=await read(join(app,'public/integrated/global-base.json'));base.stream.url='../../../integrated/'+base.stream.url.replace(/^\.\//,'');base.fallback.url='../../../integrated/'+base.fallback.url.replace(/^\.\//,'');
 const sourceRights=await read(join(app,'public/integrated/source/rights-record.json'));
 const epoch={epoch_id:epochId,t_start:start,t_end:end,stream,metadata:await asset(mp),fallback:await asset(fp)};
 const amendmentBytes=year< -199?await readFile(join(root,'source/optional-rights-amendment.json')):null;
 const scopeAuthorization=year< -199?{amendment_record:{url:'../../source/optional-rights-amendment.json',sha256:sha(amendmentBytes),byte_length:amendmentBytes.length},scope_id:'global-history-earlier-nine-v2',authority:'Current user global-history directive: optional nine earlier observations, enabled only after the primary40 product gate.',enabled_after:'verification/global-history/primary-40/browser-gate.json',permitted_source_years:'3000 BCE through2010 CE at recovered source observations only',original_pilot_authorization_preserved:true,original_pilot_constraint:'No source input before200BCE applied to the original pilot only; that record is retained verbatim, not retroactively rewritten.',independently_reviewed:false,public_ledger_mutations:false}:undefined;
 const manifest={schema_version:2,fixture_kind:'historical-candidate',edition,title:`World overview · ${yearName(year)}`,bounds,recorded_at:recorded,...(scopeAuthorization?{scope_authorization:scopeAuthorization}:{}),source:{...sourceRights,edition:REV,url:sourceRights.edition_url,attribution:sourceRights.author_credit},methodology:[METHOD,'Source-attributed typed overview; not independently reviewed history. Possible annual observation window is not exact event validity.'],initial_time:start,display_product:VERSION,base_geography:base,epochs:[epoch],coverage};
 const validated=validateAlphaManifest(manifest);validateAlphaMetadata(metadata,validated.epochs[0],validated);await json(join(out,'manifest.json'),manifest);const manifestAsset=await asset(join(out,'manifest.json'));if(manifestAsset.byte_length>limits.manifest_bytes)throw Error('Manifest cap exceeded');
 for(const name of await readdir(out))if(/^geometry\.[a-f0-9]{64}\.pmtiles$/.test(name)&&name!==archiveName)await unlink(join(out,name));
 const allAssets=[stream,epoch.metadata,epoch.fallback,manifestAsset,await asset(join(out,'outcomes.json'))];
 const receipt={schema_version:1,status:'COMPILED',observation_id:id,year:year<=0?year-1:year,astronomical_year:year,source_filename:filename,source_sha256:sourceHash,source_bytes:sourceBytes.length,source_precision:'year',mapping_version:mapping.rules_version,mapping_sha256:mappingHash,compiler_configuration_sha256:configHash,resume_key:resumeKey,budget_sha256:sha(budgetBytes),edition,t_start:start,t_end:end,manifest:`./observations/${id}/manifest.json`,manifest_sha256:manifestAsset.sha256,manifest_bytes:manifestAsset.byte_length,coverage,regions:regional,resource_measurements:{elapsed_ms:performance.now()-began,peak_process_rss_bytes:check(),normalizer_peak_rss_bytes:normalized.peak_rss_bytes,archive_bytes:bytes.length,metadata_bytes:epoch.metadata.byte_length,fallback_bytes:epoch.fallback.byte_length,largest_uncompressed_tile_bytes:largestTile,tiles:entries.length,tile_counts:tileCounts,vertices_by_zoom:vertices,canonical_parts:parts.length,source_vertices:territory.reduce((n,f)=>n+f.geometry.coordinates.reduce((a,r)=>a+r.length,0),0),subpixel_parts_at_maxzoom:[...expected.keys()].filter(id=>!seen.has(id)),repairs:outcomes.filter(r=>r.geometry_normalization?.repair!=='none'&&r.geometry_normalization).length,polar_clamped_vertices:outcomes.reduce((n,r)=>n+(r.geometry_normalization?.polar_clamped_vertices??0),0),discarded_display_altitude_vertices:outcomes.reduce((n,r)=>n+(r.geometry_normalization?.discarded_display_altitude_vertices??0),0)},assets:allAssets,verification:'All MVT tiles decoded with canonical identities; PMTiles first/middle/last spatial round-trip; full Canvas coordinates validated; Alpha manifest/metadata validated. No browser/GPU execution or historical certification implied.'};
 await json(join(out,'receipt.json'),receipt);return receipt;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const input=await read(process.argv[2]);const receipt=await compileObservation(input);console.log(JSON.stringify({status:'COMPILED',observation_id:receipt.observation_id,coverage:receipt.coverage,elapsed_ms:receipt.resource_measurements.elapsed_ms,resumed:receipt.resumed??false}));}catch(error){console.error(error.stack);process.exitCode=1;}
}
