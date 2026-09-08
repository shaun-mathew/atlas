import { expect, test, type Page } from '@playwright/test';
import type * as Leaflet from 'leaflet';

async function landDuringZoom(page: Page, mode: 'zoom-out' | 'flight' | 'arrival') {
  await page.goto('/');
  await page.locator('#map .leaflet-overlay-pane path').first().waitFor({ state: 'attached' });
  return page.evaluate(async mode => {
    const url = performance.getEntriesByType('resource').map(entry => entry.name).find(name => name.includes('/deps/leaflet.js'))!;
    // Vite chooses this URL at runtime; a Node-side static import is not the browser's Leaflet instance.
    const L: typeof Leaflet = (await import(/* @vite-ignore */ url)).default;
    // Capture the existing application map without adding a production debug API.
    let captured: Leaflet.Map | undefined;
    const polylines = L.Polyline.prototype as Leaflet.Polyline & { _simplifyPoints(): void };
    const simplify = polylines._simplifyPoints;
    polylines._simplifyPoints = function (this: { _map: Leaflet.Map }) {
      if (this._map.getContainer().id === 'map') captured = this._map;
      return simplify.call(this);
    };
    try {
      document.querySelector<HTMLButtonElement>('#zoom-in')!.click();
      await new Promise(resolve => setTimeout(resolve, 600));
    } finally {
      polylines._simplifyPoints = simplify;
    }
    if (!captured) throw new Error('The world map did not render.');
    const map = captured;
    const arrival = mode === 'arrival';
    const target: Leaflet.LatLngTuple = arrival ? [43.751, 7.4075] : [9, 40];
    map.setView(arrival ? [0, 0] : [20, 80], arrival ? 10 : 6, { animate: false });
    let country: Leaflet.Polyline | undefined;
    map.eachLayer(layer => {
      if (layer instanceof L.Polyline && layer.feature?.properties?.id === (arrival ? 'MCO' : 'ETH')) country = layer;
    });
    const initialPath = country?.getElement();
    if (!(initialPath instanceof SVGPathElement)) throw new Error('The country has no rendered boundary.');
    let path = initialPath;
    // A native marker supplies the geographic point's animated screen position.
    // This remains valid whether the renderer transforms or reprojects its paths.
    const reference = L.marker(target, {
      icon: L.divIcon({ className: 'render-reference', iconSize: [0, 0], iconAnchor: [0, 0] }),
      interactive: false,
    }).addTo(map);
    await new Promise(resolve => setTimeout(resolve, 100));
    const sample = () => {
      const point = reference.getElement()!.getBoundingClientRect();
      const viewport = map.getContainer().getBoundingClientRect();
      const svg = path.ownerSVGElement!;
      const svgBounds = svg.getBoundingClientRect();
      const inside = point.x > viewport.left + 2 && point.x < viewport.right - 2
        && point.y > viewport.top + 2 && point.y < viewport.bottom - 2;
      const inverse = path.getScreenCTM()!.inverse();
      // Native markers round to pixels independently of the transformed SVG.
      // Inspect the surrounding pixel, not subpixel agreement at a coastline.
      let filled = false;
      for (let x = -1; x <= 1 && !filled; x++) {
        for (let y = -1; y <= 1 && !filled; y++) {
          filled = path.isPointInFill(new DOMPoint(point.x + x, point.y + y).matrixTransform(inverse));
        }
      }
      const unclipped = getComputedStyle(svg).overflow === 'visible'
        || (point.x >= svgBounds.left && point.x <= svgBounds.right && point.y >= svgBounds.top && point.y <= svgBounds.bottom);
      return { inside, drawn: unclipped && filled };
    };
    let ended = false;
    map.once('moveend', () => { ended = true; });
    if (mode === 'zoom-out') map.setZoom(3, { animate: true });
    else map.flyTo(target, arrival ? 9 : 7, { animate: true, duration: arrival ? 1.2 : 0.8 });
    let added: Leaflet.GeoJSON | undefined;
    if (arrival) {
      // A tiny country loaded at the flight's low zoom must not collapse to a
      // line and stay invisible as the camera approaches. Wrapped islands use
      // this same GeoJSON arrival path.
      await new Promise(resolve => setTimeout(resolve, 350));
      added = L.geoJSON(country!.feature, { style: { fillOpacity: 1 }, interactive: false }).addTo(map);
      const polygon = added.getLayers()[0] as Leaflet.Polygon;
      path = polygon.getElement() as SVGPathElement;
    }
    let visibleFrames = 0;
    let missingFrames = 0;
    while (!ended) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      if (ended) break;
      const { inside, drawn } = sample();
      if (inside) {
        visibleFrames++;
        if (!drawn) missingFrames++;
      }
    }
    const settled = sample();
    reference.remove();
    added?.remove();
    return { visibleFrames, missingFrames, settled };
  }, mode);
}

test('zooming out draws newly visible land before the animation finishes', async ({ page }) => {
  const result = await landDuringZoom(page, 'zoom-out');
  expect(result.visibleFrames).toBeGreaterThan(0);
  expect(result.missingFrames).toBe(0);
  expect(result.settled).toEqual({ inside: true, drawn: true });
});

test('zoom-in flights retain land throughout the moving viewport', async ({ page }) => {
  const result = await landDuringZoom(page, 'flight');
  expect(result.visibleFrames).toBeGreaterThan(0);
  expect(result.missingFrames).toBe(0);
  expect(result.settled).toEqual({ inside: true, drawn: true });
});

test('small polygons arriving mid-flight remain filled while approaching', async ({ page }) => {
  const result = await landDuringZoom(page, 'arrival');
  expect(result.visibleFrames).toBeGreaterThan(0);
  expect(result.missingFrames).toBe(0);
  expect(result.settled).toEqual({ inside: true, drawn: true });
});
