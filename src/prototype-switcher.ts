// Throwaway, development-only controls shared by the three island variants.
export function mountPrototypeSwitcher(variants: Record<string, string>, onChange: (key: string) => void) {
  if (!import.meta.env.DEV) return;
  const keys = Object.keys(variants);
  const params = new URLSearchParams(location.search);
  let current = keys.includes(params.get('variant') ?? '') ? params.get('variant')! : keys[0];
  const bar = document.createElement('nav');
  bar.className = 'prototype-switcher';
  bar.setAttribute('aria-label', 'Prototype variants');
  bar.innerHTML = '<button type="button" aria-label="Previous variant">←</button><div><small>THROWAWAY PROTOTYPE</small><strong aria-live="polite"></strong></div><button type="button" aria-label="Next variant">→</button>';
  document.body.append(bar);
  const show = () => {
    const url = new URL(location.href);
    url.searchParams.set('variant', current);
    history.replaceState(null, '', url);
    bar.querySelector('strong')!.textContent = `${current} · ${variants[current]}`;
    onChange(current);
  };
  const cycle = (step: number) => {
    current = keys[(keys.indexOf(current) + step + keys.length) % keys.length];
    show();
  };
  bar.querySelector('button')!.addEventListener('click', () => cycle(-1));
  bar.querySelector('button:last-child')!.addEventListener('click', () => cycle(1));
  window.addEventListener('keydown', event => {
    if ((event.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    cycle(event.key === 'ArrowLeft' ? -1 : 1);
    event.stopPropagation();
  }, { capture: true });
  show();
}
