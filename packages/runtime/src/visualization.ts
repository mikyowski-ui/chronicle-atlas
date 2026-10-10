import { getQuickJS, type QuickJSWASMModule, type QuickJSRuntime, type QuickJSContext, type QuickJSHandle } from 'quickjs-emscripten';
import { canonicalJSON, immutable } from '@chronicle/contracts/canonical';
import { VISUALIZATION_LIMITS, VISUALIZATION_RUNTIME, VisualizationError, validateRenderInput, projectVisualizationRecords, type VisualizationResult, type SafeSVGNode } from '@chronicle/contracts/visualization';
import type { ResolvedEvidenceBundle } from '@chronicle/contracts/evidence';
import { parseSafeSVG, serializeSafeSVG } from './visualization-output.ts';

let module: QuickJSWASMModule | null = null, disabled = false;
export async function initializeVisualization(): Promise<void> {
  if (disabled) throw new VisualizationError('RUNTIME_UNAVAILABLE');
  module = await getQuickJS();
}
export function evaluateVisualization(input: unknown, bundle: ResolvedEvidenceBundle, signal?: AbortSignal): VisualizationResult {
  const start = performance.now(); let runtime: QuickJSRuntime | undefined, context: QuickJSContext | undefined, value: QuickJSHandle | undefined;
  let code: Extract<VisualizationResult, { status: 'fallback' }>['code'] | null = null, timedOut = false, svg = '', tree: SafeSVGNode | undefined;
  let checked: ReturnType<typeof validateRenderInput> | undefined;
  try {
    if (signal?.aborted) throw new VisualizationError('CANCELLED');
    checked = validateRenderInput(input, bundle); if (!module || disabled) throw new VisualizationError('RUNTIME_UNAVAILABLE');
    runtime = module.newRuntime(); runtime.setMemoryLimit(VISUALIZATION_LIMITS.heapBytes); runtime.setMaxStackSize(VISUALIZATION_LIMITS.stackBytes);
    runtime.setModuleLoader(() => { throw new Error('MODULES_DISABLED'); });
    runtime.setInterruptHandler(() => { timedOut ||= performance.now() - start >= VISUALIZATION_LIMITS.executionMs; return timedOut || signal?.aborted === true; });
    context = runtime.newContext();
    const data = projectVisualizationRecords(checked.records);
    const source = `"use strict";
for (const name of ["window","document","fetch","XMLHttpRequest","WebSocket","WebTransport","EventSource","localStorage","navigator","process","require","postMessage","importScripts","Worker","SharedWorker","indexedDB","caches","Date","performance","Atomics","SharedArrayBuffer","WebAssembly","console"]) Object.defineProperty(globalThis,name,{value:undefined,writable:false,configurable:false});
Object.defineProperty(Math,"random",{value:undefined,writable:false,configurable:false});
const readonly = value => { if (value && typeof value === "object") { for (const item of Object.values(value)) readonly(item); Object.freeze(value); } return value; };
(function(evidence) { "use strict"; ${checked.specification.program}\n})(readonly(JSON.parse(${JSON.stringify(canonicalJSON(data))})));`;
    const result = context.evalCode(source, 'chronicle-visualization.js', { type: 'global' });
    value = result.error ?? result.value;
    if (result.error) throw new VisualizationError(timedOut ? 'TIMEOUT' : signal?.aborted ? 'CANCELLED' : 'GUEST_ERROR');
    if (context.typeof(value) !== 'string') throw new VisualizationError('INVALID_OUTPUT');
    const length = context.getProp(value, 'length');
    try { if (context.getNumber(length) > VISUALIZATION_LIMITS.outputBytes) throw new VisualizationError('OUTPUT_LIMIT'); } finally { length.dispose(); }
    svg = context.getString(value);
    tree = parseSafeSVG(svg, checked.records, checked.specification.width, checked.specification.height); svg = serializeSafeSVG(tree);
    if (new TextEncoder().encode(svg).byteLength > VISUALIZATION_LIMITS.outputBytes) throw new VisualizationError('OUTPUT_LIMIT');
  } catch (error) { code = error instanceof VisualizationError ? error.code : 'GUEST_ERROR'; }
  finally {
    try { value?.dispose(); context?.dispose(); runtime?.dispose(); }
    catch { disabled = true; code = 'RUNTIME_UNAVAILABLE'; }
  }
  const elapsedMs = performance.now() - start;
  if (signal?.aborted) code = 'CANCELLED'; else if (timedOut || elapsedMs > VISUALIZATION_LIMITS.executionMs) code = 'TIMEOUT';
  if (code || !tree || !checked) return immutable({ status: 'fallback', code: code ?? 'INVALID_OUTPUT', elapsedMs });
  return immutable({ status: 'rendered', svg, tree, programHash: checked.specification.programHash, inputHash: checked.specification.inputHash, bundleHash: checked.specification.bundleHash, elapsedMs, runtime: VISUALIZATION_RUNTIME, heapLimitBytes: 8388608 });
}
