// GPU fluid simulation (WebGL2, stable fluids) with user obstacles + HUD.
// Solver + bloom/sunrays adapted from PavelDoGreat/WebGL-Fluid-Simulation (MIT);
// obstacle boundary conditions and the Canvas Lab HUD are added here. See FLUID_SIM_PLAN.md.

import { config } from './config.js';
import * as S from './glsl.js';
import { Program, Material, compileShader } from './gl-program.js';
import {
	getSupportedFormat, createFBO, createDoubleFBO, resizeDoubleFBO,
	createBlit, createNoiseTexture,
} from './framebuffers.js';
import { Pointer, setPointerDown, setPointerMove } from './pointer.js';
import { PRESETS, stampShape, paintBrush, applyPreset } from './obstacles.js';
import { onThemeChange } from '../Utils/ThemeManager.js';

// ── canvas + GL context ──
const canvas = document.getElementById('backgroundCanvas');

function scaleByPixelRatio(input) {
	const pr = Math.min(window.devicePixelRatio || 1, 2);
	return Math.floor(input * pr);
}
function resizeCanvas() {
	const w = scaleByPixelRatio(window.innerWidth);
	const h = scaleByPixelRatio(window.innerHeight);
	if (canvas.width !== w || canvas.height !== h) {
		canvas.width = w; canvas.height = h;
		return true;
	}
	return false;
}
resizeCanvas();

const gl = canvas.getContext('webgl2', {
	alpha: true, depth: false, stencil: false, antialias: false, preserveDrawingBuffer: false,
});
if (!gl) {
	document.getElementById('webglError').style.display = 'flex';
	throw new Error('WebGL2 unavailable');
}

gl.getExtension('EXT_color_buffer_float');
const supportLinearFloat = !!gl.getExtension('OES_texture_float_linear');

const texType = gl.HALF_FLOAT;
let rgba = getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, texType);
let rg = getSupportedFormat(gl, gl.RG16F, gl.RG, texType);
let r = getSupportedFormat(gl, gl.R16F, gl.RED, texType);
const filtering = gl.LINEAR; // half-float linear filtering is core in WebGL2

if (rgba == null) {
	// No float render targets: degrade gracefully.
	config.SHADING = false; config.BLOOM = false; config.SUNRAYS = false;
	config.DYE_RESOLUTION = 512;
	rgba = { internalFormat: gl.RGBA, format: gl.RGBA };
	rg = rgba; r = rgba;
}

// ── programs ──
const baseVS = compileShader(gl, gl.VERTEX_SHADER, S.baseVertex);
const blurVS = compileShader(gl, gl.VERTEX_SHADER, S.blurVertex);
const fs = (src, kw) => compileShader(gl, gl.FRAGMENT_SHADER, src, kw);

const blurProgram = new Program(gl, blurVS, fs(S.blur));
const copyProgram = new Program(gl, baseVS, fs(S.copy));
const clearProgram = new Program(gl, baseVS, fs(S.clear));
const colorProgram = new Program(gl, baseVS, fs(S.color));
const splatProgram = new Program(gl, baseVS, fs(S.splat));
const advectionProgram = new Program(gl, baseVS, fs(S.advection));
const divergenceProgram = new Program(gl, baseVS, fs(S.divergence));
const curlProgram = new Program(gl, baseVS, fs(S.curl));
const vorticityProgram = new Program(gl, baseVS, fs(S.vorticity));
const pressureProgram = new Program(gl, baseVS, fs(S.pressure));
const gradientSubtractProgram = new Program(gl, baseVS, fs(S.gradientSubtract));
const bloomPrefilterProgram = new Program(gl, baseVS, fs(S.bloomPrefilter));
const bloomBlurProgram = new Program(gl, baseVS, fs(S.bloomBlur));
const bloomFinalProgram = new Program(gl, baseVS, fs(S.bloomFinal));
const sunraysMaskProgram = new Program(gl, baseVS, fs(S.sunraysMask));
const sunraysProgram = new Program(gl, baseVS, fs(S.sunrays));
const obstacleStampProgram = new Program(gl, baseVS, fs(S.obstacleStamp));
const asciiArtProgram = new Program(gl, baseVS, fs(S.asciiArt));
const asciiFadeProgram = new Program(gl, baseVS, fs(S.asciiFade));
const asciiPresentProgram = new Program(gl, baseVS, fs(S.asciiPresent));
const displayMaterial = new Material(gl, baseVS, S.display);

const blit = createBlit(gl);
const ditheringTexture = createNoiseTexture(gl, 256);

// ── ASCII glyph atlas ──
// Ramp ordered sparse→dense; cell luminance indexes a glyph. Rendered to an
// offscreen 2D canvas (one GP×GP cell per char) and uploaded as a NEAREST texture.
const ASCII_GP = 16;   // glyph CELL HEIGHT = native font grid (16); exact 1 font-pixel → 1 texel
const ASCII_GP_X = 9;   // glyph CELL WIDTH (units). Web437 ink is ~9 wide; a square-16 cell leaves a ~7-unit horizontal gap. 10 leaves ~1 (9 = ink, the floor before glyphs touch) — cols inflate to keep glyph size/aspect
const ASCII_GP_Y = 16;   // glyph CELL HEIGHT (units). Glyph ink is 16 tall; >16 adds a VERTICAL gap between rows (22 → 6-unit gap), independent of the horizontal pitch. rows shrink to keep glyph size/aspect
const ASCII_NATIVE = 16;   // Web437_ATI_9x16 TRUE native glyph grid (px). Must match the font or pixels misalign → ragged glyphs
const ASCII_RAMP = " .,:;-~=+*/|\iltfrcvunxz23578XYUJCLAHSGZO0QMW#B%8&$@";

