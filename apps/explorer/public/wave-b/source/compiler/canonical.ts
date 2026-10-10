import {createHash} from 'node:crypto';
export function canonical(value:unknown):string{
 if(value===null||typeof value!=='object'){if(typeof value==='number'&&!Number.isFinite(value))throw new Error('Non-finite JSON');const s=JSON.stringify(value);if(s===undefined)throw new Error('Undefined JSON');return s;}
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 return '{'+Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';
}
export const hash=(bytes:string|Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
export const objectHash=(value:unknown)=>hash(canonical(value));
