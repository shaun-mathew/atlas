import { chromium, expect, test, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('a guest starts a country name-to-location session without an account', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start country session' }).click();
  await expect(page.getByRole('heading', { name: /Afghanistan/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'World map' })).toBeVisible();
});

// Select a geographic point through the rendered map, not an application back door.
// The initial world view uses the standard Web Mercator projection at zoom 2.
async function selectWorldPoint(page: Page, longitude: number, latitude: number) {
  const box = (await page.getByRole('region', { name: 'World map' }).boundingBox())!;
  const mercatorY = (lat: number) => (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) * 512;
  const x = (longitude + 180) / 360 * 1024 - Math.round(512 - box.width / 2);
  const y = mercatorY(latitude) - Math.round(mercatorY(15) - box.height / 2);
  await page.mouse.click(box.x + x, box.y + y);
}

async function answerWorldPoint(page: Page, longitude: number, latitude: number) {
  await selectWorldPoint(page, longitude, latitude);
  await page.getByRole('button', { name: 'Check location' }).click();
}

test('an answered country reveals sourced facts without assessing population', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start country session' }).click();
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
  await page.goto('/');
  await page.getByRole('button', { name: 'Start country session' }).click();
  await answerWorldPoint(page, 67, 34);
  await page.getByRole('button', { name: 'Next learning item' }).click();
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
  await expect(page.getByText('2 answered · 1 correct', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next learning item' }).click();
  await expect(card).toBeHidden();
  await expect(page.getByRole('heading', { name: /Albania/ })).toBeVisible();
});

test('a guest save from before fact cards retains its answer and gains dated facts', async ({ page }) => {
  await page.addInitScript(() => {
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
  await expect(page.getByRole('heading', { name: /Åland/ })).toBeVisible();
  await expect(card).toBeHidden();
});

test('a guest can revise a pin before checking and cannot count an answer twice', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start country session' }).click();
  await selectWorldPoint(page, 0, 0);
  await expect(page.getByText('0 answered · 0 correct', { exact: true })).toBeVisible();
  await selectWorldPoint(page, 67, 34);
  await expect(page.getByText('0 answered · 0 correct', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Check location' }).click();
  await expect(page.getByRole('status')).toContainText('Correct');
  await expect(page.getByText('1 answered · 1 correct', { exact: true })).toBeVisible();
  await selectWorldPoint(page, 0, 0);
  await expect(page.getByText('1 answered · 1 correct', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next learning item' }).click();
  await expect(page.getByRole('heading', { name: /Åland/ })).toBeVisible();
  await answerWorldPoint(page, 25, 62); // Finland, not Åland.
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
    await page.getByRole('button', { name: 'Start country session' }).click();
    await answerWorldPoint(page, 67, 34);
    await expect(page.getByRole('status')).toContainText('Correct');
    await context.close();
    context = await chromium.launchPersistentContext(profile, { viewport: { width: 1280, height: 900 } });
    page = await context.newPage();
    await page.goto('http://127.0.0.1:5173');
    await expect(page.getByRole('status')).toContainText('Correct');
    await expect(page.getByText('1 answered · 1 correct', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Next learning item' }).click();
    await expect(page.getByRole('heading', { name: /Åland/ })).toBeVisible();
    await context.close();
    context = await chromium.launchPersistentContext(profile, { viewport: { width: 1280, height: 900 } });
    page = await context.newPage();
    await page.goto('http://127.0.0.1:5173');
    await expect(page.getByRole('heading', { name: /Åland/ })).toBeVisible();
    await expect(page.getByText('1 answered · 1 correct', { exact: true })).toBeVisible();
    await answerWorldPoint(page, 25, 62);
    await expect(page.getByRole('status')).toContainText('Not quite');
    await expect(page.getByText('2 answered · 1 correct', { exact: true })).toBeVisible();
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test.describe('geographic tolerance', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Start country session' }).click();
    await answerWorldPoint(page, 67, 34);
    await page.getByRole('button', { name: 'Next learning item' }).click();
    await answerWorldPoint(page, 25, 62);
    await page.getByRole('button', { name: 'Next learning item' }).click();
    await expect(page.getByRole('heading', { name: /Albania/ })).toBeVisible();
  });

  test('accepts a point just offshore rather than requiring a polygon hit', async ({ page }) => {
    // At this world-view resolution this selects 19.336° E, 41.509° N,
    // in the Adriatic, just west of Albania's coast.
    await answerWorldPoint(page, 19.5, 41.3);
    await expect(page.getByRole('status')).toContainText('Correct');
    await expect(page.getByText('3 answered · 2 correct', { exact: true })).toBeVisible();
  });

  test('rejects a neighboring country even close to the target border', async ({ page }) => {
    await answerWorldPoint(page, 19.36, 42.37); // Montenegro, near the Albanian border.
    await expect(page.getByRole('status')).toContainText('Not quite');
    await expect(page.getByRole('status')).toContainText('Montenegro');
    await expect(page.getByText('3 answered · 1 correct', { exact: true })).toBeVisible();
  });

  test('rejects an ocean selection beyond the geographic tolerance', async ({ page }) => {
    await answerWorldPoint(page, 0, 0);
    await expect(page.getByRole('status')).toContainText('Not quite');
    await expect(page.getByText('3 answered · 1 correct', { exact: true })).toBeVisible();
  });
});

test('warns when progress cannot be saved while allowing guest practice', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException('Storage full', 'QuotaExceededError'); };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start country session' }).click();
  await expect(page.getByRole('alert')).toContainText('Progress is not saved');
  await answerWorldPoint(page, 67, 34);
  await expect(page.getByRole('status')).toContainText('Correct');
  await page.getByRole('button', { name: 'Next learning item' }).click();
  await expect(page.getByRole('heading', { name: /Åland/ })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Progress is not saved');
});
