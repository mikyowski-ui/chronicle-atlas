import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkspaceEngine, MODERN_ID, PREMODERN_ID, PREMODERN_HASH, type WorkspaceRegistry } from '../src/research/workspace-engine.ts';
import { ResearchController } from '../src/research/workspace-controller.ts';
import { canonicalJSON, hashText, type DatasetRegistry } from '../src/research/engine.ts';
import { PILOT_DESCRIPTOR } from '../src/research/registry.ts';
import { registerModernPilot, registerFixture } from '../research-semantic/catalogue.ts';
import {
  MechanismEngine, MechanismReplaySchema, WATT_DATASET_ID, WATT_PINS, compileMechanismPlan, exportMechanismReplay, registerMechanism, resolveMechanism,
  resolveMechanismSelection, specForMechanism, validateMechanismSpecification, type MechanismLoader,
} from '../src/domains/watt-mechanism/index.ts';

const app = fileURLToPath(new URL('../', import.meta.url));
const domain = resolve(app, 'src/domains/watt-mechanism');
const sourceRaw = readFileSync(resolve(domain, 'source/watt-1769-specification.json'), 'utf8');
const datasetRaw = readFileSync(resolve(domain, 'data/watt-1769-mechanism.json'), 'utf8');
const modern = readFileSync(resolve(app, 'src/research/pilot-data.json'), 'utf8');
const premodern = readFileSync(resolve(app, 'research-semantic/premodern-pilot.json'), 'utf8');
const pinsFor = (source: unknown, dataset: unknown) => ({ sourceHash: hashText(canonicalJSON(source)), datasetHash: hashText(canonicalJSON(dataset)) });
const code = (expected: string) => (error: unknown) => (error as { code?: string }).code === expected;
const registration = () => registerMechanism(sourceRaw, datasetRaw, WATT_PINS);
function loader(loads: string[] = []): MechanismLoader {
  return { source: async () => { loads.push('source'); return sourceRaw; }, dataset: async () => { loads.push('dataset'); return datasetRaw; } };
}
function geographic(): WorkspaceRegistry {
  return new Map([[MODERN_ID, { load: async () => modern, register: registerModernPilot }], [PREMODERN_ID, { load: async () => premodern, register: (raw: string) => registerFixture(raw, PREMODERN_HASH) }]]);
}
const legacy = (): DatasetRegistry => new Map([[MODERN_ID, { descriptor: PILOT_DESCRIPTOR, load: async () => modern }]]);
const controller = (mechanisms = new MechanismEngine(loader())) => new ResearchController(1769, new WorkspaceEngine(geographic(), legacy()), 5000, {}, mechanisms);
function deferred<T>() { let release!: (value: T) => void; const promise = new Promise<T>(done => { release = done; }); return { promise, release }; }
/** Re-pins a mutated copy so content checks beyond the edition hash are exercised. */
function repinned(mutateSource: (source: any) => void, mutateDataset: (dataset: any) => void = () => {}) {
  const source = JSON.parse(sourceRaw), dataset = JSON.parse(datasetRaw);
  mutateSource(source); dataset.sourceSha256 = hashText(canonicalJSON(source)); mutateDataset(dataset);
  return () => registerMechanism(JSON.stringify(source), JSON.stringify(dataset), pinsFor(source, dataset));
}

test('M4-W01: pinned Watt excerpt and records register; every quotation occurs verbatim in its hash-verified passage', () => {
  const { source, dataset, descriptor } = registration();
  assert.deepEqual(pinsFor(JSON.parse(sourceRaw), JSON.parse(datasetRaw)), { ...WATT_PINS });
  assert.equal(dataset.sourceSha256, WATT_PINS.sourceHash); assert.equal(descriptor.id, WATT_DATASET_ID);
  assert.deepEqual([dataset.components.length, dataset.functions.length, dataset.claims.length], [8, 8, 14]);
  const passages = new Map(source.passages.map(item => [item.id, item]));
  for (const passage of source.passages) assert.equal(hashText(passage.text), passage.sha256);
  for (const claim of dataset.claims) assert.equal(passages.get(claim.passageId)!.text.includes(claim.quote), true, claim.id);
  assert.equal(dataset.claims.filter(claim => claim.evidence === 'attested-specification-text').length, 12);
  assert.deepEqual([source.modelProcessing, source.republication, source.rights], [false, false, 'public-domain-text']);
  assert.equal(dataset.spatialSupport.kind, 'not-applicable');
  const intake = spawnSync(process.execPath, ['scripts/intake-watt-1769.mjs'], { cwd: app, encoding: 'utf8' });
  assert.equal(intake.status, 0, intake.stderr); assert.equal(JSON.parse(intake.stdout).status, 'PASS');
});

