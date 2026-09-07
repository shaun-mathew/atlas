import { expect, test, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

// Project a known geographic fixture into the rendered perspective view.
// No renderer internals or application selection hooks are used.
async function clickGlobePoint(page: Page, longitude: number, latitude: number, center = { longitude: 0, latitude: 15, distance: 3 }) {
  const box = (await page.getByRole('application', { name: 'Interactive globe' }).boundingBox())!;
  const radians = Math.PI / 180;
  const delta = (longitude - center.longitude) * radians;
  const lat = latitude * radians;
  const tilt = center.latitude * radians;
  const x = Math.cos(lat) * Math.sin(delta);
  const y = Math.sin(lat) * Math.cos(tilt) - Math.cos(lat) * Math.cos(delta) * Math.sin(tilt);
  const depth = center.distance - (Math.sin(lat) * Math.sin(tilt) + Math.cos(lat) * Math.cos(delta) * Math.cos(tilt));
  const scale = box.height / (2 * Math.tan(22.5 * radians));
  await page.mouse.click(box.x + box.width / 2 + x * scale / depth, box.y + box.height / 2 - y * scale / depth);
}
test('rotating and zooming the globe preserves a country answer across presentations', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-07T12:00:00Z'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Start country session' }).click();
  await page.getByRole('button', { name: '3D globe', exact: true }).click();
  const globe = page.getByRole('application', { name: 'Interactive globe' });
  await expect(globe).toBeVisible();
  await globe.focus();
  // Move the view from 0° E, 15° N to central Brazil, then select its centre.
  await globe.press('ArrowLeft');
  await globe.press('ArrowLeft');
  await globe.press('ArrowLeft');
  await globe.press('ArrowLeft');
  await globe.press('ArrowDown');
  await globe.press('ArrowDown');
  await globe.press('Enter');
  await expect(page.getByRole('status')).toContainText('15.0° S / 60.0° W');
  await page.getByRole('button', { name: 'Zoom in on globe' }).click();
  await globe.press('ArrowRight');
  await expect(page.getByRole('status')).toContainText('15.0° S / 60.0° W');
  await page.getByRole('button', { name: '2D map', exact: true }).click();
  await expect(page.getByRole('region', { name: 'World map', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Brazil/ })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('15.0° S / 60.0° W');
  await page.getByRole('button', { name: '3D globe', exact: true }).click();
  await page.getByRole('button', { name: 'Check location' }).click();
  await expect(page.getByRole('status')).toContainText('Correct');
  const proficiency = page.getByRole('region', { name: 'Name-to-location proficiency' });
  await expect(proficiency).toContainText('Familiar');
  await expect(proficiency.locator('time')).toHaveAttribute('datetime', '2026-09-08T12:00:00.000Z');
  await page.getByRole('button', { name: '2D map', exact: true }).click();
  await expect(page.getByText('1 answered · 1 correct', { exact: true })).toBeVisible();
  await page.reload();
  await expect(proficiency).toContainText('Familiar');
  await expect(proficiency.locator('time')).toHaveAttribute('datetime', '2026-09-08T12:00:00.000Z');
  await page.clock.setFixedTime(new Date('2026-09-08T12:00:00Z'));
  await page.getByRole('button', { name: 'Next learning item' }).click();
  await expect(page.getByRole('heading', { name: /Brazil/ })).toBeVisible();
  await expect(page.getByText('Scheduled review', { exact: true })).toBeVisible();
  const map = (await page.getByRole('region', { name: 'World map', exact: true }).boundingBox())!;
  const mercatorY = (latitude: number) => (1 - Math.asinh(Math.tan(latitude * Math.PI / 180)) / Math.PI) * 512;
  await page.mouse.click(map.x + 128 / 360 * 1024 - Math.round(512 - map.width / 2), map.y + mercatorY(-12) - Math.round(mercatorY(15) - map.height / 2));
  await page.getByRole('button', { name: 'Check location' }).click();
  await expect(proficiency).toContainText('Retained');
  await expect(proficiency.locator('time')).toHaveAttribute('datetime', '2026-09-11T12:00:00.000Z');
  await page.getByRole('button', { name: '3D globe', exact: true }).click();
  await expect(proficiency).toContainText('Retained');
  await expect(page.getByText('2 answered · 2 correct', { exact: true })).toBeVisible();
});

test('globe exploration never submits a drag or a click outside the earth', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start country session' }).click();
  await page.getByRole('button', { name: '3D globe', exact: true }).click();
  const globe = page.getByRole('application', { name: 'Interactive globe' });
  const box = (await globe.boundingBox())!;
  await page.mouse.click(box.x + 5, box.y + 5);
  await expect(page.getByRole('button', { name: 'Check location' })).toBeDisabled();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 150, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByRole('button', { name: 'Check location' })).toBeDisabled();
  await page.getByRole('button', { name: 'World view', exact: true }).click();
  await clickGlobePoint(page, -52, -12);
  await expect(page.getByRole('status')).toContainText('12.0° S / 52.0° W');
  await page.getByRole('button', { name: 'Check location' }).click();
  await expect(page.getByRole('status')).toContainText('Correct');
});

