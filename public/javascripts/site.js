// Site-wide appearance: light / dark / system theme and accent color (header menu).
(function () {
  const THEME_KEY = 'mv-site-theme';
  const ACCENT_KEY = 'mv-site-accent';
  const root = document.documentElement;
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const write = (k, v) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* ignore */ } };

  function applyTheme(mode) {
    const dark = mode === 'dark' || (mode === 'system' && media.matches);
    root.dataset.theme = dark ? 'dark' : 'light';
  }
  function applyAccent(color) {
    if (color) root.style.setProperty('--site-accent', color);
    else root.style.removeProperty('--site-accent');
  }
  media.addEventListener('change', () => {
    if ((read(THEME_KEY) || 'system') === 'system') applyTheme('system');
  });

  const wrap = document.querySelector('.site-appearance');
  if (!wrap) return;
  const btn = wrap.querySelector('[data-appearance-btn]');
  const pop = wrap.querySelector('.site-pop');

  function sync() {
    const mode = read(THEME_KEY) || 'system';
    const accent = read(ACCENT_KEY) || '';
    pop.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    pop.querySelectorAll('[data-accent]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.accent === accent)));
  }
  function open(show) {
    pop.hidden = !show;
    btn.setAttribute('aria-expanded', String(show));
    if (show) {
      sync();
      (pop.querySelector('[aria-pressed="true"]') || pop.querySelector('button')).focus();
    }
  }
  btn.addEventListener('click', () => open(pop.hidden));
  document.addEventListener('click', (e) => { if (!pop.hidden && !wrap.contains(e.target)) open(false); });
  wrap.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !pop.hidden) { open(false); btn.focus(); }
  });
  pop.addEventListener('click', (e) => {
    const m = e.target.closest('[data-mode]');
    if (m) {
      write(THEME_KEY, m.dataset.mode === 'system' ? null : m.dataset.mode);
      applyTheme(m.dataset.mode);
    }
    const a = e.target.closest('[data-accent]');
    if (a) {
      write(ACCENT_KEY, a.dataset.accent || null);
      applyAccent(a.dataset.accent);
    }
    sync();
  });
})();
