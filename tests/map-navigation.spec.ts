import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

async function swipe(page: Page, x: number, y: number, dx: number, dy = 0) {
  const client = await page.context().newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let step = 1; step <= 10; step++) {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ x: x + dx * step / 10, y: y + dy * step / 10 }],
    });
  }
  // Release after a pause so this measures dragging, not inertial travel.
  await page.waitForTimeout(250);
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await client.detach();
}

async function selectedPoint(page: Page) {
  const text = await page.getByRole('status').textContent();
  const match = text!.match(/([\d.]+)° ([NS]) \/ ([\d.]+)° ([EW])/)!;
  return { latitude: Number(match[1]) * (match[2] === 'N' ? 1 : -1), longitude: Number(match[3]) * (match[4] === 'E' ? 1 : -1) };
}

test('mobile globe drags track the surface rather than accelerating at close zoom', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start country session' }).click();
  await page.getByRole('button', { name: 'Switch to 3D globe', exact: true }).click();
  const globe = page.getByRole('application', { name: 'Interactive globe' });
  const box = (await globe.boundingBox())!;
  const displacements: number[] = [];
  for (const zoomSteps of [0, 6]) {
    await page.getByRole('button', { name: 'World view', exact: true }).click();
    for (let step = 0; step < zoomSteps; step++) await globe.press('+');
    await page.waitForTimeout(1500);
    await swipe(page, box.x + box.width / 2, box.y + box.height / 2, 30);
    await page.waitForTimeout(450);
    if (!zoomSteps) await expect(page.getByRole('button', { name: 'Check location' })).toBeDisabled();
    await globe.press('Enter');
    const point = await selectedPoint(page);
    displacements.push(Math.abs(point.longitude));
    // Project the original centre back into view: it should move about as far as the finger.
    const longitude = point.longitude * Math.PI / 180;
    const latitude = point.latitude * Math.PI / 180;
    const distance = zoomSteps ? 1.15 : 3;
    const depth = distance - (Math.sin(latitude) ** 2 + Math.cos(latitude) ** 2 * Math.cos(longitude));
    const pixels = Math.abs(Math.cos(latitude) * Math.sin(longitude) * box.height / (2 * Math.tan(Math.PI / 8) * depth));
    expect(pixels).toBeGreaterThan(20);
    expect(pixels).toBeLessThan(40);
  }
  expect(displacements[1]).toBeLessThan(displacements[0] / 5);
});

test('mobile world map stays where dragged instead of snapping to world bounds', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start country session' }).click();
  await page.touchscreen.tap(195, 350);
  const before = await selectedPoint(page);
  await swipe(page, 100, 250, 120, 60);
  await page.waitForTimeout(400);
  await page.touchscreen.tap(195, 350);
  const after = await selectedPoint(page);
  // At zoom 1, one Mercator world is 512 pixels wide. Both axes must follow the drag.
  expect(before.longitude - after.longitude).toBeCloseTo(120 / 512 * 360, 0);
  const projectedY = (latitude: number) => Math.asinh(Math.tan(latitude * Math.PI / 180)) * 512 / (2 * Math.PI);
  expect(projectedY(after.latitude) - projectedY(before.latitude)).toBeCloseTo(60, 0);
});

test('globe selection dot keeps its screen size through zoom and resize', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start country session' }).click();
  await page.getByRole('button', { name: 'Switch to 3D globe', exact: true }).click();
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
    await page.setViewportSize(viewport);
    const globe = page.getByRole('application', { name: 'Interactive globe' });
    await globe.press('Enter');
    for (const keys of [['Enter'], Array<string>(6).fill('+'), Array<string>(8).fill('-')]) {
      for (const key of keys) await globe.press(key);
      await page.waitForTimeout(1500);
      const diameter = await globe.evaluate(element => {
        const canvas = element as HTMLCanvasElement;
        // Read pixels in the same task as selection redraws the settled view,
        // before WebGL clears its drawing buffer.
        canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        const copy = document.createElement('canvas');
        copy.width = canvas.width;
        copy.height = 1;
        const context = copy.getContext('2d')!;
        context.drawImage(canvas, 0, Math.floor(canvas.height / 2), canvas.width, 1, 0, 0, canvas.width, 1);
        const pixels = context.getImageData(0, 0, copy.width, 1).data;
        let width = 0;
        for (let x = 0; x < copy.width; x++) {
          const offset = x * 4;
          if (pixels[offset] > 190 && pixels[offset + 1] > 215 && pixels[offset + 2] < 170) width++;
        }
        return width * canvas.getBoundingClientRect().width / canvas.width;
      });
      expect(diameter).toBeGreaterThanOrEqual(11);
      expect(diameter).toBeLessThanOrEqual(16);
    }
  }
});

