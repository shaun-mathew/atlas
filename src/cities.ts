import { FactReleases, type FactRelease } from './fact-releases';
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

// Published bundles stay untouched. Their coordinate/country policies support
// this provenance; retrieval is explicitly not an effective reference year.
const original: FactRelease<City> = {
  version: data.metadata.version,
  reviewedAt: '2026-09-12',
  facts: Object.fromEntries(data.cities.map(city => [city.id, city])),
  sources: data.sources,
  provenance: Object.fromEntries(data.cities.map(city => [
    city.id, { referenceYear: null, geographicScope: 'Canonical city point; not a municipal or metropolitan extent.' },
  ])),
  changes: [],
};

export const cityFactReleases = new FactReleases([
  original,
  {
    ...original,
    version: '2026-09-12',
    // Clarifies the pinned coordinatePolicy/countryPolicy, without changing
    // coordinates, names, roles or any assessed geographic relationship.
    provenance: Object.fromEntries(data.cities.map(city => [
      city.id,
      {
        referenceYear: null,
        geographicScope: 'Canonical city point; not a municipal or metropolitan extent. Country associations follow the bundled geography policy; inclusion and names do not decide sovereignty.',
      },
    ])),
    changes: [],
  },
]);
export const cityContentVersion = cityFactReleases.currentVersion;
export const cities = Object.freeze(data.cities.map(city => cityFactReleases.get(city.id, cityContentVersion).facts));
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

export function getCityFacts(cityId: string, version: string) {
  const { facts: city, ...provenance } = cityFactReleases.get(cityId, version);
  return { city, ...provenance };
}
