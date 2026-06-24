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

export const bloomPrefilter = `
precision mediump float;
precision mediump sampler2D;
varying vec2 vUv;
uniform sampler2D uTexture;
uniform vec3 curve;
uniform float threshold;
void main () {
	vec3 c = texture2D(uTexture, vUv).rgb;
	float br = max(c.r, max(c.g, c.b));
	float rq = clamp(br - curve.x, 0.0, curve.y);
	rq = curve.z * rq * rq;
	c *= max(rq, br - threshold) / max(br, 0.0001);
	gl_FragColor = vec4(c, 0.0);
}
`;

export const bloomBlur = `
precision mediump float;
precision mediump sampler2D;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;
uniform sampler2D uTexture;
void main () {
	vec4 sum = vec4(0.0);
	sum += texture2D(uTexture, vL);
	sum += texture2D(uTexture, vR);
	sum += texture2D(uTexture, vT);
	sum += texture2D(uTexture, vB);
	sum *= 0.25;
	gl_FragColor = sum;
}
`;

export const bloomFinal = `
precision mediump float;
precision mediump sampler2D;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;
uniform sampler2D uTexture;
uniform float intensity;
void main () {
	vec4 sum = vec4(0.0);
	sum += texture2D(uTexture, vL);
	sum += texture2D(uTexture, vR);
	sum += texture2D(uTexture, vT);
	sum += texture2D(uTexture, vB);
	sum *= 0.25;
	gl_FragColor = sum * intensity;
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
uniform sampler2D uBloom;
uniform sampler2D uSunrays;
uniform sampler2D uDithering;
uniform vec2 ditherScale;
uniform vec2 texelSize;
uniform sampler2D uObstacle;
uniform vec3 uObstacleColor;

vec3 linearToGamma (vec3 c) {
	c = max(c, vec3(0.0));
	return max(1.055 * pow(c, vec3(0.416666667)) - 0.055, vec3(0.0));
}

void main () {
	vec3 c = texture2D(uTexture, vUv).rgb;
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
#ifdef BLOOM
	vec3 bloom = texture2D(uBloom, vUv).rgb;
#endif
#ifdef SUNRAYS
	float sunrays = texture2D(uSunrays, vUv).r;
	c *= sunrays;
#ifdef BLOOM
	bloom *= sunrays;
#endif
#endif
#ifdef BLOOM
	float noise = texture2D(uDithering, vUv * ditherScale).r;
	noise = noise * 2.0 - 1.0;
	bloom += noise / 255.0;
	bloom = linearToGamma(bloom);
	c += bloom;
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
uniform vec2 uGrid;           // cols, rows
uniform float uGlyphCount;
void main () {
	vec2 g = vUv * uGrid;
	vec2 cell = floor(g);
	vec2 cuv = fract(g);
	vec3 col = texture2D(uScene, (cell + 0.5) / uGrid).rgb;
	float lum = clamp(dot(col, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);
	float mx = max(col.r, max(col.g, col.b));
	vec3 hue = col / max(mx, 0.0001);              // unit-peak hue (full saturation)
	vec3 neon = hue * clamp(pow(lum, 0.5) * 2.4, 0.0, 1.2);  // density → vivid neon brightness
	float lr = pow(lum, 0.7);                      // lift mids so more glyphs show
	float idx = floor(min(lr, 0.9999) * uGlyphCount);
	vec2 auv = vec2((idx + cuv.x) / uGlyphCount, cuv.y);
	float mask = texture2D(uGlyphs, auv).r;
	gl_FragColor = vec4(neon * (0.16 + 0.84 * mask), 1.0);   // faint cell-colour tile under glyph
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
uniform float uTime;          // seconds, drives the CRT flicker
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main () {
	vec2 uv = (vUv - 0.5) / uZoom + uPan;
	if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
		gl_FragColor = vec4(uBack, 1.0);
		return;
	}
	vec3 base = texture2D(uAscii, uv).rgb;
	float mag = uZoom * (uScreen.x / uAsciiSize.x);   // screen px per source texel
	float t = smoothstep(2.0, 4.0, mag);
	float sx = fract(uv.x * uAsciiSize.x);   // 0..1 across one source texel
	float sy = fract(uv.y * uAsciiSize.y);
	float col3 = sx * 3.0;                    // three subpixel columns per texel
	float ci = floor(col3);                   // 0,1,2 -> R,G,B
	float fx = fract(col3);                   // position within the subpixel
	vec3 chan = vec3(ci == 0.0 ? 1.0 : 0.0, ci == 1.0 ? 1.0 : 0.0, ci == 2.0 ? 1.0 : 0.0);
	// rounded-rect phosphor dot via signed distance, centred in its subpixel cell
	vec2 q = vec2(fx, sy) - 0.5;
	vec2 hs = vec2(0.30, 0.40);                       // half-width / half-height (leaves the gaps)
	float rad = 0.17;                                 // corner radius
	vec2 dd = abs(q) - hs + rad;
	float dist = length(max(dd, 0.0)) + min(max(dd.x, dd.y), 0.0) - rad;
	float core = smoothstep(0.045, -0.03, dist);      // soft rounded body
	float glow = exp(-max(dist, 0.0) * 6.5);          // colored halo bleeding into the gaps
	vec3 lit = base * chan;                           // single channel per column
	vec3 crt = lit * (core * 3.0 + glow * 1.4);
	vec2 cellId = floor(uv * uAsciiSize);             // per-phosphor flicker + global mains hum
	float h = hash(cellId);
	float flick = 0.82 + 0.18 * sin(uTime * (1.6 + h * 3.0) + h * 6.2831);
	float hum = 0.95 + 0.05 * sin(uTime * 24.0);
	crt *= flick * hum;
	gl_FragColor = vec4(mix(base, crt, t), 1.0);
}
`;
