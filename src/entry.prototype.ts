// THROWAWAY: two country-session designs on /?variant=A or /?variant=B.
// Question: editorial Field Guide or immersive Map First, especially on mobile?
// No winning design has been selected. Production still loads the real app.
if (import.meta.env.DEV) {
  void import('./session.prototype');
} else {
  void import('./main');
}
