// THROWAWAY: three structurally different renderings of the same country session.
// /?variant=A = Field Guide; B = Map First; C = Map Studio. No persistence or production mutations.
import L from 'leaflet';
import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon';
import { pointToPolygonDistance } from '@turf/point-to-polygon-distance';
import 'leaflet/dist/leaflet.css';
import './shared.prototype.css';
import { countries, type Country } from './geography';
import { FieldGuidePrototype } from './field-guide.prototype';
import { MapFirstPrototype } from './map-first.prototype';
import { MapStudioPrototype } from './map-studio.prototype';
import { PrototypeSwitcher, prototypeDesigns, type PrototypeVariant } from './switcher.prototype';

export interface PrototypeView {
  countryName: string;
  region: string;
  questionNumber: number;
  answered: number;
  correct: number;
  selected: boolean;
  feedback: 'correct' | 'incorrect' | null;
}

const practice = ['BRA', 'JPN', 'ITA', 'KEN', 'CAN'].map(id => countries.find(country => country.properties.id === id)!);
const requestedVariant = new URL(location.href).searchParams.get('variant');
let variant: PrototypeVariant = requestedVariant === 'B' || requestedVariant === 'C' ? requestedVariant : 'A';
let questionIndex = 0;
let answered = 0;
let correct = 0;
let selected: L.LatLng | null = null;
let feedback: PrototypeView['feedback'] = null;
let map: L.Map | undefined;
let marker: L.CircleMarker | undefined;
let viewCenter: L.LatLng | undefined;
let viewZoom: number | undefined;
const app = document.querySelector<HTMLDivElement>('#app')!;
const switcher = PrototypeSwitcher(variant, nextVariant => {
  viewCenter = map?.getCenter();
  viewZoom = map?.getZoom();
  variant = nextVariant;
  render();
});

function surfaceState(action: string) {
  const snapshot = {
    question: 'Which country-session design works best on desktop and mobile?',
    variant,
    country: practice[questionIndex % practice.length].properties,
    questionNumber: questionIndex + 1,
    answered, correct,
    selected: selected ? { longitude: selected.lng, latitude: selected.lat } : null,
    feedback,
    map: map ? { center: map.getCenter(), zoom: map.getZoom() } : null,
    persistence: 'none; resets on refresh',
  };
  switcher.update(variant, snapshot);
  console.info(`[UI prototype: ${action}]`, snapshot);
}

function showSelection() {
  if (!selected || !map) return;
  marker?.remove();
  marker = L.circleMarker(selected, {
    radius: 7, weight: 3, color: variant === 'B' ? '#111f2c' : '#fffdf4',
    fillColor: feedback === 'incorrect' ? '#ea947b' : variant === 'A' ? '#b55236' : variant === 'B' ? '#d6ef87' : '#2f58d8',
    fillOpacity: 1, interactive: false,
  }).addTo(map);
  app.querySelectorAll<HTMLElement>('[data-selection-hint]').forEach(hint => {
    hint.textContent = `${Math.abs(selected!.lat).toFixed(1)}° ${selected!.lat >= 0 ? 'N' : 'S'}  /  ${Math.abs(selected!.lng).toFixed(1)}° ${selected!.lng >= 0 ? 'E' : 'W'}`;
  });
  const check = app.querySelector<HTMLButtonElement>('[data-action="check"]');
  if (check) check.disabled = false;
}

