/* theme.js — shared theme toggle for Canvas Lab demo pages */
(function () {
  var root  = document.documentElement;
  var btn   = document.getElementById('themeToggle');
  if (!btn) return;
  var icon  = btn.querySelector('.toggle-icon');
  var label = btn.querySelector('.toggle-label');

  var THEMES = ['viper', 'dark', 'light'];
  var META = {
    viper: { icon: '❋', label: 'Viper' },
    dark:  { icon: '☀', label: 'Ember' },
    light: { icon: '☾', label: 'Light' },
  };

  function applyTheme(theme) {
    root.classList.toggle('light', theme === 'light');
    root.classList.toggle('viper', theme === 'viper');
    if (icon)  icon.textContent  = META[theme].icon;
    if (label) label.textContent = META[theme].label;
    document.dispatchEvent(new CustomEvent('themechange', {
      detail: { theme: theme, isLight: theme === 'light' }
    }));
  }

  var theme = localStorage.getItem('theme');
  if (THEMES.indexOf(theme) === -1) theme = 'viper';
  applyTheme(theme);

  btn.addEventListener('click', function () {
    theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    applyTheme(theme);
    localStorage.setItem('theme', theme);
  });
})();
