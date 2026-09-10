// THROWAWAY: Map, learning-flow, and quiz-navigation comparison sets on /?variant=A–K.
// Question: one learning flow, a separate city test, or geography tracks—and what map detail is enough?
// No accounts, scheduling, persistence, or production assessment policy. Thresholds are experimental.
import L from 'leaflet';
import type { FeatureCollection, MultiLineString, LineString } from 'geojson';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import 'leaflet/dist/leaflet.css';
import './style.css';
import './facet-setup.css';
import './city-prototype.css';
import { countries } from './geography';
import data from './data/city-prototype.json';
import { PrototypeSwitcher } from './prototype-switcher';

type Track = 'countries' | 'cities' | 'rivers';
type Detail = 'outlines' | 'rivers' | 'detailed' | 'land';
type City = typeof data.cities[number];
type Question = { kind: Track; name: string; city: City; countryId: string };
type Attempt = { name: string; kind: Track; distanceKm: number | null; correct: boolean; assisted: boolean; detail: Detail; borders: boolean; step: number; restoredContext: boolean };
const app = document.querySelector<HTMLElement>('#app')!;
const rivers = data.rivers as FeatureCollection<LineString | MultiLineString>;
const countryViews: Record<string, L.LatLngBoundsExpression> = {
  FRA: [[41, -5], [51.5, 10]], EGY: [[21.5, 24], [32, 37]], JPN: [[30, 128], [46, 146]],
  BRA: [[-34, -74], [6, -34]], KEN: [[-5, 33], [5, 42]], AUS: [[-44, 112], [-10, 154]],
};
const trackVariants: Record<string, boolean> = { C:true, D:true, H:true, I:true, J:true, K:true };
const borderVariants: Record<string, boolean> = { D:true, G:true, H:true, I:true, J:true, K:true };
const quizNavigationVariants: Record<string, boolean> = { I:true, J:true, K:true };
const quizMapDetails: Record<Track, Detail> = { countries:'outlines', cities:'detailed', rivers:'rivers' };
const quizTypes: { track: Track; label: string; description: string; icon: string }[] = [
  { track:'countries', label:'Countries', description:'Select inside a boundary · 6 sample countries', icon:'M4 5 10 3 16 6 21 4 20 17 14 21 8 18 3 20Z' },
  { track:'cities', label:'Cities', description:'Place a point · 6 sample cities', icon:'M3 21V10H9V21M9 21V3H16V21M16 21V13H21V21M1 21H23M12 7H13M12 11H13M12 15H13' },
  { track:'rivers', label:'Rivers', description:'Select along a course · Nile sample', icon:'M9 2C2 8 20 8 14 14S7 19 12 22M15 2C8 8 26 8 20 14S13 19 18 22' },
];
const cairo = data.cities.find(city => city.name === 'Cairo')!;
const nairobi = data.cities.find(city => city.name === 'Nairobi')!;
const circuit: { city: City; kind: Track; relationship: string }[] = [
  { city:cairo, kind:'countries', relationship:'Egypt links the Mediterranean coast to the Nile valley.' },
  { city:cairo, kind:'cities', relationship:'Cairo sits near the head of the Nile delta in Egypt.' },
  { city:cairo, kind:'rivers', relationship:'The Nile crosses Egypt; its course connects places across national borders.' },
  { city:nairobi, kind:'countries', relationship:'Kenya lies farther south in East Africa, on the Indian Ocean.' },
  { city:nairobi, kind:'cities', relationship:'Nairobi is inland in the Kenyan highlands, not on the coast.' },
];
const circuitBounds: L.LatLngBoundsExpression = [[-7,22],[34,43]];
let variant = 'A';
let track: Track = 'cities';
let detail: Detail = 'outlines';
let showBorders = false;
let index = 0;
let tolerance = 100;
let assisted = false;
let answered = false;
let restoredContext = false;
let selection: L.LatLng | undefined;
let attempts: Attempt[] = [];
let map: L.Map;
let overview: L.Map | undefined;
let cleanupSwitcher: (() => void) | undefined;
let layers: L.LayerGroup;
let marks: L.LayerGroup;
let borderLayer: L.GeoJSON | undefined;
let viewport: L.Rectangle | undefined;
let tileErrors = 0;
let tilesLoaded = 0;
let stateOpen = false;
const mapSize = new ResizeObserver(() => {
  map.invalidateSize({ pan:false });
  overview?.invalidateSize({ pan:false });
});

