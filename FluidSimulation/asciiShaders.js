// ASCII-mode shader sources (split out of glsl.js so the upgraded asciiArt can be a
// keyword Material without editing glsl.js's template literals). GLSL ES 1.00 — compiles
// under WebGL2 via gl-program.js. See ASCII_PLAN.md.
//
//   asciiArt       — fluid → glyph bitmap. Keyword variants: EDGE / BRAILLE
//                    (base = luminance ramp). Phosphor mono palette
//                    folds in as a plain uniform (combine with any glyph mode).
//   glyphDye       — stamp one glyph's mask into the dye field (type-to-inject text).
//   particleUpdate — advect a position texture by the velocity field (char particles).
//   particleVertex / particleRender — draw those particles as glyph point-sprites.

// ── Stage A: fluid → coloured glyph bitmap ──
export const asciiArt = `
precision highp float;
precision highp sampler2D;
varying vec2 vUv;
uniform sampler2D uScene;     // low-res LDR fluid (one texel per cell)
uniform sampler2D uGlyphs;    // luminance ramp atlas (sparse→dense)
uniform sampler2D uDye;       // raw dye field — drives the ramp + braille sub-samples
uniform sampler2D uObstacle;  // obstacle mask — force a solid glyph so walls aren't blank
uniform sampler2D uDirGlyphs; // orientation atlas: - / | \\  (EDGE)
uniform sampler2D uBraille;   // 256-glyph procedural braille atlas (BRAILLE)
uniform vec3 uObsColor;
uniform vec2 uGrid;           // cols, rows
uniform float uGlyphCount;
uniform float uDirCount;
uniform float uJitter;
uniform int uPhosphor;        // 0 colour · 1 green
#define PI 3.14159265

float hash (vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float dlum (vec2 cell) { vec3 d = texture2D(uDye, (cell + 0.5) / uGrid).rgb; return max(d.r, max(d.g, d.b)); }

// Mono phosphor palettes (luminance → tinted glow). mode 0 handled by the caller (keeps hue).
vec3 phosphor (float l, int mode) {
	l = clamp(l, 0.0, 1.0);
	return vec3(0.20, 1.0, 0.35) * l;                                            // P1 green
}

void main () {
	vec2 g = vUv * uGrid;
	vec2 cell = floor(g);
	vec2 cuv = fract(g);
	vec2 cc = (cell + 0.5) / uGrid;
	vec3 col = texture2D(uScene, cc).rgb;
	vec3 dye = texture2D(uDye, cc).rgb;
	float ob = step(0.5, texture2D(uObstacle, cc).x);
	float dens = max(dye.r, max(dye.g, dye.b));
	float lum = clamp(dot(col, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);
	float mx = max(col.r, max(col.g, col.b));
	vec3 hue = col / max(mx, 0.0001);
	vec3 neon = hue * clamp(pow(lum, 0.5) * 2.4, 0.0, 1.2);
	float lr = pow(clamp(max(dens, ob), 0.0, 1.0), 0.6);
	lr = clamp(lr + (hash(cell) - 0.5) * uJitter * (1.0 - lr) * step(0.05, lr), 0.0, 0.9999);

	// Luminance-ramp fill glyph (the base mode, and the flat-region fill for EDGE).
	float fidx = min(lr, 0.9999) * uGlyphCount;
	float fi = floor(fidx);
	float fb = fract(fidx);
	float i1 = min(fi + 1.0, uGlyphCount - 1.0);
	float fillMask = mix(
		texture2D(uGlyphs, vec2((fi + cuv.x) / uGlyphCount, cuv.y)).r,
		texture2D(uGlyphs, vec2((i1 + cuv.x) / uGlyphCount, cuv.y)).r, fb);

	float mask = fillMask;

#ifdef EDGE
	{
		float l00 = dlum(cell + vec2(-1.0, -1.0)), l10 = dlum(cell + vec2(0.0, -1.0)), l20 = dlum(cell + vec2(1.0, -1.0));
		float l01 = dlum(cell + vec2(-1.0, 0.0)),                                       l21 = dlum(cell + vec2(1.0, 0.0));
		float l02 = dlum(cell + vec2(-1.0, 1.0)), l12 = dlum(cell + vec2(0.0, 1.0)),  l22 = dlum(cell + vec2(1.0, 1.0));
		float gx = (l20 + 2.0 * l21 + l22) - (l00 + 2.0 * l01 + l02);
		float gy = (l02 + 2.0 * l12 + l22) - (l00 + 2.0 * l10 + l20);
		float gm = length(vec2(gx, gy));
		float o = mod(atan(gx, -gy), PI);                        // tangent ⟂ gradient
		float di = clamp(floor(o / PI * uDirCount), 0.0, uDirCount - 1.0);
		float md = texture2D(uDirGlyphs, vec2((di + cuv.x) / uDirCount, cuv.y)).r;
		mask = mix(fillMask, md, smoothstep(0.15, 0.5, gm));      // draw the contour, fill flats
	}
#endif
#ifdef BRAILLE
	{
		// 8 dye sub-taps on a 2×4 grid → one of 256 braille glyphs (bit = row*2 + col, row0 top).
		float byteIdx = 0.0;
		for (int b = 0; b < 8; b++) {
			float fbi = float(b);
			float colb = mod(fbi, 2.0);
			float rowb = floor(fbi / 2.0);
			vec2 sp = (cell + vec2((colb + 0.5) / 2.0, 1.0 - (rowb + 0.5) / 4.0)) / uGrid;
			vec3 d = texture2D(uDye, sp).rgb;
			float th = pow(clamp(max(max(d.r, max(d.g, d.b)), ob), 0.0, 1.0), 0.6);
			th += (hash(cell + vec2(fbi, 0.0)) - 0.5) * uJitter;
			if (th > 0.42) byteIdx += exp2(fbi);
		}
		mask = texture2D(uBraille, vec2((byteIdx + cuv.x) / 256.0, cuv.y)).r;
	}
#endif

	// Glyph colour: hue (neon) or a mono phosphor palette.
	vec3 fluidCol;
	if (uPhosphor == 0) {
		float sat = (mx - min(col.r, min(col.g, col.b))) / max(mx, 0.0001);
		vec3 tint = mix(vec3(1.0, 0.92, 0.5), vec3(1.0), sat);
		fluidCol = neon * tint;
	} else {
		fluidCol = phosphor(pow(clamp(dens, 0.0, 1.0), 0.55), uPhosphor);
	}
	vec3 gcol = mix(fluidCol, uObsColor, ob);
	gl_FragColor = vec4(gcol * (0.8 * mask), 1.0);
}
`;

