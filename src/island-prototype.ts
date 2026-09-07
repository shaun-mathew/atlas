// THROWAWAY: Which view makes a small island visible without losing its regional context?
// Three structurally different variants on the existing / route, selected by ?variant=A|B|C.
// Real boundaries, in-memory guided interaction; no GuestSession and no storage writes.
import L from 'leaflet';
import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon';
import 'leaflet/dist/leaflet.css';
import './style.css';
import './island-prototype.css';
import { countries } from './geography';
import { mountPrototypeSwitcher } from './prototype-switcher';

type Island = {
  id: string;
  name: string;
  center: L.LatLngTuple;
  region: L.LatLngBoundsLiteral;
  detailZoom: number;
  relationship: string;
  labels: { name: string; point: L.LatLngTuple }[];
};
const islands: Record<string, Island> = {
  ALD: {
    id: 'ALD', name: 'Åland', center: [60.18, 19.95], region: [[57.5, 14], [64, 28]], detailZoom: 8,
    relationship: 'An archipelago between Sweden and Finland, at the entrance to the Gulf of Bothnia.',
    labels: [{ name: 'SWEDEN', point: [61.6, 15.5] }, { name: 'FINLAND', point: [62.5, 25.5] }, { name: 'Baltic Sea', point: [58, 21] }],
  },
  MLT: {
    id: 'MLT', name: 'Malta', center: [35.9, 14.45], region: [[32.5, 9], [40.5, 19]], detailZoom: 9,
    relationship: 'South of Sicily, with Tunisia to the west across the Mediterranean Sea.',
    labels: [{ name: 'SICILY · ITALY', point: [37.6, 14] }, { name: 'TUNISIA', point: [34.8, 9.8] }, { name: 'Mediterranean Sea', point: [33.8, 16] }],
  },
  MUS: {
    id: 'MUS', name: 'Mauritius', center: [-20.2, 57.55], region: [[-27, 43], [-12, 65]], detailZoom: 8,
    relationship: 'East of Madagascar in the Indian Ocean. Réunion is the closer island to the southwest. The close-up starts on Mauritius’s main island.',
    labels: [{ name: 'MADAGASCAR', point: [-19, 46.5] }, { name: 'RÉUNION', point: [-21.6, 55.4] }, { name: 'Indian Ocean', point: [-15, 59] }],
  },
};
const variantNames = { A: 'Regional zoom', B: 'Magnifying lens', C: 'Linked maps' };
const params = new URLSearchParams(location.search);
let island = islands[params.get('island') ?? ''] ?? islands.ALD;
let activeVariant = 'A';
let maps: L.Map[] = [];
let listeners = new AbortController();
const app = document.querySelector<HTMLElement>('#app')!;

function createMap(id: string, interactive = true) {
  const map = L.map(id, {
    zoomControl: false, attributionControl: false, minZoom: 2, maxZoom: 11,
    zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false, inertia: false,
    dragging: interactive, scrollWheelZoom: interactive, doubleClickZoom: false,
    touchZoom: interactive, keyboard: interactive, boxZoom: false,
    maxBounds: [[-85, -180], [85, 180]],
  });
  L.geoJSON(countries, { interactive: false, style: { color: '#769099', weight: 0.8, fillColor: '#354f5b', fillOpacity: 1 } }).addTo(map);
  if (interactive) L.control.zoom({ position: 'topright' }).addTo(map);
  L.control.scale({ imperial: false, position: 'bottomright' }).addTo(map);
  maps.push(map);
  return map;
}

function addIsland(map: L.Map, labels = true) {
  const target = countries.find(country => country.properties.id === island.id)!;
  L.geoJSON(target, { interactive: false, style: { color: '#e5f8b8', weight: 1.5, fillColor: '#c6e48a', fillOpacity: 1 } }).addTo(map);
  if (labels) {
    for (const label of island.labels) {
      L.marker(label.point, { interactive: false, keyboard: false, icon: L.divIcon({ className: 'prototype-land-label', html: label.name, iconSize: [150, 20], iconAnchor: [75, 10] }) }).addTo(map);
    }
  }
}

