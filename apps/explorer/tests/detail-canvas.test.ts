import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { DetailCanvas } from '../src/detail-canvas.ts';
import { DETAIL_LIMITS, type DetailFrame } from '../src/detail-context.ts';

class TestImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 256;
  naturalHeight = 256;
  private url = '';
  get src() { return this.url; }
  set src(value: string) {
    this.url = value;
    // Model a canceled image producing an error if its handler was retained.
    if (!value) this.onerror?.();
  }
}
function harness(t: TestContext) {
  const images: TestImage[] = [];
  const oldImage = Object.getOwnPropertyDescriptor(globalThis, 'Image');
  const oldRaf = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame');
  Object.defineProperty(globalThis, 'Image', { configurable: true, value: class extends TestImage { constructor() { super(); images.push(this); } } });
  Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: () => 1 });
  t.after(() => {
    if (oldImage) Object.defineProperty(globalThis, 'Image', oldImage); else Reflect.deleteProperty(globalThis, 'Image');
    if (oldRaf) Object.defineProperty(globalThis, 'requestAnimationFrame', oldRaf); else Reflect.deleteProperty(globalThis, 'requestAnimationFrame');
  });
  const calls: { url: string; args: number[] }[] = [];
  const ctx = {
    drawImage: (image: TestImage, ...args: number[]) => calls.push({ url: image.src, args }),
    save() {}, restore() {}, beginPath() {}, arc() {}, fill() {}, stroke() {}, strokeText() {}, fillText() {}, moveTo() {}, lineTo() {}, closePath() {},
    measureText: (value: string) => ({ width: value.length * 6 }),
  } as unknown as CanvasRenderingContext2D;
  const painter = new DetailCanvas(() => undefined);
  t.after(() => painter.destroy());
  return { images, calls, ctx, painter };
}
const frame = (): DetailFrame => ({
  terrain: { tiles: 'https://example.invalid/relief/{z}/{x}/{y}.webp', minzoom: 0, maxzoom: 8, tileSize: 256 },
  hydro: null, places: [], population: null, options: { terrain: true, water: false, cities: true, density: false, modernCities: false },
  requestedYear: 1900, populationLabel: 'No observation',
});

test('terrain base is painted before all fine tiles and never overpaints them', t => {
  const { images, calls, ctx, painter } = harness(t);
  painter.setFrame(frame());
  const camera = { x: .5, y: .5, scale: 1024 };
  painter.drawTerrain(ctx, camera, 1024, 1024);
  images.forEach(image => image.onload?.());
  calls.length = 0;
  painter.drawTerrain(ctx, camera, 1024, 1024);
  assert.ok(calls.some(call => call.url.includes('/2/')));
  assert.equal(calls.filter(call => call.url.includes('/0/0/0.')).length, 1);
  assert.ok(calls[0].url.includes('/0/0/0.'));
  assert.ok(calls.slice(1).every(call => !call.url.includes('/0/0/0.')));
  assert.ok(painter.getDiagnostics().rasterPending <= DETAIL_LIMITS.rasterRequests);
});

test('terrain replacement ignores stale image events and clears handlers before cancellation', t => {
  const { images, ctx, painter } = harness(t);
  painter.setFrame(frame());
  painter.drawTerrain(ctx, { x: .5, y: .5, scale: 1024 }, 1024, 1024);
  const late = images.map(image => image.onload);
  const next = frame(); next.terrain!.tiles = 'https://example.invalid/new/{z}/{x}/{y}.webp';
  painter.setFrame(next);
  assert.equal(painter.getDiagnostics().rasterPending, 0);
  assert.equal(painter.getDiagnostics().rasterCache, 0);
  assert.equal(painter.getDiagnostics().rasterErrors, 0);
  painter.drawTerrain(ctx, { x: .5, y: .5, scale: 1024 }, 1024, 1024);
  const currentPending = painter.getDiagnostics().rasterPending;
  late.forEach(callback => callback?.());
  assert.equal(painter.getDiagnostics().rasterPending, currentPending);
  images.forEach(image => image.onload?.());
  assert.equal(painter.getDiagnostics().rasterPending, 0);
  painter.destroy();
  assert.equal(painter.getDiagnostics().rasterPending, 0);
});

