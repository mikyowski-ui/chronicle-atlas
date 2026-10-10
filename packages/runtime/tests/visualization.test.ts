import test from 'node:test';
import assert from 'node:assert/strict';
import { makeEvidenceRecord } from '@chronicle/contracts/evidence';
import { createRenderSpecification, validateRenderInput, VISUALIZATION_LIMITS } from '@chronicle/contracts/visualization';
import { evaluateVisualization, initializeVisualization } from '../src/visualization.ts';
import { parseSafeSVG } from '../src/visualization-output.ts';

const record = makeEvidenceRecord({ schemaVersion: 1, id: 'synthetic-record', entityId: 'synthetic-entity', label: 'Synthetic record', variable: 'synthetic-count', value: 0, unit: 'items', geometry: null, time: null, evidenceType: 'unknown', uncertainty: null, limitations: ['Synthetic isolation fixture only.'], reviewStatus: 'unreviewed', modelProcessing: false, source: { adapterId: 'synthetic-adapter', recordId: 'synthetic-1', title: 'Synthetic isolation fixture', locator: 'fixture 1', edition: 'test-v1', contentHash: 'a'.repeat(64) } });
const bundle = { records: [record], resultHash: 'b'.repeat(64) };
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 240"><g data-record-id="synthetic-record"><rect x="10" y="10" width="200" height="50" fill="#e8f3f5"/><text x="20" y="40">Synthetic record</text></g></svg>';
const spec = (program = `return ${JSON.stringify(svg)};`) => createRenderSpecification(bundle, program);

test('sandbox input binds exact evidence, code and fixed non-overridable resource limits', () => {
  const input = spec(); assert.equal(input.limits.executionMs, 50); assert.equal(input.limits.heapBytes, 8 * 1024 * 1024);
  assert.equal(VISUALIZATION_LIMITS.executionMs, 50); assert.deepEqual(validateRenderInput(input, bundle).specification, input);
  assert.throws(() => validateRenderInput({ ...input, program: 'return "changed";' }, bundle));
  assert.throws(() => validateRenderInput({ ...input, limits: { ...input.limits, heapBytes: 100000000 } }, bundle));
  assert.throws(() => validateRenderInput(input, { ...bundle, resultHash: 'c'.repeat(64) }));
});
test('the real WASM guest returns canonical data-bound SVG and releases its runtime', async () => {
  await initializeVisualization(); const result = evaluateVisualization(spec(), bundle);
  assert.equal(result.status, 'rendered'); if (result.status !== 'rendered') return;
  assert.match(result.svg, /data-record-id="synthetic-record"/); assert.equal(result.tree.tag, 'svg'); assert.ok(result.elapsedMs <= 50);
  assert.equal(result.runtime, 'quickjs-emscripten-0.32.0'); assert.equal(result.heapLimitBytes, 8388608);
});
test('VM globals, constructors and staged values do not expose browser, Node, I/O or host bridges', async () => {
  await initializeVisualization();
  const denied = ['window', 'document', 'fetch', 'XMLHttpRequest', 'WebSocket', 'localStorage', 'navigator', 'process', 'require', 'postMessage', 'importScripts', 'Worker', 'indexedDB'];
  const program = `const root = Function('return globalThis')(); for (const name of ${JSON.stringify(denied)}) { if (typeof root[name] !== 'undefined') throw Error('Unexpected capability'); } return ${JSON.stringify(svg)};`;
  assert.equal(evaluateVisualization(spec(program), bundle).status, 'rendered');
  for (const code of ['return fetch("https://fixture.invalid/");', 'return document.cookie;', 'return process.env;', 'return require("node:fs");', 'return import("https://fixture.invalid/module.js");', 'evidence[0].label = "Forged"; return "";']) assert.equal(evaluateVisualization(spec(code), bundle).status, 'fallback');
  assert.equal(record.label, 'Synthetic record');
});
test('the guest heap ceiling denies a 9 MiB allocation even when its successful output would be valid SVG', async () => {
  await initializeVisualization();
  const allocate = (bytes: number) => `const heap = new Uint8Array(${bytes}); heap.fill(1); return ${JSON.stringify(svg)};`;
  assert.equal(evaluateVisualization(spec(allocate(1024 * 1024)), bundle).status, 'rendered');
  const denied = evaluateVisualization(spec(allocate(9 * 1024 * 1024)), bundle); assert.equal(denied.status, 'fallback');
  if (denied.status === 'fallback') assert.equal(denied.code, 'GUEST_ERROR');
});
test('loop, recursion, allocation, thrown errors and excessive output fail closed under the real guest limits', async () => {
  await initializeVisualization();
  const loop = evaluateVisualization(spec('for (;;) {}'), bundle); assert.equal(loop.status, 'fallback'); if (loop.status === 'fallback') assert.equal(loop.code, 'TIMEOUT');
  for (const code of ['const value = new Uint8Array(16 * 1024 * 1024); return String(value.length);', 'function recur(){ return recur(); } return recur();', 'throw Error("private fixture diagnostics");', 'return "x".repeat(100000);']) {
    const result = evaluateVisualization(spec(code), bundle); assert.equal(result.status, 'fallback'); assert.equal(JSON.stringify(result).includes('private fixture diagnostics'), false);
  }
  for (let cycle = 0; cycle < 20; cycle++) assert.equal(evaluateVisualization(spec(), bundle).status, 'rendered');
});
test('SVG quarantine rejects executable/resource markup, forged provenance, invented text, DTDs and oversized trees', () => {
  assert.equal(parseSafeSVG(svg, bundle.records, 640, 240).tag, 'svg');
  for (const input of [
    svg.replace('<rect ', '<rect onclick="alert(1)" '), svg.replace('<rect ', '<image href="https://fixture.invalid/" '),
    svg.replace('<g ', '<rect x="0" y="0" width="640" height="240" fill="#fff"/><g '),
    svg.replace('<rect ', '<foreignObject '), svg.replace('fill="#e8f3f5"', 'fill="url(https://fixture.invalid/)"'),
    svg.replace('<text ', '<text font-family="sans-serif" '),
    svg.replace('Synthetic record</text>', 'Invented historical claim</text>'), svg.replace('synthetic-record', 'fabricated-record'),
    svg.replace('Synthetic record</text>', '<tspan>Synthetic</tspan> record</text>'),
    '<!DOCTYPE svg [<!ENTITY attack "expanded">]>' + svg, svg.replace('<g ', '<g style="display:none" '),
    svg.replace('</svg>', '<script>globalThis.canary=true</script></svg>'), '<svg xmlns="http://www.w3.org/2000/svg">' + '<g>'.repeat(1000) + '</g>'.repeat(1000) + '</svg>',
  ]) assert.throws(() => parseSafeSVG(input, bundle.records, 640, 240));
});
