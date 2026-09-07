// THROWAWAY prototype chrome, shared by all renderings on the existing / route.
export const prototypeDesigns = { A: 'Field Guide', B: 'Map First', C: 'Map Studio' } as const;
export type PrototypeVariant = keyof typeof prototypeDesigns;

export function PrototypeSwitcher(current: PrototypeVariant, onSwitch: (variant: PrototypeVariant) => void) {
  const variants = Object.keys(prototypeDesigns) as PrototypeVariant[];
  const tools = document.createElement('aside');
  tools.className = 'prototype-tools';
  tools.setAttribute('aria-label', 'Prototype design switcher');
  tools.innerHTML = `
    <span class="prototype-tag">DESIGN LAB<span>In memory · Not saved</span></span>
    <button class="prototype-arrow" data-direction="previous" aria-label="Previous design">←</button>
    <div class="prototype-design" aria-live="polite"></div>
    <button class="prototype-arrow" data-direction="next" aria-label="Next design">→</button>
    <details class="prototype-inspector"><summary>State</summary><div class="prototype-state-panel"><strong>Live prototype state</strong><p>Refresh starts over. Design switches keep this session.</p><pre></pre></div></details>`;
  document.body.append(tools);
  const label = tools.querySelector<HTMLDivElement>('.prototype-design')!;
  const state = tools.querySelector('pre')!;

  function switchDesign(direction: number) {
    current = variants[(variants.indexOf(current) + direction + variants.length) % variants.length];
    const url = new URL(location.href);
    url.searchParams.set('variant', current);
    history.replaceState(null, '', url);
    onSwitch(current);
  }
  tools.querySelectorAll<HTMLButtonElement>('button').forEach(button => {
    button.addEventListener('click', () => switchDesign(button.dataset.direction === 'previous' ? -1 : 1));
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if ((event.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return;
    event.preventDefault();
    switchDesign(event.key === 'ArrowLeft' ? -1 : 1);
  });

  return {
    update(variant: PrototypeVariant, snapshot: object) {
      current = variant;
      label.textContent = `${variant} · ${prototypeDesigns[variant]}`;
      state.textContent = JSON.stringify(snapshot, null, 2);
    },
  };
}
