import type { FactSource } from './facts';
import data from './data/cities-2026-09-11.json' with { type: 'json' };

export interface City {
  id: string;
  name: string;
  countryId: string;
  longitude: number;
  latitude: number;
  capital: boolean;
  capitalRole: string | null;
  relationship: string;
  highlight: string;
  sourceIds: string[];
}

// Published releases are immutable: retain this bundle when adding a new version.
// The bundle records its source dates, role exceptions, curation policy and gaps.
export const cityContentVersion = '2026-09-11';
const release = data as { cities: City[]; sources: Record<string, FactSource> };
export const cities = release.cities;
export const citiesById = new Map(cities.map(city => [city.id, city]));

// A representative city-centre target, not a municipal or metropolitan boundary.
export const cityToleranceKm = 25;
const radians = Math.PI / 180;
const earthRadiusKm = 6371.0088;

export function cityDistanceKm(longitude: number, latitude: number, city: City): number {
  const latitudeDelta = (latitude - city.latitude) * radians;
  const longitudeDelta = (longitude - city.longitude) * radians;
  const latitudeSine = Math.sin(latitudeDelta / 2);
  const longitudeSine = Math.sin(longitudeDelta / 2);
  const haversine = latitudeSine * latitudeSine
    + Math.cos(latitude * radians) * Math.cos(city.latitude * radians) * longitudeSine * longitudeSine;
  // Clamp roundoff at coincident and antipodal points. The haversine naturally
  // takes the short path across the antimeridian and remains stable near poles.
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(Math.max(0, Math.min(1, haversine))));
}

export function getCityFacts(cityId: string, version: string): { city: City; sources: FactSource[] } {
  if (version !== cityContentVersion) throw new Error(`Unknown city content version: ${version}`);
  const city = citiesById.get(cityId);
  if (!city) throw new Error(`Missing city facts: ${cityId}`);
  return { city, sources: city.sourceIds.map(id => release.sources[id]) };
}
