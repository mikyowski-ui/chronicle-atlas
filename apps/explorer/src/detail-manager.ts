import { sha256 as digestSHA256 } from '@noble/hashes/sha2.js';
import { activePlaces,boundedJSON,precedingPopulation,type DetailFrame,type DetailOptions,type DetailPlace,type PopulationGrid } from './detail-context.ts';
import { CITY_HISTORY_LIMITS,combineCityHistory,emptyCapitals,emptyCities,historicalPlaces,mergeHistoricalPlaces,parseHistoricalCapitals,parseHistoricalCities,retainedHistoricalPlace,type HistoricalCapitals,type HistoricalCities } from './historical-cities.ts';

export interface PopulationObservation {year:number;url:string;sha256:string;byte_length:number;edition:string}
interface VerifiedAsset {byte_length:number;sha256:string;compression?:string;decoded_bytes?:number;decoded_sha256?:string}
interface PopulationDelivery {key:string;controller:AbortController;promise:Promise<void>}
const POPULATION_BYTES=2*1024*1024;
const SHA256=/^[a-f0-9]{64}$/;

function assetURL(path:string,base:string):string {
  const url=new URL(path,base);
  if(url.origin!==new URL(base).origin||!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('Detail asset must stay on its application origin');
  return url.href.replace(/%7B([zxy])%7D/gi,(_,axis:string)=>`{${axis.toLowerCase()}}`);
}
async function readBounded(stream:ReadableStream<Uint8Array>,max:number,signal:AbortSignal):Promise<Uint8Array> {
  const reader=stream.getReader(),chunks:Uint8Array[]=[];let total=0;
  try{
    while(true){signal.throwIfAborted();const item=await reader.read();if(item.done)break;total+=item.value.length;if(total>max)throw Error('Detail asset exceeds bounded input');chunks.push(item.value);}
  }catch(error){await reader.cancel().catch(()=>{});throw error;}
  finally{reader.releaseLock();}
  signal.throwIfAborted();const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
async function verifyBytes(bytes:Uint8Array,expectedBytes:number,sha256:string,signal:AbortSignal){
  if(bytes.length!==expectedBytes)throw Error('Detail asset size mismatch');
  const hash=Array.from(digestSHA256(bytes),v=>v.toString(16).padStart(2,'0')).join('');
  signal.throwIfAborted();if(hash!==sha256)throw Error('Detail asset hash mismatch');
}
async function verifiedJSON(url:string,max:number,signal:AbortSignal,asset:VerifiedAsset):Promise<any>{
  if(!Number.isSafeInteger(asset.byte_length)||asset.byte_length<1||asset.byte_length>max||!SHA256.test(asset.sha256))throw Error('Invalid detail asset descriptor');
  if(asset.compression&&(asset.compression!=='gzip'||!Number.isSafeInteger(asset.decoded_bytes)||asset.decoded_bytes!<1||asset.decoded_bytes!>16*1024*1024||!SHA256.test(asset.decoded_sha256??'')))throw Error('Invalid compressed detail asset descriptor');
  signal.throwIfAborted();const response=await fetch(url,{signal});if(!response.ok||!response.body)throw Error('Detail asset unavailable');
  // Fetch may already decode a Content-Encoding:gzip response (as Vite does).
  // Either representation remains bounded and must match its recorded hash.
  let bytes=await readBounded(response.body,asset.compression?Math.max(asset.byte_length,asset.decoded_bytes!):asset.byte_length,signal);
  if(asset.compression){
    if(bytes[0]===0x1f&&bytes[1]===0x8b){
      await verifyBytes(bytes,asset.byte_length,asset.sha256,signal);
      const decoded=new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('gzip'));
      bytes=await readBounded(decoded,asset.decoded_bytes!,signal);
    }
    await verifyBytes(bytes,asset.decoded_bytes!,asset.decoded_sha256!,signal);
  }else await verifyBytes(bytes,asset.byte_length,asset.sha256,signal);
  signal.throwIfAborted();return JSON.parse(new TextDecoder().decode(bytes));
}
function observationKey(observation:PopulationObservation){return `${observation.edition}:${observation.year}:${observation.sha256}`;}
function populationGrid(value:any,observation:PopulationObservation):PopulationGrid {
  const grid=value?.grid,cells=grid?.width*grid?.height;
  if(!value||value.year!==observation.year||value.edition!==observation.edition||!Number.isSafeInteger(cells)||cells<1||cells>20000||grid.width!==180||grid.height!==90||grid.west!==-180||grid.north!==90||grid.cellDegrees!==2||!Array.isArray(value.counts)||!Array.isArray(value.densities)||!Array.isArray(value.knownSourceCells)||value.counts.length!==cells||value.densities.length!==cells||value.knownSourceCells.length!==cells)throw Error('Population grid validation failed');
  for(let i=0;i<cells;i++){
    const count=value.counts[i],density=value.densities[i],known=value.knownSourceCells[i];
    if(!Number.isInteger(known)||known<0||known>16||(count===null)!==(known===0)||(density===null)!==(known===0)||(count!==null&&(!Number.isFinite(count)||count<0))||(density!==null&&(!Number.isFinite(density)||density<0)))throw Error('Population values or missing-data mask invalid');
  }
  return value as PopulationGrid;
}

export class DetailManager {
  frame:DetailFrame={terrain:null,hydro:null,places:[],population:null,options:{terrain:true,water:true,cities:true,density:false,modernCities:false},requestedYear:1600,populationLabel:'Population layer off'};
  private allPlaces:DetailPlace[]=[]; sources:any[]=[]; observations:PopulationObservation[]=[];
  private cityHistory:HistoricalCities=emptyCities();private capitalHistory:HistoricalCapitals=emptyCapitals();
  private combinedCities:HistoricalCities=emptyCities();private cityHistoryReady=false;private capitalHistoryReady=false;
  private serial=0;private cache=new Map<string,PopulationGrid>();private populationTarget:number|null=null;
  private populationDelivery?:PopulationDelivery;private populationDisplayedKey:string|null=null;
  private populationIndexReady=false;private populationIndexFailed=false;private destroyed=false;
  populationChoice='follow'; status='Loading physical context'; private lastPlacesKey='';
  private readonly placeCache = new Map<string, readonly DetailPlace[]>();
  private placeBuilds = 0;
  private placeCacheHits = 0;
  constructor(private change:(frame:DetailFrame)=>void,private base=new URL('./detail/',location.href).href){}
  async load(signal:AbortSignal){
    if(this.destroyed||signal.aborted)return;
    signal.addEventListener('abort',()=>this.destroy(),{once:true});
    await Promise.allSettled([
      (async()=>{
        const url=assetURL('terrain.json',this.base),d=await boundedJSON(url,100000,signal);if(this.destroyed||signal.aborted)return;
        this.frame.terrain={...d.raster,tiles:assetURL(d.raster.tiles[0],url),tileSize:d.raster.tile_size,minzoom:d.raster.minzoom,maxzoom:d.raster.maxzoom};this.emit();
        const h=d.hydrography,hydro=await verifiedJSON(assetURL(h.url,url),16*1024*1024,signal,h);
        if(hydro?.type!=='FeatureCollection'||!Array.isArray(hydro.features)||hydro.features.length!==h.features||hydro.features.length>5000)throw Error('Hydrography feature limit or count mismatch');
        if(this.destroyed||signal.aborted)return;this.frame.hydro=hydro;this.emit();
      })().catch(e=>{if(!signal.aborted&&!this.destroyed){this.status='Terrain or waterways unavailable; neutral land retained';console.warn('[Chronicle detail]',e);this.emit();}}),
      (async()=>{
        const receipt=await boundedJSON(assetURL('places-receipt.json',this.base),100000,signal),output=receipt.output;
        if(output?.path!=='places.json')throw Error('Unexpected places product');
        const p=await verifiedJSON(assetURL('places.json',this.base),8*1024*1024,signal,{byte_length:output.bytes,sha256:output.sha256});
        if(!Array.isArray(p.places)||p.places.length>20000||!Array.isArray(p.sources))throw Error('Places limit exceeded');
        if(this.destroyed||signal.aborted)return;this.allPlaces=p.places;this.sources=p.sources;this.lastPlacesKey='';this.placeCache.clear();this.refreshPlaces();this.emit();
      })().catch(e=>{if(!signal.aborted&&!this.destroyed){this.status='Cities unavailable';console.warn('[Chronicle detail]',e);this.emit();}}),
      (async()=>{
        const p=parseHistoricalCities(await boundedJSON(assetURL('../history/cities.json',this.base),CITY_HISTORY_LIMITS.bytes,signal));
        if(this.destroyed||signal.aborted)return;this.cityHistory=p;this.cityHistoryReady=true;this.refreshCityHistory();
      })().catch(e=>{if(!signal.aborted&&!this.destroyed){console.warn('[Chronicle city history]',e);this.emit();}}),
      (async()=>{
        const p=parseHistoricalCapitals(await boundedJSON(assetURL('../history/capitals.json',this.base),CITY_HISTORY_LIMITS.capitalBytes,signal));
        if(this.destroyed||signal.aborted)return;this.capitalHistory=p;this.capitalHistoryReady=true;this.refreshCityHistory();
      })().catch(e=>{if(!signal.aborted&&!this.destroyed){console.warn('[Chronicle capital history]',e);this.emit();}}),
      (async()=>{
        const p=await boundedJSON(assetURL('population.json',this.base),100000,signal);
        if(!Array.isArray(p.observations)||p.observations.length>16)throw Error('Population index limit');
        const seen=new Set<number>();
        const observations=p.observations.map((o:PopulationObservation)=>{
          if(!Number.isSafeInteger(o.year)||seen.has(o.year)||typeof o.edition!=='string'||!o.edition||!SHA256.test(o.sha256)||!Number.isSafeInteger(o.byte_length)||o.byte_length<1||o.byte_length>POPULATION_BYTES)throw Error('Invalid population observation descriptor');
          seen.add(o.year);return{...o,url:assetURL(o.url,assetURL('population.json',this.base))};
        });
        if(this.destroyed||signal.aborted)return;this.observations=observations;this.populationIndexReady=true;this.emit();
        // The user can enable/pin population before the index arrives.
        await this.resolvePopulation();
      })().catch(e=>{if(!signal.aborted&&!this.destroyed){this.populationIndexFailed=true;void this.resolvePopulation();console.warn('[Chronicle population]',e);}}),
    ]);
    if(this.destroyed||signal.aborted)return;
    this.status=this.frame.terrain?'Natural Earth relief & waterways · modern physical context':this.status;this.emit();
  }
  setTime(year:number){if(this.destroyed||this.frame.requestedYear===year)return;this.frame.requestedYear=year;this.refreshPlaces();this.emit();void this.resolvePopulation();}
  setOptions(options:Partial<DetailOptions>){if(this.destroyed)return;this.frame.options={...this.frame.options,...options,cities:true};this.refreshPlaces();this.emit();void this.resolvePopulation();}
  setPopulationYear(choice:string){if(this.destroyed)return;this.populationChoice=choice;void this.resolvePopulation();}
  private refreshCityHistory(){this.combinedCities=combineCityHistory(this.cityHistory,this.capitalHistory);this.lastPlacesKey='';this.placeCache.clear();this.refreshPlaces();this.emit();}
  private refreshPlaces(){
    const key=this.frame.requestedYear+':'+this.frame.options.modernCities;if(key===this.lastPlacesKey)return;this.lastPlacesKey=key;
    const cached=this.placeCache.get(key);
    if(cached){this.placeCache.delete(key);this.placeCache.set(key,cached);this.frame.places=cached;this.placeCacheHits++;return;}
    this.frame.places=mergeHistoricalPlaces(historicalPlaces(this.combinedCities,this.frame.requestedYear),activePlaces(this.allPlaces,this.frame.requestedYear,this.frame.options.modernCities));
    this.placeBuilds++;this.placeCache.set(key,this.frame.places);
    // Two complete dated views, independent of scrub range. A source arrival
    // invalidates both. Each retained object still describes its own exact year.
    while(this.placeCache.size>2)this.placeCache.delete(this.placeCache.keys().next().value!);
  }
  private cancelPopulation(){this.serial++;this.populationDelivery?.controller.abort();this.populationDelivery=undefined;}
  private populationLabel(observation:PopulationObservation){const mode=this.populationChoice==='follow'?(this.frame.requestedYear===observation.year?'observation':'dated reference'):'pinned comparison';return `Population ${observation.year} · ${mode} · modeled · people / km² · 2° cells`;}
  async resolvePopulation():Promise<void>{
    if(this.destroyed)return;
    if(!this.frame.options.density){this.cancelPopulation();this.populationTarget=null;this.frame.populationLabel='Population layer off';this.emit();return;}
    if(!this.populationIndexReady){this.frame.populationLabel=this.populationIndexFailed?'Population observations unavailable':'Loading population observations';this.emit();return;}
    const observation=this.populationChoice==='follow'?precedingPopulation(this.observations,this.frame.requestedYear):this.observations.find(o=>o.year===Number(this.populationChoice));
    if(!observation){
      this.cancelPopulation();this.populationTarget=null;this.populationDisplayedKey=null;this.frame.population=null;
      this.frame.populationLabel=this.populationChoice==='follow'?'No population grid before 1910. Choose a separate population year to compare.':'Selected population observation unavailable';this.emit();return;
    }
    const key=observationKey(observation);this.populationTarget=observation.year;
    // Many cursor dates share the same observation. Keep that request alive.
    if(this.populationDelivery?.key===key){return this.populationDelivery.promise;}
    if(this.populationDisplayedKey===key&&this.frame.population){this.cancelPopulation();this.frame.populationLabel=this.populationLabel(observation);this.emit();return;}
    this.cancelPopulation();const serial=this.serial,controller=new AbortController();
    this.frame.populationLabel=`Loading population ${observation.year}${this.frame.population?` · showing population ${this.frame.population.year}`:''}`;this.emit();
    const promise=(async()=>{
      // Install the in-flight record before either cached or fetched completion.
      await Promise.resolve();
      try{
        let grid=this.cache.get(key);
        if(!grid)grid=populationGrid(await verifiedJSON(observation.url,POPULATION_BYTES,controller.signal,observation),observation);
        if(this.destroyed||controller.signal.aborted||serial!==this.serial)return;
        this.cache.delete(key);this.cache.set(key,grid);while(this.cache.size>2)this.cache.delete(this.cache.keys().next().value!);
        this.frame.population=grid;this.populationDisplayedKey=key;this.frame.populationLabel=this.populationLabel(observation);this.emit();
      }catch(e){
        if(this.destroyed||serial!==this.serial||controller.signal.aborted)return;
        this.frame.populationLabel=`Population delivery unavailable${this.frame.population?` · showing ${this.frame.population.year}`:''}`;this.emit();console.warn('[Chronicle population]',e);
      }finally{if(this.populationDelivery?.controller===controller)this.populationDelivery=undefined;}
    })();
    this.populationDelivery={key,controller,promise};await promise;
  }
  getPlace(id:string){return this.frame.places.find(p=>p.id===id)??retainedHistoricalPlace(this.combinedCities,id,this.frame.requestedYear)??this.allPlaces.find(p=>p.id===id);}
  search(query:string){return this.frame.places.filter(p=>p.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0,8);}
  private emit(){if(this.destroyed)return;this.frame={...this.frame};this.change(this.frame);}
  diagnostics(){return{status:this.status,places:this.allPlaces.length,activePlaces:this.frame.places.length,historicalCities:this.cityHistory.cities.length,capitalLocations:this.capitalHistory.capitals.length,cityHistoryReady:this.cityHistoryReady,capitalHistoryReady:this.capitalHistoryReady,requestedYear:this.frame.requestedYear,options:this.frame.options,populationChoice:this.populationChoice,populationTarget:this.populationTarget,populationDisplayed:this.frame.population?.year??null,populationCache:this.cache.size,populationInFlight:this.populationDelivery?.key??null,populationIndexReady:this.populationIndexReady,placeCacheEntries:this.placeCache.size,placeCacheLimit:2,placeBuilds:this.placeBuilds,placeCacheHits:this.placeCacheHits};}
  destroy(){this.destroyed=true;this.cancelPopulation();this.cache.clear();this.placeCache.clear();}
}
