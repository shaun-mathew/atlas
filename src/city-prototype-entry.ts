// Throwaway city-testing variants on the existing / route; production uses the real app.
// Static imports would execute both side-effectful app bootstraps and initialize real accounts.
if (import.meta.env.DEV && new URLSearchParams(location.search).has('variant')) {
  await import('./city-prototype');
} else {
  await import('./main');
}
export {};
