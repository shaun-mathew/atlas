// THROWAWAY: Three city-testing variants on /?variant=A|B|C.
// Question: one learning flow, a separate city test, or geography tracks—and what map detail is enough?
// No accounts, scheduling, persistence, or production assessment policy. Thresholds are experimental.
import L from 'leaflet';
import type { FeatureCollection, MultiLineString, LineString } from 'geojson';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import 'leaflet/dist/leaflet.css';
import './style.css';
import './city-prototype.css';
import { countries } from './geography';
import data from './data/city-prototype.json';
import { PrototypeSwitcher } from './prototype-switcher';

type Track = 'countries' | 'cities' | 'rivers';
type Detail = 'outlines' | 'rivers' | 'detailed';
type City = typeof data.cities[number];
type Question = { kind: Track; name: string; city: City; countryId: string };
type Attempt = { name: string; kind: Track; distanceKm: number | null; correct: boolean; assisted: boolean; detail: Detail };
const app = document.querySelector<HTMLElement>('#app')!;
const rivers = data.rivers as FeatureCollection<LineString | MultiLineString>;
const countryViews: Record<string, L.LatLngBoundsExpression> = {
  FRA: [[41, -5], [51.5, 10]], EGY: [[21.5, 24], [32, 37]], JPN: [[30, 128], [46, 146]],
  BRA: [[-34, -74], [6, -34]], KEN: [[-5, 33], [5, 42]], AUS: [[-44, 112], [-10, 154]],
};
let variant = 'A';
let track: Track = 'cities';
let detail: Detail = 'outlines';
let index = 0;
let tolerance = 100;
let assisted = false;
let answered = false;
let selection: L.LatLng | undefined;
let attempts: Attempt[] = [];
let map: L.Map;
let overview: L.Map | undefined;
let cleanupSwitcher: (() => void) | undefined;
let layers: L.LayerGroup;
let marks: L.LayerGroup;
let viewport: L.Rectangle | undefined;
let tileErrors = 0;
let tilesLoaded = 0;
let stateOpen = false;
const mapSize = new ResizeObserver(() => {
  map.invalidateSize({ pan:false });
  overview?.invalidateSize({ pan:false });
});

function question(): Question {
  const city = data.cities[index % data.cities.length];
  const kind = variant === 'A' ? (index % 3 === 1 ? 'countries' : 'cities') : variant === 'B' ? 'cities' : track;
  return { kind, name: kind === 'cities' ? city.name : kind === 'countries' ? city.country : 'Nile', city, countryId: city.countryId };
}
const mapTools = () => `<div class="cp-map-tools"><label>Map detail<select id="cp-detail"><option value="outlines">Current · country outlines</option><option value="rivers">Physical · outlines + rivers</option><option value="detailed">Local · satellite, no labels</option></select></label><button class="secondary" id="cp-world">World</button><button class="secondary" id="cp-region">Regional hint</button></div><div id="cp-map" role="region" aria-label="Practice map"></div><div class="cp-map-caption" id="cp-map-caption"></div>`;
const questionPanel = () => `<section class="cp-question"><p class="eyebrow" id="cp-kind"></p><p class="prompt">Where is</p><h1 id="cp-name"></h1><p id="cp-instruction"></p><label class="cp-tolerance">City tolerance <select id="cp-tolerance"><option value="25">25 km · precise</option><option value="100">100 km · regional</option><option value="250">250 km · broad</option></select></label><div class="cp-answer"><p id="cp-selection" aria-live="polite">Click the map to place your answer.</p><div id="cp-feedback" role="status" aria-live="polite"></div><button id="cp-check" class="primary" disabled>Check location <span>→</span></button><button id="cp-next" class="primary" hidden>Next learning item <span>→</span></button><button id="cp-reveal" class="secondary">Reveal & learn</button></div><p id="cp-guidance"></p></section>`;
const cityPicker = () => `<label class="cp-picker">Try a city<select id="cp-city">${data.cities.map((c,i)=>`<option value="${i}">${c.name} · ${c.country}</option>`).join('')}</select></label>`;

