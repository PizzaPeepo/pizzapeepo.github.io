// GLSL ES 1.00 shader sources (compile fine under WebGL2). Adapted from
// PavelDoGreat/WebGL-Fluid-Simulation (MIT), extended with obstacle boundary conditions:
// advection / divergence / pressure / gradientSubtract / splat all sample uObstacle
// (1 = solid) and enforce no-slip velocity + Neumann pressure at solid faces.

export const baseVertex = `
precision highp float;
attribute vec2 aPosition;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;
uniform vec2 texelSize;
void main () {
	vUv = aPosition * 0.5 + 0.5;
	vL = vUv - vec2(texelSize.x, 0.0);
	vR = vUv + vec2(texelSize.x, 0.0);
	vT = vUv + vec2(0.0, texelSize.y);
	vB = vUv - vec2(0.0, texelSize.y);
	gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

export const blurVertex = `
precision highp float;
attribute vec2 aPosition;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
uniform vec2 texelSize;
void main () {
	vUv = aPosition * 0.5 + 0.5;
	float offset = 1.33333333;
	vL = vUv - texelSize * offset;
	vR = vUv + texelSize * offset;
	gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

export const blur = `
precision mediump float;
precision mediump sampler2D;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
uniform sampler2D uTexture;
void main () {
	vec4 sum = texture2D(uTexture, vUv) * 0.29411764;
	sum += texture2D(uTexture, vL) * 0.35294117;
	sum += texture2D(uTexture, vR) * 0.35294117;
	gl_FragColor = sum;
}
`;

export const copy = `
precision mediump float;
precision mediump sampler2D;
varying vec2 vUv;
uniform sampler2D uTexture;
void main () {
	gl_FragColor = texture2D(uTexture, vUv);
}
`;

export const clear = `
precision mediump float;
precision mediump sampler2D;
varying vec2 vUv;
uniform sampler2D uTexture;
uniform float value;
void main () {
	gl_FragColor = value * texture2D(uTexture, vUv);
}
`;

export const color = `
precision mediump float;
uniform vec4 color;
void main () {
	gl_FragColor = color;
}
`;

export const splat = `
precision highp float;
precision highp sampler2D;
varying vec2 vUv;
uniform sampler2D uTarget;
uniform sampler2D uObstacle;
uniform float aspectRatio;
uniform vec3 color;
uniform vec2 point;
uniform float radius;
void main () {
	vec2 p = vUv - point.xy;
	p.x *= aspectRatio;
	vec3 splat = exp(-dot(p, p) / radius) * color;
	vec3 base = texture2D(uTarget, vUv).xyz;
	float free = 1.0 - step(0.5, texture2D(uObstacle, vUv).x);
	gl_FragColor = vec4(base + splat * free, 1.0);
}
`;

export const advection = `
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

vec4 bilerp (sampler2D sam, vec2 uv, vec2 tsize) {
	vec2 st = uv / tsize - 0.5;
	vec2 iuv = floor(st);
	vec2 fuv = fract(st);
	vec4 a = texture2D(sam, (iuv + vec2(0.5, 0.5)) * tsize);
	vec4 b = texture2D(sam, (iuv + vec2(1.5, 0.5)) * tsize);
	vec4 c = texture2D(sam, (iuv + vec2(0.5, 1.5)) * tsize);
	vec4 d = texture2D(sam, (iuv + vec2(1.5, 1.5)) * tsize);
	return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
}

void main () {
	if (texture2D(uObstacle, vUv).x > 0.5) {
		gl_FragColor = vec4(0.0);
		return;
	}
#ifdef MANUAL_FILTERING
	vec2 coord = vUv - dt * bilerp(uVelocity, vUv, texelSize).xy * texelSize;
	vec4 result = bilerp(uSource, coord, dyeTexelSize);
#else
	vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
	vec4 result = texture2D(uSource, coord);
#endif
	float decay = 1.0 + dissipation * dt;
	gl_FragColor = result / decay;
}
`;

export const divergence = `
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
	vec2 C = texture2D(uVelocity, vUv).xy;
	// domain edges: reflect
	if (vL.x < 0.0) { L = -C.x; }
	if (vR.x > 1.0) { R = -C.x; }
	if (vT.y > 1.0) { T = -C.y; }
	if (vB.y < 0.0) { B = -C.y; }
	// solid neighbours: no flux through the wall face
	if (texture2D(uObstacle, vL).x > 0.5) { L = 0.0; }
	if (texture2D(uObstacle, vR).x > 0.5) { R = 0.0; }
	if (texture2D(uObstacle, vT).x > 0.5) { T = 0.0; }
	if (texture2D(uObstacle, vB).x > 0.5) { B = 0.0; }
	float div = 0.5 * (R - L + T - B);
	gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
}
`;

export const curl = `
precision mediump float;
precision mediump sampler2D;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;
uniform sampler2D uVelocity;
void main () {
	float L = texture2D(uVelocity, vL).y;
	float R = texture2D(uVelocity, vR).y;
	float T = texture2D(uVelocity, vT).x;
	float B = texture2D(uVelocity, vB).x;
	float vorticity = R - L - T + B;
	gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
}
`;

export const vorticity = `
precision highp float;
precision highp sampler2D;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;
uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform sampler2D uObstacle;
uniform float curl;
uniform float dt;
void main () {
	float L = texture2D(uCurl, vL).x;
	float R = texture2D(uCurl, vR).x;
	float T = texture2D(uCurl, vT).x;
	float B = texture2D(uCurl, vB).x;
	float C = texture2D(uCurl, vUv).x;
	vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
	force /= length(force) + 0.0001;
	force *= curl * C;
	force.y *= -1.0;
	vec2 velocity = texture2D(uVelocity, vUv).xy;
	velocity += force * dt;
	velocity = min(max(velocity, -1000.0), 1000.0);
	float free = 1.0 - step(0.5, texture2D(uObstacle, vUv).x);
	gl_FragColor = vec4(velocity * free, 0.0, 1.0);
}
`;

export const pressure = `
precision mediump float;
precision mediump sampler2D;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
uniform sampler2D uObstacle;
void main () {
	float L = texture2D(uPressure, vL).x;
	float R = texture2D(uPressure, vR).x;
	float T = texture2D(uPressure, vT).x;
	float B = texture2D(uPressure, vB).x;
	float C = texture2D(uPressure, vUv).x;
	// Neumann at solids (dp/dn = 0): borrow the centre pressure for solid neighbours
	if (texture2D(uObstacle, vL).x > 0.5) { L = C; }
	if (texture2D(uObstacle, vR).x > 0.5) { R = C; }
	if (texture2D(uObstacle, vT).x > 0.5) { T = C; }
	if (texture2D(uObstacle, vB).x > 0.5) { B = C; }
	float divergence = texture2D(uDivergence, vUv).x;
	float pressure = (L + R + B + T - divergence) * 0.25;
	gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
}
`;

export const gradientSubtract = `
precision mediump float;
precision mediump sampler2D;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;
uniform sampler2D uPressure;
uniform sampler2D uVelocity;
uniform sampler2D uObstacle;
void main () {
	if (texture2D(uObstacle, vUv).x > 0.5) {
		gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
		return;
	}
	float L = texture2D(uPressure, vL).x;
	float R = texture2D(uPressure, vR).x;
	float T = texture2D(uPressure, vT).x;
	float B = texture2D(uPressure, vB).x;
	float C = texture2D(uPressure, vUv).x;
	if (texture2D(uObstacle, vL).x > 0.5) { L = C; }
	if (texture2D(uObstacle, vR).x > 0.5) { R = C; }
	if (texture2D(uObstacle, vT).x > 0.5) { T = C; }
	if (texture2D(uObstacle, vB).x > 0.5) { B = C; }
	vec2 velocity = texture2D(uVelocity, vUv).xy;
	velocity.xy -= vec2(R - L, T - B);
	gl_FragColor = vec4(velocity, 0.0, 1.0);
}
`;

export const sunraysMask = `
precision highp float;
precision highp sampler2D;
varying vec2 vUv;
uniform sampler2D uTexture;
void main () {
	vec4 c = texture2D(uTexture, vUv);
	float br = max(c.r, max(c.g, c.b));
	c.a = 1.0 - min(max(br * 20.0, 0.0), 0.8);
	gl_FragColor = c;
}
`;

export const sunrays = `
precision highp float;
precision highp sampler2D;
varying vec2 vUv;
uniform sampler2D uTexture;
uniform float weight;
#define ITERATIONS 16
void main () {
	float Density = 0.3;
	float Decay = 0.95;
	float Exposure = 0.7;
	vec2 coord = vUv;
	vec2 dir = vUv - 0.5;
	dir *= 1.0 / float(ITERATIONS) * Density;
	float illuminationDecay = 1.0;
	float color = texture2D(uTexture, vUv).a;
	for (int i = 0; i < ITERATIONS; i++) {
		coord -= dir;
		float col = texture2D(uTexture, coord).a;
		color += col * illuminationDecay * weight;
		illuminationDecay *= Decay;
	}
	gl_FragColor = vec4(color * Exposure, 0.0, 0.0, 1.0);
}
`;

export const display = `
precision highp float;
precision highp sampler2D;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;
uniform sampler2D uTexture;
uniform sampler2D uSunrays;
uniform sampler2D uDithering;
uniform vec2 ditherScale;
uniform vec2 texelSize;
uniform sampler2D uObstacle;
uniform vec3 uObstacleColor;

// Thermal palette (density -> colour): black -> blue -> cyan -> near-white -> yellow -> red.
vec3 heatRamp (float t) {
	t = clamp(t, 0.0, 1.0);
	vec3 c = mix(vec3(0.0),            vec3(0.0, 0.12, 0.70), smoothstep(0.00, 0.16, t));
	c = mix(c, vec3(0.0, 0.55, 1.0),  smoothstep(0.16, 0.32, t));
	c = mix(c, vec3(0.0, 1.0, 1.0),   smoothstep(0.32, 0.46, t));
	c = mix(c, vec3(0.85, 0.95, 1.0), smoothstep(0.46, 0.56, t));
	c = mix(c, vec3(1.0, 1.0, 0.0),   smoothstep(0.56, 0.71, t));
	c = mix(c, vec3(1.0, 0.45, 0.0),  smoothstep(0.71, 0.93, t));
	c = mix(c, vec3(1.0, 0.0, 0.0),   smoothstep(0.93, 1.00, t));
	return c;
}

vec3 linearToGamma (vec3 c) {
	c = max(c, vec3(0.0));
	return max(1.055 * pow(c, vec3(0.416666667)) - 0.055, vec3(0.0));
}

void main () {
	vec3 c = texture2D(uTexture, vUv).rgb;
	float dens = max(c.r, max(c.g, c.b));   // raw dye density, before shading
#ifdef SHADING
	vec3 lc = texture2D(uTexture, vL).rgb;
	vec3 rc = texture2D(uTexture, vR).rgb;
	vec3 tc = texture2D(uTexture, vT).rgb;
	vec3 bc = texture2D(uTexture, vB).rgb;
	float dx = length(rc) - length(lc);
	float dy = length(tc) - length(bc);
	vec3 n = normalize(vec3(dx, dy, length(texelSize)));
	vec3 l = vec3(0.0, 0.0, 1.0);
	float diffuse = clamp(dot(n, l) + 0.7, 0.7, 1.0);
	c *= diffuse;
#endif
#ifdef SUNRAYS
	float sunrays = texture2D(uSunrays, vUv).r;
	c *= sunrays;
#endif
#ifdef HEATMAP
	c = heatRamp(pow(clamp(dens * 3.0, 0.0, 1.0), 0.75));   // density -> thermal palette
#endif
	float ob = texture2D(uObstacle, vUv).x;
	float edge = smoothstep(0.35, 0.65, ob);
	c = mix(c, uObstacleColor, edge);
	float a = max(c.r, max(c.g, c.b));
	gl_FragColor = vec4(c, a);
}
`;

// Stamps a soft-edged SDF shape into the obstacle mask (add or erase).
export const obstacleStamp = `
precision highp float;
precision highp sampler2D;
varying vec2 vUv;
uniform sampler2D uTarget;
uniform float aspectRatio;
uniform vec2 uPoint;
uniform vec2 uSize;     // circle: x=radius; box: half-extents; capsule: x=half-len, y=radius
uniform float uAngle;
uniform int uShape;     // 0 circle, 1 box, 2 capsule
uniform float uErase;   // 1 = erase

float sdCircle (vec2 p, float r) { return length(p) - r; }
float sdBox (vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
float sdCapsule (vec2 p, float halfLen, float r) { p.x -= clamp(p.x, -halfLen, halfLen); return length(p) - r; }

void main () {
	vec2 p = vUv - uPoint;
	p.x *= aspectRatio;
	float cs = cos(uAngle), sn = sin(uAngle);
	p = mat2(cs, -sn, sn, cs) * p;
	float d;
	if (uShape == 1) d = sdBox(p, uSize);
	else if (uShape == 2) d = sdCapsule(p, uSize.x, uSize.y);
	else d = sdCircle(p, uSize.x);
	float fill = 1.0 - smoothstep(0.0, 0.0035, d);
	float base = texture2D(uTarget, vUv).x;
	float result = uErase > 0.5 ? base * (1.0 - fill) : max(base, fill);
	gl_FragColor = vec4(result, 0.0, 0.0, 1.0);
}
`;

// ── ASCII mode ──
// Stage A: turn the LDR fluid image into a colored glyph bitmap. For each output
// texel: find its grid cell, sample the fluid colour at the cell centre, pick a
// glyph from the ramp atlas by luminance, and mask the cell colour by that glyph.
export const asciiArt = `
precision highp float;
precision highp sampler2D;
varying vec2 vUv;
uniform sampler2D uScene;     // low-res LDR fluid (one texel per cell)
uniform sampler2D uGlyphs;    // glyph atlas, uGlyphCount chars left-to-right
uniform sampler2D uDye;       // raw dye field (pre-colormap) — drives the glyph ramp
uniform sampler2D uObstacle;  // obstacle mask — force a solid glyph so walls aren't blank
uniform vec3 uObsColor;       // fixed obstacle glyph colour — independent of the fluid hue
uniform vec2 uGrid;           // cols, rows
uniform float uGlyphCount;
uniform float uJitter;        // per-cell ramp jitter amount (HUD slider) — grainy dissipation
float hash (vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main () {
	vec2 g = vUv * uGrid;
	vec2 cell = floor(g);
	vec2 cuv = fract(g);
	vec3 col = texture2D(uScene, (cell + 0.5) / uGrid).rgb;
	vec3 dye = texture2D(uDye, (cell + 0.5) / uGrid).rgb;
	float ob = step(0.5, texture2D(uObstacle, (cell + 0.5) / uGrid).x);   // 1 inside a wall
	float dens = max(dye.r, max(dye.g, dye.b));    // raw dye amount, carries the detail the palette flattens
	float lum = clamp(dot(col, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);
	float mx = max(col.r, max(col.g, col.b));
	vec3 hue = col / max(mx, 0.0001);              // unit-peak hue (full saturation)
	vec3 neon = hue * clamp(pow(lum, 0.5) * 2.4, 0.0, 1.2);  // density → vivid neon brightness
	float lr = pow(clamp(max(dens, ob), 0.0, 1.0), 0.6);   // ramp by dye density (obstacle forced solid) — every hue sweeps the full glyph set (flat-red heat zone stops pinning to one char)
	lr = clamp(lr + (hash(cell) - 0.5) * uJitter * (1.0 - lr) * step(0.05, lr), 0.0, 0.9999);   // per-cell jitter, only above ramp step(0.05, lr) (empty cells stay clean), fades out toward solid cores/walls → grainy dissipation instead of uniform bands
	float fidx = min(lr, 0.9999) * uGlyphCount;    // continuous ramp position
	float idx = floor(fidx);
	float fblend = fract(fidx);                    // blend toward the next glyph
	float idx1 = min(idx + 1.0, uGlyphCount - 1.0);
	float m0 = texture2D(uGlyphs, vec2((idx + cuv.x) / uGlyphCount, cuv.y)).r;
	float m1 = texture2D(uGlyphs, vec2((idx1 + cuv.x) / uGlyphCount, cuv.y)).r;
	float mask = mix(m0, m1, fblend);              // smooth glyph->glyph (no instant pops)
	float sat = (mx - min(col.r, min(col.g, col.b))) / max(mx, 0.0001);
	vec3 tint = mix(vec3(1.0, 0.92, 0.5), vec3(1.0), sat);   // desaturated/white glyphs → faint yellow; saturated hues unchanged
	vec3 gcol = mix(neon * tint, uObsColor, ob);            // obstacle cells take the fixed colour, fluid cells keep their hue
	gl_FragColor = vec4(gcol * (0.8 * mask), 1.0);   // crisp glyph, no dim cell tile
}
`;

// Stage A2: phosphor persistence. Combine the fresh glyph bitmap with a decaying
// accumulator so a moving cell leaves a trail of fading chars while the new glyph is
// drawn on top (phosphor max: new on top, old fades under). The "- 1/255" guarantees
// the 8-bit accumulator reaches true 0 instead of sticking on a rounded ghost floor.
export const asciiFade = `
precision highp float;
precision highp sampler2D;
varying vec2 vUv;
uniform sampler2D uNew;    // fresh glyph bitmap (this frame)
uniform sampler2D uPrev;   // decaying accumulator (last frame)
uniform float uFade;       // keep-fraction per frame (0 = no trail)
void main () {
	vec3 cur = texture2D(uNew, vUv).rgb;
	vec3 decayed = max(texture2D(uPrev, vUv).rgb * uFade - 1.0 / 255.0, 0.0);
	vec3 outc = max(cur, decayed);
	gl_FragColor = vec4(outc, 1.0);
}
`;

// Stage B: present the glyph bitmap to screen with zoom/pan. When zoomed in far
// enough that one source texel covers several screen pixels, split each texel into
// an R/G/B aperture-grille triad with a horizontal scanline gap (the "RGB pixels"
// reveal). The triad fades out (t) at low magnification so the far view stays clean.
export const asciiPresent = `
precision highp float;
precision highp sampler2D;
varying vec2 vUv;
uniform sampler2D uAscii;
uniform vec2 uAsciiSize;      // glyph-bitmap size in texels (cols*GP, rows*GP)
uniform vec2 uScreen;         // drawing-buffer size in px
uniform float uZoom;
uniform vec2 uPan;            // ascii-uv shown at screen centre
uniform vec3 uBack;           // background colour outside the view
uniform float uTime;          // seconds, drives the uniform CRT mains hum
uniform float uGlow;          // 1 = phosphor glow halo on, 0 = crisp bars only
uniform float uGlowAmount;    // zoomed-out glyph-bloom halo strength (HUD slider)
void main () {
	vec2 uv = (vUv - 0.5) / uZoom + uPan;
	if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
		gl_FragColor = vec4(uBack, 1.0);
		return;
	}
	vec3 base = texture2D(uAscii, uv).rgb;
	float mag = uZoom * (uScreen.x / uAsciiSize.x);   // screen px per source texel
	float t = smoothstep(2.0, 4.0, mag);
	// Glyph-level bloom: blur the glyph bitmap so lit glyphs bleed a soft halo into the
	// surrounding gaps. Without this the zoomed-out view had crisp glyphs but no glow —
	// the phosphor halo only existed in the subpixel-triad path below (visible when zoomed in).
	if (uGlow > 0.5 && t < 1.0) {
		vec2 px = 1.0 / uAsciiSize;
		vec3 bloom = vec3(0.0);
		float wsum = 0.0;
		for (int bx = -3; bx <= 3; bx++) {
			for (int by = -3; by <= 3; by++) {
				vec2 o = vec2(float(bx), float(by)) * 1.5;   // spread (texels) → halo reach (~4.5 texels, ~half a glyph cell)
				float w = exp(-dot(o, o) * 0.10);
				bloom += texture2D(uAscii, uv + o * px).rgb * w;
				wsum += w;
			}
		}
		base += (bloom / wsum) * uGlowAmount;   // additive halo → glyphs emit light into the gaps (HUD-controlled)
	}
	float spx = uv.x * uAsciiSize.x * 3.0;    // subpixel-column space (3 per source texel)
	float spy = uv.y * uAsciiSize.y;          // texel-row space
	float baseSub = floor(spx);
	float baseRow = floor(spy);
	vec2 hs = vec2(0.26, 0.44);               // slim tall phosphor strip (narrow width, leaves wide RGB gaps)
	float rad = 0.12;                         // corner radius
	vec3 crt = vec3(0.0);
	if (t > 0.0) {                            // only build the triad when zoomed in
		float glowAtten = mix(1.0, 0.25, smoothstep(6.0, 24.0, mag));   // ease the halo down as we zoom all the way in → crisp phosphors, less wash
		// Sum the current phosphor plus its neighbours so their halos overlap and
		// the glow blends across the gaps instead of cutting off at hard edges.
		for (int dxn = -3; dxn <= 3; dxn++) {
			for (int dyn = -2; dyn <= 2; dyn++) {
				float j = baseSub + float(dxn);
				float k = baseRow + float(dyn);
				if (j < 0.0 || k < 0.0) continue;
				vec2 dq = vec2(spx - (j + 0.5), spy - (k + 0.5));
				vec2 dd = abs(dq) - hs + rad;
				float dist = length(max(dd, 0.0)) + min(max(dd.x, dd.y), 0.0) - rad;
				float core = smoothstep(0.045, -0.03, dist);   // soft rounded body
				float glow = exp(-max(dist, 0.0) * 1.5);        // softer, wider halo → bleeds smoothly across the gaps, tapers to ~0 before the loop edge (no hard cutoff)
				float ci = mod(j, 3.0);                          // 0,1,2 -> R,G,B
				vec3 chan = vec3(ci == 0.0 ? 1.0 : 0.0, ci == 1.0 ? 1.0 : 0.0, ci == 2.0 ? 1.0 : 0.0);
				vec2 texel = vec2(floor(j / 3.0), k);
				vec3 c = texture2D(uAscii, (texel + 0.5) / uAsciiSize).rgb;
				crt += c * chan * (core * 3.0 + glow * 1.4 * uGlow * glowAtten);   // slim bright core + (toggleable) fat glow halo, halo fades with zoom; only the global hum below modulates
			}
		}
		crt *= 0.95 + 0.05 * sin(uTime * 24.0);   // global mains hum
	}
	gl_FragColor = vec4(mix(base, crt, t), 1.0);
}
`;
