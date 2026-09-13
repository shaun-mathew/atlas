import { expect, test } from '@playwright/test';
import type * as SessionModule from '../src/session';
import type * as ProgressModule from '../src/progress';
import type * as FactsModule from '../src/facts';
import type * as CitiesModule from '../src/cities';

test.use({ reducedMotion: 'reduce' });

// Browser callbacks import modules in the application's storage and clock realm;
// static imports would execute the learner model in Node instead.
test('reading-only fact presentations survive reload and merge without becoming assessments', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-12T12:00:00Z'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Custom practice', exact: true }).click();
  const setup = page.getByRole('dialog', { name: 'Custom practice setup' });
  await setup.getByRole('radio', { name: 'Countries & territories', exact: true }).check();
  await setup.getByRole('button', { name: 'Continue', exact: true }).click();
  await setup.getByRole('combobox', { name: 'Continent', exact: true }).selectOption('Asia');
  await setup.getByRole('combobox', { name: 'Region', exact: true }).selectOption('Eastern Asia');
  await setup.getByRole('button', { name: 'Continue', exact: true }).click();
  await setup.getByRole('radio', { name: 'Country fact cards', exact: true }).check();
  await setup.getByRole('button', { name: 'Start reading', exact: true }).click();
  const card = page.getByRole('region', { name: 'Country fact card' });
  await expect(card).toBeVisible();
  const first = await page.evaluate(async () => {
    const sessionPath = '/src/session.ts';
    const { LearnerSession } = await import(sessionPath) as typeof SessionModule;
    return new LearnerSession().snapshot();
  });
  expect(first.factPresentations).toEqual([expect.objectContaining({
    countryId: 'CHN', presentedAt: '2026-09-12T12:00:00.000Z',
  })]);
  expect(first.factPresentations[0].attemptId).toBeUndefined();
  await expect(card).toContainText(first.factPresentations[0].factVersion);
  await page.reload();
  await expect(card).toBeVisible();
  const result = await page.evaluate(async () => {
    const sessionPath = '/src/session.ts';
    const progressPath = '/src/progress.ts';
    const factsPath = '/src/facts.ts';
    const { LearnerSession } = await import(sessionPath) as typeof SessionModule;
    const { mergeProgress } = await import(progressPath) as typeof ProgressModule;
    const { factVersion } = await import(factsPath) as typeof FactsModule;
    const restored = new LearnerSession();
    const otherDevice = new LearnerSession(null);
    otherDevice.choosePractice({ scope: 'countries', continent: 'Worldwide', region: 'All regions', learning: 'country-facts' });
    otherDevice.recordFactPresentation('BRA', factVersion);
    const remote = otherDevice.snapshot();
    const merged = new LearnerSession(null, mergeProgress(restored.snapshot(), remote));
    const mergedAgain = new LearnerSession(null, mergeProgress(remote, merged.snapshot()));
    return { restored: restored.snapshot(), remote, merged: merged.snapshot(), mergedAgain: mergedAgain.snapshot(), proficiency: merged.proficiency };
  });
  expect(result.restored.factPresentations).toEqual(first.factPresentations);
  expect(result.merged.factPresentations).toHaveLength(2);
  expect(result.merged.factPresentations).toEqual(expect.arrayContaining([
    ...first.factPresentations, ...result.remote.factPresentations,
  ]));
  expect(result.mergedAgain.factPresentations).toEqual(result.merged.factPresentations);
  expect(result.merged.attempts).toEqual([]);
  expect(result.proficiency).toBeUndefined();
});

test('unavailable historical city releases remain durable without admitting obsolete pending questions', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const progressPath = '/src/progress.ts';
    const sessionPath = '/src/session.ts';
    const { initialProgress, progressSchema, mergeProgress, boundaryVersion } = await import(progressPath) as typeof ProgressModule;
    const { LearnerSession } = await import(sessionPath) as typeof SessionModule;
    const history = initialProgress();
    history.started = true;
    history.selection = { scope: 'capitals', continent: 'Worldwide', region: 'All regions', learning: 'capital-to-location' };
    history.current = { countryId: 'BRA', cityId: 'retired-capital', skill: 'capital-to-location', kind: 'new', assisted: false };
    history.attempts = [{
      ...history.current, id: 'historical-capital-answer', boundaryVersion, factVersion: '2024-01-01',
      longitude: -47, latitude: -15, distanceKm: 0, toleranceKm: 25, correct: true,
      selectedCountry: 'Historical capital', answeredAt: '2024-01-01T12:00:00.000Z',
    }];
    const restored = progressSchema.parse(history);
    const pending = { ...restored, cursor: restored.attempts.length };
    const learner = new LearnerSession(null, mergeProgress(initialProgress(), restored));
    const mismatchedKnownRelease = structuredClone(history);
    mismatchedKnownRelease.current!.cityId = 'ne-1159151577'; // London belongs to GBR in the published release.
    mismatchedKnownRelease.attempts[0].cityId = 'ne-1159151577';
    mismatchedKnownRelease.attempts[0].factVersion = '2026-09-11';
    return {
      original: history.attempts, retained: learner.snapshot().attempts, feedback: learner.feedback,
      pendingAccepted: progressSchema.safeParse(pending).success,
      mismatchedKnownReleaseAccepted: progressSchema.safeParse(mismatchedKnownRelease).success,
    };
  });
  expect(result.retained).toEqual(result.original);
  expect(result.feedback).toBeUndefined();
  expect(result.pendingAccepted).toBe(false);
  expect(result.mismatchedKnownReleaseAccepted).toBe(false);
});

