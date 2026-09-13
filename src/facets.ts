import { z } from 'zod';
import { countries, type Country } from './geography';
import { cities, type City } from './cities';
import { waterFeatures, type WaterFeature } from './water';

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
  scope: z.enum(['countries', 'capitals', 'cities', 'water']),
  continent: z.enum(Object.keys(continentRegions) as [keyof typeof continentRegions, ...(keyof typeof continentRegions)[]]),
  region: z.string(),
  countryId: z.string().optional(),
  learning: z.enum(['name-to-location', 'capital-to-location', 'location-to-name-recognition', 'shape-recognition', 'country-facts']),
}).refine(selection => selection.region === 'All regions' || continentRegions[selection.continent].includes(selection.region))
  .refine(selection => selection.scope === 'countries'
    ? selection.learning !== 'capital-to-location'
    : selection.learning === 'name-to-location' || (selection.scope === 'capitals' && selection.learning === 'capital-to-location'))
  .refine(selection => selection.countryId === undefined || countriesById.has(selection.countryId));
export type FacetSelection = z.infer<typeof facetSelectionSchema>;
export const learningLabels = { 'name-to-location': 'Name-to-location', 'capital-to-location': 'Country-to-capital location', 'location-to-name-recognition': 'Location-to-name recognition', 'shape-recognition': 'Shape recognition', 'country-facts': 'Country fact cards' };
export function defaultFacets(): FacetSelection {
  return { scope: 'countries', continent: 'Worldwide', region: 'All regions', learning: 'name-to-location' };
}
export function matchesFacets(country: Country, selection: FacetSelection): boolean {
  return (selection.continent === 'Worldwide' || continentRegions[selection.continent].includes(country.properties.region))
    && (selection.region === 'All regions' || country.properties.region === selection.region)
    && (selection.countryId === undefined || country.properties.id === selection.countryId);
}
export function matchesCityFacets(city: City, selection: FacetSelection): boolean {
  const country = countriesById.get(city.countryId);
  return (selection.scope === 'cities' || selection.scope === 'capitals') && (selection.scope !== 'capitals' || city.capital)
    && !!country && matchesFacets(country, selection);
}
export function matchesWaterFacets(feature: WaterFeature, selection: FacetSelection): boolean {
  return selection.scope === 'water'
    && (selection.continent === 'Worldwide' || feature.properties.regions.some(region => continentRegions[selection.continent].includes(region)))
    && (selection.region === 'All regions' || feature.properties.regions.includes(selection.region))
    && (selection.countryId === undefined || feature.properties.countryIds.includes(selection.countryId));
}
export function practiceCandidateCount(selection: FacetSelection | null): number {
  if (!selection) return countries.length;
  return selection.scope === 'countries'
    ? countries.filter(country => matchesFacets(country, selection)).length
    : selection.scope === 'water'
      ? waterFeatures.filter(feature => matchesWaterFacets(feature, selection)).length
      : cities.filter(city => matchesCityFacets(city, selection)).length;
}
export function describeFacets(selection: FacetSelection): string {
  const scope = selection.scope === 'countries' ? 'Countries & territories' : selection.scope === 'capitals' ? 'National capitals' : selection.scope === 'water' ? 'Water features' : 'Major cities';
  const country = selection.countryId ? ` · ${countriesById.get(selection.countryId)!.properties.name}` : '';
  return `${scope} · ${selection.continent} · ${selection.region}${country} · ${learningLabels[selection.learning]}`;
}