// Web437 is a bitmap (pixel) face. To reproduce its pixels EXACTLY: render the font at an
// integer multiple of its native grid (fpx = GP*SS) with the pen integer-aligned to that grid
// (textBaseline 'top', textAlign 'left', x/y snapped to SS), so every font-pixel lands on a
// whole SS×SS source block. Then coverage-threshold each block down to one texel (ON iff ≥50%
// inked). Fractional baselines (the old 'middle'/'center') or a wrong native grid straddle the
// blocks → ragged diagonals; this avoids both. Sampled NEAREST end-to-end.
const ASCII_SS = 8;
function createGlyphAtlas() {
	const n = ASCII_RAMP.length;
	const cellW = ASCII_GP_X * ASCII_SS, cellH = ASCII_GP_Y * ASCII_SS;
	const c = document.createElement('canvas');
	c.width = n * cellW; c.height = cellH;
	const ctx = c.getContext('2d');
	ctx.fillStyle = '#000'; ctx.fillRect(0, 0, c.width, c.height);
	ctx.fillStyle = '#fff';
	const fpx = ASCII_GP * ASCII_SS;   // = cell: native 16-grid font at SS× → 1 font-pixel = SS source px = 1 output texel after the coverage downsample
	ctx.font = fpx + "px 'Web437_ATI_9x16', monospace";   // bitmap web-font (VileR, CC BY-SA 4.0); monospace fallback before it loads
	ctx.textAlign = 'left'; ctx.textBaseline = 'top';
	const offX = Math.round((cellW - ctx.measureText('M').width) / 2 / ASCII_SS) * ASCII_SS;   // centre the glyph but snap to the SS grid so font pixels stay block-aligned
	const offY = Math.round((ASCII_GP_Y - ASCII_GP) / 2) * ASCII_SS;   // vertical centre in the taller cell, SS-snapped → the extra height becomes a clean top/bottom gap
	for (let i = 0; i < n; i++) ctx.fillText(ASCII_RAMP[i], i * cellW + offX, offY);   // integer-aligned → exact native pixels, glyph centred in its cell

	// Coverage-threshold the supersampled render down to one GP grid per glyph: each output
	// texel is ON only if ≥50% of its SS×SS source block is inked. Kills the fillText AA
	// fringe (which the present-stage core*3.0 boost would otherwise show as a solid pixel).
	const src = ctx.getImageData(0, 0, c.width, c.height).data;
	const outW = n * ASCII_GP_X, outH = ASCII_GP_Y;
	const out = document.createElement('canvas');
	out.width = outW; out.height = outH;
	const oimg = out.getContext('2d').createImageData(outW, outH);
	const half = (ASCII_SS * ASCII_SS) / 2;
	for (let oy = 0; oy < outH; oy++) {
		for (let ox = 0; ox < outW; ox++) {
			let litCount = 0;
			for (let sy = 0; sy < ASCII_SS; sy++) {
				for (let sx = 0; sx < ASCII_SS; sx++) {
					if (src[((oy * ASCII_SS + sy) * c.width + (ox * ASCII_SS + sx)) * 4] > 127) litCount++;
				}
			}
			const v = litCount >= half ? 255 : 0;
			const o = (oy * outW + ox) * 4;
			oimg.data[o] = oimg.data[o + 1] = oimg.data[o + 2] = v;
			oimg.data[o + 3] = 255;
		}
	}
	out.getContext('2d').putImageData(oimg, 0, 0);

	const tex = gl.createTexture();
	gl.bindTexture(gl.TEXTURE_2D, tex);
	gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, out);
	gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	return {
		texture: tex, count: n,
		attach(id) { gl.activeTexture(gl.TEXTURE0 + id); gl.bindTexture(gl.TEXTURE_2D, tex); return id; },
	};
}
// Built once now with the monospace fallback (so ASCII mode never breaks if the
// font is missing), then rebuilt once the bitmap web-font loads.
let glyphAtlas = createGlyphAtlas();
const asciiFontFace = new FontFace('Web437_ATI_9x16', "url('Web437_ATI_9x16.woff')");
asciiFontFace.load()
	.then(f => { document.fonts.add(f); gl.deleteTexture(glyphAtlas.texture); glyphAtlas = createGlyphAtlas(); })
	.catch(() => {});

// ── framebuffers ──
let dye, velocity, divergenceFBO, curlFBO, pressure, obstacleMask;
let bloomFBO, sunrays, sunraysTemp;
const bloomFramebuffers = [];

