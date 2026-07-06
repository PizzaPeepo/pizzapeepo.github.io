// Shaders owned by the index ASCII background (FluidSimulation/glsl.js is
// imported read-only; anything the background needs to differ goes here).

// Ashima 2D simplex noise (webgl-noise, MIT) — shared by the ambient passes.
const SIMPLEX_2D = `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }
float snoise(vec2 v) {
	const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
	vec2 i = floor(v + dot(v, C.yy));
	vec2 x0 = v - i + dot(i, C.xx);
	vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
	vec4 x12 = x0.xyxy + C.xxzz;
	x12.xy -= i1;
	i = mod289(i);
	vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
	vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
	m = m * m; m = m * m;
	vec3 x = 2.0 * fract(p * C.www) - 1.0;
	vec3 h = abs(x) - 0.5;
	vec3 ox = floor(x + 0.5);
	vec3 a0 = x - ox;
	m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
	vec3 g;
	g.x = a0.x * x0.x + h.x * x0.y;
	g.yz = a0.yz * x12.xz + h.yz * x12.yw;
	return 130.0 * dot(m, g);
}
`;

// Ambient curl-noise force: adds the curl of a slowly-scrolling 2-octave simplex
// potential to the velocity field — large lazy swirls that keep the background
// alive without pointer input (vibe-coded's noiseVelocityPasses equivalent).
export const noiseVelocity = `
precision highp float;
precision highp sampler2D;
varying vec2 vUv;
uniform sampler2D uVelocity;
uniform float uTime;
uniform float uStrength;   // force added per pass (caller folds dt in)
uniform float uScale;      // noise spatial frequency
uniform float uAspect;
uniform vec2 uWind;        // uniform drift force added per pass (caller folds dt in)
` + SIMPLEX_2D + `
float psi (vec2 p) {
	return snoise(p + vec2(uTime * 0.13, -uTime * 0.09))
	     + 0.5 * snoise(p * 2.3 + vec2(-uTime * 0.07, uTime * 0.11));
}
void main () {
	vec2 base = texture2D(uVelocity, vUv).xy;
	vec2 p = vec2(vUv.x * uAspect, vUv.y) * uScale;
	float e = 0.02;
	float vx =  (psi(p + vec2(0.0, e)) - psi(p - vec2(0.0, e))) / (2.0 * e);
	float vy = -(psi(p + vec2(e, 0.0)) - psi(p - vec2(e, 0.0))) / (2.0 * e);
	gl_FragColor = vec4(base + vec2(vx, vy) * uStrength + uWind, 0.0, 1.0);
}
`;

// Ambient dye emission: a very low-frequency noise field thresholded into soft
// blobs, colored by a slow crawl between two theme inks. Patches appear, wander
// with the curl flow, and merge via advection; dissipation retires them.
export const noiseDye = `
precision highp float;
precision highp sampler2D;
varying vec2 vUv;
uniform sampler2D uTarget;
uniform float uTime;
uniform float uRate;       // dye added per pass at blob cores (dt folded in)
uniform float uScale;
uniform float uThresh;
uniform float uDrift;      // pattern translation speed — blobs enter right, exit left
uniform float uAspect;
uniform vec3 uColA;
uniform vec3 uColB;
` + SIMPLEX_2D + `
void main () {
	vec3 base = texture2D(uTarget, vUv).rgb;
	vec2 p = vec2(vUv.x * uAspect, vUv.y) * uScale;
	float m = snoise(p + vec2(uTime * uDrift, uTime * 0.028));
	float blob = smoothstep(uThresh, uThresh + 0.25, m);
	float hueT = 0.5 + 0.5 * snoise(p * 0.53 - vec2(uTime * 0.019, 0.0));
	vec3 col = mix(uColA, uColB, hueT);
	gl_FragColor = vec4(base + col * blob * uRate, 1.0);
}
`;

// Hover repulsion (Phase 5, vibe-coded mechanism): outward force in a
// rounded-rect falloff around the hovered element. dist is the SDF of the
// aspect-corrected rect (0 inside), falloff smoothsteps to zero at uRange.
export const hoverRepulsion = `
precision highp float;
precision highp sampler2D;
varying vec2 vUv;
uniform sampler2D uVelocity;
uniform vec2 uCenter;      // uv, y-up
uniform vec2 uHalfSize;    // uv half extents
uniform float uRange;      // falloff distance beyond the rect edge (aspect-corrected uv)
uniform float uStrength;   // force added this pass (caller folds dt + ease in)
uniform float uAspect;
void main () {
	vec2 base = texture2D(uVelocity, vUv).xy;
	vec2 d = vec2((vUv.x - uCenter.x) * uAspect, vUv.y - uCenter.y);
	vec2 hs = vec2(uHalfSize.x * uAspect, uHalfSize.y);
	float dist = length(max(abs(d) - hs, 0.0));
	float fall = 1.0 - smoothstep(0.0, uRange, dist);
	vec2 dir = normalize(d + vec2(0.00001, 0.00002));
	gl_FragColor = vec4(base + dir * fall * uStrength, 0.0, 1.0);
}
`;

