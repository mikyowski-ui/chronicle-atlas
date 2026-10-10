import clipping, {type MultiPolygon as ClipMulti,type Polygon as ClipPoly,type Pair} from 'polygon-clipping';
import proj4 from 'proj4';
import {feature} from 'topojson-client';
import type {Topology} from 'topojson-specification';
import type {Feature,FeatureCollection,Polygon,MultiPolygon,Geometry} from 'geojson';
// JSTS performs topology validation before clipping, not silent repair.
import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader.js';
import IsValidOp from 'jsts/org/locationtech/jts/operation/valid/IsValidOp.js';
import geographic from 'geographiclib-geodesic';
export interface Assignment {cellId:number;coverage:number;eligible:boolean;method:'interior'|'intersection';}
export interface RasterReport {candidateCells:number;interiorAssignments:number;boundaryCells:number;ambiguousCells:number;smallComponents:number;assignments:number;}
export interface RasterResult {assignments:Assignment[];report:RasterReport;unrepresentedComponents:number[];}
const W=720,H=360,STEP=.5;
export function features(input:unknown):Feature<Polygon|MultiPolygon>[] {
 let data=input as FeatureCollection|Feature|Topology|Geometry;
 if(data.type==='Topology'){
  const top=data as Topology;
  const all=Object.keys(top.objects).sort().flatMap(k=>{const f=feature(top,top.objects[k]);return f.type==='FeatureCollection'?f.features:[f];});
  data={type:'FeatureCollection',features:all};
 }
 const fs=data.type==='FeatureCollection'?data.features:data.type==='Feature'?[data]:[{type:'Feature',properties:{},geometry:data}];
 return fs.map(f=>{if(!f.geometry||!['Polygon','MultiPolygon'].includes(f.geometry.type))throw new Error('Only Polygon and MultiPolygon are accepted');return f as Feature<Polygon|MultiPolygon>;});
}
export function inputCRS(input:unknown,explicit?:string){
 const declared=(input as {crs?:{properties?:{name?:string}}}).crs?.properties?.name;
 const normalize=(s:string)=>/CRS84$|EPSG(?::|::|\/0\/)4326$/i.test(s)?'EPSG:4326':/EPSG(?::|::|\/0\/)3857$/i.test(s)?'EPSG:3857':s;
 if(explicit&&declared&&normalize(explicit)!==normalize(declared))throw new Error('Explicit CRS conflicts with input CRS');
 const crs=normalize(explicit??declared??'EPSG:4326');
 if(!proj4.defs(crs)&&!crs.startsWith('+proj='))throw new Error(`Unknown CRS: ${crs}`);
 return crs;
}
export function normalizeGeometry(geometry:Polygon|MultiPolygon,crs='EPSG:4326'):ClipMulti{
 const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
 const pieces:ClipMulti=[];
 for(const raw of polygons){
  if(!raw.length)throw new Error('Empty polygon');
  const rings:ClipPoly=raw.map((ring,ri)=>{
   if(ring.length<4)throw new Error('A ring needs at least four positions');
   const converted=ring.map(p=>{
    if(p.length<2||!p.slice(0,2).every(Number.isFinite))throw new Error('Invalid coordinate');
    const q=crs==='EPSG:4326'?p.slice(0,2):proj4(crs,'EPSG:4326',p.slice(0,2));
    if(!q.every(Number.isFinite)||q[1]<-90||q[1]>90||Math.abs(q[0])>180.0000001)throw new Error('Coordinate outside WGS84 domain');
    return [Math.max(-180,Math.min(180,q[0])),q[1]] as Pair;
   });
   if(converted[0][0]!==converted.at(-1)![0]||converted[0][1]!==converted.at(-1)![1])throw new Error('Unclosed ring');
   for(let i=1;i<converted.length;i++){while(converted[i][0]-converted[i-1][0]>180)converted[i][0]-=360;while(converted[i][0]-converted[i-1][0]<-180)converted[i][0]+=360;}
   if(converted[0][0]!==converted.at(-1)![0])throw new Error('Pole-enclosing or full-world rings require an explicit dateline split');
   if(ri){const center=raw[0][0][0];const shift=360*Math.round((center-converted[0][0])/360);converted.forEach(p=>p[0]+=shift);}
   return converted;
  });
  const validity=new IsValidOp(new GeoJSONReader().read({type:'Polygon',coordinates:rings}));
  if(!validity.isValid())throw new Error(`Invalid polygon topology: ${String(validity.getValidationError())}`);
  const xs=rings[0].map(p=>p[0]),lo=Math.min(...xs),hi=Math.max(...xs);
  if(hi-lo>180)throw new Error('Polygon wider than a hemisphere requires explicit split');
  for(let k=Math.floor((lo+180)/360);k<=Math.floor((hi+180)/360);k++){
   const clipped=clipping.intersection([rings],rect(-180+360*k,-90,180+360*k,90));
   for(const poly of clipped){pieces.push(poly.map(r=>r.map(([x,y])=>[x-360*k,y] as Pair)));}
  }
 }
 return pieces.length?clipping.union(pieces):[];
}
function rect(w:number,s:number,e:number,n:number):ClipPoly{return [[[w,s],[e,s],[e,n],[w,n],[w,s]]];}
function bounds(poly:ClipPoly){const flat=poly[0];let w=Infinity,e=-Infinity,s=Infinity,n=-Infinity;for(const [x,y]of flat){w=Math.min(w,x);e=Math.max(e,x);s=Math.min(s,y);n=Math.max(n,y);}return {w,e,s,n};}
function inside(point:Pair,ring:Pair[]){let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}
function interior(poly:ClipPoly,w:number,s:number,e:number,n:number){
 const center:Pair=[(w+e)/2,(s+n)/2];if(!inside(center,poly[0])||poly.slice(1).some(r=>inside(center,r)))return false;
 // Conservative: if ANY ring segment bounding box touches the cell, clip exactly.
 return !poly.some(r=>r.some((a,i)=>{if(!i)return false;const b=r[i-1];return Math.max(a[0],b[0])>=w&&Math.min(a[0],b[0])<=e&&Math.max(a[1],b[1])>=s&&Math.min(a[1],b[1])<=n;}));
}
/** WGS84 ellipsoidal area. Densify linear lon/lat edges at <=0.025 degrees before
 * GeographicLib geodesic integration; this preserves the GeoJSON edge convention. */
