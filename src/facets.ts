import { z } from 'zod';
import { countries, type Country } from './geography';
import { cities, type City } from './cities';

const countriesById = new Map(countries.map(country => [country.properties.id, country]));

// Use each entity's Natural Earth region, including transcontinental countries.
// Open-ocean territories remain selectable rather than being silently excluded.
export const continentRegions = {
  Worldwide: [...new Set(countries.map(country => country.properties.region))].sort(),
  Africa: ['Northern Africa', 'Western Africa', 'Middle Africa', 'Eastern Africa', 'Southern Africa'],
  Asia: ['Central Asia', 'Eastern Asia', 'Southern Asia', 'South-Eastern Asia', 'Western Asia'],
  Europe: ['Northern Europe', 'Southern Europe', 'Western Europe', 'Eastern Europe'],
  'North America': ['Northern America', 'Central America', 'Caribbean'],
  'South America': ['South America'],
  Oceania: ['Australia and New Zealand', 'Melanesia', 'Micronesia', 'Polynesia'],
  'Open ocean': ['Seven seas (open ocean)'],
};
export const facetSelectionSchema = z.object({
  scope: z.enum(['countries', 'capitals', 'cities']),
  continent: z.enum(Object.keys(continentRegions) as [keyof typeof continentRegions, ...(keyof typeof continentRegions)[]]),
  region: z.string(),
  learning: z.enum(['name-to-location', 'capital-to-location', 'location-to-name-recognition', 'shape-recognition', 'country-facts']),
}).refine(selection => selection.region === 'All regions' || continentRegions[selection.continent].includes(selection.region))
  .refine(selection => selection.scope === 'countries'
    ? selection.learning !== 'capital-to-location'
    : selection.learning === 'name-to-location' || (selection.scope === 'capitals' && selection.learning === 'capital-to-location'));
export type FacetSelection = z.infer<typeof facetSelectionSchema>;
export const learningLabels = { 'name-to-location': 'Name-to-location', 'capital-to-location': 'Country-to-capital location', 'location-to-name-recognition': 'Location-to-name recognition', 'shape-recognition': 'Shape recognition', 'country-facts': 'Country fact cards' };
export function defaultFacets(): FacetSelection {
  return { scope: 'countries', continent: 'Worldwide', region: 'All regions', learning: 'name-to-location' };
}
export function matchesFacets(country: Country, selection: FacetSelection): boolean {
  return (selection.continent === 'Worldwide' || continentRegions[selection.continent].includes(country.properties.region))
    && (selection.region === 'All regions' || country.properties.region === selection.region);
}
export function matchesCityFacets(city: City, selection: FacetSelection): boolean {
  const country = countriesById.get(city.countryId);
  return selection.scope !== 'countries' && (selection.scope !== 'capitals' || city.capital)
    && !!country && matchesFacets(country, selection);
}
export function practiceCandidateCount(selection: FacetSelection | null): number {
  if (!selection) return countries.length;
  return selection.scope === 'countries'
    ? countries.filter(country => matchesFacets(country, selection)).length
    : cities.filter(city => matchesCityFacets(city, selection)).length;
}
export function describeFacets(selection: FacetSelection): string {
  const scope = selection.scope === 'countries' ? 'Countries & territories' : selection.scope === 'capitals' ? 'National capitals' : 'Major cities';
  return `${scope} · ${selection.continent} · ${selection.region} · ${learningLabels[selection.learning]}`;
}
