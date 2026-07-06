// Test harness for the asciibg pipeline (ASCII_REDESIGN_PLAN.md Phases 1-2).
// Fluid core + ASCII pass + theme palette; auto-splats for headless screenshots,
// mouse-move splats, theme-cycle button (dark → light → viper).

import { createFluid } from './fluid-core.js';
import { createAsciiPass } from './ascii-pass.js';
import { createAmbient } from './ambient.js';
import { createCardanScene } from './cardan-scene.js';
import { createUiLink } from './ui-link.js';
import { createDyeReadback } from './dye-readback.js';
import { readPalette, onPalette } from './theme-palette.js';

const canvas = document.getElementById('asciibgCanvas');
const stat = document.getElementById('stat');

function sizeCanvas() {
	const pr = Math.min(window.devicePixelRatio || 1, 2);
	canvas.width = Math.floor(window.innerWidth * pr);
	canvas.height = Math.floor(window.innerHeight * pr);
}
sizeCanvas();

const fluid = createFluid(canvas);
if (!fluid) {
	stat.textContent = 'WebGL2 unavailable';
	throw new Error('WebGL2 unavailable');
}
const ascii = createAsciiPass(fluid.gl, fluid.blit, fluid.baseVS);
const ambient = createAmbient(fluid.gl, fluid.blit, fluid.baseVS, fluid);
const uiLink = createUiLink(fluid.gl, fluid.blit, fluid.baseVS, fluid);
const readback = createDyeReadback(fluid.gl, fluid.blit, fluid.baseVS, fluid, { SELECTOR: '#hoverProbe' });
// ?rb=1: log the probe's fluid vars twice so a headless run verifies the
// readback→CSS-var path end to end (values move between the two logs).
if (new URLSearchParams(location.search).get('rb') === '1') {
	const logVars = tag => {
		const el = document.getElementById('hoverProbe');
		console.log('[rb ' + tag + '] tint=' + el.style.getPropertyValue('--fluid-tint') +
			' amt=' + el.style.getPropertyValue('--fluid-amt'));
	};
	setTimeout(() => logVars('t4'), 4000);
	setTimeout(() => logVars('t7'), 7000);
}
const cardan = createCardanScene(fluid.gl, fluid.blit, fluid.baseVS);
function cardanResize() { cardan.resize(Math.max(4, canvas.width >> 1), Math.max(4, canvas.height >> 1)); }
cardanResize();
function drawScene(target) {
	fluid.setColorMode(palette.isHeat ? 'heat' : palette.isHeatRev ? 'heatrev' : 'none');
	fluid.drawDisplay(target);
	cardan.compositeInto(target);
}

let palette = readPalette();
onPalette(p => {
	palette = p;
	document.body.style.background =
		'rgb(' + (p.bg.r * 255 | 0) + ',' + (p.bg.g * 255 | 0) + ',' + (p.bg.b * 255 | 0) + ')';
});

window.addEventListener('resize', () => { sizeCanvas(); fluid.resize(); ascii.resize(); cardanResize(); });

// ── theme cycle button (harness only — the real page uses JS/theme.js) ──
const THEME_CYCLE = ['dark', 'light', 'viper', 'heat', 'heatrev'];
let themeIdx = 0;
document.getElementById('btnTheme').addEventListener('click', () => {
	themeIdx = (themeIdx + 1) % THEME_CYCLE.length;
	setTestTheme(THEME_CYCLE[themeIdx]);
});
function setTestTheme(name) {
	const cls = document.documentElement.classList;
	cls.remove('light'); cls.remove('viper'); cls.remove('heat'); cls.remove('heatrev');
	if (name !== 'dark') cls.add(name);
	document.dispatchEvent(new CustomEvent('themechange', { detail: { theme: name, isLight: name === 'light' } }));
}

