import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { AlphaManifest, SceneSnapshot } from '../../../packages/contracts/src/index.ts';
import { createAlphaLoader, validateAlphaManifest } from '../src/alpha.ts';
import { DisplayResolver, chooseTrack, type DisplayTrack } from '../src/display-policy.ts';
import { selectEntity } from '../src/picking.ts';
import { sceneRenderSignature } from '../src/scene-signature.ts';
const origin = 'https://example.test/alpha/';
const signal = () => new AbortController().signal;
const layers = { population: false, migration: false };
const localFetcher: typeof fetch = async input => new Response(await readFile(new URL(`../public${new URL(String(input)).pathname}`, import.meta.url)));
async function track(name = 'historical', canvas = true): Promise<DisplayTrack> {
  const manifest: AlphaManifest = validateAlphaManifest(JSON.parse(await readFile(new URL(`../public/alpha/${name}-manifest.json`, import.meta.url), 'utf8')), `${origin}${name}-manifest.json`);
  return { id: name, manifest, loader: createAlphaLoader(manifest, `${origin}${name}-manifest.json`, canvas, localFetcher) };
}
function day(year: number): number { const d = new Date(0); d.setUTCFullYear(year, 0, 1); return d.getTime() / 86400000; }

test('reference policy uses only earlier political observations; exact gaps and pre-coverage dates stay empty', async () => {
  const t = await track(); const resolver = new DisplayResolver(t.manifest.base_geography);
  const before = t.manifest.epochs[0].t_start - 1;
  for (const policy of ['exact', 'reference'] as const) {
    const plan = resolver.resolve(t, before, policy, layers);
    assert.equal(plan.representation, 'missing'); assert.equal(plan.political, undefined); assert.equal(plan.displayedTime, null);
  }
  const gap = resolver.resolve(t, day(1684), 'exact', layers);
  assert.equal(gap.representation, 'missing'); assert.equal(gap.displayedTime, null);
  const previous = resolver.resolve(t, day(1684), 'reference', layers);
  assert.equal(previous.political?.epoch_id, 'isles-1650');
  assert.equal(previous.requestedTime, day(1684)); assert.equal(previous.displayedTime, day(1650));
  assert.equal(previous.representation, 'reference');
  const exact = resolver.resolve(t, day(1700), 'reference', layers);
  assert.equal(exact.representation, 'exact'); assert.equal(exact.displayedTime, day(1700));
});

test('reference materialization preserves original geometry validity and cheap advancement keeps immutable arrays', async () => {
  const t = await track(); const resolver = new DisplayResolver(t.manifest.base_geography);
  const plan = resolver.resolve(t, day(1684), 'reference', layers);
  const { data, displayTime } = await resolver.materialize(plan, signal());
  assert.equal(displayTime, day(1650)); assert.ok(data.parts!.length);
  assert.ok(data.parts!.every(p => p.properties.t_start <= day(1650) && p.properties.t_end <= day(1651)));
  assert.ok(data.parts!.every(p => p.properties.t_end < day(1684)), 'Referenced borders do not acquire browsing-date validity.');
  const scene: SceneSnapshot = { ...data, generation: 12, time: displayTime };
  const advanced = resolver.advance(scene, resolver.resolve(t, day(1685), 'reference', layers));
  assert.equal(advanced.generation, 12); assert.equal(advanced.time, day(1650));
  assert.strictEqual(advanced.parts, scene.parts); assert.strictEqual(advanced.territories, scene.territories);
  assert.strictEqual(advanced.evidence, scene.evidence); assert.equal(advanced.overlayTime, day(1685));
});

