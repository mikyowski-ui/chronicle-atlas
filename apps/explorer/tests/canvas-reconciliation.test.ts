import assert from 'node:assert/strict';
import test from 'node:test';
import { CanvasMap } from '../src/canvas-map.ts';
import type { SceneSnapshot, TerritoryFeature } from '../../../packages/contracts/src/index.ts';
import type { DetailFrame } from '../src/detail-context.ts';

function harness() {
  const map=Object.create(CanvasMap.prototype) as CanvasMap;
  const counters={draws:0,detailFrames:0,teachingFrames:0};
  // Isolate reconciliation from browser raster APIs. Real pixels are covered by
  // the inspected browser workload; these checks assert date/identity behavior.
  Object.assign(map,{canvas:{dataset:{}},scene:null,features:[],labels:[],hovered:new Set<string>(),
    visibleLayers:{population:false,migration:false},teachingFeatures:[],teachingSelection:undefined,
    detailFrame:null,detail:{setFrame:()=>{counters.detailFrames++;},canReusePaint:(previous:DetailFrame,next:DetailFrame)=>previous.places===next.places},
    teaching:{setFeatures:()=>{counters.teachingFrames++;}}});
  map.draw=()=>{counters.draws++;};
  return{map,counters};
}

function scene(): SceneSnapshot {
  const feature:TerritoryFeature={type:'Feature',geometry:{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,0]]]},
    properties:{render_id:'part:one',entity_id:'entity:one',territory_state_id:'state:one',t_start:0,t_end:10}};
  return{generation:1,time:0,edition:'test-only',epoch_id:'epoch:one',territories:[feature],population:[],migration:[],
    labels:[{label_id:'label:one',entity_id:'entity:one',text:'Fixture',position:[.5,.5]}],
    entities:{'entity:one':{name:'Fixture',color:'#123456',number:'1'}}};
}

test('Canvas exact/reference commits stamp current generation without repainting identical source geometry',()=>{
  const{map,counters}=harness(),first=scene();map.setScene(first);
  assert.equal(counters.draws,1);
  const next={...first,generation:2,time:0,overlayTime:20,territories:[...first.territories]};map.setScene(next);
  assert.equal(counters.draws,1);
  assert.equal(map.canvas.dataset.generation,'2');assert.equal(map.canvas.dataset.time,'0');
  map.setScene({...next,generation:3,time:10});
  assert.equal(counters.draws,2,'A source eligibility boundary removes its label and must redraw.');
});

test('Canvas keeps changed source geometry, colors, labels and edition visible despite stable identities',()=>{
  const{map,counters}=harness(),first=scene();map.setScene(first);
  const changed={...first,generation:2,territories:[{...first.territories[0],geometry:{type:'Polygon' as const,coordinates:[[[0,0],[2,0],[2,2],[0,0]]]}}]};
  map.setScene(changed);assert.equal(counters.draws,2);
  const colors={...changed,generation:3,entities:{'entity:one':{name:'Fixture',color:'#654321',number:'1'}}};
  map.setScene(colors);assert.equal(counters.draws,3);
  const labels={...colors,generation:4,labels:[{...first.labels![0],text:'Changed fixture'}]};
  map.setScene(labels);assert.equal(counters.draws,4);
  map.setScene({...labels,generation:5,edition:'another-test-only-edition'});assert.equal(counters.draws,5);
});

test('duplicate status-only detail emissions and empty teaching filters do not redraw the world',()=>{
  const{map,counters}=harness();
  const frame:DetailFrame={terrain:null,hydro:null,places:[],population:null,options:{terrain:true,water:true,cities:true,density:false,modernCities:false},requestedYear:2000,populationLabel:'Off'};
  map.setDetailContext(frame);map.setDetailContext({...frame,populationLabel:'Population layer off'});
  map.setTeachingFeatures([]);map.setTeachingFeatures([]);
  assert.equal(counters.draws,1);assert.equal(counters.detailFrames,2,'Dated metadata is always refreshed.');assert.equal(counters.teachingFrames,0);
  map.setDetailContext({...frame,requestedYear:2001});assert.equal(counters.draws,1,'An unchanged empty map needs no new pixels.');
  map.setDetailContext({...frame,requestedYear:2001,places:[]});assert.equal(counters.draws,2,'Changed appearance reaches the painter.');
});