// Stamp one glyph's mask into the dye field (additive), masked off inside obstacles.
// Used by type-to-inject: each typed character is one blit at its pen rectangle.
export const glyphDye = `
precision highp float;
precision highp sampler2D;
varying vec2 vUv;
uniform sampler2D uTarget;    // dye (read)
uniform sampler2D uGlyphs;    // text atlas (printable ASCII)
uniform sampler2D uObstacle;
uniform float uGlyphCount;
uniform float uIndex;         // glyph column in the atlas
uniform vec2 uCenter;         // rect centre, uv
uniform vec2 uHalf;           // rect half-extent, uv (x already aspect-corrected by JS)
uniform vec3 uColor;
void main () {
	vec3 base = texture2D(uTarget, vUv).rgb;
	vec2 local = (vUv - uCenter) / (2.0 * uHalf) + 0.5;
	float inside = step(0.0, local.x) * step(local.x, 1.0) * step(0.0, local.y) * step(local.y, 1.0);
	float m = texture2D(uGlyphs, vec2((uIndex + local.x) / uGlyphCount, local.y)).r * inside;
	float free = 1.0 - step(0.5, texture2D(uObstacle, vUv).x);
	gl_FragColor = vec4(base + uColor * m * free, 1.0);
}
`;

// Advect a particle position texture (xy = pos in [0,1], z = life, w = glyph seed) by the
// velocity field; wrap at edges, respawn at random when life runs out. Cleared-to-0 init
// → every particle is "dead" on frame 1 and respawns, so no data upload is needed.
export const particleUpdate = `
precision highp float;
precision highp sampler2D;
varying vec2 vUv;
uniform sampler2D uPos;
uniform sampler2D uVelocity;
uniform vec2 uTexel;   // velocity texel size (uv displacement per unit velocity·dt)
uniform float uDt;
uniform float uSpeed;
uniform float uTime;
float h (vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main () {
	vec4 p = texture2D(uPos, vUv);
	vec2 vel = texture2D(uVelocity, p.xy).xy;
	p.xy = fract(p.xy + vel * uDt * uTexel * uSpeed);
	p.z -= uDt * (0.25 + 0.5 * h(vUv + 1.7));
	if (p.z <= 0.0) {
		p.x = h(vUv + uTime);
		p.y = h(vUv + uTime + 3.3);
		p.z = 0.6 + 0.9 * h(vUv + uTime + 7.7);
		p.w = h(vUv + uTime + 11.1);
	}
	gl_FragColor = p;
}
`;

export const particleVertex = `
precision highp float;
attribute float aIndex;
uniform sampler2D uPos;
uniform vec2 uDim;        // particle texture dims
uniform float uPointSize;
varying float vSeed;
varying vec2 vPos;
void main () {
	float x = mod(aIndex, uDim.x);
	float y = floor(aIndex / uDim.x);
	vec4 p = texture2D(uPos, (vec2(x, y) + 0.5) / uDim);
	vPos = p.xy;
	vSeed = p.w;
	gl_Position = vec4(p.xy * 2.0 - 1.0, 0.0, 1.0);
	gl_PointSize = uPointSize;
}
`;

export const particleRender = `
precision highp float;
precision highp sampler2D;
varying float vSeed;
varying vec2 vPos;
uniform sampler2D uGlyphs;   // text atlas
uniform float uGlyphCount;
uniform sampler2D uDye;
void main () {
	vec2 pc = gl_PointCoord;
	float idx = floor(vSeed * uGlyphCount);
	float m = texture2D(uGlyphs, vec2((idx + pc.x) / uGlyphCount, 1.0 - pc.y)).r;
	if (m < 0.5) discard;
	vec3 col = texture2D(uDye, vPos).rgb;
	float b = max(col.r, max(col.g, col.b));
	vec3 hue = col / max(b, 0.001);
	gl_FragColor = vec4(hue * clamp(b * 4.0, 0.25, 1.6), 1.0);
}
`;