// Boot param for headless theme screenshots: test.html?theme=light|viper|heat|heatrev
const bootTheme = new URLSearchParams(location.search).get('theme');
if (THEME_CYCLE.includes(bootTheme) && bootTheme !== 'dark') {
	themeIdx = THEME_CYCLE.indexOf(bootTheme);
	setTestTheme(bootTheme);
}

// ── splat colors from the theme palette ──
function inkColor(mul) {
	const ink = palette.inks[(Math.random() * palette.inks.length) | 0];
	return { r: ink.r * mul, g: ink.g * mul, b: ink.b * mul };
}

// ── mouse-move splats ──
let lastX = -1, lastY = -1;
window.addEventListener('pointermove', e => {
	const rect = canvas.getBoundingClientRect();
	const x = (e.clientX - rect.left) / rect.width;
	const y = 1.0 - (e.clientY - rect.top) / rect.height;
	if (lastX >= 0) {
		const dx = (x - lastX) * fluid.cfg.SPLAT_FORCE;
		const dy = (y - lastY) * fluid.cfg.SPLAT_FORCE;
		if (dx !== 0 || dy !== 0) fluid.splat(x, y, dx, dy, inkColor(0.10));
	}
	lastX = x; lastY = y;
});

// ── auto-splats: seed + interval, so a headless screenshot shows content ──
function randomSplat(strength = 600, mul = 0.55) {
	fluid.splat(
		0.15 + Math.random() * 0.7, 0.15 + Math.random() * 0.7,
		strength * (Math.random() - 0.5), strength * (Math.random() - 0.5),
		inkColor(mul));
}
// test.html?splats=0 disables them — isolates the ambient-noise look (3.3b).
const wantSplats = new URLSearchParams(location.search).get('splats') !== '0';
// Ring→fluid stir off by default (matches index); test.html?stir=1 re-enables.
const wantStir = new URLSearchParams(location.search).get('stir') === '1';

// test.html?hover=1 fakes a persistent hover on #hoverProbe (Phase 5 headless
// verify — repulsion + glow band should show around the probe rect).
if (new URLSearchParams(location.search).get('hover') === '1') {
	document.getElementById('hoverProbe').dispatchEvent(
		new MouseEvent('mouseover', { bubbles: true }));
}

// test.html?text=1: stamp two demo hero lines into the lattice (Phase 7 check —
// scaled Web437 glyph blocks, dye washing through them).
if (new URLSearchParams(location.search).get('text') === '1') {
	const stamp = () => {
		const t = ascii.text;
		t.clear();
		t.writeText(6, ascii.rows - 24, 'Make it', { r: 0.95, g: 0.90, b: 0.85 }, 7);
		t.writeText(6, ascii.rows - 42, 'flow.', palette.inks[0], 7);
	};
	stamp();
	ascii.onFontReady(stamp);
}
if (wantSplats) {
	for (let i = 0; i < 8; i++) randomSplat(1200, 0.7);
	setInterval(() => randomSplat(), 900);
}

// test.html?warmup=N — run N sim steps synchronously at boot (headless SwiftShader
// is ~12fps; this fast-forwards the ambient field so screenshots show a developed state).
const warmup = parseInt(new URLSearchParams(location.search).get('warmup')) || 0;
for (let i = 0; i < warmup; i++) {
	ambient.apply(1 / 60, palette);
	fluid.step(1 / 60);
}

// ── loop ──
let last = performance.now();
let frames = 0, fpsLast = last;
function tick(now) {
	const dt = Math.min((now - last) / 1000, 0.016666);
	last = now;
	ambient.apply(dt, palette);
	uiLink.apply(dt, palette);
	fluid.step(dt);
	cardan.draw(now, dt);
	if (wantStir) cardan.stir(fluid, palette.inks);
	readback.apply();
	ascii.render(drawScene, palette, { cardanMask: true });
	frames++;
	if (now - fpsLast >= 500) {
		stat.textContent = Math.round(frames * 1000 / (now - fpsLast)) + ' fps · ' +
			ascii.cols + 'x' + ascii.rows + ' cells';
		frames = 0; fpsLast = now;
	}
	requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