test('indexed semantic keys remain stable through an unchanged political window and change at true eligibility boundaries', async () => {
  const t = await track(); const resolver = new DisplayResolver(t.manifest.base_geography);
  await resolver.materialize(resolver.resolve(t, day(1600), 'exact', layers), signal());
  assert.equal(resolver.resolve(t, day(1600) + 1, 'exact', layers).key, resolver.resolve(t, day(1600) + 200, 'exact', layers).key);
  assert.notEqual(resolver.resolve(t, day(1600), 'exact', layers).key, resolver.resolve(t, day(1601), 'exact', layers).key);
  await resolver.materialize(resolver.resolve(t, day(1684), 'reference', layers), signal());
  assert.equal(resolver.resolve(t, day(1660), 'reference', layers).key, resolver.resolve(t, day(1699), 'reference', layers).key);
  assert.notEqual(resolver.resolve(t, day(1684), 'reference', layers).key, resolver.resolve(t, day(1684), 'exact', layers).key);
});

test('independent real migration is eligible at its own dates without turning its corridor into political coverage', async () => {
  const t = await track(); const resolver = new DisplayResolver(t.manifest.base_geography);
  const epoch = t.manifest.epochs.find(e => e.epoch_id === 'isles-migration-1847')!;
  const enabled = { population: false, migration: true };
  const plan = resolver.resolve(t, epoch.t_start, 'reference', enabled);
  assert.equal(plan.overlay?.epoch_id, epoch.epoch_id); assert.notEqual(plan.political?.epoch_id, epoch.epoch_id);
  assert.ok(plan.displayedTime! < epoch.t_start);
  const { data } = await resolver.materialize(plan, signal());
  assert.equal(data.migration.length, 1); assert.equal(data.supplement?.stream.sha256, epoch.stream.sha256);
  assert.ok(data.parts!.length); assert.equal(data.overlayTime, epoch.t_start);
  const before = resolver.resolve(t, epoch.t_start - 1, 'reference', enabled), after = resolver.resolve(t, epoch.t_end, 'reference', enabled);
  assert.equal(before.overlay, undefined); assert.equal(after.overlay, undefined);
  assert.notEqual(plan.key, before.key); assert.notEqual(plan.key, after.key);
  const exact = resolver.resolve(t, epoch.t_start, 'exact', enabled);
  const exactData = await resolver.materialize(exact, signal());
  assert.equal(exact.representation, 'missing'); assert.equal(exactData.data.parts!.length, 0); assert.equal(exactData.data.territories.length, 0); assert.equal(exactData.data.migration.length, 1);
  assert.equal(resolver.resolve(t, epoch.t_start, 'reference', layers).overlay, undefined);
});

test('intra-epoch population and migration changes participate in scene identity while unchanged indexed overlays reuse', async () => {
  const t = await track('fixture'); const loader = t.loader; const start = t.manifest.epochs[0].t_start;
  t.loader = async (...args) => {
    const data = await loader(...args);
    return { ...data, population: data.population.map((f,i)=> i ? f : { ...f, properties: { ...f.properties, t_end: start + 10 } }),
      migration: data.migration.map(f=>({ ...f, properties: { ...f.properties, t_start: start + 20 } })) };
  };
  const resolver = new DisplayResolver(t.manifest.base_geography), both = { population: true, migration: true };
  await resolver.materialize(resolver.resolve(t, start, 'exact', both), signal());
  const at = (offset: number) => resolver.resolve(t, start + offset, 'exact', both);
  assert.equal(at(1).key, at(9).key); assert.notEqual(at(9).key, at(10).key);
  assert.equal(at(10).key, at(19).key); assert.notEqual(at(19).key, at(20).key);
  const earlier = await resolver.materialize(at(9), signal()), later = await resolver.materialize(at(20), signal());
  assert.equal(earlier.data.population.length, later.data.population.length + 1);
  assert.equal(earlier.data.migration.length, 0); assert.equal(later.data.migration.length, 1);
});