function question(): Question {
  const cityIndex = variant === 'E' ? Math.floor(index/2) : variant === 'G' ? Math.floor(index/3) : index;
  const city = variant === 'F' ? circuit[index % circuit.length].city : data.cities[cityIndex % data.cities.length];
  const kind: Track = variant === 'A' ? (index % 3 === 1 ? 'countries' : 'cities')
    : variant === 'E' ? (index % 2 === 0 ? 'countries' : 'cities')
    : variant === 'F' ? circuit[index % circuit.length].kind
    : variant === 'B' || variant === 'G' ? 'cities' : track;
  return { kind, name: kind === 'cities' ? city.name : kind === 'countries' ? city.country : 'Nile', city, countryId: city.countryId };
}
const mapTools = () => `<div class="cp-map-tools">${quizNavigationVariants[variant] ? '<span id="cp-quiz-map-context" class="cp-map-context"></span>' : `<label>Map detail<select id="cp-detail" ${variant === 'G' ? 'disabled' : ''}><option value="outlines">Current · country outlines</option><option value="rivers">Physical · outlines + rivers</option><option value="detailed">Local · satellite, no labels</option>${variant === 'G' ? '<option value="land">Reduced · land shape only</option>' : ''}</select></label>`}${variant === 'D' || variant === 'H' ? '<label class="cp-border-toggle"><input id="cp-borders" type="checkbox" checked> Country borders</label>' : ''}<button class="secondary" id="cp-world">World</button><button class="secondary" id="cp-region">${variant === 'F' ? 'Back to circuit' : 'Regional hint'}</button></div><div id="cp-map" role="region" aria-label="Practice map"></div><div class="cp-map-caption" id="cp-map-caption"></div>`;
const questionPanel = () => `<section class="cp-question"><p class="eyebrow" id="cp-kind"></p><p class="prompt">Where is</p><h1 id="cp-name"></h1><p id="cp-instruction"></p><label class="cp-tolerance">City tolerance <select id="cp-tolerance"><option value="25">25 km · precise</option><option value="100">100 km · regional</option><option value="250">250 km · broad</option></select></label><div class="cp-answer"><p id="cp-selection" aria-live="polite">Click the map to place your answer.</p><div id="cp-feedback" role="status" aria-live="polite"></div><button id="cp-check" class="primary" disabled>Check location <span>→</span></button><button id="cp-next" class="primary" hidden>Next learning item <span>→</span></button><button id="cp-reveal" class="secondary">Reveal & learn</button></div><p id="cp-guidance"></p></section>`;
const cityPicker = () => `<label class="cp-picker">Try a city<select id="cp-city">${data.cities.map((c,i)=>`<option value="${i}">${c.name} · ${c.country}</option>`).join('')}</select></label>`;
const quizTypeButtons = () => quizTypes.map(quiz => `<button type="button" data-track="${quiz.track}"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="${quiz.icon}" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/></svg><span>${quiz.label}<small>${quiz.description}</small></span></button>`).join('');

export function VariantA() {
  return `<div class="cp-integrated"><aside><p class="cp-kicker">A / One continuous session</p><h2>Keep the world together.</h2><p class="cp-premise">Countries and cities share a practice queue. You decide when to zoom; the world stays the starting point.</p><div class="cp-queue"><span class="active">City</span><span>Country</span><span>City</span></div>${questionPanel()}<p class="cp-tradeoff">Tests the cost of switching scale between learning items. Individual skills would still keep separate proficiency.</p></aside><section class="cp-map-stage">${mapTools()}</section></div>`;
}
export function VariantB() {
  return `<div class="cp-lab"><section class="cp-lab-heading"><div><p class="cp-kicker">B / Dedicated city test</p><h2>Think at city scale.</h2><p class="cp-premise">A regional overview beside a focused answer map. Country context is given, not recalled.</p></div>${cityPicker()}</section><div class="cp-lab-workspace"><aside class="cp-overview-panel"><p class="eyebrow">Regional overview · not an answer map</p><div id="cp-overview" role="region" aria-label="Regional overview"></div><p>Outlined box = answer-map viewport. Use the overview to keep your bearings as you zoom.</p><div class="cp-lab-progress" id="cp-lab-progress"></div></aside><section class="cp-map-stage">${mapTools()}</section></div><div class="cp-lab-answer">${questionPanel()}</div></div>`;
}
export function VariantC() {
  return `<div class="cp-tracks"><aside class="cp-track-sidebar"><p class="cp-kicker">C / One home, distinct tracks</p><h2>Choose your geography.</h2><p class="cp-premise">Keep one practice home, but let each entity type choose its map and answer rules.</p><nav aria-label="Geography track"><button data-track="countries"><b>01</b><span>Countries<small>Select inside a boundary</small></span></button><button data-track="cities"><b>02</b><span>Cities<small>Place a point · measure distance</small></span></button><button data-track="rivers"><b>03</b><span>Rivers<small>Select along a course</small></span></button></nav>${cityPicker()}<p class="cp-tradeoff">Switching track keeps this prototype's answer history, but starts a fresh question. Rivers use a real Nile geometry sample.</p></aside><div class="cp-track-main"><section class="cp-map-stage">${mapTools()}</section><div class="cp-track-question">${questionPanel()}</div></div></div>`;
}

export function VariantD() {
  return `<div class="cp-tracks"><aside class="cp-track-sidebar"><p class="cp-kicker">D / Geography tracks + borders</p><h2>See the land.<br>Keep your bearings.</h2><p class="cp-premise">Satellite detail with country borders on top. Keep physical clues and political context together, without city labels.</p><nav aria-label="Geography track"><button data-track="countries"><b>01</b><span>Countries<small>Select inside a boundary</small></span></button><button data-track="cities"><b>02</b><span>Cities<small>Place a point · measure distance</small></span></button><button data-track="rivers"><b>03</b><span>Rivers<small>Select along a course</small></span></button></nav>${cityPicker()}<p class="cp-tradeoff">Toggle country borders without moving the map or losing your pin. Borders use the current 1:50m geometry; zooming adds imagery detail, not finer boundaries.</p></aside><div class="cp-track-main"><section class="cp-map-stage">${mapTools()}</section><div class="cp-track-question">${questionPanel()}</div></div></div>`;
}

