// Light / dark / auto theme, stored per device.

export function applyTheme() {
  let mode = 'auto';
  try { mode = localStorage.getItem('daybook.theme') || 'auto'; } catch { /* ignore */ }
  const root = document.documentElement;
  if (mode === 'auto') delete root.dataset.theme;
  else root.dataset.theme = mode;
  const dark = mode === 'dark' || (mode === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#141413' : '#f7f6f2');
}
