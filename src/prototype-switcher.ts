// Throwaway design navigation. No framework router exists in this Vite app.
export function mountPrototypeSwitcher(onChange: (variant: string) => void) {
  const variants = ['A', 'B', 'C'];
  const names = ['Atlas sidebar', 'Guided setup', 'Practice workbench'];
  const bar = document.createElement('nav');
  bar.className = 'prototype-switcher';
  bar.setAttribute('aria-label', 'Prototype variations');
  bar.innerHTML = '<small>DESIGN LAB</small><button aria-label="Previous variant">←</button><strong></strong><button aria-label="Next variant">→</button>';
  if (!import.meta.env.DEV) return;
  document.body.append(bar);
  function render() {
    const value = new URLSearchParams(location.search).get('variant') ?? 'A';
    const index = Math.max(0, variants.indexOf(value));
    bar.querySelector('strong')!.textContent = `${variants[index]} / ${names[index]}`;
    onChange(variants[index]);
  }
  function cycle(direction: number) {
    const url = new URL(location.href);
    const current = Math.max(0, variants.indexOf(url.searchParams.get('variant') ?? 'A'));
    url.searchParams.set('variant', variants[(current + direction + variants.length) % variants.length]);
    history.replaceState(null, '', url);
    render();
  }
  bar.querySelectorAll('button')[0].onclick = () => cycle(-1);
  bar.querySelectorAll('button')[1].onclick = () => cycle(1);
  window.addEventListener('keydown', event => {
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="slider"]') || target.closest('.leaflet-container')) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      cycle(event.key === 'ArrowLeft' ? -1 : 1);
    }
  });
  window.addEventListener('popstate', render);
  render();
}
