import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-08T12:00:00Z'));
  await page.addInitScript(() => {
    if (localStorage.getItem('atlas-practice.guest') !== null) return;
    localStorage.setItem('unrelated.preference', 'keep-me');
    localStorage.setItem('atlas-practice.guest', JSON.stringify({
      version: 5, started: true, cursor: 2,
      current: { countryId: 'ALD', kind: 'new', assisted: true },
      attempts: ['BRA', 'CHN'].map(countryId => ({
        countryId, skill: 'name-to-location', kind: 'new',
        boundaryVersion: 'natural-earth-5.1.2-50m', factVersion: '2026-09-07',
        longitude: 0, latitude: 0, correct: false, assisted: false,
        selectedCountry: null, answeredAt: '2026-09-07T12:00:00.000Z',
      })),
    }));
  });
  await page.goto('/');
});

test('profile reset requires confirmation and clears learning without deleting unrelated storage', async ({ page }) => {
  const results = page.getByLabel('Practice results');
  await expect(results).toContainText('2 answered');
  await expect(page.getByRole('region', { name: 'Country close-up' })).toBeVisible();
  const saved = await page.evaluate(() => localStorage.getItem('atlas-practice.guest'));
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  const profile = page.getByRole('dialog', { name: 'Your profile' });
  await expect(profile.getByRole('heading', { name: 'Guest profile' })).toBeVisible();
  await expect(profile).toContainText('Not signed in');
  await profile.getByRole('button', { name: 'Reset learning progress', exact: true }).click();
  await expect(profile.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await profile.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem('atlas-practice.guest'))).toBe(saved);
  await profile.getByRole('button', { name: 'Reset learning progress', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(profile).toBeHidden();
  await expect(page.getByRole('region', { name: 'Country close-up' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('atlas-practice.guest'))).toBe(saved);

  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await expect(profile.getByRole('button', { name: 'Reset progress', exact: true })).toBeHidden();
  await profile.getByRole('button', { name: 'Reset learning progress', exact: true }).click();
  await profile.getByRole('button', { name: 'Reset progress', exact: true }).click();
  await expect(profile).toBeHidden();
  await expect(page.getByRole('button', { name: 'Start country session' })).toBeFocused();
  await expect(results).toContainText('0 answered');
  await expect(page.getByRole('region', { name: 'Country close-up' })).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('unrelated.preference'))).toBe('keep-me');
  await page.reload();
  await page.getByRole('button', { name: 'Start country session' }).click();
  await expect(page.getByRole('heading', { name: /Brazil/ })).toBeVisible();
  await expect(page.getByText('New learning item', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Name-to-location proficiency' })).toBeHidden();
  await expect(page.getByText(/Location help used/)).toBeHidden();
  // Answer through the world map; the old due Brazil/China reviews must be gone.
  const box = (await page.getByRole('region', { name: 'World map' }).boundingBox())!;
  const equatorY = 512 - Math.round((1 - Math.asinh(Math.tan(15 * Math.PI / 180)) / Math.PI) * 512 - box.height / 2);
  await page.mouse.click(box.x + box.width / 2, box.y + equatorY);
  await page.getByRole('button', { name: 'Check location' }).click();
  await page.getByRole('button', { name: 'Next learning item' }).click();
  await expect(page.getByRole('heading', { name: /China/ })).toBeVisible();
  await expect(page.getByText('New learning item', { exact: true })).toBeVisible();
});

test('failed reset preserves live and saved progress and reports the failure', async ({ page }) => {
  const saved = await page.evaluate(() => localStorage.getItem('atlas-practice.guest'));
  await page.evaluate(() => {
    Storage.prototype.setItem = () => { throw new DOMException('Storage unavailable', 'SecurityError'); };
  });
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  const profile = page.getByRole('dialog', { name: 'Your profile' });
  await profile.getByRole('button', { name: 'Reset learning progress', exact: true }).click();
  await profile.getByRole('button', { name: 'Reset progress', exact: true }).click();
  await expect(profile.getByRole('alert')).toContainText(/reset/i);
  expect(await page.evaluate(() => localStorage.getItem('atlas-practice.guest'))).toBe(saved);
  await profile.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByLabel('Practice results')).toContainText('2 answered');
  await expect(page.getByRole('region', { name: 'Country close-up' })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Practice results')).toContainText('2 answered');
  await expect(page.getByRole('heading', { name: /Åland/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Country close-up' })).toBeVisible();
});
