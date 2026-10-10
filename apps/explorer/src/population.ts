import type { Position } from 'geojson';
import type { PopulationFeature, SceneSnapshot, TerritoryFeature } from '../../../packages/contracts/src/index.ts';
import fixture from '../fixtures/meridian-v2.json';

/**
 * These are authored, unquantized reference footprints, fixed at the first fixture
 * epoch. They are never replaced by the currently selected territory boundary.
 * Only matching synthetic entity IDs can use this default reference.
 */
function freezeReference<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    Object.values(value).forEach(freezeReference);
  }
  return value;
}
export const FIXTURE_REFERENCE_TERRITORIES: readonly TerritoryFeature[] = freezeReference(
  fixture.epochs[0].territories.map(part => ({
    type: 'Feature' as const,
    properties: {
      entity_id: part.entity_id, render_id: part.render_id, territory_state_id: part.territory_state_id,
      t_start: fixture.epochs[0].t_start, t_end: fixture.epochs[0].t_end,
    },
    geometry: { type: 'Polygon' as const, coordinates: part.coordinates.map(ring => ring.map(point => [...point])) },
  })),
);

export interface PopulationEstimate {
  /** Population in the covered portion only. Unobserved territory is not zero. */
  population: number | null;
  areaKm2: number;
  coveredAreaKm2: number;
  coverageFraction: number;
  status: 'complete' | 'partial' | 'unavailable';
  reason: string | null;
}

export const POPULATION_METHODOLOGY = 'Approximate population = density × intersected area. Independent rectangular density cells are clipped to the footprint in spherical cylindrical equal-area coordinates (longitude, sin latitude; radius 6,371.0088 km). Edges are straight in that calculation plane; this is a numerical fixture model, not a historical measurement. Holes are subtracted and disjoint territory parts are added. Values are subtotals for covered areas; unobserved areas are not extrapolated. The fixed reference retains the authored 950 CE footprint while using the selected epoch’s density.';

type Point = readonly [number, number];
type Ring = readonly Point[];
interface ProjectedPolygon { rings: readonly Ring[]; center: number; area: number }
interface Rectangle { left: number; right: number; bottom: number; top: number; density: number }
const RAD = Math.PI / 180;
const RADIUS_KM = 6_371.0088;
const AREA_FACTOR = RADIUS_KM ** 2;
const TAU = Math.PI * 2;
const EPSILON = 1e-12;

function ringArea(ring: Ring): number {
  let doubled = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    doubled += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(doubled) / 2;
}

function projectRing(coordinates: readonly Position[]): Ring {
  if (coordinates.length < 4 || coordinates.some(point => point.length < 2 ||
      !Number.isFinite(point[0]) || !Number.isFinite(point[1]) || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90)) {
    throw new Error('Unsupported population geometry.');
  }
  if (coordinates[0][0] !== coordinates.at(-1)![0] || coordinates[0][1] !== coordinates.at(-1)![1]) {
    throw new Error('Population calculation requires closed rings.');
  }
  const result: Point[] = [];
  for (const [longitude, latitude] of coordinates) {
    let x = longitude * RAD;
    if (result.length) x += TAU * Math.round((result.at(-1)![0] - x) / TAU);
    result.push([x, Math.sin(latitude * RAD)]);
  }
  const xs = result.map(point => point[0]);
  if (Math.max(...xs) - Math.min(...xs) > Math.PI || Math.abs(result[0][0] - result.at(-1)![0]) > EPSILON) {
    throw new Error('The bounded population calculation supports footprints narrower than half the globe.');
  }
  return result;
}

function projectPolygon(feature: TerritoryFeature): ProjectedPolygon {
  const projected = feature.geometry.coordinates.map(projectRing);
  if (!projected.length) throw new Error('Population footprint is empty.');
  const xs = projected[0].map(point => point[0]);
  const center = (Math.min(...xs) + Math.max(...xs)) / 2;
  const rings = projected.map(ring => {
    const offset = TAU * Math.round((center - ring[0][0]) / TAU);
    return ring.map(([x, y]) => [x + offset, y] as Point);
  });
  const area = ringArea(rings[0]) - rings.slice(1).reduce((sum, ring) => sum + ringArea(ring), 0);
  if (area <= 0) throw new Error('Population footprint has no positive area.');
  return { rings, center, area };
}

function densityRectangle(feature: PopulationFeature): Rectangle {
  const { density } = feature.properties;
  if (!Number.isFinite(density) || density < 0 || feature.geometry.coordinates.length !== 1) {
    throw new Error('Population calculation requires nonnegative densities in rectangular cells.');
  }
  const ring = projectRing(feature.geometry.coordinates[0]);
  const xs = ring.map(point => point[0]), ys = ring.map(point => point[1]);
  const left = Math.min(...xs), right = Math.max(...xs), bottom = Math.min(...ys), top = Math.max(...ys);
  if (right <= left || top <= bottom || ring.length !== 5 || ring.some(([x, y]) =>
      (Math.abs(x - left) > EPSILON && Math.abs(x - right) > EPSILON) ||
      (Math.abs(y - bottom) > EPSILON && Math.abs(y - top) > EPSILON)) ||
      Math.abs(ringArea(ring) - (right - left) * (top - bottom)) > EPSILON) {
    throw new Error('Population calculation requires axis-aligned rectangular density cells.');
  }
  return { left, right, bottom, top, density };
}

