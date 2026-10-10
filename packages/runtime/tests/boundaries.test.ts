import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { InteractionRuntime } from '../src/interaction.ts';
import { TimeMotion } from '../src/time-motion.ts';
import { ResearchController } from '../../../apps/explorer/src/research/workspace-controller.ts';
import { TimeMotion as CompatibleClock } from '../../../apps/explorer/src/time-motion.ts';
import { QueryPlanSchema } from '@chronicle/contracts/research';
import { QueryPlanSchema as CompatiblePlan } from '../../../apps/explorer/research-semantic/contracts.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
function files(path: string): string[] { return readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(resolve(path, entry.name)) : [resolve(path, entry.name)]); }
test('Explorer consumes the shared store, clock and exact schema instances', () => {
  const controller = new ResearchController(1769);
  assert.equal(controller instanceof InteractionRuntime, true);
  assert.equal(TimeMotion, CompatibleClock); assert.equal(QueryPlanSchema, CompatiblePlan);
  controller.dispose(); assert.equal(controller.getDiagnostics().listeners, 0);
});
test('extracted package implementation has no reverse application imports', () => {
  for (const name of ['contracts', 'runtime', 'planner', 'view-adapters']) {
    const source = resolve(root, 'packages', name, 'src');
    for (const path of files(source).filter(path => path.endsWith('.ts'))) {
      const text = readFileSync(path, 'utf8');
      for (const match of text.matchAll(/(?:import|export)\s+(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/g)) {
        const specifier = match[1];
        if (specifier.startsWith('.')) assert.equal(resolve(dirname(path), specifier).startsWith(resolve(root, 'packages')), true, path + ': ' + specifier);
        assert.equal(/apps\/|explorer\/src/.test(specifier), false);
      }
    }
  }
});
test('planner credentials are exported through a Node-only package condition, not the browser entry', () => {
  const path = resolve(root, 'packages/planner'), manifest = JSON.parse(readFileSync(resolve(path, 'package.json'), 'utf8'));
  assert.equal(manifest.exports['./gemini'].node, './src/gemini-provider.ts');
  assert.equal(manifest.exports['./gemini'].default, './src/node-only.ts');
  assert.equal(/gemini-provider|node:fs|process\.env/.test(readFileSync(resolve(path, 'src/index.ts'), 'utf8') + readFileSync(resolve(path, 'src/node-only.ts'), 'utf8')), false);
});
