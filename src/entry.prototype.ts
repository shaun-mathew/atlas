// THROWAWAY: three country-session designs on /?variant=A, B, or C.
// Question: Field Guide, Map First, or a top-bar Map Studio, especially on mobile?
// No winning design has been selected. Production still loads the real app.
if (import.meta.env.DEV) {
  void import('./session.prototype');
} else {
  void import('./main');
}
