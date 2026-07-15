// WebGL2 port of the ASCII-flood renderer (renderAsciiFlood in main.js).
//
// The canvas-2D path is O(gridCells × sites) nearest-site scans plus one
// drawImage per glyph cell, every frame — ~1M CPU distance evals + thousands
// of draw calls at 1080p/120 sites. This module moves the whole thing onto the
// GPU in four full-screen passes:
//
//   1. field   — render at cell resolution (cols × rows). Each texel loops the
//                 sites (a data texture) and resolves owner / d1 / wall-ember /
//                 wavefront-ring for that cell. RGBA16F: (own, d1, code, frontT).
//   2. glyph   — render at bitmap resolution (cols·GP × rows·GP). Samples the
//                 field, applies the per-frame animation (ripple / heartbeat /
//                 cursor heat / completion shockwave), picks a glyph out of the
//                 atlas ramp and a themed colour. Output is premultiplied.
//   3. fade    — phosphor persistence: new bitmap over the decayed trail.
//   4. present — composite over the theme background + a cheap 4-tap glow +
//                 procedural scanlines + vignette, upscaled to the canvas.
//
// Shaders are GLES 1.00 (compile under WebGL2) so they share FluidSimulation's
// baseVertex + Program/FBO helpers. Sites live in a float data texture, so the
// per-cell loop has no uniform-array size limit and no texelFetch (1.00-safe).

import { baseVertex } from '../FluidSimulation/glsl.js';
import { Program, compileShader } from '../FluidSimulation/gl-program.js';
import { createFBO, createDoubleFBO, createBlit } from '../FluidSimulation/framebuffers.js';

export const MAX_SITES = 256; // sites-texture width; main.js caps site creation here
const GP = 12;               // glyph cell size in bitmap texels
const GS_TARGET = 15;        // desired cell pitch in canvas px (matches the CPU path)

// atlas ramp: indices 0..9 brightness glyphs, 10..35 letters A..Z
const RAMP = " .·:-=+*#@ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const ATLAS_CELL = 32;       // atlas glyph cell (px) — supersamples the 12px bitmap cell

