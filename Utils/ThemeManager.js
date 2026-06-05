// Theme-change subscription shared by the demos. Calls back immediately with the current theme,
// then again on every `themechange` event fired by JS/theme.js. `isLight` is true when the
// <html> element carries the `light` class.
export function onThemeChange(callback) {
	callback(document.documentElement.classList.contains('light'));
	document.addEventListener('themechange', (event) => callback(event.detail.isLight));
}
