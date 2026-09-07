import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './style.css';
import { countries, type Country } from './geography';
import { GuestSession } from './session';

const app = document.querySelector<HTMLElement>('#app')!;
app.innerHTML = `
  <div id="map" role="region" aria-label="World map"></div>
  <div class="map-shade" aria-hidden="true"></div>
  <header class="app-header">
    <a class="brand" href="/" aria-label="Atlas Practice">
      <svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><circle cx="16" cy="16" r="13" stroke="currentColor" stroke-width="1.2"/><path d="m21 10-3 9-8 3 3-9 8-3Z" stroke="currentColor" stroke-width="1.2"/><path d="m21 10-8 3 5 6 3-9Z" fill="currentColor"/></svg>
      <span>Atlas<span class="brand-subtitle">A little further, every day.</span></span>
    </a>
    <div class="map-actions"><button id="reset-map" class="secondary" type="button"><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="7" stroke="currentColor"/><ellipse cx="10" cy="10" rx="3" ry="7" stroke="currentColor"/><path d="M3 10h14" stroke="currentColor"/></svg>World view</button><button id="map-info" class="secondary info-button" type="button" aria-label="Map coverage and tolerance">i</button></div>
  </header>
  <p id="progress" class="progress" aria-label="Practice results"><span id="answered-count">0</span> answered <span class="progress-divider">·</span> <span id="correct-count">0</span> correct</p>
  <div class="session-panel">
    <section id="welcome">
      <p class="eyebrow"><span class="live-dot" aria-hidden="true"></span> Guest practice</p>
      <h1>A world worth knowing<span class="accent">.</span></h1>
      <p class="instructions">Build your geographic knowledge, one country at a time. No account needed.</p>
      <div class="answer-dock"><button id="start" class="primary" type="button">Start country session <span aria-hidden="true">→</span></button><p class="local-note">Your progress stays in this browser.</p></div>
    </section>
    <section id="session" hidden>
      <p class="eyebrow"><span class="live-dot" aria-hidden="true"></span> Country practice <span id="question-number"></span></p>
      <p class="prompt">Where is</p>
      <h1><span id="country"></span><span class="accent">?</span></h1>
      <p class="instructions">Find it. Drop a pin. Trust your bearings.</p>
      <div class="answer-dock">
        <div id="feedback" role="status" aria-live="polite"></div>
        <button id="check" class="primary" type="button" disabled>Check location <span aria-hidden="true">→</span></button>
        <button id="next" class="primary" type="button" hidden>Next learning item <span aria-hidden="true">→</span></button>
      </div>
    </section>
    <p id="storage-notice" role="alert" hidden></p>
  </div>
  <span class="map-caption" aria-hidden="true">A world worth knowing</span>
  <dialog id="geography-policy" aria-labelledby="policy-title">
    <button id="close-policy" class="secondary" type="button">Close</button>
    <h2 id="policy-title">Map coverage & geographic tolerance</h2>
    <p>Points inside the target boundary or within 25 km are accepted, unless they fall inside another mapped country or territory.</p>
    <p>241 countries and territories, excluding Antarctica. Public-domain <a href="https://www.naturalearthdata.com/about/terms-of-use/">Natural Earth</a> 5.1.2, 1:50m Admin-0 boundaries, retrieved 7 September 2026.</p>
    <p>We use its de facto boundaries and mapped territories; inclusion does not imply political recognition. Small islands and borders are generalized. This is a fixed learning dataset, not a source of legal boundaries.</p>
    <p>Drag to explore, use + and − to zoom, and select a point before checking your answer. Guest progress is saved in this browser, not across devices. Clearing browser data removes that progress.</p>
  </dialog>`;

const session = new GuestSession();
const panel = document.querySelector<HTMLDivElement>('.session-panel')!;
const header = document.querySelector<HTMLElement>('.app-header')!;
const progress = document.querySelector<HTMLParagraphElement>('#progress')!;
const feedback = document.querySelector<HTMLDivElement>('#feedback')!;
const check = document.querySelector<HTMLButtonElement>('#check')!;
const next = document.querySelector<HTMLButtonElement>('#next')!;
const storageNotice = document.querySelector<HTMLParagraphElement>('#storage-notice')!;
const policy = document.querySelector<HTMLDialogElement>('#geography-policy')!;
let pendingPoint: L.LatLng | null = null;
let marker: L.CircleMarker | undefined;
let answerPolygon: L.Polygon | undefined;

const map = L.map('map', {
  minZoom: 1, maxZoom: 10, zoomControl: false, zoomAnimation: false,
  fadeAnimation: false, doubleClickZoom: false,
  maxBounds: [[-85, -180], [85, 180]], maxBoundsViscosity: 1,
}).setView([15, 0], app.clientWidth <= 700 ? 1 : 2);
L.control.zoom({ position: 'topright' }).addTo(map);
map.attributionControl.addAttribution('Natural Earth · Public domain');
const boundaries = L.geoJSON(countries, {
  style: { color: '#63777f', weight: 0.8, fillColor: '#334c57', fillOpacity: 1 },
}).addTo(map);

