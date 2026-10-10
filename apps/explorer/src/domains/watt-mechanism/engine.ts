/** Loads only the two compiled, host-pinned Watt records. No specification, replay or model can supply a path. */
import { MechanismEngine as SharedMechanismEngine, type MechanismLoader } from '@chronicle/runtime/mechanism-engine';
import { MECHANISM_LIMITS } from '@chronicle/contracts/mechanism';
import { MechanismError } from '@chronicle/runtime/mechanism';
export type { MechanismLoader, MechanismResult } from '@chronicle/runtime/mechanism-engine';

export const WATT_DATASET_ID = 'watt-separate-condenser-1769';
export const WATT_PINS = Object.freeze({
  sourceHash: '26954b0bad98e7e7e99c2ad1fae2c0039cc82320269a2eb0283c152276310f90',
  datasetHash: '82bb7090501b0a1ced4d49634f291a9f6d67bdc732791952b735f1f07eb90ad8',
});

async function readPinned(url: URL, signal: AbortSignal, limit: number): Promise<string> {
  const response = await fetch(url, { signal, credentials: 'same-origin' });
  if (!response.ok || !response.body) throw new MechanismError('UNKNOWN_REFERENCE', 'A pinned mechanism record is unavailable.');
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new MechanismError('BUDGET_EXCEEDED', 'A mechanism record exceeds its byte limit.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
export function createWattLoader(): MechanismLoader {
  return {
    source: signal => readPinned(new URL('./source/watt-1769-specification.json', import.meta.url), signal, MECHANISM_LIMITS.sourceBytes),
    dataset: signal => readPinned(new URL('./data/watt-1769-mechanism.json', import.meta.url), signal, MECHANISM_LIMITS.datasetBytes),
  };
}
export class MechanismEngine extends SharedMechanismEngine {
  constructor(loader: MechanismLoader = createWattLoader()) {
    super({ datasetId: WATT_DATASET_ID, workspaceId: 'watt-separate-condenser-workspace', pins: WATT_PINS, loader });
  }
}