export function area(polygons:ClipMulti){let total=0;for(const poly of polygons){for(let j=0;j<poly.length;j++){
 const ring=poly[j],acc=geographic.Geodesic.WGS84.Polygon(false);
 for(let i=0;i<ring.length-1;i++){const a=ring[i],b=ring[i+1],steps=Math.max(1,Math.ceil(Math.max(Math.abs(b[0]-a[0]),Math.abs(b[1]-a[1]))/.025));
  for(let k=0;k<steps;k++)acc.AddPoint(a[1]+(b[1]-a[1])*k/steps,a[0]+(b[0]-a[0])*k/steps);
 }
 total+=(j===0?1:-1)*Math.abs(acc.Compute(false,true).area??0);
 }}return Math.max(0,total);}
const cellAreas=new Map<number,number>();
export function rasterize(geometry:Polygon|MultiPolygon,threshold=.5,crs='EPSG:4326'):RasterResult{
 if(!Number.isFinite(threshold)||threshold<0||threshold>1)throw new Error('Threshold must be in [0,1]');
 const polygons=normalizeGeometry(geometry,crs),candidates=new Map<number,number[]>();
 for(let i=0;i<polygons.length;i++){
  const b=bounds(polygons[i]);
  for(let r=Math.max(0,Math.floor((b.s+90)/STEP));r<=Math.min(H-1,Math.floor((b.n+90)/STEP));r++)
   for(let c=Math.max(0,Math.floor((b.w+180)/STEP));c<=Math.min(W-1,Math.floor((b.e+180)/STEP));c++){
    const id=r*W+c+1;const list=candidates.get(id)??[];list.push(i);candidates.set(id,list);
   }
 }
 const result:Assignment[]=[],represented=new Set<number>();let interiors=0,boundary=0;
 for(const [id,components]of [...candidates].sort((a,b)=>a[0]-b[0])){
  const r=Math.floor((id-1)/W),c=(id-1)%W,w=-180+c*STEP,s=-90+r*STEP,e=w+STEP,n=s+STEP;
  const whole=components.some(i=>interior(polygons[i],w,s,e,n));let fraction:number;
  if(whole){fraction=1;interiors++;}else{
   boundary++;const intersections=clipping.intersection(components.map(i=>polygons[i]),rect(w,s,e,n));
   const numerator=area(intersections);if(!numerator)continue;
   if(!cellAreas.has(r))cellAreas.set(r,area([rect(0,s,STEP,n)]));
   fraction=Math.min(1,numerator/cellAreas.get(r)!);
  }
  // Retain every positive intersection, including sub-threshold islands; round reproducibly.
  fraction=Number(fraction.toPrecision(12));if(fraction<=0)continue;
  const eligible=fraction>=threshold;
  if(eligible)for(const i of components){if(whole||area(clipping.intersection([polygons[i]],rect(w,s,e,n)))>0)represented.add(i);}
  result.push({cellId:id,coverage:fraction,eligible,method:whole?'interior':'intersection'});
 }
 const unrepresentedComponents=polygons.map((_,i)=>i).filter(i=>!represented.has(i));
 return {assignments:result,unrepresentedComponents,report:{candidateCells:candidates.size,interiorAssignments:interiors,boundaryCells:boundary,ambiguousCells:result.filter(a=>!a.eligible).length,smallComponents:unrepresentedComponents.length,assignments:result.length}};
}
