/** Bounded JSON reader; rejects duplicate and prototype keys before constructing objects. */
export class BoundaryError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'BoundaryError'; }
}
export const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor']);
export function strictJson(bytes: Uint8Array, maxBytes = 65_536): unknown {
  if (bytes.byteLength > maxBytes) throw new BoundaryError('BYTE_LIMIT');
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new BoundaryError('INVALID_UTF8'); }
  let at = 0;
  let nodes = 0;
  const space = (): void => { while (at < text.length && /[\t\n\r ]/.test(text[at])) at++; };
  const fail = (): never => { throw new BoundaryError('INVALID_JSON'); };
  const string = (): string => {
    const start = at++;
    while (at < text.length) {
      const char = text[at++];
      if (char === '"') {
        try { const value: unknown = JSON.parse(text.slice(start, at)); if (typeof value !== 'string') return fail(); return value; }
        catch { return fail(); }
      }
      if (char === '\\') at++;
    }
    return fail();
  };
  const value = (depth: number): unknown => {
    if (depth > 14) throw new BoundaryError('DEPTH_LIMIT');
    if (++nodes > 8_000) throw new BoundaryError('NODE_LIMIT');
    space();
    const char = text[at];
    if (char === '"') return string();
    if (char === '{') {
      at++; space();
      const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      const seen = new Set<string>();
      if (text[at] === '}') { at++; return result; }
      while (at < text.length) {
        if (text[at] !== '"') return fail();
        const key = string();
        if (unsafeKeys.has(key)) throw new BoundaryError('UNSAFE_KEY');
        if (seen.has(key)) throw new BoundaryError('DUPLICATE_KEY');
        seen.add(key); space();
        if (text[at++] !== ':') return fail();
        result[key] = value(depth + 1); space();
        const end = text[at++];
        if (end === '}') return result;
        if (end !== ',') return fail();
        space();
      }
      return fail();
    }
    if (char === '[') {
      at++; space(); const result: unknown[] = [];
      if (text[at] === ']') { at++; return result; }
      while (at < text.length) {
        result.push(value(depth + 1)); space(); const end = text[at++];
        if (end === ']') return result;
        if (end !== ',') return fail();
      }
      return fail();
    }
    for (const [token, primitive] of [['true', true], ['false', false], ['null', null]] as const) {
      if (text.startsWith(token, at)) { at += token.length; return primitive; }
    }
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(at));
    if (!match) return fail();
    at += match[0].length;
    const numeric = Number(match[0]);
    if (!Number.isFinite(numeric)) throw new BoundaryError('NONFINITE_NUMBER');
    return numeric;
  };
  const result = value(0); space(); if (at !== text.length) return fail(); return result;
}
export function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new BoundaryError('INVALID_SCHEMA');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== keys.length || Object.keys(record).some(key => !keys.includes(key))) throw new BoundaryError('INVALID_SCHEMA');
  return record;
}
