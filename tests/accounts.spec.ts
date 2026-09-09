import { expect, test } from '@playwright/test';
import { answerWorldPoint } from './map-interaction';

test.use({ reducedMotion: 'reduce' });

test('guest upgrades without email and resumes learning on another device', async ({ page, browser }) => {
  const username = `learner-${crypto.randomUUID().slice(0, 20)}`;
  await page.goto('/');
  await page.getByRole('button', { name: 'Start country session' }).click();
  await answerWorldPoint(page, -52, -12);
  await expect(page.getByLabel('Practice results')).toContainText('1 answered');
  const dueAt = await page.locator('#review-at').getAttribute('datetime');
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  const profile = page.getByRole('dialog', { name: 'Your profile' });
  await profile.getByLabel('Username', { exact: true }).fill(username);
  await profile.getByLabel('Password', { exact: true }).fill('a sufficiently long password');
  await profile.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(profile).toContainText(`Signed in as ${username}`);
  await expect(profile.getByRole('status')).toContainText('Progress synced');
  await profile.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByLabel('Practice results')).toContainText('1 answered');

  const device = await browser.newContext();
  try {
    const other = await device.newPage();
    await other.goto('/');
    await other.getByRole('button', { name: 'Profile', exact: true }).click();
    const otherProfile = other.getByRole('dialog', { name: 'Your profile' });
    await otherProfile.getByLabel('Username', { exact: true }).fill(username);
    await otherProfile.getByLabel('Password', { exact: true }).fill('a sufficiently long password');
    await otherProfile.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(otherProfile).toContainText(`Signed in as ${username}`);
    await otherProfile.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(other.getByLabel('Practice results')).toContainText('1 answered');
    await expect(other.locator('#review-at')).toHaveAttribute('datetime', dueAt!);
    await other.getByRole('button', { name: 'Next learning item' }).click();
    await expect(other.getByRole('heading', { name: /China/ })).toBeVisible();
    await other.reload();
    await expect(other.getByLabel('Practice results')).toContainText('1 answered');
    await expect(other.getByRole('heading', { name: /China/ })).toBeVisible();
  } finally {
    await device.close();
  }
});

