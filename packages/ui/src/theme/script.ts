export const THEME_STORAGE_KEY = 'theme';

// Runs before hydration (next/script beforeInteractive), so the first paint
// already has the right class.
export const themeScript = `(function () {
  try {
    var stored = localStorage.getItem('${THEME_STORAGE_KEY}');
    var dark = stored === 'dark' ||
      ((stored === null || stored === 'system') &&
        window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.add(dark ? 'dark' : 'light');
  } catch (e) {}
})();`;
