// Minimal progressive enhancement
(function () {
  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  // Theme toggle (persists in localStorage)
  const btn = document.getElementById('toggle-theme');
  const key = 'sheq-theme';
  const apply = (mode) => {
    if (mode === 'dark') document.documentElement.style.colorScheme = 'dark';
    else if (mode === 'light') document.documentElement.style.colorScheme = 'light';
    else document.documentElement.style.colorScheme = 'normal';
  };
  const saved = localStorage.getItem(key);
  if (saved) apply(saved);
  if (btn) {
    btn.addEventListener('click', () => {
      const curr = localStorage.getItem(key);
      const next = curr === 'dark' ? 'light' : (curr === 'light' ? 'normal' : 'dark');
      localStorage.setItem(key, next);
      apply(next);
      btn.setAttribute('aria-pressed', next === 'dark');
    });
  }

  // Example: wire up KPI placeholders from a future endpoint
  // Replace with real fetch to your API/Power BI embedded values
  const mock = { leadingKpi: '12', laggingKpi: '3', envKpi: '5' };
  for (const [key, val] of Object.entries(mock)) {
    const el = document.querySelector(`[data-bind="${key}"]`);
    if (el) el.textContent = val;
  }
})();