test('attaching guest history preserves versioned proficiency and continues adaptive reviews', async ({ page, request, baseURL }) => {
  await page.clock.setFixedTime(new Date('2026-09-08T12:00:00Z'));
  const username = `merged-${crypto.randomUUID().slice(0, 20)}`;
  const first = {
    id: 'remote-brazil', countryId: 'BRA', skill: 'name-to-location', kind: 'new',
    boundaryVersion: 'natural-earth-5.1.2-50m', factVersion: '2026-09-07',
    longitude: -52, latitude: -12, correct: true, assisted: false,
    selectedCountry: 'Brazil', answeredAt: '2026-09-06T12:00:00.000Z',
  };
  const registered = await request.post('/api/register', {
    headers: { Origin: baseURL! },
    data: {
      username, password: 'a sufficiently long password',
      progress: { version: 6, started: true, current: null, cursor: 1, attempts: [first] },
    },
  });
  expect(registered.status()).toBe(201);
  await page.addInitScript(() => {
    if (localStorage.getItem('atlas-practice.guest')) return;
    const answer = {
      countryId: 'CHN', skill: 'name-to-location', kind: 'new',
      boundaryVersion: 'natural-earth-5.1.2-50m', factVersion: '2026-09-07',
      longitude: 105, latitude: 35, correct: true, assisted: false,
      selectedCountry: 'China', answeredAt: '2026-09-08T12:00:00.000Z',
    };
    localStorage.setItem('atlas-practice.guest', JSON.stringify({
      version: 6, started: true, cursor: 3,
      current: { countryId: 'CHN', kind: 'new', assisted: false },
      attempts: [
        { ...answer, id: 'old-fact', countryId: 'BRA', factVersion: 'old-facts', correct: false },
        { ...answer, id: 'other-skill', countryId: 'BRA', skill: 'location-to-name recognition', correct: false },
        { ...answer, id: 'retry', countryId: 'BRA', kind: 'retry', correct: false },
        { ...answer, id: 'guest-china' },
      ],
    }));
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  const profile = page.getByRole('dialog', { name: 'Your profile' });
  await profile.getByLabel('Username', { exact: true }).fill(username);
  await profile.getByLabel('Password', { exact: true }).fill('a sufficiently long password');
  await profile.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(profile).toContainText(`Signed in as ${username}`);
  await profile.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByLabel('Practice results')).toContainText('5 answered');
  await page.getByRole('button', { name: 'Next learning item' }).click();
  await expect(page.getByRole('heading', { name: /Brazil/ })).toBeVisible();
  await expect(page.getByText('Scheduled review', { exact: true })).toBeVisible();
  await expect(page.locator('#proficiency-level')).toHaveText('Familiar');
  await expect(page.locator('#review-at')).toHaveAttribute('datetime', '2026-09-07T12:00:00.000Z');
  await page.reload();
  await expect(page.getByLabel('Practice results')).toContainText('5 answered');
  await expect(page.locator('#review-at')).toHaveAttribute('datetime', '2026-09-07T12:00:00.000Z');
});

test('recognition guest attachment preserves selected identity and a legacy recall review for the same country', async ({ page, request, baseURL, browser }) => {
  await page.clock.setFixedTime(new Date('2026-09-08T12:00:00Z'));
  const username = `recognition-${crypto.randomUUID().slice(0, 16)}`;
  const registered = await request.post('/api/register', {
    headers: { Origin: baseURL! },
    data: {
      username, password: 'a sufficiently long password',
      progress: {
        version: 6, started: true, cursor: 1,
        current: { countryId: 'BRA', kind: 'review', assisted: false },
        attempts: [{
          id: 'legacy-recall', countryId: 'BRA', skill: 'name-to-location', kind: 'new',
          boundaryVersion: 'natural-earth-5.1.2-50m', factVersion: '2026-09-07',
          longitude: -52, latitude: -12, correct: true, assisted: false,
          selectedCountry: 'Brazil', answeredAt: '2026-09-06T12:00:00.000Z',
        }],
      },
    },
  });
  expect(registered.status()).toBe(201);
  await page.goto('/');
  await page.getByRole('button', { name: 'Custom practice', exact: true }).click();
  const setup = page.getByRole('dialog', { name: 'Custom practice setup' });
  await setup.getByRole('button', { name: '3 Learning' }).click();
  await setup.getByRole('radio', { name: 'Location-to-name recognition', exact: true }).check();
  await setup.getByRole('button', { name: 'Start practice', exact: true }).click();
  const search = page.getByRole('combobox', { name: 'Search countries & territories' });
  await search.fill('Argentina');
  await page.getByRole('option', { name: 'Argentina', exact: true }).click();
  await page.getByRole('button', { name: 'Check country' }).click();
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  const profile = page.getByRole('dialog', { name: 'Your profile' });
  await profile.getByLabel('Username', { exact: true }).fill(username);
  await profile.getByLabel('Password', { exact: true }).fill('a sufficiently long password');
  await profile.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(profile).toContainText(`Signed in as ${username}`);
  await profile.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('status')).toContainText('You selected Argentina');
  await expect(page.getByRole('region', { name: 'Country fact card' })).toContainText('Brazil');
  const recognition = page.getByRole('region', { name: 'Location-to-name recognition proficiency' });
  await expect(recognition).toContainText('Learning');
  await expect(recognition.locator('time')).toHaveAttribute('datetime', '2026-09-08T12:10:00.000Z');
  await page.getByRole('button', { name: 'Recommended practice', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Brazil/ })).toBeVisible();
  await expect(page.getByText('Scheduled review', { exact: true })).toBeVisible();
  const recall = page.getByRole('region', { name: 'Name-to-location proficiency' });
  await expect(recall.locator('time')).toHaveAttribute('datetime', '2026-09-07T12:00:00.000Z');
  await answerWorldPoint(page, -52, -12);
  await expect(recall).toContainText('Retained');
  await expect(recall.locator('time')).toHaveAttribute('datetime', '2026-09-11T12:00:00.000Z');
  await page.clock.setFixedTime(new Date('2026-09-08T12:10:00Z'));
  await page.getByRole('button', { name: 'Custom practice', exact: true }).click();
  await setup.getByRole('button', { name: '3 Learning' }).click();
  await setup.getByRole('radio', { name: 'Location-to-name recognition', exact: true }).check();
  await setup.getByRole('button', { name: 'Start practice', exact: true }).click();
  await search.fill('Brazil');
  await page.getByRole('option', { name: 'Brazil', exact: true }).click();
  await page.getByRole('button', { name: 'Check country' }).click();
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await expect(profile.getByRole('status')).toContainText('Progress synced');
  const device = await browser.newContext();
  try {
    const other = await device.newPage();
    await other.goto('/');
    await other.getByRole('button', { name: 'Profile', exact: true }).click();
    const otherProfile = other.getByRole('dialog', { name: 'Your profile' });
    await otherProfile.getByLabel('Username', { exact: true }).fill(username);
    await otherProfile.getByLabel('Password', { exact: true }).fill('a sufficiently long password');
    await otherProfile.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(otherProfile).toContainText(`Signed in as ${username}`);
    await otherProfile.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(other.getByRole('status')).toContainText('You selected Brazil');
    const resumed = other.getByRole('region', { name: 'Location-to-name recognition proficiency' });
    await expect(resumed).toContainText('Familiar');
    await expect(resumed.locator('time')).toHaveAttribute('datetime', '2026-09-09T12:10:00.000Z');
    await expect(other.getByLabel('Practice results')).toContainText('4 answered');
  } finally {
    await device.close();
  }
});

