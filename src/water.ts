import type { Feature, LineString, MultiLineString, MultiPolygon, Polygon, Position } from 'geojson';
import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon';
import { pointToLineDistance } from '@turf/point-to-line-distance';
import { FactReleases } from './fact-releases';
import data from './data/water-2026-09-13.json' with { type: 'json' };

export type WaterFeature = Feature<LineString | MultiLineString | Polygon | MultiPolygon, {
  id: string;
  name: string;
  kind: 'river' | 'lake' | 'sea' | 'ocean';
  countryIds: string[];
  regions: string[];
  highlight: string;
  sourceIds: string[];
}>;

// Published source components, clipping, coverage and relationship policies live
// with the immutable bundle. A marine label region is never used as a coastline.
const bundledFeatures = data.features as WaterFeature[];
export const waterGeometryVersion = data.metadata.geometryVersion;
export const waterToleranceKm = data.metadata.tolerancePolicy.toleranceKm;
export const waterFactReleases = new FactReleases<WaterFeature['properties']>([{
  version: data.metadata.version,
  reviewedAt: data.metadata.reviewedAt,
  facts: Object.fromEntries(bundledFeatures.map(feature => [feature.properties.id, feature.properties])),
  sources: data.sources,
  provenance: data.provenance,
  changes: [],
}]);
export const waterFeatures: readonly WaterFeature[] = Object.freeze(bundledFeatures.map(feature => Object.freeze({
  ...feature,
  properties: waterFactReleases.get(feature.properties.id, waterFactReleases.currentVersion).facts,
})));
export const waterById = new Map(waterFeatures.map(feature => [feature.properties.id, feature]));

export function getWaterFacts(id: string, version: string) {
  const { facts: water, ...provenance } = waterFactReleases.get(id, version);
  return { water, ...provenance };
}

const wrapLongitude = (longitude: number) => ((longitude + 180) % 360 + 360) % 360 - 180;
const distanceOptions = { units: 'kilometers', method: 'geodesic' } as const;
const preparedGeometry = new WeakMap<WaterFeature['geometry'], {
  polygons: { geometry: Polygon; longitude: number }[];
  lines: LineString[];
}>();

// The bundle is already cut at the antimeridian. Also accept unsplit seam-crossing
// rings without interpreting the long way around Earth as water. Preserve the
// full-world polar closure used by Natural Earth instead of collapsing its cap.
function unwrapRing(ring: Position[]): Position[] {
  const crossesSeam = ring.some((point, index) => index > 0
    && Math.abs(point[0] - ring[index - 1][0]) > 180
    && Math.abs(point[0] - ring[index - 1][0]) < 359.99);
  if (!crossesSeam) return ring;
  let previous = ring[0][0];
  return ring.map(point => {
    previous += wrapLongitude(point[0] - previous);
    return [previous, point[1]];
  });
}

function prepare(geometry: WaterFeature['geometry']) {
  const cached = preparedGeometry.get(geometry);
  if (cached) return cached;
  const polygons: { geometry: Polygon; longitude: number }[] = [];
  const lines: LineString[] = [];
  if (geometry.type === 'LineString') lines.push(geometry);
  else if (geometry.type === 'MultiLineString') {
    for (const coordinates of geometry.coordinates) lines.push({ type: 'LineString', coordinates });
  } else {
    const parts = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    for (const part of parts) {
      const rings = part.map(unwrapRing);
      let min = Infinity;
      let max = -Infinity;
      for (const point of rings[0]) {
        min = Math.min(min, point[0]);
        max = Math.max(max, point[0]);
      }
      const longitude = (min + max) / 2;
      // A hole supplied on the opposite longitude wrap belongs beside its shell.
      for (let index = 1; index < rings.length; index++) {
        const shift = 360 * Math.round((longitude - rings[index][0][0]) / 360);
        if (shift) rings[index] = rings[index].map(point => [point[0] + shift, point[1]]);
      }
      polygons.push({ geometry: { type: 'Polygon', coordinates: rings }, longitude });
      for (const coordinates of part) lines.push({ type: 'LineString', coordinates });
    }
  }
  const prepared = { polygons, lines };
  preparedGeometry.set(geometry, prepared);
  return prepared;
}

export function waterDistanceKm(longitude: number, latitude: number, feature: WaterFeature): number {
  const point = [wrapLongitude(longitude), latitude];
  const geometry = prepare(feature.geometry);
  for (const polygon of geometry.polygons) {
    const wrappedPoint = [point[0] + 360 * Math.round((polygon.longitude - point[0]) / 360), latitude];
    if (booleanPointInPolygon(wrappedPoint, polygon.geometry)) return 0;
  }
  let distance = Infinity;
  for (const line of geometry.lines) {
    distance = Math.min(distance, pointToLineDistance(point, line, distanceOptions));
  }
  return distance;
}