const fieldFrag = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uSites;
uniform float uSitesTexW;
uniform int uN;
uniform vec2 uCanvasSize;
uniform vec2 uGrid;
uniform vec2 uGs;
uniform float uBand;
uniform int uHoverI;
uniform float uShowPoints;
const int MAX_SITES = ${MAX_SITES};
vec4 site(float i){ return texture2D(uSites, vec2((i + 0.5) / uSitesTexW, 0.5)); }
void main(){
	vec2 cellId = floor(vUv * uGrid);
	vec2 center = (cellId + 0.5) / uGrid * uCanvasSize;
	float own = -1.0, sec = -1.0, D1 = 1e20, D2 = 1e20;
	float ownX = 0.0, ownY = 0.0, secX = 0.0, secY = 0.0;
	float ownGr = 0.0, secGr = 0.0;
	float fI = -1.0, fRel = 1e20, fDd = 0.0, fGr = 0.0;
	float markerOwn = -1.0, markerUp = -1.0;
	float wBest = 1e20;
	for (int i = 0; i < MAX_SITES; i++){
		if (i >= uN) break;
		vec4 s = site(float(i));
		float dx = center.x - s.x, dy = center.y - s.y;
		float d = dx * dx + dy * dy;
		wBest = min(wBest, s.w + sqrt(d));
		float gr = s.z, g2 = gr * gr;
		if (d <= g2){
			if (d < D1){ D2 = D1; sec = own; secX = ownX; secY = ownY; secGr = ownGr;
				D1 = d; own = float(i); ownX = s.x; ownY = s.y; ownGr = gr; }
			else if (d < D2){ D2 = d; sec = float(i); secX = s.x; secY = s.y; secGr = gr; }
		}
		float inn = max(0.0, gr - uBand);
		float fin = inn * inn, fout = (gr + uBand) * (gr + uBand);
		if (d > fin && d < fout){
			float rel = d > g2 ? d - g2 : g2 - d;
			if (rel < fRel){ fRel = rel; fI = float(i); fDd = d; fGr = gr; }
		}
		if (uShowPoints > 0.5 && floor(s.x / uGs.x) == cellId.x){
			// the cell directly above a marker is tagged too (code 31) so the
			// letter's top can spill into it during the shockwave lift
			float my = floor(s.y / uGs.y);
			if (my == cellId.y) markerOwn = float(i);
			else if (my == cellId.y - 1.0) markerUp = float(i);
		}
	}
	float code = -1.0, d1 = 0.0, frontT = 0.0;
	if (own >= 0.0){
		d1 = sqrt(D1);
		if (sec >= 0.0){
			float d2 = sqrt(D2);
			if (d2 - d1 < uGs.x * 2.5){
				float ux = (center.x - secX) / max(d2, 1.0) - (center.x - ownX) / max(d1, 1.0);
				float uy = (center.y - secY) / max(d2, 1.0) - (center.y - ownY) / max(d1, 1.0);
				float grad = max(sqrt(ux * ux + uy * uy), 0.2);
				if ((d2 - d1) / grad < uGs.x * 0.62){
					float wa = min(ownGr - d1, secGr - d2);
					float bucket = min(3.0, floor(wa / 12.0));
					bool hov = (int(own) == uHoverI) || (int(sec) == uHoverI);
					code = bucket + (hov ? 10.0 : 0.0);
				}
			}
		}
	}
	if (code < 0.0 && fI >= 0.0 && (own < 0.0 || own == fI)){
		float fT = 1.0 - abs(sqrt(fDd) - fGr) / uBand;
		if (fT > 0.0) frontT = fT;
	}
	// interior wave phase while hovering: earliest arrival over ANY relay site,
	// min_i(geo[i] + |p - site_i|) (wBest, from the loop above) — continuous
	// everywhere; truncating the min to own/sec leaves corner-shaped seams where
	// a third site is the faster relay. Idle keeps the per-site ambient phase.
	// Packed into alpha as a negative value; positive alpha = wavefront ring.
	float wphase = 0.0;
	if (own >= 0.0){
		wphase = uHoverI >= 0 ? wBest : site(own).w + d1;
		wphase = min(wphase, 60000.0);  // keep the unreachable sentinel finite in half-float
	}
	if (markerOwn >= 0.0){ code = 30.0; own = markerOwn; }
	else if (markerUp >= 0.0 && code < 0.0 && frontT <= 0.0){ code = 31.0; own = markerUp; }
	gl_FragColor = vec4(own, d1, code, frontT > 0.0 ? frontT : -wphase);
}
`;

const glyphFrag = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uField;
uniform sampler2D uAtlas;
uniform sampler2D uSites;
uniform float uSitesTexW;
uniform vec2 uGrid;
uniform vec2 uCanvasSize;
uniform int uN;
uniform float uWaveT0;
uniform float uWaveS;
uniform float uAtlasCount;
uniform float uNow;
uniform vec2 uMouse;
uniform float uBoost;
uniform float uDonePulse;
uniform float uBand;
uniform vec3 uColEdge, uColCoral, uColPoint;
uniform vec3 uEmber0, uEmber1, uEmber2, uEmber3;
float cover(float idx, vec2 intra){
	vec2 gi = vec2(0.5) + (intra - 0.5) * 0.92;      // inset so neighbours don't bleed
	return texture2D(uAtlas, vec2((idx + gi.x) / uAtlasCount, gi.y)).r;
}
vec3 ember(float b){ return b < 0.5 ? uEmber0 : b < 1.5 ? uEmber1 : b < 2.5 ? uEmber2 : uEmber3; }
void main(){
	vec2 cellF = vUv * uGrid;
	vec2 cellId = floor(cellF);
	vec2 intra = fract(cellF);
	vec4 f = texture2D(uField, (cellId + 0.5) / uGrid);
	float own = f.r, d1 = f.g, code = f.b, frontT = max(f.a, 0.0), Wgeo = max(-f.a, 0.0);
	vec2 center = (cellId + 0.5) / uGrid * uCanvasSize;
	float heat = 0.0;
	vec2 hd = center - uMouse; float hd2 = dot(hd, hd);
	if (hd2 < 22500.0) heat = 1.0 - sqrt(hd2) / 150.0;

	// hover crest, hoisted so walls and site letters react too: comet profile
	// (razor leading edge, long trailing tail) sweeping outward from the hovered
	// site. crest = glyph-brightness drive; hot = color temperature — cools from
	// white-hot to the theme color as the ring expands and its amplitude dies.
	// pa = the bright band itself (razor front σ≈8, short back σ≈25); wa = long
	// faint comet wake trailing it. hot stays confined to the band (and cools by
	// amp² as the ring ages) so the tint never floods into a white blob.
	float crest = 0.0, hot = 0.0, passU = -1.0, passAmp = 0.0;
	if (uWaveT0 >= 0.0){
		float t = (uNow - uWaveT0) * 0.5, S = uWaveS, maxR = 2.0 * S;
		float Ra = mod(t, S), xa = Wgeo - Ra;
		float pa = xa > 0.0 ? exp(-xa * xa / 128.0) : exp(-xa * xa / 1250.0);
		float wa = xa < 0.0 ? exp(xa / 200.0) : 0.0;
		float aa = 1.0 - Ra / maxR;
		crest = (pa + 0.25 * wa) * aa; hot = pa * aa * aa;
		if (t >= S){
			float Rb = Ra + S, xb = Wgeo - Rb;
			float pb = xb > 0.0 ? exp(-xb * xb / 128.0) : exp(-xb * xb / 1250.0);
			float wb = xb < 0.0 ? exp(xb / 200.0) : 0.0;
			float ab = 1.0 - Rb / maxR;
			crest += (pb + 0.25 * wb) * ab; hot = max(hot, pb * ab * ab);
		}
		// px travelled since the most recent ring crossed this cell (−1 = none
		// yet) + that ring's strength at the crossing — drives the letter lift
		if (Ra >= Wgeo) passU = Ra - Wgeo;
		else if (t >= S && Ra + S >= Wgeo) passU = Ra + S - Wgeo;
		passAmp = max(0.0, 1.0 - Wgeo / maxR);
	}
	vec3 hotCol = mix(uColPoint, vec3(1.0), 0.35);
	// shockwave letter lift: damped-sine impulse — pop up (~0.6 cell at full
	// strength), fall back, slight undershoot dip, settle. In cell units.
	float lift = passU >= 0.0 ? sin(passU * 0.01256) * exp(-passU * 0.004) * passAmp : 0.0;

	if (code >= 31.0){                                // cell above a marker
		if (lift > 0.02){
			// the lifted (and scaled) letter's top spills up into this cell —
			// same transform as the marker branch, shifted one cell down
			float g = 10.0 + mod(own, 26.0);
			vec3 c = mix(uColPoint, hotCol, min(hot * 1.5, 1.0)) * (1.0 + 2.5 * hot);
			float mScale = 1.0 + max(lift, 0.0) * 0.9;
			float a = cover(g, (vec2(intra.x, intra.y + 1.0) - vec2(0.5, 0.5 + lift)) / mScale + 0.5);
			gl_FragColor = vec4(c * a, a);
			return;
		}
		code = -1.0;                                  // at rest: plain territory
	}

	float glyph = -1.0; vec3 col = vec3(0.0); float alpha = 0.0;
	if (code >= 30.0){                                // site marker letter
		// beacon: the letter flares overbright (HDR trail → bloom) as the crest
		// sweeps its site, so letters fire in geodesic order — and rides the
		// shockwave: raised by lift and scaled up around its lifted center while
		// airborne, shrinking back as it lands
		glyph = 10.0 + mod(own, 26.0); alpha = 1.0;
		col = mix(uColPoint, hotCol, min(hot * 1.5, 1.0)) * (1.0 + 2.5 * hot);
		float mScale = 1.0 + max(lift, 0.0) * 0.9;
		intra = (intra - vec2(0.5, 0.5 + lift)) / mScale + 0.5;
	} else if (code >= 0.0){                          // wall
		float hov = code >= 10.0 ? 1.0 : 0.0;
		float bucket = code - hov * 10.0;
		// hover: dense '@' + warm-bright ember (not flat white) so the present-pass
		// glow blooms a warm halo along the cell border instead of recoloring it
		glyph = hov > 0.5 ? 9.0 : (bucket < 0.5 ? 7.0 : 8.0);
		col = hov > 0.5 ? mix(ember(bucket), uColPoint, 0.25) : ember(bucket);
		alpha = hov > 0.5 ? 1.0 : 0.92;
		if (hov < 0.5 && crest > 0.01){
			// crest ignition: the border flashes white-hot as the wave crosses,
			// then cools back into its ember shade behind the front
			if (hot > 0.5) glyph = 9.0;
			col = mix(col, hotCol, min(hot * 1.3, 1.0) * 0.9) * (1.0 + 2.0 * hot);
			alpha = min(1.0, alpha + 0.08 * crest);
		}
	} else if (frontT > 0.0){                         // wavefront ring
		if (frontT <= 0.3) discard;                   // drop the dim outer skirt → thin crest
		float fb = min(3.0, floor(frontT * 4.0));
		glyph = fb < 0.5 ? 3.0 : fb < 1.5 ? 6.0 : fb < 2.5 ? 7.0 : 9.0;  // ":+*@"
		// clamped: the premultiplied output below needs alpha in [0,1], else col*a
		// and a saturate independently and the crest stops compositing correctly
		col = uColPoint; alpha = min(1.0, (0.4 + 0.5 * fb) * frontT);
	} else if (own >= 0.0){                           // interior territory
		vec4 so = texture2D(uSites, vec2((own + 0.5) / uSitesTexW, 0.5));
		float grOwn = so.z;
		float age = grOwn - d1;
		float base = max(0.24, 1.0 - age / 1000.0);
		// resting field is time-independent so cells stop pulsing in unison. Wgeo
		// (baked in the field pass) is a continuous geodesic distance over the
		// Voronoi graph. Hovering (uWaveT0 >= 0): rings are born at the hovered
		// site the moment the cursor enters the cell and expand outward with a
		// slight dispersion — the wave visibly launches instead of appearing
		// mid-flight. Idle: Wgeo carries a fixed per-site phase (see
		// computeGeoDist) and two free-running ring trains keep the field breathing.
		float shade = 0.7 + 0.3 * sin(age * 0.05 + d1 * 0.03);
		float ring = crest;
		if (uWaveT0 < 0.0){
			float maxR = 900.0, t = uNow * 0.22, sig = 15.0;
			float R1 = mod(t, maxR), R2 = mod(t + maxR * 0.5, maxR);
			ring = exp(-(Wgeo - R1) * (Wgeo - R1) / (2.0 * sig * sig)) * (1.0 - R1 / maxR)
				+ exp(-(Wgeo - R2) * (Wgeo - R2) / (2.0 * sig * sig)) * (1.0 - R2 / maxR);
		}
		float lvl = floor(base * shade * uBoost * 6.5 + ring * 6.0 + heat * 2.0 + 0.5);
		if (uDonePulse > 0.02){
			float ring = (1.0 - uDonePulse) * 1400.0;
			float rw = 1.0 - abs(d1 - ring) / 50.0;
			if (rw > 0.0) lvl += floor(rw * 4.0 + 0.5);
		}
		if (lvl < 1.0) discard;
		lvl = min(lvl, 9.0);
		glyph = lvl;
		col = mod(own, 2.0) < 0.5 ? uColEdge : uColCoral;
		alpha = 0.05 + 0.075 * lvl;
		if (crest > 0.01){
			// energized band: tint toward the crest color + overbright for bloom;
			// sparse cells riding the crest line scramble into flickering letters
			col = mix(col, hotCol, min(hot * 1.1, 1.0)) * (1.0 + 1.2 * hot);
			float h = fract(sin(dot(cellId, vec2(12.9898, 78.233))) * 43758.5453);
			if (crest > 0.6 && h < 0.16){
				glyph = 10.0 + mod(floor(uNow / 90.0) + floor(h * 26.0), 26.0);
				alpha = min(1.0, 0.35 + 0.6 * crest);
			}
		}
	} else {                                          // unclaimed paper
		if (uN == 0) discard;                         // blank canvas when cleared
		if (mod(cellId.x + cellId.y, 2.0) >= 0.5) discard;
		glyph = 1.0; col = uColEdge;
		alpha = heat > 0.02 ? 0.07 + 0.1 * (floor(heat * 4.0) + 1.0) : 0.07;
	}
	if (glyph < 0.0) discard;
	float a = cover(glyph, intra) * alpha;
	gl_FragColor = vec4(col * a, a);                  // premultiplied
}
`;

