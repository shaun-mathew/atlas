import { expect, test } from '@playwright/test';
import type * as SessionModule from '../src/session';

test.use({ reducedMotion: 'reduce' });

test('a guest identifies a silhouette without location clues and receives dated facts', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Custom practice', exact: true }).click();
  const setup = page.getByRole('dialog', { name: 'Custom practice setup' });
  await setup.getByRole('radio', { name: 'Countries & territories', exact: true }).check();
  await setup.getByRole('button', { name: 'Continue', exact: true }).click();
  await setup.getByRole('button', { name: 'Continue', exact: true }).click();
  await setup.getByRole('radio', { name: 'Shape recognition', exact: true }).check();
  await setup.getByRole('combobox', { name: 'Starting context', exact: true }).selectOption('silhouette');
  await setup.getByRole('button', { name: 'Start practice', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Country silhouette', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'World map', exact: true })).toBeHidden();
  await expect(page.getByRole('heading', { name: /Brazil/ })).toBeHidden();
  await expect(page.getByRole('region', { name: 'Country fact card' })).toBeHidden();
  await page.getByRole('combobox', { name: 'Country or territory', exact: true }).selectOption('BRA');
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

test('rich shape context shows neighboring names without naming the target before feedback', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Custom practice', exact: true }).click();
  const setup = page.getByRole('dialog', { name: 'Custom practice setup' });
  await setup.getByRole('button', { name: 'Continue', exact: true }).click();
  await setup.getByRole('button', { name: 'Continue', exact: true }).click();
  await setup.getByRole('radio', { name: 'Shape recognition', exact: true }).check();
  await setup.getByRole('button', { name: 'Start practice', exact: true }).click();
  const presentation = page.getByRole('region', { name: 'Shape question' });
  await expect(presentation.getByText('Argentina', { exact: true })).toBeVisible();
  await expect(presentation.getByText('Brazil', { exact: true })).toBeHidden();
  await page.getByRole('combobox', { name: 'Country or territory', exact: true }).selectOption('ARG');
  await page.getByRole('button', { name: 'Check answer', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Not quite');
  await expect(page.getByRole('status')).toContainText('Brazil');
  await expect(page.getByRole('region', { name: 'Country fact card' }).getByRole('heading', { name: 'Brazil', exact: true })).toBeVisible();
});

test('repeated shape misses simplify the recheck without letting an immediate retry postpone it', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-07T12:00:00Z'));
  await page.goto('/');
  const session = await page.evaluateHandle(async () => {
    const modulePath = '/src/session.ts';
    // Load in the browser realm so the public API uses Playwright's fixed clock.
    const { LearnerSession } = await import(modulePath) as typeof SessionModule;
    const learner = new LearnerSession(null);
    learner.choosePractice({
      scope: 'countries', continent: 'Worldwide', region: 'All regions',
      learning: 'shape-recognition', startingContext: 'silhouette',
    });
    learner.answerCountry('ARG');
    learner.retry();
    return learner;
  });
  await page.clock.setFixedTime(new Date('2026-09-07T12:09:00Z'));
  await session.evaluate(learner => { learner.answerCountry('ARG'); learner.retry(); });
  expect(await session.evaluate(learner => learner.difficultyContext)).toBe('reduced-context');
  expect(await session.evaluate(learner => learner.proficiency)).toMatchObject({
    level: 'Learning', dueAt: '2026-09-07T12:10:00.000Z',
  });
  await session.evaluate(learner => learner.answerCountry('BRA'));
  expect(await session.evaluate(learner => learner.proficiency)).toMatchObject({
    level: 'Learning', dueAt: '2026-09-07T12:10:00.000Z',
  });
  await page.clock.setFixedTime(new Date('2026-09-07T12:10:00Z'));
  expect(await session.evaluate(learner => {
    learner.next();
    return { country: learner.country?.properties.id, kind: learner.questionKind, context: learner.difficultyContext };
  })).toEqual({ country: 'BRA', kind: 'review', context: 'reduced-context' });
  await session.dispose();
});

test('scheduled shape successes reach all contexts while name-to-location keeps its own review', async ({ page }) => {
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
      learning: 'shape-recognition', startingContext: 'rich',
    });
    return learner;
  });
  expect(await session.evaluate(learner => learner.proficiency)).toBeUndefined();
  await session.evaluate(learner => learner.answerCountry('BRA'));
  for (const [date, context, nextDue] of [
    ['2026-09-08', 'unlabeled-local', '2026-09-11T12:00:00.000Z'],
    ['2026-09-11', 'reduced-context', '2026-09-18T12:00:00.000Z'],
    ['2026-09-18', 'silhouette', '2026-10-02T12:00:00.000Z'],
  ]) {
    await page.clock.setFixedTime(new Date(`${date}T12:00:00Z`));
    expect(await session.evaluate(learner => {
      learner.replace(learner.snapshot());
      learner.next();
      return { country: learner.country?.properties.id, kind: learner.questionKind, context: learner.difficultyContext };
    })).toEqual({ country: 'BRA', kind: 'review', context });
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
      learning: 'shape-recognition', startingContext: 'rich',
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
      learning: 'shape-recognition', startingContext: 'rich',
    });
    return learner.assisted;
  })).toBe(true);
  expect(await session.evaluate(learner => {
    learner.answerCountry('BRA');
    return { proficiency: learner.proficiency, nextContext: learner.nextDifficultyContext };
  })).toMatchObject({
    proficiency: { level: 'Learning', dueAt: '2026-09-07T12:10:00.000Z' }, nextContext: 'rich',
  });
  await session.dispose();
});

test('mobile keyboard answers keep focus through unlabeled and reduced-context feedback and retry', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Custom practice', exact: true }).click();
  const setup = page.getByRole('dialog', { name: 'Custom practice setup' });
  await setup.getByRole('button', { name: 'Continue', exact: true }).click();
  await setup.getByRole('button', { name: 'Continue', exact: true }).click();
  await setup.getByRole('radio', { name: 'Shape recognition', exact: true }).check();
  await setup.getByRole('combobox', { name: 'Starting context', exact: true }).selectOption('unlabeled-local');
  await setup.getByRole('button', { name: 'Start practice', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Country shape with unlabeled local', exact: true })).toBeVisible();
  const choice = page.getByRole('combobox', { name: 'Country or territory', exact: true });
  await choice.focus();
  await choice.selectOption('BRA');
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
  await setup.getByRole('combobox', { name: 'Starting context', exact: true }).selectOption('reduced-context');
  await setup.getByRole('button', { name: 'Start practice', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Country shape with reduced context', exact: true })).toBeVisible();
  await choice.focus();
  await choice.selectOption('NZL');
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
