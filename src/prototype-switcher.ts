// Throwaway development-only UI; not a production navigation component.
export function PrototypeSwitcher(current: string, change: (key: string) => void) {
  const flowSet = ['E', 'F', 'G', 'H'].includes(current);
  const quizSet = ['I', 'J'].includes(current);
  const chooserSet = ['K', 'L', 'M', 'N'].includes(current);
  const variants = chooserSet ? ['K', 'L', 'M', 'N'] : quizSet ? ['I', 'J'] : flowSet ? ['E', 'F', 'G', 'H'] : ['A', 'B', 'C', 'D'];
  const names: Record<string, string> = { A:'Mixed practice', B:'City lab', C:'Geography tracks', D:'Tracks + borders', E:'Country → city', F:'Regional circuit', G:'Fading context', H:'Overview + close-up', I:'Top quiz tabs', J:'Quiz side rail', K:'Toolbar · baseline', L:'Header · dialog', M:'Question · dropdown', N:'Floating · drawer' };
  const bar = document.createElement('nav');
  bar.className = 'prototype-switcher';
  bar.setAttribute('aria-label', 'Prototype variants');
  if (!import.meta.env.DEV) return bar;
  const group = chooserSet ? 'K' : quizSet ? 'I' : flowSet ? 'E' : 'A';
  bar.innerHTML = `<button aria-label="Previous variant">←</button><span><small>THROWAWAY PROTOTYPE</small><b>${current} · ${names[current]}</b><select class="prototype-set-select" aria-label="Prototype comparison set"><option value="K">K–N · Change quiz</option><option value="I">I–J · Quiz switching</option><option value="A">A–D · Map layouts</option><option value="E">E–H · Learning flows</option></select></span><button aria-label="Next variant">→</button>`;
  const groupPicker = bar.querySelector('select')!;
  groupPicker.value = group;
  groupPicker.onchange = () => {
    const url = new URL(location.href);
    url.searchParams.set('variant', groupPicker.value);
    history.replaceState(null, '', url);
    change(groupPicker.value);
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
