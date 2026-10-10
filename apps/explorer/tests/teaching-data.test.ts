import test from 'node:test';
import assert from 'node:assert/strict';
import { TEACHING_SOURCES, TEACHING_FEATURES, PRIMARY_ACCOUNTS, TEACHING_CATEGORIES, validateTeachingData, teachingFeaturesAtYear, accountDistanceInYears, accountCompositionDistanceInYears, nearbyAccounts, distanceKm, safeTeachingURL, type PrimaryAccount, type TeachingCategory } from '../src/teaching-data.ts';

test('every teaching record has bounded geography, historical dates and resolvable evidence',()=>{
  assert.ok(TEACHING_FEATURES.length>=50);assert.ok(PRIMARY_ACCOUNTS.length>=24);assert.ok(TEACHING_SOURCES.length>=92);
  validateTeachingData(TEACHING_SOURCES,TEACHING_FEATURES,PRIMARY_ACCOUNTS);
});
test('layers respect their evidence windows, including BCE and Melaka before and after 1400',()=>{
  const all=new Set(Object.keys(TEACHING_CATEGORIES) as TeachingCategory[]);
  const ids=(year:number)=>teachingFeaturesAtYear(year,all).map(f=>f.id);
  assert.ok(!ids(1399).includes('exchange-calicut-melaka'));assert.ok(ids(1400).includes('exchange-calicut-melaka'));
  assert.ok(ids(-2500).includes('exchange-crops-inner-asia'));assert.ok(!ids(-1999).includes('exchange-crops-inner-asia'));
  assert.ok(ids(1347).includes('exchange-plague-mediterranean'));assert.ok(!ids(1415).includes('exchange-plague-mediterranean'));
  assert.equal(teachingFeaturesAtYear(1415,new Set()).length,0);
});
test('a generation filter separates described events from composition dates',()=>{
  const account={...PRIMARY_ACCOUNTS[0],eventFromYear:1325,eventToYear:1330,writtenFromYear:1355,writtenToYear:1356};
  assert.equal(accountDistanceInYears(account,1365),35);assert.equal(accountDistanceInYears(account,1366),36);
  assert.equal(accountDistanceInYears({...account,eventFromYear:-1,eventToYear:-1},1),1);
  const dated=nearbyAccounts(1415);assert.ok(dated.every(a=>accountDistanceInYears(a,1415)<=35&&accountCompositionDistanceInYears(a,1415)<=35));
  assert.equal(nearbyAccounts(1415,null,true).length,PRIMARY_ACCOUNTS.length);
});
test('place accounts are ordered by distance without silently removing other locations',()=>{
  const point=[31.2357,30.0444];const records=nearbyAccounts(1330,point,true);
  assert.equal(records.length,PRIMARY_ACCOUNTS.length);
  for(let i=1;i<records.length;i++)assert.ok(distanceKm(records[i-1].coordinates,point)<=distanceKm(records[i].coordinates,point));
  assert.equal(distanceKm(point,point),0);
});
test('untrusted source URLs and orphan evidence fail authoring validation',()=>{
  for(const url of ['javascript:alert(1)','http://example.com','https://user:secret@example.com'])assert.throws(()=>safeTeachingURL(url));
  const bad={...TEACHING_FEATURES[0],sourceIds:['missing-evidence']};assert.throws(()=>validateTeachingData(TEACHING_SOURCES,[bad],[]),/Missing evidence/);
  const zero={...PRIMARY_ACCOUNTS[0],eventFromYear:0} as PrimaryAccount;assert.throws(()=>validateTeachingData(TEACHING_SOURCES,[],[zero]),/historical interval/);
});


test('an ancient kingdom biography is not attached to a modern namesake observation',async()=>{
  const {studyHistoriesAtObservation}=await import('../src/teaching-studies.ts');
  const {STATE_COVERAGE}=await import('../src/state-coverage.ts');
  const {getStateHistory}=await import('../src/state-histories.ts');
  const entry=STATE_COVERAGE.find(e=>e.title==='Benin'&&e.kind==='political')!;
  const state={id:entry.id,title:entry.title,kind:entry.kind,summary:entry.summary,observations:entry.observations,histories:entry.historyIds.map(getStateHistory).filter((h):h is NonNullable<typeof h>=>!!h),sources:[]};
  assert.ok(studyHistoriesAtObservation(state,1400).some(h=>h.id==='benin-kingdom'));
  assert.equal(studyHistoriesAtObservation(state,2000).length,0);
  assert.ok(studyHistoriesAtObservation(state,2000,true).some(h=>h.id==='benin-kingdom'));
});

test('later recollections of Inca rule are not presented as contemporary writing at1415',()=>{
 const inca=PRIMARY_ACCOUNTS.find(a=>a.place.includes('Cuzco'))!;assert.ok(inca);
 assert.equal(accountDistanceInYears(inca,1415),0);assert.ok(accountCompositionDistanceInYears(inca,1415)>35);
 assert.ok(!nearbyAccounts(1415).some(a=>a.id===inca.id));assert.ok(nearbyAccounts(1415,null,true).some(a=>a.id===inca.id));
});
