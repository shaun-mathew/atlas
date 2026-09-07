import type { PrototypeView } from './session.prototype';
import './map-studio.prototype.css';

// THROWAWAY C: a full-width map workspace; question and action share a top bar.
// Unlike A's reading column and B's floating panel, the map has its own clear zone.
export function MapStudioPrototype(view: PrototypeView): string {
  const answered = view.feedback !== null;
  return `
    <div class="map-studio">
      <header class="ms-header">
        <div class="ms-brand"><svg viewBox="0 0 28 28" fill="none" aria-hidden="true"><rect x="2" y="2" width="24" height="24" rx="8" fill="currentColor"/><path d="m8 20 6-13 6 13m-9.5-5h7" stroke="white" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Atlas<span class="ms-brand-dot">.</span></span></div>
        <span class="ms-header-label">A practice in perspective</span>
        <span class="ms-guest"><span aria-hidden="true"></span>Guest practice</span>
      </header>

      <section class="ms-command" aria-label="Current learning item">
        <div class="ms-question">
          <p class="ms-eyebrow">Country practice <span>/</span> ${String(view.questionNumber).padStart(2, '0')}</p>
          <h1>Find <strong>${view.countryName}</strong><span class="ms-heading-dot">.</span></h1>
        </div>
        <div class="ms-answer-group">
          <div class="ms-answer-copy${answered ? ' ms-result' : ''}" ${answered ? 'role="status"' : ''}>
            <span class="ms-step-label">${answered ? view.feedback === 'correct' ? 'You found it' : 'A new place to remember' : 'Your move'}</span>
            <p>${answered ? view.feedback === 'correct' ? 'Correct. Keep exploring.' : 'Not quite. See the highlighted country.' : '<span data-selection-hint>Place a pin on the map below.</span>'}</p>
          </div>
          <button class="ms-primary" type="button" data-action="${answered ? 'next' : 'check'}" ${!answered && !view.selected ? 'disabled' : ''}>${answered ? 'Next country' : 'Check location'}<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M3 10h13m-5-5 5 5-5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        </div>
      </section>

      <section class="ms-workspace" aria-label="Map workspace">
        <div class="ms-map-toolbar">
          <span class="ms-map-label"><span class="ms-location-mark" aria-hidden="true"></span> ${answered ? `${view.countryName} / ${view.region}` : 'World / Unlabelled'}</span>
          <button type="button" data-action="world" class="ms-world"><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="7" stroke="currentColor"/><ellipse cx="10" cy="10" rx="3" ry="7" stroke="currentColor"/><path d="M3 10h14" stroke="currentColor"/></svg>World view</button>
        </div>
        <div class="ms-map-area"><div id="prototype-map" class="ms-map"></div><span class="ms-map-source">Natural Earth / 1:50m</span></div>
        <div class="ms-map-footer"><p><strong>${view.answered}</strong> answered <span>·</span> <strong>${view.correct}</strong> correct</p><span class="ms-map-tip">Drag to explore. Zoom to look closer.</span><span class="ms-tolerance">25 km tolerance</span></div>
      </section>
      <div class="ms-prototype-space" aria-hidden="true"></div>
    </div>`;
}
