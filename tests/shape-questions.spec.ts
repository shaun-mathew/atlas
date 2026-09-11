import { expect, test } from '@playwright/test';
import type * as SessionModule from '../src/session';
import type * as ProgressModule from '../src/progress';
import type * as GeographyModule from '../src/geography';

test.use({ reducedMotion: 'reduce' });

test('a guest identifies a silhouette without location clues and receives dated facts', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Custom practice', exact: true }).click();
  const setup = page.getByRole('dialog', { name: 'Custom practice setup' });
  await setup.getByRole('radio', { name: 'Countries & territories', exact: true }).check();
  await setup.getByRole('button', { name: 'Continue', exact: true }).click();
  await setup.getByRole('button', { name: 'Continue', exact: true }).click();
  await setup.getByRole('radio', { name: 'Shape recognition', exact: true }).check();
  await setup.getByRole('button', { name: 'Start practice', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Country silhouette', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'World map', exact: true })).toBeHidden();
  await expect(page.getByRole('heading', { name: /Brazil/ })).toBeHidden();
  await expect(page.getByRole('region', { name: 'Country fact card' })).toBeHidden();
  const search = page.getByRole('combobox', { name: 'Search countries & territories' });
  const check = page.getByRole('button', { name: 'Check answer', exact: true });
  await search.fill('bRÁz');
  await expect(page.getByRole('option', { name: 'Brazil', exact: true })).toBeVisible();
  await expect(check).toBeDisabled();
  await page.getByRole('option', { name: 'Brazil', exact: true }).click();
  await expect(check).toBeEnabled();
  await search.fill('no such country');
  await expect(page.getByRole('option')).toHaveCount(0);
  await expect(check).toBeDisabled();
  await search.fill('braz');
  await page.getByRole('option', { name: 'Brazil', exact: true }).click();
  await page.getByRole('button', { name: 'Check answer', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Correct');
  const card = page.getByRole('region', { name: 'Country fact card' });
  await expect(card.getByRole('heading', { name: 'Brazil', exact: true })).toBeVisible();
  await expect(card).toContainText('2026-09-07');
  await expect(page.getByRole('region', { name: 'Shape recognition proficiency' })).toContainText('Familiar');
  await page.reload();
  await expect(page.getByRole('status')).toContainText('Correct');
  await expect(card.getByRole('heading', { name: 'Brazil', exact: true })).toBeVisible();
});

test('default shape practice shows only target geometry and reveals the answer after a miss', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Custom practice', exact: true }).click();
  const setup = page.getByRole('dialog', { name: 'Custom practice setup' });
  await setup.getByRole('button', { name: 'Continue', exact: true }).click();
  await setup.getByRole('button', { name: 'Continue', exact: true }).click();
  await setup.getByRole('radio', { name: 'Shape recognition', exact: true }).check();
  await setup.getByRole('button', { name: 'Start practice', exact: true }).click();
  const presentation = page.getByRole('region', { name: 'Shape question' });
  const silhouette = presentation.getByRole('img', { name: 'Country silhouette', exact: true });
  await expect(silhouette).toBeVisible();
  const targetParts = await page.evaluate(async () => {
    const modulePath = '/src/geography.ts';
    // Resolve geography in the application's browser realm rather than Node.
    const { countries } = await import(modulePath) as typeof GeographyModule;
    const target = countries.find(country => country.properties.id === 'BRA')!;
    return target.geometry.type === 'Polygon' ? 1 : target.geometry.coordinates.length;
  });
  await expect(silhouette.locator('path')).toHaveCount(targetParts);
  await expect(silhouette.locator('path:not(.shape-target), text')).toHaveCount(0);
  await expect(presentation.getByText('Argentina', { exact: true })).toBeHidden();
  await expect(presentation.getByText('Brazil', { exact: true })).toBeHidden();
  const search = page.getByRole('combobox', { name: 'Search countries & territories' });
  await search.fill('argen');
  await page.getByRole('option', { name: 'Argentina', exact: true }).click();
  await page.getByRole('button', { name: 'Check answer', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Not quite');
  await expect(page.getByRole('status')).toContainText('Brazil');
  await expect(page.getByRole('region', { name: 'Country fact card' }).getByRole('heading', { name: 'Brazil', exact: true })).toBeVisible();
});

test('repeated shape misses bring review forward without letting later retries postpone it', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-07T12:00:00Z'));
  await page.goto('/');
  const session = await page.evaluateHandle(async () => {
    const modulePath = '/src/session.ts';
    // Load in the browser realm so the public API uses Playwright's fixed clock.
    const { LearnerSession } = await import(modulePath) as typeof SessionModule;
    const learner = new LearnerSession(null);
    learner.choosePractice({
      scope: 'countries', continent: 'Worldwide', region: 'All regions',
      learning: 'shape-recognition',
    });
    learner.answerCountry('BRA');
    const practice = learner.snapshot();
    practice.current = { countryId: 'BRA', skill: 'shape-recognition', kind: 'practice', assisted: false };
    practice.cursor = practice.attempts.length;
    learner.replace(practice);
    learner.answerCountry('ARG');
    learner.retry();
    return learner;
  });
  expect(await session.evaluate(learner => learner.proficiency)).toMatchObject({
    level: 'Familiar', dueAt: '2026-09-08T12:00:00.000Z',
  });
  await page.clock.setFixedTime(new Date('2026-09-07T12:09:00Z'));
  await session.evaluate(learner => {
    learner.replace(learner.snapshot());
    learner.answerCountry('ARG');
    learner.retry();
  });
  expect(await session.evaluate(learner => learner.proficiency)).toMatchObject({
    level: 'Learning', dueAt: '2026-09-07T12:19:00.000Z',
  });
  await page.clock.setFixedTime(new Date('2026-09-07T12:18:00Z'));
  await session.evaluate(learner => {
    learner.answerCountry('ARG');
    learner.retry();
    learner.answerCountry('ARG');
    learner.retry();
  });
  await session.evaluate(learner => learner.answerCountry('BRA'));
  expect(await session.evaluate(learner => learner.proficiency)).toMatchObject({
    level: 'Learning', dueAt: '2026-09-07T12:19:00.000Z',
  });
  await page.clock.setFixedTime(new Date('2026-09-07T12:19:00Z'));
  expect(await session.evaluate(learner => {
    learner.next();
    return { country: learner.country?.properties.id, kind: learner.questionKind };
  })).toEqual({ country: 'BRA', kind: 'review' });
  await session.dispose();
});

test('scheduled shape successes advance retention while name-to-location keeps its own review', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-07T12:00:00Z'));
  await page.goto('/');
  const session = await page.evaluateHandle(async () => {
    const modulePath = '/src/session.ts';
    // Static imports cannot enter the browser realm that owns the fixed clock.
    const { LearnerSession } = await import(modulePath) as typeof SessionModule;
    const learner = new LearnerSession(null);
    learner.start();
    learner.answer(-52, -12);
    learner.choosePractice({
      scope: 'countries', continent: 'Worldwide', region: 'All regions',
      learning: 'shape-recognition',
    });
    return learner;
  });
  expect(await session.evaluate(learner => learner.proficiency)).toBeUndefined();
  await session.evaluate(learner => learner.answerCountry('BRA'));
  for (const [date, nextDue] of [
    ['2026-09-08', '2026-09-11T12:00:00.000Z'],
    ['2026-09-11', '2026-09-18T12:00:00.000Z'],
    ['2026-09-18', '2026-10-02T12:00:00.000Z'],
  ]) {
    await page.clock.setFixedTime(new Date(`${date}T12:00:00Z`));
    expect(await session.evaluate(learner => {
      learner.replace(learner.snapshot());
      learner.next();
      return { country: learner.country?.properties.id, kind: learner.questionKind };
    })).toEqual({ country: 'BRA', kind: 'review' });
    expect(await session.evaluate(learner => {
      learner.answerCountry('BRA');
      return learner.proficiency;
    })).toMatchObject({ level: 'Retained', dueAt: nextDue });
  }
  expect(await session.evaluate(learner => {
    learner.choosePractice(null);
    return { country: learner.country?.properties.id, proficiency: learner.proficiency };
  })).toMatchObject({
    country: 'BRA', proficiency: { level: 'Familiar', dueAt: '2026-09-08T12:00:00.000Z' },
  });
  await session.dispose();
});

test('reading facts cannot turn either paused skill for the same country into unassisted retention', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-07T12:00:00Z'));
  await page.goto('/');
  const session = await page.evaluateHandle(async () => {
    const modulePath = '/src/session.ts';
    // Exercise the public API in the browser realm that owns the fixed clock.
    const { LearnerSession } = await import(modulePath) as typeof SessionModule;
    const learner = new LearnerSession(null);
    learner.start();
    learner.choosePractice({
      scope: 'countries', continent: 'Worldwide', region: 'All regions',
      learning: 'shape-recognition',
    });
    learner.choosePractice({
      scope: 'countries', continent: 'Worldwide', region: 'All regions', learning: 'country-facts',
    });
    learner.replace(learner.snapshot());
    learner.choosePractice(null);
    return learner;
  });
  expect(await session.evaluate(learner => learner.assisted)).toBe(true);
  expect(await session.evaluate(learner => {
    learner.answer(-52, -12);
    return learner.proficiency;
  })).toMatchObject({ level: 'Learning', dueAt: '2026-09-07T12:10:00.000Z' });
  expect(await session.evaluate(learner => {
    learner.choosePractice({
      scope: 'countries', continent: 'Worldwide', region: 'All regions',
      learning: 'shape-recognition',
    });
    return learner.assisted;
  })).toBe(true);
  expect(await session.evaluate(learner => {
    learner.answerCountry('BRA');
    return learner.proficiency;
  })).toMatchObject({ level: 'Learning', dueAt: '2026-09-07T12:10:00.000Z' });
  await session.dispose();
});

test('mobile keyboard answers keep focus through silhouette feedback and retry', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Custom practice', exact: true }).click();
  const setup = page.getByRole('dialog', { name: 'Custom practice setup' });
  await setup.getByRole('button', { name: 'Continue', exact: true }).click();
  await setup.getByRole('button', { name: 'Continue', exact: true }).click();
  await setup.getByRole('radio', { name: 'Shape recognition', exact: true }).check();
  await setup.getByRole('button', { name: 'Start practice', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Country silhouette', exact: true })).toBeVisible();
  const choice = page.getByRole('combobox', { name: 'Search countries & territories' });
  await choice.fill('u.k.');
  await expect(page.getByRole('option', { name: 'United Kingdom', exact: true })).toBeVisible();
  await choice.fill('braz');
  await choice.press('ArrowDown');
  await choice.press('Enter');
  await choice.press('Tab');
  await page.keyboard.press('Enter');
  const next = page.getByRole('button', { name: 'Next learning item', exact: true });
  await expect(next).toBeFocused();
  await expect(page.getByRole('region', { name: 'Country fact card' })).toContainText('Brazil');
  await page.keyboard.press('Enter');
  await expect(choice).toBeFocused();
  await page.getByRole('button', { name: 'Edit practice set' }).click();
  await setup.getByRole('button', { name: '2 Geography' }).click();
  await setup.getByRole('combobox', { name: 'Continent', exact: true }).selectOption('Oceania');
  await setup.getByRole('button', { name: 'Continue', exact: true }).click();
  await setup.getByRole('button', { name: 'Start practice', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Country silhouette', exact: true })).toBeVisible();
  await choice.fill('u.k.');
  await expect(page.getByRole('option')).toHaveCount(0);
  await choice.fill('new zeal');
  await choice.press('ArrowDown');
  await choice.press('Escape');
  await expect(page.getByRole('listbox')).toBeHidden();
  await choice.press('Enter');
  await expect(page.getByRole('button', { name: 'Check answer', exact: true })).toBeDisabled();
  await choice.press('ArrowDown');
  await choice.press('Enter');
  await choice.press('Tab');
  await page.keyboard.press('Enter');
  await expect(next).toBeFocused();
  await expect(page.getByRole('status')).toContainText('Not quite');
  await expect(page.getByRole('region', { name: 'Country fact card' })).toContainText('Australia');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(choice).toBeFocused();
  await expect(page.getByRole('region', { name: 'Country fact card' })).toBeHidden();
});

test('old context-bearing saves preserve answer identity, feedback, retries, and review scheduling', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-07T12:09:00Z'));
  await page.goto('/');
  const session = await page.evaluateHandle(async () => {
    const sessionPath = '/src/session.ts';
    const progressPath = '/src/progress.ts';
    // Browser imports share the application's localStorage and fixed clock.
    const { LearnerSession } = await import(sessionPath) as typeof SessionModule;
    const { progressSchema, mergeProgress } = await import(progressPath) as typeof ProgressModule;
    const legacy = {
      version: 6, started: true, cursor: 0, readingCountryId: null, pausedQuestions: [],
      selection: {
        scope: 'countries', continent: 'Worldwide', region: 'All regions',
        learning: 'shape-recognition', startingContext: 'rich',
      },
      current: { countryId: 'BRA', skill: 'shape-recognition', kind: 'new', assisted: false, difficultyContext: 'rich' },
      attempts: [{
        countryId: 'BRA', skill: 'shape-recognition', kind: 'new', assisted: false,
        boundaryVersion: 'natural-earth-5.1.2-50m', factVersion: '2026-09-07',
        difficultyContext: 'rich', selectedCountryId: 'ARG', selectedCountry: 'Argentina',
        correct: false, answeredAt: '2026-09-07T12:00:00.000Z',
      }],
    };
    localStorage.setItem('shape-migration', JSON.stringify(legacy));
    const learner = new LearnerSession('shape-migration');
    // An already-imported copy must deduplicate against the pre-cutover ID.
    const imported = progressSchema.parse({
      ...legacy, attempts: [{ ...legacy.attempts[0], id: 'attempt-0000000000-46f34fefb3e7108b' }],
    });
    learner.replace(mergeProgress(imported, learner.snapshot()));
    return learner;
  });
  expect(await session.evaluate(learner => ({
    answers: learner.attempts.length, feedback: learner.feedback, country: learner.country?.properties.id,
  }))).toMatchObject({
    answers: 1, country: 'BRA', feedback: { correct: false, selectedCountryId: 'ARG' },
  });
  expect(await session.evaluate(async learner => {
    const modulePath = '/src/progress.ts';
    // Merge uses the same browser-realm schema as the restored session.
    const { mergeProgress, ProgressConflictError } = await import(modulePath) as typeof ProgressModule;
    const conflicting = learner.snapshot();
    conflicting.attempts[0].difficultyContext = 'silhouette';
    try {
      mergeProgress(learner.snapshot(), conflicting);
      return false;
    } catch (error) {
      return error instanceof ProgressConflictError;
    }
  })).toBe(true);
  await session.evaluate(learner => {
    learner.retry();
    learner.answerCountry('ARG');
    learner.replace(learner.snapshot());
    learner.retry();
    learner.answerCountry('BRA');
  });
  expect(await session.evaluate(learner => learner.proficiency)).toMatchObject({
    level: 'Learning', dueAt: '2026-09-07T12:10:00.000Z',
  });
  await page.clock.setFixedTime(new Date('2026-09-07T12:10:00Z'));
  expect(await session.evaluate(learner => {
    learner.next();
    return { country: learner.country?.properties.id, kind: learner.questionKind };
  })).toEqual({ country: 'BRA', kind: 'review' });
  await session.dispose();
});

test('a legacy active answer for an unsupported skill remains history while supported practice resumes', async ({ page }) => {
  await page.goto('/');
  expect(await page.evaluate(async () => {
    const modulePath = '/src/session.ts';
    // Load the public API in the same browser realm as the application.
    const { LearnerSession } = await import(modulePath) as typeof SessionModule;
    const original = new LearnerSession(null);
    original.start();
    original.answer(-52, -12);
    const legacy = original.snapshot();
    legacy.attempts[0].skill = 'historical-recognition-skill';
    const resumed = new LearnerSession(null, legacy);
    resumed.answer(-52, -12);
    return { history: resumed.attempts.map(attempt => attempt.skill), correct: resumed.feedback?.correct };
  })).toEqual({ history: ['historical-recognition-skill', 'name-to-location'], correct: true });
});