test('large viewport requests a tile footprint that fits its fixed cache', t => {
  const { ctx, painter } = harness(t);
  painter.setFrame(frame());
  const width = 3840, height = 2160, scale = 10000;
  painter.drawTerrain(ctx, { x: .5, y: .5, scale }, width, height);
  const zoom = painter.getDiagnostics().terrainZoom!;
  const n = 2 ** zoom;
  const columns = Math.ceil((.5 + width / 2 / scale) * n) - Math.floor((.5 - width / 2 / scale) * n);
  const rows = Math.ceil((.5 + height / 2 / scale) * n) - Math.floor((.5 - height / 2 / scale) * n);
  assert.ok(columns * rows <= DETAIL_LIMITS.rasterTiles - DETAIL_LIMITS.rasterRequests - 1);
  assert.ok(painter.getDiagnostics().rasterPending <= DETAIL_LIMITS.rasterRequests);
});

test('dated place labels respect an explicit source minZoom', t => {
  const { ctx, painter } = harness(t);
  const next = frame();
  next.places = [{ id: 'place', title: 'Dated place', coordinates: [0, 0], sourceId: 'source', sourceUrl: 'https://example.invalid', validFromYear: 0, validToYear: 2000, rank: 1, minZoom: 3, temporalMode: 'source-envelope' }];
  painter.setFrame(next);
  painter.drawOverlay(ctx, { x: .5, y: .5, scale: 2048 }, 1024, 768);
  assert.equal(painter.getDiagnostics().visibleCityLabels, 0);
  painter.drawOverlay(ctx, { x: .5, y: .5, scale: 4096 }, 1024, 768);
  assert.equal(painter.getDiagnostics().visibleCityLabels, 1);
});

test('offscreen ancient anchors cannot exhaust the visible label budget at high zoom', t => {
  const { ctx, painter } = harness(t);
  const next = frame(), width = 1024, height = 768, scale = 16384;
  const place = (id: string, x: number, y: number) => ({
    id, title: id, coordinates: [((x - width / 2) / scale + .5) * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * ((y - height / 2) / scale + .5)))) * 180 / Math.PI] as [number, number],
    sourceId: 'source', sourceUrl: 'https://example.invalid', validFromYear: -500, validToYear: 500, rank: 6, minZoom: 0, temporalMode: 'source-envelope' as const,
  });
  // These fit the former .03-world padding (491 px), but none intersect the view.
  next.places = Array.from({ length: 120 }, (_, i) => place(`a-offscreen-${i}`, -400 + Math.floor(i / 30) * 85, -150 + (i % 30) * 25));
  next.places = [...next.places, place('z-visible', width / 2, height / 2)];
  painter.setFrame(next);
  painter.drawOverlay(ctx, { x: .5, y: .5, scale }, width, height);
  assert.equal(painter.getDiagnostics().visibleCityLabels, 1);
});


test('major dated cities are intrinsic and visible at world zoom; stale references wait for detailed zoom', t => {
  const { ctx, painter } = harness(t), next = frame();
  next.options.cities=false;
  next.places=[{id:'major',title:'Major city',coordinates:[0,0],sourceId:'history',sourceUrl:'https://example.test',validFromYear:null,validToYear:null,rank:0,minZoom:-2,temporalMode:'historical-city',populationRank:1,populationEstimate:{value:100000,year:1900,ageYears:0,sourceId:'history',stale:false}}];
  painter.setFrame(next);painter.drawOverlay(ctx,{x:.5,y:.5,scale:512},1024,768);
  assert.equal(painter.getDiagnostics().visibleCityLabels,1);
  next.places=[{...next.places[0],id:'old',minZoom:3.8,temporalStatus:'location-reference'}];
  painter.setFrame(next);painter.drawOverlay(ctx,{x:.5,y:.5,scale:512},1024,768);
  assert.equal(painter.getDiagnostics().visibleCityLabels,0);
});

