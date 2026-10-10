import { initializeVisualization, evaluateVisualization } from '@chronicle/runtime/visualization';
import { VISUALIZATION_RUNTIME, VisualizationError } from '@chronicle/contracts/visualization';
import { boundedJSON } from '@chronicle/contracts/canonical';
import type { ResolvedEvidenceBundle } from '@chronicle/contracts/evidence';

const channel = globalThis as unknown as { postMessage(value: unknown): void; onmessage: ((event: MessageEvent) => void) | null };
const send = channel.postMessage.bind(channel); let used = false;
void initializeVisualization().then(() => {
  for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'WebTransport', 'EventSource', 'importScripts', 'indexedDB', 'caches']) Object.defineProperty(globalThis, name, { value: undefined, writable: false, configurable: false });
  channel.onmessage = event => {
    if (used) return; used = true;
    try {
      const request = boundedJSON(event.data, { bytes: 131072, depth: 16, nodes: 25000 }) as { type: string; specification: unknown; bundle: ResolvedEvidenceBundle };
      if (!request || request.type !== 'evaluate' || Object.keys(request).sort().join(',') !== 'bundle,specification,type') throw new VisualizationError('INVALID_SPEC');
      const result = evaluateVisualization(request.specification, request.bundle);
      if (result.status === 'rendered') { const { tree: _, ...wire } = result; send({ type: 'result', result: wire }); }
      else send({ type: 'result', result });
    } catch { send({ type: 'result', result: { status: 'fallback', code: 'INVALID_SPEC', elapsedMs: 0 } }); }
  };
  send({ type: 'ready', runtime: VISUALIZATION_RUNTIME });
}).catch(() => send({ type: 'result', result: { status: 'fallback', code: 'RUNTIME_UNAVAILABLE', elapsedMs: 0 } }));
