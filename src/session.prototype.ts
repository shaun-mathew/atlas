// THROWAWAY: two structurally different renderings of the same country session.
// /?variant=A = Field Guide; /?variant=B = Map First. No persistence or production mutations.
import L from 'leaflet';
import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon';
import { pointToPolygonDistance } from '@turf/point-to-polygon-distance';
import 'leaflet/dist/leaflet.css';
import './shared.prototype.css';
import { countries, type Country } from './geography';
import { FieldGuidePrototype } from './field-guide.prototype';
import { MapFirstPrototype } from './map-first.prototype';
import { PrototypeSwitcher } from './switcher.prototype';

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
let variant: 'A' | 'B' = new URL(location.href).searchParams.get('variant') === 'B' ? 'B' : 'A';
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
    radius: 7, weight: 3, color: variant === 'A' ? '#fffdf4' : '#111f2c',
    fillColor: feedback === 'incorrect' ? '#ea947b' : variant === 'A' ? '#b55236' : '#d6ef87',
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
  document.title = `${variant === 'A' ? 'Field Guide' : 'Map First'} · Atlas design prototype`;
  document.documentElement.dataset.prototypeVariant = variant;
  app.innerHTML = variant === 'A' ? FieldGuidePrototype(view) : MapFirstPrototype(view);
  const canvas = document.querySelector<HTMLElement>('#prototype-map')!;
  canvas.setAttribute('role', 'region');
  canvas.setAttribute('aria-label', 'Interactive world map');
  const dark = variant === 'B';
  map = L.map(canvas, {
    minZoom: 1, maxZoom: 9, keyboard: false, doubleClickZoom: false,
    zoomAnimation: false, fadeAnimation: false, attributionControl: false,
    zoomControl: false, maxBounds: [[-85, -180], [85, 180]], maxBoundsViscosity: 0.8,
  }).setView(viewCenter ?? [12, 0], viewZoom ?? (canvas.clientWidth < 650 ? 1 : 2));
  L.control.zoom({ position: 'topright' }).addTo(map);
  for (let longitude = -180; longitude <= 180; longitude += 30) {
    L.polyline([[-85, longitude], [85, longitude]], { color: dark ? '#66869a' : '#99b3ac', opacity: dark ? 0.12 : 0.24, weight: 1, interactive: false }).addTo(map);
  }
  for (let latitude = -60; latitude <= 60; latitude += 30) {
    L.polyline([[latitude, -180], [latitude, 180]], { color: dark ? '#66869a' : '#99b3ac', opacity: dark ? 0.12 : 0.24, weight: 1, interactive: false }).addTo(map);
  }
  const boundaries = L.geoJSON(countries, {
    style: { color: dark ? '#63777f' : '#95a391', weight: 0.8, fillColor: dark ? '#334c57' : '#e5e5cc', fillOpacity: 1 },
  }).addTo(map);
  if (feedback) {
    boundaries.eachLayer(layer => {
      const polygon = layer as L.Polygon & { feature: Country };
      if (polygon.feature.properties.id !== country.properties.id) return;
      polygon.setStyle({ color: dark ? '#e3f5b1' : '#296245', weight: 2, fillColor: dark ? '#a2c472' : '#7da27b' });
      polygon.bringToFront();
      map!.fitBounds(polygon.getBounds(), {
        paddingTopLeft: [30, dark ? 110 : 30],
        paddingBottomRight: [30, dark ? 340 : 30],
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
