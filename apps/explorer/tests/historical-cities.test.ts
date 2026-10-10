import assert from 'node:assert/strict';
import test from 'node:test';
import { combineCityHistory, emptyCapitals, historicalPlaces, mergeHistoricalPlaces, parseHistoricalCapitals, parseHistoricalCities, retainedHistoricalPlace } from '../src/historical-cities.ts';

const source={id:'population-source',title:'Population source',url:'https://example.test/population'};
const city=(overrides:Record<string,unknown>={})=>({id:'rome',name:'Rome',lon:12.5,lat:41.9,population:[{year:-200,value:100000,sourceId:source.id},{year:100,value:500000,sourceId:source.id}],sourceIds:[source.id],...overrides});
const product=(cities=[city()])=>parseHistoricalCities({version:1,yearNumbering:'astronomical',sources:[source],cities});

test('city population never looks ahead, interpolates a future estimate, or invents foundation',()=>{
  const data=product();
  assert.deepEqual(historicalPlaces(data,-201),[]);
  const early=historicalPlaces(data,-200)[0],middle=historicalPlaces(data,0)[0],later=historicalPlaces(data,100)[0];
  assert.equal(early.validFromYear,null);
  assert.equal(early.firstObservationYear,-200);
  assert.equal(early.populationEstimate?.value,100000);
  assert.equal(middle.populationEstimate?.value,100000);
  assert.equal(middle.populationEstimate?.year,-200);
  assert.equal(later.populationEstimate?.value,500000);
  assert.equal(data.cities[0].population[0].value,100000);
});

test('historical BCE inputs become astronomical years and a historical year zero is rejected',()=>{
  const data=parseHistoricalCities({version:1,yearNumbering:'historical',sources:[source],cities:[city({population:[{year:-1,value:1000,sourceId:source.id}],validFrom:-2,validTo:1,names:[{name:'Roma',from:-2,to:-1,sourceId:source.id}]})]});
  assert.equal(data.cities[0].population[0].year,0);
  assert.equal(historicalPlaces(data,0)[0].title,'Roma');
  assert.equal(historicalPlaces(data,0)[0].validFromYear,-1);
  assert.throws(()=>parseHistoricalCities({version:1,yearNumbering:'historical',sources:[source],cities:[city({validFrom:0})]}),/year/);
});

test('old population peaks lose world rank and remain only an explicitly dated location reference',()=>{
  const data=product([city({id:'abandoned',population:[{year:-200,value:1000000,sourceId:source.id}]}),city({id:'living',lon:100,population:[{year:1900,value:100000,sourceId:source.id}]})]);
  const old=historicalPlaces(data,1900).find(c=>c.id==='abandoned')!,recent=historicalPlaces(data,1900).find(c=>c.id==='living')!;
  assert.equal(old.populationEstimate?.value,1000000,'dated numeric estimate is never silently decayed');
  assert.equal(old.populationEstimate?.stale,true);
  assert.equal(old.populationRank,undefined);
  assert.equal(old.temporalStatus,'location-reference');
  assert.ok(old.minZoom!>=3.8);
  assert.equal(recent.populationRank,1);
  assert.ok(recent.minZoom!<=0);
  assert.equal(old.validToYear,null,'final record is not an abandonment date');
});

test('only an explicit settlement end removes an attested location and retained selection states its absence',()=>{
  const data=product([city({validTo:200})]);
  assert.equal(historicalPlaces(data,200).length,1);
  assert.equal(historicalPlaces(data,201).length,0);
  const selected=retainedHistoricalPlace(data,'rome',201)!;
  assert.equal(selected.temporalStatus,'outside-evidence');
  assert.equal(selected.populationEstimate?.year,100);
});

test('dated names and capital stars change only inside the source period; no future capital leaks',()=>{
  const data=product([city({id:'bosporus',name:'Istanbul',lon:28.98,lat:41.01,population:[{year:100,value:10000,sourceId:source.id}],names:[{name:'Byzantion',from:100,to:329,sourceId:source.id},{name:'Constantinople',from:330,to:1452,sourceId:source.id},{name:'Istanbul',from:1453,sourceId:source.id}]})]);
  const capitals=parseHistoricalCapitals({version:1,yearNumbering:'historical',sources:[source],capitals:[{id:'constantinople',cityId:'bosporus',name:'Constantinople',coordinates:[28.98,41.01],periods:[{from:330,to:1452,polityId:'roman',label:'Imperial capital',sourceId:source.id}]}]});
  const joined=combineCityHistory(data,capitals);
  assert.equal(joined.cities.length,1);
  assert.equal(historicalPlaces(joined,329)[0].title,'Byzantion');
  assert.equal(historicalPlaces(joined,329)[0].capital?.length,0);
  assert.equal(historicalPlaces(joined,330)[0].title,'Constantinople');
  assert.equal(historicalPlaces(joined,330)[0].capital?.[0].polityId,'roman');
  assert.equal(historicalPlaces(joined,1453)[0].title,'Istanbul');
  assert.equal(historicalPlaces(joined,1453)[0].capital?.length,0);
  assert.equal(data.cities[0].capitalPeriods.length,0,'join does not mutate the source product');
});