export function VariantE() {
  return `<div class="cp-pair"><header class="cp-flow-heading"><div><p class="cp-kicker">E / Country → city</p><h2>Find the country. Then go closer.</h2><p class="cp-premise">Two separate answers, one geographic relationship. The city stage follows the real country—even after a miss.</p></div>${cityPicker()}</header><div class="cp-pair-workspace"><aside><ol class="cp-steps"><li data-step="0">01 · Country on the world map</li><li data-step="1">02 · City within its region</li></ol><p id="cp-flow-stage" class="cp-stage-note"></p>${questionPanel()}<p class="cp-tradeoff">Country and city answers stay separate. The close-up is guided practice, not independent world-scale recall.</p></aside><section class="cp-map-stage">${mapTools()}</section></div></div>`;
}

export function VariantF() {
  return `<div class="cp-circuit"><header class="cp-flow-heading"><div><p class="cp-kicker">F / Regional circuit</p><h2>The Nile & East Africa.</h2><p class="cp-premise">Five connected stops. Countries, cities and a river share one regional canvas; your viewport stays where you leave it.</p></div><p id="cp-flow-stage" class="cp-stage-note"></p></header><ol class="cp-circuit-stops">${circuit.map((step,i)=>`<li data-step="${i}"><small>${step.kind}</small>${step.kind === 'cities' ? step.city.name : step.kind === 'countries' ? step.city.country : 'Nile'}</li>`).join('')}</ol><section class="cp-map-stage">${mapTools()}</section><div class="cp-track-question">${questionPanel()}<p id="cp-relationship" class="cp-relationship"></p></div></div>`;
}

export function VariantG() {
  return `<div class="cp-fading"><aside><p class="cp-kicker">G / Fading context</p><h2>Keep the place.<br>Lose the clues.</h2><p class="cp-premise">Try each city three times with progressively less context. The regional frame stays the same; these are immediate practice repetitions.</p>${cityPicker()}<ol class="cp-steps"><li data-step="0">01 · Rivers + borders</li><li data-step="1">02 · Borders only</li><li data-step="2">03 · Land shape only</li></ol><p id="cp-flow-stage" class="cp-stage-note"></p><button class="secondary" id="cp-restore">Restore rivers + borders</button><p class="cp-tradeoff">Context fades after each attempt, not after demonstrated mastery. Restoring clues is recorded; none of these repetitions earns retention credit.</p></aside><div class="cp-track-main"><section class="cp-map-stage">${mapTools()}</section><div class="cp-track-question">${questionPanel()}</div></div></div>`;
}

export function VariantH() {
  return `<div class="cp-tracks cp-linked-tracks"><aside class="cp-track-sidebar"><p class="cp-kicker">H / Overview + close-up</p><h2>Zoom in.<br>Stay oriented.</h2><p class="cp-premise">D's bordered imagery, with a regional overview that stays put while the main map moves.</p><nav aria-label="Geography track"><button data-track="countries"><b>01</b><span>Countries<small>Select inside a boundary</small></span></button><button data-track="cities"><b>02</b><span>Cities<small>Place a point · measure distance</small></span></button><button data-track="rivers"><b>03</b><span>Rivers<small>Select along a course</small></span></button></nav>${cityPicker()}<section class="cp-overview-card"><p class="eyebrow">Regional overview</p><div id="cp-overview" role="region" aria-label="Regional overview"></div><p>Green box = main-map viewport. No answer markers are shown here.</p></section></aside><div class="cp-track-main"><section class="cp-map-stage">${mapTools()}</section><div class="cp-track-question">${questionPanel()}</div></div></div>`;
}

export function VariantI() {
  return `<div class="cp-quiz-tabs"><header class="cp-quiz-tabs-header"><div><p class="cp-kicker">I / Persistent top tabs</p><h2>What do you want to practice?</h2></div><nav class="cp-quiz-tab-list" aria-label="Quiz type">${quizTypeButtons()}</nav></header><div class="cp-quiz-tabs-workspace"><section class="cp-map-stage">${mapTools()}</section><aside class="cp-quiz-sidebar"><p id="cp-current-quiz" class="cp-kicker"></p><p id="cp-quiz-description" class="cp-quiz-description"></p>${questionPanel()}<p class="cp-tradeoff">Switching quiz starts a fresh question. Your session results stay. The map keeps its borders.</p></aside></div></div>`;
}

export function VariantJ() {
  return `<div class="cp-quiz-rail"><nav class="cp-quiz-rail-nav" aria-label="Quiz type"><p>QUIZ</p>${quizTypeButtons()}<small>J / Side rail</small></nav><div class="cp-track-main"><section class="cp-map-stage">${mapTools()}</section><div class="cp-quiz-dock"><div class="cp-quiz-dock-heading"><p id="cp-current-quiz" class="cp-kicker"></p><p id="cp-quiz-description" class="cp-quiz-description"></p></div><div class="cp-track-question">${questionPanel()}</div><p class="cp-switch-note">Switch quizzes in the rail. New question; same session results. Borders stay on.</p></div></div></div>`;
}