export function VariantA() {
  return `<div class="cp-integrated"><aside><p class="cp-kicker">A / One continuous session</p><h2>Keep the world together.</h2><p class="cp-premise">Countries and cities share a practice queue. You decide when to zoom; the world stays the starting point.</p><div class="cp-queue"><span class="active">City</span><span>Country</span><span>City</span></div>${questionPanel()}<p class="cp-tradeoff">Tests the cost of switching scale between learning items. Individual skills would still keep separate proficiency.</p></aside><section class="cp-map-stage">${mapTools()}</section></div>`;
}
export function VariantB() {
  return `<div class="cp-lab"><section class="cp-lab-heading"><div><p class="cp-kicker">B / Dedicated city test</p><h2>Think at city scale.</h2><p class="cp-premise">A regional overview beside a focused answer map. Country context is given, not recalled.</p></div>${cityPicker()}</section><div class="cp-lab-workspace"><aside class="cp-overview-panel"><p class="eyebrow">Regional overview · not an answer map</p><div id="cp-overview" role="region" aria-label="Regional overview"></div><p>Outlined box = answer-map viewport. Use the overview to keep your bearings as you zoom.</p><div class="cp-lab-progress" id="cp-lab-progress"></div></aside><section class="cp-map-stage">${mapTools()}</section></div><div class="cp-lab-answer">${questionPanel()}</div></div>`;
}
export function VariantC() {
  return `<div class="cp-tracks"><aside class="cp-track-sidebar"><p class="cp-kicker">C / One home, distinct tracks</p><h2>Choose your geography.</h2><p class="cp-premise">Keep one practice home, but let each entity type choose its map and answer rules.</p><nav aria-label="Geography track"><button data-track="countries"><b>01</b><span>Countries<small>Select inside a boundary</small></span></button><button data-track="cities"><b>02</b><span>Cities<small>Place a point · measure distance</small></span></button><button data-track="rivers"><b>03</b><span>Rivers<small>Select along a course</small></span></button></nav>${cityPicker()}<p class="cp-tradeoff">Switching track keeps this prototype's answer history, but starts a fresh question. Rivers use a real Nile geometry sample.</p></aside><div class="cp-track-main"><section class="cp-map-stage">${mapTools()}</section><div class="cp-track-question">${questionPanel()}</div></div></div>`;
}

