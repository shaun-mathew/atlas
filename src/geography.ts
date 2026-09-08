import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import data from './data/countries.json' with { type: 'json' };

export type Country = Feature<Polygon | MultiPolygon, { id: string; name: string; region: string }>;

// Natural Earth 5.1.2, 1:50m Admin-0 countries; public domain.
// Source: https://github.com/nvkelso/natural-earth-vector/blob/v5.1.2/geojson/ne_50m_admin_0_countries.geojson
// Retrieved 2026-09-07. Only properties are reduced; boundaries are unchanged.
// Policy: all 241 mapped countries and territories except Antarctica, using
// Natural Earth's de facto boundaries. Names and inclusion do not imply recognition.
export const countries = (data as FeatureCollection<Polygon | MultiPolygon, Country['properties']>).features;

const radians = Math.PI / 180;
const polygonAreas = new WeakMap<Polygon['coordinates'], number>();

// Relative spherical area: subtract holes from the exterior ring. Natural
// Earth's immutable polygons are already split at the antimeridian.
export function polygonArea(coordinates: Polygon['coordinates']): number {
  const cached = polygonAreas.get(coordinates);
  if (cached !== undefined) return cached;
  let area = 0;
  for (let ringIndex = 0; ringIndex < coordinates.length; ringIndex++) {
    const ring = coordinates[ringIndex];
    let ringArea = 0;
    for (let i = 1; i < ring.length; i++) {
      const [x, y] = ring[i];
      const [previousX, previousY] = ring[i - 1];
      ringArea += (x - previousX) * radians * (Math.sin(y * radians) + Math.sin(previousY * radians));
    }
    area += Math.abs(ringArea) * (ringIndex === 0 ? 1 : -1);
  }
  polygonAreas.set(coordinates, area);
  return area;
}

const anchorIds = ['BRA', 'CHN', 'AUS', 'IND', 'USA', 'CAN', 'RUS', 'MEX', 'ARG', 'ZAF', 'EGY', 'SAU', 'IDN', 'FRA', 'JPN', 'GBR'];
const anchorRanks: Record<string, number> = Object.fromEntries(anchorIds.map((id, index) => [id, index]));

// Keep dataset order intact for legacy replay and review ties. Introductions
// begin with recognizable anchors, then shrink by the largest single landmass.
export const introductionOrder: Country[] = countries.map(country => {
  const geometry = country.geometry;
  const area = geometry.type === 'Polygon'
    ? polygonArea(geometry.coordinates)
    : geometry.coordinates.reduce((largest, coordinates) => Math.max(largest, polygonArea(coordinates)), -Infinity);
  return { country, area, rank: anchorRanks[country.properties.id] ?? anchorIds.length };
}).sort((a, b) => a.rank - b.rank || b.area - a.area || a.country.properties.id.localeCompare(b.country.properties.id))
  .map(({ country }) => country);