export function VariantK() {
  return `<div class="cp-original">
    <div id="cp-map" role="region" aria-label="Practice map"></div>
    <div class="map-shade" aria-hidden="true"></div>
    <div class="practice-toolbar"><div class="learning-modes"><span id="cp-current-quiz"></span><button id="cp-change-quiz" class="secondary" aria-haspopup="dialog">Change quiz</button></div></div>
    <p id="cp-classic-progress" class="progress" aria-label="Practice results"></p>
    <div class="session-panel"><section id="session">
      <p class="eyebrow"><span class="live-dot" aria-hidden="true"></span><span id="cp-kind"></span></p>
      <p class="prompt">Where is</p><h1><span id="cp-name"></span><span class="accent">?</span></h1>
      <div class="location-tools"><button id="cp-reveal" class="secondary">Show location</button></div>
      <p id="cp-instruction"></p>
      <label class="cp-tolerance">City tolerance <select id="cp-tolerance"><option value="25">25 km · precise</option><option value="100">100 km · regional</option><option value="250">250 km · broad</option></select></label>
      <div class="answer-dock">
        <p id="cp-selection" class="selection-hint" aria-live="polite"></p>
        <div id="cp-feedback" role="status" aria-live="polite"></div>
        <button id="cp-check" class="primary" disabled>Check location <span>→</span></button>
        <button id="cp-next" class="primary" hidden>Next learning item <span>→</span></button>
      </div>
      <p id="cp-guidance"></p>
    </section></div>
    <button id="cp-world" class="secondary" aria-label="World view" title="World view"><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="7" stroke="currentColor"/><ellipse cx="10" cy="10" rx="3" ry="7" stroke="currentColor"/><path d="M3 10h14" stroke="currentColor"/></svg></button>
    <p id="cp-map-caption" class="map-caption"></p>
    <dialog id="cp-quiz-chooser" class="app-dialog" aria-labelledby="cp-chooser-title">
      <button id="cp-close-chooser" class="secondary dialog-close" aria-label="Close quiz chooser">Close</button>
      <header><h2 id="cp-chooser-title">Choose your quiz</h2><p>Switching starts a new question. Your session results stay.</p></header>
      <div class="cp-quiz-choice-grid">${quizTypeButtons()}</div>
    </dialog>
  </div>`;
}