test('M4-W02: edited quotations, passages, references and spatial fields fail closed even when re-pinned', () => {
  const dataset = JSON.parse(datasetRaw); dataset.title += ' edited';
  assert.throws(() => registerMechanism(sourceRaw, JSON.stringify(dataset), WATT_PINS), code('EDITION_MISMATCH'));
  assert.throws(repinned(() => {}, d => { d.claims[1].quote = d.claims[1].quote.replace('steam vessel', 'steam cylinder'); }), code('EVIDENCE_MISMATCH'));
  assert.throws(repinned(s => { s.passages[0].text = s.passages[0].text.replace('condensers', 'coolers'); }), code('EVIDENCE_MISMATCH'));
  assert.throws(repinned(() => {}, d => { d.claims[12].evidence = 'attested-specification-text'; }), code('EVIDENCE_MISMATCH'));
  assert.throws(repinned(() => {}, d => { d.claims[0].passageId = 'unregistered-passage'; }), code('UNKNOWN_REFERENCE'));
  assert.throws(repinned(() => {}, d => { d.components[0].claimIds = ['c-unknown']; }), code('UNKNOWN_REFERENCE'));
  assert.throws(repinned(() => {}, d => { d.functions[0].componentIds.push('flywheel'); }), code('UNKNOWN_REFERENCE'));
  assert.throws(repinned(() => {}, d => { for (const fn of d.functions) fn.componentIds = fn.componentIds.filter((id: string) => id !== 'fluid-sealants'); }), code('INVALID_SPEC'));
  assert.throws(repinned(() => {}, d => { d.claims.push({ ...d.claims[0], id: 'c-unused' }); }), code('INVALID_SPEC'));
  assert.throws(repinned(() => {}, d => { d.functions[0].id = 'steam-vessel'; }), code('INVALID_SPEC'));
  assert.throws(repinned(() => {}, d => { d.components[0].coordinates = [-3.2, 55.9]; }), code('INVALID_SPEC'));
  assert.throws(repinned(() => {}, d => { d.spatialSupport = { kind: 'point', note: 'Inferred workshop location.' }; }), code('INVALID_SPEC'));
  assert.throws(repinned(s => { s.modelProcessing = true; }), code('INVALID_SPEC'));
  assert.throws(repinned(() => {}, d => { d.components[0].role = '<img src=x onerror=alert(1)>'; }), code('INVALID_SPEC'));
});

test('M4-W03: trusted recompilation rejects forged plans, map views, duplicate views, forged registrations and unbounded input', () => {
  const registered = registration(), spec = specForMechanism(registered);
  assert.deepEqual(validateMechanismSpecification(spec, registered), spec);
  const forged = (mutate: (value: any) => void) => { const value = JSON.parse(JSON.stringify(spec)); mutate(value); return () => validateMechanismSpecification(value, registered); };
  assert.throws(forged(value => { value.plan.dataHash = 'f'.repeat(64); }), code('EDITION_MISMATCH'));
  assert.throws(forged(value => { value.plan.componentIds = value.plan.componentIds.slice(1); }), code('EDITION_MISMATCH'));
  assert.throws(forged(value => { value.plan.policyVersion = 'mechanism-evidence-0'; }), code('INVALID_SPEC'));
  assert.throws(forged(value => { value.views.push({ id: 'view-map', type: 'map', binding: 'mechanism' }); }), code('INVALID_SPEC'));
  assert.throws(forged(value => { value.views[1].type = 'summary'; }), code('INVALID_SPEC'));
  assert.throws(forged(value => { value.script = 'alert(1)'; }), code('INVALID_SPEC'));
  assert.throws(forged(value => { value.title = 'x'.repeat(70000); }), code('BUDGET_EXCEEDED'));
  let nested: unknown = {}; for (let depth = 0; depth < 40; depth++) nested = { nested };
  assert.throws(() => validateMechanismSpecification(nested, registered), code('BUDGET_EXCEEDED'));
  assert.throws(() => compileMechanismPlan(JSON.parse(JSON.stringify(registered))), code('EDITION_MISMATCH'));
});

