import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './style.css';
import { countries, type Country } from './geography';
import { factVersion, getCountryFacts } from './facts';
import { Accounts } from './accounts';
import { createAccountProfile } from './account-profile';
import { LinkedMaps } from './linked-maps';
import { MapPin } from './map-pin';
import { GeographyRenderer } from './geography-renderer';
import { Globe } from './globe';
import { createFacetSetup } from './facet-setup';
import { describeFacets } from './facets';

const app = document.querySelector<HTMLElement>('#app')!;
app.innerHTML = `
  <div id="map" role="region" aria-label="World map"></div>
  <section id="globe" role="region" aria-label="World globe" hidden>
    <small class="globe-attribution">Natural Earth · Public domain</small>
  </section>
  <div id="overview-label" class="linked-map-heading" hidden><span>Regional overview</span></div>
  <section id="linked-detail" hidden>
    <header class="linked-map-heading"><span>Country close-up</span></header>
    <div id="detail-map" role="region" aria-label="Country close-up"></div>
  </section>
  <div class="map-shade" aria-hidden="true"></div>
  <header class="app-header">
    <a class="brand" href="/" aria-label="Atlas Practice">
      <svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><circle cx="16" cy="16" r="13" stroke="currentColor" stroke-width="1.2"/><path d="m21 10-3 9-8 3 3-9 8-3Z" stroke="currentColor" stroke-width="1.2"/><path d="m21 10-8 3 5 6 3-9Z" fill="currentColor"/></svg>
      <span>Atlas<span class="brand-subtitle">A little further, every day.</span></span>
    </a>
      <button id="open-profile" class="secondary profile-button" type="button" aria-label="Profile" title="Guest profile"><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="6" r="3" stroke="currentColor" stroke-width="1.5"/><path d="M4 17v-2a6 6 0 0 1 12 0v2" stroke="currentColor" stroke-width="1.5"/></svg></button>
  </header>
    <div class="map-zoom" role="group" aria-label="Zoom controls">
      <button id="zoom-in" type="button" aria-label="Zoom in">+</button>
      <button id="zoom-out" type="button" aria-label="Zoom out">−</button>
    </div>
  <div class="practice-toolbar">
  <nav class="learning-modes" aria-label="Learning mode">
    <button id="adaptive-mode" class="secondary" type="button" aria-pressed="true">Recommended practice</button>
    <button id="facet-mode" class="secondary" type="button" aria-pressed="false">Custom practice</button>
  </nav>
  <div class="view-tools">
  <div class="presentation-tools" role="group" aria-label="Map presentation">
    <button id="toggle-presentation" class="secondary" type="button" aria-label="Switch to 3D globe" data-presentation="map">
      <span class="map-label">2D</span><span class="presentation-divider" aria-hidden="true">|</span><span class="globe-label">3D</span>
    </button>
    <span id="globe-notice" role="alert" hidden></span>
  </div>
  </div>
  </div>
    <button id="reset-map" class="secondary" type="button" aria-label="World view" title="World view"><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="7" stroke="currentColor"/><ellipse cx="10" cy="10" rx="3" ry="7" stroke="currentColor"/><path d="M3 10h14" stroke="currentColor"/></svg></button>
  <p id="progress" class="progress" aria-label="Practice results"><span class="progress-stat"><span id="answered-count">0</span> answered</span> <span class="progress-divider">·</span> <span class="progress-stat"><span id="correct-count">0</span> correct</span><span id="guided-count" hidden></span></p>
  <div class="session-panel">
    <section id="current-facets" class="current-facets" aria-label="Current practice selection" hidden>
      <p id="current-facet-description"></p>
      <button id="edit-facets" class="secondary" type="button">Edit practice set</button>
    </section>
    <section id="welcome">
      <p class="eyebrow"><span class="live-dot" aria-hidden="true"></span> Guest practice</p>
      <h1>A world worth knowing<span class="accent">.</span></h1>
      <p class="instructions">Start with larger, recognizable countries and work toward smaller places. Keep practicing for as long as you like. No account needed.</p>
      <div class="answer-dock">
        <button id="start" class="primary" type="button">Start country session <span aria-hidden="true">→</span></button>
        <p class="local-note">Your progress stays in this browser.</p>
      </div>
    </section>
    <section id="session" hidden>
      <p class="eyebrow"><span class="live-dot" aria-hidden="true"></span> <span id="question-kind">New learning item</span> <span id="question-number"></span></p>
      <p class="prompt">Where is</p>
      <h1><span id="country"></span><span class="accent">?</span></h1>
      <div class="location-tools">
        <button id="location-help" class="secondary" type="button">Show location</button>
        <small id="help-warning">Reveals location · guided practice, not retention</small>
        <div id="linked-actions" hidden>
          <button id="recenter-country" class="secondary" type="button">Back to the country</button>
          <button id="close-linked" class="secondary" type="button">Back to world map</button>
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
    <p id="storage-notice" role="alert" hidden></p>
  </div>
  <dialog id="profile-dialog" class="app-dialog" aria-labelledby="profile-title">
    <button id="close-profile" class="secondary dialog-close" type="button">Close</button>
    <h2 id="profile-title">Your profile</h2>
    <h3 id="profile-identity">Guest profile</h3>
    <p id="profile-description">Not signed in. Your progress stays in this browser.</p>
    <p id="profile-progress"></p>
    <button id="request-reset" class="secondary danger" type="button">Reset learning progress</button>
    <section id="reset-confirmation" aria-labelledby="reset-title" hidden>
      <h3 id="reset-title">Reset learning progress?</h3>
      <p id="reset-description">This permanently deletes your answers, proficiency, and scheduled reviews in this browser. It cannot be undone.</p>
      <div class="profile-actions">
        <button id="cancel-reset" class="secondary" type="button">Cancel</button>
        <button id="confirm-reset" class="primary danger" type="button">Reset progress</button>
      </div>
    </section>
    <p id="profile-reset-error" role="alert" hidden></p>
  </dialog>`;

