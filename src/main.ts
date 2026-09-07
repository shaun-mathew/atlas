import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './style.css';
import { countries, type Country } from './geography';
import { getCountryFacts } from './facts';
import { GuestSession } from './session';
import { LinkedMaps } from './linked-maps';

const app = document.querySelector<HTMLElement>('#app')!;
app.innerHTML = `
  <div id="map" role="region" aria-label="World map"></div>
  <div id="overview-label" class="linked-map-heading" hidden><span>Regional overview</span><small>Click to move the close-up</small></div>
  <section id="linked-detail" hidden>
    <header class="linked-map-heading"><span>Country close-up</span><small id="detail-instructions">Drag or zoom, then click to select</small></header>
    <div id="detail-map" role="region" aria-label="Country close-up"></div>
  </section>
  <div class="map-shade" aria-hidden="true"></div>
  <header class="app-header">
    <a class="brand" href="/" aria-label="Atlas Practice">
      <svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><circle cx="16" cy="16" r="13" stroke="currentColor" stroke-width="1.2"/><path d="m21 10-3 9-8 3 3-9 8-3Z" stroke="currentColor" stroke-width="1.2"/><path d="m21 10-8 3 5 6 3-9Z" fill="currentColor"/></svg>
      <span>Atlas<span class="brand-subtitle">A little further, every day.</span></span>
    </a>
    <div class="map-actions">
      <button id="reset-map" class="secondary" type="button" aria-label="World view"><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="7" stroke="currentColor"/><ellipse cx="10" cy="10" rx="3" ry="7" stroke="currentColor"/><path d="M3 10h14" stroke="currentColor"/></svg><span class="world-view-label">World view</span></button>
      <button id="map-info" class="secondary info-button" type="button" aria-label="Map coverage and review policy">i</button>
      <button id="open-profile" class="secondary profile-button" type="button" aria-label="Profile" title="Guest profile"><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="6" r="3" stroke="currentColor" stroke-width="1.5"/><path d="M4 17v-2a6 6 0 0 1 12 0v2" stroke="currentColor" stroke-width="1.5"/></svg></button>
    </div>
  </header>
  <p id="progress" class="progress" aria-label="Practice results"><span id="answered-count">0</span> answered <span class="progress-divider">·</span> <span id="correct-count">0</span> correct<span id="guided-count" hidden></span></p>
  <div class="session-panel">
    <section id="welcome">
      <p class="eyebrow"><span class="live-dot" aria-hidden="true"></span> Guest practice</p>
      <h1>A world worth knowing<span class="accent">.</span></h1>
      <p class="instructions">Start with larger, recognizable countries and work toward smaller places. Keep practicing for as long as you like. No account needed.</p>
      <div class="answer-dock">
        <button id="start" class="primary" type="button">Start country session <span aria-hidden="true">→</span></button>
        <button id="start-diagnostic" class="secondary" type="button">Start diagnostic</button>
        <p class="local-note">Your progress stays in this browser.</p>
      </div>
    </section>
    <section id="session" hidden>
      <p class="eyebrow"><span class="live-dot" aria-hidden="true"></span> <span id="question-kind">New learning item</span> <span id="question-number"></span></p>
      <p class="prompt">Where is</p>
      <h1><span id="country"></span><span class="accent">?</span></h1>
      <p class="instructions">Find it. Drop a pin. Trust your bearings.</p>
      <div class="location-tools">
        <button id="location-help" class="secondary" type="button">Show linked maps</button>
        <small id="help-warning">Reveals location · guided practice, not retention</small>
        <div id="linked-actions" hidden>
          <button id="recenter-country" class="secondary" type="button">Back to the country</button>
          <button id="close-linked" class="secondary" type="button">Use world map</button>
        </div>
      </div>
      <p id="guided-note" hidden>Location help used · guided practice, not retention credit.</p>
      <div class="answer-dock">
        <div id="feedback" role="status" aria-live="polite"></div>
        <section id="proficiency" aria-label="Name-to-location proficiency" hidden>
          <p>Name-to-location · <strong id="proficiency-level"></strong></p>
          <p>Review due <time id="review-at"></time></p>
          <p id="retry-note" hidden>Immediate retry records practice, not retention; your review time stays unchanged.</p>
          <p id="practice-note" hidden>Practice revisit reinforces this country without changing retention proficiency or its scheduled review.</p>
        </section>
        <section id="country-fact-card" class="fact-card" aria-label="Country fact card" tabindex="0" hidden></section>
        <button id="check" class="primary" type="button" disabled>Check location <span aria-hidden="true">→</span></button>
        <button id="next" class="primary" type="button" hidden>Next learning item <span aria-hidden="true">→</span></button>
        <button id="retry" class="secondary" type="button" hidden>Retry now</button>
      </div>
    </section>
    <section id="diagnostic-complete" hidden>
      <p class="eyebrow">Diagnostic complete</p>
      <h1>Diagnostic complete<span class="accent">.</span></h1>
      <p class="instructions">Your answers set the starting point for continuous adaptive practice: due reviews, new countries, and practice revisits mixed together. Stop whenever you like; your progress is saved.</p>
      <div class="answer-dock"><button id="start-adaptive" class="primary" type="button">Continue adaptive practice <span aria-hidden="true">→</span></button></div>
    </section>
    <p id="storage-notice" role="alert" hidden></p>
  </div>
  <dialog id="geography-policy" class="app-dialog" aria-labelledby="policy-title">
    <button id="close-policy" class="secondary dialog-close" type="button">Close</button>
    <h2 id="policy-title">Map coverage & review policy</h2>
    <p>Points inside the target boundary or within 25 km are accepted, unless they fall inside another mapped country or territory.</p>
    <p>241 countries and territories, excluding Antarctica. Public-domain <a href="https://www.naturalearthdata.com/about/terms-of-use/">Natural Earth</a> 5.1.2, 1:50m Admin-0 boundaries, retrieved 7 September 2026.</p>
    <p>We use its de facto boundaries and mapped territories; inclusion does not imply political recognition. Small islands and borders are generalized. This is a fixed learning dataset, not a source of legal boundaries.</p>
    <p>Drag to explore, use + and − to zoom, and select a point before checking your answer. Guest progress is saved in this browser, not across devices. Open Profile to see your identity or reset learning progress. Resetting requires confirmation and clears this app’s answers, proficiency, reviews, and diagnostic progress; it does not clear unrelated browser data.</p>
    <h3>Name-to-location reviews</h3>
    <p>Proficiency belongs to each country’s name-to-location skill, not to its capitals, facts, or other skills. On a new or diagnostic item, a miss means Learning and schedules a review in 10 minutes. A first success means Familiar and schedules a review in 1 day.</p>
    <p>Successful scheduled reviews extend the interval to 3, 7, 14, then 30 days (the maximum), and mark the skill Retained. A success after a miss restarts at Familiar and 1 day. Any missed review resets it to Learning and 10 minutes.</p>
    <h3>Country difficulty progression</h3>
    <p>New introductions begin with 16 recognizable countries across several regions, starting with Brazil, China, Australia, and India. Remaining countries and territories progress from larger to smaller main landmasses, leaving tiny islands and microstates until later. This is a map-selection difficulty guide, not a ranking of importance. New diagnostics use the first eight starter countries. Existing questions, diagnostic queues, and due reviews are preserved; reset your learning progress if you want a fresh start.</p>
    <h3>Diagnostic and adaptive practice</h3>
    <p>A diagnostic is an eight-item baseline without asking you to predeclare knowledge. Its answers update the same name-to-location proficiency used by continuous adaptive practice. Due reviews are selected oldest first. Otherwise, new countries are mixed with practice revisits: after two new introductions, an eligible previously seen country is selected, favoring its latest missed or guided answer, then the country least recently answered. Revisits normally have at least two intervening answers; new countries fill the gap while no revisit is eligible. Once every country has been introduced, practice continues with revisits. Stop whenever you like and resume from your saved question.</p>
    <p>Practice revisits reinforce countries before their scheduled review. Their answers affect revisit selection, but do not change retention proficiency or review dates. Immediate retries also leave retention unchanged, and do not erase a miss when selecting future revisits. There are no batch limits or waiting screens.</p>
    <h3>Linked-map location help</h3>
    <p>Show linked maps reveals the country in a regional overview and a separate close-up. Clicking the overview moves the close-up; dragging or zooming the close-up moves its outlined window without moving the overview. Select a location in the close-up and use Check location as usual.</p>
    <p>Using location help before answering marks that question as guided practice, even if you close the maps or reload. Guided answers are recorded separately from the correct-answer total and do not earn retention credit. On new items and scheduled reviews, they return the skill to Learning with an unassisted check in 10 minutes. Practice revisits and immediate retries leave the existing review schedule unchanged. Exploring linked maps after an answer does not change its recorded result or review schedule.</p>
    <p>The close-up starts on the largest mapped land mass rather than fitting distant outlying islands. Very large countries start on a smaller area within that land mass. Nearby larger land masses provide regional context where available. These are the same generalized Natural Earth boundaries; zooming does not add finer coastline detail. Back to the country restores both views.</p>
  </dialog>
  <dialog id="profile-dialog" class="app-dialog" aria-labelledby="profile-title">
    <button id="close-profile" class="secondary dialog-close" type="button">Close</button>
    <h2 id="profile-title">Your profile</h2>
    <h3>Guest profile</h3>
    <p>Not signed in. This app currently keeps your learning progress in this browser; no account is connected.</p>
    <p id="profile-progress"></p>
    <button id="request-reset" class="secondary danger" type="button">Reset learning progress</button>
    <section id="reset-confirmation" aria-labelledby="reset-title" hidden>
      <h3 id="reset-title">Reset learning progress?</h3>
      <p>This permanently deletes your answers, proficiency, scheduled reviews, and diagnostic progress in this browser. It cannot be undone.</p>
      <div class="profile-actions">
        <button id="cancel-reset" class="secondary" type="button">Cancel</button>
        <button id="confirm-reset" class="primary danger" type="button">Reset progress</button>
      </div>
    </section>
    <p id="profile-reset-error" role="alert" hidden></p>
  </dialog>`;