function renderVariant(key: string) {
  cleanupSwitcher?.();
  mapSize.disconnect();
  overview?.remove();
  overview = undefined;
  viewport = undefined;
  map?.remove();
  variant = ['A','B','C','D','E','F','G','H','I','J','K'].includes(key) ? key : 'A';
  const url = new URL(location.href); url.searchParams.set('variant', variant); history.replaceState(null, '', url);
  index = 0; attempts = []; track = quizNavigationVariants[variant] ? 'countries' : 'cities';
  detail = quizNavigationVariants[variant] ? quizMapDetails[track] : variant === 'A' || variant === 'E' ? 'outlines' : variant === 'D' || variant === 'H' ? 'detailed' : 'rivers';
  showBorders = !!borderVariants[variant];
  restoredContext = false;
  app.className = `city-prototype cp-variant-${variant}`;
  const renderers: Record<string, () => string> = {A:VariantA,B:VariantB,C:VariantC,D:VariantD,E:VariantE,F:VariantF,G:VariantG,H:VariantH,I:VariantI,J:VariantJ,K:VariantK};
  app.innerHTML = `<header class="${variant === 'K' ? 'app-header' : 'cp-header'}"><a class="brand" href="/?variant=${variant}" aria-label="Atlas prototype home"><svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><circle cx="16" cy="16" r="13" stroke="currentColor"/><path d="m21 10-3 9-8 3 3-9 8-3Z" stroke="currentColor"/></svg><span>Atlas<span class="brand-subtitle">A little further, every day.</span></span></a>${variant === 'K' ? '' : `<div class="cp-header-context">${variant === 'A' ? 'Recommended practice / Mixed sample' : trackVariants[variant] ? 'Custom practice / Geography tracks' : 'Custom practice / Learning-flow experiments'}</div><span class="cp-memory">Prototype · nothing saved</span>`}</header><div class="cp-body">${renderers[variant]()}</div><footer class="cp-observatory">${variant === 'K' ? '<details id="cp-state"><summary>Prototype · nothing saved</summary><p id="cp-results"></p><button id="cp-reset" class="secondary">Reset experiment</button><pre></pre></details>' : '<span id="cp-results"></span><button id="cp-reset">Reset experiment</button><details id="cp-state"><summary>Live experiment state</summary><pre></pre></details>'}</footer>`;
  map = L.map('cp-map', { minZoom: 1, maxZoom: 14, worldCopyJump: true, zoomControl: false }).setView([20,0], 2);
  L.control.zoom({ position: 'topright' }).addTo(map);
  L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
  map.attributionControl.addAttribution('Natural Earth 5.1.2 · Public domain');
  layers = L.layerGroup().addTo(map);
  marks = L.layerGroup().addTo(map);
  borderLayer = undefined;
  if (borderVariants[variant]) {
    // Context sits above tiles and land fill, but below answer markers and paths.
    map.createPane('prototypeBase').style.zIndex = '300';
    map.createPane('prototypeBorders').style.zIndex = '350';
    const borderStyle: L.PolylineOptions = { pane:'prototypeBorders', smoothFactor:0, color:'#ffe7a3', weight:1.2, opacity:0.95, fill:false };
    borderLayer = L.geoJSON(countries, { style:borderStyle, interactive:false }).addTo(map);
  }
  if (variant === 'B' || variant === 'H') {
    overview = L.map('cp-overview', { zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, touchZoom: false, keyboard: false, boxZoom: false }).setView([20,0], 1);
    L.geoJSON(countries, { style: { color:'#71868c', weight:0.6, fillColor:'#334c57', fillOpacity:1 }, interactive:false }).addTo(overview);
    viewport = L.rectangle(map.getBounds(), { color:'#d6ed8b', weight:1, fillOpacity:0.12, interactive:false }).addTo(overview);
  }
  map.on('click', (event: L.LeafletMouseEvent) => {
    if (answered) return;
    selection = L.latLng(event.latlng.lat, ((event.latlng.lng+180)%360+360)%360-180);
    marks.clearLayers();
    L.circleMarker(selection, { radius:7, color:'#ffffff', weight:2, fillColor:'#dfb17d', fillOpacity:1 }).addTo(marks);
    document.querySelector<HTMLButtonElement>('#cp-check')!.disabled = false;
    document.querySelector('#cp-selection')!.textContent = `Your pin: ${selection.lat.toFixed(2)}°, ${selection.lng.toFixed(2)}° · click again to move`;
    surfaceState();
  });
  map.on('moveend zoomend', () => { viewport?.setBounds(map.getBounds()); surfaceState(); });
  document.querySelector<HTMLSelectElement>('#cp-detail')?.addEventListener('change', event => { detail = (event.target as HTMLSelectElement).value as Detail; drawBase(); surfaceState(); });
  document.querySelector<HTMLInputElement>('#cp-borders')?.addEventListener('change', event => {
    showBorders = (event.target as HTMLInputElement).checked;
    if (showBorders) borderLayer!.addTo(map); else borderLayer!.remove();
    surfaceState();
  });
  document.querySelector<HTMLSelectElement>('#cp-tolerance')!.onchange = event => { tolerance = Number((event.target as HTMLSelectElement).value); renderQuestionText(); surfaceState(); };
  document.querySelector('#cp-world')!.addEventListener('click',()=>map.setView([20,0],variant === 'K' && map.getSize().x <= 700 ? 1 : 2));
  document.querySelector('#cp-region')?.addEventListener('click',()=>{ assisted = true; fitRegion(); renderQuestionText(); surfaceState(); });
  document.querySelector('#cp-check')!.addEventListener('click',()=>submit(false));
  document.querySelector('#cp-reveal')!.addEventListener('click',()=>submit(true));
  document.querySelector('#cp-next')!.addEventListener('click',()=>{ index++; beginQuestion(); });
  document.querySelector('#cp-reset')!.addEventListener('click',()=>renderVariant(variant));
  document.querySelector<HTMLSelectElement>('#cp-city')?.addEventListener('change',event=>{
    index = Number((event.target as HTMLSelectElement).value) * (variant === 'E' ? 2 : variant === 'G' ? 3 : 1);
    beginQuestion();
  });
  document.querySelector('#cp-restore')?.addEventListener('click', () => {
    restoredContext = true; detail = 'rivers'; showBorders = true;
    borderLayer!.addTo(map);
    drawBase(); renderQuestionText(); surfaceState();
  });
  document.querySelectorAll<HTMLButtonElement>('[data-track]').forEach(button=>button.onclick=()=>{
    const chosen = button.dataset.track as Track;
    if (quizNavigationVariants[variant]) {
      document.querySelector<HTMLDialogElement>('#cp-quiz-chooser')?.close();
      if (chosen === track) { surfaceState(); return; }
      index = 0;
    }
    track = chosen;
    detail = quizNavigationVariants[variant] ? quizMapDetails[track] : variant === 'D' || variant === 'H' ? 'detailed' : track === 'countries' ? 'outlines' : 'rivers';
    beginQuestion();
  });
  const state = document.querySelector<HTMLDetailsElement>('#cp-state')!;
  state.open = stateOpen;
  state.ontoggle = () => { stateOpen = state.open; };
  const switcher = PrototypeSwitcher(variant, renderVariant);
  if ('element' in switcher) { app.append(switcher.element); cleanupSwitcher = switcher.dispose; }
  beginQuestion();
  mapSize.observe(map.getContainer());
  if (overview) mapSize.observe(overview.getContainer());
  const chooser = document.querySelector<HTMLDialogElement>('#cp-quiz-chooser');
  if (chooser) {
    document.querySelector('#cp-change-quiz')!.addEventListener('click', () => { chooser.showModal(); surfaceState(); });
    document.querySelector('#cp-close-chooser')!.addEventListener('click', () => chooser.close());
    chooser.addEventListener('close', () => { document.querySelector<HTMLButtonElement>('#cp-change-quiz')?.focus(); surfaceState(); });
  }
}

