// Ambient life for the index background: per-frame curl-noise force + slow dye
// emission (ASCII_REDESIGN_PLAN.md 3.3). Both passes write into the fluid's
// ping-pong FBOs; strengths are per-second and folded with dt each frame.

import { Program, compileShader } from '../FluidSimulation/gl-program.js';
import { noiseVelocity, noiseDye } from './shaders.js';

export const ambientDefaults = {
	FORCE: 1.5,         // swirl accel /s — small next to the wind so the flow stays laminar
	FORCE_SCALE: 1.5,   // spatial frequency of the swirl field
	WIND_X: -2.0,       // uniform accel /s: field enters right, exits left (open edges)
	WIND_Y: -0.5,
	DYE_RATE: 0.03,   // ambient blob emission — Flow pill gates it via apply()'s emitDye arg.
	                  // Equilibrium: core dens ≈ RATE/DENSITY_DISSIPATION (0.03/0.5 = 0.06) vs shader floor 0.08
	DYE_SCALE: 1.6,     // spatial frequency of the blob field (lower = bigger patches)
	DYE_THRESH: 0.34,   // blob start level; snoise rarely exceeds ~0.6 → sparse isolated patches
	DYE_DRIFT: 0.32,    // emission-pattern translation ≈ wind terminal speed WIND_X/VEL_DISS = 10 texels/s (uTime already runs at TIME_SCALE)
	TIME_SCALE: 0.4,    // global evolution speed
};

export function createAmbient(gl, blit, baseVS, fluid, opts = {}) {
	const cfg = Object.assign({}, ambientDefaults, opts);
	const fs = src => compileShader(gl, gl.FRAGMENT_SHADER, src);
	const velProgram = new Program(gl, baseVS, fs(noiseVelocity));
	const dyeProgram = new Program(gl, baseVS, fs(noiseDye));

	let t = Math.random() * 100.0;   // random phase so every load looks different

	// palette: {inks:[...]} from theme-palette.js — blobs crawl between inks 0/1.
	function apply(dt, palette, emitDye = true) {
		t += dt * cfg.TIME_SCALE;
		const velocity = fluid.velocity, dye = fluid.dye;
		const aspect = gl.canvas.width / gl.canvas.height;
		gl.disable(gl.BLEND);

		velProgram.bind();
		gl.uniform1i(velProgram.uniforms.uVelocity, velocity.read.attach(0));
		gl.uniform1f(velProgram.uniforms.uTime, t);
		gl.uniform1f(velProgram.uniforms.uStrength, cfg.FORCE * dt);
		gl.uniform1f(velProgram.uniforms.uScale, cfg.FORCE_SCALE);
		gl.uniform1f(velProgram.uniforms.uAspect, aspect);
		gl.uniform2f(velProgram.uniforms.uWind, cfg.WIND_X * dt, cfg.WIND_Y * dt);
		blit(velocity.write); velocity.swap();

		if (!emitDye || cfg.DYE_RATE <= 0.0) return;

		const a = palette.inks[0], b = palette.inks[1];
		dyeProgram.bind();
		gl.uniform1i(dyeProgram.uniforms.uTarget, dye.read.attach(0));
		gl.uniform1f(dyeProgram.uniforms.uTime, t);
		gl.uniform1f(dyeProgram.uniforms.uRate, cfg.DYE_RATE * dt);
		gl.uniform1f(dyeProgram.uniforms.uScale, cfg.DYE_SCALE);
		gl.uniform1f(dyeProgram.uniforms.uThresh, cfg.DYE_THRESH);
		gl.uniform1f(dyeProgram.uniforms.uDrift, cfg.DYE_DRIFT);
		gl.uniform1f(dyeProgram.uniforms.uAspect, aspect);
		gl.uniform3f(dyeProgram.uniforms.uColA, a.r, a.g, a.b);
		gl.uniform3f(dyeProgram.uniforms.uColB, b.r, b.g, b.b);
		blit(dye.write); dye.swap();
	}

	return { cfg, apply };
}