test('capital stars render and nearby labels find non-overlapping alternate positions', t => {
  const { ctx, painter } = harness(t), next=frame();
  const capital={id:'one',title:'Capital one',coordinates:[0,0] as [number,number],sourceId:'history',sourceUrl:'https://example.test',validFromYear:null,validToYear:null,rank:1,minZoom:0,temporalMode:'historical-city' as const,capital:[{from:1800,to:2000,polityId:'state',sourceId:'history'}]};
  next.places=[capital,{...capital,id:'two',title:'Capital two',coordinates:[.5,0]}];
  painter.setFrame(next);painter.drawOverlay(ctx,{x:.5,y:.5,scale:1024},1024,768);
  assert.equal(painter.getDiagnostics().visibleCityLabels,2);
});


test('an inactive retained city is a hollow selected location, never an active city or capital marker',t=>{
  const {ctx,painter}=harness(t),next=frame(),labels:string[]=[],fills:string[]=[];
  t.mock.method(ctx,'fillText',(text:string)=>{labels.push(text);});
  t.mock.method(ctx,'fill',()=>{fills.push(String(ctx.fillStyle));});
  next.selectedPlace={id:'outside',title:'Future city',coordinates:[0,0],sourceId:'history',sourceUrl:'https://example.test',validFromYear:null,validToYear:null,rank:100,temporalMode:'historical-city',temporalStatus:'outside-evidence'};
  painter.setFrame(next);painter.drawOverlay(ctx,{x:.5,y:.5,scale:512},1024,768);
  assert.equal(painter.getDiagnostics().visibleCityLabels,0);
  assert.equal(painter.getDiagnostics().selectedPointVisible,true);
  assert.ok(labels.includes('Future city · selected location'));
  assert.ok(!fills.includes('#e0b35d'));
});


test('shared label collision reserves city text and marker bounds and clears them on the next frame',t=>{
  const {ctx,painter}=harness(t),next=frame();
  next.places=[{id:'city',title:'World city',coordinates:[0,0],sourceId:'history',sourceUrl:'https://example.test',validFromYear:null,validToYear:null,rank:1,minZoom:-2,temporalMode:'historical-city'}];
  painter.setFrame(next);painter.drawOverlay(ctx,{x:.5,y:.5,scale:512},1024,768);
  assert.equal(painter.overlapsCityLabel(551,384,20,20),true,'city text reserves its own rectangle');
  assert.equal(painter.overlapsCityLabel(512,384,2,2),true,'marker also reserves space');
  assert.equal(painter.overlapsCityLabel(50,50,20,20),false);
  next.places=[];painter.setFrame(next);painter.drawOverlay(ctx,{x:.5,y:.5,scale:512},1024,768);
  assert.equal(painter.overlapsCityLabel(551,384,20,20),false,'old camera/data labels cannot keep blocking polity labels');
});

test('dated city view projection is reused across warm reversals while camera and evidence changes invalidate it',t=>{
  const{ctx,painter}=harness(t),first=frame(),second=frame();
  first.places=[{id:'dated-place',title:'Earlier name',coordinates:[0,0],sourceId:'fixture',sourceUrl:'https://example.test',validFromYear:null,validToYear:null,rank:1,minZoom:-2,temporalMode:'historical-city'}];
  second.places=[{...first.places[0],title:'Later name',coordinates:[1,0]}];
  const labels:string[]=[];ctx.fillText=text=>{labels.push(text);};
  const camera={x:.5,y:.5,scale:512};
  for(let i=0;i<200;i++){
    const next=i%2?second:first;painter.setFrame(next);painter.drawOverlay(ctx,camera,1024,768);
    assert.equal(labels.at(-1),i%2?'Later name':'Earlier name');
  }
  assert.equal(painter.getDiagnostics().candidateProjectionBuilds,2);
  assert.equal(painter.getDiagnostics().trackedCityRadii,1);
  painter.drawOverlay(ctx,{...camera,x:.51},1024,768);
  assert.equal(painter.getDiagnostics().candidateProjectionBuilds,3);
  painter.setFrame({...second,places:[]});painter.drawOverlay(ctx,camera,1024,768);
  assert.equal(painter.getDiagnostics().visibleCityLabels,0);
  assert.equal(painter.getDiagnostics().trackedCityRadii,0);
});