// ASCII targets: asciiScene = one LDR texel per cell; asciiBitmap = the glyph image.
let asciiScene, asciiBitmap, asciiTrail, asciiCols = 0, asciiRows = 0;
function initAsciiTargets() {
	const visualCols = Math.max(8, Math.round(config.ASCII_COLS));   // slider value = glyph size on screen
	const cols = Math.round(visualCols * ASCII_GP / ASCII_GP_X);     // inflate horizontal cell count so glyphs pack ~70% tighter at the same on-screen size/aspect
	const rows = Math.max(8, Math.round(visualCols * canvas.height / canvas.width * ASCII_GP / ASCII_GP_Y));   // fewer rows for the taller cell → vertical gap, same on-screen glyph size
	if (cols === asciiCols && rows === asciiRows && asciiScene) return;
	asciiCols = cols; asciiRows = rows;
	asciiScene = createFBO(gl, cols, rows, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR);
	asciiBitmap = createFBO(gl, cols * ASCII_GP_X, rows * ASCII_GP_Y, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST);
	// phosphor-persistence accumulator: ping-pong, same size/filter as the bitmap (all NEAREST → crisp pixels, no minification blur)
	asciiTrail = createDoubleFBO(gl, cols * ASCII_GP_X, rows * ASCII_GP_Y, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST);
}

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
	const simRes = getResolution(config.SIM_RESOLUTION);
	const dyeRes = getResolution(config.DYE_RESOLUTION);

	if (dye == null) dye = createDoubleFBO(gl, dyeRes.width, dyeRes.height, rgba.internalFormat, rgba.format, texType, filtering);
	else dye = resizeDoubleFBO(gl, blit, copyProgram, dye, dyeRes.width, dyeRes.height, rgba.internalFormat, rgba.format, texType, filtering);

	if (velocity == null) velocity = createDoubleFBO(gl, simRes.width, simRes.height, rg.internalFormat, rg.format, texType, filtering);
	else velocity = resizeDoubleFBO(gl, blit, copyProgram, velocity, simRes.width, simRes.height, rg.internalFormat, rg.format, texType, filtering);

	if (obstacleMask == null) obstacleMask = createDoubleFBO(gl, simRes.width, simRes.height, r.internalFormat, r.format, texType, filtering);
	else obstacleMask = resizeDoubleFBO(gl, blit, copyProgram, obstacleMask, simRes.width, simRes.height, r.internalFormat, r.format, texType, filtering);

	divergenceFBO = createFBO(gl, simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
	curlFBO = createFBO(gl, simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
	pressure = createDoubleFBO(gl, simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);

	initBloomFramebuffers();
	initSunraysFramebuffers();
	initAsciiTargets();
}

function initBloomFramebuffers() {
	const res = getResolution(config.BLOOM_RESOLUTION);
	bloomFBO = createFBO(gl, res.width, res.height, rgba.internalFormat, rgba.format, texType, filtering);
	bloomFramebuffers.length = 0;
	for (let i = 0; i < config.BLOOM_ITERATIONS; i++) {
		const width = res.width >> (i + 1);
		const height = res.height >> (i + 1);
		if (width < 2 || height < 2) break;
		bloomFramebuffers.push(createFBO(gl, width, height, rgba.internalFormat, rgba.format, texType, filtering));
	}
}

function initSunraysFramebuffers() {
	const res = getResolution(config.SUNRAYS_RESOLUTION);
	sunrays = createFBO(gl, res.width, res.height, r.internalFormat, r.format, texType, filtering);
	sunraysTemp = createFBO(gl, res.width, res.height, r.internalFormat, r.format, texType, filtering);
}

// ── display keyword variants ──
function updateKeywords() {
	const kw = [];
	if (config.SHADING) kw.push('SHADING');
	if (config.BLOOM) kw.push('BLOOM');
	if (config.SUNRAYS) kw.push('SUNRAYS');
	if (config.COLOR_MODE === 'heat') kw.push('HEATMAP');
	displayMaterial.setKeywords(kw);
}

// ── colours ──
function HSVtoRGB(h, s, v) {
	const i = Math.floor(h * 6), f = h * 6 - i;
	const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
	let r2, g2, b2;
	switch (i % 6) {
		case 0: r2 = v; g2 = t; b2 = p; break;
		case 1: r2 = q; g2 = v; b2 = p; break;
		case 2: r2 = p; g2 = v; b2 = t; break;
		case 3: r2 = p; g2 = q; b2 = v; break;
		case 4: r2 = t; g2 = p; b2 = v; break;
		default: r2 = v; g2 = p; b2 = q; break;
	}
	return { r: r2, g: g2, b: b2 };
}
let baseHue = Math.random();
function generateColor() {
	// Heat mode colours by density at display time; inject neutral grey dye.
	if (config.COLOR_MODE === 'heat') return { r: 0.15, g: 0.15, b: 0.15 };
	let h;
	if (config.COLOR_MODE === 'single') h = baseHue;
	else if (config.COLOR_MODE === 'gradient') h = (baseHue + Math.random() * 0.12) % 1;
	else h = Math.random();
	const c = HSVtoRGB(h, 1.0, 1.0);
	c.r *= 0.15; c.g *= 0.15; c.b *= 0.15;
	return c;
}
function generateColorArray() { const c = generateColor(); return [c.r, c.g, c.b]; }
function normalizeColor(c) { return { r: c.r / 255, g: c.g / 255, b: c.b / 255 }; }

// ── input state ──
const pointers = [new Pointer()];
const splatStack = [];
let mode = 'fluid';      // fluid | obstacle | erase
let shiftHeld = false;
let obColor = [0.80, 0.80, 0.86];

// ASCII zoom/pan: zoom magnifies toward the cursor; pan (middle-drag) shifts the
// ascii-uv shown at screen centre. RGB-triad subpixels reveal at high magnification.
let asciiZoom = 1, asciiPanX = 0.5, asciiPanY = 0.5;
const ASCII_ZOOM_MAX = 60;
function clampAsciiPan() {
	if (asciiZoom <= 1) { asciiPanX = 0.5; asciiPanY = 0.5; return; }
	const half = 0.5 / asciiZoom;
	asciiPanX = Math.min(Math.max(asciiPanX, half), 1 - half);
	asciiPanY = Math.min(Math.max(asciiPanY, half), 1 - half);
}

function aspect() { return canvas.width / canvas.height; }
function correctRadius(radius) { const a = aspect(); return a > 1 ? radius * a : radius; }

function pos(e) {
	const rect = canvas.getBoundingClientRect();
	return { x: e.clientX - rect.left, y: e.clientY - rect.top, w: rect.width, h: rect.height };
}

canvas.addEventListener('mousedown', e => {
	if (e.button === 1) { e.preventDefault(); if (config.ASCII) startAsciiPan(e); return; }  // middle = pan
	const { x, y, w, h } = pos(e);
	const p = pointers[0];
	p.forceErase = e.button === 2;
	setPointerDown(p, -1, x, y, w, h, generateColorArray());
	if (mode === 'fluid' && !p.forceErase) clickSplat(p);
});
canvas.addEventListener('mousemove', e => {
	const p = pointers[0];
	if (!p.down) return;
	const { x, y, w, h } = pos(e);
	setPointerMove(p, x, y, w, h);
});
window.addEventListener('mouseup', () => { pointers[0].down = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());

// ── ASCII zoom (wheel toward cursor) + pan (middle-drag) ──
function screenUv(e) {
	const rect = canvas.getBoundingClientRect();
	return { x: (e.clientX - rect.left) / rect.width, y: 1.0 - (e.clientY - rect.top) / rect.height, rect };
}
canvas.addEventListener('wheel', e => {
	if (!config.ASCII) return;
	e.preventDefault();
	const m = screenUv(e);
	const ax = (m.x - 0.5) / asciiZoom + asciiPanX;   // ascii-uv under the cursor (fixed point)
	const ay = (m.y - 0.5) / asciiZoom + asciiPanY;
	asciiZoom = Math.min(Math.max(asciiZoom * Math.exp(-e.deltaY * 0.0015), 1), ASCII_ZOOM_MAX);
	asciiPanX = ax - (m.x - 0.5) / asciiZoom;
	asciiPanY = ay - (m.y - 0.5) / asciiZoom;
	clampAsciiPan();
}, { passive: false });

let asciiPanning = false, lastPan = null;
function startAsciiPan(e) { asciiPanning = true; lastPan = { x: e.clientX, y: e.clientY }; }
window.addEventListener('mousemove', e => {
	if (!asciiPanning) return;
	const rect = canvas.getBoundingClientRect();
	asciiPanX -= (e.clientX - lastPan.x) / rect.width / asciiZoom;
	asciiPanY += (e.clientY - lastPan.y) / rect.height / asciiZoom;
	lastPan = { x: e.clientX, y: e.clientY };
	clampAsciiPan();
});
window.addEventListener('mouseup', e => { if (e.button === 1) asciiPanning = false; });
function resetAsciiView() { asciiZoom = 1; asciiPanX = 0.5; asciiPanY = 0.5; }
canvas.addEventListener('dblclick', () => { if (config.ASCII) resetAsciiView(); });

canvas.addEventListener('touchstart', e => {
	e.preventDefault();
	const rect = canvas.getBoundingClientRect();
	const touches = e.targetTouches;
	while (pointers.length < touches.length) pointers.push(new Pointer());
	for (let i = 0; i < touches.length; i++) {
		const p = pointers[i + 1] || (pointers.push(new Pointer()), pointers[pointers.length - 1]);
		setPointerDown(p, touches[i].identifier, touches[i].clientX - rect.left, touches[i].clientY - rect.top, rect.width, rect.height, generateColorArray());
		if (mode === 'fluid') clickSplat(p);
	}
}, { passive: false });
canvas.addEventListener('touchmove', e => {
	e.preventDefault();
	const rect = canvas.getBoundingClientRect();
	const touches = e.targetTouches;
	for (let i = 0; i < touches.length; i++) {
		const p = pointers[i + 1];
		if (!p || !p.down) continue;
		setPointerMove(p, touches[i].clientX - rect.left, touches[i].clientY - rect.top, rect.width, rect.height);
	}
}, { passive: false });
window.addEventListener('touchend', e => {
	const touches = e.changedTouches;
	for (let i = 0; i < touches.length; i++) {
		const p = pointers.find(pt => pt.id === touches[i].identifier);
		if (p) p.down = false;
	}
});

// ── splats ──
function colorObj(arr) { return { r: arr[0], g: arr[1], b: arr[2] }; }

function splat(x, y, dx, dy, color) {
	splatProgram.bind();
	gl.uniform1i(splatProgram.uniforms.uTarget, velocity.read.attach(0));
	gl.uniform1i(splatProgram.uniforms.uObstacle, obstacleMask.read.attach(1));
	gl.uniform1f(splatProgram.uniforms.aspectRatio, aspect());
	gl.uniform2f(splatProgram.uniforms.point, x, y);
	gl.uniform3f(splatProgram.uniforms.color, dx, dy, 0.0);
	gl.uniform1f(splatProgram.uniforms.radius, correctRadius(config.SPLAT_RADIUS / 100.0));
	blit(velocity.write); velocity.swap();

	gl.uniform1i(splatProgram.uniforms.uTarget, dye.read.attach(0));
	gl.uniform1i(splatProgram.uniforms.uObstacle, obstacleMask.read.attach(1));
	gl.uniform3f(splatProgram.uniforms.color, color.r, color.g, color.b);
	blit(dye.write); dye.swap();
}

function splatPointer(p) {
	const dx = p.deltaX * config.SPLAT_FORCE;
	const dy = p.deltaY * config.SPLAT_FORCE;
	let color;
	if (shiftHeld) color = { r: 0, g: 0, b: 0 };
	else if (config.COLOR_MODE === 'velocity') {
		const hue = (Math.atan2(p.deltaY, p.deltaX) / (2 * Math.PI) + 1) % 1;
		const c = HSVtoRGB(hue, 1, 1);
		color = { r: c.r * 0.15, g: c.g * 0.15, b: c.b * 0.15 };
	} else color = colorObj(p.color);
	splat(p.texcoordX, p.texcoordY, dx, dy, color);
}

function clickSplat(p) {
	const c = colorObj(p.color);
	const color = { r: c.r * 10, g: c.g * 10, b: c.b * 10 };
	const dx = 10 * (Math.random() - 0.5);
	const dy = 30 * (Math.random() - 0.5);
	splat(p.texcoordX, p.texcoordY, dx, dy, shiftHeld ? { r: 0, g: 0, b: 0 } : color);
}

function multipleSplats(amount) {
	for (let i = 0; i < amount; i++) {
		const c = generateColor();
		c.r *= 10; c.g *= 10; c.b *= 10;
		const x = Math.random(), y = Math.random();
		const dx = 1000 * (Math.random() - 0.5);
		const dy = 1000 * (Math.random() - 0.5);
		splat(x, y, dx, dy, c);
	}
}

// Continuous inflow down the left edge — develops into a vortex street past obstacles.
function emitFlow() {
	const rows = 8;
	for (let i = 0; i < rows; i++) {
		const y = (i + 0.5) / rows;
		const hue = (y * 0.55 + Date.now() * 0.00004) % 1;
		const col = HSVtoRGB(hue, 1, 1);
		splat(0.03, y, config.EMITTER_FORCE, 0, { r: col.r * 0.05, g: col.g * 0.05, b: col.b * 0.05 });
	}
}

function applyInputs() {
	if (splatStack.length > 0) multipleSplats(splatStack.pop());
	for (const p of pointers) {
		if (p.down && (mode === 'obstacle' || mode === 'erase' || p.forceErase)) {
			const erase = mode === 'erase' || p.forceErase;
			paintBrush(gl, obstacleStampProgram, blit, obstacleMask, aspect(),
				p.texcoordX, p.texcoordY, config.OBSTACLE_BRUSH, erase);
		}
		if (p.moved) {
			p.moved = false;
			if (mode === 'fluid' && !p.forceErase) splatPointer(p);
		}
	}
}

// ── obstacle helpers ──
function clearMask() {
	colorProgram.bind();
	gl.uniform4f(colorProgram.uniforms.color, 0, 0, 0, 1);
	blit(obstacleMask.read);
	blit(obstacleMask.write);
}
function loadPreset(name) {
	applyPreset(gl, obstacleStampProgram, blit, obstacleMask, aspect(), name, clearMask);
}

// ── solver step ──
function step(dt) {
	gl.disable(gl.BLEND);
	const ob = obstacleMask.read;

	curlProgram.bind();
	gl.uniform2f(curlProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
	gl.uniform1i(curlProgram.uniforms.uVelocity, velocity.read.attach(0));
	blit(curlFBO);

	vorticityProgram.bind();
	gl.uniform2f(vorticityProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
	gl.uniform1i(vorticityProgram.uniforms.uVelocity, velocity.read.attach(0));
	gl.uniform1i(vorticityProgram.uniforms.uCurl, curlFBO.attach(1));
	gl.uniform1i(vorticityProgram.uniforms.uObstacle, ob.attach(2));
	gl.uniform1f(vorticityProgram.uniforms.curl, config.CURL);
	gl.uniform1f(vorticityProgram.uniforms.dt, dt);
	blit(velocity.write); velocity.swap();

	divergenceProgram.bind();
	gl.uniform2f(divergenceProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
	gl.uniform1i(divergenceProgram.uniforms.uVelocity, velocity.read.attach(0));
	gl.uniform1i(divergenceProgram.uniforms.uObstacle, ob.attach(1));
	blit(divergenceFBO);

	clearProgram.bind();
	gl.uniform1i(clearProgram.uniforms.uTexture, pressure.read.attach(0));
	gl.uniform1f(clearProgram.uniforms.value, config.PRESSURE);
	blit(pressure.write); pressure.swap();

	pressureProgram.bind();
	gl.uniform2f(pressureProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
	gl.uniform1i(pressureProgram.uniforms.uDivergence, divergenceFBO.attach(0));
	gl.uniform1i(pressureProgram.uniforms.uObstacle, ob.attach(2));
	for (let i = 0; i < config.PRESSURE_ITERATIONS; i++) {
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
	gl.uniform1f(advectionProgram.uniforms.dissipation, config.VELOCITY_DISSIPATION);
	blit(velocity.write); velocity.swap();

	gl.uniform2f(advectionProgram.uniforms.dyeTexelSize, dye.texelSizeX, dye.texelSizeY);
	gl.uniform1i(advectionProgram.uniforms.uVelocity, velocity.read.attach(0));
	gl.uniform1i(advectionProgram.uniforms.uSource, dye.read.attach(1));
	gl.uniform1i(advectionProgram.uniforms.uObstacle, ob.attach(2));
	gl.uniform1f(advectionProgram.uniforms.dissipation, config.DENSITY_DISSIPATION);
	blit(dye.write); dye.swap();
}

// ── post + display ──
function applyBloom(source, destination) {
	if (bloomFramebuffers.length < 2) return;
	let last = destination;
	gl.disable(gl.BLEND);
	bloomPrefilterProgram.bind();
	const knee = config.BLOOM_THRESHOLD * config.BLOOM_SOFT_KNEE + 0.0001;
	gl.uniform3f(bloomPrefilterProgram.uniforms.curve, config.BLOOM_THRESHOLD - knee, knee * 2, 0.25 / knee);
	gl.uniform1f(bloomPrefilterProgram.uniforms.threshold, config.BLOOM_THRESHOLD);
	gl.uniform1i(bloomPrefilterProgram.uniforms.uTexture, source.attach(0));
	blit(last);

	bloomBlurProgram.bind();
	for (let i = 0; i < bloomFramebuffers.length; i++) {
		const dest = bloomFramebuffers[i];
		gl.uniform2f(bloomBlurProgram.uniforms.texelSize, last.texelSizeX, last.texelSizeY);
		gl.uniform1i(bloomBlurProgram.uniforms.uTexture, last.attach(0));
		blit(dest);
		last = dest;
	}

	gl.blendFunc(gl.ONE, gl.ONE);
	gl.enable(gl.BLEND);
	for (let i = bloomFramebuffers.length - 2; i >= 0; i--) {
		const base = bloomFramebuffers[i];
		gl.uniform2f(bloomBlurProgram.uniforms.texelSize, last.texelSizeX, last.texelSizeY);
		gl.uniform1i(bloomBlurProgram.uniforms.uTexture, last.attach(0));
		blit(base);
		last = base;
	}
	gl.disable(gl.BLEND);

	bloomFinalProgram.bind();
	gl.uniform2f(bloomFinalProgram.uniforms.texelSize, last.texelSizeX, last.texelSizeY);
	gl.uniform1i(bloomFinalProgram.uniforms.uTexture, last.attach(0));
	gl.uniform1f(bloomFinalProgram.uniforms.intensity, config.BLOOM_INTENSITY);
	blit(destination);
}

function applySunrays(source, mask, destination) {
	gl.disable(gl.BLEND);
	sunraysMaskProgram.bind();
	gl.uniform1i(sunraysMaskProgram.uniforms.uTexture, source.attach(0));
	blit(mask);
	sunraysProgram.bind();
	gl.uniform1f(sunraysProgram.uniforms.weight, config.SUNRAYS_WEIGHT);
	gl.uniform1i(sunraysProgram.uniforms.uTexture, mask.attach(0));
	blit(destination);
}

function blur(target, temp, iterations) {
	blurProgram.bind();
	for (let i = 0; i < iterations; i++) {
		gl.uniform2f(blurProgram.uniforms.texelSize, target.texelSizeX, 0.0);
		gl.uniform1i(blurProgram.uniforms.uTexture, target.attach(0));
		blit(temp);
		gl.uniform2f(blurProgram.uniforms.texelSize, 0.0, target.texelSizeY);
		gl.uniform1i(blurProgram.uniforms.uTexture, temp.attach(0));
		blit(target);
	}
}

function drawColor(target, color) {
	colorProgram.bind();
	gl.uniform4f(colorProgram.uniforms.color, color.r, color.g, color.b, 1);
	blit(target);
}

function getTextureScale(texture, width, height) {
	return { x: width / texture.width, y: height / texture.height };
}

function drawDisplay(target) {
	const width = target == null ? gl.drawingBufferWidth : target.width;
	const height = target == null ? gl.drawingBufferHeight : target.height;
	displayMaterial.bind();
	if (config.SHADING) gl.uniform2f(displayMaterial.uniforms.texelSize, 1 / width, 1 / height);
	gl.uniform1i(displayMaterial.uniforms.uTexture, dye.read.attach(0));
	if (config.BLOOM) {
		gl.uniform1i(displayMaterial.uniforms.uBloom, bloomFBO.attach(1));
		gl.uniform1i(displayMaterial.uniforms.uDithering, ditheringTexture.attach(2));
		const scale = getTextureScale(ditheringTexture, width, height);
		gl.uniform2f(displayMaterial.uniforms.ditherScale, scale.x, scale.y);
	}
	if (config.SUNRAYS) gl.uniform1i(displayMaterial.uniforms.uSunrays, sunrays.attach(3));
	gl.uniform1i(displayMaterial.uniforms.uObstacle, obstacleMask.read.attach(4));
	gl.uniform3f(displayMaterial.uniforms.uObstacleColor, obColor[0], obColor[1], obColor[2]);
	blit(target);
}

// Render the fluid as a colored ASCII grid, then present it with zoom/pan + CRT triad.
function renderAscii() {
	gl.disable(gl.BLEND);
	drawDisplay(asciiScene);                         // fluid → one LDR texel per cell

	asciiArtProgram.bind();
	gl.uniform1i(asciiArtProgram.uniforms.uScene, asciiScene.attach(0));
	gl.uniform1i(asciiArtProgram.uniforms.uGlyphs, glyphAtlas.attach(1));
	gl.uniform1i(asciiArtProgram.uniforms.uDye, dye.read.attach(2));
	gl.uniform1i(asciiArtProgram.uniforms.uObstacle, obstacleMask.read.attach(3));
	gl.uniform2f(asciiArtProgram.uniforms.uGrid, asciiCols, asciiRows);
	gl.uniform1f(asciiArtProgram.uniforms.uGlyphCount, glyphAtlas.count);
	blit(asciiBitmap);                               // → crisp glyph bitmap

	// Stage A2: fold the fresh bitmap into the decaying trail accumulator.
	// Advance only while running so a paused frame holds steady (no additive creep).
	if (!config.PAUSED) {
		asciiFadeProgram.bind();
		gl.uniform1i(asciiFadeProgram.uniforms.uNew, asciiBitmap.attach(0));
		gl.uniform1i(asciiFadeProgram.uniforms.uPrev, asciiTrail.read.attach(1));
		gl.uniform1f(asciiFadeProgram.uniforms.uFade, config.ASCII_PERSIST);
		gl.uniform1f(asciiFadeProgram.uniforms.uMode, config.ASCII_PERSIST_MODE === 'add' ? 1.0 : 0.0);
		blit(asciiTrail.write);
		asciiTrail.swap();
	}

	asciiPresentProgram.bind();
	gl.uniform1i(asciiPresentProgram.uniforms.uAscii, asciiTrail.read.attach(0));
	gl.uniform2f(asciiPresentProgram.uniforms.uAsciiSize, asciiTrail.read.width, asciiTrail.read.height);
	gl.uniform2f(asciiPresentProgram.uniforms.uScreen, gl.drawingBufferWidth, gl.drawingBufferHeight);
	gl.uniform1f(asciiPresentProgram.uniforms.uZoom, asciiZoom);
	gl.uniform2f(asciiPresentProgram.uniforms.uPan, asciiPanX, asciiPanY);
	const bg = normalizeColor(config.BACK_COLOR);
	gl.uniform3f(asciiPresentProgram.uniforms.uBack, bg.r, bg.g, bg.b);
	gl.uniform1f(asciiPresentProgram.uniforms.uTime, performance.now() / 1000.0);
	gl.uniform1f(asciiPresentProgram.uniforms.uGlow, config.ASCII_GLOW ? 1.0 : 0.0);
	blit(null);                                      // → screen
}

function render(target) {
	if (config.BLOOM) applyBloom(dye.read, bloomFBO);
	if (config.SUNRAYS) {
		applySunrays(dye.read, dye.write, sunrays);
		blur(sunrays, sunraysTemp, 1);
	}
	if (config.ASCII) { renderAscii(); return; }
	if (!config.TRANSPARENT) {
		gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
		gl.enable(gl.BLEND);
		drawColor(target, normalizeColor(config.BACK_COLOR));
	} else {
		gl.disable(gl.BLEND);
	}
	drawDisplay(target);
}

// ── main loop ──
let lastUpdateTime = Date.now();
let colorUpdateTimer = 0.0;
let frames = 0, fpsLast = Date.now();

function calcDeltaTime() {
	const now = Date.now();
	let dt = (now - lastUpdateTime) / 1000;
	dt = Math.min(dt, 0.016666);
	lastUpdateTime = now;
	return dt;
}

function updateColors(dt) {
	if (!config.COLORFUL) return;
	colorUpdateTimer += dt * config.COLOR_UPDATE_SPEED;
	if (colorUpdateTimer >= 1) {
		colorUpdateTimer = colorUpdateTimer % 1;
		for (const p of pointers) p.color = generateColorArray();
	}
}

function update() {
	const dt = calcDeltaTime();
	if (resizeCanvas()) initFramebuffers();
	updateColors(dt);
	applyInputs();
	if (config.EMITTER && !config.PAUSED) emitFlow();
	if (!config.PAUSED) step(dt);
	render(null);

	frames++;
	const now = Date.now();
	if (now - fpsLast >= 500) {
		const fps = Math.round((frames * 1000) / (now - fpsLast));
		const badge = document.getElementById('fpsBadge');
		if (badge) badge.textContent = fps + ' fps';
		frames = 0; fpsLast = now;
	}
	requestAnimationFrame(update);
}


// ── actions ──
function clearDye() {
	colorProgram.bind();
	gl.uniform4f(colorProgram.uniforms.color, 0, 0, 0, 1);
	blit(dye.read); blit(dye.write);
	blit(velocity.read); blit(velocity.write);
	if (asciiTrail) { blit(asciiTrail.read); blit(asciiTrail.write); }  // no ghost trail
}
function reset() {
	clearDye();
	splatStack.push(parseInt(Math.random() * 8) + 8);
}

// ── HUD wiring ──
function bindSlider(id, valId, parse, onChange, fmt) {
	const sl = document.getElementById(id);
	if (!sl) return;
	const out = valId ? document.getElementById(valId) : null;
	const show = () => { if (out) out.textContent = fmt ? fmt(parse(sl.value)) : sl.value; };
	sl.addEventListener('input', () => { onChange(parse(sl.value)); show(); });
	show();
}
function bindCheckbox(id, onChange) {
	const el = document.getElementById(id);
	if (!el) return;
	el.addEventListener('change', () => onChange(el.checked));
}
function bindButton(id, fn) {
	const el = document.getElementById(id);
	if (el) el.addEventListener('click', fn);
}
// Set a slider's value and fire its 'input' handler (updates config + label).
function setSliderValue(id, val) {
	const sl = document.getElementById(id);
	if (!sl) return;
	sl.value = val;
	sl.dispatchEvent(new Event('input'));
}

// Set a checkbox and fire its 'change' handler (updates config + keywords).
function setCheckboxValue(id, val) {
	const cb = document.getElementById(id);
	if (!cb) return;
	cb.checked = val;
	cb.dispatchEvent(new Event('change'));
}
// Select a radio in a group and fire its 'change' handler.
function setRadioValue(name, value) {
	const r = document.querySelector('input[name="' + name + '"][value="' + value + '"]');
	if (r) { r.checked = true; r.dispatchEvent(new Event('change')); }
}

// Tuned ASCII-mode preset: a full slider/toggle set so the grid reads crisp
// regardless of prior settings. Applied whenever ASCII mode is switched on.
function applyAsciiPreset() {
	setSliderValue('simResSlider', 128);
	setSliderValue('dyeResSlider', 2048);
	setSliderValue('velDissSlider', 1.00);
	setSliderValue('denDissSlider', 2.55);
	setSliderValue('pressureSlider', 0.40);
	setSliderValue('iterSlider', 10);
	setSliderValue('curlSlider', 14);
	setSliderValue('splatRadiusSlider', 0.15);
	setSliderValue('splatForceSlider', 12000);
	setSliderValue('brushSlider', 0.010);
	setSliderValue('bloomIntensitySlider', 0.10);
	setSliderValue('bloomThresholdSlider', 0.80);
	setSliderValue('sunraysWeightSlider', 0.15);
	setSliderValue('colorSpeedSlider', 5.0);
	setSliderValue('asciiColsSlider', 60);   // ~17px glyphs on a desktop canvas — readable; 100 was ~10px (mush)
	setSliderValue('asciiPersistSlider', 0.85);
	setRadioValue('asciiPersistMode', 'max');
	setCheckboxValue('asciiGlowToggle', true);
	setRadioValue('colorMode', 'heat');
	setMode('fluid');
	setCheckboxValue('shadingToggle', true);
	setCheckboxValue('colorfulToggle', true);
	setCheckboxValue('transparentToggle', true);
	setCheckboxValue('emitterToggle', false);
	setCheckboxValue('bloomToggle', false);     // ASCII has its own glow; keep phosphors crisp
	setCheckboxValue('sunraysToggle', false);
	updateKeywords();
}

function snapSimRes(v) { return [64, 128, 256].reduce((a, b) => Math.abs(b - v) < Math.abs(a - v) ? b : a); }

function wireUI() {
	bindSlider('simResSlider', 'simResValue', v => snapSimRes(+v), v => { config.SIM_RESOLUTION = v; initFramebuffers(); }, v => v + '²');
	bindSlider('dyeResSlider', 'dyeResValue', v => [512, 1024, 2048].reduce((a, b) => Math.abs(b - +v) < Math.abs(a - +v) ? b : a, 512), v => { config.DYE_RESOLUTION = v; initFramebuffers(); }, v => v + '²');
	bindSlider('velDissSlider', 'velDissValue', parseFloat, v => config.VELOCITY_DISSIPATION = v, v => v.toFixed(2));
	bindSlider('denDissSlider', 'denDissValue', parseFloat, v => config.DENSITY_DISSIPATION = v, v => v.toFixed(2));
	bindSlider('pressureSlider', 'pressureValue', parseFloat, v => config.PRESSURE = v, v => v.toFixed(2));
	bindSlider('iterSlider', 'iterValue', v => parseInt(v), v => config.PRESSURE_ITERATIONS = v);
	bindSlider('curlSlider', 'curlValue', v => parseInt(v), v => config.CURL = v);
	bindSlider('splatRadiusSlider', 'splatRadiusValue', parseFloat, v => config.SPLAT_RADIUS = v, v => v.toFixed(2));
	bindSlider('splatForceSlider', 'splatForceValue', v => parseInt(v), v => config.SPLAT_FORCE = v);
	bindSlider('brushSlider', 'brushValue', parseFloat, v => config.OBSTACLE_BRUSH = v, v => v.toFixed(3));
	bindSlider('bloomIntensitySlider', 'bloomIntensityValue', parseFloat, v => config.BLOOM_INTENSITY = v, v => v.toFixed(2));
	bindSlider('bloomThresholdSlider', 'bloomThresholdValue', parseFloat, v => config.BLOOM_THRESHOLD = v, v => v.toFixed(2));
	bindSlider('sunraysWeightSlider', 'sunraysWeightValue', parseFloat, v => config.SUNRAYS_WEIGHT = v, v => v.toFixed(2));
	bindSlider('colorSpeedSlider', 'colorSpeedValue', parseFloat, v => config.COLOR_UPDATE_SPEED = v, v => v.toFixed(1));

	bindCheckbox('shadingToggle', v => { config.SHADING = v; updateKeywords(); });
	bindCheckbox('bloomToggle', v => { config.BLOOM = v; updateKeywords(); });
	bindCheckbox('sunraysToggle', v => { config.SUNRAYS = v; updateKeywords(); });
	bindCheckbox('colorfulToggle', v => config.COLORFUL = v);
	bindCheckbox('emitterToggle', v => config.EMITTER = v);
	bindCheckbox('transparentToggle', v => config.TRANSPARENT = v);
	bindCheckbox('asciiToggle', v => {
		config.ASCII = v;
		resetAsciiView();
		if (v) applyAsciiPreset();
	});
	bindSlider('asciiColsSlider', 'asciiColsValue', v => parseInt(v), v => { config.ASCII_COLS = v; initAsciiTargets(); });
	bindSlider('asciiPersistSlider', 'asciiPersistValue', parseFloat, v => config.ASCII_PERSIST = v, v => v.toFixed(2));
	bindCheckbox('asciiGlowToggle', v => config.ASCII_GLOW = v);
	document.querySelectorAll('input[name="asciiPersistMode"]').forEach(el => {
		el.addEventListener('change', () => { if (el.checked) config.ASCII_PERSIST_MODE = el.value; });
	});

	document.querySelectorAll('input[name="colorMode"]').forEach(el => {
		el.addEventListener('change', () => { if (el.checked) { config.COLOR_MODE = el.value; updateKeywords(); } });
	});
	document.querySelectorAll('input[name="toolMode"]').forEach(el => {
		el.addEventListener('change', () => { if (el.checked) mode = el.value; });
	});

	bindButton('presetCylinder', () => loadPreset('cylinder'));
	bindButton('presetAirfoil', () => loadPreset('airfoil'));
	bindButton('presetSlit', () => loadPreset('slit'));
	bindButton('presetFunnel', () => loadPreset('funnel'));
	bindButton('clearObstaclesButton', () => clearMask());

	bindButton('splatButton', () => splatStack.push(parseInt(Math.random() * 8) + 8));
	bindButton('clearDyeButton', () => clearDye());
	bindButton('resetButton', () => reset());
	const pauseBtn = document.getElementById('pauseButton');
	if (pauseBtn) pauseBtn.addEventListener('click', () => {
		config.PAUSED = !config.PAUSED;
		pauseBtn.textContent = config.PAUSED ? 'Resume (Space)' : 'Pause (Space)';
	});

	window.addEventListener('keydown', e => {
		if (e.code === 'Space') { e.preventDefault(); if (pauseBtn) pauseBtn.click(); }
		else if (e.code === 'KeyR') reset();
		else if (e.code === 'KeyC') clearDye();
		else if (e.code === 'KeyP') splatStack.push(parseInt(Math.random() * 8) + 8);
		else if (e.code === 'KeyD') setMode('fluid');
		else if (e.code === 'KeyO') setMode('obstacle');
		else if (e.code === 'KeyE') setMode('erase');
		else if (e.code === 'KeyA') {
			config.ASCII = !config.ASCII; resetAsciiView();
			const cb = document.getElementById('asciiToggle'); if (cb) cb.checked = config.ASCII;
			if (config.ASCII) applyAsciiPreset();
		}
	});
	window.addEventListener('keydown', e => { if (e.key === 'Shift') shiftHeld = true; });
	window.addEventListener('keyup', e => { if (e.key === 'Shift') shiftHeld = false; });
}

function setMode(m) {
	mode = m;
	const radio = document.querySelector('input[name="toolMode"][value="' + m + '"]');
	if (radio) radio.checked = true;
}

// ── theme ──
onThemeChange(isLight => {
	if (isLight) { config.BACK_COLOR = { r: 243, g: 238, b: 230 }; obColor = [0.20, 0.20, 0.24]; }
	else { config.BACK_COLOR = { r: 13, g: 11, b: 20 }; obColor = [0.80, 0.80, 0.86]; }
});

// ── boot ──
initFramebuffers();
updateKeywords();
wireUI();
loadPreset('cylinder');
splatStack.push(parseInt(Math.random() * 6) + 8);

// ── boot params (verify/debug) ──
// FluidSimulation.html?ascii=1   → enable ASCII at load (no 'A' keypress; lets a headless
//                                  screenshot capture the glyph grid). Same path as the toggle.
//   &cols=N                      → override glyph columns (glyph size) to inspect spacing.
//   &splats=N                    → push N extra dye splats so the grid has visible content.
//   &glow=0                      → force the phosphor glow OFF (A/B the glyph-level bloom).
(function applyBootParams() {
	const q = new URLSearchParams(location.search);
	if (q.get('ascii') === '1') {
		setCheckboxValue('asciiToggle', true);
		if (q.has('cols')) setSliderValue('asciiColsSlider', parseInt(q.get('cols')));
		if (q.get('glow') === '0') setCheckboxValue('asciiGlowToggle', false);
	}
	const ns = parseInt(q.get('splats')) || 0;
	for (let i = 0; i < ns; i++) splatStack.push(parseInt(Math.random() * 8) + 8);
})();

update();
