import data from './data/country-facts-2026-09-07.json';

export interface CountryFacts {
  name: string;
  geographicScope: string;
  relationship: string;
  languages: string;
  population: {
    value: number | null;
    referenceYear: number | null;
    direction: 'increasing' | 'decreasing' | 'stable' | 'unavailable';
    period: string;
    note?: string;
  };
  highlight: string;
  sourceIds: string[];
}

export interface FactSource {
  title: string;
  url: string;
  retrievedAt: string;
  license: string;
}

// Published releases are immutable: retain this bundle when adding a new version.
export const factVersion = '2026-09-07';
const release = data as { countries: Record<string, CountryFacts>; sources: Record<string, FactSource> };

export function getCountryFacts(countryId: string, version: string) {
  if (version !== factVersion) throw new Error(`Unknown fact version: ${version}`);
  const facts = release.countries[countryId];
  if (!facts) throw new Error(`Missing country facts: ${countryId}`);
  return { facts, sources: facts.sourceIds.map(id => release.sources[id]) };
}