// A projected square grid stays aligned with the map while extending beyond
// geographic bounds to fill the entire canvas, including portrait viewports.
const grid = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
grid.classList.add('map-grid');
grid.setAttribute('aria-hidden', 'true');
const gridLines = document.createElementNS('http://www.w3.org/2000/svg', 'path');
grid.append(gridLines);
map.getContainer().append(grid);
function drawGrid() {
  const size = map.getSize();
  const bounds = map.getBounds();
  const segments: string[] = [];
  for (let longitude = Math.floor(bounds.getWest() / 30) * 30; longitude <= bounds.getEast(); longitude += 30) {
    segments.push(`M${map.latLngToContainerPoint([0, longitude]).x} 0V${size.y}`);
  }
  const spacing = L.CRS.EPSG3857.scale(map.getZoom()) / 12;
  const equator = map.latLngToContainerPoint([0, 0]).y;
  for (let y = ((equator % spacing) + spacing) % spacing; y <= size.y; y += spacing) {
    segments.push(`M0 ${Math.round(y)}H${size.x}`);
  }
  grid.setAttribute('viewBox', `0 0 ${size.x} ${size.y}`);
  gridLines.setAttribute('d', segments.join(''));
}
map.on('move zoom resize', drawGrid);
drawGrid();

function focusAnswer() {
  if (!answerPolygon) return;
  const canvas = map.getContainer().getBoundingClientRect();
  const overlay = panel.getBoundingClientRect();
  const top = Math.max(header.getBoundingClientRect().bottom, progress.getBoundingClientRect().bottom) - canvas.top + 24;
  map.fitBounds(answerPolygon.getBounds(), {
    paddingTopLeft: [canvas.width <= 700 ? 24 : overlay.right - canvas.left + 32, top],
    paddingBottomRight: [24, canvas.width <= 700 ? canvas.bottom - overlay.top + 24 : 32],
    maxZoom: 6, animate: false,
  });
}
map.on('resize', focusAnswer);

function renderQuestion() {
  document.querySelector<HTMLElement>('#welcome')!.hidden = session.started;
  document.querySelector<HTMLElement>('#session')!.hidden = !session.started;
  document.querySelector('#country')!.textContent = session.country.properties.name;
  document.querySelector('#question-number')!.textContent = `Q. ${String(session.cursor + 1).padStart(2, '0')}`;
  document.querySelector('#answered-count')!.textContent = String(session.attempts.length);
  document.querySelector('#correct-count')!.textContent = String(session.attempts.filter(attempt => attempt.correct).length);
  storageNotice.textContent = session.storageNotice;
  storageNotice.hidden = !session.storageNotice;
  boundaries.resetStyle();
  marker?.remove();
  marker = undefined;
  answerPolygon = undefined;
  pendingPoint = null;
  const answer = session.feedback;
  next.hidden = !answer;
  check.hidden = !!answer;
  check.disabled = true;
  feedback.className = 'selection-hint';
  if (!answer) {
    feedback.textContent = 'Tap the map to place your pin.';
    map.setView([15, 0], app.clientWidth <= 700 ? 1 : 2, { animate: false });
    return;
  }
  feedback.className = `feedback ${answer.correct ? 'correct' : 'incorrect'}`;
  const result = document.createElement('strong');
  result.textContent = answer.correct ? 'Correct — well placed.' : 'Not quite — take another look.';
  const explanation = document.createElement('span');
  explanation.textContent = `${session.country.properties.name} is highlighted on the map. ${answer.correct
    ? 'Your selection is within the accepted geographic tolerance.'
    : answer.selectedCountry ? `You selected ${answer.selectedCountry}.` : 'Your selection is outside the accepted geographic tolerance.'}`;
  feedback.replaceChildren(result, explanation);
  // Siachen Glacier is a disputed geographic area without its own country flag.
  if (session.country.properties.id !== 'KAS') {
    const flag = document.createElement('img');
    flag.className = 'country-flag';
    flag.src = new URL(`./flags/${session.country.properties.id}.svg`, document.baseURI).href;
    flag.alt = `Flag of ${session.country.properties.name}`;
    flag.width = 64;
    flag.height = 48;
    feedback.prepend(flag);
  }
  boundaries.eachLayer(layer => {
    const polygon = layer as L.Polygon & { feature: Country };
    if (polygon.feature.properties.id !== answer.countryId) return;
    polygon.setStyle({ color: '#e3f5b1', weight: 2, fillColor: '#a2c472' });
    polygon.bringToFront();
    answerPolygon = polygon;
  });
  marker = L.circleMarker([answer.latitude, answer.longitude], {
    radius: 7, weight: 3, color: '#111f2c', fillColor: answer.correct ? '#d6ef87' : '#ea947b', fillOpacity: 1, interactive: false,
  }).addTo(map);
  focusAnswer();
}

map.on('click', (event: L.LeafletMouseEvent) => {
  if (!session.started || session.feedback || Math.abs(event.latlng.lng) > 180 || Math.abs(event.latlng.lat) > 85) return;
  pendingPoint = event.latlng;
  if (marker) marker.setLatLng(pendingPoint);
  else marker = L.circleMarker(pendingPoint, { radius: 7, weight: 3, color: '#111f2c', fillColor: '#d6ef87', fillOpacity: 1, interactive: false }).addTo(map);
  feedback.textContent = `${Math.abs(pendingPoint.lat).toFixed(1)}° ${pendingPoint.lat >= 0 ? 'N' : 'S'} / ${Math.abs(pendingPoint.lng).toFixed(1)}° ${pendingPoint.lng >= 0 ? 'E' : 'W'}`;
  check.disabled = false;
});
document.querySelector('#start')!.addEventListener('click', () => {
  session.start();
  renderQuestion();
});
check.addEventListener('click', () => {
  if (!pendingPoint || session.feedback) return;
  session.answer(pendingPoint.lng, pendingPoint.lat);
  renderQuestion();
});
next.addEventListener('click', () => {
  session.next();
  renderQuestion();
});
document.querySelector('#reset-map')!.addEventListener('click', () => map.setView([15, 0], app.clientWidth <= 700 ? 1 : 2, { animate: false }));
document.querySelector('#map-info')!.addEventListener('click', () => policy.showModal());
document.querySelector('#close-policy')!.addEventListener('click', () => policy.close());
renderQuestion();