test('failed authentication keeps guest learning and offline account answers sync after reload', async ({ page, context }) => {
  const username = `offline-${crypto.randomUUID().slice(0, 20)}`;
  await page.goto('/');
  await page.getByRole('button', { name: 'Start country session' }).click();
  await answerWorldPoint(page, -52, -12);
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  const profile = page.getByRole('dialog', { name: 'Your profile' });
  await profile.getByLabel('Username', { exact: true }).fill(username);
  await profile.getByLabel('Password', { exact: true }).fill('a sufficiently long password');
  await profile.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(profile.getByRole('alert')).toBeVisible();
  await expect(profile.getByRole('heading', { name: 'Guest profile' })).toBeVisible();
  await expect(profile).toContainText('1 answers');
  await profile.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(profile).toContainText(`Signed in as ${username}`);
  await profile.getByRole('button', { name: 'Close', exact: true }).click();
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Next learning item' }).click();
  await answerWorldPoint(page, 105, 35);
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await expect(profile.getByRole('status')).toContainText('Sync failed');
  await context.setOffline(false);
  await page.reload();
  await expect(page.getByLabel('Practice results')).toContainText('2 answered');
  const saved = await context.request.get('/api/account');
  expect((await saved.json()).progress.attempts.map((attempt: { countryId: string }) => attempt.countryId)).toEqual(['BRA', 'CHN']);
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await profile.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(profile.getByRole('heading', { name: 'Guest profile' })).toBeVisible();
  await expect(page.getByLabel('Practice results')).toContainText('0 answered');
});

test('a remote reset cannot silently resurrect stale account answers', async ({ page, context }) => {
  const username = `reset-${crypto.randomUUID().slice(0, 20)}`;
  await page.goto('/');
  await page.getByRole('button', { name: 'Start country session' }).click();
  await answerWorldPoint(page, -52, -12);
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  const profile = page.getByRole('dialog', { name: 'Your profile' });
  await profile.getByLabel('Username', { exact: true }).fill(username);
  await profile.getByLabel('Password', { exact: true }).fill('a sufficiently long password');
  await profile.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(profile).toContainText(`Signed in as ${username}`);
  const resetTab = await context.newPage();
  await resetTab.goto('/');
  await resetTab.getByRole('button', { name: 'Profile', exact: true }).click();
  const resetProfile = resetTab.getByRole('dialog', { name: 'Your profile' });
  await resetProfile.getByRole('button', { name: 'Reset learning progress', exact: true }).click();
  await resetProfile.getByRole('button', { name: 'Reset progress', exact: true }).click();
  await expect(resetTab.getByLabel('Practice results')).toContainText('0 answered');
  await profile.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Next learning item' }).click();
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await expect(profile.getByRole('status')).toContainText('Local progress is kept');
  await expect(page.getByLabel('Practice results')).toContainText('1 answered');
  await page.reload();
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await expect(profile.getByRole('status')).toContainText('Local progress is kept');
  await profile.getByRole('button', { name: 'Discard local changes', exact: true }).click();
  await profile.getByRole('button', { name: 'Load account progress', exact: true }).click();
  await expect(profile.getByRole('status')).toContainText('Progress synced');
  await expect(page.getByLabel('Practice results')).toContainText('0 answered');
  await page.reload();
  await expect(page.getByLabel('Practice results')).toContainText('0 answered');
  expect((await (await context.request.get('/api/account')).json()).progress.attempts).toEqual([]);
});