test('presentation identities reject rewritten releases while old saves merge losslessly', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const progressPath = '/src/progress.ts';
    const { initialProgress, progressSchema, mergeProgress, ProgressConflictError } = await import(progressPath) as typeof ProgressModule;
    const saved = progressSchema.parse({
      ...initialProgress(), started: true,
      factPresentations: [{
        id: 'read-china', countryId: 'CHN', factVersion: '2026-09-07', presentedAt: '2026-09-12T12:00:00.000Z',
      }],
    });
    const rewritten = { ...saved, factPresentations: [{ ...saved.factPresentations[0], factVersion: '2026-09-12' }] };
    let conflictRejected = false;
    try { mergeProgress(saved, rewritten); } catch (error) { conflictRejected = error instanceof ProgressConflictError; }
    const conflictingSaveAccepted = progressSchema.safeParse({
      ...saved, factPresentations: [...saved.factPresentations, ...rewritten.factPresentations],
    }).success;
    // Exercise each migration branch: original, previous, and current saves.
    const oldSaves = [1, 6, 7].map(version => progressSchema.parse({
      version, started: false, cursor: 0, current: null, attempts: [],
    }));
    return {
      conflictRejected, conflictingSaveAccepted, original: saved.factPresentations,
      oldHistories: oldSaves.map(state => state.factPresentations),
      mergedHistories: oldSaves.map(state => mergeProgress(saved, state).factPresentations),
    };
  });
  expect(result.conflictRejected).toBe(true);
  expect(result.conflictingSaveAccepted).toBe(false);
  expect(result.oldHistories).toEqual([[], [], []]);
  for (const history of result.mergedHistories) expect(history).toEqual(result.original);
  expect(result.original[0].factVersion).toBe('2026-09-07');
});

test('historical city cards keep their presented release and provenance after reload', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-12T12:00:00Z'));
  await page.addInitScript(() => {
    if (localStorage.getItem('atlas-practice.guest') !== null) return;
    localStorage.setItem('atlas-practice.guest', JSON.stringify({
      version: 6, started: true, cursor: 0,
      selection: { scope: 'capitals', continent: 'Worldwide', region: 'All regions', learning: 'capital-to-location' },
      current: { countryId: 'GBR', cityId: 'ne-1159151577', skill: 'capital-to-location', kind: 'new', assisted: false },
      attempts: [{
        id: 'london-historical-answer', countryId: 'GBR', cityId: 'ne-1159151577', skill: 'capital-to-location',
        boundaryVersion: 'natural-earth-5.1.2-50m', factVersion: '2026-09-11', kind: 'new', assisted: false,
        longitude: -0.118668, latitude: 51.501941, distanceKm: 0, toleranceKm: 25, correct: true,
        selectedCountry: 'United Kingdom', answeredAt: '2026-09-11T12:00:00.000Z',
      }],
    }));
  });
  await page.goto('/');
  const card = page.getByRole('region', { name: 'City fact card' });
  await expect(card.getByRole('heading', { name: 'London', exact: true })).toBeVisible();
  const released = await page.evaluate(async () => {
    const citiesPath = '/src/cities.ts';
    const sessionPath = '/src/session.ts';
    const { getCityFacts, cityContentVersion } = await import(citiesPath) as typeof CitiesModule;
    const { LearnerSession } = await import(sessionPath) as typeof SessionModule;
    return {
      old: getCityFacts('ne-1159151577', '2026-09-11'),
      current: getCityFacts('ne-1159151577', cityContentVersion),
      progress: new LearnerSession().snapshot(),
    };
  });
  await expect(card).toContainText('2026-09-11');
  await card.getByText('Sources and fact version', { exact: true }).click();
  expect(released.old.geographicScope).not.toBe(released.current.geographicScope);
  await expect(card).toContainText(released.old.geographicScope);
  await expect(card).not.toContainText(released.current.geographicScope);
  await expect(card).toContainText(/Reference year:.*unavailable/i);
  await expect(card.locator('time')).toHaveAttribute('datetime', released.old.reviewedAt);
  expect(released.progress.factPresentations).toEqual([expect.objectContaining({
    countryId: 'GBR', cityId: 'ne-1159151577', factVersion: '2026-09-11', attemptId: 'london-historical-answer',
  })]);
  const historicalCard = await card.textContent();
  await page.reload();
  await expect(card).toHaveText(historicalCard!);
  const restored = await page.evaluate(async () => {
    const sessionPath = '/src/session.ts';
    const { LearnerSession } = await import(sessionPath) as typeof SessionModule;
    return new LearnerSession().snapshot();
  });
  expect(restored.factPresentations).toEqual(released.progress.factPresentations);
  expect(restored.attempts).toEqual(released.progress.attempts);
});
