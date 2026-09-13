import { expect, test } from '@playwright/test';
import type * as SessionModule from '../src/session';
import type * as ProgressModule from '../src/progress';
import type * as FactsModule from '../src/facts';
import type * as CitiesModule from '../src/cities';
import type * as ReleasesModule from '../src/fact-releases';

// Load application modules in the browser realm, where storage and the test clock live.

test('a nonmaterial release retains historical feedback and proficiency without rewriting attempts', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const sessionPath = '/src/session.ts';
    const progressPath = '/src/progress.ts';
    const factsPath = '/src/facts.ts';
    const citiesPath = '/src/cities.ts';
    const releasesPath = '/src/fact-releases.ts';
    const { LearnerSession } = await import(sessionPath) as typeof SessionModule;
    const { initialProgress, boundaryVersion } = await import(progressPath) as typeof ProgressModule;
    const { getCountryFacts } = await import(factsPath) as typeof FactsModule;
    const { cityFactReleases } = await import(citiesPath) as typeof CitiesModule;
    const { FactReleases } = await import(releasesPath) as typeof ReleasesModule;
    const original = getCountryFacts('BRA', '2026-09-07');
    const release = {
      version: '2026-09-07', reviewedAt: '2026-09-07', facts: { BRA: original.facts },
      sources: Object.fromEntries(original.facts.sourceIds.map((id, index) => [id, original.sources[index]])),
      provenance: { BRA: { referenceYear: 2025, geographicScope: original.facts.geographicScope } }, changes: [],
    };
    const countries = new FactReleases([release, { ...release, version: '2026-09-12', reviewedAt: '2026-09-12',
      facts: { BRA: { ...original.facts, population: { ...original.facts.population, direction: 'stable' as const } } } }]);
    const state = initialProgress();
    state.started = true;
    state.attempts = [{ id: 'historical', countryId: 'BRA', skill: 'name-to-location', kind: 'new',
      boundaryVersion, factVersion: '2026-09-07', longitude: -52, latitude: -12, correct: true,
      assisted: false, selectedCountry: 'Brazil', answeredAt: '2026-09-11T12:00:00.000Z' }];
    const before = new LearnerSession(null, state, { countries: new FactReleases([release]), cities: cityFactReleases });
    const after = new LearnerSession(null, state, { countries, cities: cityFactReleases });
    return { before: before.proficiency, after: after.proficiency, feedback: after.feedback, attempts: after.snapshot().attempts,
      originalAttempts: state.attempts };
  });
  expect(result.after?.level).toBe('Familiar');
  expect(result.after).toEqual(result.before);
  expect(result.feedback?.factVersion).toBe('2026-09-07');
  expect(result.attempts).toEqual(result.originalAttempts);
});

test('a material change advances only its learning item and a retry cannot discharge the review', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-12T12:00:00Z'));
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const sessionPath = '/src/session.ts';
    const progressPath = '/src/progress.ts';
    const factsPath = '/src/facts.ts';
    const citiesPath = '/src/cities.ts';
    const releasesPath = '/src/fact-releases.ts';
    const { LearnerSession } = await import(sessionPath) as typeof SessionModule;
    const { initialProgress, boundaryVersion } = await import(progressPath) as typeof ProgressModule;
    const { getCountryFacts } = await import(factsPath) as typeof FactsModule;
    const { cityFactReleases } = await import(citiesPath) as typeof CitiesModule;
    const { FactReleases } = await import(releasesPath) as typeof ReleasesModule;
    const original = getCountryFacts('BRA', '2026-09-07');
    const release = {
      version: '2026-09-07', reviewedAt: '2026-09-07', facts: { BRA: original.facts },
      sources: Object.fromEntries(original.facts.sourceIds.map((id, index) => [id, original.sources[index]])),
      provenance: { BRA: { referenceYear: 2025, geographicScope: original.facts.geographicScope } }, changes: [],
    };
    const countries = new FactReleases([release, { ...release, version: '2026-09-12', reviewedAt: '2026-09-12',
      changes: [{ entityId: 'BRA', skills: ['name-to-location'], reason: 'Reviewed spatial interpretation changed (test fixture).' }] }]);
    const state = initialProgress();
    state.started = true;
    state.selection = { scope: 'countries', continent: 'Worldwide', region: 'All regions', learning: 'name-to-location' };
    const recall = { id: 'recall', countryId: 'BRA', skill: 'name-to-location', kind: 'new' as const,
      boundaryVersion, factVersion: '2026-09-07', longitude: -52, latitude: -12, correct: true,
      assisted: false, selectedCountry: 'Brazil', answeredAt: '2026-09-11T12:00:00.000Z' };
    state.attempts = [recall, { ...recall, id: 'shape', skill: 'shape-recognition',
      longitude: undefined, latitude: undefined, selectedCountryId: 'BRA' }];
    state.current = { countryId: 'BRA', skill: 'shape-recognition', kind: 'practice', assisted: false };
    state.cursor = state.attempts.length;
    const oldContent = { countries: new FactReleases([release]), cities: cityFactReleases };
    const content = { countries, cities: cityFactReleases };
    const oldShape = new LearnerSession(null, state, oldContent).proficiency;
    const newShape = new LearnerSession(null, state, content).proficiency;
    state.current = null;
    // Even seeing the updated card in an immediate retry is not a retention check.
    state.attempts.push({ ...recall, id: 'retry', kind: 'retry', factVersion: '2026-09-12',
      answeredAt: '2026-09-12T11:00:00.000Z' });
    state.cursor = state.attempts.length;
    const learner = new LearnerSession(null, state, content);
    const pending = { country: learner.country?.properties.id, kind: learner.questionKind, dueAt: learner.proficiency?.dueAt };
    learner.answer(-52, -12);
    const resolved = { dueAt: learner.proficiency?.dueAt, version: learner.feedback?.factVersion, correct: learner.feedback?.correct };
    const saved = learner.snapshot();
    const restored = new LearnerSession(null, saved, content);
    return { oldShape, newShape, pending, resolved, restoredDueAt: restored.proficiency?.dueAt,
      historical: restored.attempts[0], original: recall };
  });
  expect(result.newShape).toEqual(result.oldShape);
  expect(result.pending).toEqual({ country: 'BRA', kind: 'review', dueAt: '2026-09-12T00:00:00.000Z' });
  expect(result.resolved.correct).toBe(true);
  expect(result.resolved.version).toBe('2026-09-12');
  expect(result.resolved.dueAt! > '2026-09-12T12:00:00.000Z').toBe(true);
  expect(result.restoredDueAt).toBe(result.resolved.dueAt);
  expect(result.historical).toEqual(result.original);
});

