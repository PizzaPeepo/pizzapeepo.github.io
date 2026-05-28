/* theme.js — shared theme toggle for Canvas Lab demo pages */
(function () {
  var root  = document.documentElement;
  var btn   = document.getElementById('themeToggle');
  if (!btn) return;
  var icon  = btn.querySelector('.toggle-icon');
  var label = btn.querySelector('.toggle-label');

  function applyTheme(isLight) {
    root.classList.toggle('light', isLight);
    if (icon)  icon.textContent  = isLight ? '☾' : '☀';
    if (label) label.textContent = isLight ? 'Dark' : 'Light';
    // Let demo JS react if it wants to
    document.dispatchEvent(new CustomEvent('themechange', { detail: { isLight: isLight } }));
  }

  applyTheme(localStorage.getItem('theme') === 'light');

  btn.addEventListener('click', function () {
    var isLight = !root.classList.contains('light');
    applyTheme(isLight);
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
  });
})();
