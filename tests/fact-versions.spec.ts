import { expect, test } from '@playwright/test';
import { FactReleases, type FactRelease } from '../src/fact-releases';
import { countryFactReleases, factVersion, getCountryFacts } from '../src/facts';
import { cityFactReleases, cityContentVersion, getCityFacts } from '../src/cities';

interface ExampleFacts {
  highlight: string;
  sourceIds: string[];
}

function release(version: string, highlight: string): FactRelease<ExampleFacts> {
  return {
    version,
    reviewedAt: '2026-09-12',
    facts: { place: { highlight, sourceIds: ['reviewed-source'] } },
    sources: {
      'reviewed-source': {
        title: 'Reviewed geographic source',
        url: 'https://example.org/geography',
        retrievedAt: '2026-09-07',
        license: 'Public domain',
      },
    },
    provenance: { place: { referenceYear: null, geographicScope: 'Canonical city point, not a municipal boundary.' } },
    changes: [],
  };
}

test('a later reviewed release replaces current content without rewriting historical lookup', () => {
  const releases = new FactReleases([
    release('original', 'Canonical city point.'),
    release('clarified', 'Canonical city point, not a municipal boundary.'),
  ]);

  expect(releases.currentVersion).toBe('clarified');
  expect(releases.get('place', 'original').facts.highlight).toBe('Canonical city point.');
  expect(releases.get('place', releases.currentVersion).facts.highlight).toBe('Canonical city point, not a municipal boundary.');
  expect(releases.has('place', 'original')).toBe(true);
  expect(releases.has('place', 'unpublished')).toBe(false);
  expect(() => releases.get('place', 'unpublished')).toThrow();
  expect(() => releases.get('unknown', 'original')).toThrow();
});

test('unreviewed releases, undocumented scope and unresolvable sources never become publishable', () => {
  const unreviewed = release('draft', 'Draft claim.');
  unreviewed.reviewedAt = '';
  expect(() => new FactReleases([unreviewed])).toThrow();

  const undocumented = release('undocumented', 'Claim without scope.');
  undocumented.provenance = {};
  expect(() => new FactReleases([undocumented])).toThrow();

  const unsourced = release('unsourced', 'Claim without evidence.');
  unsourced.facts.place.sourceIds = ['missing-source'];
  expect(() => new FactReleases([unsourced])).toThrow();

  const unsafeLink = release('unsafe-link', 'Claim with an invalid source.');
  unsafeLink.sources['reviewed-source'].url = 'javascript:alert(1)';
  expect(() => new FactReleases([unsafeLink])).toThrow();
});

test('published snapshots cannot be rewritten through release inputs or returned fact cards', () => {
  const original = release('original', 'Reviewed point.');
  const releases = new FactReleases([original]);
  original.facts.place.highlight = 'Unreviewed edit.';
  original.sources['reviewed-source'].title = 'Rewritten attribution';
  original.provenance.place.geographicScope = 'Unreviewed boundary.';

  const card = releases.get('place', 'original');
  expect(card.facts.highlight).toBe('Reviewed point.');
  expect(card.sources[0].title).toBe('Reviewed geographic source');
  expect(card.geographicScope).toBe('Canonical city point, not a municipal boundary.');

  Reflect.set(card.facts, 'highlight', 'Injected claim.');
  Reflect.set(card.facts.sourceIds, 0, 'missing-source');
  Reflect.set(card.sources[0], 'url', 'https://unreviewed.example');
  Reflect.set(card, 'referenceYear', 2026);

  const replay = releases.get('place', 'original');
  expect(replay.facts.highlight).toBe('Reviewed point.');
  expect(replay.sources[0].url).toBe('https://example.org/geography');
  expect(replay.referenceYear).toBeNull();
});

test('material changes reintroduce only declared entity skills after the recorded release', () => {
  const original = release('z-original', 'Original point.');
  original.reviewedAt = '2026-09-07';
  original.facts.other = { highlight: 'Unaffected point.', sourceIds: ['reviewed-source'] };
  original.provenance.other = { referenceYear: null, geographicScope: 'Another canonical point.' };

  const capital = release('a-capital', 'Changed capital relationship.');
  capital.reviewedAt = '2026-09-10';
  capital.changes = [{ entityId: 'place', skills: ['capital-to-location'], reason: 'Reviewed capital relationship changed.' }];
  const name = release('m-name', 'Changed point name.');
  name.reviewedAt = '2026-09-11';
  name.changes = [{ entityId: 'place', skills: ['name-to-location'], reason: 'Reviewed display name changed.' }];
  const clarification = release('b-clarification', 'Clarified source scope.');
  clarification.reviewedAt = '2026-09-11';
  const laterCapital = release('c-capital', 'Later capital relationship.');
  laterCapital.changes = [{ entityId: 'place', skills: ['capital-to-location'], reason: 'A subsequent reviewed capital relationship changed.' }];
  const releases = new FactReleases([original, capital, name, clarification, laterCapital]);

  expect(releases.reviewAfter('place', 'capital-to-location', 'z-original')).toBe('2026-09-12T00:00:00.000Z');
  expect(releases.reviewAfter('place', 'name-to-location', 'a-capital')).toBe('2026-09-11T00:00:00.000Z');
  expect(releases.reviewAfter('place', 'name-to-location', 'm-name')).toBeUndefined();
  expect(releases.reviewAfter('place', 'shape-recognition', 'z-original')).toBeUndefined();
  expect(releases.reviewAfter('other', 'capital-to-location', 'z-original')).toBeUndefined();
  expect(releases.reviewAfter('place', 'capital-to-location', 'c-capital')).toBeUndefined();
  expect(releases.reviewAfter('place', 'capital-to-location', 'unpublished')).toBeUndefined();

  const population = release('population', 'Informational population change.');
  population.changes = [{ entityId: 'place', skills: ['population-direction'], reason: 'Population indicator changed.' }];
  expect(() => new FactReleases([original, population])).toThrow();
  expect(releases.reviewAfter('place', 'population-direction', 'z-original')).toBeUndefined();
});

