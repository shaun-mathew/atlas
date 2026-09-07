import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import data from './data/countries.json';

export type Country = Feature<Polygon | MultiPolygon, { id: string; name: string; region: string }>;

// Natural Earth 5.1.2, 1:50m Admin-0 countries; public domain.
// Source: https://github.com/nvkelso/natural-earth-vector/blob/v5.1.2/geojson/ne_50m_admin_0_countries.geojson
// Retrieved 2026-09-07. Only properties are reduced; boundaries are unchanged.
// Policy: all 241 mapped countries and territories except Antarctica, using
// Natural Earth's de facto boundaries. Names and inclusion do not imply recognition.
export const countries = (data as FeatureCollection<Polygon | MultiPolygon, Country['properties']>).features;
