// THROWAWAY: Three facet-mode designs on /?variant=A|B|C.
// Question: simultaneous facets, guided setup, or a browsable practice workbench?
// Real country geometry and facts; in-memory selections; no session writes or assessment.
import L from 'leaflet';
import { countries } from './geography';
import { factVersion, getCountryFacts } from './facts';
import { mountPrototypeSwitcher } from './prototype-switcher';
import './facet-mode.prototype.css';

const continents: Record<string, string[]> = {
  Africa: ['Northern Africa', 'Western Africa', 'Middle Africa', 'Eastern Africa', 'Southern Africa'],
  Asia: ['Central Asia', 'Eastern Asia', 'Southern Asia', 'South-Eastern Asia', 'Western Asia'],
  Europe: ['Northern Europe', 'Southern Europe', 'Western Europe', 'Eastern Europe'],
  'North America': ['Northern America', 'Central America', 'Caribbean'],
  'South America': ['South America'],
  Oceania: ['Australia and New Zealand', 'Melanesia', 'Micronesia', 'Polynesia'],
  'Open ocean': ['Seven seas (open ocean)'],
};
const state = { variant: 'A', scope: 'Countries & territories', continent: 'Europe', region: 'All regions', skill: 'Name-to-location', step: 1, query: '', preview: false, countryIndex: 0 };
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
function selectedCountries() {
  return countries.filter(country => (state.continent === 'Worldwide' || continents[state.continent].includes(country.properties.region)) && (state.region === 'All regions' || country.properties.region === state.region));
}
function selectControl(label: string, field: 'continent' | 'region', options: string[]) {
  return `<label class="fp-field">${label}<select data-field="${field}">${options.map(option => `<option ${state[field] === option ? 'selected' : ''}>${option}</option>`).join('')}</select></label>`;
}
function geography() {
  const regions = state.continent === 'Worldwide' ? [...new Set(countries.map(c => c.properties.region))].sort() : continents[state.continent];
  return selectControl('Continent', 'continent', ['Worldwide', ...Object.keys(continents)]) + selectControl('Region', 'region', ['All regions', ...regions]);
}
function scope() {
  return `<div class="fp-scope"><span class="fp-symbol">◎</span><div><strong>Countries & territories</strong><small>The ${countries.length} mapped places in Atlas</small></div><span class="fp-tick">✓</span></div><p class="fp-muted">Cities and water features are outside this first learning set.</p>`;
}
function skills() {
  return `<div class="fp-skills">${[
    ['Name-to-location', 'Find a named country on the map', '↗'],
    ['Country fact cards', 'Read languages, population & context', '≡'],
  ].map(([name, description, icon]) => `<button class="fp-skill ${state.skill === name ? 'is-selected' : ''}" data-skill="${name}" aria-pressed="${state.skill === name}"><span class="fp-symbol">${icon}</span><span><strong>${name}</strong><small>${description}</small></span><span class="fp-radio"></span></button>`).join('')}</div><p class="fp-muted">Fact cards are read-only, not a scored fact skill. Recognition and capital questions are not available yet.</p>`;
}
function summary() {
  return `<div class="fp-summary"><span>${state.scope}</span><span>${state.continent} / ${state.region}</span><span>${state.skill}</span></div>`;
}
function start() {
  return `<button class="primary" data-action="preview">Preview ${state.skill === 'Country fact cards' ? 'fact cards' : 'practice'} <span aria-hidden="true">→</span></button><p class="fp-safety">Design preview only · no progress is recorded.</p>`;
}
function count() { return `<strong>${selectedCountries().length}</strong><span>countries & territories</span>`; }
function header(kicker: string, title: string, description: string) {
  return `<p class="eyebrow"><span class="live-dot"></span>${kicker}</p><h1>${title}</h1><p class="fp-description">${description}</p>`;
}
export function VariantA() {
  return `<section class="fp-sidebar fp-surface">${header('Facet mode / your own direction', 'Choose your<br><em>corner of the world.</em>', 'A place, a region, a skill. Make the next stretch of practice yours.')}<section class="fp-section"><h2><span>01</span> What places?</h2>${scope()}</section><section class="fp-section"><h2><span>02</span> Where in the world?</h2><div class="fp-geography">${geography()}</div></section><section class="fp-section"><h2><span>03</span> What would you like to learn?</h2>${skills()}</section>${start()}</section><aside class="fp-map-note"><span class="eyebrow">Your practice area</span><div class="fp-count">${count()}</div>${summary()}<p>Highlighted places are included.<br>Drag the map to explore.</p></aside>`;
}
export function VariantB() {
  const titles = ['What would you like to explore?', 'Where shall we go?', 'What would you like to learn?'];
  const descriptions = ['Start with a kind of place. We’ll narrow it down together.', 'Go continent-wide or get to know a smaller region.', 'Practice a spatial skill, or slow down with country facts.'];
  return `<section class="fp-wizard fp-surface"><nav class="fp-steps" aria-label="Setup steps">${['Places', 'Geography', 'Learning'].map((label, i) => `<button data-step="${i + 1}" aria-current="${state.step === i + 1 ? 'step' : 'false'}"><span>${i + 1}</span>${label}</button>`).join('')}</nav><div class="fp-wizard-body">${header(`Facet mode / step ${state.step} of 3`, titles[state.step - 1], descriptions[state.step - 1])}${state.step === 1 ? scope() : state.step === 2 ? `<div class="fp-geography">${geography()}</div><div class="fp-count">${count()}</div>` : skills()}</div><footer><button class="secondary" data-step="${Math.max(1, state.step - 1)}" ${state.step === 1 ? 'disabled' : ''}>Back</button>${state.step < 3 ? `<button class="primary" data-step="${state.step + 1}">Continue <span>→</span></button>` : start()}</footer></section><aside class="fp-itinerary"><p class="eyebrow">Your practice plan</p><h2>A little more<br>of <em>${state.continent === 'Worldwide' ? 'the world' : state.continent}.</em></h2>${summary()}<p>${selectedCountries().length} places in your selection</p><small>Production intent: the same proficiency and scheduled reviews as adaptive mode. Nothing is changed in this preview.</small></aside>`;
}
export function VariantC() {
  const matches = selectedCountries().filter(c => c.properties.name.toLowerCase().includes(state.query.toLowerCase()));
  return `<section class="fp-workbench fp-surface"><div class="fp-workbench-head">${header('Facet mode / build a practice set', 'Your world, narrowed down.', 'See exactly what you’ll practice before you begin.')}<div class="fp-workbench-start">${start()}</div></div><div class="fp-filterbar"><div><span class="fp-label">Entity scope</span><strong>Countries & territories</strong></div>${geography()}<label class="fp-field">Learning<select data-field="skill"><option ${state.skill === 'Name-to-location' ? 'selected' : ''}>Name-to-location</option><option ${state.skill === 'Country fact cards' ? 'selected' : ''}>Country fact cards</option></select></label><button class="secondary" data-action="reset">Clear filters</button></div><div class="fp-workbench-body"><div class="fp-catalog"><div class="fp-catalog-title"><h2>${selectedCountries().length} places</h2><label><span class="fp-label">Find in this set</span><input type="search" data-field="query" placeholder="Search countries…" value="${escape(state.query)}"></label></div><div class="fp-country-list">${matches.map(c => `<button data-country="${c.properties.id}"><span>${escape(c.properties.name)}</span><small>${c.properties.region}</small><span aria-hidden="true">↗</span></button>`).join('') || '<p class="fp-empty">No places match your search. Try another name.</p>'}</div><p class="fp-muted">Search only narrows this list, not your practice set. Select a place to inspect it on the map.</p></div><aside class="fp-ledger"><span class="eyebrow">Set at a glance</span>${summary()}<hr><h3>One learning history.</h3><p>Facet mode chooses what you practice. It should not create a separate proficiency score or erase scheduled reviews.</p><p class="fp-muted">${state.skill === 'Country fact cards' ? 'Fact cards are reading, not assessed learning items.' : 'One name-to-location learning item per selected place.'}</p><p class="fp-muted">Prototype: no scheduling or scoring is running.</p></aside></div></section>`;
}
export function mountFacetPrototype(app: HTMLElement) {
  app.className = 'facet-prototype';
  const root = document.createElement('main');
  root.id = 'facet-prototype';
  app.append(root);
  const statePanel = document.createElement('details');
  statePanel.className = 'fp-state';
  statePanel.innerHTML = '<summary>Prototype state · no writes</summary><pre></pre>';
  app.append(statePanel);
  const mode = document.createElement('nav');
  mode.className = 'fp-mode';
  mode.setAttribute('aria-label', 'Learning mode');
  mode.innerHTML = '<a href="/">Adaptive</a><span aria-current="page">Facet mode</span><small>THROWAWAY PROTOTYPE</small>';
  app.append(mode);
  const map = L.map('map', { zoomControl: false, minZoom: 1, maxZoom: 8, worldCopyJump: true }).setView([30, 15], 2);
  L.control.zoom({ position: 'topright' }).addTo(map);
  map.attributionControl.addAttribution('Natural Earth · Public domain');
  const boundaries = L.geoJSON(countries, { style: { color: '#63777f', weight: 0.8, fillColor: '#334c57', fillOpacity: 1 } }).addTo(map);
  document.querySelector<HTMLButtonElement>('#reset-map')!.onclick = () => map.setView([20, 0], 2);
  const policy = document.querySelector<HTMLDialogElement>('#geography-policy')!;
  document.querySelector<HTMLButtonElement>('#map-info')!.onclick = () => policy.showModal();
  document.querySelector<HTMLButtonElement>('#close-policy')!.onclick = () => policy.close();
  document.querySelector<HTMLButtonElement>('#open-profile')!.disabled = true;
  document.querySelector<HTMLButtonElement>('#open-profile')!.title = 'Profile editing is disabled in the prototype';
  let focusedCountry: string | null = null;
  function render() {
    const focus = document.activeElement as HTMLInputElement;
    const focusField = focus?.dataset?.field;
    const selectionStart = focusField === 'query' ? focus.selectionStart : null;
    app.dataset.variant = state.variant;
    root.innerHTML = state.preview ? preview() : ({ A: VariantA, B: VariantB, C: VariantC }[state.variant]!());
    const selected = new Set(selectedCountries().map(c => c.properties.id));
    boundaries.setStyle(feature => ({ color: feature?.properties.id === focusedCountry ? '#fff' : '#71847e', weight: feature?.properties.id === focusedCountry ? 2 : 0.7, fillColor: selected.has(feature?.properties.id) ? '#a5bd72' : '#2c434e', fillOpacity: selected.has(feature?.properties.id) ? 0.85 : 0.6 }));
    statePanel.querySelector('pre')!.textContent = JSON.stringify({ ...state, focusedCountry, matchingCountryIds: [...selected], factVersion: state.skill === 'Country fact cards' ? factVersion : null, writesProgress: false }, null, 2);
    if (focusField) {
      const replacement = root.querySelector<HTMLInputElement>(`[data-field="${focusField}"]`);
      replacement?.focus();
      if (focusField === 'query') replacement?.setSelectionRange(selectionStart, selectionStart);
    }
    requestAnimationFrame(() => map.invalidateSize());
  }
  function preview() {
    const places = selectedCountries();
    const country = places[state.countryIndex % places.length];
    const { facts } = getCountryFacts(country.properties.id, factVersion);
    return `<section class="fp-preview fp-surface"><button class="secondary" data-action="edit">← Edit your set</button>${header('Unscored interaction preview', state.skill === 'Country fact cards' ? escape(country.properties.name) : `Where is<br><em>${escape(country.properties.name)}?</em>`, 'This is a design preview, not an assessment. The selected region stays highlighted.')}${summary()}${state.skill === 'Country fact cards' ? `<article class="fp-fact"><h2>Country fact card</h2><dl><dt>Languages</dt><dd>${escape(facts.languages)}</dd><dt>In context</dt><dd>${escape(facts.highlight)}</dd><dt>Population</dt><dd>${facts.population.value?.toLocaleString() ?? 'Unavailable'} · ${facts.population.referenceYear ?? 'No reference year'} · ${facts.population.direction}</dd></dl><small>Existing fact release ${factVersion}</small></article>` : '<p class="fp-description">The final practice screen would accept a map selection here. This preview only checks the facet setup and hand-off.</p>'}<button class="primary" data-action="next">Next preview <span>→</span></button><p class="fp-safety">No answers, proficiency, or scheduled reviews are written.</p></section>`;
  }
  root.addEventListener('change', event => {
    const target = event.target as HTMLSelectElement;
    if (target.tagName !== 'SELECT') return;
    if (target.dataset.field === 'continent') { state.continent = target.value; state.region = 'All regions'; }
    if (target.dataset.field === 'region') state.region = target.value;
    if (target.dataset.field === 'skill') state.skill = target.value;
    focusedCountry = null;
    render();
  });
  root.addEventListener('input', event => {
    const target = event.target as HTMLInputElement;
    if (target.dataset.field === 'query') { state.query = target.value; render(); }
  });
  root.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button) return;
    if (button.dataset.skill) state.skill = button.dataset.skill;
    if (button.dataset.step) state.step = Number(button.dataset.step);
    if (button.dataset.action === 'preview') { state.preview = true; state.countryIndex = 0; }
    if (button.dataset.action === 'edit') state.preview = false;
    if (button.dataset.action === 'next') state.countryIndex++;
    if (button.dataset.action === 'reset') { state.continent = 'Worldwide'; state.region = 'All regions'; state.query = ''; focusedCountry = null; }
    if (button.dataset.country) {
      focusedCountry = button.dataset.country;
      const country = countries.find(c => c.properties.id === focusedCountry)!;
      map.fitBounds(L.geoJSON(country).getBounds(), { maxZoom: 4, padding: [30, 30] });
    }
    render();
  });
  mountPrototypeSwitcher(variant => { state.variant = variant; state.preview = false; render(); });
}