test('globe movement interpolates and selections use the currently visible view', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await page.getByRole('button', { name: 'Start country session' }).click();
  await page.getByRole('button', { name: 'Switch to 3D globe', exact: true }).click();
  const globe = page.getByRole('application', { name: 'Interactive globe' });
  await globe.press('ArrowRight');
  await page.clock.runFor(80);
  await globe.press('Enter');
  const intermediate = await selectedPoint(page);
  expect(intermediate.longitude).toBeGreaterThan(0);
  expect(intermediate.longitude).toBeLessThan(15);
  await page.clock.runFor(600);
  await globe.press('Enter');
  expect((await selectedPoint(page)).longitude).toBeCloseTo(15, 1);
  await globe.press('ArrowRight');
  await page.clock.runFor(80);
  await page.getByRole('button', { name: 'World view', exact: true }).click();
  await page.clock.runFor(600);
  await globe.press('Enter');
  expect((await selectedPoint(page)).longitude).toBeCloseTo(0, 1);
});

test('reduced motion keeps globe controls immediate without later drift', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install();
  await page.goto('/');
  await page.getByRole('button', { name: 'Start country session' }).click();
  await page.getByRole('button', { name: 'Switch to 3D globe', exact: true }).click();
  const globe = page.getByRole('application', { name: 'Interactive globe' });
  await globe.press('ArrowRight');
  await globe.press('Enter');
  expect((await selectedPoint(page)).longitude).toBeCloseTo(15, 1);
  await page.getByRole('button', { name: 'World view', exact: true }).click();
  await globe.press('Enter');
  expect((await selectedPoint(page)).longitude).toBeCloseTo(0, 1);
  await page.clock.runFor(600);
  await globe.press('Enter');
  expect((await selectedPoint(page)).longitude).toBeCloseTo(0, 1);
});

test('flat selection dots keep their size and anchor during wheel zoom', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start country session' }).click();
  // The equator/prime-meridian grid crossing in the initial mobile world view.
  const equatorY = 256 - Math.round((1 - Math.asinh(Math.tan(Math.PI / 12)) / Math.PI) * 256 - 844 / 2);
  await page.touchscreen.tap(195, equatorY);
  const pin = page.locator('#map .map-selection-pin');
  const before = (await pin.boundingBox())!;
  const center = { x: before.x + before.width / 2, y: before.y + before.height / 2 };
  await page.mouse.move(center.x, center.y);
  await page.mouse.wheel(0, -120);
  for (let frame = 0; frame < 6; frame++) {
    await page.waitForTimeout(40);
    const bounds = (await pin.boundingBox())!;
    expect(Math.abs(bounds.width - before.width)).toBeLessThan(1);
    expect(Math.abs(bounds.height - before.height)).toBeLessThan(1);
    expect(Math.hypot(bounds.x + bounds.width / 2 - center.x, bounds.y + bounds.height / 2 - center.y)).toBeLessThan(2);
  }
});

test('globe pin stays circular while moving off centre and disappears behind the earth', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start country session' }).click();
  await page.getByRole('button', { name: 'Switch to 3D globe', exact: true }).click();
  const globe = page.getByRole('application', { name: 'Interactive globe' });
  await globe.press('Enter');
  const frames = await globe.evaluate(async element => {
    const canvas = element as HTMLCanvasElement;
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    const context = copy.getContext('2d')!;
    const samples: { width: number; height: number }[] = [];
    for (let step = 0; step < 6; step++) canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    for (let frame = 0; frame < 70; frame++) {
      // Force the final sample to contain a freshly rendered frame, even if
      // rotation has settled and WebGL has already cleared its drawing buffer.
      if (frame === 69) canvas.dispatchEvent(new KeyboardEvent('keydown', { key: '+' }));
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      context.clearRect(0, 0, copy.width, copy.height);
      context.drawImage(canvas, 0, 0);
      const pixels = context.getImageData(0, 0, copy.width, copy.height).data;
      let left = copy.width, right = -1, top = copy.height, bottom = -1;
      for (let y = 0; y < copy.height; y++) {
        for (let x = 0; x < copy.width; x++) {
          const offset = (y * copy.width + x) * 4;
          if (pixels[offset] > 190 && pixels[offset + 1] > 215 && pixels[offset + 2] < 170 && pixels[offset + 3] > 200) {
            left = Math.min(left, x); right = Math.max(right, x);
            top = Math.min(top, y); bottom = Math.max(bottom, y);
          }
        }
      }
      const scale = canvas.getBoundingClientRect().width / canvas.width;
      samples.push({ width: right < 0 ? 0 : (right - left + 1) * scale, height: bottom < 0 ? 0 : (bottom - top + 1) * scale });
    }
    return samples;
  });
  const visible = frames.filter(frame => frame.width > 0);
  expect(visible.length).toBeGreaterThan(3);
  for (const frame of visible) {
    expect(frame.width).toBeGreaterThanOrEqual(11);
    expect(frame.width).toBeLessThanOrEqual(16);
    expect(Math.abs(frame.width - frame.height)).toBeLessThanOrEqual(2);
  }
  expect(frames.at(-1)!.width).toBe(0);
});
