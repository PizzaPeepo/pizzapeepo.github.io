// Fluid → UI link (ASCII_REDESIGN_PLAN.md Phase 6): the dye field is
// downsampled into a tiny RGBA8 FBO once per frame and read back on the CPU;
// each visible card gets the average dye color/density under its rect as CSS
// vars (--fluid-tint "R G B", --fluid-amt 0..1) that the card border consumes.
// Rects are cached and only re-read on scroll/resize/filter — never per frame.

import { Program, compileShader } from '../FluidSimulation/gl-program.js';
import { createFBO } from '../FluidSimulation/framebuffers.js';
import * as S from '../FluidSimulation/glsl.js';

export const readbackDefaults = {
	SELECTOR: '#demoGrid .card',
	W: 32, H: 18,       // readback grid — 2.3KB/frame, cheap
	AMT_GAIN: 2.2,      // dye density → amt gain (field mostly sits well under 1.0)
	EPS: 0.02,          // min amt delta before touching style (avoids style churn)
};

export function createDyeReadback(gl, blit, baseVS, fluid, opts = {}) {
	const cfg = Object.assign({}, readbackDefaults, opts);
	const copyProgram = new Program(gl, baseVS, compileShader(gl, gl.FRAGMENT_SHADER, S.copy));
	const small = createFBO(gl, cfg.W, cfg.H, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR);
	const pixels = new Uint8Array(cfg.W * cfg.H * 4);

	// Cached per-card cell boxes in readback-grid coords (y up, matching readPixels).
	let cards = [];
	let dirty = true;
	function refreshRects() {
		dirty = false;
		cards = [];
		const vw = window.innerWidth, vh = window.innerHeight;
		document.querySelectorAll(cfg.SELECTOR).forEach(el => {
			const r = el.getBoundingClientRect();
			if (r.width === 0 || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) {
				if (el.__fluidAmt) { el.style.setProperty('--fluid-amt', '0'); el.__fluidAmt = 0; }
				return;
			}
			const x0 = Math.max(0, Math.floor(r.left / vw * cfg.W));
			const x1 = Math.min(cfg.W - 1, Math.floor(r.right / vw * cfg.W));
			const y0 = Math.max(0, Math.floor((1 - r.bottom / vh) * cfg.H));
			const y1 = Math.min(cfg.H - 1, Math.floor((1 - r.top / vh) * cfg.H));
			if (x1 < x0 || y1 < y0) return;
			cards.push({ el, x0, x1, y0, y1 });
		});
	}
	const markDirty = () => { dirty = true; };
	window.addEventListener('scroll', markDirty, { passive: true });
	window.addEventListener('resize', markDirty);
	const filterBar = document.getElementById('filterBar');
	// filter FLIP animates cards for ~0.4s — re-read after it settles
	if (filterBar) filterBar.addEventListener('click', () => setTimeout(markDirty, 450));

	function apply() {
		if (dirty) refreshRects();
		if (!cards.length) return;

		gl.disable(gl.BLEND);
		copyProgram.bind();
		gl.uniform1i(copyProgram.uniforms.uTexture, fluid.dye.read.attach(0));
		blit(small);   // leaves small.fbo bound → readPixels reads it
		gl.readPixels(0, 0, cfg.W, cfg.H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

		for (const c of cards) {
			let r = 0, g = 0, b = 0, n = 0;
			for (let y = c.y0; y <= c.y1; y++) {
				let i = (y * cfg.W + c.x0) * 4;
				for (let x = c.x0; x <= c.x1; x++, i += 4) {
					r += pixels[i]; g += pixels[i + 1]; b += pixels[i + 2]; n++;
				}
			}
			r /= n; g /= n; b /= n;
			const mx = Math.max(r, g, b);
			const amt = Math.min(1, mx / 255 * cfg.AMT_GAIN);
			const last = c.el.__fluidAmt || 0;
			if (Math.abs(amt - last) < cfg.EPS) continue;
			c.el.__fluidAmt = amt;
			const s = mx > 1 ? 255 / mx : 0;
			c.el.style.setProperty('--fluid-tint',
				((r * s) | 0) + ' ' + ((g * s) | 0) + ' ' + ((b * s) | 0));
			c.el.style.setProperty('--fluid-amt', amt.toFixed(3));
		}
	}

	return { cfg, apply, markDirty };
}
