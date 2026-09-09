import L from 'leaflet';
import type { Polygon } from 'geojson';
import { countries, polygonArea, type Country } from './geography';
import { contextLabels, type DifficultyContext } from './facets';

const svgNamespace = 'http://www.w3.org/2000/svg';
const worldWidth = L.CRS.EPSG3857.project(L.latLng(0, 360)).x;
type Part = { country: Country; rings: Polygon['coordinates']; bounds: L.Bounds; area: number; path?: string };
let geography: Part[] | undefined;
export const shapeDescriptions: Record<DifficultyContext, string> = {
  rich: 'Rich context · the highlighted country, surrounding geography, and neighboring names.',
  'unlabeled-local': 'Unlabeled local · the same local geography, without country names.',
  'reduced-context': 'Reduced context · a close crop with only fragments of nearby geography, without names.',
  silhouette: 'Silhouette · country outline only, with no surrounding clues.',
};

// Use the same projection and unchanged source rings as the maps. Paths are
// projected lazily; immutable parts are reused when a country is revisited.
export function renderShape(container: HTMLElement, country: Country, context: DifficultyContext): void {
  geography ??= countries.flatMap(candidate => {
    const polygons = candidate.geometry.type === 'Polygon' ? [candidate.geometry.coordinates] : candidate.geometry.coordinates;
    return polygons.map(rings => {
      const bounds = L.bounds([]);
      for (const [longitude, latitude] of rings[0]) {
        const point = L.CRS.EPSG3857.project(L.latLng(latitude, longitude));
        bounds.extend(L.point(point.x, -point.y));
      }
      return { country: candidate, rings, bounds, area: polygonArea(rings) };
    });
  });
  const target = geography.filter(part => part.country === country);
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
  const padding = Math.max(size.x, size.y) * (context === 'rich' || context === 'unlabeled-local' ? 0.55 : context === 'reduced-context' ? 0.035 : 0.12);
  const frame = L.bounds(targetBounds.min!.subtract([padding, padding]), targetBounds.max!.add([padding, padding]));
  const scale = Math.min(800 / frame.getSize().x, 540 / frame.getSize().y);
  const origin = L.point(400, 270).subtract(frame.getCenter().multiplyBy(scale));
  const visible = L.bounds(origin.multiplyBy(-1 / scale), L.point(800, 540).subtract(origin).divideBy(scale));
  const svg = document.createElementNS(svgNamespace, 'svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', context === 'silhouette' ? 'Country silhouette' : `Country shape with ${contextLabels[context].toLowerCase()}`);
  svg.setAttribute('viewBox', '0 0 800 540');
  const surrounding = document.createElementNS(svgNamespace, 'g');
  const highlighted = document.createElementNS(svgNamespace, 'g');
  const labels = new Map<Country, { part: Part; position: L.Point }>();
  for (const part of geography) {
    const isTarget = part.country === country;
    if (!isTarget && context === 'silhouette') continue;
    const bounds = shiftedBounds(part);
    if (!isTarget && !bounds.intersects(visible)) continue;
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
    path.setAttribute('class', isTarget ? 'shape-target' : 'shape-surrounding');
    (isTarget ? highlighted : surrounding).append(path);
    if (context === 'rich' && !isTarget && visible.contains(bounds.getCenter())) {
      const previous = labels.get(part.country);
      if (!previous || part.area > previous.part.area) labels.set(part.country, { part, position: bounds.getCenter().multiplyBy(scale).add(origin) });
    }
  }
  svg.append(surrounding, highlighted);
  const occupied: L.Bounds[] = [];
  for (const [neighbor, { position }] of [...labels].sort((a, b) => b[1].part.area - a[1].part.area)) {
    const width = neighbor.properties.name.length * 7 + 12;
    const box = L.bounds(position.subtract([width / 2, 12]), position.add([width / 2, 12]));
    if (box.min!.x < 8 || box.max!.x > 792 || box.min!.y < 8 || box.max!.y > 532 || occupied.some(other => other.intersects(box))) continue;
    const label = document.createElementNS(svgNamespace, 'text');
    label.setAttribute('x', String(position.x));
    label.setAttribute('y', String(position.y));
    label.setAttribute('class', 'shape-neighbor-label');
    label.textContent = neighbor.properties.name;
    svg.append(label);
    occupied.push(box);
  }
  container.replaceChildren(svg);
}
