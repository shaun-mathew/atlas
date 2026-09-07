import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './style.css';
import { countries, type Country } from './geography';
import { GuestSession } from './session';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <header><a class="brand" href="/">Atlas Practice</a><span class="guest-badge">Guest profile · No account needed</span></header>
  <p id="storage-notice" role="alert" hidden></p>
  <section id="welcome" class="welcome">
    <p class="eyebrow">A little practice. A wider world.</p>
    <h1>Put a name<br>on the map.</h1>
    <p>Build your geographic knowledge, one country at a time.<br>Find a country, choose its location, and learn from every answer.</p>
    <button id="start" class="primary">Start country session <span aria-hidden="true">→</span></button>
    <p class="muted">Your guest progress stays in this browser.</p>
  </section>
  <section id="session" hidden>
    <div class="question-row"><div><p class="eyebrow">Countries & territories · Name-to-location</p><h1 id="question"></h1></div><p id="progress" class="progress">0 answered · 0 correct</p></div>
    <p class="instructions">Select a point on the map. Drag to explore, or use + and − to zoom.</p>
    <div class="map-frame"><div id="map" role="region" aria-label="World map"></div><button id="reset-map" class="map-reset">World view</button></div>
    <div id="feedback" class="feedback" role="status" aria-live="polite">Choose a location to check your answer.</div>
    <button id="next" class="primary" hidden>Next learning item <span aria-hidden="true">→</span></button>
  </section>
  <footer>
    <p>Close counts: points inside the boundary or within 25 km are accepted, unless they fall inside another mapped country or territory.</p>
    <details><summary>Map coverage & geography policy</summary><p>241 countries and territories, excluding Antarctica. Public-domain <a href="https://www.naturalearthdata.com/about/terms-of-use/">Natural Earth</a> 5.1.2, 1:50m Admin-0 boundaries, retrieved 7 September 2026. We use its de facto boundaries and mapped territories; inclusion does not imply political recognition. Small islands and borders are generalized. This is a fixed learning dataset, not a source of legal boundaries.</p></details>
  </footer>`;

const session = new GuestSession();
let map: L.Map;
let boundaries: L.GeoJSON;
let selection: L.CircleMarker | undefined;
const question = document.querySelector<HTMLHeadingElement>('#question')!;
const feedback = document.querySelector<HTMLDivElement>('#feedback')!;
const storageNotice = document.querySelector<HTMLParagraphElement>('#storage-notice')!;

function renderStorageNotice() {
  storageNotice.textContent = session.storageNotice;
  storageNotice.hidden = !session.storageNotice;
}
const next = document.querySelector<HTMLButtonElement>('#next')!;

function renderQuestion() {
  renderStorageNotice();
  const country = session.country;
  question.textContent = `Find ${country.properties.name}`;
  document.querySelector('#progress')!.textContent = `${session.attempts.length} answered · ${session.attempts.filter(attempt => attempt.correct).length} correct`;
  boundaries.resetStyle();
  selection?.remove();
  const answer = session.feedback;
  next.hidden = !answer;
  feedback.className = 'feedback';
  if (!answer) {
    feedback.textContent = 'Choose a location to check your answer.';
    map.setView([15, 0], 2, { animate: false });
    return;
  }
  feedback.classList.add(answer.correct ? 'correct' : 'incorrect');
  const result = document.createElement('strong');
  result.textContent = answer.correct ? 'Correct — well placed.' : 'Not quite — take another look.';
  const explanation = document.createElement('span');
  explanation.textContent = `${country.properties.name} is highlighted in green. ${answer.correct
    ? 'Your selection is within the accepted geographic tolerance.'
    : answer.selectedCountry ? `You selected ${answer.selectedCountry}.` : 'Your selection is outside the accepted geographic tolerance.'}`;
  feedback.replaceChildren(result, explanation);
  boundaries.eachLayer(layer => {
    const polygon = layer as L.Polygon & { feature: Country };
    if (polygon.feature.properties.id !== country.properties.id) return;
    polygon.setStyle({ color: '#225a3b', weight: 2, fillColor: '#65a777' });
    polygon.bringToFront();
    map.fitBounds(polygon.getBounds(), { padding: [45, 45], maxZoom: 6, animate: false });
  });
  selection = L.circleMarker([answer.latitude, answer.longitude], {
    radius: 6, color: '#fff', weight: 2, fillColor: answer.correct ? '#225a3b' : '#b35c33', fillOpacity: 1,
    interactive: false,
  }).addTo(map);
}

function openSession() {
  document.querySelector<HTMLElement>('#welcome')!.hidden = true;
  document.querySelector<HTMLElement>('#session')!.hidden = false;
  map = L.map('map', { minZoom: 1, maxZoom: 10, zoomAnimation: false, fadeAnimation: false, doubleClickZoom: false, maxBounds: [[-85, -180], [85, 180]], maxBoundsViscosity: 1 }).setView([15, 0], 2);
  boundaries = L.geoJSON(countries, { style: { color: '#718e83', weight: 0.8, fillColor: '#e3e9d6', fillOpacity: 1 } }).addTo(map);
  map.attributionControl.addAttribution('Natural Earth · Public domain');
  map.on('click', (event: L.LeafletMouseEvent) => {
    if (session.feedback) return;
    session.answer(event.latlng.lng, event.latlng.lat);
    renderQuestion();
  });
  document.querySelector('#reset-map')!.addEventListener('click', () => map.setView([15, 0], 2));
  renderQuestion();
}
document.querySelector('#start')!.addEventListener('click', () => {
  session.start();
  openSession();
});
renderStorageNotice();
if (session.started) openSession();
next.addEventListener('click', () => {
  session.next();
  renderQuestion();
});