const accounts = new Accounts();
await accounts.initialize();
let session = accounts.session;
const panel = document.querySelector<HTMLDivElement>('.session-panel')!;
const header = document.querySelector<HTMLElement>('.app-header')!;
const progress = document.querySelector<HTMLParagraphElement>('#progress')!;
const feedback = document.querySelector<HTMLDivElement>('#feedback')!;
const factCard = document.querySelector<HTMLElement>('#country-fact-card')!;
const check = document.querySelector<HTMLButtonElement>('#check')!;
const next = document.querySelector<HTMLButtonElement>('#next')!;
const retry = document.querySelector<HTMLButtonElement>('#retry')!;
const storageNotice = document.querySelector<HTMLParagraphElement>('#storage-notice')!;
const profile = document.querySelector<HTMLDialogElement>('#profile-dialog')!;
const resetRequest = document.querySelector<HTMLButtonElement>('#request-reset')!;
const resetConfirmation = document.querySelector<HTMLElement>('#reset-confirmation')!;
const profileResetError = document.querySelector<HTMLElement>('#profile-reset-error')!;
const proficiency = document.querySelector<HTMLElement>('#proficiency')!;
const reviewAt = document.querySelector<HTMLTimeElement>('#review-at')!;
const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const questionLabels: Record<'new' | 'review' | 'retry' | 'practice', string> = {
  new: 'New learning item', review: 'Scheduled review', retry: 'Immediate retry', practice: 'Practice revisit',
};
let pendingPoint: L.LatLng | null = null;
let marker: MapPin | undefined;
let answerPolygon: L.Polygon | undefined;
let linkedOpen = session.assisted;
let globe: Globe | undefined;
let globeOpen = false;
const globeContainer = document.querySelector<HTMLElement>('#globe')!;
const detailMapContainer = document.querySelector<HTMLElement>('#detail-map')!;
const worldViewButton = document.querySelector<HTMLButtonElement>('#reset-map')!;
const presentationButton = document.querySelector<HTMLButtonElement>('#toggle-presentation')!;
const zoomInButton = document.querySelector<HTMLButtonElement>('#zoom-in')!;
const zoomOutButton = document.querySelector<HTMLButtonElement>('#zoom-out')!;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let worldZoomTarget: number | undefined;

