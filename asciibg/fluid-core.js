// Embeddable GPU fluid core for the index-page ASCII background.
// Solver extracted from FluidSimulation/main.js (stable fluids, PavelDoGreat MIT);
// imports that demo's shader/program/FBO modules read-only — no HUD, no obstacles,
// no sunrays. Obstacle uniforms threaded through the stock shaders are satisfied
// with a static empty mask so the shaders stay untouched.
// See ASCII_REDESIGN_PLAN.md Phase 1.

import * as S from '../FluidSimulation/glsl.js';
import { Program, Material, compileShader } from '../FluidSimulation/gl-program.js';
import {
	getSupportedFormat, createFBO, createDoubleFBO, resizeDoubleFBO, createBlit,
} from '../FluidSimulation/framebuffers.js';
import { divergenceOpen, advectionVacuum } from './shaders.js';

export const defaults = {
	SIM_RESOLUTION: 128,
	DYE_RESOLUTION: 1024,
	DENSITY_DISSIPATION: 0.5,   // slow decay — dye must survive the right→left crossing
	VELOCITY_DISSIPATION: 0.2,  // heavy drag = viscous feel; wind terminal ≈ 6 texels/s (~35s crossing)
	PRESSURE: 0.4,
	PRESSURE_ITERATIONS: 20,
	CURL: 1,                     // barely-there vorticity — laminar drift, not turbulence
	SPLAT_RADIUS: 0.15,          // same units as the demo (percent-ish, /100 at use)
	SPLAT_FORCE: 1500,
	SHADING: true,
};