test('routing chooses one display track and aborted materialization cannot produce a new scene', async () => {
  assert.equal(chooseTrack({ longitude: -3, latitude: 55, zoom: 5 }, [-15, 45, 10, 65]), 'isles');
  assert.equal(chooseTrack({ longitude: -3, latitude: 55, zoom: 3 }, [-15, 45, 10, 65]), 'world');
  assert.equal(chooseTrack({ longitude: -100, latitude: 40, zoom: 8 }, [-15, 45, 10, 65]), 'world');
  const t = await track(), resolver = new DisplayResolver(t.manifest.base_geography); const abort = new AbortController(); abort.abort();
  await assert.rejects(resolver.materialize(resolver.resolve(t, day(1600), 'exact', layers), abort.signal), /abort/i);
  assert.throws(() => resolver.resolve(t, 1.5, 'exact', layers), /integer/);
});

test('hidden overlay interval changes do not rebuild an unchanged political scene or another visible layer', async () => {
  const t = await track('fixture'), loader = t.loader, start = t.manifest.epochs[0].t_start;
  t.loader = async (...args) => { const data = await loader(...args); return { ...data,
    population: data.population.map(f=>({ ...f, properties: { ...f.properties, t_end: start + 10 } })),
    migration: data.migration.map(f=>({ ...f, properties: { ...f.properties, t_start: start + 20 } })) }; };
  const resolver = new DisplayResolver(t.manifest.base_geography);
  await resolver.materialize(resolver.resolve(t, start, 'exact', layers), signal());
  const key = (offset: number, visible = layers) => resolver.resolve(t, start + offset, 'exact', visible).key;
  assert.equal(key(1), key(25), 'Neither hidden population nor hidden migration can invalidate geography.');
  assert.equal(key(19, { population: true, migration: false }), key(20, { population: true, migration: false }));
  assert.equal(key(9, { population: false, migration: true }), key(10, { population: false, migration: true }));
  const migrationOnly = await resolver.materialize(resolver.resolve(t, start + 20, 'exact', { population: false, migration: true }), signal());
  assert.equal(migrationOnly.data.population.length, 0); assert.equal(migrationOnly.data.migration.length, 1);
});

test('separate migration observation and metadata survive composition without replacing political labels or conflicting identities', async () => {
  const t = await track(), loader = t.loader;
  const epoch = t.manifest.epochs.find(e=>e.epoch_id==='isles-migration-1847')!;
  const markerEntity = { name: 'Independent corridor context', color: '#aaa', number: '01' };
  t.loader = async (...args) => { const data = await loader(...args); return args[0].epoch_id === epoch.epoch_id
    ? { ...data, entities: { ...data.entities, 'context:corridor': markerEntity }, labels: [{ label_id: 'overlay-label', entity_id: 'context:corridor', text: 'Do not replace political labels', position: [-3, 53] as const }] }
    : data; };
  const resolver = new DisplayResolver(t.manifest.base_geography);
  const plan = resolver.resolve(t, epoch.t_start, 'reference', { population: false, migration: true });
  const { data } = await resolver.materialize(plan, signal());
  const observation = (data as typeof data & { migration_observation?: { observation_id: string; t_start: number; t_end: number } }).migration_observation;
  assert.equal(observation?.observation_id, 'hansard-ireland-liverpool-1847');
  assert.equal(observation?.t_start, epoch.t_start); assert.equal(observation?.t_end, epoch.t_end);
  assert.deepEqual(data.entities?.['context:corridor'], markerEntity);
  assert.ok(Object.keys(data.evidence ?? {}).length > 0); assert.ok(data.labels!.length > 0);
  assert.ok(data.labels!.every(label=>label.label_id !== 'overlay-label'));
  const noOverlay = await resolver.materialize(resolver.resolve(t, epoch.t_start, 'reference', layers), signal());
  assert.equal((noOverlay.data as typeof data & { migration_observation?: unknown }).migration_observation, undefined);
  const politicalEntity = Object.keys(data.entities!).find(id=>id!=='context:corridor')!;
  t.loader = async (...args) => { const loaded = await loader(...args); return args[0].epoch_id === epoch.epoch_id
    ? { ...loaded, entities: { [politicalEntity]: markerEntity } } : loaded; };
  await assert.rejects(resolver.materialize(plan, signal()), /Conflicting entity identity/);
});

