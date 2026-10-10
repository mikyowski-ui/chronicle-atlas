import { sha256 } from '@noble/hashes/sha2.js';
import type { AlphaManifest } from '../../../packages/contracts/src/index.ts';
import { createAlphaLoader, validateAlphaManifest } from './alpha.ts';
import { boundedResponse, type SceneData } from './temporal.ts';
import type { DisplayPolicy, DisplayTrack } from './display-policy.ts';

export const CATALOG_LIMITS = Object.freeze({ bytes: 98_304, observations: 64, manifestBytes: 65_536, manifests: 4, scenes: 2, neighborConcurrency: 2 });
export interface ObservationCoverage {
  source_features: number; political: number; cultural: number; context: number;
  review: number; quarantine: number; excluded: number;
  admitted_parts: number; admitted_entities: number;
  [key: string]: unknown;
}
export interface GlobalObservation {
  observation_id: string; year: number; source_filename: string; source_sha256: string;
  t_start: number; t_end: number; manifest: string; manifest_sha256: string; manifest_bytes: number;
  edition: string; source_precision: string; coverage: ObservationCoverage; status: 'compiled';
}
export interface GlobalCatalog {
  schema_version: 2; catalog_id: string; publication: 'staged-candidate-only';
  observations: readonly GlobalObservation[]; failures: readonly unknown[];
  [key: string]: unknown;
}
const digest = (bytes: Uint8Array) => Array.from(sha256(bytes), b=>b.toString(16).padStart(2,'0')).join('');
const hash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const object = (value: unknown): value is Record<string,unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function localURL(value: unknown, base: string): string {
  if (typeof value !== 'string' || !value || value.length > 1024) throw Error('Invalid catalog URL.');
  const url = new URL(value, base);
  if (url.origin !== new URL(base).origin || !['http:','https:'].includes(url.protocol) || url.username || url.password) throw Error('Catalog assets must use the same origin.');
  return url.href;
}
export function validateGlobalCatalog(input: unknown, base: string): GlobalCatalog {
  if (!object(input) || input.schema_version !== 2 || typeof input.catalog_id !== 'string' || input.publication !== 'staged-candidate-only' || !Array.isArray(input.observations) || !input.observations.length || input.observations.length > CATALOG_LIMITS.observations || !Array.isArray(input.failures) || input.failures.length > CATALOG_LIMITS.observations) throw Error('Invalid bounded global catalog.');
  const ids = new Set<string>();
  const observations = input.observations.map(value => {
    if (!object(value) || typeof value.observation_id !== 'string' || ids.has(value.observation_id) || value.status !== 'compiled' || typeof value.edition !== 'string' || !Number.isSafeInteger(value.year) || value.year === 0 || !Number.isSafeInteger(value.t_start) || !Number.isSafeInteger(value.t_end) || Number(value.t_start) >= Number(value.t_end) || !hash(value.source_sha256) || !hash(value.manifest_sha256) || !Number.isSafeInteger(value.manifest_bytes) || Number(value.manifest_bytes) < 1 || Number(value.manifest_bytes) > CATALOG_LIMITS.manifestBytes || typeof value.source_filename !== 'string' || value.source_precision !== 'year' || !object(value.coverage)) throw Error('Invalid global observation descriptor.');
    for (const key of ['source_features','political','cultural','context','review','quarantine','excluded','admitted_parts','admitted_entities']) if (!Number.isSafeInteger(value.coverage[key]) || Number(value.coverage[key]) < 0) throw Error('Invalid global observation accounting.');
    if (['political','cultural','context','review','quarantine','excluded'].reduce((n,key)=>n+Number((value.coverage as Record<string,unknown>)[key]),0) !== value.coverage.source_features) throw Error('Every source feature needs exactly one outcome.');
    const year = Number(value.year), start = new Date(0), end = new Date(0);
    start.setUTCFullYear(year < 0 ? year + 1 : year, 0, 1); end.setUTCFullYear(start.getUTCFullYear()+1,0,1);
    if (start.getTime()/86400000 !== value.t_start || end.getTime()/86400000 !== value.t_end) throw Error('Catalog year differs from the canonical observation interval.');
    ids.add(value.observation_id);
    return Object.freeze({...value, manifest:localURL(value.manifest,base), coverage:Object.freeze({...value.coverage})}) as unknown as GlobalObservation;
  }).sort((a,b)=>a.t_start-b.t_start);
  for(let i=1;i<observations.length;i++) if(observations[i].t_start<observations[i-1].t_end) throw Error('Global observations overlap.');
  return Object.freeze({...input, observations:Object.freeze(observations)}) as unknown as GlobalCatalog;
}
export async function fetchGlobalCatalog(url: string, signal: AbortSignal): Promise<GlobalCatalog> {
  const response = await fetch(url,{signal});
  const bytes = await boundedResponse(response,CATALOG_LIMITS.bytes,signal);
  return validateGlobalCatalog(JSON.parse(new TextDecoder().decode(bytes)),response.url||url);
}
/** Synchronous semantic resolution; no source geometry or manifest fetching. */
export function resolveGlobalObservation(catalog: GlobalCatalog, time: number, policy: DisplayPolicy): GlobalObservation | undefined {
  if (!Number.isSafeInteger(time)) throw Error('Catalog resolution requires an integer day.');
  return catalog.observations.find(o=>o.t_start<=time&&time<o.t_end)
    ?? (policy==='reference' ? [...catalog.observations].reverse().find(o=>o.t_start<=time) : undefined);
}