function drawBase() {
  layers.clearLayers(); tileErrors = 0; tilesLoaded = 0;
  const detailPicker = document.querySelector<HTMLSelectElement>('#cp-detail');
  if (detailPicker) detailPicker.value = detail;
  if (quizNavigationVariants[variant]) {
    // Country and water maps retain the production map's subdued border treatment.
    borderLayer!.setStyle({ color:detail === 'detailed' ? '#ffe7a3' : '#63777f', weight:detail === 'detailed' ? 1.2 : 0.8, opacity:detail === 'detailed' ? 0.95 : 1 });
  }
  const boundaryStyle: L.PolylineOptions = { pane:borderVariants[variant] ? 'prototypeBase' : 'overlayPane', smoothFactor:0, color:'#63777f', weight:borderVariants[variant] ? 0 : 0.8, fillColor:'#334c57', fillOpacity:1 };
  if (detail !== 'detailed') L.geoJSON(countries, { style: boundaryStyle, interactive:false }).addTo(layers);
  if (detail === 'rivers') L.geoJSON(rivers, { style:{ color:'#71b9d9', weight:1.5, opacity:0.8 }, interactive:false }).addTo(layers);
  if (detail === 'detailed') {
    // Imagery adds real local detail without revealing city names. Provider choice is not validated.
    const tiles = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom:14, attribution:'Imagery &copy; <a href="https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9">Esri</a>, Maxar, Earthstar Geographics, GIS user community',
    }).addTo(layers);
    tiles.on('tileerror',()=>{ tileErrors++; surfaceState(); });
    tiles.on('tileload',()=>{ tilesLoaded++; surfaceState(); });
  }
}
function mapPadding(padding: number): L.FitBoundsOptions {
  if (variant !== 'K') return { padding:[padding,padding] };
  const panel = document.querySelector<HTMLElement>('.session-panel')!.getBoundingClientRect();
  return map.getSize().x <= 700
    ? { paddingTopLeft:[20,130], paddingBottomRight:[20,map.getSize().y - panel.top + 20] }
    : { paddingTopLeft:[panel.right + 35,100], paddingBottomRight:[70,110] };
}
function fitRegion() {
  const q = question();
  const bounds: L.LatLngBoundsExpression = variant === 'F' ? circuitBounds : q.kind === 'rivers' ? [[-4,24],[33,40]] : countryViews[q.countryId];
  map.fitBounds(bounds, { ...mapPadding(35), animate:false });
  overview?.fitBounds(bounds, { padding:[20,20], animate:false });
}
function beginQuestion() {
  selection = undefined; answered = false;
  const q = question();
  restoredContext = false;
  if (variant === 'G') {
    detail = index % 3 === 0 ? 'rivers' : index % 3 === 1 ? 'outlines' : 'land';
    showBorders = index % 3 < 2;
    if (showBorders) borderLayer!.addTo(map); else borderLayer!.remove();
  }
  if (variant === 'E') detail = q.kind === 'countries' ? 'outlines' : 'rivers';
  assisted = variant === 'B' || (trackVariants[variant] && track !== 'countries')
    || (variant === 'E' && q.kind === 'cities') || variant === 'F' || variant === 'G';
  marks.clearLayers();
  document.querySelector('#cp-feedback')!.innerHTML = '';
  document.querySelector('#cp-selection')!.textContent = 'Click the map to place your answer.';
  document.querySelector<HTMLButtonElement>('#cp-check')!.disabled = true;
  document.querySelector<HTMLButtonElement>('#cp-check')!.hidden = false;
  document.querySelector<HTMLButtonElement>('#cp-reveal')!.hidden = false;
  document.querySelector<HTMLButtonElement>('#cp-next')!.hidden = true;
  document.querySelector<HTMLSelectElement>('#cp-tolerance')!.disabled = false;
  const picker = document.querySelector<HTMLSelectElement>('#cp-city');
  if (picker) { picker.value = String(data.cities.indexOf(q.city)); picker.closest<HTMLElement>('label')!.hidden = trackVariants[variant] && track === 'rivers'; }
  drawBase();
  renderQuestionText();
  if (variant === 'F') {
    if (index === 0) fitRegion();
  } else if (assisted) {
    fitRegion();
  } else {
    map.setView([20,0], map.getSize().x <= 700 ? 1 : 2, {animate:false});
    overview?.setView([20,0],1,{animate:false});
  }
  document.querySelectorAll<HTMLButtonElement>('[data-track]').forEach(button=>button.setAttribute('aria-pressed', String(button.dataset.track===track)));
  surfaceState();
}
function renderQuestionText() {
  const q = question();
  if (quizNavigationVariants[variant]) {
    const quiz = quizTypes.find(type => type.track === q.kind)!;
    document.querySelector('#cp-current-quiz')!.textContent = `${quiz.label} quiz`;
    const description = document.querySelector('#cp-quiz-description');
    if (description) description.textContent = quiz.description;
    const context = document.querySelector('#cp-quiz-map-context');
    if (context) context.textContent = q.kind === 'countries' ? 'Classic country map' : q.kind === 'cities' ? 'City detail · no labels' : 'Classic map + water features';
  }
  document.querySelector('#cp-kind')!.textContent = `${q.kind === 'cities' ? 'Major city' : q.kind === 'countries' ? 'Country' : 'Water feature'} · name-to-location · ${index+1}`;
  document.querySelector('#cp-name')!.textContent = q.name + (variant === 'K' ? '' : '?');
  document.querySelectorAll('.cp-queue span').forEach((item, position) => item.classList.toggle('active', position === index % 3));
  document.querySelector('#cp-instruction')!.textContent = q.kind === 'cities'
    ? `Place a point within ${tolerance} km of the city centre. Zoom as far as you need.`
    : q.kind === 'countries' ? 'Select anywhere inside the country boundary.' : 'Select anywhere along the Nile. Within 80 km of its mapped course counts in this experiment.';
  document.querySelector<HTMLElement>('.cp-tolerance')!.hidden = q.kind !== 'cities';
  document.querySelector<HTMLSelectElement>('#cp-tolerance')!.value = String(tolerance);
  document.querySelector('#cp-guidance')!.textContent = assisted ? `Regional context given${q.kind === 'rivers' ? '' : ` · ${q.city.country}`} · guided practice, not retention.` : 'World start · no location hint used. Map detail changes context, not the distance rule.';
  document.querySelector<HTMLElement>('#cp-guidance')!.hidden = variant === 'K' && !assisted;
  const flowStage = document.querySelector('#cp-flow-stage');
  const stageIndex = variant === 'E' ? index % 2 : variant === 'F' ? index % circuit.length : index % 3;
  document.querySelectorAll<HTMLElement>('[data-step]').forEach(step => {
    const active = Number(step.dataset.step) === stageIndex;
    step.classList.toggle('active', active);
    if (active) step.setAttribute('aria-current', 'step'); else step.removeAttribute('aria-current');
  });
  if (variant === 'E') {
    flowStage!.textContent = `Pair ${Math.floor(index/2)+1} · step ${stageIndex+1} of 2`;
    document.querySelector('#cp-next')!.textContent = stageIndex === 0 ? 'Zoom in to the city →' : 'Next country → city pair';
  }
  if (variant === 'F') {
    flowStage!.textContent = `Circuit ${Math.floor(index/circuit.length)+1} · stop ${stageIndex+1} of ${circuit.length}`;
    document.querySelector('#cp-next')!.textContent = stageIndex === circuit.length-1 ? 'Start another circuit →' : 'Next stop, same map →';
    document.querySelector('#cp-guidance')!.textContent = 'Fixed regional practice · mixed learning items · regional context given, not retention.';
    document.querySelector('#cp-relationship')!.textContent = answered ? circuit[stageIndex].relationship : 'Answer to reveal how this place fits the region.';
  }
  if (variant === 'G') {
    flowStage!.textContent = `Attempt ${stageIndex+1} of 3 · ${restoredContext ? 'full context restored' : ['rivers + borders','borders only','land shape only'][stageIndex]}`;
    document.querySelector('#cp-next')!.textContent = stageIndex === 2 ? 'Next city, restore full context →' : 'Try again with fewer clues →';
    document.querySelector('#cp-guidance')!.textContent = `Regional frame given · immediate repetition, not retention${restoredContext ? ' · clues restored for this attempt' : ''}.`;
    const restore = document.querySelector<HTMLButtonElement>('#cp-restore')!;
    restore.hidden = stageIndex === 0 || restoredContext;
    restore.disabled = answered;
  }
}
function riverPoint(point: L.LatLng): L.LatLng {
  // Nearest point on each segment in a local equirectangular projection, then geodesic distance.
  // Sufficient for this 1:50m, 80 km-tolerance sample; not a production river scorer.
  let best = L.latLng(0,0); let distance = Infinity;
  const scale = Math.cos(point.lat*Math.PI/180);
  for (const f of rivers.features.filter(f=>f.properties?.name==='Nile')) {
    const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const line of lines) for (let n=1;n<line.length;n++) {
      const a=line[n-1], b=line[n];
      const dx=(b[0]-a[0])*scale, dy=b[1]-a[1];
      const t=Math.max(0,Math.min(1,(((point.lng-a[0])*scale)*dx+(point.lat-a[1])*dy)/(dx*dx+dy*dy || 1)));
      const candidate=L.latLng(a[1]+t*dy,a[0]+t*(b[0]-a[0]));
      const d=point.distanceTo(candidate);
      if (d<distance) { distance=d; best=candidate; }
    }
  }
  return best;
}
function submit(reveal: boolean) {
  if (answered || (!selection && !reveal)) return;
  const q = question();
  assisted ||= reveal;
  answered = true;
  const target = L.latLng(q.city.point[0],q.city.point[1]);
  let distanceKm: number | null = null;
  let correct = false;
  let answerBounds: L.LatLngBounds | undefined;
  if (q.kind === 'countries') {
    const country = countries.find(c=>c.properties.id===q.countryId)!;
    correct = !!selection && booleanPointInPolygon([selection.lng,selection.lat],country);
    L.geoJSON(country,{style:{color:'#d6ed8b',weight:2,fillOpacity:0.2},interactive:false}).addTo(marks);
  } else {
    const answer = q.kind === 'rivers' ? riverPoint(selection ?? L.latLng(30,31)) : target;
    if (selection) distanceKm = selection.distanceTo(answer)/1000;
    correct = distanceKm !== null && distanceKm <= (q.kind === 'rivers' ? 80 : tolerance);
    if (q.kind === 'rivers') {
      const nile: FeatureCollection<LineString | MultiLineString> = {type:'FeatureCollection',features:rivers.features.filter(f=>f.properties?.name==='Nile')};
      L.geoJSON(nile,{style:{color:'#d6ed8b',weight:4},interactive:false}).addTo(marks);
    } else {
      L.circle(answer,{radius:tolerance*1000,color:'#d6ed8b',weight:1,fillOpacity:0.1,interactive:false}).addTo(marks);
    }
    L.circleMarker(answer,{radius:5,color:'#d6ed8b',fillColor:'#d6ed8b',fillOpacity:1,interactive:false}).bindTooltip(q.name,{permanent:true,direction:'top'}).addTo(marks);
    if (selection) L.polyline([selection,answer],{color:'#dfb17d',dashArray:'5 6',weight:2,interactive:false}).addTo(marks);
    answerBounds = L.latLngBounds(selection ? [selection,answer] : [answer]).pad(0.3);
  }
  if (reveal) correct=false;
  attempts.push({name:q.name,kind:q.kind,distanceKm,correct,assisted,detail,borders:borderVariants[variant] ? showBorders : detail !== 'detailed',step:index,restoredContext});
  document.querySelector('#cp-feedback')!.innerHTML = `<strong>${reveal ? 'Location revealed' : correct ? 'Within the target' : 'Not quite'}${distanceKm !== null ? ` · ${Math.round(distanceKm)} km away` : ''}</strong><p>${q.kind==='cities' ? `${q.name} · ${q.city.country}${q.city.capital ? ' · national capital' : ' · major city, not the national capital'}. Green dot: canonical centre; green ring: ${tolerance} km tolerance.` : q.kind==='rivers' ? 'Green line: the mapped Nile course. The orange line joins your pin to the nearest sampled segment.' : 'Green area: the country boundary.'}</p><small>${assisted ? 'Guided practice' : 'Unassisted attempt'} · ${detail} context · no proficiency written</small>`;
  document.querySelector<HTMLButtonElement>('#cp-check')!.hidden = true;
  document.querySelector<HTMLButtonElement>('#cp-reveal')!.hidden = true;
  document.querySelector<HTMLButtonElement>('#cp-next')!.hidden = false;
  document.querySelector<HTMLSelectElement>('#cp-tolerance')!.disabled = true;
  renderQuestionText();
  if (variant !== 'F') {
    if (answerBounds) map.fitBounds(answerBounds, { ...mapPadding(65), maxZoom:q.kind==='rivers'?5:7, animate:false });
    else if (reveal || variant === 'E') fitRegion();
  }
  surfaceState();
}
function surfaceState() {
  const q=question();
  const state = {variant,track:q.kind,question:q.name,questionDirection:'name-to-location',mapDetail:detail,borders:borderVariants[variant] ? showBorders : detail !== 'detailed',step:index,pairStage:variant==='E'?index%2+1:null,circuitStop:variant==='F'?index%circuit.length+1:null,fadingStage:variant==='G'?index%3+1:null,restoredContext,overview:overview?{center:overview.getCenter(),zoom:overview.getZoom(),viewport:map.getBounds()}:null,zoom:Number(map.getZoom().toFixed(2)),center:map.getCenter(),toleranceKm:q.kind==='cities'?tolerance:q.kind==='rivers'?80:null,assisted,answered,selection:selection??null,tilesLoaded,tileErrors,attempts,persistence:'none',scheduler:'not connected'};
  const quizChooserOpen = document.querySelector<HTMLDialogElement>('#cp-quiz-chooser')?.open ?? false;
  document.querySelector('#cp-state pre')!.textContent = JSON.stringify({...state,quizChooserOpen},null,2);
  document.querySelector('#cp-results')!.textContent = `${attempts.length} answered · ${attempts.filter(a=>a.correct).length} within target · ${attempts.filter(a=>a.assisted).length} guided`;
  const progress = document.querySelector('#cp-classic-progress');
  if (progress) progress.innerHTML = `<span class="progress-stat"><span>${attempts.length}</span> answered</span><span class="progress-divider">·</span><span class="progress-stat"><span id="correct-count">${attempts.filter(a=>a.correct).length}</span> correct</span>`;
  const lab=document.querySelector('#cp-lab-progress');
  if(lab) lab.innerHTML=`<b>${attempts.length}</b><span>city attempts this experiment</span><small>Separate city test; no mixed queue.</small>`;
  const caption = document.querySelector('#cp-map-caption')!;
  if (variant === 'K') {
    caption.textContent = `${detail === 'detailed' ? 'City detail · no labels' : detail === 'rivers' ? 'Water features' : 'World map'} · country borders${tileErrors ? ` · ${tileErrors} imagery tile failures` : ''}`;
  } else {
    caption.textContent = detail==='detailed' ? `Satellite imagery · no labels · urban footprints are visual hints · ${tileErrors ? `${tileErrors} tile failures: detail may be incomplete` : tilesLoaded ? 'tiles loaded' : 'loading online tiles…'}` : detail==='land' ? 'Land shape only · no rivers or internal borders · regional frame still given' : detail==='rivers' ? '1:50m outlines + rivers · no streets or city labels · works offline' : 'Current 1:50m country geometry · zoom adds no new detail · works offline';
    if (borderVariants[variant]) caption.textContent += showBorders ? ' · country borders ON (1:50m)' : ' · country borders OFF';
  }
  console.debug('[city prototype]',state);
}
renderVariant(new URLSearchParams(location.search).get('variant') ?? 'A');