// Matching faint dye glow: a soft band hugging the outside of the hovered
// rect (zero inside — the element itself covers that area anyway).
export const hoverDye = `
precision highp float;
precision highp sampler2D;
varying vec2 vUv;
uniform sampler2D uTarget;
uniform vec2 uCenter;
uniform vec2 uHalfSize;
uniform float uRange;
uniform float uRate;       // dye added this pass (dt + ease folded in)
uniform float uAspect;
uniform vec3 uColor;
void main () {
	vec3 base = texture2D(uTarget, vUv).rgb;
	vec2 d = vec2((vUv.x - uCenter.x) * uAspect, vUv.y - uCenter.y);
	vec2 hs = vec2(uHalfSize.x * uAspect, uHalfSize.y);
	float dist = length(max(abs(d) - hs, 0.0));
	float band = (1.0 - smoothstep(0.0, uRange, dist)) * smoothstep(0.0, uRange * 0.15, dist);
	gl_FragColor = vec4(base + uColor * band * uRate, 1.0);
}
`;

// Fork of FluidSimulation/glsl.js#divergence with the domain-edge velocity
// reflection removed: edges stop acting as walls, so the wind carries fluid
// off the left edge (and streams it in from the right) instead of piling up.
// Obstacle handling kept — the core binds an empty mask, uniforms must match.
export const divergenceOpen = `
precision mediump float;
precision mediump sampler2D;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;
uniform sampler2D uVelocity;
uniform sampler2D uObstacle;
void main () {
	float L = texture2D(uVelocity, vL).x;
	float R = texture2D(uVelocity, vR).x;
	float T = texture2D(uVelocity, vT).y;
	float B = texture2D(uVelocity, vB).y;
	if (texture2D(uObstacle, vL).x > 0.5) { L = 0.0; }
	if (texture2D(uObstacle, vR).x > 0.5) { R = 0.0; }
	if (texture2D(uObstacle, vT).x > 0.5) { T = 0.0; }
	if (texture2D(uObstacle, vB).x > 0.5) { B = 0.0; }
	float div = 0.5 * (R - L + T - B);
	gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
}
`;

// Fork of FluidSimulation/glsl.js#advection (non-MANUAL_FILTERING path, the
// only one the core compiles): back-traced samples that land outside [0,1]
// return vacuum instead of the clamped edge texel. With the leftward wind this
// means nothing streams in over the right edge — existing dye drifts out left,
// no new fluid enters. Obstacle handling kept (uniform parity with the core).
export const advectionVacuum = `
precision highp float;
precision highp sampler2D;
varying vec2 vUv;
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform sampler2D uObstacle;
uniform vec2 texelSize;
uniform vec2 dyeTexelSize;
uniform float dt;
uniform float dissipation;
void main () {
	if (texture2D(uObstacle, vUv).x > 0.5) {
		gl_FragColor = vec4(0.0);
		return;
	}
	vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
	vec4 result = texture2D(uSource, coord);
	vec2 inLo = step(vec2(0.0), coord);
	vec2 inHi = step(coord, vec2(1.0));
	result *= inLo.x * inLo.y * inHi.x * inHi.y;
	float decay = 1.0 + dissipation * dt;
	gl_FragColor = result / decay;
}
`;