const fadeFrag = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uNew;
uniform sampler2D uPrev;
uniform float uKeep;
void main(){
	vec4 p = texture2D(uPrev, vUv) * uKeep;
	vec4 n = texture2D(uNew, vUv);
	gl_FragColor = n + p * (1.0 - n.a);               // premultiplied over of new onto decayed trail
}
`;

const presentFrag = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTrail;
uniform vec2 uTrailTexel;
uniform vec3 uBg;
uniform float uAdditive;
void main(){
	vec4 c = texture2D(uTrail, vUv);
	vec4 g = texture2D(uTrail, vUv + uTrailTexel * vec2(2.5, 0.0))
		+ texture2D(uTrail, vUv + uTrailTexel * vec2(-2.5, 0.0))
		+ texture2D(uTrail, vUv + uTrailTexel * vec2(0.0, 2.5))
		+ texture2D(uTrail, vUv + uTrailTexel * vec2(0.0, -2.5));
	vec3 glow = g.rgb * 0.25;
	vec3 col = uBg * (1.0 - c.a) + c.rgb;             // premultiplied over
	col += glow * (uAdditive > 0.5 ? 0.8 : 0.15);
	float sl = mod(gl_FragCoord.y, 3.0) < 1.0 ? (uAdditive > 0.5 ? 0.84 : 0.97) : 1.0;
	col *= sl;
	vec2 q = vUv - 0.5;
	col *= 1.0 - dot(q, q) * (uAdditive > 0.5 ? 0.7 : 0.24);
	gl_FragColor = vec4(col, 1.0);
}
`;

