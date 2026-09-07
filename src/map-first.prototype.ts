import type { PrototypeView } from './session.prototype';
import './map-first.prototype.css';

// Throwaway design B: a map-led practice session on the existing / route.
export function MapFirstPrototype(view: PrototypeView): string {
  const hasFeedback = view.feedback !== null;
  const isCorrect = view.feedback === 'correct';
  const questionIndex = String(view.questionNumber).padStart(2, '0');

  return `
    <div class="map-first">
      <div id="prototype-map" class="mf-map" aria-label="Interactive world map. Select the location of ${view.countryName}."></div>
      <div class="mf-vignette" aria-hidden="true"></div>

      <header class="mf-header">
        <div class="mf-brand">
          <svg class="mf-brand-mark" viewBox="0 0 32 32" fill="none" aria-hidden="true">
            <circle cx="16" cy="16" r="13" stroke="currentColor" stroke-width="1.2" />
            <path d="m21 10-3 9-8 3 3-9 8-3Z" stroke="currentColor" stroke-width="1.2" />
            <path d="m21 10-8 3 5 6 3-9Z" fill="currentColor" />
          </svg>
          <span>Atlas<span class="mf-brand-subtitle">A little further, every day.</span></span>
        </div>
        <button class="mf-world" type="button" data-action="world">
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="1.3" />
            <ellipse cx="10" cy="10" rx="3" ry="7" stroke="currentColor" stroke-width="1.3" />
            <path d="M3 10h14" stroke="currentColor" stroke-width="1.3" />
          </svg>
          World view
        </button>
      </header>

      <aside class="mf-status" aria-label="Practice results">
        <div><span class="mf-status-value">${view.answered}</span><span class="mf-status-label">answered</span></div>
        <span class="mf-status-divider" aria-hidden="true"></span>
        <div><span class="mf-status-value mf-status-correct">${view.correct}</span><span class="mf-status-label">correct</span></div>
      </aside>

      <section class="mf-panel" aria-labelledby="mf-country">
        <div class="mf-question">
          <div class="mf-question-meta"><span class="mf-live-dot" aria-hidden="true"></span> Country practice <span class="mf-question-index">Q. ${questionIndex}</span></div>
          <p class="mf-prompt">Where is</p>
          <h1 id="mf-country">${view.countryName}<span class="mf-question-mark">?</span></h1>
          <p class="mf-instruction">Find it. Drop a pin. Trust your bearings.</p>
        </div>

        <div class="mf-dock${hasFeedback ? ' mf-dock-feedback' : ''}">
          ${hasFeedback ? `
            <div class="mf-feedback" role="status">
              <span class="mf-feedback-symbol${isCorrect ? '' : ' mf-feedback-reveal'}" aria-hidden="true">${isCorrect ? '✓' : '↗'}</span>
              <div>
                <p class="mf-feedback-title">${isCorrect ? 'Right on the map.' : 'Not quite. Here’s the country.'}</p>
                <p class="mf-feedback-detail">${view.countryName} · ${view.region}<br>The country is highlighted on the map.</p>
              </div>
            </div>
            <button class="mf-primary" type="button" data-action="next">Next country <span aria-hidden="true">→</span></button>
          ` : `
            <p class="mf-selection" data-selection-hint>${view.selected ? 'Pin placed. Ready when you are.' : 'Tap the map to place your pin.'}</p>
            <button class="mf-primary" type="button" data-action="check" ${view.selected ? '' : 'disabled'}>Check location <span aria-hidden="true">→</span></button>
          `}
        </div>
      </section>

      <div class="mf-map-caption" aria-hidden="true"><span class="mf-caption-line"></span> A world worth knowing</div>
    </div>
  `;
}