async function world1815(canvas = true): Promise<DisplayTrack> {
  const path = '/global-history/observations/world_1815/manifest.json';
  const url = `https://example.test${path}`;
  const manifest = validateAlphaManifest(JSON.parse(await readFile(new URL(`../public${path}`, import.meta.url), 'utf8')), url);
  return { id: 'world-1815', manifest, loader: createAlphaLoader(manifest, url, canvas, localFetcher) };
}

test('world reference geometry composes the independent regional migration archive with its own edition and dated evidence', async () => {
  const original = JSON.parse(await readFile(new URL('../public/alpha/isles-migration-1847.metadata.json', import.meta.url), 'utf8'));
  for (const canvas of [true, false]) {
    const world = await world1815(canvas), regional = await track('historical', canvas);
    const epoch = regional.manifest.epochs.find(e => e.epoch_id === 'isles-migration-1847')!;
    const resolver = new DisplayResolver(world.manifest.base_geography);
    const plan = resolver.resolve(world, epoch.t_start, 'reference', { population: false, migration: true }, regional);
    assert.equal(plan.requestedTime, epoch.t_start); assert.equal(plan.displayedTime, day(1815));
    assert.equal(plan.representation, 'reference'); assert.equal(plan.political?.epoch_id, 'global-world_1815');
    assert.strictEqual(plan.track, world); assert.strictEqual(plan.overlayTrack, regional);
    assert.strictEqual(plan.overlay, epoch);
    const { data, displayTime } = await resolver.materialize(plan, signal());
    assert.equal(displayTime, day(1815)); assert.equal(data.edition, world.manifest.edition);
    assert.equal(data.stream?.sha256, world.manifest.epochs[0].stream.sha256);
    assert.equal(data.supplement?.stream.sha256, epoch.stream.sha256);
    assert.equal(data.supplement?.edition, regional.manifest.edition);
    assert.notEqual(data.supplement?.edition, data.edition, 'The migration archive must not be relabeled with the world edition.');
    assert.equal(data.supplement?.time, epoch.t_start); assert.equal(data.overlayTime, epoch.t_start);
    assert.deepEqual(data.migration.map(({ type, properties, geometry }) => ({ type, properties, geometry })), original.migration);
    assert.deepEqual((data as typeof data & { migration_observation?: unknown }).migration_observation, original.migration_observation);
    assert.ok(data.parts!.length > 0);
    assert.ok(data.parts!.every(p => p.properties.t_start === day(1815) && p.properties.t_end <= day(1816)), 'Reference borders keep their original validity.');
  }
});

test('cross-track migration vanishes outside its actual 1847 interval while the 1815 world reference remains reusable', async () => {
  const world = await world1815(), regional = await track();
  const epoch = regional.manifest.epochs.find(e => e.epoch_id === 'isles-migration-1847')!;
  const resolver = new DisplayResolver(world.manifest.base_geography), enabled = { population: false, migration: true };
  const at = (time: number) => resolver.resolve(world, time, 'reference', enabled, regional);
  await resolver.materialize(at(epoch.t_start), signal());
  const activePlan = at(epoch.t_end - 1);
  assert.equal((await resolver.materialize(activePlan, signal())).data.migration.length, 1);
  for (const time of [epoch.t_start - 1, epoch.t_end, day(1848)]) {
    const plan = at(time), { data, displayTime } = await resolver.materialize(plan, signal());
    assert.equal(plan.overlay, undefined); assert.notEqual(plan.key, activePlan.key);
    assert.equal(plan.representation, 'reference'); assert.equal(displayTime, day(1815));
    assert.equal(data.migration.length, 0); assert.equal(data.supplement, undefined);
    assert.equal((data as typeof data & { migration_observation?: unknown }).migration_observation, undefined);
    assert.equal(data.stream?.sha256, world.manifest.epochs[0].stream.sha256);
  }
  const hidden = resolver.resolve(world, epoch.t_start, 'reference', layers, regional);
  assert.equal(hidden.overlay, undefined);
  const hiddenData = await resolver.materialize(hidden, signal());
  assert.equal(hiddenData.data.migration.length, 0); assert.equal(hiddenData.data.supplement, undefined);
});

