import { sha256 } from '@noble/hashes/sha2.js';

/** Domain-neutral identity helpers shared by every workspace domain. No renderer, map or schema types live here. */
export function hashText(value: string): string { return Array.from(sha256(new TextEncoder().encode(value)), b=>b.toString(16).padStart(2,'0')).join(''); }
export function canonicalJSON(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJSON).join(',') + ']';
  const object = value as Record<string,unknown>;
  return '{' + Object.keys(object).filter(k=>object[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+canonicalJSON(object[k])).join(',') + '}';
}
export function immutable<T>(value:T):T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value); for (const item of Object.values(value)) immutable(item);
  }
  return value;
}
export class InputBoundsError extends Error {
  constructor(readonly code: 'INVALID_INPUT' | 'BUDGET_EXCEEDED') { super(code); this.name = 'InputBoundsError'; }
}
/** Plain finite JSON only, bounded by encoded bytes, depth and node count before any schema traversal. */
export function boundedJSON(input: unknown, limits: { readonly bytes: number; readonly depth: number; readonly nodes: number }): unknown {
  let value = input;
  if (typeof value === 'string') {
    if (new TextEncoder().encode(value).byteLength > limits.bytes) throw new InputBoundsError('BUDGET_EXCEEDED');
    try { value = JSON.parse(value); } catch { throw new InputBoundsError('INVALID_INPUT'); }
  }
  let nodes = 0;
  const parents = new Set<object>();
  const visit = (item: unknown, depth: number): void => {
    if (++nodes > limits.nodes || depth > limits.depth) throw new InputBoundsError('BUDGET_EXCEEDED');
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return;
    if (typeof item === 'number') { if (!Number.isFinite(item)) throw new InputBoundsError('INVALID_INPUT'); return; }
    if (typeof item !== 'object' || parents.has(item)) throw new InputBoundsError('INVALID_INPUT');
    if (Array.isArray(item) ? Object.getPrototypeOf(item) !== Array.prototype : ![Object.prototype, null].includes(Object.getPrototypeOf(item))) throw new InputBoundsError('INVALID_INPUT');
    parents.add(item);
    for (const key of Reflect.ownKeys(item)) {
      if (Array.isArray(item) && key === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key) || !descriptor || !('value' in descriptor) || !descriptor.enumerable) throw new InputBoundsError('INVALID_INPUT');
      visit(descriptor.value, depth + 1);
    }
    parents.delete(item);
  };
  visit(value, 0);
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > limits.bytes) throw new InputBoundsError('BUDGET_EXCEEDED');
  return value;
}
