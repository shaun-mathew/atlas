import type { PrototypeView } from './session.prototype';
import './field-guide.prototype.css';

// Throwaway Field Guide layout for the country-session design comparison on /.
export function FieldGuidePrototype(view: PrototypeView): string {
  const questionIndex = String(view.questionNumber).padStart(2, '0');

  return `
    <div class="field-guide">
      <header class="fg-masthead">
        <div class="fg-wordmark">
          <svg class="fg-compass" viewBox="0 0 40 40" fill="none" aria-hidden="true">
            <circle cx="20" cy="20" r="14" stroke="currentColor" stroke-width="1" />
            <path d="M20 1v7M20 32v7M1 20h7M32 20h7" stroke="currentColor" />
            <path d="m25 11-3 11-7 7 3-11 7-7Z" fill="currentColor" />
            <circle cx="20" cy="20" r="2" fill="#f8f5ed" />
          </svg>
          <span>Atlas<span class="fg-wordmark-dot">.</span></span>
        </div>
        <span class="fg-edition">A field guide to the world</span>
        <span class="fg-masthead-note">Country practice</span>
      </header>

      <div class="fg-study">
        <section class="fg-prompt" aria-labelledby="fg-question">
          <div class="fg-eyebrow"><span class="fg-index">${questionIndex}</span> Name-to-location</div>
          <h1 id="fg-question">Where is <br /><em>${view.countryName}?</em></h1>
          <p class="fg-introduction">Take a look around.<br class="fg-desktop-break" /> Mark where you think it belongs.</p>
        </section>

        <section class="fg-map-section" aria-label="Practice map">
          <div class="fg-map-heading">
            <span class="fg-eyebrow">The world, unlabelled</span>
            <button class="fg-world" type="button" data-action="world" aria-label="Reset map to world view">
              <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6" stroke="currentColor" /><ellipse cx="8" cy="8" rx="2.5" ry="6" stroke="currentColor" /><path d="M2 8h12" stroke="currentColor" /></svg>
              World view
            </button>
          </div>
          <div class="fg-map-frame"><div id="prototype-map" class="fg-map" aria-label="Select a point on the world map"></div></div>
          <div class="fg-map-caption"><span>Tap to mark · Drag to explore</span><span class="fg-map-caption-right">A study in spatial recall</span></div>
        </section>

        <section class="fg-response" aria-label="Your answer">
          ${view.feedback ? `
            <div class="fg-annotation ${view.feedback === 'correct' ? 'fg-annotation-correct' : 'fg-annotation-incorrect'}" role="status">
              <span class="fg-eyebrow">Field note / ${questionIndex}</span>
              <h2>${view.feedback === 'correct' ? 'Correct. Nicely placed.' : 'Not quite. Take a look.'}</h2>
              <p>${view.countryName} is highlighted on the map.<span class="fg-region">${view.region}</span></p>
            </div>
            <span class="fg-selection fg-feedback-selection" data-selection-hint>Your point is marked on the map.</span>
            <button class="fg-primary" type="button" data-action="next"><span>Next country</span><span aria-hidden="true">→</span></button>
          ` : `
            <div class="fg-selection" role="status"><span class="fg-selection-dot" aria-hidden="true"></span><span data-selection-hint>${view.selected ? 'Your point is marked. Ready to check?' : 'Choose a point on the map'}</span></div>
            <button class="fg-primary" type="button" data-action="check" ${view.selected ? '' : 'disabled'}><span>Check location</span><span aria-hidden="true">→</span></button>
            <p class="fg-tolerance">Within 25 km of the coast counts, too. Another country does not.</p>
          `}
          <div class="fg-practice-counts" aria-label="Practice results">
            <span><strong>${view.answered}</strong> answered</span><span><strong>${view.correct}</strong> correct</span><span class="fg-counts-label">This practice</span>
          </div>
        </section>
      </div>

      <footer class="fg-footer"><span>Look closer. Know the world.</span><span>Countries & territories / Name-to-location</span></footer>
    </div>
  `;
}
