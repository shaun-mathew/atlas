import { expect, test } from '@playwright/test';
import type * as SessionModule from '../src/session';
import type * as ProgressModule from '../src/progress';
import { answerWorldPoint } from './map-interaction';

test('recommended practice introduces anchors then mixes location and silhouette questions without a mode switch', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-08T12:00:00Z'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Start country session' }).click();
  for (const [name, longitude, latitude] of [['Brazil', -52, -12], ['China', 105, 35], ['Australia', 134, -25]] as const) {
    await expect(page.getByRole('heading', { name: new RegExp(name) })).toBeVisible();
    await answerWorldPoint(page, longitude, latitude);
    await expect(page.getByRole('status')).toContainText('Correct');
    await page.getByRole('button', { name: 'Next learning item' }).click();
  }
  await expect(page.getByRole('button', { name: 'Recommended practice', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: 'this country?', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Brazil/ })).toBeHidden();
  await expect(page.getByRole('region', { name: 'Location-to-name recognition proficiency' })).toBeHidden();
  const search = page.getByRole('combobox', { name: 'Search countries & territories' });
  await search.fill('Brazil');
  await page.getByRole('option', { name: 'Brazil', exact: true }).click();
  await page.getByRole('button', { name: 'Check country' }).click();
  await expect(page.getByRole('region', { name: 'Location-to-name recognition proficiency' })).toContainText('Familiar');
  await page.getByRole('button', { name: 'Next learning item' }).click();
  await expect(page.getByRole('img', { name: 'Country silhouette' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'World map', exact: true })).toBeHidden();
  await expect(page.getByRole('region', { name: 'Country fact card' })).toBeHidden();
  await page.reload();
  await expect(page.getByRole('img', { name: 'Country silhouette' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Recommended practice', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await search.fill('China');
  await page.getByRole('option', { name: /China/ }).click();
  await page.getByRole('button', { name: 'Check answer' }).click();
  await expect(page.getByRole('status')).toContainText('Correct');
  const history = await page.evaluate(() => JSON.parse(localStorage.getItem('atlas-practice.guest')!).attempts.map(
    (attempt: { countryId: string; skill: string }) => `${attempt.countryId}:${attempt.skill}`,
  ));
  expect(history).toEqual([
    'BRA:name-to-location', 'CHN:name-to-location', 'AUS:name-to-location',
    'BRA:location-to-name-recognition', 'CHN:shape-recognition',
  ]);
});

test('recommended reviews include both recognition skills and defer recently exposed siblings without changing their deadlines', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-08T12:10:00Z'));
  await page.goto('/');
  const learner = await page.evaluateHandle(async () => {
    const sessionPath = '/src/session.ts';
    const progressPath = '/src/progress.ts';
    // Static imports execute in Node rather than the application's clock-controlled browser realm.
    const { LearnerSession } = await import(sessionPath) as typeof SessionModule;
    const { initialProgress, boundaryVersion } = await import(progressPath) as typeof ProgressModule;
    const state = initialProgress();
    state.started = true;
    state.current = null;
    state.attempts = [
      { id: 'shape', countryId: 'BRA', skill: 'shape-recognition', answeredAt: '2026-09-08T11:58:00.000Z' },
      { id: 'location', countryId: 'BRA', skill: 'location-to-name-recognition', answeredAt: '2026-09-08T11:59:00.000Z' },
    ].map(attempt => ({ ...attempt, kind: 'new' as const, correct: false, assisted: false,
      boundaryVersion, factVersion: '2026-09-07', selectedCountry: 'Argentina', selectedCountryId: 'ARG' }));
    state.cursor = state.attempts.length;
    return new LearnerSession(null, state);
  });
  expect(await learner.evaluate(session => ({ country: session.country?.properties.id, skill: session.skill, kind: session.questionKind })))
    .toEqual({ country: 'BRA', skill: 'shape-recognition', kind: 'review' });
  await learner.evaluate(session => { session.answerCountry('BRA'); session.next(); });
  expect(await learner.evaluate(session => session.country?.properties.id)).not.toBe('BRA');
  await page.clock.setFixedTime(new Date('2026-09-08T12:20:00Z'));
  const due = await learner.evaluate(session => {
    // Reload without an active prompt to exercise selection after the exposure window expires.
    const state = session.snapshot();
    state.current = null;
    session.replace(state);
    return { country: session.country?.properties.id, skill: session.skill, kind: session.questionKind, dueAt: session.proficiency?.dueAt };
  });
  expect(due).toEqual({ country: 'BRA', skill: 'location-to-name-recognition', kind: 'review', dueAt: '2026-09-08T12:09:00.000Z' });
  await learner.dispose();
});

test('guided location successes do not unlock new recognition skills', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-08T12:00:00Z'));
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const sessionPath = '/src/session.ts';
    // Load inside the browser realm so the public session uses the fixed clock.
    const { LearnerSession } = await import(sessionPath) as typeof SessionModule;
    const learner = new LearnerSession(null);
    learner.start();
    learner.requestLocationHelp();
    learner.answer(-52, -12);
    const guided = learner.feedback;
    const skills = [];
    for (let index = 0; index < 10; index++) {
      learner.next();
      skills.push(learner.skill);
      learner.requestLocationHelp();
      learner.answer(0, 0);
    }
    return { guided, skills };
  });
  expect(result.guided).toMatchObject({ countryId: 'BRA', correct: true, assisted: true });
  expect(result.skills).toEqual(Array(10).fill('name-to-location'));
});