// Fork of FluidSimulation/asciiShaders.js#asciiArt, density mode only, plus a
// density floor: advection smears a residue (~0.02-0.08) across the whole field
// and the stock brightness curve (pow(lum,0.5)*2.4) lights it up — every cell
// glows. uFloor remaps density so the residue stays dark and only real patches
// produce glyphs. EDGE/BRAILLE variants dropped (background uses the lum ramp).
export const asciiArtBg = `
precision highp float;
precision highp sampler2D;
varying vec2 vUv;
uniform sampler2D uScene;     // low-res LDR fluid (one texel per cell)
uniform sampler2D uGlyphs;    // luminance ramp atlas (sparse→dense)
uniform vec2 uGrid;           // cols, rows
uniform float uGlyphCount;
uniform float uJitter;
uniform float uFloor;         // density below this renders nothing
uniform sampler2D uTextA;     // text layer: rgb color, a charset index
uniform sampler2D uTextB;     // text layer: rg sub-tile origin, b sub size, a enable
uniform sampler2D uTextGlyphs;   // charset atlas (index = charCode-32)
uniform float uTextGlyphCount;
uniform float uTextFloor;        // hero-title ambient opacity (still fluid)
uniform float uTextGain;         // hero-title extra opacity per unit density (wave reveal)
uniform sampler2D uCardanGlyphs; // thin line-art ramp for the gimbal
uniform float uCardanGlyphCount;
uniform float uCardanMask;       // 1 = scene alpha carries the gimbal coverage tag
uniform float uCardanFloor;      // alpha above this = gimbal cell → thin ramp

float hash (vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main () {
	vec2 g = vUv * uGrid;
	vec2 cell = floor(g);
	vec2 cuv = fract(g);
	vec2 cc = (cell + 0.5) / uGrid;
	vec4 scene = texture2D(uScene, cc);
	vec3 col = scene.rgb;
	// Gimbal cells (alpha-tagged by cardan-scene.js compositeInto) use a separate
	// thin ramp so the rings read as line-art arcs, not fat block glyphs.
	bool isCardan = uCardanMask > 0.5 && scene.a > uCardanFloor;
	float dens = max(col.r, max(col.g, col.b));   // scene max-channel drives the ramp (fluid + gimbal alike)
	dens = clamp((dens - uFloor) / (1.0 - uFloor), 0.0, 1.0);
	float lum = clamp(dot(col, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);
	lum = clamp((lum - uFloor) / (1.0 - uFloor), 0.0, 1.0);
	float mx = max(col.r, max(col.g, col.b));
	vec3 hue = col / max(mx, 0.0001);

	vec3 neon = hue * clamp(0.25 + pow(lum, 0.65) * 1.6, 0.0, 0.82);
	float lr = pow(dens, 0.6);
	lr = clamp(lr + (hash(cell) - 0.5) * uJitter * (1.0 - lr) * step(0.05, lr), 0.0, 0.9999);

	float gcount = isCardan ? uCardanGlyphCount : uGlyphCount;
	float fidx = min(lr, 0.9999) * gcount;
	float fi = floor(fidx);
	float fb = fract(fidx);
	float i1 = min(fi + 1.0, gcount - 1.0);
	float mask;
	if (isCardan) {
		mask = mix(
			texture2D(uCardanGlyphs, vec2((fi + cuv.x) / gcount, cuv.y)).r,
			texture2D(uCardanGlyphs, vec2((i1 + cuv.x) / gcount, cuv.y)).r, fb);
	} else {
		mask = mix(
			texture2D(uGlyphs, vec2((fi + cuv.x) / gcount, cuv.y)).r,
			texture2D(uGlyphs, vec2((i1 + cuv.x) / gcount, cuv.y)).r, fb);
	}

	vec3 gcol = neon;   // no desaturation tint — the stock gold wash read as yellow patches
	vec3 fluidCol = gcol * (0.8 * mask);

	// Text cell (Phase 7): translucent hero title. Ink is added over the fluid
	// ramp with opacity driven by local density (uTextFloor = ambient visibility,
	// uTextGain = wave response), so the title is near-invisible in still fluid
	// and lights up only as a wave passes through it.
	vec4 tB = texture2D(uTextB, cc);
	if (tB.a > 0.5) {
		vec4 tA = texture2D(uTextA, cc);
		float ti = floor(tA.a * 255.0 + 0.5);
		vec2 tguv = vec2(tB.r + cuv.x * tB.b, tB.g + cuv.y * tB.b);
		float tm = texture2D(uTextGlyphs, vec2((ti + tguv.x) / uTextGlyphCount, tguv.y)).r;
		vec3 ink = mix(tA.rgb, hue, clamp(dens * 1.1, 0.0, 0.6));
		float reveal = clamp(uTextFloor + dens * uTextGain, 0.0, 1.0);
		gl_FragColor = vec4(fluidCol + ink * tm * reveal, 1.0);
		return;
	}
	gl_FragColor = vec4(fluidCol, 1.0);
}
`;

// Present the glyph bitmap to the screen with a theme-aware composite:
//   dark themes  — additive over the (near-black) background: glyphs glow.
//   light theme  — glyphs as ink: coverage mixes the paper toward the glyph
//                  hue, darkened, so the lattice reads as print, not neon.
// No zoom/pan/CRT-triad (that stays a FluidSimulation-demo feature); glow halo
// kept but on a lighter 5×5 kernel — the background covers the whole viewport
// every frame, the demo's 7×7 is over budget here.
export const asciiPresentBg = `
precision highp float;
precision highp sampler2D;
varying vec2 vUv;
uniform sampler2D uAscii;
uniform vec2 uAsciiSize;      // glyph-bitmap size in texels
uniform vec3 uBack;           // theme background
uniform float uGlow;          // 1 = halo on
uniform float uGlowAmount;
uniform float uLight;         // 0 = dark composite, 1 = light (ink-on-paper)
void main () {
	vec3 base = texture2D(uAscii, vUv).rgb;
	if (uGlow > 0.5) {
		vec2 px = 1.0 / uAsciiSize;
		vec3 bloom = vec3(0.0);
		float wsum = 0.0;
		for (int bx = -2; bx <= 2; bx++) {
			for (int by = -2; by <= 2; by++) {
				vec2 o = vec2(float(bx), float(by)) * 2.0;
				float w = exp(-dot(o, o) * 0.10);
				bloom += texture2D(uAscii, vUv + o * px).rgb * w;
				wsum += w;
			}
		}
		base += (bloom / wsum) * uGlowAmount;
	}
	float mx = max(base.r, max(base.g, base.b));
	float a = clamp(mx * 1.6, 0.0, 1.0);
	vec3 hue = base / max(mx, 0.0001);
	vec3 dark = uBack + base;
	vec3 ink = mix(uBack, hue * 0.50, a);
	gl_FragColor = vec4(mix(dark, ink, uLight), 1.0);
}
`;