function changePresentation(useGlobe: boolean) {
  const selection = pendingPoint;
  globeOpen = useGlobe;
  linkedOpen = false;
  renderQuestion();
  if (selection && !session.feedback) selectPoint(selection);
}

function globeUnavailable() {
  globe?.dispose();
  globe = undefined;
  presentationButton.disabled = true;
  const notice = document.querySelector<HTMLElement>('#globe-notice')!;
  notice.textContent = '3D rendering unavailable. Continue on the 2D map; your progress and selection are kept.';
  notice.hidden = false;
  changePresentation(false);
  map.getContainer().focus({ preventScroll: true });
}

presentationButton.addEventListener('click', () => {
  if (globeOpen) {
    changePresentation(false);
    return;
  }
  try {
    globe ??= new Globe(globeContainer, point => selectPoint(L.latLng(point.latitude, point.longitude)), globeUnavailable);
    changePresentation(true);
  } catch {
    globeUnavailable();
  }
});
function zoomPresentation(levels: 1 | -1) {
  if (globeOpen) globe?.zoom(levels > 0 ? 0.8 : 1.25);
  else if (app.classList.contains('has-linked-maps')) linkedMaps.zoomBy(levels);
  else {
    const zoom = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), (worldZoomTarget ?? Math.round(map.getZoom())) + levels));
    worldZoomTarget = zoom;
    if (!map.getContainer().querySelector('.leaflet-zoom-anim')) {
      map.setZoom(zoom, { animate: !reducedMotion.matches });
    }
    updateZoomControls();
  }
}

function updateZoomControls() {
  const worldMap = !globeOpen && !app.classList.contains('has-linked-maps');
  const target = globeOpen ? ' on globe' : worldMap ? '' : ' on country close-up';
  zoomInButton.setAttribute('aria-label', `Zoom in${target}`);
  zoomOutButton.setAttribute('aria-label', `Zoom out${target}`);
  zoomInButton.disabled = worldMap && (worldZoomTarget ?? map.getZoom()) >= map.getMaxZoom();
  zoomOutButton.disabled = worldMap && (worldZoomTarget ?? map.getZoom()) <= map.getMinZoom();
}

zoomInButton.addEventListener('click', () => zoomPresentation(1));
zoomOutButton.addEventListener('click', () => zoomPresentation(-1));

const map = L.map('map', {
  minZoom: 1, maxZoom: 10, zoomControl: false, zoomAnimation: !reducedMotion.matches,
  markerZoomAnimation: !reducedMotion.matches, fadeAnimation: false, doubleClickZoom: false,
  inertia: !reducedMotion.matches, inertiaMaxSpeed: 900, inertiaDeceleration: 16000,
  renderer: new GeographyRenderer({ padding: 0.5 }),
}).setView([15, 0], app.clientWidth <= 700 ? 1 : 2);
map.on('zoomend', () => {
  if (worldZoomTarget !== undefined && map.getZoom() !== worldZoomTarget) {
    map.setZoom(worldZoomTarget, { animate: !reducedMotion.matches });
  } else worldZoomTarget = undefined;
  updateZoomControls();
});
map.on('dragstart', () => { worldZoomTarget = undefined; });
for (const event of ['pointerdown', 'wheel', 'keydown']) {
  map.getContainer().addEventListener(event, () => {
    worldZoomTarget = undefined;
    if (event === 'keydown') stopWorldMovement();
  }, { passive: true });
}
reducedMotion.addEventListener('change', () => {
  map.options.inertia = !reducedMotion.matches;
  if (reducedMotion.matches) stopWorldMovement();
});