test.describe('globe geographic tolerance', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('atlas-practice.guest', JSON.stringify({
      version: 5, started: true, cursor: 0, attempts: [],
      current: { countryId: 'ALB', kind: 'new', assisted: false },
    })));
    await page.goto('/');
    await page.getByRole('button', { name: '3D globe', exact: true }).click();
    const globe = page.getByRole('application', { name: 'Interactive globe' });
    await globe.press('ArrowRight');
    await globe.press('ArrowUp');
    await globe.press('ArrowUp');
    await page.getByRole('button', { name: 'Zoom in on globe' }).click();
  });

  test('accepts an offshore point within 25 km', async ({ page }) => {
    await clickGlobePoint(page, 19.25, 41.4, { longitude: 15, latitude: 45, distance: 2.4 });
    await page.getByRole('button', { name: 'Check location' }).click();
    await expect(page.getByRole('status')).toContainText('Correct');
  });

  test('rejects a point in a neighboring country', async ({ page }) => {
    await clickGlobePoint(page, 19.36, 42.37, { longitude: 15, latitude: 45, distance: 2.4 });
    await page.getByRole('button', { name: 'Check location' }).click();
    await expect(page.getByRole('status')).toContainText('Not quite');
    await expect(page.getByRole('status')).toContainText('Montenegro');
  });

  test('rejects an offshore point beyond 25 km', async ({ page }) => {
    await clickGlobePoint(page, 16, 41, { longitude: 15, latitude: 45, distance: 2.4 });
    await page.getByRole('button', { name: 'Check location' }).click();
    await expect(page.getByRole('status')).toContainText('Not quite');
  });
});

test('unavailable WebGL leaves the pending map answer usable', async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...args: unknown[]) {
      if (type === 'webgl2' || type === 'webgl') return null;
      return Reflect.apply(getContext, this, [type, ...args]);
    } as typeof getContext;
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start country session' }).click();
  const box = (await page.getByRole('region', { name: 'World map', exact: true }).boundingBox())!;
  // Brazil at the standard Mercator world view.
  const mercatorY = (latitude: number) => (1 - Math.asinh(Math.tan(latitude * Math.PI / 180)) / Math.PI) * 512;
  await page.mouse.click(box.x + 128 / 360 * 1024 - Math.round(512 - box.width / 2), box.y + mercatorY(-12) - Math.round(mercatorY(15) - box.height / 2));
  await page.getByRole('button', { name: '3D globe', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('3D rendering unavailable');
  await expect(page.getByRole('region', { name: 'World map', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Check location' }).click();
  await expect(page.getByRole('status')).toContainText('Correct');
  await expect(page.getByText('1 answered · 1 correct', { exact: true })).toBeVisible();
});

test('lost WebGL preserves the globe pin and continues on the map', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start country session' }).click();
  await page.getByRole('button', { name: '3D globe', exact: true }).click();
  await clickGlobePoint(page, -52, -12);
  await page.getByRole('application', { name: 'Interactive globe' }).evaluate(element => {
    const context = (element as HTMLCanvasElement).getContext('webgl2')!;
    const extension = context.getExtension('WEBGL_lose_context');
    if (!extension) throw new Error('Browser does not support WebGL context-loss simulation');
    extension.loseContext();
  });
  await expect(page.getByRole('alert')).toContainText('3D rendering unavailable');
  await expect(page.getByRole('region', { name: 'World map', exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('12.0° S / 52.0° W');
  await page.getByRole('button', { name: 'Check location' }).click();
  await expect(page.getByRole('status')).toContainText('Correct');
  await page.getByRole('button', { name: 'Next learning item' }).click();
  await expect(page.getByRole('heading', { name: /China/ })).toBeVisible();
});

test('switching away from location help cannot earn unassisted globe credit', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start country session' }).click();
  await page.getByRole('button', { name: 'Show linked maps', exact: true }).click();
  await page.getByRole('button', { name: '3D globe', exact: true }).click();
  await clickGlobePoint(page, -52, -12);
  await page.getByRole('button', { name: 'Check location' }).click();
  await expect(page.getByRole('status')).toContainText('Correct — guided practice');
  await expect(page.getByRole('region', { name: 'Name-to-location proficiency' })).toContainText('Learning');
  await expect(page.getByLabel('Practice results')).toContainText('1 answered · 0 correct · 1 guided');
  await page.reload();
  await expect(page.getByRole('status')).toContainText('Correct — guided practice');
});
