// Theme palette for the ASCII background: reads the site's CSS custom
// properties so glyph/splat colors always match the active theme
// (dark / light / viper — see CSS/theme.css). Re-reads on the `themechange`
// event fired on document by JS/theme.js.

function cssColor(name) {
	const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
	return parseColor(v);
}

// #rgb, #rrggbb, rgb()/rgba() → {r,g,b} in 0..1. Falls back to mid-grey.
function parseColor(s) {
	if (!s) return { r: 0.5, g: 0.5, b: 0.5 };
	if (s[0] === '#') {
		const hex = s.slice(1);
		const n = hex.length === 3
			? hex.split('').map(ch => parseInt(ch + ch, 16))
			: [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
		return { r: n[0] / 255, g: n[1] / 255, b: n[2] / 255 };
	}
	const m = s.match(/rgba?\(([^)]+)\)/);
	if (m) {
		const p = m[1].split(',').map(parseFloat);
		return { r: p[0] / 255, g: p[1] / 255, b: p[2] / 255 };
	}
	return { r: 0.5, g: 0.5, b: 0.5 };
}

export function readPalette() {
	const cls = document.documentElement.classList;
	return {
		isLight: cls.contains('light'),
		isViper: cls.contains('viper'),
		// heat / heatrev themes drive the fluid display through the demo's thermal
		// colormap (glsl.js heatRamp/heatRampRev) instead of raw dye inks, so the
		// index matches the FluidSimulation demo's vivid heat look.
		isHeat: cls.contains('heat'),
		isHeatRev: cls.contains('heatrev'),
		bg: cssColor('--bg'),
		tx: cssColor('--tx'),
		// Ink hues for dye splats — per-theme vars already carry the right
		// lightness (light theme's --gold/--coral are pre-darkened to ink).
		inks: [
			cssColor('--gold'),
			cssColor('--coral'),
			cssColor('--gold-hi'),
			cssColor('--coral-hi'),
		],
	};
}

// Calls back immediately with the current palette, then on every theme change.
export function onPalette(cb) {
	cb(readPalette());
	document.addEventListener('themechange', () => cb(readPalette()));
}
