import { expect, test, type Page } from '@playwright/test';
import type * as GlobeModule from '../src/globe';
import type * as GeographyModule from '../src/geography';

test.describe.configure({ mode: 'serial' });

// Project a known geographic fixture into the rendered perspective view.
// No renderer internals or application selection hooks are used.
async function clickGlobePoint(page: Page, longitude: number, latitude: number, center = { longitude: 0, latitude: 15, distance: 3 }) {
  // Geographic fixtures are projected into the settled view, not mid-transition.
  await page.waitForTimeout(1500);
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
  // This persistence scenario freezes review dates; animation has separate coverage.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.setFixedTime(new Date('2026-09-07T12:00:00Z'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Start country session' }).click();
  const globeToggle = page.getByRole('group', { name: 'Map presentation' }).getByRole('button');
  await globeToggle.focus();
  await globeToggle.press('Enter');
  await expect(globeToggle).toBeFocused();
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
  await page.waitForTimeout(450);
  await globe.press('Enter');
  await expect(page.getByRole('status')).toContainText('15.0° S / 60.0° W');
  await page.getByRole('button', { name: 'Zoom in on globe' }).click();
  await globe.press('ArrowRight');
  await expect(page.getByRole('status')).toContainText('15.0° S / 60.0° W');
  await page.getByRole('button', { name: 'Switch to 2D map', exact: true }).click();
  await expect(globeToggle).toBeFocused();
  await expect(page.getByRole('region', { name: 'World map', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Brazil/ })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('15.0° S / 60.0° W');
  await page.getByRole('button', { name: 'Switch to 3D globe', exact: true }).click();
  await page.getByRole('button', { name: 'Check location' }).click();
  await expect(page.getByRole('status')).toContainText('Correct');
  const proficiency = page.getByRole('region', { name: 'Name-to-location proficiency' });
  await expect(proficiency).toContainText('Familiar');
  const dueAt = (await proficiency.locator('time').getAttribute('datetime'))!;
  await page.getByRole('button', { name: 'Switch to 2D map', exact: true }).click();
  await expect(page.getByText('1 answered · 1 correct', { exact: true })).toBeVisible();
  await page.reload();
  await expect(proficiency).toContainText('Familiar');
  await expect(proficiency.locator('time')).toHaveAttribute('datetime', dueAt);
  await page.clock.setFixedTime(new Date(dueAt));
  await page.getByRole('button', { name: 'Next learning item' }).click();
  await expect(page.getByRole('heading', { name: /Brazil/ })).toBeVisible();
  await expect(page.getByText('Scheduled review', { exact: true })).toBeVisible();
  await page.waitForTimeout(450);
  const map = (await page.getByRole('region', { name: 'World map', exact: true }).boundingBox())!;
  const mercatorY = (latitude: number) => (1 - Math.asinh(Math.tan(latitude * Math.PI / 180)) / Math.PI) * 512;
  await page.mouse.click(map.x + 128 / 360 * 1024 - Math.round(512 - map.width / 2), map.y + mercatorY(-12) - Math.round(mercatorY(15) - map.height / 2));
  await page.getByRole('button', { name: 'Check location' }).click();
  await expect(proficiency).toContainText('Retained');
  const retainedDueAt = (await proficiency.locator('time').getAttribute('datetime'))!;
  expect(Date.parse(retainedDueAt)).toBeGreaterThan(Date.parse(dueAt));
  await page.getByRole('button', { name: 'Switch to 3D globe', exact: true }).click();
  await expect(proficiency).toContainText('Retained');
  await expect(proficiency.locator('time')).toHaveAttribute('datetime', retainedDueAt);
  await expect(page.getByText('2 answered · 2 correct', { exact: true })).toBeVisible();
});

test('globe exploration never submits a drag or a click outside the earth', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start country session' }).click();
  await page.getByRole('button', { name: 'Switch to 3D globe', exact: true }).click();
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
    await page.getByRole('button', { name: 'Switch to 3D globe', exact: true }).click();
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
  await page.getByRole('button', { name: 'Switch to 3D globe', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('3D rendering unavailable');
  await expect(page.getByRole('region', { name: 'World map', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'World map', exact: true })).toBeFocused();
  await expect(page.getByRole('button', { name: '3D globe unavailable' })).toBeDisabled();
  await page.getByRole('button', { name: 'Check location' }).click();
  await expect(page.getByRole('status')).toContainText('Correct');
  await expect(page.getByText('1 answered · 1 correct', { exact: true })).toBeVisible();
});

test('lost WebGL preserves the globe pin and continues on the map', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start country session' }).click();
  await page.getByRole('button', { name: 'Switch to 3D globe', exact: true }).click();
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
  await page.getByRole('button', { name: 'Show location', exact: true }).click();
  await page.getByRole('button', { name: 'Switch to 3D globe', exact: true }).click();
  await clickGlobePoint(page, -52, -12);
  await page.getByRole('button', { name: 'Check location' }).click();
  await expect(page.getByRole('status')).toContainText('Correct — guided practice');
  await expect(page.getByRole('region', { name: 'Name-to-location proficiency' })).toContainText('Learning');
  await expect(page.getByLabel('Practice results')).toContainText('1 answered · 0 correct · 1 guided');
  await page.reload();
  await expect(page.getByRole('status')).toContainText('Correct — guided practice');
});