test('offscreen dated cities do not allocate tween state before they are painted',t=>{
  const{ctx,painter}=harness(t),next=frame();
  next.places=Array.from({length:1000},(_,index)=>({id:`offscreen-${index}`,title:`Test city ${index}`,coordinates:[100,0] as [number,number],sourceId:'fixture',sourceUrl:'https://example.test',validFromYear:null,validToYear:null,rank:1,minZoom:-2,temporalMode:'historical-city' as const}));
  painter.setFrame(next);assert.equal(painter.getDiagnostics().trackedCityRadii,0);
  painter.drawOverlay(ctx,{x:.5,y:.5,scale:50000},1024,768);
  assert.equal(painter.getDiagnostics().visibleCityLabels,0);
  assert.equal(painter.getDiagnostics().trackedCityRadii,0);
});

test('exact visible appearance permits metadata-only year changes while every drawn city attribute invalidates paint',t=>{
  const{ctx,painter}=harness(t),previous=frame(),camera={x:.5,y:.5,scale:512};
  previous.places=[{id:'attested-place',title:'Same name',coordinates:[0,0],sourceId:'fixture',sourceUrl:'https://example.test',validFromYear:null,validToYear:null,rank:1,minZoom:-2,temporalMode:'historical-city',populationEstimate:{value:10000,year:2000,ageYears:0,sourceId:'fixture',stale:false}}];
  painter.setFrame(previous);painter.drawOverlay(ctx,camera,1024,768);
  const current:DetailFrame={...previous,requestedYear:2001,places:[{...previous.places[0],populationEstimate:{...previous.places[0].populationEstimate!,ageYears:1}}]};
  painter.setFrame(current);
  assert.equal(painter.canReusePaint(previous,current,camera,1024,768),true,'Estimate age belongs to inspection; it changes no marker pixels.');
  assert.equal(current.places[0].populationEstimate?.ageYears,1);
  for(const changed of [
    {...current.places[0],title:'Another name'},
    {...current.places[0],coordinates:[1,0] as [number,number]},
    {...current.places[0],rank:2},
    {...current.places[0],minZoom:5},
    {...current.places[0],temporalStatus:'location-reference' as const},
    {...current.places[0],populationRank:1},
    {...current.places[0],populationEstimate:{...current.places[0].populationEstimate!,value:20000}},
    {...current.places[0],capital:[{from:2000,to:2001,polityId:'fixture',sourceId:'fixture'}]},
  ])assert.equal(painter.canReusePaint(current,{...current,places:[changed]},camera,1024,768),false);
  assert.equal(painter.canReusePaint(current,{...current,selectedPlace:current.places[0]},camera,1024,768),false);
  assert.equal(painter.canReusePaint(current,{...current,options:{...current.options,water:true}},camera,1024,768),false);
  const replaced={...current,places:[...current.places,{...current.places[0],id:'offscreen',coordinates:[100,0] as [number,number]}]};
  assert.equal(painter.canReusePaint(current,replaced,{...camera,scale:50000},1024,768),true,'Offscreen evidence changes do not change actual viewport pixels.');
  assert.equal(painter.canReusePaint(current,replaced,camera,1024,768),false,'A wide view includes that replacement marker.');
});