test('a capital without population appears during its documented period without inventing an estimate',()=>{
  const capitals=parseHistoricalCapitals({version:1,yearNumbering:'historical',sources:[source],capitals:[{id:'capital-test',name:'Capital',coordinates:[20,30],periods:[{from:100,to:200,polityId:'state',sourceId:source.id}]}]});
  const joined=combineCityHistory(product([]),capitals);
  assert.equal(historicalPlaces(joined,99).length,0);
  assert.equal(historicalPlaces(joined,100)[0].populationEstimate,undefined);
  assert.equal(historicalPlaces(joined,100)[0].temporalStatus,'documented');
  assert.equal(historicalPlaces(joined,200).length,1);
  assert.equal(historicalPlaces(joined,201).length,0);
});

test('world population order responds to the requested year and only uses admitted evidence',()=>{
  const data=product([city({id:'a',population:[{year:1900,value:10000,sourceId:source.id},{year:1950,value:1000000,sourceId:source.id}]}),city({id:'b',population:[{year:1900,value:20000,sourceId:source.id}]})]);
  assert.equal(historicalPlaces(data,1920).find(c=>c.populationRank===1)?.id,'b');
  assert.equal(historicalPlaces(data,1950).find(c=>c.populationRank===1)?.id,'a');
});

test('city product validates provenance, finite coordinates, names, and bounded observations',()=>{
  assert.throws(()=>product([city({lon:Infinity})]),/coordinates/);
  assert.throws(()=>product([city({population:[{year:1,value:1,sourceId:'missing'}]})]),/source/);
  assert.throws(()=>product([city({names:[{name:'Bad',from:200,to:100}]})]),/name period/);
  assert.throws(()=>product([city(),city()]),/Duplicate/);
  assert.deepEqual(combineCityHistory(product([]),emptyCapitals()).cities,[]);
});


test('explicit city aliases merge the same gazetteer location after a dated rename, without merging neighbors',()=>{
  const data=product([city({name:'Istanbul',lon:28.98,lat:41.01,aliases:['Byzantium'],names:[{name:'Constantinople',from:330}],population:[{year:400,value:400000,sourceId:source.id}]})]);
  const dated=historicalPlaces(data,400),gazetteer={id:'pleiades:520985',title:'Byzantium',coordinates:[28.970647,41.009795] as [number,number],sourceId:'pleiades',sourceUrl:'https://pleiades.stoa.org/places/520985',validFromYear:-749,validToYear:640,rank:6,temporalMode:'source-envelope' as const};
  assert.equal(mergeHistoricalPlaces(dated,[gazetteer]).length,1);
  assert.equal(mergeHistoricalPlaces(dated,[{...gazetteer,title:'Another settlement'}]).length,2);
  assert.equal(mergeHistoricalPlaces(dated,[{...gazetteer,coordinates:[40,40]}]).length,2);
});

test('capital identity aliases carry the period name without creating a duplicate modern reference',()=>{
  const data=product([city({name:'Xian',aliases:['Changan'],lon:108.94,lat:34.34,population:[{year:100,value:100000,sourceId:source.id}]})]);
  const capitals=parseHistoricalCapitals({version:1,yearNumbering:'astronomical',sources:[source],capitals:[{id:'capital-changan',name:"Chang'an",coordinates:[108.94,34.34],periods:[{from:100,to:200,polityId:'han',sourceId:source.id}]}]});
  const joined=combineCityHistory(data,capitals);
  assert.equal(joined.cities.length,1);
  assert.equal(historicalPlaces(joined,100)[0].title,"Chang'an");
  assert.equal(historicalPlaces(joined,201)[0].title,'Xian');
});

test('modern urban-centre coordinates and definition appear only after the UN observation is admitted',()=>{
  const un={id:'un-wup-2025',title:'UN population',url:'https://population.un.org/',definition:'DEGURBA urban centre'};
  const data=parseHistoricalCities({version:1,yearNumbering:'astronomical',sources:[source,un],cities:[city({population:[{year:1900,value:1000,sourceId:source.id},{year:1975,value:2000,sourceId:un.id}],modernReferenceCoordinates:[12.8,42.2],populationDefinition:'Historical settlement and modern urban-centre extents differ.'})]});
  assert.deepEqual(historicalPlaces(data,1974)[0].coordinates,[12.5,41.9]);
  assert.deepEqual(historicalPlaces(data,1975)[0].coordinates,[12.8,42.2]);
  assert.match(historicalPlaces(data,1975)[0].populationDefinition!,/extents differ/);
  assert.match(historicalPlaces(data,1975)[0].locationNote!,/UN urban-centre/);
});
