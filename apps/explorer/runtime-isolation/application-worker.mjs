/**
 * Reviewed fixture runner for the application-level fallback.
 *
 * This is NOT an arbitrary-JavaScript security boundary. A Node Worker and
 * node:vm do not supply OS network, filesystem, or aggregate RSS isolation.
 * The caller may select only the fixed operations below; executable source,
 * paths, URLs, host objects, callbacks, and provider credentials are not inputs.
 * Parent Worker resourceLimits and termination provide the outer lifecycle.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { createContext, Script } from 'node:vm';

const FIXTURES = new Set([
  'network', 'dom', 'environment', 'filesystem', 'processes',
  'constructor-escape', 'prototype-pollution', 'unauthorized-call',
  'infinite-loop', 'memory-flood', 'output-flood', 'diagnostic-flood',
  'malformed-output', 'markup-output', 'forged-output', 'crash', 'partial-output',
]);
const MAX_VALUES = 2_000;
const EXECUTION_MILLISECONDS = 100;

// These snippets are hand-authored fixtures, not strings supplied by a model
// or request. All objects and functions they use originate inside the VM.
const CAPABILITY_FIXTURES = Object.freeze({
  network: `
    const unavailable = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource',
      'navigator', 'location', 'importScripts'];
    return unavailable.every(name => typeof globalThis[name] === 'undefined');
  `,
  dom: `
    return ['document', 'window', 'HTMLElement', 'DOMParser', 'MutationObserver']
      .every(name => typeof globalThis[name] === 'undefined');
  `,
  environment: `
    try { return typeof process === 'undefined' && typeof Deno === 'undefined'
      && typeof Bun === 'undefined' && typeof global === 'undefined'; }
    catch { return false; }
  `,
  filesystem: `
    return ['require', 'module', 'exports', '__dirname', '__filename', 'File',
      'showOpenFilePicker'].every(name => typeof globalThis[name] === 'undefined');
  `,
  processes: `
    return ['process', 'Worker', 'SharedWorker', 'child_process', 'setTimeout',
      'setInterval'].every(name => typeof globalThis[name] === 'undefined');
  `,
  'constructor-escape': `
    let denied = 0;
    const probes = [
      () => ({}).constructor.constructor('return process')(),
      () => globalThis.constructor.constructor('return process')(),
      () => (() => {}).constructor('return process')(),
      () => eval('process'),
    ];
    for (const probe of probes) {
      try { probe(); } catch (error) {
        if (error instanceof EvalError || error instanceof TypeError
            || error instanceof ReferenceError) denied++;
      }
    }
    return denied === probes.length;
  `,
  'prototype-pollution': `
    let denied = 0;
    try { Object.prototype.syntheticPollution = true; } catch { denied++; }
    try { Array.prototype.syntheticPollution = true; } catch { denied++; }
    try { Function.prototype.syntheticPollution = true; } catch { denied++; }
    try { Object.setPrototypeOf(Object.prototype, { syntheticPollution: true }); }
      catch { denied++; }
    const inherited = {};
    return denied === 4 && !('syntheticPollution' in inherited)
      && Object.isFrozen(Object.prototype) && Object.isFrozen(Array.prototype);
  `,
  'unauthorized-call': `
    let denied = 0;
    for (const name of ['host', 'catalogue', 'provider', 'publication', 'map',
      'fetch', 'require', 'postMessage']) {
      try { globalThis[name](); } catch (error) {
        if (error instanceof TypeError || error instanceof ReferenceError) denied++;
      }
    }
    return denied === 8;
  `,
});

function sendFailure(code) {
  parentPort?.postMessage({ kind: 'failure', code });
}

function validInput(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return false;
  const keys = Object.keys(input);
  return keys.length === 2 && keys.includes('operation') && keys.includes('values')
    && typeof input.operation === 'string'
    && (input.operation === 'sum-v1' || FIXTURES.has(input.operation))
    && Array.isArray(input.values) && input.values.length <= MAX_VALUES
    && input.values.every(value => typeof value === 'number'
      && Number.isFinite(value) && Math.abs(value) <= 1e12)
    && (input.operation !== 'sum-v1' || input.values.length > 0)
    && (input.operation === 'sum-v1' || input.values.length === 0);
}

function run() {
  if (!parentPort || !validInput(workerData)) {
    sendFailure('INVALID_REQUEST');
    return;
  }
  const { operation, values } = workerData;
  const context = createContext(Object.create(null), {
    name: 'chronicle-reviewed-fixtures',
    codeGeneration: { strings: false, wasm: false },
    microtaskMode: 'afterEvaluate',
  });
  // No outside object or function is injected. Hide nondeterministic and
  // externally allocated memory capabilities even from reviewed fixtures.
  const prelude = `
    'use strict';
    for (const name of ['console', 'Date', 'WebAssembly', 'SharedArrayBuffer',
      'ArrayBuffer', 'DataView', 'Int8Array', 'Uint8Array', 'Uint8ClampedArray',
      'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array', 'Float32Array',
      'Float64Array', 'BigInt64Array', 'BigUint64Array', 'Atomics', 'WeakRef', 'FinalizationRegistry']) {
      Object.defineProperty(globalThis, name, {
        value: undefined, writable: false, configurable: false,
      });
    }
    for (const intrinsic of [Object, Array, Function, Number, String, Boolean,
      RegExp, Error, TypeError, RangeError, SyntaxError, ReferenceError, EvalError,
      Promise, Map, Set, WeakMap, WeakSet]) {
      Object.freeze(intrinsic.prototype);
      Object.freeze(intrinsic);
    }
    Object.freeze(JSON);
    Object.defineProperty(Math, 'random', { value: undefined, writable: false, configurable: false });
    Object.freeze(Math);
  `;
  let body;
  if (operation === 'sum-v1') {
    // Every staged value is a bounded finite number, so JSON.stringify can
    // produce numeric literals only. Source text is never an input capability.
    body = `const values = ${JSON.stringify(values)};
      JSON.stringify({schema: 1, count: values.length,
        sum: values.reduce((total, value) => total + value, 0)});`;
  } else if (Object.hasOwn(CAPABILITY_FIXTURES, operation)) {
    body = `JSON.stringify({schema: 1, denied: (() => {
      ${CAPABILITY_FIXTURES[operation]}
    })()});`;
  } else if (operation === 'infinite-loop') {
    body = 'for (;;) {}';
  } else if (operation === 'memory-flood') {
    // Heap-backed arrays intentionally exercise the parent's V8 heap limit.
    // No ArrayBuffer/external-memory allocation is used or accepted as input.
    body = 'const retained = []; for (;;) retained.push(new Array(1_000_000).fill(7));';
  } else if (operation === 'output-flood') {
    body = "'x'.repeat(8_192);";
  } else if (operation === 'diagnostic-flood') {
    body = "'synthetic-diagnostic'.repeat(128);";
  } else if (operation === 'malformed-output') {
    body = "'{\"schema\":1,\"schema\":2}';";
  } else if (operation === 'markup-output') {
    body = "'{\"schema\":1,\"html\":\"<script>x</script>\"}';";
  } else if (operation === 'forged-output') {
    body = "'{\"schema\":1,\"count\":1,\"sum\":999999}';";
  } else if (operation === 'partial-output') {
    body = "'{';";
  } else if (operation === 'crash') {
    body = "throw new Error('synthetic fixture crash');";
  } else {
    sendFailure('UNKNOWN_OPERATION');
    return;
  }
  try {
    const bytes = new Script(`${prelude}\n${body}`, {
      filename: 'reviewed-application-fixture',
    }).runInContext(context, { timeout: EXECUTION_MILLISECONDS });
    // Untrusted VM objects never reach host conversion, inspection, logging,
    // or messaging. Only a primitive string may cross the result boundary.
    if (typeof bytes !== 'string') {
      sendFailure('INVALID_OUTPUT');
      return;
    }
    parentPort.postMessage({
      kind: operation === 'diagnostic-flood' ? 'diagnostic' : 'output', bytes,
    });
  } catch (error) {
    // VM-thrown objects must not be inspected: an accessor could execute guest
    // code outside runInContext's timeout. Report static diagnostics only.
    // The reviewed infinite-loop fixture is the only intentional timeout here;
    // memory pressure may instead terminate the entire Worker in the parent.
    sendFailure(operation === 'infinite-loop' || operation === 'memory-flood'
      ? 'EXECUTION_TIMEOUT' : 'BOUNDARY_CRASH');
  }
}

run();
parentPort?.close();
