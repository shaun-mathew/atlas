// Throwaway island-assistance UI; the normal learner session stays untouched.
if (import.meta.env.DEV && (import.meta.env.MODE === 'island-prototype' || new URLSearchParams(location.search).has('variant'))) {
  void import('./island-prototype');
} else {
  void import('./main');
}
