// ASCII render pass for the index background: dye field → per-cell LDR scene →
// glyph bitmap (asciiArt, density mode) → phosphor-persistence trail → themed
// present. Pipeline mirrors FluidSimulation/main.js renderAscii(), minus
// zoom/pan/CRT; present composite is theme-aware (see shaders.js).

import * as S from '../FluidSimulation/glsl.js';
import { Program, compileShader } from '../FluidSimulation/gl-program.js';
import { createFBO, createDoubleFBO } from '../FluidSimulation/framebuffers.js';
import { asciiPresentBg, asciiArtBg } from './shaders.js';
import { ASCII_GP, ASCII_GP_X, ASCII_GP_Y, DEFAULT_RAMP, CARDAN_RAMP, buildAtlas, loadWeb437 } from './glyph-atlas.js';
import { TEXT_CHARSET, createTextLayer } from './text-layer.js';

export const asciiDefaults = {
	COLS: 110,          // visual glyph columns (cell count inflates like the demo)
	PERSIST: 0.85,      // trail keep-fraction per frame
	JITTER: 0.08,
	GLOW: true,
	GLOW_AMOUNT: 1.8,
	FLOOR: 0.08,        // dye density below this renders no glyph (kills advection residue + dim carpet)
	CARDAN_FLOOR: 0.05, // scene-alpha tag above this = gimbal cell → thin ramp
	TEXT_FLOOR: 0.06,   // hero title: ambient ink opacity in still fluid (near-invisible)
	TEXT_GAIN: 1.4,     // hero title: extra opacity per unit fluid density (wave reveal)
	TONE_MID: 0.5,      // dye thickness (toneT) where the ink sits; below = deep shadow, above = hot core
	HOT_WHITE: 0.45,     // how far dense cores desaturate toward white
	HOT_AMT: 0.7,       // max highlight blend reached at the thickest cores
};

