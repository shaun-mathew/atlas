// Throwaway development-only UI; not a production navigation component.
export function PrototypeSwitcher(current: string, change: (key: string) => void) {
  const flowSet = ['E', 'F', 'G', 'H'].includes(current);
  const variants = flowSet ? ['E', 'F', 'G', 'H'] : ['A', 'B', 'C', 'D'];
  const names: Record<string, string> = { A:'Mixed practice', B:'City lab', C:'Geography tracks', D:'Tracks + borders', E:'Country → city', F:'Regional circuit', G:'Fading context', H:'Overview + close-up' };
  const bar = document.createElement('nav');
  bar.className = 'prototype-switcher';
  bar.setAttribute('aria-label', 'Prototype variants');
  if (!import.meta.env.DEV) return bar;
  const otherSet = new URL(location.href);
  otherSet.searchParams.set('variant', flowSet ? 'A' : 'E');
  bar.innerHTML = `<button aria-label="Previous variant">←</button><span><small>PROTOTYPE · ${flowSet ? 'E–H LEARNING FLOWS' : 'A–D MAP LAYOUTS'}</small><b>${current} · ${names[current]}</b><a class="prototype-set-link" href="${otherSet.href}">${flowSet ? 'Compare A–D map layouts' : 'Try E–H learning flows'}</a></span><button aria-label="Next variant">→</button>`;
  bar.querySelector('a')!.onclick = event => {
    event.preventDefault();
    history.replaceState(null, '', otherSet);
    change(flowSet ? 'A' : 'E');
  };
  function cycle(step: number) {
    const key = variants[(variants.indexOf(current) + step + variants.length) % variants.length];
    const url = new URL(location.href);
    url.searchParams.set('variant', key);
    history.replaceState(null, '', url);
    change(key);
  }
  bar.querySelectorAll('button').forEach((button, index) => button.onclick = () => cycle(index ? 1 : -1));
  const onKey = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, select, [contenteditable], [role="slider"], .leaflet-container, dialog')) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      cycle(event.key === 'ArrowRight' ? 1 : -1);
    }
  };
  window.addEventListener('keydown', onKey);
  return { element: bar, dispose: () => window.removeEventListener('keydown', onKey) };
}