const session = new GuestSession();
const panel = document.querySelector<HTMLDivElement>('.session-panel')!;
const header = document.querySelector<HTMLElement>('.app-header')!;
const progress = document.querySelector<HTMLParagraphElement>('#progress')!;
const feedback = document.querySelector<HTMLDivElement>('#feedback')!;
const factCard = document.querySelector<HTMLElement>('#country-fact-card')!;
const check = document.querySelector<HTMLButtonElement>('#check')!;
const next = document.querySelector<HTMLButtonElement>('#next')!;
const retry = document.querySelector<HTMLButtonElement>('#retry')!;
const storageNotice = document.querySelector<HTMLParagraphElement>('#storage-notice')!;
const policy = document.querySelector<HTMLDialogElement>('#geography-policy')!;
const profile = document.querySelector<HTMLDialogElement>('#profile-dialog')!;
const resetRequest = document.querySelector<HTMLButtonElement>('#request-reset')!;
const resetConfirmation = document.querySelector<HTMLElement>('#reset-confirmation')!;
const profileResetError = document.querySelector<HTMLElement>('#profile-reset-error')!;
const proficiency = document.querySelector<HTMLElement>('#proficiency')!;
const reviewAt = document.querySelector<HTMLTimeElement>('#review-at')!;
const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const questionLabels: Record<'new' | 'review' | 'retry' | 'diagnostic' | 'practice', string> = {
  new: 'New learning item', review: 'Scheduled review', retry: 'Immediate retry', diagnostic: 'Diagnostic item', practice: 'Practice revisit',
};
let pendingPoint: L.LatLng | null = null;
let marker: L.CircleMarker | undefined;
let answerPolygon: L.Polygon | undefined;
let linkedOpen = session.assisted;

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
const linkedMaps = new LinkedMaps(map, document.querySelector<HTMLElement>('#detail-map')!, selectPoint);

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
  if (!answerPolygon || linkedOpen) return;
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

