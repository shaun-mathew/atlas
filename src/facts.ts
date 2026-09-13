import data from './data/country-facts-2026-09-07.json' with { type: 'json' };
import { FactReleases, type FactRelease } from './fact-releases';

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

// Original text and source retrieval dates remain pinned. The historical
// snapshot's explicit provenance is reviewed now, not backdated to retrieval.
const original: FactRelease<CountryFacts> = {
  version: '2026-09-07',
  reviewedAt: '2026-09-12',
  facts: data.countries as Record<string, CountryFacts>,
  sources: data.sources,
  provenance: Object.fromEntries(Object.entries(data.countries).map(([id, facts]) => [
    id, { referenceYear: facts.population.referenceYear, geographicScope: facts.geographicScope },
  ])),
  changes: [],
};

// A scope clarification from the existing AUS card and its Natural Earth
// source, not a new boundary observation or a material learning-item change.
const clarifiedFacts: Record<string, CountryFacts> = {
  ...original.facts,
  AUS: {
    ...original.facts.AUS,
    geographicScope: 'Australian national profile; the map includes the mainland, Tasmania and other islands. Separately mapped Australian external territories have their own cards. This card follows Natural Earth 5.1.2, not a live boundary service.',
  },
};

export const countryFactReleases = new FactReleases([
  original,
  {
    ...original,
    version: '2026-09-12',
    facts: clarifiedFacts,
    provenance: {
      ...original.provenance,
      AUS: { ...original.provenance.AUS, geographicScope: clarifiedFacts.AUS.geographicScope },
    },
    changes: [],
  },
]);
export const factVersion = countryFactReleases.currentVersion;

export function getCountryFacts(countryId: string, version: string) {
  return countryFactReleases.get(countryId, version);
}
