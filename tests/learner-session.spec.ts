import { chromium, expect, test, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import countryData from '../src/data/countries.json' with { type: 'json' };
import { answerWorldPoint, selectWorldPoint } from './map-interaction';

// These learning tests freeze Date.now(); Leaflet's wall-clock transitions
// cannot advance. Real movement is exercised in map-navigation.spec.ts.
test.use({ reducedMotion: 'reduce' });

async function seedQuestion(page: Page, countryId: string) {
  await page.addInitScript(id => {
    if (localStorage.getItem('atlas-practice.guest') !== null) return;
    localStorage.setItem('atlas-practice.guest', JSON.stringify({
      version: 5, started: true, cursor: 0, attempts: [],
      current: { countryId: id, kind: 'new', assisted: false },
    }));
  }, countryId);
}

test('an older save with an unsupported active skill keeps its history and resumes supported practice', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('atlas-practice.guest', JSON.stringify({
      version: 6, started: true, cursor: 0,
      current: { countryId: 'BRA', kind: 'new', assisted: false },
      attempts: [{
        id: 'future-skill-answer', countryId: 'BRA', skill: 'future-skill', kind: 'new',
        boundaryVersion: 'natural-earth-5.1.2-50m', factVersion: '2026-09-07',
        longitude: -52, latitude: -12, correct: true, assisted: false,
        selectedCountry: 'Brazil', answeredAt: '2026-09-07T12:00:00.000Z',
      }],
    }));
  });
  await page.goto('/');
  await expect(page.getByLabel('Practice results')).toContainText('1 answered');
  await expect(page.getByRole('heading', { name: /Brazil/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Name-to-location proficiency' })).toBeHidden();
  await answerWorldPoint(page, -52, -12);
  await expect(page.getByLabel('Practice results')).toContainText('2 answered');
  await expect(page.getByRole('status')).toContainText('Correct');
});

test('a guest starts a country name-to-location session without an account', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start country session' }).click();
  await expect(page.getByRole('heading', { name: /Brazil/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'World map' })).toBeVisible();
});
test('a completed legacy diagnostic resumes continuous practice with its learning history', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-08T12:00:00Z'));
  await page.addInitScript(() => {
    if (localStorage.getItem('atlas-practice.guest') !== null) return;
    const ids = ['AFG', 'ALD', 'ALB', 'DZA', 'ASM', 'AND', 'AGO', 'AIA'];
    localStorage.setItem('atlas-practice.guest', JSON.stringify({
      version: 3, started: true, cursor: 8, current: null,
      mode: 'diagnostic', diagnostic: { countries: ids, index: 8 }, newItemsThisSession: 0,
      attempts: ids.map(countryId => ({
        countryId, skill: 'name-to-location', kind: 'diagnostic',
        boundaryVersion: 'natural-earth-5.1.2-50m',
        longitude: 0, latitude: 0, correct: false, assisted: false,
        selectedCountry: null, answeredAt: '2026-09-08T12:00:00.000Z',
      })),
    }));
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Afghanistan/ })).toBeVisible();
  await expect(page.getByText('Practice revisit', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Practice results')).toContainText('8 answered');
  await page.reload();
  await answerWorldPoint(page, 67, 34);
  const proficiency = page.getByRole('region', { name: 'Name-to-location proficiency' });
  await expect(proficiency).toContainText('Learning');
  await expect(proficiency.locator('time')).toHaveAttribute('datetime', '2026-09-08T12:10:00.000Z');
  await page.getByRole('button', { name: 'Next learning item' }).click();
  await expect(page.getByRole('heading', { name: /Brazil/ })).toBeVisible();
  await expect(page.getByText('New learning item', { exact: true })).toBeVisible();
});
test('adaptive practice prioritizes a due review before a new country', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-08T12:00:00Z'));
  await page.addInitScript(() => {
    if (localStorage.getItem('atlas-practice.guest') !== null) return;
    localStorage.setItem('atlas-practice.guest', JSON.stringify({
      version: 2, started: true, cursor: 2, current: null,
      attempts: [
        {
          countryId: 'AFG', skill: 'name-to-location', kind: 'new',
          boundaryVersion: 'natural-earth-5.1.2-50m', longitude: 67, latitude: 34,
          correct: true, selectedCountry: 'Afghanistan', answeredAt: '2026-09-06T12:00:00.000Z',
        },
        {
          countryId: 'ALD', skill: 'name-to-location', kind: 'new',
          boundaryVersion: 'natural-earth-5.1.2-50m', longitude: 25, latitude: 62,
          correct: true, selectedCountry: 'Åland', answeredAt: '2026-09-07T12:00:00.000Z',
        },
      ],
    }));
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Afghanistan/ })).toBeVisible();
  await expect(page.getByText('Scheduled review', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: /Afghanistan/ })).toBeVisible();
  await expect(page.getByText('2 answered · 2 correct', { exact: true })).toBeVisible();
  await answerWorldPoint(page, 67, 34);
  await page.getByRole('button', { name: 'Next learning item' }).click();
  await expect(page.getByRole('heading', { name: /Åland/ })).toBeVisible();
  await expect(page.getByText('Scheduled review', { exact: true })).toBeVisible();
});