/** Four small manifest records and two shared scene payloads, irrespective of date count. */
export class GlobalCatalogStore {
  private tracks = new Map<string,DisplayTrack>();
  private prefetchController?: AbortController;
  private prefetchTail: Promise<unknown> = Promise.resolve();
  private fetchedManifestBytes = 0;
  private manifestFetches = 0;
  private hits = 0;
  constructor(readonly catalog: GlobalCatalog, private canvas: boolean, readonly scenes = new Map<string,SceneData>(), private fetcher: typeof fetch = fetch) {}
  peek(observation: GlobalObservation): DisplayTrack | undefined { return this.tracks.get(observation.observation_id); }
  async track(observation: GlobalObservation, signal: AbortSignal): Promise<DisplayTrack> {
    signal.throwIfAborted();
    const cached = this.tracks.get(observation.observation_id);
    if(cached){this.hits++;this.tracks.delete(observation.observation_id);this.tracks.set(observation.observation_id,cached);return cached;}
    const fetcher=this.fetcher;
    const response=await fetcher(observation.manifest,{signal});
    const bytes=await boundedResponse(response,observation.manifest_bytes,signal);
    if(bytes.byteLength!==observation.manifest_bytes||digest(new Uint8Array(bytes))!==observation.manifest_sha256)throw Error('Global shard manifest identity mismatch.');
    signal.throwIfAborted();
    const manifest:AlphaManifest=validateAlphaManifest(JSON.parse(new TextDecoder().decode(bytes)),observation.manifest);
    if(manifest.edition!==observation.edition||manifest.epochs.length!==1||manifest.epochs[0].t_start!==observation.t_start||manifest.epochs[0].t_end!==observation.t_end)throw Error('Global shard differs from the selected observation.');
    const track={id:'world:'+observation.observation_id,manifest,loader:createAlphaLoader(manifest,observation.manifest,this.canvas,this.fetcher,this.scenes)};
    this.manifestFetches++;this.fetchedManifestBytes+=bytes.byteLength;
    this.tracks.set(observation.observation_id,track);
    while(this.tracks.size>CATALOG_LIMITS.manifests)this.tracks.delete(this.tracks.keys().next().value!);
    return track;
  }
  async neighbors(observation: GlobalObservation):Promise<DisplayTrack[]> {
    this.prefetchController?.abort();const controller=this.prefetchController=new AbortController();
    const index=this.catalog.observations.indexOf(observation);
    const neighbors=[this.catalog.observations[index-1],this.catalog.observations[index+1]].filter((v):v is GlobalObservation=>!!v);
    const work=this.prefetchTail.then(async()=>{
      if(controller.signal.aborted)return [];
      const outcomes=await Promise.allSettled(neighbors.map(o=>this.track(o,controller.signal)));
      return controller.signal.aborted?[]:outcomes.flatMap(r=>r.status==='fulfilled'?[r.value]:[]);
    });
    this.prefetchTail=work.catch(()=>undefined);
    return work;
  }
  diagnostics(){return {manifestEntries:this.tracks.size,sceneEntries:this.scenes.size,manifestFetches:this.manifestFetches,manifestHits:this.hits,manifestBytesFetched:this.fetchedManifestBytes,limits:CATALOG_LIMITS,sceneCacheKeys:[...this.scenes.keys()].map(key=>key.slice(0,180))};}
  dispose(){this.prefetchController?.abort();this.tracks.clear();this.scenes.clear();}
}