test('M4-W04: selections must be declared row-claim pairs and undeclared pairs are never exported', () => {
  const registered = registration(), spec = specForMechanism(registered), bundle = resolveMechanism(spec, registered);
  assert.equal(resolveMechanismSelection(bundle, { entityId: 'condenser', observationId: 'c-second-cold' })?.kind, 'component');
  assert.equal(resolveMechanismSelection(bundle, { entityId: 'separate-condensation', observationId: 'c-second-condensers' })?.kind, 'function');
  assert.equal(resolveMechanismSelection(bundle, { entityId: 'condenser', observationId: 'c-third-pumps' }), null);
  assert.equal(resolveMechanismSelection(bundle, { entityId: 'flywheel', observationId: 'c-second-cold' }), null);
  assert.equal(JSON.parse(exportMechanismReplay(spec, bundle, 1769, { entityId: 'condenser', observationId: 'c-third-pumps' })).selection, null);
  assert.equal(bundle.resultHash, resolveMechanism(specForMechanism(registration()), registration()).resultHash);
});

test('M4-W05: the shared store opens the mechanism without map scope, accepts only current typed selections and keeps the cursor separate', async () => {
  const loads: string[] = [], c = controller(new MechanismEngine(loader(loads)));
  assert.equal(await c.openMechanism(WATT_DATASET_ID), true);
  const opened = c.getSnapshot();
  assert.equal(opened.active, null); assert.equal(opened.selection, null); assert.equal(opened.selectedEvidence, null);
  assert.deepEqual(opened.analysisTimeWindow, { start: 1769, end: 1769 }); assert.equal(opened.mechanism?.spec.plan.domain, 'technological-mechanism');
  assert.equal(Object.isFrozen(opened.mechanism?.bundle.claims[0]), true);
  const select = (entityId: string, observationId: string, revision = c.getSnapshot().revision) => c.dispatch({ type: 'select', entityId, observationId, origin: 'component-table', revision });
  assert.equal(select('condenser', 'c-second-cold', opened.revision - 1), false);
  assert.equal(select('condenser', 'c-third-pumps'), false);
  assert.equal(select('condenser', 'c-second-cold'), true); assert.equal(select('condenser', 'c-second-cold'), false);
  const mechanism = c.getSnapshot().mechanism;
  assert.equal(c.dispatch({ type: 'cursor', year: 1800, origin: 'timeline', revision: c.getSnapshot().revision }), true);
  assert.equal(c.getSnapshot().mechanism, mechanism); assert.deepEqual(c.getSnapshot().selection, { entityId: 'condenser', observationId: 'c-second-cold' });
  assert.equal(c.dispatch({ type: 'clear-selection', origin: 'function-table', revision: c.getSnapshot().revision }), true);
  assert.equal(await c.openMechanism(WATT_DATASET_ID), true); assert.deepEqual(loads, ['source', 'dataset']);
  assert.equal(await c.openMechanism('unregistered-mechanism'), false); assert.equal(c.getSnapshot().errorCode, 'UNKNOWN_REFERENCE');
  assert.equal(c.getProviderStatus().modelProcessing, false); assert.equal(c.getDiagnostics().mechanisms.registered, true);
  c.dispose(); assert.equal(c.getDiagnostics().mechanisms.registered, false);
});

