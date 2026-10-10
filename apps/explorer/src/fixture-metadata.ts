import type { SceneMetadata } from '../../../packages/contracts/src/index.ts';
import type { SceneData } from './temporal.ts';
export const fixtureEntities = {
  'synthetic:aster': { name: 'Aster Coast', color: '#94bba6', position: [-15,42] as [number,number], number: '01' },
  'synthetic:boreal': { name: 'Boreal Reach', color: '#d9b88b', position: [4,49] as [number,number], number: '02' },
  'synthetic:cedar': { name: 'Cedar Isles', color: '#a7b5d1', position: [8,35] as [number,number], number: '03' },
};
export function withFixtureMetadata(scene: SceneData): SceneData {
  const evidence: NonNullable<SceneMetadata['evidence']> extends Readonly<infer T> ? T : never = {};
  for (const f of scene.territories) evidence[f.properties.territory_state_id] = {
    assertion_ids: [`fixture:${f.properties.territory_state_id}`, `fixture:density:${scene.epoch_id}`],
    source_title: 'The Meridian Isles · authored synthetic fixture', source_edition: scene.edition,
    source_url: './fixtures/meridian-v2.json', license: 'Original synthetic demonstration data', attribution: 'Chronicle Atlas fixture authors',
    valid_from: f.properties.t_start, valid_to: f.properties.t_end,
    recorded_from: 'Synthetic fixture; no historical recorded-time claim', recorded_to: null,
    methodology: ['Discrete authored polygons; no smoothing or interpolation.', 'One independent point label per active entity, shared by every fragment.', 'Population cards integrate density over the covered part of each footprint. Missing density coverage is not treated as zero.', 'Fixed reference uses the authored 950 CE footprint with the current epoch’s density. Area uses a spherical equal-area approximation.'],
    limitations: ['Every name, border, density and movement is invented.', 'Partial density coverage gives a subtotal, not a total territory population.', 'The map uses vector-tile quantization; the fixed reference retains authored input geometry.'],
  };
  return { ...scene, entities: fixtureEntities, evidence, labels: Object.entries(fixtureEntities).map(([entity_id,e]) => ({label_id:`${scene.epoch_id}:${entity_id}:label`,entity_id,text:e.name,position:e.position})) };
}