export function createAsciiPass(gl, blit, baseVS, opts = {}) {
	const cfg = Object.assign({}, asciiDefaults, opts);
	const fs = (src, kw) => compileShader(gl, gl.FRAGMENT_SHADER, src, kw);

	const asciiProgram = new Program(gl, baseVS, fs(asciiArtBg));
	const fadeProgram = new Program(gl, baseVS, fs(S.asciiFade));
	const presentProgram = new Program(gl, baseVS, fs(asciiPresentBg));

	let glyphAtlas = buildAtlas(gl, DEFAULT_RAMP);   // monospace fallback first
	let cardanAtlas = buildAtlas(gl, CARDAN_RAMP);   // thin line-art ramp for the gimbal
	let textAtlas = buildAtlas(gl, TEXT_CHARSET);
	const fontListeners = [];
	loadWeb437(() => {
		gl.deleteTexture(glyphAtlas.texture);
		glyphAtlas = buildAtlas(gl, DEFAULT_RAMP);   // rebuild with the real face
		gl.deleteTexture(cardanAtlas.texture);
		cardanAtlas = buildAtlas(gl, CARDAN_RAMP);
		gl.deleteTexture(textAtlas.texture);
		textAtlas = buildAtlas(gl, TEXT_CHARSET);
		fontListeners.forEach(fn => fn());
	});

	let scene = null, bitmap = null, trail = null, cols = 0, rows = 0;
	let text = null;   // lazy — created on first resize, recreated when grid changes

	function resize() {
		const visualCols = Math.max(8, Math.round(cfg.COLS));
		const c = Math.round(visualCols * ASCII_GP / ASCII_GP_X);
		const r = Math.max(8, Math.round(visualCols * gl.canvas.height / gl.canvas.width * ASCII_GP / ASCII_GP_Y));
		const sw = Math.max(4, gl.canvas.width >> 2 << 1), sh = Math.max(4, gl.canvas.height >> 2 << 1);
		if (c === cols && r === rows && scene && scene.width === sw && scene.height === sh) return;
		// free the previous grid's GL targets before reallocating — the COLS
		// slider churns these every change, and window-resize leaked them before.
		if (scene)  { gl.deleteTexture(scene.texture);  gl.deleteFramebuffer(scene.fbo); }
		if (bitmap) { gl.deleteTexture(bitmap.texture); gl.deleteFramebuffer(bitmap.fbo); }
		if (trail)  [trail.read, trail.write].forEach(t => { gl.deleteTexture(t.texture); gl.deleteFramebuffer(t.fbo); });
		cols = c; rows = r;
		if (text) text.dispose();
		text = createTextLayer(gl, cols, rows);
		// Scene at 1/3 canvas res (not cols×rows): the gimbal needs real pixels to
		// rasterize into; asciiArt samples it at cell centres (LINEAR ≈ small box).
		scene = createFBO(gl, sw, sh, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR);
		bitmap = createFBO(gl, cols * ASCII_GP_X, rows * ASCII_GP_Y, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST);
		trail = createDoubleFBO(gl, cols * ASCII_GP_X, rows * ASCII_GP_Y, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST);
	}
	resize();

	// drawScene(target): render the combined scene (fluid display, later +cardan)
	// into `target` — one LDR texel per glyph cell.
	// theme: { bg:{r,g,b}, isLight } from theme-palette.js.
	function render(drawScene, theme, opts = {}, target = null) {
		gl.disable(gl.BLEND);
		drawScene(scene);

		asciiProgram.bind();
		const AU = asciiProgram.uniforms;
		gl.uniform1i(AU.uScene, scene.attach(0));
		gl.uniform1i(AU.uGlyphs, glyphAtlas.attach(1));
		gl.uniform2f(AU.uGrid, cols, rows);
		gl.uniform1f(AU.uGlyphCount, glyphAtlas.count);
		gl.uniform1f(AU.uJitter, cfg.JITTER);
		gl.uniform1f(AU.uFloor, cfg.FLOOR);
		gl.uniform1f(AU.uToneMid, cfg.TONE_MID);
		gl.uniform1f(AU.uHotWhite, cfg.HOT_WHITE);
		gl.uniform1f(AU.uHotAmt, cfg.HOT_AMT);
		text.upload();
		gl.uniform1i(AU.uTextA, text.attachA(2));
		gl.uniform1i(AU.uTextB, text.attachB(3));
		gl.uniform1i(AU.uTextGlyphs, textAtlas.attach(4));
		gl.uniform1f(AU.uTextGlyphCount, textAtlas.count);
		gl.uniform1f(AU.uTextFloor, cfg.TEXT_FLOOR);
		gl.uniform1f(AU.uTextGain, cfg.TEXT_GAIN);
		gl.uniform1i(AU.uCardanGlyphs, cardanAtlas.attach(5));
		gl.uniform1f(AU.uCardanGlyphCount, cardanAtlas.count);
		gl.uniform1f(AU.uCardanMask, opts.cardanMask ? 1.0 : 0.0);
		gl.uniform1f(AU.uCardanFloor, cfg.CARDAN_FLOOR);
		blit(bitmap);

		fadeProgram.bind();
		gl.uniform1i(fadeProgram.uniforms.uNew, bitmap.attach(0));
		gl.uniform1i(fadeProgram.uniforms.uPrev, trail.read.attach(1));
		gl.uniform1f(fadeProgram.uniforms.uFade, cfg.PERSIST);
		blit(trail.write);
		trail.swap();

		presentProgram.bind();
		gl.uniform1i(presentProgram.uniforms.uAscii, trail.read.attach(0));
		gl.uniform2f(presentProgram.uniforms.uAsciiSize, trail.read.width, trail.read.height);
		gl.uniform3f(presentProgram.uniforms.uBack, theme.bg.r, theme.bg.g, theme.bg.b);
		gl.uniform1f(presentProgram.uniforms.uGlow, cfg.GLOW ? 1.0 : 0.0);
		gl.uniform1f(presentProgram.uniforms.uGlowAmount, cfg.GLOW_AMOUNT);
		gl.uniform1f(presentProgram.uniforms.uLight, theme.isLight ? 1.0 : 0.0);
		blit(target);
	}

	function clearTrail() {
		if (!trail) return;
		[trail.read, trail.write].forEach(t => {
			gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
			gl.clearColor(0, 0, 0, 1);
			gl.clear(gl.COLOR_BUFFER_BIT);
		});
	}

	// Re-run text layout when the real Web437 face lands (atlas rebuilt).
	function onFontReady(fn) { fontListeners.push(fn); }

	return {
		cfg, render, resize, clearTrail, onFontReady,
		get cols() { return cols; },
		get rows() { return rows; },
		get text() { return text; },
	};
}
