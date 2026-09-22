// Placeholder: scripts/generate-themes.mjs (P3) generates the real file from themes.json.
// Runs before the app bootstraps, so the first paint already carries the theme attributes.
(() => {
  const root = document.documentElement;
  let mode = null;
  try {
    mode = localStorage.getItem('billet-studio.color-mode');
  } catch {
    // Storage blocked (private mode, sandboxed frame): fall back to the system preference.
  }
  if (mode !== 'light' && mode !== 'dark') {
    mode = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  root.dataset.theme = 'rose';
  root.dataset.mode = mode;
})();
