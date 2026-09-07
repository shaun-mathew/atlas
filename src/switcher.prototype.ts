// THROWAWAY prototype chrome, shared by both renderings on the existing / route.
export function PrototypeSwitcher(current: 'A' | 'B', onSwitch: (variant: 'A' | 'B') => void) {
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

  function switchDesign() {
    current = current === 'A' ? 'B' : 'A';
    const url = new URL(location.href);
    url.searchParams.set('variant', current);
    history.replaceState(null, '', url);
    onSwitch(current);
  }
  tools.querySelectorAll('button').forEach(button => button.addEventListener('click', switchDesign));
  document.addEventListener('keydown', event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if ((event.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return;
    event.preventDefault();
    switchDesign();
  });

  return {
    update(variant: 'A' | 'B', snapshot: object) {
      current = variant;
      label.textContent = variant === 'A' ? 'A · Field Guide' : 'B · Map First';
      state.textContent = JSON.stringify(snapshot, null, 2);
    },
  };
}
