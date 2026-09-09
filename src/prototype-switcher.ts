// Throwaway development-only UI; not a production navigation component.
export function PrototypeSwitcher(current: string, change: (key: string) => void) {
  const variants = ['A', 'B', 'C', 'D'];
  const names = ['Mixed practice', 'City lab', 'Geography tracks', 'Tracks + borders'];
  const bar = document.createElement('nav');
  bar.className = 'prototype-switcher';
  bar.setAttribute('aria-label', 'Prototype variants');
  if (!import.meta.env.DEV) return bar;
  bar.innerHTML = `<button aria-label="Previous variant">←</button><span><small>THROWAWAY PROTOTYPE</small><b>${current} · ${names[variants.indexOf(current)]}</b></span><button aria-label="Next variant">→</button>`;
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
