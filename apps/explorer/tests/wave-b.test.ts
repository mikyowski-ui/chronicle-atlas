import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createEpochLoader, validateManifest, TemporalController } from '../src/temporal.ts';
import type { SceneSnapshot, TerritoryProperties } from '../../../packages/contracts/src/index.ts';

const input = JSON.parse(await readFile(new URL('../public/wave-b/manifest.json', import.meta.url), 'utf8'));
const manifest = validateManifest(input, 'https://candidate.invalid/wave-b/manifest.json');
const localFetch: typeof fetch = async input => new Response(new Uint8Array(await readFile(new URL('../public/wave-b/' + new URL(String(input)).pathname.split('/').at(-1), import.meta.url))));
const loader = createEpochLoader(localFetch);
const archive = (id: string) => manifest.epochs.find(e => e.epoch_id === id)!;

test('all 31 real candidate archives retain recorded evidence and immutable cell IDs without synthetic demographics', async () => {
  const allAssertions = new Set<string>();
  let features = 0;
  for (const epoch of manifest.epochs) {
    const scene = await loader(epoch, manifest, new AbortController().signal);
    assert.equal(scene.population.length, 0);
    assert.equal(scene.migration.length, 0);
    assert.ok(scene.territories.length > 0 && scene.territories.length <= 1000);
    assert.equal(new Set(scene.labels!.map(l => l.entity_id)).size, scene.labels!.length, 'Exactly one independent anchor per entity.');
    for (const feature of scene.territories) {
      const props = feature.properties as TerritoryProperties & {cell_id: number; kind: string; relation: string; recorded_from: string; assertion_id: string};
      const evidence = scene.evidence![props.territory_state_id];
      assert.ok(evidence.assertion_ids.includes(props.assertion_id));
      allAssertions.add(props.assertion_id);
      assert.equal(evidence.recorded_from, '2026-09-20T02:00:00.000Z');
      assert.equal(props.recorded_from, evidence.recorded_from);
      assert.equal(evidence.recorded_to, null);
      assert.equal(evidence.valid_from, epoch.t_start);
      assert.equal(evidence.valid_to, epoch.t_end);
      assert.equal(evidence.license, 'GPL-3.0');
      assert.ok(evidence.source_edition.startsWith('overview:da7a4b7:world_'));
      assert.ok(Number.isSafeInteger(props.cell_id) && props.cell_id > 0 && props.cell_id <= 259200);
      const west = (props.cell_id - 1) % 720 * .5 - 180;
      const south = Math.floor((props.cell_id - 1) / 720) * .5 - 90;
      assert.ok(west >= -12 && west < 3 && south >= 48 && south < 61.5);
      for (const [lon, lat] of feature.geometry.coordinates[0]) {
        assert.ok(Math.min(Math.abs(lon-west),Math.abs(lon-west-.5)) < .004, 'Quantized display stays on the authoritative cell edge.');
        assert.ok(Math.min(Math.abs(lat-south),Math.abs(lat-south-.5)) < .004);
      }
      if (props.kind === 'cultural') assert.equal(props.relation, 'cultural_approximation');
    }
    features += scene.territories.length;
  }
  assert.equal(manifest.epochs.length, 31);
  const build = JSON.parse(await readFile(new URL('../public/wave-b/build-record.json', import.meta.url), 'utf8'));
  assert.equal(features, build.eligible_render_features);
  assert.ok(allAssertions.size <= 123);
  assert.equal(build.assertions, 123);
  assert.equal(build.coverage_sets, 56);
  assert.equal(build.unique_memberships, 3918);
  assert.equal(build.expanded_memberships, 7653);
  assert.equal(build.public_ledger_changed, false);
  for (const value of Object.values(build.cumulative_resources) as {used: number; limit: number}[]) assert.ok(value.used <= value.limit);
});

test('early cultural snapshots and the source-name Heptarchy remain distinct from ownership', async () => {
  const early = await loader(archive('isles-bce200'), manifest, new AbortController().signal);
  assert.deepEqual(Object.values(early.entities!).map(e => e.name), ['Celts']);
  assert.ok(Object.values(early.entities!).every(e => e.kind === 'cultural'));
  const heptarchy = await loader(archive('isles-800'), manifest, new AbortController().signal);
  const names = Object.values(heptarchy.entities!).map(e => e.name);
  for (const name of ['Wessex', 'Northumbria', 'Kent', 'Essex', 'Mercia']) assert.ok(names.includes(name));
  assert.ok(!names.includes('East Anglia') && !names.includes('Sussex'));
  const earlyGap = manifest.epochs[0].t_end;
  assert.ok(!manifest.epochs.some(e => e.t_start <= earlyGap && earlyGap < e.t_end), 'No source snapshot is carried to the next century.');
});

test('the controller commits a visible empty generation in unsupported historical years', async () => {
  const committed: SceneSnapshot[] = [];
  const controller = new TemporalController(manifest, {prepare: async () => () => {}, onCommit: scene => committed.push(scene)}, loader);
  await controller.seek(archive('isles-800').t_start);
  await controller.seek(archive('isles-800').t_end);
  assert.equal(committed.at(-1)!.epoch_id, 'uncovered');
  assert.equal(committed.at(-1)!.territories.length, 0);
  assert.equal(committed.at(-1)!.population.length, 0);
  assert.equal(committed.at(-1)!.migration.length, 0);
  assert.ok(committed.at(-1)!.generation > committed[0].generation);
  controller.dispose();
});