test('adaptive practice keeps mixing new countries with spaced revisits across retries and reloads', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-08T12:00:00Z'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Start country session' }).click();
  await answerWorldPoint(page, -52, -12);
  await page.getByRole('button', { name: 'Next learning item' }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: /China/ })).toBeVisible();
  await expect(page.getByText('New learning item', { exact: true })).toBeVisible();
  for (const country of ['China', 'Australia']) {
    await expect(page.getByRole('heading', { name: new RegExp(country) })).toBeVisible();
    await answerWorldPoint(page, 0, 0);
    await page.getByRole('button', { name: 'Next learning item' }).click();
  }
  // Neither weaker country has two intervening answers yet, so revisit the
  // older successful country rather than immediately repeating a revealed one.
  await expect(page.getByRole('heading', { name: /Brazil/ })).toBeVisible();
  await expect(page.getByText('Practice revisit', { exact: true })).toBeVisible();
  await answerWorldPoint(page, 0, 0);
  await page.getByRole('button', { name: 'Retry now' }).click();
  await answerWorldPoint(page, -52, -12);
  await page.reload();
  await expect(page.getByText('Immediate retry', { exact: true })).toBeVisible();
  await expect(page.getByText('5 answered · 2 correct', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next learning item' }).click();
  for (const country of ['India', 'United States']) {
    await expect(page.getByRole('heading', { name: new RegExp(country) })).toBeVisible();
    await expect(page.getByText('New learning item', { exact: true })).toBeVisible();
    await answerWorldPoint(page, 0, 0);
    await page.getByRole('button', { name: 'Next learning item' }).click();
  }
  await page.reload();
  await expect(page.getByRole('heading', { name: /China/ })).toBeVisible();
  await expect(page.getByText('Practice revisit', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check location' })).toBeVisible();
  await expect(page.getByText('7 answered · 2 correct', { exact: true })).toBeVisible();
  await answerWorldPoint(page, 0, 0);
  await page.getByRole('button', { name: 'Next learning item' }).click();
  for (const country of ['Canada', 'Russia']) {
    await expect(page.getByRole('heading', { name: new RegExp(country) })).toBeVisible();
    await expect(page.getByText('New learning item', { exact: true })).toBeVisible();
    await answerWorldPoint(page, 0, 0);
    await page.getByRole('button', { name: 'Next learning item' }).click();
  }
  await expect(page.getByRole('heading', { name: /Australia/ })).toBeVisible();
  await expect(page.getByText('Practice revisit', { exact: true })).toBeVisible();
});

test('new introductions begin with recognizable major countries across regions', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-08T12:00:00Z'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Start country session' }).click();
  const majorCountries = [
    'Brazil', 'China', 'Australia', 'India', 'United States', 'Canada', 'Russia', 'Mexico',
    'Argentina', 'South Africa', 'Egypt', 'Saudi Arabia', 'Indonesia', 'France', 'Japan', 'United Kingdom',
  ];
  for (const country of majorCountries) {
    if (await page.getByText('Practice revisit', { exact: true }).isVisible()) {
      await answerWorldPoint(page, 0, 0);
      await page.getByRole('button', { name: 'Next learning item' }).click();
    }
    await expect(page.getByText('New learning item', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: new RegExp(country) })).toBeVisible();
    await answerWorldPoint(page, 0, 0);
    await page.getByRole('button', { name: 'Next learning item' }).click();
  }
});

test('later introductions progress from larger island landmasses to small islands', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-08T12:00:00Z'));
  await page.addInitScript(data => {
    if (localStorage.getItem('atlas-practice.guest') !== null) return;
    const remaining: Record<string, true> = { GRL: true, MDG: true, ISL: true, JAM: true, FJI: true, ALD: true };
    const attempts = data.features.filter(country => !remaining[country.properties.id]).map(country => ({
      countryId: country.properties.id, skill: 'name-to-location', kind: 'new',
      boundaryVersion: 'natural-earth-5.1.2-50m',
      longitude: 0, latitude: 0, correct: true, assisted: false,
      selectedCountry: country.properties.name, answeredAt: '2026-09-08T12:00:00.000Z',
    }));
    // A just-completed revisit leaves the next slot open for an introduction.
    attempts.push({ ...attempts[attempts.length - 1], kind: 'practice' });
    localStorage.setItem('atlas-practice.guest', JSON.stringify({
      version: 5, started: true, cursor: attempts.length, current: null, attempts,
    }));
  }, countryData);
  await page.goto('/');
  // Fiji's combined islands exceed Jamaica's area, but its largest island
  // is smaller: difficulty follows the selectable landmass, not country totals.
  for (const country of ['Greenland', 'Madagascar', 'Iceland', 'Jamaica', 'Fiji', 'Åland']) {
    if (await page.getByText('Practice revisit', { exact: true }).isVisible()) {
      await answerWorldPoint(page, 0, 0);
      await page.getByRole('button', { name: 'Next learning item' }).click();
    }
    await expect(page.getByText('New learning item', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: new RegExp(country) })).toBeVisible();
    await answerWorldPoint(page, 0, 0);
    await page.getByRole('button', { name: 'Next learning item' }).click();
  }
});