function renderVariant(key: string) {
  activeVariant = key;
  listeners.abort();
  listeners = new AbortController();
  for (const map of maps) map.remove();
  maps = [];
  const descriptions: Record<string, string> = {
    A: 'One tap to bring the island and its neighbors into view. Go closer when you are ready.',
    B: 'Keep the regional picture. Move a magnifying glass over the map to inspect the coastline.',
    C: 'Two scales, side by side. The outlined window connects the close-up to the wider region.',
  };
  app.className = `island-prototype variant-${key}`;
  app.innerHTML = `
    <div id="map" role="region" aria-label="Regional map"></div>
    <div class="map-shade" aria-hidden="true"></div>
    <header class="app-header">
      <a class="brand" href="/?variant=${key}" aria-label="Atlas Practice prototype"><svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><circle cx="16" cy="16" r="13" stroke="currentColor"/><path d="m21 10-3 9-8 3 3-9 8-3Z" stroke="currentColor"/></svg><span>Atlas<span class="brand-subtitle">A little further, every day.</span></span></a>
      <span class="prototype-badge">Design lab <span>· no progress saved</span></span>
    </header>
    <div class="prototype-example"><label for="island-example">Try a small island</label><select id="island-example">${Object.values(islands).map(item => `<option value="${item.id}" ${item.id === island.id ? 'selected' : ''}>${item.name}</option>`).join('')}</select></div>
    <section class="session-panel prototype-panel" aria-label="Guided country practice">
      <p class="eyebrow"><span class="live-dot"></span> Name-to-location · guided preview</p>
      <p class="prompt">Get your bearings in</p>
      <h1>${island.name}<span class="accent">.</span></h1>
      <p class="instructions">${descriptions[key]}</p>
      <div class="answer-dock">
        <p class="prototype-relationship">${island.relationship}</p>
        <div id="variant-actions"></div>
        <p id="prototype-feedback" role="status">Guided exploration only. Hints do not count as retained knowledge.</p>
      </div>
      <details class="prototype-state"><summary>Prototype state · memory only</summary><pre id="prototype-state"></pre></details>
    </section>
    <p class="prototype-source">Natural Earth · illustrative labels · guided, not scored</p>
    ${key === 'B' ? '<div id="lens" aria-label="Magnifying lens"><div id="lens-map"></div><div class="lens-crosshair" aria-hidden="true"></div><button id="lens-handle" type="button" aria-label="Drag magnifying lens">Drag lens · <span id="lens-power">8×</span></button></div>' : ''}
    ${key === 'C' ? '<div class="overview-caption"><span>01 / REGIONAL CONTEXT</span><small>Click the map to move the close-up</small></div><section id="detail-panel" aria-label="Island close-up"><header><span>02 / ISLAND DETAIL</span><small>Drag or zoom · the overview stays put</small></header><div id="detail-map"></div></section>' : ''}
  `;
  const map = createMap('map');
  const actions = document.querySelector<HTMLElement>('#variant-actions')!;
  const state = { variant: key, island: island.id, view: key === 'A' ? 'world' : 'region', regionalZoom: 2, regionalCenter: [20, 10], detailZoom: null as number | null, lensCenter: null as number[] | null, selected: null as number[] | null, scored: false, persistence: 'none' };
  const showState = () => {
    state.regionalZoom = map.getZoom();
    state.regionalCenter = [Number(map.getCenter().lat.toFixed(3)), Number(map.getCenter().lng.toFixed(3))];
    document.querySelector('#prototype-state')!.textContent = JSON.stringify(state, null, 2);
  };
  const frameRegion = () => {
    const narrow = window.innerWidth < 900;
    const padding = key === 'C' ? { padding: [22, 35] as L.PointTuple }
      : { paddingTopLeft: [narrow ? 24 : 390, narrow ? 105 : 130] as L.PointTuple, paddingBottomRight: [24, narrow ? 370 : 115] as L.PointTuple };
    map.fitBounds(island.region, { ...padding, animate: false });
    state.view = 'region';
    showState();
  };
  let pin: L.CircleMarker | undefined;
  const placePin = (point: L.LatLng, surface: L.Map) => {
    pin?.remove();
    const inside = booleanPointInPolygon([point.lng, point.lat], countries.find(country => country.properties.id === island.id)!);
    pin = L.circleMarker(point, { radius: 6, color: inside ? '#d6ed8b' : '#f3bca1', weight: 3, fillColor: '#122630', fillOpacity: 1 }).addTo(surface);
    state.selected = [Number(point.lat.toFixed(3)), Number(point.lng.toFixed(3))];
    document.querySelector('#prototype-feedback')!.textContent = `${inside ? 'On the island' : 'Outside the island'} · practice pin ${point.lat.toFixed(2)}°, ${point.lng.toFixed(2)}°. Not scored.`;
    showState();
  };

  if (key === 'A') {
    actions.innerHTML = '<button id="region-zoom" class="primary" type="button">Zoom to island & neighbors <span aria-hidden="true">↗</span></button><div class="prototype-secondary-actions"><button id="closer" class="secondary" type="button" disabled>Island close-up</button><button id="world" class="secondary" type="button">World view</button></div>';
    map.setView([20, 10], 2, { animate: false });
    let highlighted = false;
    const reveal = () => {
      if (highlighted) return;
      addIsland(map);
      L.circleMarker(island.center, { radius: 12, color: '#d6ed8b', weight: 2, fillOpacity: 0, interactive: false }).addTo(map);
      highlighted = true;
      document.querySelector<HTMLButtonElement>('#closer')!.disabled = false;
    };
    document.querySelector('#region-zoom')!.addEventListener('click', () => {
      reveal();
      frameRegion();
      document.querySelector('#prototype-feedback')!.textContent = 'Island ringed in green. Nearby land masses keep it in context. Tap to place an unscored pin.';
    });
    document.querySelector('#closer')!.addEventListener('click', () => {
      // Fit an area around the main island, with room reserved for the practice panel.
      const extent = L.latLng(island.center).toBounds(island.id === 'MLT' ? 65000 : 160000);
      map.fitBounds(extent, { paddingTopLeft: [window.innerWidth < 900 ? 24 : 390, 120], paddingBottomRight: [24, window.innerWidth < 900 ? 370 : 115], maxZoom: island.detailZoom, animate: false });
      state.view = 'island';
      showState();
    });
    document.querySelector('#world')!.addEventListener('click', () => { map.setView([20, 10], 2, { animate: false }); state.view = 'world'; showState(); });
    map.on('click', event => placePin(event.latlng, map));
  }

  if (key === 'B') {
    actions.innerHTML = '<button id="recenter-lens" class="primary" type="button">Magnify the island <span aria-hidden="true">⌕</span></button><button id="lens-pin" class="secondary" type="button">Place pin at lens center</button><p class="prototype-help">Drag the lens handle, or tap anywhere on the regional map.</p>';
    addIsland(map);
    frameRegion();
    const detail = createMap('lens-map', false);
    addIsland(detail, false);
    const lens = document.querySelector<HTMLElement>('#lens')!;
    let position = L.point(0, 0);
    const moveLens = (point: L.Point) => {
      const radius = lens.offsetWidth / 2;
      position = L.point(Math.max(radius + 8, Math.min(map.getSize().x - radius - 8, point.x)), Math.max(radius + 95, Math.min(map.getSize().y - radius - 95, point.y)));
      lens.style.left = `${position.x}px`;
      lens.style.top = `${position.y}px`;
      const center = map.containerPointToLatLng(position);
      detail.setView(center, Math.min(map.getZoom() + 3, 11), { animate: false });
      state.lensCenter = [Number(center.lat.toFixed(3)), Number(center.lng.toFixed(3))];
      state.detailZoom = detail.getZoom();
      document.querySelector('#lens-power')!.textContent = `${2 ** (detail.getZoom() - map.getZoom())}×`;
      showState();
    };
    const recenter = () => { frameRegion(); moveLens(map.latLngToContainerPoint(island.center)); };
    recenter();
    map.on('moveend zoomend', () => moveLens(position));
    map.on('click', event => moveLens(map.latLngToContainerPoint(event.latlng)));
    document.querySelector('#recenter-lens')!.addEventListener('click', recenter);
    document.querySelector('#lens-pin')!.addEventListener('click', () => placePin(detail.getCenter(), detail));
    const handle = document.querySelector<HTMLElement>('#lens-handle')!;
    let dragStart: { pointer: L.Point; position: L.Point } | undefined;
    handle.addEventListener('pointerdown', event => {
      event.preventDefault();
      dragStart = { pointer: L.point(event.clientX, event.clientY), position };
      handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove', event => {
      if (dragStart) moveLens(dragStart.position.add(L.point(event.clientX, event.clientY).subtract(dragStart.pointer)));
    });
    handle.addEventListener('pointerup', () => { dragStart = undefined; });
    handle.addEventListener('pointercancel', () => { dragStart = undefined; });
    window.addEventListener('resize', () => { map.invalidateSize(); detail.invalidateSize(); recenter(); }, { signal: listeners.signal });
  }

  if (key === 'C') {
    actions.innerHTML = '<button id="reset-linked" class="primary" type="button">Back to the island <span aria-hidden="true">↗</span></button><p class="prototype-help">The green rectangle is the area shown in the close-up. Place a practice pin in the detail map.</p>';
    addIsland(map);
    frameRegion();
    const detail = createMap('detail-map');
    addIsland(detail, false);
    detail.setView(island.center, island.detailZoom, { animate: false });
    const windowOutline = L.rectangle(detail.getBounds(), { color: '#d6ed8b', weight: 2, fillColor: '#d6ed8b', fillOpacity: 0.1, interactive: false }).addTo(map);
    L.circleMarker(island.center, { radius: 5, color: '#d6ed8b', fillOpacity: 1, interactive: false }).addTo(map);
    const synchronize = () => {
      windowOutline.setBounds(detail.getBounds());
      state.detailZoom = detail.getZoom();
      state.lensCenter = [Number(detail.getCenter().lat.toFixed(3)), Number(detail.getCenter().lng.toFixed(3))];
      showState();
    };
    detail.on('move zoomend', synchronize);
    map.on('click', event => detail.panTo(event.latlng, { animate: false }));
    detail.on('click', event => placePin(event.latlng, detail));
    document.querySelector('#reset-linked')!.addEventListener('click', () => { frameRegion(); detail.setView(island.center, island.detailZoom, { animate: false }); });
    synchronize();
    window.addEventListener('resize', () => { map.invalidateSize(); detail.invalidateSize(); frameRegion(); synchronize(); }, { signal: listeners.signal });
  }
  if (key === 'A') window.addEventListener('resize', () => {
    map.invalidateSize();
    if (state.view === 'region') frameRegion();
  }, { signal: listeners.signal });

  map.on('moveend zoomend', showState);
  document.querySelector<HTMLSelectElement>('#island-example')!.addEventListener('change', event => {
    island = islands[(event.target as HTMLSelectElement).value];
    const url = new URL(location.href);
    url.searchParams.set('island', island.id);
    history.replaceState(null, '', url);
    renderVariant(activeVariant);
  });
  showState();
  console.info('Island prototype state', { ...state });
}

mountPrototypeSwitcher(variantNames, renderVariant);