const populationFormatter = new Intl.NumberFormat('en');

function renderFactCard(countryId: string, version: string) {
  const { facts, sources } = getCountryFacts(countryId, version);
  const heading = document.createElement('h2');
  heading.textContent = facts.name;
  const fields = document.createElement('dl');
  const population = facts.population;
  const populationText = population.value === null
    ? 'Unavailable'
    : populationFormatter.format(population.value);
  const referenceYear = population.referenceYear === null
    ? 'reference year unavailable'
    : `reference year ${population.referenceYear}`;
  const entries = [
    ['Relationship', facts.relationship],
    ['Languages', facts.languages],
    ['Population', `${populationText} (${referenceYear})${population.note ? `. ${population.note}` : ''}`],
    ['Population direction', `${population.direction} · ${population.period}`],
    ['Highlight', facts.highlight],
  ];
  for (const [label, value] of entries) {
    const term = document.createElement('dt');
    term.textContent = label;
    const description = document.createElement('dd');
    description.textContent = value;
    fields.append(term, description);
  }
  const informational = document.createElement('p');
  informational.className = 'fact-notice';
  informational.textContent = 'Informational · not scored';
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = 'Sources and fact version';
  const scope = document.createElement('p');
  scope.textContent = `Geographic scope: ${facts.geographicScope}`;
  const versionLabel = document.createElement('p');
  versionLabel.className = 'fact-version';
  versionLabel.textContent = `Fact version: ${version}`;
  const sourceList = document.createElement('ul');
  for (const source of sources) {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = source.url;
    link.textContent = source.title;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    const retrieved = document.createElement('span');
    retrieved.textContent = `Retrieved ${source.retrievedAt} · License: ${source.license}`;
    item.append(link, retrieved);
    sourceList.append(item);
  }
  details.append(summary, scope, sourceList);
  factCard.replaceChildren(heading, informational, fields, versionLabel, details);
  factCard.hidden = false;
  factCard.scrollTop = 0;
}