test('held reference loses an expired polity at its reviewed boundary and reverse scrubbing restores raw source geometry', async () => {
  const path = '/global-history/observations/world_1400/manifest.json';
  const url = `https://example.test${path}`;
  const cutoff = Date.UTC(1453, 4, 29) / 86_400_000;
  for (const canvas of [true, false]) {
    const manifest = validateAlphaManifest(JSON.parse(await readFile(new URL(`../public${path}`, import.meta.url), 'utf8')), url);
    const world: DisplayTrack = { id: 'world-1400', manifest, loader: createAlphaLoader(manifest, url, canvas, localFetcher) };
    const resolver = new DisplayResolver(manifest.base_geography);
    const at = (time: number) => resolver.resolve(world, time, 'reference', layers);
    const before = await resolver.materialize(at(cutoff - 1), signal());
    const entityId = Object.entries(before.data.entities!).find(([, entity]) => entity.name === 'Byzantine Empire')![0];
    const beforePlan = at(cutoff - 1), endedPlan = at(cutoff);
    assert.equal(beforePlan.representation, 'reference');
    assert.equal(endedPlan.displayedTime, day(1400), 'The map remains the same source observation on both sides of the boundary.');
    assert.notEqual(beforePlan.key, endedPlan.key, 'The lifetime boundary must prevent cheap advancement of stale political geometry.');
    const ended = await resolver.materialize(endedPlan, signal());
    const asScene = (value: typeof before, generation: number): SceneSnapshot => ({ ...value.data, generation, time: value.displayTime });
    assert.ok(selectEntity(entityId, asScene(before, 1)));
    assert.equal(selectEntity(entityId, asScene(ended, 2)), null, 'Suppressed polity cannot be picked through its canonical part index.');
    assert.ok(ended.data.suppressedEntityIds?.includes(entityId), 'Native PMTiles filters receive the excluded entity ID.');
    assert.ok(ended.data.parts!.every(part => part.properties.entity_id !== entityId));
    assert.ok(ended.data.territories.every(part => part.properties.entity_id !== entityId));
    assert.ok(ended.data.labels!.every(label => label.entity_id !== entityId));
    assert.notEqual(sceneRenderSignature(asScene(before, 1)), sceneRenderSignature(asScene(ended, 2)), 'A mounted native source cannot be reused with stale exclusions.');
    assert.equal(ended.data.stream?.sha256, before.data.stream?.sha256, 'Chronology guards do not rewrite the archived geometry.');
    assert.equal(at(cutoff).key, at(cutoff + 1).key);

    const restored = await resolver.materialize(at(cutoff - 1), signal());
    assert.ok(selectEntity(entityId, asScene(restored, 3)), 'Reverse scrubbing reloads the unsuppressed source indexes.');
    assert.ok(!restored.data.suppressedEntityIds?.includes(entityId));
    assert.deepEqual(restored.data.parts, before.data.parts);
    assert.deepEqual(restored.data.territories, before.data.territories);
    assert.deepEqual(restored.data.labels, before.data.labels);
    assert.equal(sceneRenderSignature(asScene(restored, 3)), sceneRenderSignature(asScene(before, 1)));
    assert.ok(before.data.parts!.some(part => part.properties.entity_id === entityId), 'Later filtering leaves previously materialized source arrays intact.');
  }
});