test('M4-W06: save/reopen is byte-identical, restores cursor and selection, and uses only the two pinned local records', async () => {
  const first = controller();
  await first.openMechanism(WATT_DATASET_ID);
  first.dispatch({ type: 'select', entityId: 'extract-uncondensed', observationId: 'c-third-pumps', origin: 'function-table', revision: first.getSnapshot().revision });
  first.dispatch({ type: 'cursor', year: 1800, origin: 'timeline', revision: first.getSnapshot().revision });
  const saved = first.exportManifest(), archive = MechanismReplaySchema.parse(JSON.parse(saved));
  assert.equal(saved, canonicalJSON(archive) + '\n'); assert.equal(archive.cursorYear, 1800);
  for (const claim of first.getSnapshot().mechanism!.bundle.claims) assert.equal(saved.includes(claim.quote), false, 'replay keeps references, not source text');
  assert.equal(/GEMINI|api[_-]?key|https?:/i.test(saved), false);
  const loads: string[] = [], second = controller(new MechanismEngine(loader(loads)));
  assert.equal(await second.replay(JSON.parse(saved)), true);
  const reopened = second.getSnapshot();
  assert.equal(second.exportManifest(), saved); assert.equal(hashText(second.exportManifest()), hashText(saved));
  assert.equal(reopened.cursorYear, 1800); assert.deepEqual(reopened.selection, { entityId: 'extract-uncondensed', observationId: 'c-third-pumps' });
  assert.equal(reopened.mechanism!.bundle.resultHash, first.getSnapshot().mechanism!.bundle.resultHash);
  assert.deepEqual(loads, ['source', 'dataset']); first.dispose(); second.dispose();
});

test('M4-W07: tampered or mismatched mechanism replays are rejected and the previous result remains visible', async () => {
  const c = controller(); await c.openMechanism(WATT_DATASET_ID);
  c.dispatch({ type: 'select', entityId: 'condenser', observationId: 'c-second-condensers', origin: 'component-table', revision: c.getSnapshot().revision });
  const saved = c.getSnapshot(), text = c.exportManifest();
  const mutations: ((archive: any) => void)[] = [
    archive => { archive.specification.plan.dataHash = 'e'.repeat(64); },
    archive => { archive.specification.plan.edition = 'chronicle-mechanism-local-latest'; },
    archive => { archive.selection = { entityId: 'condenser', observationId: 'c-third-pumps' }; },
    archive => { archive.versions.policy = 'mechanism-evidence-0'; },
    archive => { archive.sourceText = 'full source document'; },
    archive => { archive.cursorYear = 99999; },
    archive => { archive.specification.views.push({ id: 'view-map', type: 'map', binding: 'mechanism' }); },
    archive => { archive.kind = 'chronicle-workspace-replay'; },
    archive => { archive.specification.title = 'x'.repeat(70000); },
  ];
  for (const mutate of mutations) {
    const archive = JSON.parse(text); mutate(archive);
    assert.equal(await c.replay(archive), false);
    assert.equal(c.getSnapshot().mechanism, saved.mechanism); assert.equal(c.getSnapshot().revision, saved.revision); assert.deepEqual(c.getSnapshot().selection, saved.selection);
  }
  c.dispose();
});

test('M4-W08: geographic and mechanism results share one latest-wins store; stale completions and domain switches cannot mix evidence', async () => {
  const gate = deferred<string>(), slow: MechanismLoader = { source: () => gate.promise, dataset: async () => datasetRaw };
  const c = controller(new MechanismEngine(slow));
  const stale = c.openMechanism(WATT_DATASET_ID);
  assert.equal(await c.openPilot(PREMODERN_ID), true); gate.release(sourceRaw);
  assert.equal(await stale, false); assert.equal(c.getSnapshot().mechanism, null); assert.equal(c.getSnapshot().active?.spec.plan.scope.datasetId, PREMODERN_ID);
  const row = c.getSnapshot().active!.bundle.observations[0];
  assert.equal(c.dispatch({ type: 'select', entityId: row.entityId, observationId: row.id, origin: 'table', revision: c.getSnapshot().revision }), true);
  assert.equal(c.dispatch({ type: 'select', entityId: 'condenser', observationId: 'c-second-cold', origin: 'component-table', revision: c.getSnapshot().revision }), false);
  assert.equal(await c.openMechanism(WATT_DATASET_ID), true);
  assert.equal(c.getSnapshot().active, null); assert.equal(c.getSnapshot().selection, null);
  assert.equal(c.dispatch({ type: 'select', entityId: row.entityId, observationId: row.id, origin: 'table', revision: c.getSnapshot().revision }), false);
  assert.equal(JSON.parse(c.exportManifest()).kind, 'chronicle-mechanism-replay');
  c.dispatch({ type: 'select', entityId: 'piston', observationId: 'c-last-sealing', origin: 'component-table', revision: c.getSnapshot().revision });
  assert.equal(await c.openPilot(MODERN_ID), true);
  assert.equal(c.getSnapshot().mechanism, null); assert.equal(c.getSnapshot().selection, null); assert.equal(JSON.parse(c.exportManifest()).kind, 'chronicle-workspace-replay');
  c.close(); assert.deepEqual([c.getSnapshot().active, c.getSnapshot().mechanism], [null, null]); c.dispose();
});

