import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { activePlaces } from '../src/detail-context.ts';
import { combineCityHistory, historicalPlaces, mergeHistoricalPlaces, parseHistoricalCapitals, parseHistoricalCities } from '../src/historical-cities.ts';

const cities=parseHistoricalCities(JSON.parse(readFileSync(new URL('../public/history/cities.json',import.meta.url),'utf8')));
const capitals=parseHistoricalCapitals(JSON.parse(readFileSync(new URL('../public/history/capitals.json',import.meta.url),'utf8')));
const history=combineCityHistory(cities,capitals);

test('bundled city sources cover ancient records and contemporary urban centres without future population leakage',()=>{
  assert.ok(cities.cities.length>10000);
  for(const year of[-199,1,400,1000,1500,1900,1975,2025]){
    for(const place of historicalPlaces(history,year)){
      assert.ok(!place.populationEstimate||place.populationEstimate.year<=year,`${place.title}: future population at ${year}`);
      assert.ok(place.capital?.every(p=>p.from<=year&&year<=p.to));
    }
  }
  const modern=historicalPlaces(history,2025).filter(p=>(p.populationRank??Infinity)<=12);
  assert.equal(modern.length,12);
  assert.ok(modern.every(p=>p.populationEstimate?.year===2025&&p.populationEstimate.sourceId==='un-wup-2025'));
});

test('bundled settlement histories avoid known early-city anomalies and keep abandoned peaks out of modern ranking',()=>{
  const ancient=historicalPlaces(history,-199);
  assert.ok(!ancient.some(p=>p.title==='New York'||p.title==='London'||p.title==='Cape Town'));
  const modern=historicalPlaces(history,2025),nineveh=modern.find(p=>p.referenceNames?.includes('Nineveh'));
  assert.ok(nineveh);
  assert.equal(nineveh.populationRank,undefined);
  assert.equal(nineveh.populationEstimate?.stale,true);
  const byYear=(year:number,name:string)=>historicalPlaces(history,year).find(p=>p.referenceNames?.includes(name));
  assert.equal(byYear(2000,'Calcutta')?.title,'Calcutta');
  assert.equal(byYear(2025,'Calcutta')?.title,'Kolkata');
});

test('bundled aliases remove Byzantium after Constantinople rename and known capital identities join exactly once',()=>{
  const gazetteer=JSON.parse(readFileSync(new URL('../public/detail/places.json',import.meta.url),'utf8')).places;
  const dated=historicalPlaces(history,400),combined=mergeHistoricalPlaces(dated,activePlaces(gazetteer,400));
  assert.equal(combined.filter(p=>p.id==='pleiades:520985').length,0);
  assert.equal(dated.filter(p=>p.title==='Constantinople').length,1);
  for(const id of['capital-seleucia','capital-hangzhou','capital-delhi','capital-tenochtitlan'])assert.ok(!history.cities.some(c=>c.id===id),`${id} must join its population-city identity`);
  assert.ok(historicalPlaces(history,-199).some(p=>/Chang/.test(p.title)&&p.capital?.some(c=>c.polityId==='han')));
});
