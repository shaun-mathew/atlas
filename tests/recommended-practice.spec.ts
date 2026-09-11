import { expect, test, type Page } from '@playwright/test';
import type * as SessionModule from '../src/session';
import type * as ProgressModule from '../src/progress';
import type * as GeographyModule from '../src/geography';

// Session modules load inside browser callbacks: static imports execute in Node,
// outside the application's clock-controlled realm and browser storage.
async function recallProgress(page: Page, count: number) {
  return page.evaluate(async count => {
    const progressPath = '/src/progress.ts';
    const geographyPath = '/src/geography.ts';
    const { initialProgress, boundaryVersion } = await import(progressPath) as typeof ProgressModule;
    const { introductionOrder } = await import(geographyPath) as typeof GeographyModule;
    const state = initialProgress();
    state.started = true;
    state.current = null;
    state.attempts = introductionOrder.slice(0, count).map((country, index) => ({
      id: `recall-${index.toString().padStart(3, '0')}`, countryId: country.properties.id,
      skill: 'name-to-location', kind: 'new', correct: true, assisted: false,
      boundaryVersion, factVersion: '2026-09-07', longitude: 0, latitude: 0,
      selectedCountry: country.properties.name, answeredAt: '2026-09-08T11:59:00.000Z',
    }));
    state.cursor = state.attempts.length;
    return state;
  }, count);
}

test('recognition introductions wait for forty familiar countries, not forty exposures', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-08T12:00:00Z'));
  await page.goto('/');
  const state = await recallProgress(page, 40);
  // Forty countries seen, but the last success was guided and is still Learning.
  state.attempts[39].assisted = true;
  const result = await page.evaluate(async state => {
    const sessionPath = '/src/session.ts';
    const { LearnerSession } = await import(sessionPath) as typeof SessionModule;
    const learner = new LearnerSession(null, state);
    const before = [];
    for (let index = 0; index < 3; index++) {
      before.push(learner.skill);
      learner.answer(0, 0);
      learner.next();
    }
    // Recover the fortieth country through an unassisted scheduled check.
    const recovered = learner.snapshot();
    recovered.current = { countryId: state.attempts[39].countryId, skill: 'name-to-location', kind: 'review', assisted: false };
    recovered.cursor = recovered.attempts.length;
    learner.replace(recovered);
    const geometry = learner.country!.geometry;
    const point = geometry.type === 'Polygon' ? geometry.coordinates[0][0] : geometry.coordinates[0][0][0];
    learner.answer(point[0], point[1]);
    const level = learner.proficiency?.level;
    learner.next();
    return { before, level, after: learner.skill };
  }, state);
  expect(result.before).toEqual(Array(3).fill('name-to-location'));
  expect(result.level).toBe('Familiar');
  expect(result.after).toBe('location-to-name-recognition');
});

test('forty familiar countries unlock interspersed recognition and silhouettes without a mode switch', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-08T12:00:00Z'));
  await page.goto('/');
  const state = await recallProgress(page, 40);
  await page.evaluate(state => localStorage.setItem('atlas-practice.guest', JSON.stringify(state)), state);
  await page.reload();
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
  await page.getByRole('button', { name: 'Next learning item' }).click();
  await expect(page.getByRole('button', { name: 'Check location' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Country silhouette' })).toBeHidden();
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
  await learner.evaluate(session => session.answer(105, 35));
  await page.clock.setFixedTime(new Date('2026-09-08T12:20:00Z'));
  const due = await learner.evaluate(session => {
    // Reload without an active prompt to exercise selection after the exposure window expires.
    const state = session.snapshot();
    state.current = null;
    state.cursor = state.attempts.length;
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

test('newly unlocked skills rotate with recall despite its larger lifetime attempt count', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-08T12:00:00Z'));
  await page.goto('/');
  const state = await recallProgress(page, 40);
  const sequence = await page.evaluate(async state => {
    const sessionPath = '/src/session.ts';
    const { LearnerSession } = await import(sessionPath) as typeof SessionModule;
    let learner = new LearnerSession(null, state);
    const sequence = [];
    for (let index = 0; index < 18; index++) {
      sequence.push({ skill: learner.skill, country: learner.country!.properties.id });
      if (learner.skill === 'name-to-location') {
        const geometry = learner.country!.geometry;
        const point = geometry.type === 'Polygon' ? geometry.coordinates[0][0] : geometry.coordinates[0][0][0];
        learner.answer(point[0], point[1]);
      } else {
        learner.answerCountry(learner.country!.properties.id);
      }
      // Rotation must survive replay, not depend on an in-memory counter.
      learner = new LearnerSession(null, learner.snapshot());
      learner.next();
    }
    return sequence;
  }, state);
  for (let index = 0; index < sequence.length; index += 3) {
    expect(new Set(sequence.slice(index, index + 3).map(question => question.skill)))
      .toEqual(new Set(['name-to-location', 'location-to-name-recognition', 'shape-recognition']));
  }
  for (let index = 0; index < sequence.length; index++) {
    expect(sequence.slice(Math.max(0, index - 2), index).map(question => question.country))
      .not.toContain(sequence[index].country);
  }
});

test('a review backlog is interspersed with other types while retaining per-skill review priority', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-08T12:00:00Z'));
  await page.goto('/');
  const state = await recallProgress(page, 40);
  for (const attempt of state.attempts) attempt.answeredAt = '2026-09-06T12:00:00.000Z';
  state.attempts.push(...state.attempts.slice(0, 6).map((attempt, index) => ({
    ...attempt, id: `shape-${index}`, skill: 'shape-recognition', correct: false,
    answeredAt: `2026-09-08T11:4${index}:00.000Z`,
    longitude: undefined, latitude: undefined, selectedCountryId: 'ARG', selectedCountry: 'Argentina',
  })));
  state.cursor = state.attempts.length;
  const sequence = await page.evaluate(async state => {
    const sessionPath = '/src/session.ts';
    const { LearnerSession } = await import(sessionPath) as typeof SessionModule;
    const learner = new LearnerSession(null, state);
    const sequence = [];
    for (let index = 0; index < 12; index++) {
      sequence.push({ skill: learner.skill, kind: learner.questionKind });
      if (learner.skill === 'name-to-location') {
        const geometry = learner.country!.geometry;
        const point = geometry.type === 'Polygon' ? geometry.coordinates[0][0] : geometry.coordinates[0][0][0];
        learner.answer(point[0], point[1]);
      } else {
        learner.answerCountry(learner.country!.properties.id);
      }
      learner.next();
    }
    return sequence;
  }, state);
  for (let index = 0; index < sequence.length; index += 3) {
    expect(sequence.slice(index, index + 3).map(question => question.skill))
      .toEqual(['name-to-location', 'location-to-name-recognition', 'shape-recognition']);
  }
  expect(sequence.filter(question => question.skill !== 'location-to-name-recognition').map(question => question.kind))
    .toEqual(Array(8).fill('review'));
});