test('M4-W10: replay validates inputs before routing and accepts serialized mechanism archives', async () => {
  const c = controller();
  try {
    assert.equal(await c.openMechanism(WATT_DATASET_ID), true);
    const saved = c.getSnapshot(), text = c.exportManifest();
    let reads = 0;
    const accessor = Object.defineProperty({}, 'kind', { enumerable: true, get() { reads++; throw new Error('Untrusted accessor'); } });
    assert.equal(await c.replay(accessor), false);
    assert.equal(reads, 0); assert.equal(c.getSnapshot().mechanism, saved.mechanism); assert.equal(c.getSnapshot().revision, saved.revision);
    assert.equal(await c.replay(text), true);
    assert.equal(c.exportManifest(), text);
  } finally { c.dispose(); }
});

test('M4-W09: the Watt domain imports no MapLibre, canvas, spatial or geographic workspace modules', () => {
  const allowedFiles = new Set([resolve(app, 'src/research/canonical.ts'), resolve(app, 'research-semantic/zod.ts')]);
  const allowedPackages = new Set(['zod', '@noble/hashes/sha2.js']);
  const root = resolve(app, '../..'), shared = ['contracts', 'runtime', 'view-adapters'].map(name => resolve(root, 'packages', name, 'src'));
  const visited = new Set<string>(), packages = new Set<string>(), queue = [resolve(domain, 'index.ts'), resolve(domain, 'view.ts')];
  while (queue.length) {
    const file = queue.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    assert.equal(file.startsWith(domain) || allowedFiles.has(file) || shared.some(path => file.startsWith(path)), true, `unexpected dependency ${relative(app, file)}`);
    if (!file.endsWith('.ts')) continue;
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/(?:import|export)\s+(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/g)) {
      const specifier = match[1];
      if (specifier.startsWith('.')) { const target = resolve(dirname(file), specifier); assert.equal(existsSync(target), true, specifier); queue.push(target); }
      else if (specifier.startsWith('@chronicle/')) {
        const match = /^@chronicle\/(contracts|runtime|view-adapters)(?:\/(.+))?$/.exec(specifier); assert.ok(match, specifier);
        const directory = resolve(root, 'packages', match[1]);
        const manifest = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'));
        const target = manifest.exports[match[2] ? `./${match[2]}` : '.']; assert.equal(typeof target, 'string'); queue.push(resolve(directory, target));
      } else packages.add(specifier);
    }
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.equal(/maplibre|pmtiles|vector-tile|geojson|getContext|coordinates|bbox|longitude|latitude|projection|seekYear/i.test(code), false, relative(app, file));
    if (file.startsWith(domain)) assert.equal(/canvas|createElementNS|\bsvg\b/i.test(code), false, relative(app, file));
  }
  assert.deepEqual([...packages].filter(item => !allowedPackages.has(item)), []);
  assert.equal([...visited].some(file => /src[\\/]research[\\/](view|workspace-engine|engine|contracts|registry)\.ts$|research-semantic[\\/](contracts|catalogue|workspace-contract)\.ts$/.test(file)), false);
  const spatialKeys: string[] = [];
  const walk = (value: unknown, path: string): void => {
    if (Array.isArray(value)) { value.forEach((item, index) => walk(item, `${path}[${index}]`)); return; }
    if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) { if (/^(coordinates|bbox|geometry|longitude|latitude|lon|lat)$/i.test(key)) spatialKeys.push(`${path}.${key}`); walk(child, `${path}.${key}`); }
  };
  walk(JSON.parse(datasetRaw), '$'); walk(JSON.parse(sourceRaw), '$');
  assert.deepEqual(spatialKeys, []);
});
