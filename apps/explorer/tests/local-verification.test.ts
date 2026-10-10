import assert from 'node:assert/strict';
import test from 'node:test';
import { scrubTarget } from '../src/local-verification.ts';

const yearOf=(canonicalDay:number)=>new Date(canonicalDay*86_400_000).getUTCFullYear();
test('continuous scrub verification uses canonical days within one year and four actual year crossings',()=>{
  const within=Array.from({length:101},(_,index)=>scrubTarget('within-year',index/100).day);
  assert.ok(within.every(value=>yearOf(value)===2000));
  assert.ok(within.every((value,index)=>!index||value>within[index-1]));
  const crossing=Array.from({length:401},(_,index)=>scrubTarget('year-crossing',index/400).day);
  assert.equal(crossing[0],crossing.at(-1));
  assert.equal(crossing.reduce((count,value,index)=>count+(index>0&&yearOf(value)!==yearOf(crossing[index-1])?1:0),0),4);
  assert.deepEqual([...new Set(crossing.map(yearOf))],[2000,2001]);
  assert.equal(scrubTarget('within-year',-1).day,within[0]);
  assert.equal(scrubTarget('within-year',2).day,within.at(-1));
});