// canvas must already be sized (width/height in device px). Returns null if no WebGL2.
export function createFluid(canvas, opts = {}) {
	const cfg = Object.assign({}, defaults, opts);

	const gl = canvas.getContext('webgl2', {
		alpha: true, depth: false, stencil: false, antialias: false, preserveDrawingBuffer: false,
	});
	if (!gl) return null;

	gl.getExtension('EXT_color_buffer_float');
	gl.getExtension('OES_texture_float_linear');

	const texType = gl.HALF_FLOAT;
	let rgba = getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, texType);
	let rg = getSupportedFormat(gl, gl.RG16F, gl.RG, texType);
	let r = getSupportedFormat(gl, gl.R16F, gl.RED, texType);
	const filtering = gl.LINEAR;
	if (rgba == null) {   // no float render targets — degrade like the demo does
		cfg.SHADING = false;
		cfg.DYE_RESOLUTION = 512;
		rgba = { internalFormat: gl.RGBA, format: gl.RGBA };
		rg = rgba; r = rgba;
	}

	// ── programs (solver subset only) ──
	const baseVS = compileShader(gl, gl.VERTEX_SHADER, S.baseVertex);
	const fs = (src, kw) => compileShader(gl, gl.FRAGMENT_SHADER, src, kw);

	const copyProgram = new Program(gl, baseVS, fs(S.copy));
	const clearProgram = new Program(gl, baseVS, fs(S.clear));
	const colorProgram = new Program(gl, baseVS, fs(S.color));
	const splatProgram = new Program(gl, baseVS, fs(S.splat));
	const advectionProgram = new Program(gl, baseVS, fs(advectionVacuum));   // outside-domain = vacuum, no edge inflow
	const divergenceProgram = new Program(gl, baseVS, fs(divergenceOpen));   // open edges — no wall reflection
	const curlProgram = new Program(gl, baseVS, fs(S.curl));
	const vorticityProgram = new Program(gl, baseVS, fs(S.vorticity));
	const pressureProgram = new Program(gl, baseVS, fs(S.pressure));
	const gradientSubtractProgram = new Program(gl, baseVS, fs(S.gradientSubtract));
	const displayMaterial = new Material(gl, baseVS, S.display);
	displayMaterial.setKeywords(cfg.SHADING ? ['SHADING'] : []);
	// Optional thermal colormap on the display pass. 'none' = raw dye (default,
	// matches the theme inks); 'heat'/'heatrev' compile the demo's HEATMAP /
	// HEATMAP_REV branch so density maps across the full thermal ramp.
	let colorMode = 'none';
	function setColorMode(mode) { colorMode = mode; }

	const blit = createBlit(gl);

	// Static empty obstacle mask — stock shaders sample uObstacle; 0 = free everywhere.
	const emptyObstacle = createFBO(gl, 4, 4, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST);

	// ── framebuffers ──
	let dye, velocity, divergenceFBO, curlFBO, pressure;

	function getResolution(resolution) {
		let aspect = gl.drawingBufferWidth / gl.drawingBufferHeight;
		if (aspect < 1) aspect = 1.0 / aspect;
		const min = Math.round(resolution);
		const max = Math.round(resolution * aspect);
		return gl.drawingBufferWidth > gl.drawingBufferHeight
			? { width: max, height: min }
			: { width: min, height: max };
	}

	function initFramebuffers() {
		const simRes = getResolution(cfg.SIM_RESOLUTION);
		const dyeRes = getResolution(cfg.DYE_RESOLUTION);

		if (dye == null) dye = createDoubleFBO(gl, dyeRes.width, dyeRes.height, rgba.internalFormat, rgba.format, texType, filtering);
		else dye = resizeDoubleFBO(gl, blit, copyProgram, dye, dyeRes.width, dyeRes.height, rgba.internalFormat, rgba.format, texType, filtering);

		if (velocity == null) velocity = createDoubleFBO(gl, simRes.width, simRes.height, rg.internalFormat, rg.format, texType, filtering);
		else velocity = resizeDoubleFBO(gl, blit, copyProgram, velocity, simRes.width, simRes.height, rg.internalFormat, rg.format, texType, filtering);

		divergenceFBO = createFBO(gl, simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
		curlFBO = createFBO(gl, simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
		pressure = createDoubleFBO(gl, simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
	}
	initFramebuffers();

	function aspect() { return canvas.width / canvas.height; }
	function correctRadius(radius) { const a = aspect(); return a > 1 ? radius * a : radius; }

	// ── solver step (verbatim from the demo, obstacle = empty) ──
	function step(dt) {
		gl.disable(gl.BLEND);
		const ob = emptyObstacle;

		curlProgram.bind();
		gl.uniform2f(curlProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
		gl.uniform1i(curlProgram.uniforms.uVelocity, velocity.read.attach(0));
		blit(curlFBO);

		vorticityProgram.bind();
		gl.uniform2f(vorticityProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
		gl.uniform1i(vorticityProgram.uniforms.uVelocity, velocity.read.attach(0));
		gl.uniform1i(vorticityProgram.uniforms.uCurl, curlFBO.attach(1));
		gl.uniform1i(vorticityProgram.uniforms.uObstacle, ob.attach(2));
		gl.uniform1f(vorticityProgram.uniforms.curl, cfg.CURL);
		gl.uniform1f(vorticityProgram.uniforms.dt, dt);
		blit(velocity.write); velocity.swap();

		divergenceProgram.bind();
		gl.uniform2f(divergenceProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
		gl.uniform1i(divergenceProgram.uniforms.uVelocity, velocity.read.attach(0));
		gl.uniform1i(divergenceProgram.uniforms.uObstacle, ob.attach(1));
		blit(divergenceFBO);

		clearProgram.bind();
		gl.uniform1i(clearProgram.uniforms.uTexture, pressure.read.attach(0));
		gl.uniform1f(clearProgram.uniforms.value, cfg.PRESSURE);
		blit(pressure.write); pressure.swap();

		pressureProgram.bind();
		gl.uniform2f(pressureProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
		gl.uniform1i(pressureProgram.uniforms.uDivergence, divergenceFBO.attach(0));
		gl.uniform1i(pressureProgram.uniforms.uObstacle, ob.attach(2));
		for (let i = 0; i < cfg.PRESSURE_ITERATIONS; i++) {
			gl.uniform1i(pressureProgram.uniforms.uPressure, pressure.read.attach(1));
			blit(pressure.write); pressure.swap();
		}

		gradientSubtractProgram.bind();
		gl.uniform2f(gradientSubtractProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
		gl.uniform1i(gradientSubtractProgram.uniforms.uPressure, pressure.read.attach(0));
		gl.uniform1i(gradientSubtractProgram.uniforms.uVelocity, velocity.read.attach(1));
		gl.uniform1i(gradientSubtractProgram.uniforms.uObstacle, ob.attach(2));
		blit(velocity.write); velocity.swap();

		advectionProgram.bind();
		gl.uniform2f(advectionProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
		gl.uniform2f(advectionProgram.uniforms.dyeTexelSize, velocity.texelSizeX, velocity.texelSizeY);
		const velId = velocity.read.attach(0);
		gl.uniform1i(advectionProgram.uniforms.uVelocity, velId);
		gl.uniform1i(advectionProgram.uniforms.uSource, velId);
		gl.uniform1i(advectionProgram.uniforms.uObstacle, ob.attach(1));
		gl.uniform1f(advectionProgram.uniforms.dt, dt);
		gl.uniform1f(advectionProgram.uniforms.dissipation, cfg.VELOCITY_DISSIPATION);
		blit(velocity.write); velocity.swap();

		gl.uniform2f(advectionProgram.uniforms.dyeTexelSize, dye.texelSizeX, dye.texelSizeY);
		gl.uniform1i(advectionProgram.uniforms.uVelocity, velocity.read.attach(0));
		gl.uniform1i(advectionProgram.uniforms.uSource, dye.read.attach(1));
		gl.uniform1i(advectionProgram.uniforms.uObstacle, ob.attach(2));
		gl.uniform1f(advectionProgram.uniforms.dissipation, cfg.DENSITY_DISSIPATION);
		blit(dye.write); dye.swap();
	}

	// ── splats ──
	// x/y in [0,1] texcoords (y up), dx/dy force, color {r,g,b} linear dye density.
	function splat(x, y, dx, dy, color) {
		splatProgram.bind();
		gl.uniform1i(splatProgram.uniforms.uTarget, velocity.read.attach(0));
		gl.uniform1i(splatProgram.uniforms.uObstacle, emptyObstacle.attach(1));
		gl.uniform1f(splatProgram.uniforms.aspectRatio, aspect());
		gl.uniform2f(splatProgram.uniforms.point, x, y);
		gl.uniform3f(splatProgram.uniforms.color, dx, dy, 0.0);
		gl.uniform1f(splatProgram.uniforms.radius, correctRadius(cfg.SPLAT_RADIUS / 100.0));
		blit(velocity.write); velocity.swap();

		gl.uniform1i(splatProgram.uniforms.uTarget, dye.read.attach(0));
		gl.uniform1i(splatProgram.uniforms.uObstacle, emptyObstacle.attach(1));
		gl.uniform3f(splatProgram.uniforms.color, color.r, color.g, color.b);
		blit(dye.write); dye.swap();
	}

	function clearDye() {
		colorProgram.bind();
		gl.uniform4f(colorProgram.uniforms.color, 0, 0, 0, 1);
		blit(dye.read); blit(dye.write);
		blit(velocity.read); blit(velocity.write);
	}

	// Render the dye field to a target (null = screen). Shading only, no palette —
	// the ASCII pass (Phase 2) consumes this as its scene input.
	function drawDisplay(target) {
		const width = target == null ? gl.drawingBufferWidth : target.width;
		const height = target == null ? gl.drawingBufferHeight : target.height;
		gl.disable(gl.BLEND);
		const kw = cfg.SHADING ? ['SHADING'] : [];
		if (colorMode === 'heat') kw.push('HEATMAP');
		else if (colorMode === 'heatrev') kw.push('HEATMAP_REV');
		displayMaterial.setKeywords(kw);   // cached per keyword-set; no-op when unchanged
		displayMaterial.bind();
		if (cfg.SHADING) gl.uniform2f(displayMaterial.uniforms.texelSize, 1 / width, 1 / height);
		gl.uniform1i(displayMaterial.uniforms.uTexture, dye.read.attach(0));
		gl.uniform1i(displayMaterial.uniforms.uObstacle, emptyObstacle.attach(4));
		gl.uniform3f(displayMaterial.uniforms.uObstacleColor, 0, 0, 0);
		blit(target);
	}

	// Call after the canvas backing-store size changed; keeps sim contents.
	function resize() { initFramebuffers(); }

	return {
		gl, cfg, blit, baseVS, emptyObstacle,
		step, splat, clearDye, drawDisplay, resize, setColorMode,
		get dye() { return dye; },
		get velocity() { return velocity; },
	};
}