function render() {
  map?.remove();
  marker = undefined;
  const country = practice[questionIndex % practice.length];
  const view: PrototypeView = {
    countryName: country.properties.name,
    region: country.properties.region,
    questionNumber: questionIndex + 1,
    answered, correct, selected: selected !== null, feedback,
  };
  document.title = `${prototypeDesigns[variant]} · Atlas design prototype`;
  document.documentElement.dataset.prototypeVariant = variant;
  app.innerHTML = variant === 'A' ? FieldGuidePrototype(view) : variant === 'B' ? MapFirstPrototype(view) : MapStudioPrototype(view);
  const canvas = document.querySelector<HTMLElement>('#prototype-map')!;
  canvas.setAttribute('role', 'region');
  canvas.setAttribute('aria-label', 'Interactive world map');
  const dark = variant === 'B';
  const palette = {
    A: { grid: '#99b3ac', border: '#95a391', land: '#e5e5cc', highlight: '#7da27b', highlightBorder: '#296245' },
    B: { grid: '#66869a', border: '#63777f', land: '#334c57', highlight: '#a2c472', highlightBorder: '#e3f5b1' },
    C: { grid: '#9cb6d0', border: '#9cabc0', land: '#f5f6f0', highlight: '#8faef0', highlightBorder: '#2f58d8' },
  }[variant];
  map = L.map(canvas, {
    minZoom: 1, maxZoom: 9, keyboard: false, doubleClickZoom: false,
    zoomAnimation: false, fadeAnimation: false, attributionControl: false,
    zoomControl: false, maxBounds: [[-85, -180], [85, 180]], maxBoundsViscosity: 0.8,
  }).setView(viewCenter ?? [12, 0], viewZoom ?? (canvas.clientWidth < 650 ? 1 : 2));
  L.control.zoom({ position: 'topright' }).addTo(map);
  if (dark) {
    // B is an edge-to-edge canvas, so extend its geographic grid to the viewport
    // rather than clipping the lines at ±180° longitude and the Mercator poles.
    const gridMap = map;
    const grid = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    grid.classList.add('mf-viewport-grid');
    grid.setAttribute('aria-hidden', 'true');
    Object.assign(grid.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '0' });
    const lines = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    lines.setAttribute('stroke', palette.grid);
    lines.setAttribute('stroke-width', '1');
    lines.setAttribute('opacity', '0.12');
    grid.append(lines);
    canvas.append(grid);
    function drawViewportGrid() {
      const size = gridMap.getSize();
      const bounds = gridMap.getBounds();
      const segments: string[] = [];
      for (let longitude = Math.floor(bounds.getWest() / 30) * 30; longitude <= bounds.getEast(); longitude += 30) {
        const x = gridMap.latLngToContainerPoint([0, longitude]).x;
        segments.push(`M${x} 0V${size.y}`);
      }
      for (let latitude = -60; latitude <= 60; latitude += 30) {
        const y = gridMap.latLngToContainerPoint([latitude, 0]).y;
        if (y >= 0 && y <= size.y) segments.push(`M0 ${y}H${size.x}`);
      }
      grid.setAttribute('viewBox', `0 0 ${size.x} ${size.y}`);
      lines.setAttribute('d', segments.join(''));
    }
    gridMap.on('move zoom resize', drawViewportGrid);
    drawViewportGrid();
  } else {
    for (let longitude = -180; longitude <= 180; longitude += 30) {
      L.polyline([[-85, longitude], [85, longitude]], { color: palette.grid, opacity: 0.24, weight: 1, interactive: false }).addTo(map);
    }
    for (let latitude = -60; latitude <= 60; latitude += 30) {
      L.polyline([[latitude, -180], [latitude, 180]], { color: palette.grid, opacity: 0.24, weight: 1, interactive: false }).addTo(map);
    }
  }
  const boundaries = L.geoJSON(countries, {
    style: { color: palette.border, weight: 0.8, fillColor: palette.land, fillOpacity: 1 },
  }).addTo(map);
  if (feedback) {
    boundaries.eachLayer(layer => {
      const polygon = layer as L.Polygon & { feature: Country };
      if (polygon.feature.properties.id !== country.properties.id) return;
      polygon.setStyle({ color: palette.highlightBorder, weight: 2, fillColor: palette.highlight });
      polygon.bringToFront();
      map!.fitBounds(polygon.getBounds(), {
        paddingTopLeft: [dark && canvas.clientWidth > 700 ? 430 : 30, dark ? 110 : 30],
        paddingBottomRight: [30, dark ? canvas.clientWidth > 700 ? 110 : 340 : 30],
        maxZoom: 4, animate: false,
      });
    });
  }
  showSelection();
  map.on('click', (event: L.LeafletMouseEvent) => {
    if (feedback) return;
    selected = event.latlng.wrap();
    showSelection();
    surfaceState('select point');
  });
  map.on('moveend', () => surfaceState('map view'));
  surfaceState('render / variant switch');
}

app.addEventListener('click', event => {
  const action = (event.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action;
  if (!action) return;
  if (action === 'world') {
    map!.setView([12, 0], map!.getContainer().clientWidth < 650 ? 1 : 2, { animate: false });
    return;
  }
  if (action === 'check' && selected && !feedback) {
    const point = [selected.lng, selected.lat];
    const country = practice[questionIndex % practice.length];
    const inside = booleanPointInPolygon(point, country);
    const otherCountry = !inside && countries.some(candidate => booleanPointInPolygon(point, candidate));
    const accepted = inside || (!otherCountry && pointToPolygonDistance(point, country, { units: 'kilometers' }) <= 25);
    feedback = accepted ? 'correct' : 'incorrect';
    answered += 1;
    if (accepted) correct += 1;
  } else if (action === 'next' && feedback) {
    questionIndex += 1;
    selected = null;
    feedback = null;
  } else if (action === 'restart') {
    questionIndex = 0;
    answered = 0;
    correct = 0;
    selected = null;
    feedback = null;
  } else {
    return;
  }
  viewCenter = undefined;
  viewZoom = undefined;
  render();
});

render();