test('a legacy alphabetical save preserves its pending territory before using the new curriculum', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-08T12:00:00Z'));
  await page.addInitScript(() => {
    if (localStorage.getItem('atlas-practice.guest') !== null) return;
    localStorage.setItem('atlas-practice.guest', JSON.stringify({
      version: 1, started: true, cursor: 1,
      attempts: [{
        countryId: 'AFG', skill: 'name-to-location',
        boundaryVersion: 'natural-earth-5.1.2-50m',
        longitude: 67, latitude: 34, correct: true,
        selectedCountry: 'Afghanistan', answeredAt: '2026-09-08T12:00:00.000Z',
      }],
    }));
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Åland/ })).toBeVisible();
  await expect(page.getByText('1 answered · 1 correct', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: /Åland/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check location' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Country fact card' })).toBeHidden();
  await answerWorldPoint(page, 0, 0);
  await page.getByRole('button', { name: 'Next learning item' }).click();
  await expect(page.getByRole('heading', { name: /Brazil/ })).toBeVisible();
  await expect(page.getByText('New learning item', { exact: true })).toBeVisible();
  await expect(page.getByText('2 answered · 1 correct', { exact: true })).toBeVisible();
});

test('a pending legacy diagnostic becomes ordinary practice without losing answers', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-08T12:00:00Z'));
  await page.addInitScript(() => {
    if (localStorage.getItem('atlas-practice.guest') !== null) return;
    localStorage.setItem('atlas-practice.guest', JSON.stringify({
      version: 4, started: true, cursor: 2,
      current: { countryId: 'ALB', kind: 'diagnostic', assisted: false },
      mode: 'diagnostic',
      diagnostic: { countries: ['AFG', 'ALD', 'ALB', 'DZA', 'ASM', 'AND', 'AGO', 'AIA'], index: 2 },
      attempts: ['AFG', 'ALD'].map(countryId => ({
        countryId, skill: 'name-to-location', kind: 'diagnostic',
        boundaryVersion: 'natural-earth-5.1.2-50m',
        longitude: 0, latitude: 0, correct: false, assisted: false,
        selectedCountry: null, answeredAt: '2026-09-08T12:00:00.000Z',
      })),
    }));
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Albania/ })).toBeVisible();
  await expect(page.getByText('New learning item', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: /Albania/ })).toBeVisible();
  await answerWorldPoint(page, 19.5, 41.3);
  await page.reload();
  await expect(page.getByRole('status')).toContainText('Correct');
  await expect(page.getByRole('region', { name: 'Name-to-location proficiency' }).locator('time'))
    .toHaveAttribute('datetime', '2026-09-09T12:00:00.000Z');
  await page.getByRole('button', { name: 'Next learning item' }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: /Afghanistan/ })).toBeVisible();
  await expect(page.getByText('Practice revisit', { exact: true })).toBeVisible();
  await expect(page.getByText('3 answered · 1 correct', { exact: true })).toBeVisible();
});

test('a v3 adaptive save resumes an eligible weak revisit and preserves its history', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-08T12:00:00Z'));
  await page.addInitScript(() => {
    if (localStorage.getItem('atlas-practice.guest') !== null) return;
    localStorage.setItem('atlas-practice.guest', JSON.stringify({
      version: 3, started: true, cursor: 5, current: null,
      mode: 'adaptive', diagnostic: null, newItemsThisSession: 3,
      attempts: [
        { countryId: 'AFG', kind: 'new', correct: true },
        { countryId: 'ALD', kind: 'new', correct: false },
        { countryId: 'ALD', kind: 'retry', correct: true },
        { countryId: 'ALB', kind: 'new', correct: false },
        { countryId: 'ALB', kind: 'retry', correct: true },
      ].map(attempt => ({
        ...attempt, skill: 'name-to-location',
        boundaryVersion: 'natural-earth-5.1.2-50m', factVersion: '2026-09-07',
        longitude: 0, latitude: 0, assisted: false,
        selectedCountry: null, answeredAt: '2026-09-08T12:00:00.000Z',
      })),
    }));
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Åland/ })).toBeVisible();
  await expect(page.getByText('Practice revisit', { exact: true })).toBeVisible();
  await expect(page.getByText('5 answered · 3 correct', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: /Åland/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check location' })).toBeVisible();
  await answerWorldPoint(page, 0, 0);
  await page.reload();
  await expect(page.getByRole('status')).toContainText('Not quite');
  await expect(page.getByText('6 answered · 3 correct', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Country fact card' })).toContainText('Swedish');
  await expect(page.getByRole('region', { name: 'Name-to-location proficiency' }).locator('time'))
    .toHaveAttribute('datetime', '2026-09-08T12:10:00.000Z');
  await page.getByRole('button', { name: 'Next learning item' }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: /Brazil/ })).toBeVisible();
  await expect(page.getByText('New learning item', { exact: true })).toBeVisible();
  await expect(page.getByText('6 answered · 3 correct', { exact: true })).toBeVisible();
});