function buildAtlas(gl) {
	const n = RAMP.length;
	const c = document.createElement('canvas');
	c.width = n * ATLAS_CELL; c.height = ATLAS_CELL;
	const cx = c.getContext('2d');
	const tex = gl.createTexture();
	gl.bindTexture(gl.TEXTURE_2D, tex);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

	function bake() {
		cx.fillStyle = '#000'; cx.fillRect(0, 0, c.width, c.height);
		cx.fillStyle = '#fff';
		cx.font = Math.round(ATLAS_CELL * 0.82) + "px 'IBM Plex Mono', monospace";
		cx.textAlign = 'center'; cx.textBaseline = 'middle';
		for (let i = 0; i < n; i++) cx.fillText(RAMP[i], i * ATLAS_CELL + ATLAS_CELL * 0.5, ATLAS_CELL * 0.54);
		gl.bindTexture(gl.TEXTURE_2D, tex);
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
	}
	bake();
	// the first bake can land before the webfont arrives (?ascii=1 boots straight
	// into GL) — re-bake once it does, or the glyphs stay in the fallback face
	if (document.fonts && document.fonts.ready) document.fonts.ready.then(bake);

	return {
		texture: tex, count: n,
		attach(id) { gl.activeTexture(gl.TEXTURE0 + id); gl.bindTexture(gl.TEXTURE_2D, tex); return id; },
	};
}