test('city location updates preserve the old answer and grade the future review against the new point', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-12T12:00:00Z'));
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const sessionPath = '/src/session.ts';
    const progressPath = '/src/progress.ts';
    const factsPath = '/src/facts.ts';
    const citiesPath = '/src/cities.ts';
    const releasesPath = '/src/fact-releases.ts';
    const { LearnerSession } = await import(sessionPath) as typeof SessionModule;
    const { initialProgress, boundaryVersion } = await import(progressPath) as typeof ProgressModule;
    const { countryFactReleases } = await import(factsPath) as typeof FactsModule;
    const { cities, getCityFacts, cityToleranceKm } = await import(citiesPath) as typeof CitiesModule;
    const { FactReleases } = await import(releasesPath) as typeof ReleasesModule;
    const city = cities.find(city => city.countryId === 'BRA' && city.capital)!;
    const original = getCityFacts(city.id, '2026-09-11');
    const release = {
      version: '2026-09-11', reviewedAt: '2026-09-11', facts: { [city.id]: original.city },
      sources: Object.fromEntries(original.city.sourceIds.map((id, index) => [id, original.sources[index]])),
      provenance: { [city.id]: { referenceYear: null, geographicScope: 'Representative city centre.' } }, changes: [],
    };
    const updatedCity = { ...city, longitude: city.longitude + 1 };
    const cityReleases = new FactReleases([release, { ...release, version: '2026-09-12', reviewedAt: '2026-09-12',
      facts: { [city.id]: updatedCity }, changes: [{ entityId: city.id, skills: ['name-to-location', 'capital-to-location'],
        reason: 'Reviewed target correction (test fixture).' }] }]);
    const state = initialProgress();
    state.started = true;
    state.selection = { scope: 'capitals', continent: 'Worldwide', region: 'All regions', learning: 'capital-to-location' };
    state.current = { countryId: city.countryId, cityId: city.id, skill: 'capital-to-location', kind: 'new', assisted: false };
    state.attempts = [{ ...state.current, id: 'old-city-answer', boundaryVersion, factVersion: '2026-09-11',
      longitude: city.longitude, latitude: city.latitude, distanceKm: 0, toleranceKm: cityToleranceKm,
      correct: true, selectedCountry: null, answeredAt: '2026-09-11T12:00:00.000Z' }];
    const content = { countries: countryFactReleases, cities: cityReleases };
    const learner = new LearnerSession(null, state, content);
    const historical = { answer: learner.feedback, longitude: learner.city?.longitude };
    learner.next();
    const kind = learner.questionKind;
    learner.answer(city.longitude, city.latitude);
    return { original: state.attempts[0], historical, originalLongitude: city.longitude, kind,
      reviewed: learner.feedback, targetLongitude: learner.city?.longitude, updatedLongitude: updatedCity.longitude,
      savedHistory: new LearnerSession(null, learner.snapshot(), content).attempts[0] };
  });
  expect(result.historical.answer).toEqual(result.original);
  expect(result.historical.longitude).toBe(result.originalLongitude);
  expect(result.kind).toBe('review');
  expect(result.reviewed?.correct).toBe(false);
  expect(result.reviewed?.factVersion).toBe('2026-09-12');
  expect(result.targetLongitude).toBe(result.updatedLongitude);
  expect(result.savedHistory).toEqual(result.original);
});