function renderVariant(key: string) {
  cleanupSwitcher?.();
  mapSize.disconnect();
  overview?.remove();
  overview = undefined;
  viewport = undefined;
  map?.remove();
  variant = ['A','B','C'].includes(key) ? key : 'A';
  const url = new URL(location.href); url.searchParams.set('variant', variant); history.replaceState(null, '', url);
  index = 0; attempts = []; track = 'cities';
  detail = variant === 'A' ? 'outlines' : 'rivers';
  app.className = `city-prototype cp-variant-${variant}`;
  app.innerHTML = `<header class="cp-header"><a class="brand" href="/?variant=${variant}" aria-label="Atlas prototype home"><svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><circle cx="16" cy="16" r="13" stroke="currentColor"/><path d="m21 10-3 9-8 3 3-9 8-3Z" stroke="currentColor"/></svg><span>Atlas<span class="brand-subtitle">A little further, every day.</span></span></a><div class="cp-header-context">${variant === 'A' ? 'Recommended practice / Mixed sample' : variant === 'B' ? 'Custom practice / Major cities' : 'Custom practice / Geography tracks'}</div><span class="cp-memory">Prototype · nothing saved</span></header><div class="cp-body">${variant === 'A' ? VariantA() : variant === 'B' ? VariantB() : VariantC()}</div><footer class="cp-observatory"><span id="cp-results"></span><button id="cp-reset">Reset experiment</button><details id="cp-state"><summary>Live experiment state</summary><pre></pre></details></footer>`;
  map = L.map('cp-map', { minZoom: 1, maxZoom: 14, worldCopyJump: true, zoomControl: false }).setView([20,0], 2);
  L.control.zoom({ position: 'topright' }).addTo(map);
  L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
  map.attributionControl.addAttribution('Natural Earth 5.1.2 · Public domain');
  layers = L.layerGroup().addTo(map);
  marks = L.layerGroup().addTo(map);
  if (variant === 'B') {
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
  document.querySelector<HTMLSelectElement>('#cp-detail')!.onchange = event => { detail = (event.target as HTMLSelectElement).value as Detail; drawBase(); surfaceState(); };
  document.querySelector<HTMLSelectElement>('#cp-tolerance')!.onchange = event => { tolerance = Number((event.target as HTMLSelectElement).value); renderQuestionText(); surfaceState(); };
  document.querySelector('#cp-world')!.addEventListener('click',()=>map.setView([20,0],2));
  document.querySelector('#cp-region')!.addEventListener('click',()=>{ assisted = true; fitRegion(); renderQuestionText(); surfaceState(); });
  document.querySelector('#cp-check')!.addEventListener('click',()=>submit(false));
  document.querySelector('#cp-reveal')!.addEventListener('click',()=>submit(true));
  document.querySelector('#cp-next')!.addEventListener('click',()=>{ index++; beginQuestion(); });
  document.querySelector('#cp-reset')!.addEventListener('click',()=>renderVariant(variant));
  document.querySelector<HTMLSelectElement>('#cp-city')?.addEventListener('change',event=>{ index = Number((event.target as HTMLSelectElement).value); beginQuestion(); });
  document.querySelectorAll<HTMLButtonElement>('[data-track]').forEach(button=>button.onclick=()=>{
    track = button.dataset.track as Track;
    detail = track === 'countries' ? 'outlines' : 'rivers';
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
}

function drawBase() {
  layers.clearLayers(); tileErrors = 0; tilesLoaded = 0;
  document.querySelector<HTMLSelectElement>('#cp-detail')!.value = detail;
  const boundaryStyle: L.PolylineOptions = { smoothFactor:0, color:'#63777f', weight:0.8, fillColor:'#334c57', fillOpacity:1 };
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
function fitRegion() {
  const q = question();
  const bounds: L.LatLngBoundsExpression = q.kind === 'rivers' ? [[-4,24],[33,40]] : countryViews[q.countryId];
  map.fitBounds(bounds, { padding:[35,35], animate:false });
  overview?.fitBounds(bounds, { padding:[20,20], animate:false });
}
function beginQuestion() {
  selection = undefined; answered = false;
  assisted = variant === 'B' || (variant === 'C' && track !== 'countries');
  marks.clearLayers();
  document.querySelector('#cp-feedback')!.innerHTML = '';
  document.querySelector('#cp-selection')!.textContent = 'Click the map to place your answer.';
  document.querySelector<HTMLButtonElement>('#cp-check')!.disabled = true;
  document.querySelector<HTMLButtonElement>('#cp-check')!.hidden = false;
  document.querySelector<HTMLButtonElement>('#cp-reveal')!.hidden = false;
  document.querySelector<HTMLButtonElement>('#cp-next')!.hidden = true;
  document.querySelector<HTMLSelectElement>('#cp-tolerance')!.disabled = false;
  const picker = document.querySelector<HTMLSelectElement>('#cp-city');
  if (picker) { picker.value = String(index % data.cities.length); picker.closest<HTMLElement>('label')!.hidden = variant === 'C' && track === 'rivers'; }
  drawBase();
  if (assisted) fitRegion(); else map.setView([20,0],2, {animate:false});
  document.querySelectorAll<HTMLButtonElement>('[data-track]').forEach(button=>button.setAttribute('aria-pressed', String(button.dataset.track===track)));
  renderQuestionText(); surfaceState();
}
function renderQuestionText() {
  const q = question();
  document.querySelector('#cp-kind')!.textContent = `${q.kind === 'cities' ? 'Major city' : q.kind === 'countries' ? 'Country' : 'Water feature'} · name-to-location · ${index+1}`;
  document.querySelector('#cp-name')!.textContent = q.name + '?';
  document.querySelectorAll('.cp-queue span').forEach((item, position) => item.classList.toggle('active', position === index % 3));
  document.querySelector('#cp-instruction')!.textContent = q.kind === 'cities'
    ? `Place a point within ${tolerance} km of the city centre. Zoom as far as you need.`
    : q.kind === 'countries' ? 'Select anywhere inside the country boundary.' : 'Select anywhere along the Nile. Within 80 km of its mapped course counts in this experiment.';
  document.querySelector<HTMLElement>('.cp-tolerance')!.hidden = q.kind !== 'cities';
  document.querySelector<HTMLSelectElement>('#cp-tolerance')!.value = String(tolerance);
  document.querySelector('#cp-guidance')!.textContent = assisted ? `Regional context given${q.kind === 'rivers' ? '' : ` · ${q.city.country}`} · guided practice, not retention.` : 'World start · no location hint used. Map detail changes context, not the distance rule.';
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
  if (q.kind === 'countries') {
    const country = countries.find(c=>c.properties.id===q.countryId)!;
    correct = !!selection && booleanPointInPolygon([selection.lng,selection.lat],country);
    L.geoJSON(country,{style:{color:'#d6ed8b',weight:2,fillOpacity:0.2},interactive:false}).addTo(marks);
    if (reveal) fitRegion();
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
    map.fitBounds(L.latLngBounds(selection ? [selection,answer] : [answer]).pad(0.3), {padding:[65,65],maxZoom:q.kind==='rivers'?5:7,animate:false});
  }
  if (reveal) correct=false;
  attempts.push({name:q.name,kind:q.kind,distanceKm,correct,assisted,detail});
  document.querySelector('#cp-feedback')!.innerHTML = `<strong>${reveal ? 'Location revealed' : correct ? 'Within the target' : 'Not quite'}${distanceKm !== null ? ` · ${Math.round(distanceKm)} km away` : ''}</strong><p>${q.kind==='cities' ? `${q.name} · ${q.city.country}${q.city.capital ? ' · national capital' : ' · major city, not the national capital'}. Green dot: canonical centre; green ring: ${tolerance} km tolerance.` : q.kind==='rivers' ? 'Green line: the mapped Nile course. The orange line joins your pin to the nearest sampled segment.' : 'Green area: the country boundary.'}</p><small>${assisted ? 'Guided practice' : 'Unassisted attempt'} · ${detail} context · no proficiency written</small>`;
  document.querySelector<HTMLButtonElement>('#cp-check')!.hidden = true;
  document.querySelector<HTMLButtonElement>('#cp-reveal')!.hidden = true;
  document.querySelector<HTMLButtonElement>('#cp-next')!.hidden = false;
  document.querySelector<HTMLSelectElement>('#cp-tolerance')!.disabled = true;
  renderQuestionText(); surfaceState();
}
function surfaceState() {
  const q=question();
  const state = {variant,track:q.kind,question:q.name,questionDirection:'name-to-location',mapDetail:detail,zoom:Number(map.getZoom().toFixed(2)),center:map.getCenter(),toleranceKm:q.kind==='cities'?tolerance:q.kind==='rivers'?80:null,assisted,answered,selection:selection??null,tilesLoaded,tileErrors,attempts,persistence:'none',scheduler:'not connected'};
  document.querySelector('#cp-state pre')!.textContent = JSON.stringify(state,null,2);
  document.querySelector('#cp-results')!.textContent = `${attempts.length} answered · ${attempts.filter(a=>a.correct).length} within target · ${attempts.filter(a=>a.assisted).length} guided`;
  const lab=document.querySelector('#cp-lab-progress');
  if(lab) lab.innerHTML=`<b>${attempts.length}</b><span>city attempts this experiment</span><small>Separate city test; no mixed queue.</small>`;
  document.querySelector('#cp-map-caption')!.textContent = detail==='detailed' ? `Satellite imagery · no labels · urban footprints are visual hints · ${tileErrors ? `${tileErrors} tile failures: detail may be incomplete` : tilesLoaded ? 'tiles loaded' : 'loading online tiles…'}` : detail==='rivers' ? '1:50m outlines + rivers · no streets or city labels · works offline' : 'Current 1:50m country geometry · zoom adds no new detail · works offline';
  console.debug('[city prototype]',state);
}
renderVariant(new URLSearchParams(location.search).get('variant') ?? 'A');
