import L from 'leaflet';
import type { Polygon } from 'geojson';
import { polygonArea, type Country } from './geography';

const svgNamespace = 'http://www.w3.org/2000/svg';
const worldWidth = L.CRS.EPSG3857.project(L.latLng(0, 360)).x;
type Part = { rings: Polygon['coordinates']; bounds: L.Bounds; area: number; path?: string };
const geography = new WeakMap<Country, Part[]>();

// Use the same projection and unchanged source rings as the maps. Paths are
// projected lazily; immutable parts are reused when a country is revisited.
export function renderShape(container: HTMLElement, country: Country): void {
  let target = geography.get(country);
  if (!target) {
    const polygons = country.geometry.type === 'Polygon' ? [country.geometry.coordinates] : country.geometry.coordinates;
    target = polygons.map(rings => {
      const bounds = L.bounds([]);
      for (const [longitude, latitude] of rings[0]) {
        const point = L.CRS.EPSG3857.project(L.latLng(latitude, longitude));
        bounds.extend(L.point(point.x, -point.y));
      }
      return { rings, bounds, area: polygonArea(rings) };
    });
    geography.set(country, target);
  }
  const primary = target.reduce((largest, part) => part.area > largest.area ? part : largest);
  const centerX = primary.bounds.getCenter().x;
  const shiftedBounds = (part: Part): L.Bounds => {
    const shift = L.point(worldWidth * Math.round((centerX - part.bounds.getCenter().x) / worldWidth), 0);
    return L.bounds(part.bounds.min!.add(shift), part.bounds.max!.add(shift));
  };
  const targetBounds = L.bounds([]);
  for (const part of target) {
    const bounds = shiftedBounds(part);
    targetBounds.extend(bounds.min!);
    targetBounds.extend(bounds.max!);
  }
  const size = targetBounds.getSize();
  const padding = Math.max(size.x, size.y) * 0.12;
  const frame = L.bounds(targetBounds.min!.subtract([padding, padding]), targetBounds.max!.add([padding, padding]));
  const scale = Math.min(800 / frame.getSize().x, 540 / frame.getSize().y);
  const origin = L.point(400, 270).subtract(frame.getCenter().multiplyBy(scale));
  const svg = document.createElementNS(svgNamespace, 'svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Country silhouette');
  svg.setAttribute('viewBox', '0 0 800 540');
  for (const part of target) {
    const bounds = shiftedBounds(part);
    if (part.path === undefined) {
      part.path = part.rings.map(ring => ring.map(([longitude, latitude], index) => {
        const point = L.CRS.EPSG3857.project(L.latLng(latitude, longitude));
        return `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)},${(-point.y).toFixed(2)}`;
      }).join('') + 'Z').join('');
    }
    const path = document.createElementNS(svgNamespace, 'path');
    const shift = bounds.min!.x - part.bounds.min!.x;
    path.setAttribute('d', part.path);
    path.setAttribute('transform', `matrix(${scale},0,0,${scale},${origin.x + shift * scale},${origin.y})`);
    path.setAttribute('fill-rule', 'evenodd');
    path.setAttribute('class', 'shape-target');
    svg.append(path);
  }
  container.replaceChildren(svg);
}