/** Sutherland–Hodgman clipping. A concave ring may acquire zero-area bridges. */
function clipRing(ring: Ring, rectangle: Rectangle): Ring {
  let output = [...ring];
  const boundaries: readonly [0 | 1, number, boolean][] = [
    [0, rectangle.left, true], [0, rectangle.right, false],
    [1, rectangle.bottom, true], [1, rectangle.top, false],
  ];
  for (const [axis, bound, minimum] of boundaries) {
    const input = output;
    output = [];
    if (!input.length) break;
    const inside = (point: Point) => minimum ? point[axis] >= bound : point[axis] <= bound;
    let previous = input.at(-1)!;
    for (const point of input) {
      if (inside(point) !== inside(previous)) {
        const ratio = (bound - previous[axis]) / (point[axis] - previous[axis]);
        output.push(axis === 0
          ? [bound, previous[1] + ratio * (point[1] - previous[1])]
          : [previous[0] + ratio * (point[0] - previous[0]), bound]);
      }
      if (inside(point)) output.push(point);
      previous = point;
    }
  }
  return output;
}

function intersectionArea(polygon: ProjectedPolygon, rectangle: Rectangle): number {
  const rectangleCenter = (rectangle.left + rectangle.right) / 2;
  const offset = TAU * Math.round((rectangleCenter - polygon.center) / TAU);
  const areas = polygon.rings.map(ring => ringArea(clipRing(ring.map(([x, y]) => [x + offset, y]), rectangle)));
  return Math.max(0, areas[0] - areas.slice(1).reduce((sum, area) => sum + area, 0));
}

function unavailable(areaKm2: number, reason: string): PopulationEstimate {
  return { population: null, areaKm2, coveredAreaKm2: 0, coverageFraction: 0, status: 'unavailable', reason };
}

/**
 * Bounded numerical fixture calculation, not a general demographic estimator.
 * Inputs must contain disjoint territory parts and nonoverlapping rectangular
 * density cells. It does not modify or simplify any source or rendered geometry.
 */
export function estimatePopulation(territories: readonly TerritoryFeature[], cells: readonly PopulationFeature[]): PopulationEstimate {
  if (!territories.length) return unavailable(0, 'No footprint is available.');
  let areaKm2 = 0;
  try {
    const polygons = territories.map(projectPolygon);
    areaKm2 = polygons.reduce((sum, polygon) => sum + polygon.area, 0) * AREA_FACTOR;
    if (!cells.length) return unavailable(areaKm2, 'No population estimate is available for this date.');
    const rectangles = cells.map(densityRectangle);
    for (let i = 0; i < rectangles.length; i++) for (let j = i + 1; j < rectangles.length; j++) {
      const a = rectangles[i], b = rectangles[j];
      const offset = TAU * Math.round(((a.left + a.right) - (b.left + b.right)) / 2 / TAU);
      if (Math.min(a.right, b.right + offset) - Math.max(a.left, b.left + offset) > EPSILON &&
          Math.min(a.top, b.top) - Math.max(a.bottom, b.bottom) > EPSILON) {
        return unavailable(areaKm2, 'Overlapping density cells require an explicit aggregation rule.');
      }
    }
    let coveredAreaKm2 = 0, population = 0;
    for (const polygon of polygons) for (const rectangle of rectangles) {
      const overlapKm2 = intersectionArea(polygon, rectangle) * AREA_FACTOR;
      coveredAreaKm2 += overlapKm2;
      population += overlapKm2 * rectangle.density;
    }
    if (coveredAreaKm2 <= EPSILON) return unavailable(areaKm2, 'The density layer does not cover this footprint.');
    const coverageFraction = Math.min(1, coveredAreaKm2 / areaKm2);
    return {
      population, areaKm2, coveredAreaKm2, coverageFraction,
      status: coverageFraction >= 1 - 1e-9 ? 'complete' : 'partial', reason: null,
    };
  } catch (error) {
    return unavailable(areaKm2, error instanceof Error ? error.message : 'Population could not be calculated.');
  }
}

/** Compare current and frozen footprints using the same committed density layer. */
export function comparePopulation(entityId: string, scene: SceneSnapshot,
  fixedTerritories: readonly TerritoryFeature[] = FIXTURE_REFERENCE_TERRITORIES) {
  const active = <T extends { properties: { t_start: number; t_end: number } }>(features: readonly T[]) =>
    features.filter(feature => feature.properties.t_start <= scene.time && scene.time < feature.properties.t_end);
  const cells = active(scene.population);
  const historical = active(scene.territories).filter(part => part.properties.entity_id === entityId);
  // Deliberately do not apply the selected date to the frozen reference interval.
  const fixed = fixedTerritories.filter(part => part.properties.entity_id === entityId);
  return {
    historical: estimatePopulation(historical, cells), fixed: estimatePopulation(fixed, cells),
    referenceLabel: !fixed.length ? 'No fixed-area reference' :
      fixedTerritories === FIXTURE_REFERENCE_TERRITORIES ? '950 CE footprint' : 'Fixed reference footprint',
    methodology: POPULATION_METHODOLOGY,
  };
}
