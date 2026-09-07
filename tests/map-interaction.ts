import type { Page } from '@playwright/test';

// Select through the rendered world map, not an application back door.
// The initial desktop world view uses Web Mercator at zoom 2, centred on 15° N.
export async function selectWorldPoint(page: Page, longitude: number, latitude: number) {
  const box = (await page.getByRole('region', { name: 'World map' }).boundingBox())!;
  const mercatorY = (lat: number) => (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) * 512;
  const x = (longitude + 180) / 360 * 1024 - Math.round(512 - box.width / 2);
  const y = mercatorY(latitude) - Math.round(mercatorY(15) - box.height / 2);
  await page.mouse.click(box.x + x, box.y + y);
}

export async function answerWorldPoint(page: Page, longitude: number, latitude: number) {
  await selectWorldPoint(page, longitude, latitude);
  await page.getByRole('button', { name: 'Check location' }).click();
}
