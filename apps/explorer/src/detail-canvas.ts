import type { Feature, Geometry } from 'geojson';
import { DETAIL_LIMITS,densityColor,projectDetail,type DetailFrame,type DetailCamera,type DetailPlace } from './detail-context.ts';
import { ReducedMotionPreference, type MotionPreferenceSource } from './reduced-motion.ts';

type Tile={image:HTMLImageElement;ready:boolean;failed:boolean};
type WaterPath={path:Path2D;bbox:[number,number,number,number];kind:string;minzoom:number};
type CityCandidate={place:DetailPlace;x:number;y:number};
function cityRadius(place:DetailPlace):number {
  return place.temporalMode==='historical-city'?place.capital?.length?5.6:place.temporalStatus==='location-reference'?2.4:Math.max(2.8,Math.min(5.7,Math.log10((place.populationEstimate?.value??0)+1)*.86)):place.rank<=2?3:2.3;
}
/** Fixed data projected once; camera changes only apply an affine transform. */
export class DetailCanvas {
  private frame:DetailFrame|null=null;
  private cache=new Map<string,Tile>();
  private pending=0;private disposed=false;private scheduled=false;
  private terrainIdentity='';private terrainZoom:number|null=null;
  private hydroIdentity:unknown;private water:WaterPath[]=[];
  private visiblePlaces:DetailPlace[]=[];
  private cityLabelBounds:{left:number;top:number;right:number;bottom:number}[]=[];
  private placesIdentity:readonly DetailPlace[]|null=null;
  private cityRadii=new Map<string,{from:number;to:number;start:number}>();
  private placeIndexes=new WeakMap<readonly DetailPlace[],ReadonlyMap<string,DetailPlace>>();
  private candidateCache=new WeakMap<readonly DetailPlace[],readonly CityCandidate[]>();
  private appearanceCache=new WeakMap<readonly CityCandidate[],string>();
  private candidateCamera='';private candidateBuilds=0;
  private populationIdentity:unknown;private populationImage:HTMLCanvasElement|null=null;
  private lastCityCount=0;private terrainDrawn=0;private tileErrors=0;private selectedPointVisible=false;
  private readonly motionPreference: ReducedMotionPreference;
  constructor(private invalidate:()=>void, preferenceSource?: MotionPreferenceSource){
    this.motionPreference = new ReducedMotionPreference(preferenceSource);
    this.motionPreference.subscribe(reduced => {
      if (this.disposed || !reduced) return;
      for (const radius of this.cityRadii.values()) radius.from = radius.to;
      // A live OS preference change completes an existing tween immediately.
      this.invalidate();
    });
  }
  setFrame(frame:DetailFrame){
    if(this.disposed)return;
    const terrainIdentity=frame.terrain?JSON.stringify([frame.terrain.tiles,frame.terrain.minzoom,frame.terrain.maxzoom,frame.terrain.tileSize]):'';
    if(terrainIdentity!==this.terrainIdentity){this.clearTiles();this.terrainIdentity=terrainIdentity;}
    if(frame.places!==this.placesIdentity){
      this.placesIdentity=frame.places;const now=performance.now();
      let index=this.placeIndexes.get(frame.places);
      if(!index){index=new Map(frame.places.map(place=>[place.id,place]));this.placeIndexes.set(frame.places,index);}
      // Only painted cities need tween state. A full dated world list can hold
      // thousands of offscreen cities, which never need per-frame radius work.
      for(const id of this.cityRadii.keys()){const place=index.get(id);if(!place)this.cityRadii.delete(id);else this.prepareRadius(place,now);}
    }
    this.frame=frame;
    if(frame.hydro!==this.hydroIdentity){this.hydroIdentity=frame.hydro;this.water=(frame.hydro?.features??[]).map(f=>this.waterPath(f)).filter((p):p is WaterPath=>!!p);}
    if(frame.population!==this.populationIdentity){this.populationIdentity=frame.population;this.populationImage=null;if(frame.population){const data=frame.population,canvas=document.createElement('canvas');canvas.width=data.grid.width;canvas.height=data.grid.height;const ctx=canvas.getContext('2d')!;for(let i=0;i<data.densities.length;i++){ctx.fillStyle=densityColor(data.densities[i]);ctx.fillRect(i%canvas.width,Math.floor(i/canvas.width),1,1);}this.populationImage=canvas;}}
  }
  private requestDraw(){if(this.disposed||this.scheduled)return;this.scheduled=true;requestAnimationFrame(()=>{this.scheduled=false;if(!this.disposed)this.invalidate();});}
  private animatedRadius(id:string,now:number):number {
    const radius=this.cityRadii.get(id);if(!radius)return 3;
    if(this.motionPreference.reduced)return radius.to;
    const progress=Math.min(1,Math.max(0,(now-radius.start)/180));return radius.from+(radius.to-radius.from)*(1-(1-progress)**3);
  }
  private prepareRadius(place:DetailPlace,now:number):void {
    if(place.temporalMode!=='historical-city')return;
    const to=cityRadius(place),previous=this.cityRadii.get(place.id);
    if(!previous||this.motionPreference.reduced)this.cityRadii.set(place.id,{from:to,to,start:now});
    else if(previous.to!==to)this.cityRadii.set(place.id,{from:this.animatedRadius(place.id,now),to,start:now});
    while(this.cityRadii.size>DETAIL_LIMITS.cityLabels*2)this.cityRadii.delete(this.cityRadii.keys().next().value!);
  }
  private candidates(frame:DetailFrame,camera:DetailCamera,width:number,height:number):readonly CityCandidate[]{
    const key=[camera.x,camera.y,camera.scale,width,height,frame.options.cities].join(':');
    if(key!==this.candidateCamera){this.candidateCamera=key;this.candidateCache=new WeakMap();}
    const previous=this.candidateCache.get(frame.places);if(previous)return previous;
    const candidates=frame.places.filter(place=>frame.options.cities||place.temporalMode==='historical-city').map(place=>{
      const[u,v]=projectDetail(place.coordinates);return{place,x:(u+Math.round(camera.x-u)-camera.x)*camera.scale+width/2,y:(v-camera.y)*camera.scale+height/2};
    }).filter(point=>point.x>=-12&&point.x<=width+12&&point.y>=-12&&point.y<=height+12)
      .sort((a,b)=>a.place.rank-b.place.rank||Number(a.place.temporalMode==='modern-context')-Number(b.place.temporalMode==='modern-context')||a.place.id.localeCompare(b.place.id));
    this.candidateCache.set(frame.places,candidates);this.candidateBuilds++;return candidates;
  }
  /** Metadata is already refreshed by setFrame. This compares every city value
   * consumed by drawing, not evidence dates, source IDs or inferred similarity.
   * Full exact strings avoid hash collisions. Other layers are identity-checked.
   */
  canReusePaint(previous:DetailFrame,next:DetailFrame,camera:DetailCamera,width:number,height:number):boolean {
    if(previous.terrain!==next.terrain || previous.hydro!==next.hydro || previous.population!==next.population
      || previous.options!==next.options || previous.selectedPlace!==next.selectedPlace)return false;
    const now=performance.now();
    if(!this.motionPreference.reduced && [...this.cityRadii.values()].some(radius=>radius.from!==radius.to&&now-radius.start<180))return false;
    if(previous.places===next.places)return true;
    const appearance=(frame:DetailFrame)=>{
      const candidates=this.candidates(frame,camera,width,height),cached=this.appearanceCache.get(candidates);
      if(cached!==undefined)return cached;
      const signature=JSON.stringify(candidates.map(({place,x,y})=>[place.id,x,y,place.title,place.rank,place.minZoom,
        place.temporalMode,place.temporalStatus,place.populationRank,place.capital?.length??0,place.populationEstimate?.value]));
      this.appearanceCache.set(candidates,signature);return signature;
    };
    return appearance(previous)===appearance(next);
  }
  private clearTiles(){
    for(const tile of this.cache.values()){tile.image.onload=null;tile.image.onerror=null;tile.image.src='';}
    this.cache.clear();this.pending=0;
  }
  private tile(key:string,url:string):Tile|undefined {
    if(this.disposed)return;
    const hit=this.cache.get(key);if(hit){this.cache.delete(key);this.cache.set(key,hit);return hit;}
    if(this.pending>=DETAIL_LIMITS.rasterRequests)return;
    while(this.cache.size>=DETAIL_LIMITS.rasterTiles){
      const candidate=[...this.cache].find(([,v])=>v.ready||v.failed);if(!candidate)return;
      this.cache.delete(candidate[0]);candidate[1].image.onload=null;candidate[1].image.onerror=null;candidate[1].image.src='';
    }
    const image=new Image(),entry={image,ready:false,failed:false};this.cache.set(key,entry);this.pending++;
    const settle=(ready:boolean)=>{
      // A previously queued event from a replaced/disposed source is harmless.
      if(this.disposed||this.cache.get(key)!==entry||entry.ready||entry.failed)return;
      image.onload=null;image.onerror=null;entry.ready=ready;entry.failed=!ready;this.pending--;
      if(!ready)this.tileErrors++;this.requestDraw();
    };
    image.onload=()=>settle(true);image.onerror=()=>settle(false);image.src=url;return entry;
  }
  drawTerrain(ctx:CanvasRenderingContext2D,camera:DetailCamera,width:number,height:number){
    this.terrainDrawn=0;this.terrainZoom=null;
    const terrain=this.frame?.terrain;if(this.disposed||!terrain||!this.frame?.options.terrain)return;
    const left=camera.x-width/2/camera.scale,right=camera.x+width/2/camera.scale,top=Math.max(0,camera.y-height/2/camera.scale),bottom=Math.min(1,camera.y+height/2/camera.scale);
    if(width<=0||height<=0||top>=bottom)return;
    const range=(zoom:number)=>{const n=2**zoom;return{n,x0:Math.floor(left*n),x1:Math.ceil(right*n)-1,y0:Math.max(0,Math.floor(top*n)),y1:Math.min(n-1,Math.ceil(bottom*n)-1)};};
    let z=Math.max(terrain.minzoom,Math.min(terrain.maxzoom,Math.floor(Math.log2(camera.scale/terrain.tileSize))));
    // A large physical monitor must not cycle more visible tiles than the LRU
    // can hold. Keep room for the coarse fallback and in-flight requests.
    while(z>terrain.minzoom){const r=range(z);if((r.x1-r.x0+1)*(r.y1-r.y0+1)<=DETAIL_LIMITS.rasterTiles-DETAIL_LIMITS.rasterRequests-1)break;z--;}
    this.terrainZoom=z;
    const key=(tz:number,x:number,y:number)=>{const n=2**tz;return`${tz}/${((x%n)+n)%n}/${y}`;};
    const draw=(tz:number,x:number,y:number,tx:number,ty:number,sz:number)=>{
      const id=key(tz,x,y),[zoom,wrap,row]=id.split('/'),url=terrain.tiles.replace('{z}',zoom).replace('{x}',wrap).replace('{y}',row);
      const entry=this.tile(id,url);if(!entry?.ready)return false;
      ctx.drawImage(entry.image,tx,ty,sz+.5,sz+.5);this.terrainDrawn++;return true;
    };
    // Draw the coarse base exactly once per visible base tile. Drawing a whole
    // parent inside the fine loop would paint over neighboring ready fine tiles.
    const base=range(terrain.minzoom),baseSize=camera.scale/base.n;
    for(let x=base.x0;x<=base.x1;x++)for(let y=base.y0;y<=base.y1;y++)draw(terrain.minzoom,x,y,(x/base.n-camera.x)*camera.scale+width/2,(y/base.n-camera.y)*camera.scale+height/2,baseSize);
    if(z===terrain.minzoom)return;
    const fine=range(z),size=camera.scale/fine.n;
    for(let x=fine.x0;x<=fine.x1;x++)for(let y=fine.y0;y<=fine.y1;y++){
      const px=(x/fine.n-camera.x)*camera.scale+width/2,py=(y/fine.n-camera.y)*camera.scale+height/2;
      // Cached intermediate parents fill only this child's rectangle.
      for(let parent=z-1;parent>terrain.minzoom;parent--){
        const div=2**(z-parent),id=key(parent,Math.floor(x/div),Math.floor(y/div)),cached=this.cache.get(id);
        if(!cached?.ready)continue;
        this.cache.delete(id);this.cache.set(id,cached);
        const iw=cached.image.naturalWidth||terrain.tileSize,ih=cached.image.naturalHeight||terrain.tileSize;
        ctx.drawImage(cached.image,((x%div)+div)%div/div*iw,((y%div)+div)%div/div*ih,iw/div,ih/div,px,py,size+.5,size+.5);
        this.terrainDrawn++;break;
      }
      draw(z,x,y,px,py,size);
    }
  }
  private waterPath(feature:Feature<Geometry>):WaterPath|null {
    const geometry=feature.geometry;if(!geometry)return null;const path=new Path2D();let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    const line=(coords:number[][],closed=false)=>{let previous:number|undefined;coords.forEach(p=>{const[x,y]=projectDetail(p);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);if(previous===undefined||Math.abs(x-previous)>.5)path.moveTo(x,y);else path.lineTo(x,y);previous=x;});if(closed)path.closePath();};
    if(geometry.type==='LineString')line(geometry.coordinates);else if(geometry.type==='MultiLineString')geometry.coordinates.forEach(p=>line(p));else if(geometry.type==='Polygon')geometry.coordinates.forEach(p=>line(p,true));else if(geometry.type==='MultiPolygon')geometry.coordinates.forEach(p=>p.forEach(r=>line(r,true)));else return null;
    const props=feature.properties??{};return{path,bbox:[minX,minY,maxX,maxY],kind:String(props.kind??(geometry.type.includes('Polygon')?'lake':'river')),minzoom:Number(props.minzoom??props.min_zoom??1)};
  }
  drawOverlay(ctx:CanvasRenderingContext2D,camera:DetailCamera,width:number,height:number){
    this.cityLabelBounds=[];
    const frame=this.frame;if(!frame)return;const zoom=Math.log2(camera.scale/512),left=camera.x-width/2/camera.scale,right=camera.x+width/2/camera.scale,top=camera.y-height/2/camera.scale,bottom=camera.y+height/2/camera.scale;
    if(frame.options.water){ctx.save();ctx.translate(width/2-camera.x*camera.scale,height/2-camera.y*camera.scale);ctx.scale(camera.scale,camera.scale);ctx.fillStyle='#9fbfc3';ctx.strokeStyle='#638f9f';ctx.lineWidth=(zoom>=4?1:.65)/camera.scale;ctx.globalAlpha=.75;
      for(const w of this.water){if(w.minzoom>zoom+1)continue;for(let shift=Math.floor(left);shift<=Math.floor(right);shift++){const b=w.bbox;if(b[2]+shift<left||b[0]+shift>right||b[3]<top||b[1]>bottom)continue;ctx.save();ctx.translate(shift,0);if(w.kind==='lake')ctx.fill(w.path,'evenodd');else ctx.stroke(w.path);ctx.restore();}}ctx.restore();}
    if(frame.options.density&&frame.population&&this.populationImage){const grid=frame.population.grid;ctx.save();ctx.imageSmoothingEnabled=false;for(let row=0;row<grid.height;row++){const north=grid.north-row*grid.cellDegrees,south=north-grid.cellDegrees;const y1=projectDetail([0,north])[1],y2=projectDetail([0,south])[1];if(y2<top||y1>bottom)continue;for(let copy=Math.floor(left);copy<=Math.floor(right);copy++){ctx.drawImage(this.populationImage,0,row,grid.width,1,(copy-camera.x)*camera.scale+width/2,(y1-camera.y)*camera.scale+height/2,camera.scale,(y2-y1)*camera.scale+.5);}}ctx.restore();}
    this.visiblePlaces=[];this.lastCityCount=0;this.selectedPointVisible=false;
    // Padding is in screen pixels, never a fraction of the zoomed world.
    // Offscreen anchors must not consume the bounded visible label budget.
    const candidates=this.candidates(frame,camera,width,height);
    const boxes:{x:number;y:number;w:number}[]=[];ctx.save();ctx.font='12px system-ui,sans-serif';ctx.textAlign='left';ctx.textBaseline='middle';
    const max=Math.min(DETAIL_LIMITS.cityLabels,Math.max(12,Math.floor(width*height/10000)));
    // This is retained point selection, independent of whether a dated city
    // representation exists or the general city-label layer is enabled.
    let selected:{x:number;y:number;labelX:number;labelY:number;text:string;width:number;reference:boolean}|null=null;
    if(frame.selectedPlace){
      const[u,v]=projectDetail(frame.selectedPlace.coordinates),x=(u+Math.round(camera.x-u)-camera.x)*camera.scale+width/2,y=(v-camera.y)*camera.scale+height/2;
      if(x>=-8&&x<=width+8&&y>=-8&&y<=height+8){
        const reference=frame.selectedPlace.temporalStatus==='outside-evidence';
        const text=reference?`${frame.selectedPlace.title} · selected location`:frame.selectedPlace.temporalMode==='historical-city'?frame.selectedPlace.title:`${frame.selectedPlace.title} · selected point`,labelWidth=Math.min(ctx.measureText(text).width,Math.max(1,width-16));
        const labelX=Math.max(8,Math.min(x+13,width-labelWidth-8)),labelY=Math.max(11,Math.min(y,height-11));
        selected={x,y,labelX,labelY,text,width:labelWidth,reference};
        const boxX=Math.min(x-10,labelX-4);boxes.push({x:boxX,y:labelY,w:Math.max(x+10,labelX+labelWidth+4)-boxX});
      }
    }
    for(const candidate of candidates){const p=candidate.place;if(p.id===frame.selectedPlace?.id)continue;const minzoom=Number.isFinite(p.minZoom)?p.minZoom!:(p.temporalMode==='modern-context'?Math.max(1.3,Math.min(6,p.rank*.65)):Math.max(1.3,Math.min(5,p.rank*.55)));if(zoom<minzoom)continue;
      const{x,y}=candidate,historical=p.temporalMode==='historical-city',capital=!!p.capital?.length,reference=p.temporalStatus==='location-reference';
      ctx.font=historical&&((p.populationRank??Infinity)<=12||capital)?'600 12px system-ui,sans-serif':'12px system-ui,sans-serif';
      const w=ctx.measureText(p.title).width+8;
      const placements=[{x:x+9,y},{x:x-w-8,y},{x:x-w/2,y:y-15},{x:x-w/2,y:y+15}];
      const label=placements.find(position=>position.x>=3&&position.x+w<width-3&&position.y>=10&&position.y<height-10&&!boxes.some(b=>Math.abs(position.y-b.y)<19&&position.x<b.x+b.w+3&&position.x+w+3>b.x));
      if(!label)continue;boxes.push({x:label.x,y:label.y,w});this.visiblePlaces.push(p);
      const now=performance.now();this.prepareRadius(p,now);const radius=historical?this.animatedRadius(p.id,now):cityRadius(p),animation=this.cityRadii.get(p.id);
      if(!this.motionPreference.reduced&&animation&&animation.from!==animation.to&&now-animation.start<180)this.requestDraw();
      this.cityLabelBounds.push({left:label.x,top:label.y-10,right:label.x+w+5,bottom:label.y+10},{left:x-radius-3,top:y-radius-3,right:x+radius+3,bottom:y+radius+3});
      ctx.beginPath();
      if(capital){for(let point=0;point<10;point++){const angle=-Math.PI/2+point*Math.PI/5,r=point%2?radius*.45:radius;const px=x+Math.cos(angle)*r,py=y+Math.sin(angle)*r;if(point===0)ctx.moveTo(px,py);else ctx.lineTo(px,py);}ctx.closePath();}
      else ctx.arc(x,y,radius,0,Math.PI*2);
      ctx.fillStyle=reference?'#fbf7e9':capital?'#f9dc8a':p.temporalMode==='modern-context'?'#faf6e8':'#edc77c';ctx.fill();ctx.lineWidth=historical?1.6:1.25;ctx.strokeStyle=reference?'#637b70':'#25483f';ctx.stroke();
      ctx.lineWidth=3.8;ctx.strokeStyle='#fffbeae8';ctx.strokeText(p.title,label.x+4,label.y);ctx.fillStyle=reference?'#5c7066':'#203d35';ctx.fillText(p.title,label.x+4,label.y);if(boxes.length>=max)break;
    }
    if(selected){
      const{x,y,labelX,labelY,text,width:labelWidth,reference}=selected;
      this.cityLabelBounds.push({left:labelX-3,top:labelY-11,right:labelX+labelWidth+3,bottom:labelY+11},{left:x-11,top:y-11,right:x+11,bottom:y+11});
      ctx.beginPath();ctx.arc(x,y,7,0,Math.PI*2);ctx.lineWidth=4;ctx.strokeStyle='#fffbea';ctx.stroke();ctx.lineWidth=1.8;ctx.strokeStyle=reference?'#7f8d84':'#173f36';ctx.stroke();
      ctx.beginPath();ctx.arc(x,y,3,0,Math.PI*2);ctx.fillStyle=reference?'#fffbeae8':'#e0b35d';ctx.fill();if(reference){ctx.lineWidth=1;ctx.stroke();}
      ctx.lineWidth=4;ctx.strokeStyle='#fffbeaf2';ctx.strokeText(text,labelX,labelY,labelWidth);ctx.fillStyle=reference?'#68796d':'#173f36';ctx.fillText(text,labelX,labelY,labelWidth);
      this.selectedPointVisible=true;
    }
    ctx.restore();this.lastCityCount=this.visiblePlaces.length;
  }
  /** Screen-space reservations shared with the polity label renderer. Cities win collisions. */
  overlapsCityLabel(x:number,y:number,width:number,height=32):boolean {
    const left=x-width/2,right=x+width/2,top=y-height/2,bottom=y+height/2;
    return this.cityLabelBounds.some(box=>left<box.right&&right>box.left&&top<box.bottom&&bottom>box.top);
  }
  getDiagnostics(){return{rasterCache:this.cache.size,rasterPending:this.pending,rasterTilesDrawn:this.terrainDrawn,rasterErrors:this.tileErrors,terrainZoom:this.terrainZoom,waterPaths:this.water.length,visibleCityLabels:this.lastCityCount,selectedPointVisible:this.selectedPointVisible,populationYear:this.frame?.population?.year??null,reducedMotion:this.motionPreference.reduced,activeCityTweens:this.motionPreference.reduced?0:[...this.cityRadii.values()].filter(radius=>radius.from!==radius.to&&performance.now()-radius.start<180).length,trackedCityRadii:this.cityRadii.size,candidateProjectionBuilds:this.candidateBuilds,limits:DETAIL_LIMITS};}
  destroy(){this.disposed=true;this.motionPreference.dispose();this.clearTiles();this.water=[];this.populationImage=null;this.frame=null;this.visiblePlaces=[];this.cityRadii.clear();this.placeIndexes=new WeakMap();this.candidateCache=new WeakMap();this.appearanceCache=new WeakMap();this.placesIdentity=null;this.cityLabelBounds=[];}
}
