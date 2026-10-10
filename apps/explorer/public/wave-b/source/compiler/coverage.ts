import {deflateSync,inflateSync} from 'node:zlib';
import {hash} from '../history/canonical';
import type {Range} from '../../lib/readiness/contracts';
export function makeCoverage(cells:{cellId:number;coverage:number;eligible:boolean}[]){
 const sorted=[...cells].sort((a,b)=>a.cellId-b.cellId),ranges:Range[]=[];let last=0;
 for(const c of sorted){if(!Number.isSafeInteger(c.cellId)||c.cellId<=last||c.cellId>259200||!Number.isFinite(c.coverage)||c.coverage<=0||c.coverage>1)throw new Error('Invalid/duplicate coverage membership');last=c.cellId;
  const prev=ranges.at(-1);if(prev&&prev.end===c.cellId&&prev.coverage===c.coverage&&prev.eligible===c.eligible)prev.end++;else ranges.push({start:c.cellId,end:c.cellId+1,coverage:c.coverage,eligible:c.eligible});
 }
 const bytes=Buffer.alloc(8+ranges.length*20);bytes.writeUInt32LE(0x31534343);bytes.writeUInt32LE(ranges.length,4);
 ranges.forEach((r,i)=>{const p=8+i*20;bytes.writeUInt32LE(r.start,p);bytes.writeUInt32LE(r.end,p+4);bytes.writeDoubleLE(r.coverage,p+8);bytes.writeUInt32LE(Number(r.eligible),p+16);});
 return {id:'coverage:'+hash(bytes),hash:hash(bytes),encoding:'rle-f64-deflate/v1',count:cells.length,ranges,data:deflateSync(bytes,{level:9})};
}
export function decodeCoverage(bytes:Uint8Array,expectedHash?:string):Range[]{const b=inflateSync(bytes,{maxOutputLength:6_000_000});if(expectedHash&&hash(b)!==expectedHash)throw new Error('Coverage checksum mismatch');if(b.length<8||b.readUInt32LE()!==0x31534343||b.length!==8+b.readUInt32LE(4)*20)throw new Error('Coverage encoding mismatch');let previous=0;return Array.from({length:b.readUInt32LE(4)},(_,i)=>{const p=8+i*20,start=b.readUInt32LE(p),end=b.readUInt32LE(p+4),coverage=b.readDoubleLE(p+8),eligible=b.readUInt32LE(p+16);if(start<1||start<previous||end<=start||end>259201||!Number.isFinite(coverage)||coverage<=0||coverage>1||eligible>1)throw new Error('Invalid coverage range');previous=end;return {start,end,coverage,eligible:Boolean(eligible)};});}