export function createAsciiGL(canvas) {
	const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, preserveDrawingBuffer: false });
	if (!gl || !gl.getExtension('EXT_color_buffer_float')) return { available: false };

	const blit = createBlit(gl);
	const fs = src => compileShader(gl, gl.FRAGMENT_SHADER, src);
	const vs = compileShader(gl, gl.VERTEX_SHADER, baseVertex);
	const fieldProgram = new Program(gl, vs, fs(fieldFrag));
	const glyphProgram = new Program(gl, vs, fs(glyphFrag));
	const fadeProgram = new Program(gl, vs, fs(fadeFrag));
	const presentProgram = new Program(gl, vs, fs(presentFrag));
	const atlas = buildAtlas(gl);

	// sites data texture (x, y, gr, 0) — one texel per site, refilled each frame
	const sitesTex = gl.createTexture();
	gl.bindTexture(gl.TEXTURE_2D, sitesTex);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, MAX_SITES, 1, 0, gl.RGBA, gl.FLOAT, null);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	const siteBuf = new Float32Array(MAX_SITES * 4);

	let field = null, bitmap = null, trail = null;
	let cols = 0, rows = 0, W = 0, H = 0;

	function resize(w, h) {
		w = Math.max(1, w | 0); h = Math.max(1, h | 0);
		canvas.width = w; canvas.height = h;
		const c = Math.max(4, Math.round(w / GS_TARGET));
		const r = Math.max(4, Math.round(h / GS_TARGET));
		W = w; H = h;
		if (c === cols && r === rows && field) return;
		if (field) { gl.deleteTexture(field.texture); gl.deleteFramebuffer(field.fbo); }
		if (bitmap) { gl.deleteTexture(bitmap.texture); gl.deleteFramebuffer(bitmap.fbo); }
		if (trail) [trail.read, trail.write].forEach(t => { gl.deleteTexture(t.texture); gl.deleteFramebuffer(t.fbo); });
		cols = c; rows = r;
		field = createFBO(gl, cols, rows, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.NEAREST);
		bitmap = createFBO(gl, cols * GP, rows * GP, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR);
		// half-float, not RGBA8: an 8-bit trail can never decay to zero — round(1 *
		// 0.68) is 1, so every glyph ever drawn leaves a permanent 1/255 residue
		// (the fade-rounding trap in CLAUDE.md). Floats decay cleanly to black.
		trail = createDoubleFBO(gl, cols * GP, rows * GP, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR);
	}

	function clearTrail() {
		if (!trail) return;
		[trail.read, trail.write].forEach(t => {
			gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
			gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
		});
	}

	// state: { sites, n, now, hoverI, waveT0, waveS, geo, donePulse, mouseX, mouseY, showPoints, paused, theme }
	function render(st) {
		const theme = st.theme;
		gl.disable(gl.BLEND);

		const n = Math.min(st.n, MAX_SITES);
		if (n > 0) {
			// data space is y-down (top-left origin, like the 2D canvas); the GL
			// vUv space is y-up (bottom-left). Flip site + mouse Y here so the
			// field renders upright and cursor/hover math lands on the right cell.
			for (let i = 0; i < n; i++) {
				const s = st.sites[i];
				// .w = the site's wave phase: geodesic distance from the hovered site
				// (0 there), or a fixed ambient phase when idle (see computeGeoDist)
				const g = st.geo ? st.geo[i] : 0;
				siteBuf[i * 4] = s.x; siteBuf[i * 4 + 1] = H - s.y; siteBuf[i * 4 + 2] = s.gr;
				siteBuf[i * 4 + 3] = g < 1e18 ? g : 1e9;    // unreachable → huge (never lights)
			}
			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, sitesTex);
			gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, n, 1, gl.RGBA, gl.FLOAT, siteBuf);
		}

		const gsX = W / cols, gsY = H / rows;
		const band = GS_TARGET * 0.42;   // wavefront-ring half-width (thinner = crisper front)
		const boost = 1 + st.donePulse * 0.8;

		// pass 1 — field at cell resolution
		fieldProgram.bind();
		let U = fieldProgram.uniforms;
		gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, sitesTex);
		gl.uniform1i(U.uSites, 0);
		gl.uniform1f(U.uSitesTexW, MAX_SITES);
		gl.uniform1i(U.uN, n);
		gl.uniform2f(U.uCanvasSize, W, H);
		gl.uniform2f(U.uGrid, cols, rows);
		gl.uniform2f(U.uGs, gsX, gsY);
		gl.uniform1f(U.uBand, band);
		gl.uniform1i(U.uHoverI, st.hoverI);
		gl.uniform1f(U.uShowPoints, st.showPoints ? 1 : 0);
		blit(field);

		// pass 2 — glyph bitmap. Clear to transparent first: the shader discards
		// empty cells, so without this the FBO keeps stale glyphs (a cleared board
		// leaves every fragment discarded → the whole last frame ghosts forever).
		gl.bindFramebuffer(gl.FRAMEBUFFER, bitmap.fbo);
		gl.viewport(0, 0, bitmap.width, bitmap.height);
		gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
		glyphProgram.bind();
		U = glyphProgram.uniforms;
		gl.uniform1i(U.uField, field.attach(0));
		gl.uniform1i(U.uAtlas, atlas.attach(1));
		gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, sitesTex);
		gl.uniform1i(U.uSites, 2);
		gl.uniform1f(U.uSitesTexW, MAX_SITES);
		gl.uniform2f(U.uGrid, cols, rows);
		gl.uniform2f(U.uCanvasSize, W, H);
		gl.uniform1i(U.uN, n);
		gl.uniform1f(U.uWaveT0, st.waveT0 == null ? -1 : st.waveT0);
		gl.uniform1f(U.uWaveS, st.waveS);
		gl.uniform1f(U.uAtlasCount, atlas.count);
		gl.uniform1f(U.uNow, st.now);
		gl.uniform2f(U.uMouse, st.mouseX, H - st.mouseY);
		gl.uniform1f(U.uBoost, boost);
		gl.uniform1f(U.uDonePulse, st.donePulse);
		gl.uniform1f(U.uBand, band);
		gl.uniform3fv(U.uColEdge, theme.edge);
		gl.uniform3fv(U.uColCoral, theme.coral);
		gl.uniform3fv(U.uColPoint, theme.point);
		gl.uniform3fv(U.uEmber0, theme.ember[0]);
		gl.uniform3fv(U.uEmber1, theme.ember[1]);
		gl.uniform3fv(U.uEmber2, theme.ember[2]);
		gl.uniform3fv(U.uEmber3, theme.ember[3]);
		blit(bitmap);

		// pass 3 — phosphor fade (skip decay while paused so the trail holds)
		fadeProgram.bind();
		U = fadeProgram.uniforms;
		gl.uniform1i(U.uNew, bitmap.attach(0));
		gl.uniform1i(U.uPrev, trail.read.attach(1));
		gl.uniform1f(U.uKeep, st.paused ? 1.0 : 0.68);   // shorter phosphor → moving fronts don't smear into fat rings
		blit(trail.write);
		trail.swap();

		// pass 4 — present to canvas
		presentProgram.bind();
		U = presentProgram.uniforms;
		gl.uniform1i(U.uTrail, trail.read.attach(0));
		gl.uniform2f(U.uTrailTexel, 1 / trail.read.width, 1 / trail.read.height);
		gl.uniform3fv(U.uBg, theme.bg);
		gl.uniform1f(U.uAdditive, theme.additive ? 1 : 0);
		blit(null);
	}

	return { available: true, render, resize, clearTrail };
}
