import { DatasetDescriptorSchema, LIMITS, ResearchError } from './contracts.ts';
import type { DatasetRegistry } from './engine.ts';

export const PILOT_DESCRIPTOR=Object.freeze(DatasetDescriptorSchema.parse({
  id:'un-wup-2025-mexico-four',edition:'chronicle-teaching-local-2026-09-27/un-wup-2025-f21-v1',
  dataHash:'7eafe05c859949e6220e41702234cba722b0b807c97654bcd1f3180eab69e62e',
  sourceHash:'3a96030d87aec6c1c50f658d5321067d6345e1ab936c5d2854524f972caa75c0',
  canonicalHash:'ebc9a6ef20b1edfa3c957995b17e57c4b061a6ad89727ff1a2e0ac0983b53be5',
  variableId:'population',unit:'persons',geographicSupport:'DEGURBA urban centres; population, density and contiguity criteria. Constant footprints across years are not established.',
  temporalSupport:'nominal astronomical year; mid-year estimates; inclusive analysis window',nullSemantics:'missing is not zero',
  evidenceType:'estimate',reviewStatus:'source-attributed',coverage:{entityCount:4,rowCount:44,firstYear:1975,lastYear:2025},
  sourceId:'un-wup-2025',license:'CC BY 3.0 IGO',operators:['filter','sort','count','observations'],joins:[],
  arithmetic:'disabled-changing-urban-extents',exportPolicy:'references-only',
}));

/** The only loader URL is compiled host code. No spec, record or replay supplies it. */
async function loadPilot(signal:AbortSignal):Promise<string>{
  const response=await fetch(new URL('./pilot-data.json',import.meta.url),{signal,credentials:'same-origin'});
  if(!response.ok || !response.body)throw new ResearchError('UNKNOWN_REFERENCE','The pinned local pilot dataset could not be loaded.');
  const reader=response.body.getReader(), chunks:Uint8Array[]=[];let size=0;
  try{
    while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;
      if(size>LIMITS.dataBytes){await reader.cancel();throw new ResearchError('BUDGET_EXCEEDED','Dataset exceeds its byte budget.');}chunks.push(value);}
  }finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}
export function createRegistry():DatasetRegistry{return new Map([[PILOT_DESCRIPTOR.id,{descriptor:PILOT_DESCRIPTOR,load:loadPilot}]]);}