test('an answered country reveals sourced facts without assessing population', async ({ page }) => {
  await seedQuestion(page, 'AFG');
  await page.goto('/');
  const card = page.getByRole('region', { name: 'Country fact card' });
  await expect(card).toBeHidden();
  await answerWorldPoint(page, 67, 34);
  await expect(card.getByRole('heading', { name: 'Afghanistan', exact: true })).toBeVisible();
  await expect(card).toContainText('Dari');
  await expect(card).toContainText('Pashto');
  await expect(card).toContainText('49,474,805 (reference year 2025)');
  await expect(card).toContainText(/Population direction\s*increasing.*2025/);
  await expect(card).toContainText('Informational · not scored');
  await card.getByText('Sources and fact version', { exact: true }).click();
  await expect(card.getByRole('link').first()).toHaveAttribute('href', /^https:\/\//);
  await expect(card).toContainText('Retrieved 2026-09-07');
  await expect(page.getByText('1 answered · 1 correct', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next learning item' }).click();
  await expect(card).toBeHidden();
});

test('an incorrect territory answer teaches the target facts and restores them on reload', async ({ page }) => {
  await seedQuestion(page, 'ALD');
  await page.goto('/');
  await answerWorldPoint(page, 25, 62); // Finland, not Åland.
  const card = page.getByRole('region', { name: 'Country fact card' });
  await expect(page.getByRole('status')).toContainText('Not quite');
  await expect(card.getByRole('heading', { name: 'Åland', exact: true })).toBeVisible();
  await expect(card).toContainText(/Autonomous region of Finland/);
  await expect(card).toContainText('Swedish');
  await expect(card).toContainText('30,836 (reference year 2025)');
  await expect(card).toContainText(/Population direction\s*increasing.*2024–2025/);
  const presentedFacts = await card.textContent();
  await page.reload();
  await expect(card).toHaveText(presentedFacts!);
  await expect(page.getByText('1 answered · 0 correct', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next learning item' }).click();
  await expect(card).toBeHidden();
  await expect(page.getByText('New learning item', { exact: true })).toBeVisible();
});

test('a guest save from before fact cards retains its answer and gains dated facts', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-06T12:01:00Z'));
  await page.addInitScript(() => {
    if (localStorage.getItem('atlas-practice.guest') !== null) return;
    localStorage.setItem('atlas-practice.guest', JSON.stringify({
      version: 1, started: true, cursor: 0,
      attempts: [{
        countryId: 'AFG', skill: 'name-to-location',
        boundaryVersion: 'natural-earth-5.1.2-50m',
        longitude: 67, latitude: 34, correct: true,
        selectedCountry: 'Afghanistan', answeredAt: '2026-09-06T12:00:00.000Z',
      }],
    }));
  });
  await page.goto('/');
  await expect(page.getByRole('status')).toContainText('Correct');
  const card = page.getByRole('region', { name: 'Country fact card' });
  await expect(card.getByRole('heading', { name: 'Afghanistan', exact: true })).toBeVisible();
  await expect(card).toContainText('49,474,805 (reference year 2025)');
  await expect(page.getByText('1 answered · 1 correct', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next learning item' }).click();
  await expect(page.getByRole('heading', { name: /Brazil/ })).toBeVisible();
  await expect(card).toBeHidden();
});

test('a guest can revise a pin before checking and cannot count an answer twice', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start country session' }).click();
  await selectWorldPoint(page, 0, 0);
  await expect(page.getByText('0 answered · 0 correct', { exact: true })).toBeVisible();
  await selectWorldPoint(page, -52, -12);
  await expect(page.getByText('0 answered · 0 correct', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Check location' }).click();
  await expect(page.getByRole('status')).toContainText('Correct');
  await expect(page.getByText('1 answered · 1 correct', { exact: true })).toBeVisible();
  await selectWorldPoint(page, 0, 0);
  await expect(page.getByText('1 answered · 1 correct', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next learning item' }).click();
  await expect(page.getByRole('heading', { name: /China/ })).toBeVisible();
  await answerWorldPoint(page, 25, 62); // Finland, not China.
  await expect(page.getByRole('status')).toContainText('Not quite');
  await expect(page.getByRole('status')).toContainText('Finland');
  await expect(page.getByText('2 answered · 1 correct', { exact: true })).toBeVisible();
});

test('guest answers and the next learning item survive a browser restart', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'atlas-guest-'));
  let context = await chromium.launchPersistentContext(profile, { viewport: { width: 1280, height: 900 } });
  try {
    let page = await context.newPage();
    await page.goto('http://127.0.0.1:5173');
    await page.clock.setFixedTime(new Date('2026-09-07T12:00:00Z'));
    await page.getByRole('button', { name: 'Start country session' }).click();
    await answerWorldPoint(page, -52, -12);
    await expect(page.getByRole('status')).toContainText('Correct');
    await context.close();
    context = await chromium.launchPersistentContext(profile, { viewport: { width: 1280, height: 900 } });
    page = await context.newPage();
    await page.goto('http://127.0.0.1:5173');
    await page.clock.setFixedTime(new Date('2026-09-07T12:00:00Z'));
    await expect(page.getByRole('status')).toContainText('Correct');
    await expect(page.getByText('1 answered · 1 correct', { exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Name-to-location proficiency' })).toContainText('Familiar');
    await expect(page.getByRole('region', { name: 'Name-to-location proficiency' }).locator('time'))
      .toHaveAttribute('datetime', '2026-09-08T12:00:00.000Z');
    await page.getByRole('button', { name: 'Next learning item' }).click();
    await expect(page.getByRole('heading', { name: /China/ })).toBeVisible();
    await context.close();
    context = await chromium.launchPersistentContext(profile, { viewport: { width: 1280, height: 900 } });
    page = await context.newPage();
    await page.goto('http://127.0.0.1:5173');
    await page.clock.setFixedTime(new Date('2026-09-07T12:00:00Z'));
    await expect(page.getByRole('heading', { name: /China/ })).toBeVisible();
    await expect(page.getByText('1 answered · 1 correct', { exact: true })).toBeVisible();
    await answerWorldPoint(page, 25, 62);
    await expect(page.getByRole('status')).toContainText('Not quite');
    await expect(page.getByText('2 answered · 1 correct', { exact: true })).toBeVisible();
    await page.clock.setFixedTime(new Date('2026-09-08T12:00:00Z'));
    await page.getByRole('button', { name: 'Next learning item' }).click();
    await expect(page.getByRole('heading', { name: /China/ })).toBeVisible();
    await expect(page.getByText('Scheduled review', { exact: true })).toBeVisible();
    await answerWorldPoint(page, 25, 62);
    await page.getByRole('button', { name: 'Next learning item' }).click();
    await expect(page.getByRole('heading', { name: /Brazil/ })).toBeVisible();
    await answerWorldPoint(page, 0, 0);
    const proficiency = page.getByRole('region', { name: 'Name-to-location proficiency' });
    await expect(proficiency).toContainText('Learning');
    await expect(proficiency.locator('time')).toHaveAttribute('datetime', '2026-09-08T12:10:00.000Z');
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test.describe('geographic tolerance', () => {
  test.beforeEach(async ({ page }) => {
    await seedQuestion(page, 'ALB');
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Albania/ })).toBeVisible();
  });

  test('accepts a point just offshore rather than requiring a polygon hit', async ({ page }) => {
    // At this world-view resolution this selects 19.336° E, 41.509° N,
    // in the Adriatic, just west of Albania's coast.
    await answerWorldPoint(page, 19.5, 41.3);
    await expect(page.getByRole('status')).toContainText('Correct');
    await expect(page.getByText('1 answered · 1 correct', { exact: true })).toBeVisible();
  });

  test('rejects a neighboring country even close to the target border', async ({ page }) => {
    await answerWorldPoint(page, 19.36, 42.37); // Montenegro, near the Albanian border.
    await expect(page.getByRole('status')).toContainText('Not quite');
    await expect(page.getByRole('status')).toContainText('Montenegro');
    await expect(page.getByText('1 answered · 0 correct', { exact: true })).toBeVisible();
  });

  test('rejects an ocean selection beyond the geographic tolerance', async ({ page }) => {
    await answerWorldPoint(page, 0, 0);
    await expect(page.getByRole('status')).toContainText('Not quite');
    await expect(page.getByText('1 answered · 0 correct', { exact: true })).toBeVisible();
  });
});

test('warns when progress cannot be saved while allowing guest practice', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException('Storage full', 'QuotaExceededError'); };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start country session' }).click();
  await expect(page.getByRole('alert')).toContainText('Progress is not saved');
  await answerWorldPoint(page, -52, -12);
  await expect(page.getByRole('status')).toContainText('Correct');
  await page.getByRole('button', { name: 'Next learning item' }).click();
  await expect(page.getByRole('heading', { name: /China/ })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Progress is not saved');
});

test('name-to-location success schedules a later review and retained success extends it', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-07T12:00:00Z'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Start country session' }).click();
  await answerWorldPoint(page, -52, -12);
  const proficiency = page.getByRole('region', { name: 'Name-to-location proficiency' });
  await expect(proficiency).toContainText('Familiar');
  await expect(proficiency.locator('time')).toHaveAttribute('datetime', '2026-09-08T12:00:00.000Z');
  await page.getByRole('button', { name: 'Next learning item' }).click();
  await expect(page.getByRole('heading', { name: /China/ })).toBeVisible();
  await answerWorldPoint(page, 25, 62);
  await page.clock.setFixedTime(new Date('2026-09-08T12:00:00Z'));
  await page.getByRole('button', { name: 'Next learning item' }).click();
  // China's missed answer is due before Brazil's successful introduction.
  await expect(page.getByRole('heading', { name: /China/ })).toBeVisible();
  await expect(page.getByText('Scheduled review', { exact: true })).toBeVisible();
  await answerWorldPoint(page, 25, 62);
  await page.getByRole('button', { name: 'Next learning item' }).click();
  await expect(page.getByRole('heading', { name: /Brazil/ })).toBeVisible();
  await expect(page.getByText('Scheduled review', { exact: true })).toBeVisible();
  await answerWorldPoint(page, -52, -12);
  await expect(proficiency).toContainText('Retained');
  await expect(proficiency.locator('time')).toHaveAttribute('datetime', '2026-09-11T12:00:00.000Z');
  // Exploring a revealed answer must not downgrade earned retention.
  await page.getByRole('button', { name: 'Explore location' }).click();
  await expect(page.getByRole('region', { name: 'Country close-up' })).toBeVisible();
  await expect(page.getByText(/Location help used/)).toBeHidden();
  await page.reload();
  await expect(proficiency).toContainText('Retained');
  await expect(proficiency.locator('time')).toHaveAttribute('datetime', '2026-09-11T12:00:00.000Z');
});

test('immediate retry does not defer a missed item or count as retained knowledge', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-07T12:00:00Z'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Start country session' }).click();
  await answerWorldPoint(page, 0, 0);
  const proficiency = page.getByRole('region', { name: 'Name-to-location proficiency' });
  await expect(proficiency).toContainText('Learning');
  await expect(proficiency.locator('time')).toHaveAttribute('datetime', '2026-09-07T12:10:00.000Z');
  await page.clock.setFixedTime(new Date('2026-09-07T12:09:59Z'));
  await page.getByRole('button', { name: 'Retry now' }).click();
  await expect(page.getByText('Immediate retry', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Country fact card' })).toBeHidden();
  await page.reload();
  await expect(page.getByText('Immediate retry', { exact: true })).toBeVisible();
  await answerWorldPoint(page, -52, -12);
  await expect(page.getByRole('status')).toContainText('Correct');
  await expect(proficiency).toContainText('Learning');
  await expect(proficiency.locator('time')).toHaveAttribute('datetime', '2026-09-07T12:10:00.000Z');
  await page.reload();
  await expect(proficiency).toContainText('Learning');
  await expect(proficiency.locator('time')).toHaveAttribute('datetime', '2026-09-07T12:10:00.000Z');
  await page.getByRole('button', { name: 'Next learning item' }).click();
  await expect(page.getByRole('heading', { name: /China/ })).toBeVisible();
  await answerWorldPoint(page, 25, 62);
  await page.clock.setFixedTime(new Date('2026-09-07T12:10:00Z'));
  await page.getByRole('button', { name: 'Next learning item' }).click();
  await expect(page.getByRole('heading', { name: /Brazil/ })).toBeVisible();
  await expect(page.getByText('Scheduled review', { exact: true })).toBeVisible();
  await answerWorldPoint(page, -52, -12);
  await expect(proficiency).toContainText('Familiar');
  await expect(proficiency.locator('time')).toHaveAttribute('datetime', '2026-09-08T12:10:00.000Z');
});

test('a fully introduced catalogue keeps practicing weak countries without changing retention', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-07T12:00:00Z'));
  await page.addInitScript(data => {
    if (localStorage.getItem('atlas-practice.guest') !== null) return;
    localStorage.setItem('atlas-practice.guest', JSON.stringify({
      version: 1, started: true, cursor: data.features.length - 1,
      attempts: data.features.map(country => ({
        countryId: country.properties.id, skill: 'name-to-location',
        boundaryVersion: 'natural-earth-5.1.2-50m',
        longitude: 0, latitude: 0, correct: true,
        selectedCountry: country.properties.name, answeredAt: '2026-09-07T12:00:00.000Z',
      })),
    }));
  }, countryData);
  await page.goto('/');
  await page.getByRole('button', { name: 'Next learning item' }).click();
  await expect(page.getByRole('heading', { name: /Afghanistan/ })).toBeVisible();
  await expect(page.getByText('Practice revisit', { exact: true })).toBeVisible();
  const proficiency = page.getByRole('region', { name: 'Name-to-location proficiency' });
  await answerWorldPoint(page, 0, 0);
  await page.reload();
  await expect(page.getByRole('status')).toContainText('Not quite');
  await expect(proficiency).toContainText('Familiar');
  await expect(proficiency.locator('time')).toHaveAttribute('datetime', '2026-09-08T12:00:00.000Z');
  await page.getByRole('button', { name: 'Retry now' }).click();
  await answerWorldPoint(page, 67, 34);
  await expect(proficiency).toContainText('Familiar');
  await expect(proficiency.locator('time')).toHaveAttribute('datetime', '2026-09-08T12:00:00.000Z');
  await page.getByRole('button', { name: 'Next learning item' }).click();
  await expect(page.getByRole('heading', { name: /Åland/ })).toBeVisible();
  await answerWorldPoint(page, 0, 0);
  await page.getByRole('button', { name: 'Next learning item' }).click();
  await expect(page.getByRole('heading', { name: /Albania/ })).toBeVisible();
  await answerWorldPoint(page, 19.5, 41.3);
  await page.getByRole('button', { name: 'Next learning item' }).click();
  // The retry did not remove Afghanistan's weakness. It becomes eligible
  // again after two intervening answers and outranks older strong countries.
  await expect(page.getByRole('heading', { name: /Afghanistan/ })).toBeVisible();
  await expect(page.getByText('Practice revisit', { exact: true })).toBeVisible();
  await answerWorldPoint(page, 67, 34);
  await page.reload();
  await expect(page.getByRole('status')).toContainText('Correct');
  await expect(proficiency).toContainText('Familiar');
  await expect(proficiency.locator('time')).toHaveAttribute('datetime', '2026-09-08T12:00:00.000Z');
  await expect(page.getByText(`${countryData.features.length + 5} answered · ${countryData.features.length + 3} correct`, { exact: true }))
    .toBeVisible();
  await page.getByRole('button', { name: 'Next learning item' }).click();
  await expect(page.getByRole('heading', { name: /Åland/ })).toBeVisible();
  await answerWorldPoint(page, 0, 0);
  await page.getByRole('button', { name: 'Next learning item' }).click();
  await expect(page.getByRole('heading', { name: /Algeria/ })).toBeVisible();
  await page.getByRole('button', { name: 'Show location' }).click();
  await page.getByRole('button', { name: 'Back to world map' }).click();
  await answerWorldPoint(page, 3, 28);
  await expect(page.getByRole('status')).toContainText('Correct');
  await page.reload();
  await expect(page.getByText(/Location help used/)).toBeVisible();
  await expect(proficiency).toContainText('Familiar');
  await expect(proficiency.locator('time')).toHaveAttribute('datetime', '2026-09-08T12:00:00.000Z');
  await page.getByRole('button', { name: 'Next learning item' }).click();
  await expect(page.getByRole('heading', { name: /American Samoa/ })).toBeVisible();
  await answerWorldPoint(page, 0, 0);
  await page.getByRole('button', { name: 'Next learning item' }).click();
  // Successful unassisted practice removed Afghanistan's weakness: Åland
  // now wins even though Afghanistan was seen less recently and is eligible.
  await expect(page.getByRole('heading', { name: /Åland/ })).toBeVisible();
  await expect(page.getByText('Practice revisit', { exact: true })).toBeVisible();
  await answerWorldPoint(page, 0, 0);
  await page.clock.setFixedTime(new Date('2026-09-08T12:00:00Z'));
  await page.getByRole('button', { name: 'Next learning item' }).click();
  await expect(page.getByRole('heading', { name: /Afghanistan/ })).toBeVisible();
  await expect(page.getByText('Scheduled review', { exact: true })).toBeVisible();
  await answerWorldPoint(page, 67, 34);
  await expect(proficiency).toContainText('Retained');
  await expect(proficiency.locator('time')).toHaveAttribute('datetime', '2026-09-11T12:00:00.000Z');
});

test('linked-map help survives reload and schedules an unassisted check instead of retention credit', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-07T12:00:00Z'));
  await seedQuestion(page, 'ALD');
  await page.goto('/');
  await page.getByRole('button', { name: 'Show location' }).click();
  const overview = page.getByRole('region', { name: 'Regional overview' });
  const detail = page.getByRole('region', { name: 'Country close-up' });
  await expect(overview).toBeVisible();
  await expect(detail).toBeVisible();
  await overview.click();
  await expect(page.getByRole('button', { name: 'Check location' })).toBeDisabled();
  await page.getByRole('button', { name: 'Back to the country' }).click();
  await expect(page.getByText(/Location help used/)).toBeVisible();
  await page.getByRole('button', { name: 'Back to world map' }).click();
  await expect(detail).toBeHidden();
  await expect(page.getByText(/Location help used/)).toBeVisible();
  await page.reload();
  await expect(detail).toBeVisible();
  await expect(page.getByText(/Location help used/)).toBeVisible();
  await detail.click();
  await page.getByRole('button', { name: 'Check location' }).click();
  await expect(page.getByRole('status')).toContainText('Correct');
  const proficiency = page.getByRole('region', { name: 'Name-to-location proficiency' });
  await expect(proficiency).toContainText('Learning');
  await expect(proficiency.locator('time')).toHaveAttribute('datetime', '2026-09-07T12:10:00.000Z');
  await expect(page.getByRole('region', { name: 'Country fact card' })).toContainText('Åland');
  await expect(page.getByLabel('Practice results')).toContainText('1 answered · 0 correct · 1 guided');
  await page.reload();
  await expect(page.getByRole('status')).toContainText('Correct');
  await expect(proficiency).toContainText('Learning');
  await expect(proficiency.locator('time')).toHaveAttribute('datetime', '2026-09-07T12:10:00.000Z');
  await page.getByRole('button', { name: 'Next learning item' }).click();
  await expect(detail).toBeHidden();
  await expect(page.getByText('New learning item', { exact: true })).toBeVisible();
  await answerWorldPoint(page, -52, -12);
  await page.clock.setFixedTime(new Date('2026-09-07T12:10:00Z'));
  await page.getByRole('button', { name: 'Next learning item' }).click();
  await expect(page.getByRole('heading', { name: /Åland/ })).toBeVisible();
  await expect(page.getByText('Scheduled review', { exact: true })).toBeVisible();
  await expect(detail).toBeHidden();
  await expect(page.getByText(/Location help used/)).toBeHidden();
});

test('help on a scheduled review replaces familiarity with an unassisted check', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-08T12:00:00Z'));
  // An existing v2 save has neither question nor attempt assistance flags.
  await page.addInitScript(() => {
    if (localStorage.getItem('atlas-practice.guest') !== null) return;
    localStorage.setItem('atlas-practice.guest', JSON.stringify({
      version: 2, started: true, cursor: 1,
      current: { countryId: 'AFG', kind: 'review' },
      attempts: [{
        countryId: 'AFG', skill: 'name-to-location', kind: 'new',
        boundaryVersion: 'natural-earth-5.1.2-50m',
        longitude: 67, latitude: 34, correct: true,
        selectedCountry: 'Afghanistan', answeredAt: '2026-09-07T12:00:00.000Z',
      }],
    }));
  });
  await page.goto('/');
  const proficiency = page.getByRole('region', { name: 'Name-to-location proficiency' });
  await expect(page.getByText('Scheduled review', { exact: true })).toBeVisible();
  await expect(proficiency).toContainText('Familiar');
  await page.getByRole('button', { name: 'Show location' }).click();
  await page.getByRole('button', { name: 'Back to world map' }).click();
  await answerWorldPoint(page, 67, 34);
  await expect(page.getByRole('status')).toContainText('Correct');
  await expect(proficiency).toContainText('Learning');
  await expect(proficiency.locator('time')).toHaveAttribute('datetime', '2026-09-08T12:10:00.000Z');
  await page.reload();
  await expect(proficiency).toContainText('Learning');
  await expect(proficiency.locator('time')).toHaveAttribute('datetime', '2026-09-08T12:10:00.000Z');
});

test('retrying a guided mistake preserves assistance without delaying the unassisted check', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-07T12:00:00Z'));
  await seedQuestion(page, 'AFG');
  await page.goto('/');
  await page.getByRole('button', { name: 'Show location' }).click();
  await page.getByRole('button', { name: 'Back to world map' }).click();
  await answerWorldPoint(page, 0, 0);
  await expect(page.getByRole('status')).toContainText('Not quite');
  const proficiency = page.getByRole('region', { name: 'Name-to-location proficiency' });
  await expect(proficiency).toContainText('Learning');
  await expect(proficiency.locator('time')).toHaveAttribute('datetime', '2026-09-07T12:10:00.000Z');
  await page.clock.setFixedTime(new Date('2026-09-07T12:09:59Z'));
  await page.getByRole('button', { name: 'Retry now' }).click();
  await expect(page.getByText(/Location help used/)).toBeVisible();
  await page.reload();
  await expect(page.getByRole('region', { name: 'Country close-up' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to world map' }).click();
  await answerWorldPoint(page, 67, 34);
  await expect(page.getByRole('status')).toContainText('Correct');
  await page.reload();
  await expect(page.getByText(/Location help used/)).toBeVisible();
  await expect(proficiency).toContainText('Learning');
  await expect(proficiency.locator('time')).toHaveAttribute('datetime', '2026-09-07T12:10:00.000Z');
});

test('linked maps retain regional context and answer controls on short screens', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 550 });
  await seedQuestion(page, 'AFG');
  await page.goto('/');
  await page.getByRole('button', { name: 'Show location' }).click();
  await expect(page.getByRole('region', { name: 'Regional overview' }).getByText('India', { exact: true })).toBeVisible();
  await page.getByRole('region', { name: 'Country close-up' }).click();
  await page.getByRole('button', { name: 'Check location' }).click();
  await expect(page.getByRole('status')).toContainText('Correct');
  await page.getByRole('button', { name: 'Next learning item' }).click();
  await expect(page.getByText('New learning item', { exact: true })).toBeVisible();
});