function renderQuestion() {
  const diagnosticComplete = session.diagnosticComplete;
  document.querySelector<HTMLElement>('#welcome')!.hidden = session.started;
  document.querySelector<HTMLElement>('#diagnostic-complete')!.hidden = !diagnosticComplete;
  const country = session.country;
  const answer = session.feedback;
  const showLinked = session.started && !!country && linkedOpen;
  app.classList.toggle('has-linked-maps', showLinked);
  document.querySelector<HTMLElement>('#linked-detail')!.hidden = !showLinked;
  document.querySelector<HTMLElement>('#overview-label')!.hidden = !showLinked;
  map.getContainer().setAttribute('aria-label', showLinked ? 'Regional overview' : 'World map');
  if (!showLinked) {
    linkedMaps.hide();
    map.invalidateSize({ pan: false });
  }
  document.querySelector<HTMLElement>('#session')!.hidden = !session.started || !country || diagnosticComplete;
  document.querySelector('#country')!.textContent = country?.properties.name ?? '';
  document.querySelector('#question-kind')!.textContent = session.questionKind ? questionLabels[session.questionKind] : '';
  document.querySelector('#question-number')!.textContent = session.diagnosticNumber
    ? `Diagnostic ${session.diagnosticNumber}/${session.diagnosticTotal}`
    : `Q. ${String(session.cursor + 1).padStart(2, '0')}`;
  document.querySelector('#answered-count')!.textContent = String(session.attempts.length);
  document.querySelector('#correct-count')!.textContent = String(session.attempts.filter(attempt => attempt.correct && !attempt.assisted).length);
  const guidedCount = session.attempts.filter(attempt => attempt.assisted).length;
  const guidedSummary = document.querySelector<HTMLElement>('#guided-count')!;
  guidedSummary.textContent = guidedCount ? ` · ${guidedCount} guided` : '';
  guidedSummary.hidden = guidedCount === 0;
  const locationHelp = document.querySelector<HTMLButtonElement>('#location-help')!;
  locationHelp.textContent = answer ? 'Explore linked maps' : 'Show linked maps';
  locationHelp.hidden = showLinked || session.mode === 'diagnostic';
  document.querySelector<HTMLElement>('#linked-actions')!.hidden = !showLinked;
  document.querySelector<HTMLElement>('#help-warning')!.hidden = !!answer || showLinked || session.assisted || session.mode === 'diagnostic';
  document.querySelector<HTMLElement>('#guided-note')!.hidden = !session.assisted;
  document.querySelector('#detail-instructions')!.textContent = answer ? 'Answer recorded · drag or zoom to explore' : 'Drag or zoom, then click to select';
  storageNotice.textContent = session.storageNotice;
  storageNotice.hidden = !session.storageNotice;
  boundaries.resetStyle();
  marker?.remove();
  marker = undefined;
  answerPolygon = undefined;
  pendingPoint = null;
  panel.classList.toggle('is-answered', !!answer);
  factCard.hidden = true;
  factCard.replaceChildren();
  next.hidden = !answer;
  retry.hidden = !answer || answer.correct || session.mode === 'diagnostic';
  document.querySelector<HTMLElement>('#retry-note')!.hidden = session.questionKind !== 'retry';
  document.querySelector<HTMLElement>('#practice-note')!.hidden = session.questionKind !== 'practice';
  check.hidden = !!answer;
  check.disabled = true;
  const itemProficiency = session.proficiency;
  proficiency.hidden = !itemProficiency;
  if (itemProficiency) {
    document.querySelector('#proficiency-level')!.textContent = itemProficiency.level;
    reviewAt.dateTime = itemProficiency.dueAt;
    reviewAt.textContent = dateFormatter.format(new Date(itemProficiency.dueAt));
  }
  if (!country) {
    map.setView([15, 0], app.clientWidth <= 700 ? 1 : 2, { animate: false });
    return;
  }
  feedback.className = 'selection-hint';
  if (!answer) {
    feedback.textContent = showLinked ? 'Select your location in the country close-up.' : 'Tap the map to place your pin.';
    if (showLinked) linkedMaps.show(country);
    else map.setView([15, 0], app.clientWidth <= 700 ? 1 : 2, { animate: false });
    return;
  }
  feedback.className = `feedback ${answer.correct ? 'correct' : 'incorrect'}`;
  renderFactCard(country.properties.id, answer.factVersion);
  const result = document.createElement('strong');
  result.textContent = answer.assisted
    ? answer.correct ? 'Correct — guided practice.' : 'Not quite — guided practice.'
    : answer.correct ? 'Correct — well placed.' : 'Not quite — take another look.';
  const explanation = document.createElement('span');
  explanation.textContent = `${country.properties.name} is highlighted on the map. ${answer.correct
    ? 'Your selection is within the accepted geographic tolerance.'
    : answer.selectedCountry ? `You selected ${answer.selectedCountry}.` : 'Your selection is outside the accepted geographic tolerance.'}`;
  feedback.replaceChildren(result, explanation);
  // Siachen Glacier is a disputed geographic area without its own country flag.
  if (country.properties.id !== 'KAS') {
    const flag = document.createElement('img');
    flag.className = 'country-flag';
    flag.src = new URL(`./flags/${country.properties.id}.svg`, document.baseURI).href;
    flag.alt = `Flag of ${country.properties.name}`;
    flag.width = 64;
    flag.height = 48;
    feedback.prepend(flag);
  }
  if (showLinked) {
    linkedMaps.show(country, answer);
    return;
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

function selectPoint(point: L.LatLng) {
  if (!session.started || !session.country || session.feedback || Math.abs(point.lng) > 180 || Math.abs(point.lat) > 85) return;
  pendingPoint = point;
  if (!linkedOpen) {
    if (marker) marker.setLatLng(point);
    else marker = L.circleMarker(point, { radius: 7, weight: 3, color: '#111f2c', fillColor: '#d6ef87', fillOpacity: 1, interactive: false }).addTo(map);
  }
  feedback.textContent = `${Math.abs(point.lat).toFixed(1)}° ${point.lat >= 0 ? 'N' : 'S'} / ${Math.abs(point.lng).toFixed(1)}° ${point.lng >= 0 ? 'E' : 'W'}`;
  check.disabled = false;
}
map.on('click', (event: L.LeafletMouseEvent) => {
  if (!linkedOpen) selectPoint(event.latlng);
});
document.querySelector('#start')!.addEventListener('click', () => {
  session.start();
  linkedOpen = false;
  renderQuestion();
});
document.querySelector('#start-diagnostic')!.addEventListener('click', () => {
  session.startDiagnostic();
  linkedOpen = false;
  renderQuestion();
});
document.querySelector('#start-adaptive')!.addEventListener('click', () => {
  session.startAdaptive();
  linkedOpen = false;
  renderQuestion();
});
check.addEventListener('click', () => {
  if (!pendingPoint || session.feedback) return;
  session.answer(pendingPoint.lng, pendingPoint.lat);
  renderQuestion();
});
next.addEventListener('click', () => {
  session.next();
  linkedOpen = false;
  renderQuestion();
});
retry.addEventListener('click', () => {
  session.retry();
  linkedOpen = session.assisted;
  renderQuestion();
});
document.querySelector('#location-help')!.addEventListener('click', () => {
  session.requestLocationHelp();
  linkedOpen = true;
  renderQuestion();
});
document.querySelector('#close-linked')!.addEventListener('click', () => {
  linkedOpen = false;
  renderQuestion();
});
document.querySelector('#recenter-country')!.addEventListener('click', () => linkedMaps.recenter());
document.querySelector('#reset-map')!.addEventListener('click', () => {
  if (linkedOpen) {
    linkedOpen = false;
    renderQuestion();
  } else {
    map.setView([15, 0], app.clientWidth <= 700 ? 1 : 2, { animate: false });
  }
});
document.querySelector('#map-info')!.addEventListener('click', () => policy.showModal());
document.querySelector('#close-policy')!.addEventListener('click', () => policy.close());
document.querySelector('#open-profile')!.addEventListener('click', () => {
  document.querySelector('#profile-progress')!.textContent = `${session.attempts.length} answers in this guest profile.`;
  resetConfirmation.hidden = true;
  resetRequest.hidden = false;
  profileResetError.hidden = true;
  profile.showModal();
});
document.querySelector('#close-profile')!.addEventListener('click', () => profile.close());
resetRequest.addEventListener('click', () => {
  resetConfirmation.hidden = false;
  resetRequest.hidden = true;
  profileResetError.hidden = true;
  document.querySelector<HTMLButtonElement>('#cancel-reset')!.focus();
});
document.querySelector('#cancel-reset')!.addEventListener('click', () => {
  resetConfirmation.hidden = true;
  resetRequest.hidden = false;
  profileResetError.hidden = true;
  resetRequest.focus();
});
document.querySelector('#confirm-reset')!.addEventListener('click', () => {
  if (!session.reset()) {
    profileResetError.textContent = session.storageNotice;
    profileResetError.hidden = false;
    return;
  }
  profile.close();
  linkedOpen = false;
  renderQuestion();
  document.querySelector<HTMLButtonElement>('#start')!.focus();
});
renderQuestion();
