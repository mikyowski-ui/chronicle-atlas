import { DOMParser, type Element as XMLElement } from '@xmldom/xmldom';
import { immutable } from '@chronicle/contracts/canonical';
import { VISUALIZATION_LIMITS, SVG_ATTRIBUTE_VOCABULARY, VisualizationError, type SafeSVGNode } from '@chronicle/contracts/visualization';
import type { EvidenceRecord } from '@chronicle/contracts/evidence';

const namespace = 'http://www.w3.org/2000/svg';
const fail = (): never => { throw new VisualizationError('INVALID_OUTPUT'); };
const tags = new Set(Object.keys(SVG_ATTRIBUTE_VOCABULARY));
const attributes: Readonly<Record<string, readonly string[]>> = SVG_ATTRIBUTE_VOCABULARY;
const numeric = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/;
function number(value: string): number { if (!numeric.test(value) || !Number.isFinite(Number(value)) || Math.abs(Number(value)) > 10000) return fail(); return Number(value); }
function numbers(value: string): number[] { const parts = value.trim().split(/[\s,]+/); if (parts.length > 2048) return fail(); return parts.map(number); }
function path(value: string): void {
  if (value.length > 4096) return fail();
  const tokens = value.match(/[MmLlHhVvCcQqZz]|[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  if (!tokens.length || tokens.length > 1024 || tokens.join('') !== value.replace(/[\s,]/g, '') || !/^[Mm]$/.test(tokens[0] ?? '')) return fail();
  const arity: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, q: 4, z: 0 }; let expected = 0, count = 0;
  for (const token of tokens) {
    if (/^[a-z]$/i.test(token)) { if (expected && (!count || count % expected !== 0)) return fail(); expected = arity[token.toLowerCase()]; count = 0; }
    else { if (!expected) return fail(); number(token); count++; }
  }
  if (expected && (!count || count % expected !== 0)) return fail();
}
const normalizedText = (value: string) => value.replace(/\s+/g, ' ').trim();
function permittedText(record: EvidenceRecord): Set<string> {
  return new Set([record.label, record.variable, record.value === null ? 'Not supplied' : String(record.value), record.unit ?? 'Unit not supplied', record.time ? record.time.startYear <= 0 ? `${1 - record.time.startYear} BCE` : `${record.time.startYear} CE` : 'Unknown time'].map(normalizedText));
}
export function parseSafeSVG(input: string, records: readonly EvidenceRecord[], width: number, height: number): SafeSVGNode {
  if (typeof input !== 'string' || input.length > VISUALIZATION_LIMITS.outputBytes || new TextEncoder().encode(input).byteLength > VISUALIZATION_LIMITS.outputBytes) throw new VisualizationError('OUTPUT_LIMIT');
  if (/<!|<\?|[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(input) || (input.match(/</g)?.length ?? 0) > VISUALIZATION_LIMITS.nodes * 2) return fail();
  let document;
  try { document = new DOMParser({ onError: () => fail() }).parseFromString(input, 'application/xml'); } catch { return fail(); }
  const root = document.documentElement; if (!root || root.tagName !== 'svg') return fail();
  for (let i = 0; i < document.childNodes.length; i++) { const child = document.childNodes.item(i)!; if (child !== root && !(child.nodeType === 3 && !child.nodeValue?.trim())) return fail(); }
  const byId = new Map(records.map(record => [record.id, record])), represented = new Set<string>(); let nodes = 0;
  const visit = (node: XMLElement, inherited: string | null, depth: number, parent: string | null): SafeSVGNode => {
    const tag = node.tagName;
    if (++nodes > VISUALIZATION_LIMITS.nodes || depth > VISUALIZATION_LIMITS.depth || node.namespaceURI !== namespace || !tags.has(tag) || tag === 'svg' && parent !== null || tag === 'tspan' && parent !== 'text' || parent === 'text' && tag !== 'tspan' || parent === 'tspan') return fail();
    if (parent && !['svg', 'g', 'text'].includes(parent)) return fail();
    const values: Record<string, string> = {}, permitted = attributes[tag];
    for (let i = 0; i < node.attributes.length; i++) {
      const attr = node.attributes.item(i)!; if (!permitted.includes(attr.name) || attr.value.length > 4096) return fail();
      const value = attr.value;
      if (attr.name === 'xmlns') { if (tag !== 'svg' || value !== namespace) return fail(); }
      else if (attr.name === 'viewBox') { if (numbers(value).join(' ') !== `0 0 ${width} ${height}`) return fail(); }
      else if (attr.name === 'data-record-id') { if (!byId.has(value)) return fail(); }
      else if (attr.name === 'fill' || attr.name === 'stroke') { if (!/^(?:none|#[\da-f]{3}|#[\da-f]{4}|#[\da-f]{6}|#[\da-f]{8})$/i.test(value)) return fail(); }
      else if (attr.name === 'text-anchor') { if (!['start', 'middle', 'end'].includes(value)) return fail(); }
      else if (attr.name === 'font-weight') { if (!['normal', 'bold', '400', '500', '600', '700'].includes(value)) return fail(); }
      else if (attr.name === 'transform') { const match = /^translate\(([^)]+)\)$/.exec(value); if (!match || ![1, 2].includes(numbers(match[1]).length)) return fail(); }
      else if (attr.name === 'points') { const points = numbers(value); if (points.length < (tag === 'polygon' ? 6 : 4) || points.length % 2) return fail(); }
      else if (attr.name === 'd') path(value);
      else {
        const amount = number(value);
        if (tag === 'svg' && (attr.name === 'width' ? amount !== width : attr.name === 'height' && amount !== height)) return fail();
        if (['width', 'height', 'r', 'rx', 'ry', 'stroke-width'].includes(attr.name) && amount < 0 || attr.name.includes('opacity') && (amount < 0 || amount > 1) || attr.name === 'font-size' && (amount < 8 || amount > 32)) return fail();
      }
      values[attr.name] = value;
    }
    if (tag === 'svg' && (values.xmlns !== namespace || values.viewBox === undefined)) return fail();
    const recordId = values['data-record-id'] ?? inherited;
    if (!['svg', 'g'].includes(tag) && !recordId) return fail();
    const children: SafeSVGNode[] = []; let text = '';
    for (let i = 0; i < node.childNodes.length; i++) {
      const child = node.childNodes.item(i)!;
      if (child.nodeType === 1) children.push(visit(child as XMLElement, recordId, depth + 1, tag));
      else if (child.nodeType === 3 && ['text', 'tspan'].includes(tag)) text += child.nodeValue ?? '';
      else if (!(child.nodeType === 3 && !child.nodeValue?.trim())) return fail();
    }
    if (tag === 'text') {
      if (children.length && text) return fail();
      if (!recordId || !permittedText(byId.get(recordId)!).has(normalizedText(node.textContent ?? ''))) return fail();
      represented.add(recordId);
    }
    return { tag: tag as SafeSVGNode['tag'], attributes: values, children, text };
  };
  const tree = visit(root, null, 0, null);
  if (records.some(record => !represented.has(record.id))) return fail();
  return immutable(tree);
}
export function serializeSafeSVG(node: SafeSVGNode): string {
  const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!);
  const attrs = Object.entries(node.attributes).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([name, value]) => ` ${name}="${escape(value)}"`).join('');
  return `<${node.tag}${attrs}>${escape(node.text)}${node.children.map(serializeSafeSVG).join('')}</${node.tag}>`;
}