function stopWorldMovement() {
  worldZoomTarget = undefined;
  // Leaflet's public stop() stops pan/fly, but not its CSS zoom transition.
  if (map.getContainer().querySelector('.leaflet-zoom-anim')) {
    (map as L.Map & { _onZoomTransitionEnd(): void })._onZoomTransitionEnd();
  }
  const zoomSnap = map.options.zoomSnap;
  map.options.zoomSnap = 0;
  map.setView(map.getCenter(), map.getZoom(), { animate: false });
  map.options.zoomSnap = zoomSnap;
}

function resetWorld(animate = true) {
  stopWorldMovement();
  map.flyTo([15, 0], app.clientWidth <= 700 ? 1 : 2, {
    animate: animate && !globeOpen && !reducedMotion.matches,
  });
}
// Anchor the mobile reset action to the visible map, above its attribution or question card.
const worldViewPosition = new ResizeObserver(() => {
  if (app.clientWidth > 700) return;
  const surface = globeOpen ? globeContainer : app.classList.contains('has-linked-maps') ? detailMapContainer : map.getContainer();
  const bounds = surface.getBoundingClientRect();
  const container = app.getBoundingClientRect();
  const bottom = Math.min(bounds.bottom, panel.getBoundingClientRect().top);
  const inset = bottom < bounds.bottom ? 12 : 24;
  worldViewButton.style.setProperty('--map-control-top', `${Math.max(bounds.top, bottom - 34 - inset) - container.top}px`);
  worldViewButton.style.setProperty('--map-control-right', `${container.right - bounds.right + 12}px`);
});
worldViewPosition.observe(panel);
worldViewPosition.observe(map.getContainer());
worldViewPosition.observe(globeContainer);
worldViewPosition.observe(detailMapContainer);
map.attributionControl.addAttribution('Natural Earth · Public domain');
// Keep the same coastline through CSS zooms and the final reprojection.
const boundaryStyle: L.PolylineOptions = { smoothFactor: 0, color: '#63777f', weight: 0.8, fillColor: '#334c57', fillOpacity: 1 };
const boundaries = L.geoJSON(countries, { style: boundaryStyle }).addTo(map);
const linkedMaps = new LinkedMaps(map, detailMapContainer, selectPoint);

// Keep the infinite projected grid in Leaflet's pane so pan and zoom move it
// with the geography, including CSS zooms that do not emit per-frame move events.
const grid = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
grid.classList.add('map-grid', 'leaflet-zoom-animated');
grid.setAttribute('aria-hidden', 'true');
const gridLines = document.createElementNS('http://www.w3.org/2000/svg', 'path');
grid.append(gridLines);
map.getPane('tilePane')!.append(grid);
let gridCenter = map.getCenter();
let gridZoom = map.getZoom();
let gridPixelOrigin = map.getPixelOrigin();
function drawGrid() {
  const size = map.getSize();
  const origin = map.containerPointToLayerPoint(size.multiplyBy(-1)).round();
  const extent = size.multiplyBy(3);
  gridCenter = map.getCenter();
  gridZoom = map.getZoom();
  gridPixelOrigin = map.getPixelOrigin();
  const spacing = L.CRS.EPSG3857.scale(gridZoom) / 12;
  const equator = map.latLngToLayerPoint([0, 0]);
  const segments: string[] = [];
  for (let x = equator.x + Math.floor((origin.x - equator.x) / spacing) * spacing; x <= origin.x + extent.x; x += spacing) {
    segments.push(`M${x} ${origin.y}V${origin.y + extent.y}`);
  }
  for (let y = equator.y + Math.floor((origin.y - equator.y) / spacing) * spacing; y <= origin.y + extent.y; y += spacing) {
    segments.push(`M${origin.x} ${y}H${origin.x + extent.x}`);
  }
  grid.setAttribute('width', String(extent.x));
  grid.setAttribute('height', String(extent.y));
  grid.setAttribute('viewBox', `${origin.x} ${origin.y} ${extent.x} ${extent.y}`);
  L.DomUtil.setTransform(grid as unknown as HTMLElement, origin);
  gridLines.setAttribute('d', segments.join(''));
}
map.on('zoomanim', (event: L.ZoomAnimEvent) => {
  const size = map.getSize();
  const scale = map.getZoomScale(event.zoom, gridZoom);
  const panePosition = map.containerPointToLayerPoint([0, 0]).multiplyBy(-1);
  const pixelOrigin = map.project(event.center, event.zoom).subtract(size.divideBy(2)).add(panePosition).round();
  const offset = size.multiplyBy(-1.5 * scale).add(map.project(gridCenter, event.zoom)).subtract(pixelOrigin);
  L.DomUtil.setTransform(grid as unknown as HTMLElement, offset, scale);
});
map.on('move zoom resize', drawGrid);
drawGrid();

