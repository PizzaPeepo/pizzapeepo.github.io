// UI → fluid link (ASCII_REDESIGN_PLAN.md Phase 5): hovering a card / filter
// pill / theme toggle parts the fluid around its rect (rounded-rect repulsion
// pass) and paints a faint dye glow band just outside it. One active box —
// last hovered wins (matches the vibe-coded reference). Strength eases in
// ~150ms / out ~300ms; the box rect is re-read every frame while active so
// scrolling under a held hover stays aligned.

import { Program, compileShader } from '../FluidSimulation/gl-program.js';
import { hoverRepulsion, hoverDye } from './shaders.js';

export const uiLinkDefaults = {
	SELECTOR: '.card, .filter-pill, #themeToggle, #flowToggle, #gimbalToggle',
	FORCE: 110.0,       // peak outward velocity /s at full ease
	DYE_RATE: 0.05,     // dye /s in the glow band at full ease — kept subtle vs ambient blobs (0.10)
	EASE_IN: 0.15,      // s to reach ~full strength on enter
	EASE_OUT: 0.30,     // s to decay on leave
	MIN_RANGE: 0.22,    // uv floor for the falloff reach
};

export function createUiLink(gl, blit, baseVS, fluid, opts = {}) {
	const cfg = Object.assign({}, uiLinkDefaults, opts);
	const fs = src => compileShader(gl, gl.FRAGMENT_SHADER, src);
	const velProgram = new Program(gl, baseVS, fs(hoverRepulsion));
	const dyeProgram = new Program(gl, baseVS, fs(hoverDye));

	let hoveredEl = null;
	let strength = 0;
	const box = { cx: 0.5, cy: 0.5, hx: 0, hy: 0, range: cfg.MIN_RANGE };

	document.addEventListener('mouseover', e => {
		const el = e.target.closest && e.target.closest(cfg.SELECTOR);
		if (el) hoveredEl = el;
	});
	document.addEventListener('mouseout', e => {
		const el = e.target.closest && e.target.closest(cfg.SELECTOR);
		if (el && el === hoveredEl && !(e.relatedTarget && el.contains(e.relatedTarget))) {
			hoveredEl = null;
		}
	});

	function readBox() {
		const r = hoveredEl.getBoundingClientRect();
		if (r.width === 0 || r.height === 0) { hoveredEl = null; return; }
		box.cx = (r.left + r.width * 0.5) / window.innerWidth;
		box.cy = 1.0 - (r.top + r.height * 0.5) / window.innerHeight;   // y-flip
		box.hx = r.width * 0.5 / window.innerWidth;
		box.hy = r.height * 0.5 / window.innerHeight;
		// Reference range heuristic: max(w*0.8, h*5, 0.22) in uv units.
		box.range = Math.max(box.hx * 1.6, box.hy * 10.0, cfg.MIN_RANGE);
	}

	function apply(dt, palette) {
		const target = hoveredEl ? 1 : 0;
		const tau = (target > strength ? cfg.EASE_IN : cfg.EASE_OUT) / 3.0;
		strength += (target - strength) * (1.0 - Math.exp(-dt / tau));
		if (strength < 0.004) return;
		if (hoveredEl) readBox();

		const eased = strength * strength * (3.0 - 2.0 * strength);   // smoothstep
		const aspect = gl.canvas.width / gl.canvas.height;
		const velocity = fluid.velocity, dye = fluid.dye;
		gl.disable(gl.BLEND);

		velProgram.bind();
		gl.uniform1i(velProgram.uniforms.uVelocity, velocity.read.attach(0));
		gl.uniform2f(velProgram.uniforms.uCenter, box.cx, box.cy);
		gl.uniform2f(velProgram.uniforms.uHalfSize, box.hx, box.hy);
		gl.uniform1f(velProgram.uniforms.uRange, box.range);
		gl.uniform1f(velProgram.uniforms.uStrength, cfg.FORCE * eased * dt);
		gl.uniform1f(velProgram.uniforms.uAspect, aspect);
		blit(velocity.write); velocity.swap();

		const ink = palette.inks[0];
		dyeProgram.bind();
		gl.uniform1i(dyeProgram.uniforms.uTarget, dye.read.attach(0));
		gl.uniform2f(dyeProgram.uniforms.uCenter, box.cx, box.cy);
		gl.uniform2f(dyeProgram.uniforms.uHalfSize, box.hx, box.hy);
		gl.uniform1f(dyeProgram.uniforms.uRange, box.range);
		gl.uniform1f(dyeProgram.uniforms.uRate, cfg.DYE_RATE * eased * dt);
		gl.uniform1f(dyeProgram.uniforms.uAspect, aspect);
		gl.uniform3f(dyeProgram.uniforms.uColor, ink.r, ink.g, ink.b);
		blit(dye.write); dye.swap();
	}

	return { cfg, apply, get strength() { return strength; } };
}
