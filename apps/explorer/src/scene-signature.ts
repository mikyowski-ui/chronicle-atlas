import type { SceneSnapshot } from '../../../packages/contracts/src/index.ts';

/** Canonical JSON for the small identity index; never intersects polygons. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

/**
 * Presentation time is not part of an unchanged, fully indexed layer state.
 * A native layer with no eligibility index is deliberately conservative: its
 * time filter must be hydrated again, since tile contents cannot be inferred
 * from the political index (notably VP07's synthetic population layer).
 */
export function sceneRenderSignature(scene: SceneSnapshot, visibility: { population: boolean; migration: boolean } = { population: true, migration: true }): string {
  const active = <T extends { properties: { t_start: number; t_end: number } }>(features: readonly T[]) =>
    features.filter(feature => feature.properties.t_start <= scene.time && scene.time < feature.properties.t_end);
  const order = (values: readonly unknown[]) => values.map(stable).sort();
  const overlayTime = scene.overlayTime ?? scene.time;
  const overlays = (name: 'population' | 'migration') => {
    if (!visibility[name]) return { visible: false };
    const features = scene[name], stream = scene.supplement?.stream ?? scene.stream;
    return !features.length && stream?.source_layers.includes(name)
      ? { unindexedTime: overlayTime }
      : order(features.filter(feature => feature.properties.t_start <= overlayTime && overlayTime < feature.properties.t_end)
        .map(feature => ({ properties: feature.properties, geometry: feature.geometry })));
  };
  return stable({
    edition: scene.edition, epoch: scene.epoch_id, displayEdition: scene.displayEdition,
    stream: scene.stream,
    chronologyExclusions: [...(scene.suppressedEntityIds ?? [])].sort(),
    supplement: scene.supplement ? { stream: scene.supplement.stream, edition: scene.supplement.edition } : null,
    political: order(scene.parts ? active(scene.parts).map(part => ({ properties: part.properties, geometry_hash: part.geometry_hash }))
      : active(scene.territories).map(feature => ({ properties: feature.properties, geometry: feature.geometry }))),
    population: overlays('population'), migration: overlays('migration'),
    // Color expressions are compiled into the source group's paint at mount.
    colors: Object.fromEntries(Object.entries(scene.entities ?? {}).map(([id, entity]) => [id, entity.color])),
  });
}