function focusAnswer(animate = true) {
  if (!answerPolygon || linkedOpen || globeOpen) return;
  const canvas = map.getContainer().getBoundingClientRect();
  const overlay = panel.getBoundingClientRect();
  const top = Math.max(header.getBoundingClientRect().bottom, progress.getBoundingClientRect().bottom) - canvas.top + 24;
  stopWorldMovement();
  map.flyToBounds(answerPolygon.getBounds(), {
    paddingTopLeft: [canvas.width <= 700 ? 24 : overlay.right - canvas.left + 32, top],
    paddingBottomRight: [24, canvas.width <= 700 ? canvas.bottom - overlay.top + 24 : 32],
    maxZoom: 6, animate: animate && !reducedMotion.matches,
  });
}
map.on('resize', () => focusAnswer(false));

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

function renderQuestion(animate = true) {
  stopWorldMovement();
  answerPolygon?.getElement()?.classList.remove('answer-border');
  answerPolygon = undefined;
  const reading = session.readingFacts;
  app.classList.toggle('is-reading', reading);
  const selectedFacets = session.selection;
  document.querySelector<HTMLElement>('#current-facets')!.hidden = !selectedFacets;
  document.querySelector('#current-facet-description')!.textContent = selectedFacets ? describeFacets(selectedFacets) : '';
  document.querySelector('#adaptive-mode')!.setAttribute('aria-pressed', String(!selectedFacets));
  document.querySelector('#facet-mode')!.setAttribute('aria-pressed', String(!!selectedFacets));
  document.querySelector<HTMLElement>('#welcome')!.hidden = session.started;
  const country = session.country;
  const answer = session.feedback;
  if (linkedOpen) globeOpen = false;
  app.classList.toggle('has-globe', globeOpen);
  globeContainer.hidden = !globeOpen;
  map.getContainer().hidden = globeOpen;
  presentationButton.dataset.presentation = globeOpen ? 'globe' : 'map';
  presentationButton.setAttribute('aria-label', presentationButton.disabled ? '3D globe unavailable' : globeOpen ? 'Switch to 2D map' : 'Switch to 3D globe');
  globe?.setVisible(globeOpen);
  const showLinked = session.started && !!country && linkedOpen && !reading;
  app.classList.toggle('has-linked-maps', showLinked);
  updateZoomControls();
  document.querySelector<HTMLElement>('#linked-detail')!.hidden = !showLinked;
  document.querySelector<HTMLElement>('#overview-label')!.hidden = !showLinked;
  map.getContainer().setAttribute('aria-label', showLinked ? 'Regional overview' : 'World map');
  if (!showLinked) linkedMaps.hide();
  document.querySelector<HTMLElement>('#session')!.hidden = !session.started || !country;
  document.querySelector('#country')!.textContent = country?.properties.name ?? '';
  document.querySelector('#question-kind')!.textContent = reading ? 'Country fact cards' : session.questionKind ? questionLabels[session.questionKind] : '';
  document.querySelector('#question-number')!.textContent = reading ? 'Reading' : `Q. ${String(session.cursor + 1).padStart(2, '0')}`;
  document.querySelector('#answered-count')!.textContent = String(session.attempts.length);
  document.querySelector('#correct-count')!.textContent = String(session.attempts.filter(attempt => attempt.correct && !attempt.assisted).length);
  const guidedCount = session.attempts.filter(attempt => attempt.assisted).length;
  const guidedSummary = document.querySelector<HTMLElement>('#guided-count')!;
  guidedSummary.textContent = guidedCount ? ` · ${guidedCount} guided` : '';
  guidedSummary.hidden = guidedCount === 0;
  const locationHelp = document.querySelector<HTMLButtonElement>('#location-help')!;
  locationHelp.textContent = answer ? 'Explore location' : 'Show location';
  locationHelp.hidden = showLinked;
  document.querySelector<HTMLElement>('#linked-actions')!.hidden = !showLinked;
  document.querySelector<HTMLElement>('#help-warning')!.hidden = !!answer || showLinked || session.assisted;
  document.querySelector<HTMLElement>('#guided-note')!.hidden = !session.assisted;
  storageNotice.textContent = session.storageNotice;
  storageNotice.hidden = !session.storageNotice;
  boundaries.resetStyle();
  marker?.remove();
  marker = undefined;
  pendingPoint = null;
  panel.classList.toggle('is-answered', !!answer || reading);
  factCard.hidden = true;
  factCard.replaceChildren();
  next.hidden = !answer && !reading;
  next.firstChild!.textContent = reading ? 'Next fact card ' : 'Next learning item ';
  retry.hidden = !answer || answer.correct;
  document.querySelector<HTMLElement>('#retry-note')!.hidden = session.questionKind !== 'retry';
  document.querySelector<HTMLElement>('#practice-note')!.hidden = session.questionKind !== 'practice';
  check.hidden = !!answer || reading;
  check.disabled = true;
  const itemProficiency = session.proficiency;
  proficiency.hidden = !itemProficiency;
  if (itemProficiency) {
    document.querySelector('#proficiency-level')!.textContent = itemProficiency.level;
    reviewAt.dateTime = itemProficiency.dueAt;
    reviewAt.textContent = dateFormatter.format(new Date(itemProficiency.dueAt));
  }
  feedback.className = 'selection-hint';
  if (country && reading) {
    feedback.textContent = 'Reading does not change proficiency or review dates. Locations shown here count as help for unanswered questions.';
    renderFactCard(country.properties.id, factVersion);
  } else if (!answer) {
    feedback.textContent = '';
  } else if (country) {
    feedback.className = `feedback ${answer.correct ? 'correct' : 'incorrect'}`;
    renderFactCard(country.properties.id, answer.factVersion);
    const result = document.createElement('strong');
    result.textContent = answer.assisted
      ? answer.correct ? 'Correct — guided practice.' : 'Not quite — guided practice.'
      : answer.correct ? 'Correct — well placed.' : 'Not quite — take another look.';
    const explanation = document.createElement('span');
    explanation.textContent = `${country.properties.name} is highlighted on the ${globeOpen ? 'globe' : 'map'}. ${answer.correct
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
  }
  // Finish the panel and surface layout before measuring a destination or
  // starting travel. invalidateSize must not refocus the previous answer.
  if (!showLinked) map.invalidateSize({ pan: false, animate: false });
  globe?.showAnswer(answer || reading ? country ?? undefined : undefined, answer ?? undefined);
  if (showLinked && country) {
    linkedMaps.show(country, answer ?? undefined);
  } else if (country && (answer || reading)) {
    highlightCountry(country.properties.id);
    if (answer) marker = new MapPin(map, [answer.latitude, answer.longitude], answer.correct);
    if (!globeOpen) focusAnswer(animate);
  } else resetWorld(animate);
}

function highlightCountry(countryId: string) {
  boundaries.eachLayer(layer => {
    const polygon = layer as L.Polygon & { feature: Country };
    if (polygon.feature.properties.id !== countryId) return;
    polygon.setStyle({ color: '#e3f5b1', weight: 2, fillColor: '#a2c472' });
    polygon.getElement()!.classList.add('answer-border');
    polygon.bringToFront();
    answerPolygon = polygon;
  });
}

function selectPoint(point: L.LatLng) {
  if (!session.started || session.readingFacts || !session.country || session.feedback || Math.abs(point.lng) > 180 || Math.abs(point.lat) > 90) return;
  pendingPoint = point;
  globe?.setSelection({ longitude: point.lng, latitude: point.lat });
  if (!linkedOpen && !globeOpen) {
    const projection = map.getContainer().querySelector('.leaflet-zoom-anim') ? { zoom: gridZoom, origin: gridPixelOrigin } : undefined;
    if (marker) marker.place(point, undefined, projection);
    else marker = new MapPin(map, point, undefined, projection);
  }
  feedback.textContent = `${Math.abs(point.lat).toFixed(1)}° ${point.lat >= 0 ? 'N' : 'S'} / ${Math.abs(point.lng).toFixed(1)}° ${point.lng >= 0 ? 'E' : 'W'}`;
  check.disabled = false;
}
map.on('click', (event: L.LeafletMouseEvent) => {
  if (linkedOpen) return;
  // Leaflet commits the target projection before its CSS zoom is visible.
  // Invert the grid's actual transform to select the point under the pointer.
  const matrix = grid.getScreenCTM();
  if (matrix && map.getContainer().querySelector('.leaflet-zoom-anim')) {
    const point = new DOMPoint(event.originalEvent.clientX, event.originalEvent.clientY).matrixTransform(matrix.inverse());
    selectPoint(map.unproject(L.point(point.x, point.y).add(gridPixelOrigin), gridZoom));
  } else selectPoint(event.latlng);
});
document.querySelector('#start')!.addEventListener('click', () => {
  session.start();
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
  } else if (globeOpen) {
    globe?.reset();
  } else {
    resetWorld();
  }
});
document.querySelector('#open-profile')!.addEventListener('click', () => {
  renderAccountProfile();
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
document.querySelector('#confirm-reset')!.addEventListener('click', async () => {
  const confirm = document.querySelector<HTMLButtonElement>('#confirm-reset')!;
  confirm.disabled = true;
  try {
    if (!await accounts.resetProgress()) throw new Error(session.storageNotice);
    profile.close();
    linkedOpen = false;
    renderQuestion();
    document.querySelector<HTMLButtonElement>('#start')!.focus();
  } catch (error) {
    profileResetError.textContent = error instanceof Error ? error.message : 'Learning progress could not be reset. Your progress has been kept.';
    profileResetError.hidden = false;
  } finally {
    confirm.disabled = false;
  }
});
const facetSetup = createFacetSetup(selection => {
  session.choosePractice(selection);
  linkedOpen = session.assisted;
  renderQuestion();
});
document.querySelector('#facet-mode')!.addEventListener('click', () => facetSetup.open(session.selection));
document.querySelector('#edit-facets')!.addEventListener('click', () => facetSetup.open(session.selection));
document.querySelector('#adaptive-mode')!.addEventListener('click', () => {
  if (!session.selection) return;
  session.choosePractice(null);
  linkedOpen = session.assisted;
  renderQuestion();
});
const renderAccountProfile = createAccountProfile(accounts);
accounts.onchange = sessionChanged => {
  if (sessionChanged) {
    session = accounts.session;
    linkedOpen = session.assisted;
    renderQuestion();
  }
  renderAccountProfile();
};
window.addEventListener('online', () => { void accounts.sync(); });
renderQuestion(false);
