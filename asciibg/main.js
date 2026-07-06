// Index-page ASCII fluid background (ASCII_REDESIGN_PLAN.md Phase 3).
// Self-mounting: creates a fixed full-window canvas as the first child of
// <body> (the slot wavegrid.js used), runs fluid + ambient noise + ASCII pass,
// splats on mouse move. Colors track the site theme via theme-palette.js.

import { createFluid } from './fluid-core.js';
import { createAsciiPass } from './ascii-pass.js';
import { createAmbient } from './ambient.js';
import { createCardanScene } from './cardan-scene.js';
import { createUiLink } from './ui-link.js';
import { createDyeReadback } from './dye-readback.js';
import { createHeroText } from './hero-text.js';
import { readPalette, onPalette } from './theme-palette.js';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isMobile = window.innerWidth <= 700;

const old = document.getElementById('asciibgCanvas');
if (old) old.remove();
const canvas = document.createElement('canvas');
canvas.id = 'asciibgCanvas';
canvas.style.cssText = [
	'position:fixed', 'top:0', 'left:0',
	'width:100%', 'height:100%',
	'pointer-events:none', 'z-index:0',
	'opacity:0', 'transition:opacity 1.4s ease',
].join(';');
document.body.insertBefore(canvas, document.body.firstChild);

function sizeCanvas() {
	const pr = isMobile ? 1 : Math.min(window.devicePixelRatio || 1, 2);
	canvas.width = Math.floor(window.innerWidth * pr);
	canvas.height = Math.floor(window.innerHeight * pr);
}
sizeCanvas();

const fluid = createFluid(canvas, isMobile
	? { SIM_RESOLUTION: 96, DYE_RESOLUTION: 512 }
	: {});
const flowBtn = document.getElementById('flowToggle');
const gimbalBtn = document.getElementById('gimbalToggle');
if (!fluid) {
	canvas.remove();
	if (flowBtn) flowBtn.style.display = 'none';
	if (gimbalBtn) gimbalBtn.style.display = 'none';
} else {
	const ascii = createAsciiPass(fluid.gl, fluid.blit, fluid.baseVS,
		isMobile ? { COLS: 72 } : {});
	const ambient = createAmbient(fluid.gl, fluid.blit, fluid.baseVS, fluid);
	const cardan = createCardanScene(fluid.gl, fluid.blit, fluid.baseVS);
	const uiLink = createUiLink(fluid.gl, fluid.blit, fluid.baseVS, fluid);
	const readback = createDyeReadback(fluid.gl, fluid.blit, fluid.baseVS, fluid);
	const cardanResize = () => cardan.resize(Math.max(4, canvas.width >> 1), Math.max(4, canvas.height >> 1));
	cardanResize();
	const drawScene = target => {
		fluid.drawDisplay(target);
		if (gimbalOn) cardan.compositeInto(target);
	};

	const heroText = createHeroText(ascii);

	let palette = readPalette();
	onPalette(p => { palette = p; heroText.setPalette(p); });

	window.addEventListener('resize', () => { sizeCanvas(); fluid.resize(); ascii.resize(); cardanResize(); heroText.refresh(); });

	const present = () => ascii.render(drawScene, palette);

	// ── ambient blob toggle (top-left pill) — persists across visits.
	// Gates ambient dye emission only; wind+swirl always run, so interaction
	// dye keeps drifting right→left even when off. ──
	let ambientOn = localStorage.getItem('asciibg-flow') !== 'off';
	const syncFlowBtn = () => {
		if (!flowBtn) return;
		flowBtn.setAttribute('aria-pressed', ambientOn ? 'true' : 'false');
		const lbl = flowBtn.querySelector('.toggle-label');
		if (lbl) lbl.textContent = ambientOn ? 'Flow' : 'Still';
	};
	syncFlowBtn();
	if (flowBtn) flowBtn.addEventListener('click', () => {
		ambientOn = !ambientOn;
		localStorage.setItem('asciibg-flow', ambientOn ? 'on' : 'off');
		syncFlowBtn();
	});

	// ── gimbal toggle (below the flow pill) — same persistence pattern ──
	let gimbalOn = localStorage.getItem('asciibg-gimbal') !== 'off';
	const syncGimbalBtn = () => {
		if (gimbalBtn) gimbalBtn.setAttribute('aria-pressed', gimbalOn ? 'true' : 'false');
	};
	syncGimbalBtn();
	if (gimbalBtn) gimbalBtn.addEventListener('click', () => {
		gimbalOn = !gimbalOn;
		localStorage.setItem('asciibg-gimbal', gimbalOn ? 'on' : 'off');
		syncGimbalBtn();
	});

	// Fast-forward so the page opens with a developed field, not a black slate.
	const WARMUP = reducedMotion ? 300 : 180;
	for (let i = 0; i < WARMUP; i++) {
		ambient.apply(1 / 60, palette, ambientOn);
		fluid.step(1 / 60);
	}
	if (gimbalOn) cardan.draw(performance.now(), 1 / 60);
	present();
	setTimeout(() => { canvas.style.opacity = '1'; }, 300);

	if (!reducedMotion) {
		// Mouse-move splats — window-level (canvas is pointer-events:none).
		let lastX = -1, lastY = -1;
		window.addEventListener('pointermove', e => {
			const x = e.clientX / window.innerWidth;
			const y = 1.0 - e.clientY / window.innerHeight;
			if (lastX >= 0) {
				const dx = (x - lastX) * fluid.cfg.SPLAT_FORCE;
				const dy = (y - lastY) * fluid.cfg.SPLAT_FORCE;
				if (dx !== 0 || dy !== 0) {
					const ink = palette.inks[(Math.random() * palette.inks.length) | 0];
					fluid.splat(x, y, dx, dy, { r: ink.r * 0.07, g: ink.g * 0.07, b: ink.b * 0.07 });
				}
			}
			lastX = x; lastY = y;
		}, { passive: true });

		// index.html?perf=1 — log average frame time every 2s (Phase 6.4 check)
		const perfLog = new URLSearchParams(location.search).get('perf') === '1';
		let perfAcc = 0, perfN = 0, perfLast = performance.now();

		let last = performance.now();
		function tick(now) {
			const dt = Math.min((now - last) / 1000, 0.016666);
			last = now;
			ambient.apply(dt, palette, ambientOn);
			uiLink.apply(dt, palette);
			fluid.step(dt);
			if (gimbalOn) cardan.draw(now, dt);
			readback.apply();
			present();
			if (perfLog) {
				perfAcc += performance.now() - now; perfN++;
				if (now - perfLast > 2000) {
					console.log('[asciibg perf] ' + (perfAcc / perfN).toFixed(2) + ' ms/frame over ' + perfN);
					perfAcc = 0; perfN = 0; perfLast = now;
				}
			}
			if (!document.hidden) requestAnimationFrame(tick);
		}
		requestAnimationFrame(tick);
		document.addEventListener('visibilitychange', () => {
			if (!document.hidden) { last = performance.now(); requestAnimationFrame(tick); }
		});
	} else {
		// Reduced motion: developed field rendered once, re-presented on theme change.
		// Toggles are pointless on a static frame — hide them.
		if (flowBtn) flowBtn.style.display = 'none';
		if (gimbalBtn) gimbalBtn.style.display = 'none';
		onPalette(() => present());
	}
}