test('review dates cannot substitute for explicit release order', () => {
  const original = release('z-original', 'Original point.');
  const later = release('a-later', 'Changed point.');
  later.changes = [{ entityId: 'place', skills: ['name-to-location'], reason: 'Reviewed point changed.' }];
  const releases = new FactReleases([original, later]);
  expect(releases.reviewAfter('place', 'name-to-location', 'z-original')).toBe('2026-09-12T00:00:00.000Z');
  expect(releases.reviewAfter('place', 'name-to-location', 'a-later')).toBeUndefined();
});

test('ambiguous versions and incomplete or impossible provenance cannot be published', () => {
  expect(() => new FactReleases([])).toThrow();
  expect(() => new FactReleases([release('same', 'First claim.'), release('same', 'Conflicting claim.')])).toThrow();

  const missingYear = release('missing-year', 'A source without a dated observation.');
  Reflect.deleteProperty(missingYear.provenance.place, 'referenceYear');
  expect(() => new FactReleases([missingYear])).toThrow();

  const invalidReviewDate = release('invalid-review-date', 'Reviewed point.');
  invalidReviewDate.reviewedAt = '2026-02-30';
  expect(() => new FactReleases([invalidReviewDate])).toThrow();

  const futureSource = release('future-source', 'Reviewed before source retrieval.');
  futureSource.sources['reviewed-source'].retrievedAt = '2026-09-13';
  expect(() => new FactReleases([futureSource])).toThrow();

  const unlicensed = release('unlicensed', 'Source with no reuse information.');
  unlicensed.sources['reviewed-source'].license = '';
  expect(() => new FactReleases([unlicensed])).toThrow();

  const unknownChange = release('unknown-change', 'Reviewed point.');
  unknownChange.changes = [{ entityId: 'unknown', skills: ['name-to-location'], reason: 'Unsupported entity change.' }];
  expect(() => new FactReleases([unknownChange])).toThrow();
});

test('country and city helpers replay original cards with honest version-specific provenance', () => {
  const oldAustralia = getCountryFacts('AUS', '2026-09-07');
  const currentAustralia = getCountryFacts('AUS', factVersion);
  expect(oldAustralia.facts.geographicScope).not.toContain('not a live boundary service');
  expect(currentAustralia.geographicScope).toContain('Natural Earth 5.1.2, not a live boundary service');
  expect(currentAustralia.referenceYear).toBe(2025);
  expect(currentAustralia.facts.population).toEqual(oldAustralia.facts.population);
  expect(getCountryFacts('IOA', factVersion).referenceYear).toBe(2021);
  expect(getCountryFacts('ATC', '2026-09-07').referenceYear).toBeNull();
  expect(currentAustralia.sources.every(source => source.retrievedAt === '2026-09-07')).toBe(true);
  expect(currentAustralia.reviewedAt).toBe('2026-09-12');
  expect(countryFactReleases.reviewAfter('AUS', 'name-to-location', '2026-09-07')).toBeUndefined();

  const oldKabul = getCityFacts('ne-1159151561', '2026-09-11');
  const currentKabul = getCityFacts('ne-1159151561', cityContentVersion);
  expect(currentKabul.city).toEqual(oldKabul.city);
  expect(oldKabul.geographicScope).not.toContain('sovereignty');
  expect(currentKabul.geographicScope).toContain('inclusion and names do not decide sovereignty');
  expect(oldKabul.referenceYear).toBeNull();
  expect(currentKabul.referenceYear).toBeNull();
  expect(currentKabul.sources.every(source => source.retrievedAt === '2026-09-10')).toBe(true);
  expect(currentKabul.reviewedAt).toBe('2026-09-12');
  expect(cityFactReleases.reviewAfter('ne-1159151561', 'capital-to-location', '2026-09-11')).toBeUndefined();
});
