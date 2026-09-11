import { countries } from './geography';
import { continentRegions, defaultFacets, describeFacets, matchesFacets, type FacetSelection } from './facets';
import './facet-setup.css';

export function createFacetSetup(onStart: (selection: FacetSelection) => void) {
  const dialog = document.createElement('dialog');
  dialog.className = 'facet-setup';
  dialog.setAttribute('aria-label', 'Custom practice setup');
  dialog.innerHTML = `
    <div class="facet-setup-layout">
      <section class="facet-wizard">
        <nav class="facet-steps" aria-label="Setup steps">
          <button type="button" data-step="1"><span>1</span> Places</button>
          <button type="button" data-step="2"><span>2</span> Geography</button>
          <button type="button" data-step="3"><span>3</span> Learning</button>
        </nav>
        <div class="facet-wizard-body">
          <p class="eyebrow">Custom practice / <span id="facet-step-count"></span></p>
          <section data-page="1">
            <h2 tabindex="-1">What would you like to explore?</h2>
            <p class="facet-description">Start with a kind of place. We’ll narrow it down together.</p>
            <label class="facet-choice"><input type="radio" name="scope" value="countries" checked aria-label="Countries & territories"><span><strong>Countries & territories</strong><small>The ${countries.length} mapped places in Atlas</small></span></label>
            <p class="facet-note">Cities and water features are outside this learning set.</p>
          </section>
          <section data-page="2" hidden>
            <h2 tabindex="-1">Where shall we go?</h2>
            <p class="facet-description">Go continent-wide or get to know a smaller region.</p>
            <div class="facet-geography">
              <label>Continent<select name="continent"></select></label>
              <label>Region<select name="region"></select></label>
            </div>
            <p class="facet-coverage" aria-live="polite"></p>
            <p class="facet-note">Groups follow each place’s Natural Earth region, including transcontinental countries. Open ocean includes territories outside the continental groups.</p>
          </section>
          <section data-page="3" hidden>
            <h2 tabindex="-1">What would you like to learn?</h2>
            <p class="facet-description">Practice a spatial skill, or slow down with country facts.</p>
            <fieldset class="facet-learning"><legend class="facet-note">Available learning options</legend>
              <label class="facet-choice"><input type="radio" name="learning" value="name-to-location" aria-label="Name-to-location" checked><span><strong>Name-to-location</strong><small>Find a named country on the map or globe.</small></span></label>
              <label class="facet-choice"><input type="radio" name="learning" value="shape-recognition" aria-label="Shape recognition"><span><strong>Shape recognition</strong><small>Identify a country from its outline alone. A separate skill and review schedule.</small></span></label>
              <label class="facet-choice"><input type="radio" name="learning" value="country-facts" aria-label="Country fact cards"><span><strong>Country fact cards</strong><small>Read sourced facts. Reading is not scored and does not reschedule reviews.</small></span></label>
            </fieldset>
          </section>
        </div>
        <footer class="facet-wizard-actions">
          <button class="secondary" type="button" data-action="cancel">Cancel</button>
          <button class="secondary" type="button" data-action="back">Back</button>
          <button class="primary" type="button" data-action="continue">Continue <span aria-hidden="true">→</span></button>
          <button class="primary" type="button" data-action="start" hidden>Start practice <span aria-hidden="true">→</span></button>
        </footer>
      </section>
      <aside class="facet-plan" aria-label="Practice plan">
        <p class="eyebrow">Your practice plan</p>
        <h2>A little more<br>of <em>the world.</em></h2>
        <p class="facet-plan-selection"></p>
        <p class="facet-plan-count" aria-live="polite"></p>
        <p class="facet-note">One learning history. Country practice uses the same proficiency and scheduled reviews as recommended practice. Reviews outside your selection stay scheduled.</p>
      </aside>
    </div>`;
  document.body.append(dialog);
  const continent = dialog.querySelector<HTMLSelectElement>('[name="continent"]')!;
  const region = dialog.querySelector<HTMLSelectElement>('[name="region"]')!;
  const start = dialog.querySelector<HTMLButtonElement>('[data-action="start"]')!;
  const next = dialog.querySelector<HTMLButtonElement>('[data-action="continue"]')!;
  const back = dialog.querySelector<HTMLButtonElement>('[data-action="back"]')!;
  let draft = defaultFacets();
  let step = 1;
  continent.replaceChildren(...Object.keys(continentRegions).map(name => new Option(name, name)));

  function renderRegions() {
    region.replaceChildren(...['All regions', ...continentRegions[draft.continent]].map(name => new Option(name, name)));
    region.value = draft.region;
  }
  function render(focusHeading = false) {
    dialog.querySelectorAll<HTMLElement>('[data-page]').forEach(page => { page.hidden = Number(page.dataset.page) !== step; });
    dialog.querySelectorAll<HTMLButtonElement>('[data-step]').forEach(button => {
      button.setAttribute('aria-current', Number(button.dataset.step) === step ? 'step' : 'false');
    });
    dialog.querySelector('#facet-step-count')!.textContent = `step ${step} of 3`;
    const coverage = `${countries.filter(country => matchesFacets(country, draft)).length} countries & territories`;
    dialog.querySelector('.facet-coverage')!.textContent = coverage;
    dialog.querySelector('.facet-plan-count')!.textContent = coverage;
    dialog.querySelector('.facet-plan-selection')!.textContent = describeFacets(draft);
    dialog.querySelector('.facet-plan em')!.textContent = `${draft.continent === 'Worldwide' ? 'the world' : draft.continent}.`;
    back.hidden = step === 1;
    next.hidden = step === 3;
    start.hidden = step !== 3;
    start.firstChild!.textContent = draft.learning === 'country-facts' ? 'Start reading ' : 'Start practice ';
    if (focusHeading) dialog.querySelector<HTMLElement>(`[data-page="${step}"] h2`)!.focus();
  }
  dialog.addEventListener('change', event => {
    const input = event.target as HTMLInputElement | HTMLSelectElement;
    if (input.name === 'continent') {
      draft.continent = continent.value as FacetSelection['continent'];
      draft.region = 'All regions';
      renderRegions();
    }
    if (input.name === 'region') draft.region = region.value;
    if (input.name === 'learning') draft.learning = input.value as FacetSelection['learning'];
    render();
  });
  dialog.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button) return;
    if (button.dataset.action === 'cancel') { dialog.close(); return; }
    if (button.dataset.action === 'start') { onStart({ ...draft }); dialog.close(); return; }
    if (button.dataset.step) step = Number(button.dataset.step);
    if (button.dataset.action === 'continue') step++;
    if (button.dataset.action === 'back') step--;
    render(true);
  });
  return {
    open(selection: FacetSelection | null) {
      draft = selection ? { ...selection } : defaultFacets();
      step = 1;
      continent.value = draft.continent;
      renderRegions();
      dialog.querySelector<HTMLInputElement>(`[name="learning"][value="${draft.learning}"]`)!.checked = true;
      render();
      dialog.showModal();
    },
  };
}
