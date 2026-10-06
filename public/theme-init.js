// Applies the saved app theme before the first paint, so the page never flashes the wrong
// colours. Loaded as a blocking file because the CSP forbids inline scripts.
// Keep the key, values and colours in sync with src/lib/theme.ts.
;(function () {
  var pref = 'light'
  try {
    pref = localStorage.getItem('witik-theme') || 'light'
  } catch (e) {
    // Storage blocked: fall back to the default theme.
  }
  var dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
  var meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', dark ? '#2A1F26' : '#F5E0E8')
})()