test('a polar globe selection is evaluated and survives a reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start country session' }).click();
  await page.getByRole('button', { name: 'Switch to 3D globe', exact: true }).click();
  const globe = page.getByRole('application', { name: 'Interactive globe' });
  await clickGlobePoint(page, -52, -12);
  for (let turn = 0; turn < 4; turn++) await globe.press('ArrowUp');
  await clickGlobePoint(page, 0, 89, { longitude: 0, latitude: 75, distance: 3 });
  await expect(page.getByRole('button', { name: 'Check location' })).toBeEnabled();
  await page.getByRole('button', { name: 'Check location' }).click();
  await expect(page.getByRole('status')).toContainText('Not quite');
  await page.reload();
  await expect(page.getByText('1 answered · 0 correct', { exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Not quite');
  await expect(page.getByRole('region', { name: 'Name-to-location proficiency' })).toContainText('Learning');
});

test('changing and clearing globe highlights matches freshly rendered geography', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const differences = await page.evaluate(async () => {
    const globeUrl = '/src/globe.ts';
    const geographyUrl = '/src/geography.ts';
    // Load browser-only modules through Vite; a static Node import cannot
    // provide the browser's DOM/WebGL constructors or resolve its asset imports.
    const { Globe }: typeof GlobeModule = await import(/* @vite-ignore */ globeUrl);
    const { countries }: typeof GeographyModule = await import(/* @vite-ignore */ geographyUrl);
    const create = () => {
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;inset:0;width:480px;height:360px';
      document.body.append(host);
      const globe = new Globe(host, () => {}, () => { throw new Error('WebGL unavailable'); });
      return { host, globe, canvas: host.querySelector('canvas')! };
    };
    const capture = (surface: { globe: GlobeModule.Globe; canvas: HTMLCanvasElement }) => {
      surface.globe.setSelection(null);
      const copy = document.createElement('canvas');
      copy.width = surface.canvas.width;
      copy.height = surface.canvas.height;
      const context = copy.getContext('2d')!;
      context.drawImage(surface.canvas, 0, 0);
      return context.getImageData(0, 0, copy.width, copy.height).data;
    };
    const updated = create();
    updated.globe.setVisible(true);
    const results: { country: string; view: number; maxDifference: number }[] = [];
    try {
      // Large neighbors, both sides of the longitude seam, and tiny islands.
      for (const id of ['BRA', 'CAN', 'USA', 'RUS', 'FJI', undefined]) {
        const country = countries.find(country => country.properties.id === id);
        const answer = { longitude: 0, latitude: 15, correct: true };
        updated.globe.showAnswer(country, answer);
        updated.globe.reset();
        const fresh = create();
        try {
          // Set the highlight before the first upload: this is a full rendering,
          // independent of the sequence of earlier highlights on the other globe.
          fresh.globe.showAnswer(country, answer);
          fresh.globe.setVisible(true);
          for (let view = 0; view < 3; view++) {
            const actual = capture(updated);
            const expected = capture(fresh);
            let maxDifference = 0;
            for (let channel = 0; channel < actual.length; channel++) {
              maxDifference = Math.max(maxDifference, Math.abs(actual[channel] - expected[channel]));
            }
            results.push({ country: id ?? 'clear', view, maxDifference });
            for (let turn = 0; turn < 8; turn++) {
              updated.canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
              fresh.canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
            }
          }
        } finally {
          fresh.globe.dispose();
          fresh.host.remove();
        }
      }
    } finally {
      updated.globe.dispose();
      updated.host.remove();
    }
    return results;
  });
  // Translated canvas paths can round antialiased edges by two channel levels.
  for (const result of differences) expect(result.maxDifference, `${result.country}, view ${result.view}`).toBeLessThanOrEqual(2);
});
