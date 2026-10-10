// Deterministically re-express the pinned British Isles study as bounded PMTiles.
// No database is opened or changed. Source geometry is never used as ownership.
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, copyFile, readdir, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import geojsonvt from 'geojson-vt';
import { fromGeojsonVt } from '@maplibre/vt-pbf';
import { PMTiles } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';

const app = fileURLToPath(new URL('../', import.meta.url));
const root = resolve(app, '../..');
const out = join(app, 'public/wave-b');
const build = join(app, '.sites-runtime/wave-b-build');
const read = async path => JSON.parse(await readFile(path, 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n');
const budgetBytes = await readFile(join(out, 'resource-budget.json'));
const budget = JSON.parse(budgetBytes);
const prior = await read(join(app, 'fixtures/wave-b-prior-exact-result.json'));
const mappingBytes = await readFile(join(root, 'data/isles/mapping-manifest.json'));
const mapping = JSON.parse(mappingBytes);
const rights = await read(join(root, 'data/beta/basemaps/rights-record.json'));
if (sha(mappingBytes) !== prior.source.mappingSha256 || mapping.records.filter(r => r.kind !== 'review').length !== budget.caps.sourceFeatures || mapping.snapshots.length !== budget.caps.snapshots) throw Error('Pinned mapping or frozen scope changed');
await mkdir(join(build, 'tmp'), {recursive:true});
await mkdir(join(out, 'source/features'), {recursive:true});

// Copy source bytes unchanged into an isolated resolver location, so imports use
// the app's pinned dependencies without modifying the historical project.
const code = {};
await mkdir(join(build, 'readiness'), {recursive:true});
for (const [source, name] of [['scripts/history/rasterize.ts','rasterize.ts'], ['scripts/readiness/coverage.ts','readiness/coverage.ts'], ['scripts/history/canonical.ts','canonical.ts'], ['lib/readiness/chronology.ts','chronology.ts']]) {
  const bytes = await readFile(join(root, source));
  const destination = join(build, name);
  await writeFile(destination, bytes);
  if (sha(await readFile(destination)) !== sha(bytes)) throw Error('Compiler copy changed');
  code[source] = sha(bytes);
}
// coverage.ts contains a relative import into scripts/history; its unchanged
// location is reproduced beneath this isolated build directory.
await mkdir(join(build, 'history'), {recursive:true});
await copyFile(join(build, 'canonical.ts'), join(build, 'history/canonical.ts'));
const { makeCoverage } = await import(pathToFileURL(join(build, 'readiness/coverage.ts')).href);
const { objectHash } = await import(pathToFileURL(join(build, 'canonical.ts')).href);
const { observationExtent, dayFromAstronomical } = await import(pathToFileURL(join(build, 'chronology.ts')).href);
const lock = await read(join(root, 'data/provinces/immutable-mesh.lock.json'));
for (const [path, digest] of Object.entries(lock)) if (sha(await readFile(join(root, path))) !== digest) throw Error(`Immutable mesh mismatch: ${path}`);
const meshHash = lock['public/data/provinces/mesh.bin'];
const source = {title:rights.title, edition:mapping.sourceRevision, url:rights.edition_url, license:mapping.license, attribution:mapping.attribution};
const methodology = ['Immutable 0.5° WGS84 cell membership from the unchanged Chronicle rasterizer; eligible intersection threshold 0.50. The cell geometry is authoritative.', 'Historical Basemaps nominal snapshot year is a possible observation window, not a dated onset or cessation. Unsupported intervening years remain gaps.', 'Political polygons mean source-attributed association. Cultural approximations are separately identified and do not imply ownership.', 'Regenerated bounded derivative from pinned inputs. The prior staged SQLite and compiled archive could not be retrieved; no ledger has been changed.', 'No population or migration observations are supplied for this candidate.'];
await json(join(out,'intake-inventory.json'),{source,rights,recorded_at:mapping.recordedAt,mapping_sha256:sha(mappingBytes),budget_sha256:sha(budgetBytes),compiler_sources:code,temporal_interpretation:methodology[1],mapping_rules:methodology,inputs:mapping.snapshots.map(s=>({file:s.file,sha256:s.sourceSha256,source_year:s.sourceYear,astronomical_year:s.astronomicalYear})),publication:'STAGED — NOT PUBLISHED'});
const manifest = {schema_version:1, fixture_kind:'historical-candidate', edition:'isles-wave-b-da7a4b7-20260920', title:'British Isles & Channel coast', bounds:mapping.bbox, recorded_at:mapping.recordedAt, source, methodology, initial_time:dayFromAstronomical(800), epochs:[]};
const results = [], inputInventory = [], allClaims = [], coverageSets = new Map(), rasterCache = new Map();
const extent = 65536, layers = ['territories'];
let peakRssBytes = process.memoryUsage().rss, workerMs = 0, maxFeatures = 0, totalBytes = 0, sourceBytes = 0;
const began = performance.now();
const color = id => {const h = parseInt(sha(id).slice(0,6),16);return '#' + [90+(h&127),80+((h>>7)&127),85+((h>>14)&127)].map(v=>Math.min(230,v).toString(16).padStart(2,'0')).join('');};
for (const snapshot of mapping.snapshots) {
  const inputBytes = await readFile(join(root, 'data/beta/basemaps/input', snapshot.file));
  if (sha(inputBytes) !== snapshot.sourceSha256) throw Error('Pinned source input mismatch');
  inputInventory.push({file:snapshot.file, sha256:snapshot.sourceSha256, bytes:inputBytes.length, source_url:`https://raw.githubusercontent.com/aourednik/historical-basemaps/${mapping.sourceRevision}/geojson/${snapshot.file}`});
  const rows = mapping.records.filter(r => r.file === snapshot.file && r.kind !== 'review');
  if (rows.length > budget.batchFeatures) throw Error('Feature batch cap exceeded');
  const claims = [], features = [], entities = {}, labels = [], evidence = {};
  const start = dayFromAstronomical(snapshot.astronomicalYear), end = dayFromAstronomical(snapshot.astronomicalYear+1);
  const label = `${Math.abs(snapshot.sourceYear)} ${snapshot.sourceYear < 0 ? 'BCE' : 'CE'}`;
  const epoch = `isles-${snapshot.sourceYear < 0 ? 'bce' + Math.abs(snapshot.sourceYear) : snapshot.sourceYear}`;
  for (const row of rows) {
    const input = join(root, 'data/isles', row.featurePath), bytes = await readFile(input);
    if (sha(bytes) !== row.featureSha256) throw Error('Pinned prepared feature changed');
    await copyFile(input, join(out, 'source', row.featurePath)); sourceBytes += bytes.length;
    let raster = rasterCache.get(row.featureSha256);
    if (!raster) {
      const resultPath = join(build, row.featureSha256 + '.raster.json');
      const processResult = spawnSync(process.execPath, [`--max-old-space-size=${budget.worker.oldHeapMiB}`, '--import', 'tsx', join(app, 'scripts/build-wave-b-worker.mjs'), input, resultPath], {cwd:app,encoding:'utf8',timeout:budget.worker.deadlineMs,maxBuffer:budget.worker.outputBytes,env:{...process.env,TMPDIR:join(build,'tmp')}});
      if (processResult.error || processResult.status !== 0) throw Error(processResult.error?.message || processResult.stderr || 'Bounded raster worker failed');
      const metrics = JSON.parse(processResult.stdout.trim());
      peakRssBytes = Math.max(peakRssBytes, metrics.peakRssBytes); workerMs += metrics.elapsedMs;
      raster = await read(resultPath); rasterCache.set(row.featureSha256, raster);
    }
    const coverage = makeCoverage(raster.assignments); coverageSets.set(coverage.id, coverage.count);
    const entityId = `isles:${row.kind}:${sha(row.displayName).slice(0,20)}`;
    const content = {setId:coverage.id, kind:row.kind, entity:entityId, relation:row.kind==='political'?'source_attributed_association':null, extent:observationExtent(start,end,'year',`Nominal ${label} source snapshot; no event-date inference or carry-forward`), recordedFrom:mapping.recordedAt, recordedTo:null, source:'overview-ourednik', edition:`overview:da7a4b7:${snapshot.file}`, notes:row.rationale+' This regional interpretation uses the same source as the overview; it is not corroboration.', geography:{studyId:'british-isles',bbox:mapping.bbox,sourceFeatureIndex:row.featureIndex,sourceProperties:row.originalProperties,originalGeometrySha256:row.originalGeometrySha256,clippedGeometrySha256:row.clippedGeometrySha256,preparedFeatureSha256:row.featureSha256,mappingSha256:sha(mappingBytes),scopeClipped:row.scopeClipped,scopeBoundaryIsHistoricalBorder:false,repair:row.repair,coverageMethod:'Unchanged WGS84 cell intersection; threshold0.50',unrepresentedComponents:raster.unrepresentedComponents,representativePoint:row.representativePoint},status:'uncertain',editorial:false};
    const claimId = 'claim:' + objectHash(content);
    const claim = {...content,id:claimId,lineage:claimId,ranges:coverage.ranges};
    claims.push(claim); allClaims.push(claim);
    if (!entities[entityId]) {entities[entityId] = {name:row.displayName,color:row.kind==='cultural'?'#b9a5ca':color(entityId),number:String(Object.keys(entities).length+1).padStart(2,'0'),kind:row.kind};labels.push({label_id:`label:${epoch}:${entityId}`,entity_id:entityId,text:row.displayName,position:row.representativePoint,priority:row.kind==='political'?2:1});}
    evidence[claimId] = {assertion_ids:[claimId], source_title:rights.title, source_edition:content.edition, source_url:`https://github.com/aourednik/historical-basemaps/blob/${mapping.sourceRevision}/geojson/${snapshot.file}`, license:mapping.license,attribution:mapping.attribution,valid_from:start,valid_to:end,recorded_from:content.recordedFrom,recorded_to:null,methodology:[row.rationale,...methodology.slice(0,4),'Date precision: year; '+content.extent.conversionNote],limitations:[...mapping.sourceLimitations,'Cell threshold can omit small islands; '+raster.unrepresentedComponents.length+' source components have no eligible cell in this assertion.','No independent corroboration or historical certification.', 'Population and migration data are unavailable.'],valid_extent:content.extent,input_sha256:row.sourceSha256,prepared_feature_sha256:row.featureSha256,coverage_set_id:coverage.id,source_feature_index:row.featureIndex};
    for (const membership of raster.assignments.filter(m => m.eligible)) {
      const cell = membership.cellId, west = ((cell-1)%720)*.5-180, south = Math.floor((cell-1)/720)*.5-90;
      if (west < -12 || west >= 3 || south < 48 || south >= 61.5) throw Error('Cell escaped study scope');
      features.push({type:'Feature',properties:{entity_id:entityId,render_id:`${claimId}:cell:${cell}`,territory_state_id:claimId,t_start:start,t_end:end,cell_id:cell,assertion_id:claimId,kind:row.kind,relation:content.relation??'cultural_approximation',status:'uncertain',coverage:membership.coverage,source_edition:content.edition,recorded_from:content.recordedFrom,recorded_to:'',pick_priority:row.kind==='political'?2:1},geometry:{type:'Polygon',coordinates:[[[west,south],[west+.5,south],[west+.5,south+.5],[west,south+.5],[west,south]]]}});
    }
  }
  // Ambiguity is explicit; no competing claim becomes an invisible rank winner.
  const memberships = new Map();
  for (const feature of features) {const key=`${feature.properties.kind}:${feature.properties.cell_id}`;const values=memberships.get(key)??[];values.push(feature);memberships.set(key,values);}
  for (const values of memberships.values()) if (new Set(values.map(f=>f.properties.entity_id)).size > 1) for (const f of values) {f.properties.overlap_count=values.length;f.properties.status=f.properties.kind==='political'?'conflicted':'coexisting cultural presences';const item=evidence[f.properties.territory_state_id];item.assertion_ids=[...new Set([...item.assertion_ids,...values.map(v=>v.properties.assertion_id)])].sort();if (!item.limitations.includes('Some cells overlap other source assertions; no ownership preference is inferred.')) item.limitations.push('Some cells overlap other source assertions; no ownership preference is inferred.');}
  maxFeatures = Math.max(maxFeatures, features.length);
  if (!features.length || features.length > budget.caps.featuresPerArchive) throw Error('Archive feature cap exceeded or no eligible features');
  const tile = geojsonvt({type:'FeatureCollection',features},{maxZoom:0,indexMaxZoom:0,tolerance:0,extent,buffer:0}).getTile(0,0,0);
  if (!tile || tile.features.length !== features.length) throw Error('Tile feature loss');
  const activeEntities = new Set(features.map(f=>f.properties.entity_id));
  const metadata = {schema_version:1,fixture_kind:'historical-candidate',edition:manifest.edition,epoch_id:epoch,t_start:start,t_end:end,name:`British Isles ${label} — STAGED CANDIDATE`,description:'Nominal source snapshot. Immutable-cell interpretation; no public historical publication.',format:'pbf',type:'overlay',bounds:mapping.bbox.join(','),minzoom:0,maxzoom:0,layers,tile:[0,0,0],scene_metadata:{entities:Object.fromEntries(Object.entries(entities).filter(([id])=>activeEntities.has(id))),labels:labels.filter(l=>activeEntities.has(l.entity_id)),evidence},recorded_at:mapping.recordedAt,source,mesh_sha256:meshHash,source_mapping_sha256:sha(mappingBytes),geometry_encoding:{projection:'Web Mercator',extent,tolerance:0,interpolation:false},vector_layers:[{id:'territories',minzoom:0,maxzoom:0,fields:{entity_id:'String',render_id:'String',territory_state_id:'String',t_start:'Number',t_end:'Number',cell_id:'Number'}}]};
  if (Buffer.byteLength(JSON.stringify(metadata)) > budget.caps.metadataBytes) throw Error('Metadata cap exceeded');
  const tilePath = join(build,epoch+'.mvt'), metadataPath = join(build,epoch+'.json'), archivePath = join(out,epoch+'.pmtiles');
  await writeFile(tilePath,fromGeojsonVt({territories:tile},{version:2,extent})); await json(metadataPath,metadata);
  const written = spawnSync(process.env.FIXTURE_PYTHON || join(app,'.sites-runtime/fixture-build/venv/bin/python'),[join(app,'scripts/build-wave-b-pmtiles.py'),tilePath,metadataPath,archivePath],{encoding:'utf8',timeout:budget.worker.deadlineMs,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',TMPDIR:join(build,'tmp')}});
  if (written.error || written.status !== 0) throw Error(written.error?.message || written.stderr || 'PMTiles writer failed');
  const archiveBytes = await readFile(archivePath); totalBytes += archiveBytes.length;
  if (archiveBytes.length > budget.caps.archiveBytes || totalBytes > budget.caps.archiveTotalBytes) throw Error('Archive byte cap exceeded');
  const archive = new PMTiles({getKey:()=>archivePath,getBytes:async(offset,length)=>({data:Uint8Array.from(archiveBytes.subarray(offset,offset+length)).buffer})});
  const header=await archive.getHeader(), decodedMetadata=await archive.getMetadata(), encoded=await archive.getZxy(0,0,0);
  if (header.specVersion!==3 || header.numAddressedTiles!==1 || decodedMetadata.epoch_id!==epoch || !encoded) throw Error('PMTiles round-trip mismatch');
  const decoded=new VectorTile(new Pbf(new Uint8Array(encoded.data))).layers.territories;
  if (decoded.length!==features.length || decoded.extent!==extent) throw Error('MVT feature count mismatch');
  for(let i=0;i<decoded.length;i++) if(JSON.stringify(decoded.feature(i).toGeoJSON(0,0,0).properties)!==JSON.stringify(features[i].properties)) throw Error('MVT identity or source property changed');
  manifest.epochs.push({epoch_id:epoch,t_start:start,t_end:end,url:`./${epoch}.pmtiles`,sha256:sha(archiveBytes),byte_length:archiveBytes.length,layers,tile:[0,0,0]});
  results.push({epoch_id:epoch,label,features:features.length,assertions:claims.length,political:claims.filter(c=>c.kind==='political').length,cultural:claims.filter(c=>c.kind==='cultural').length,bytes:archiveBytes.length,sha256:sha(archiveBytes)});
  peakRssBytes=Math.max(peakRssBytes,process.resourceUsage().maxRSS*1024);
  if(peakRssBytes>budget.caps.workingProcessRssBytes) throw Error('RSS cap exceeded');
  console.log(JSON.stringify(results.at(-1)));
}
if (Buffer.byteLength(JSON.stringify(manifest,null,2))>budget.caps.manifestBytes) throw Error('Manifest cap exceeded');
const expanded=allClaims.reduce((n,c)=>n+c.ranges.reduce((a,r)=>a+r.end-r.start,0),0), unique=[...coverageSets.values()].reduce((a,b)=>a+b,0);
if (allClaims.length!==prior.resources.candidateLedger.regionalAssertions || coverageSets.size!==prior.resources.candidateLedger.regionalCoverageSets || unique!==prior.resources.candidateLedger.regionalMemberships || expanded!==prior.resources.candidateLedger.expandedRegionalMemberships) throw Error('Regenerated assignment counts disagree with original recorded study');
await copyFile(join(root,'data/beta/basemaps/LICENSE'),join(out,'source/LICENSE'));
await copyFile(join(root,'data/beta/basemaps/README.md'),join(out,'source/README.upstream.md'));
await copyFile(join(root,'data/beta/basemaps/rights-record.json'),join(out,'source/rights-record.json'));
await copyFile(join(root,'data/isles/mapping-manifest.json'),join(out,'source/mapping-manifest.json'));
await copyFile(join(root,'data/isles/review-queue.json'),join(out,'source/review-queue.json'));
await json(join(out,'source/claims.json'),allClaims);
const sourceTreeBytes = async dir => (await Promise.all((await readdir(dir,{withFileTypes:true})).map(async entry=>entry.isDirectory()?sourceTreeBytes(join(dir,entry.name)):(await stat(join(dir,entry.name))).size))).reduce((a,b)=>a+b,0);
sourceBytes = await sourceTreeBytes(join(out,'source'));
const added={historicalFeatures:allClaims.length,canonicalAssertions:0,coverageSets:coverageSets.size,uniqueCoverageMemberships:unique,expandedClaimCellMemberships:expanded,retainedInputBytes:0,normalizedInputBytes:sourceBytes,stagingDatabaseIncludingIndexesBytes:0,newCompressedArtifactBytes:totalBytes};
const cumulative=Object.fromEntries(Object.entries(prior.resources.aggregateChecks).map(([key,v])=>[key,{prior:v.used,added:added[key]??0,used:key==='workingProcessRssBytes'?Math.max(v.used,peakRssBytes):v.used+(added[key]??0),limit:v.limit}]));
if(Object.values(cumulative).some(v=>v.used>v.limit) || sourceBytes>budget.caps.retainedDerivativeSourceBytes) throw Error('Existing aggregate budget exceeded');
const inventory={schema_version:1,source,rights,publication:'STAGED — NOT PUBLISHED; exact-result historical publication approval remains required',recovery:'Original archived candidate could not be materialized (HTTP 502). This is a deterministic regeneration using unchanged pinned rasterizer and mapping; original ledger hash identity is not asserted.',prior_candidate_ledger_sha256:prior.ledger.logicalSha256,prior_compiled_release:prior.regionalPack.release,recorded_at:mapping.recordedAt,mesh_sha256:meshHash,mapping_sha256:sha(mappingBytes),license_sha256:sha(await readFile(join(out,'source/LICENSE'))),inputs:inputInventory,compiler_sources:code,exclusions:{named_review:13,unnamed:663,repairs_executed:0,missing_targets:mapping.sourceLimitations,demographics:'No population or migration data'},source_precision:'Nominal calendar-year possible observation envelope retained in each assertion; dates are search bounds, never exact events',immutable_cell_rule:'WGS84 0.5-degree grid; eligible geodesic intersection fraction >=0.5; every positive membership retained in source/claims.json, only eligible cells rendered',population:'unavailable',migration:'unavailable'};
await json(join(out,'source-inventory.json'),inventory); await json(join(out,'manifest.json'),manifest);
await json(join(out,'build-record.json'),{schema_version:1,edition:manifest.edition,budget_sha256:sha(budgetBytes),compiler_sources:code,assertions:allClaims.length,coverage_sets:coverageSets.size,unique_memberships:unique,expanded_memberships:expanded,eligible_render_features:results.reduce((n,r)=>n+r.features,0),maximum_features_per_archive:maxFeatures,archives:results,total_archive_bytes:totalBytes,elapsed_ms:performance.now()-began,raster_worker_ms:workerMs,peak_rss_bytes:peakRssBytes,worker_count:1,unique_raster_jobs:rasterCache.size,cumulative_resources:cumulative,prior_count_comparison:'PASS; 123 assertions / 56 sets / 3918 unique memberships / 7653 expanded memberships',original_archive_identity:'NOT VERIFIED — source derivative regenerated; original candidate not retrievable',public_ledger_changed:false,publication:'STAGED — NOT PUBLISHED',geometry:{authoritative:'immutable 0.5-degree cell grid',mvt_extent:extent,tolerance:0,buffer:0,interpolation:false,coordinate_quantization:'MVT display only; cell_id and source membership remain authoritative'},verification:'Every PMTiles v3 and MVT decoded: exact feature counts and identity/source properties; source hashes and mesh lock verified; original study cardinalities match.'});
console.log(JSON.stringify({archives:results.length,totalBytes,maxFeatures,claims:allClaims.length,unique,expanded,peakRssBytes}));
