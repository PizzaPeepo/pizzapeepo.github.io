# ASCII Glyph Engine 2.0 Implementation Plan (Phase 1 of ASCII Fluid Showcase)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the screen-space ASCII fragment pass with an instanced glyph-sprite renderer that adds relief lighting, lattice warp, living glyphs, and a parallax background layer — per spec `docs/superpowers/specs/2026-07-02-ascii-fluid-showcase-design.md` (Phase 1 + quality tiers). Phases 2 (scenes) and 3 (director) get separate plans.

**Architecture:** One quad per ASCII cell (`vertexAttribDivisor` instancing, GLSL ES 1.00, vertex texture fetch). Vertex shader picks the glyph, colors it, and positions/rotates/warps the quad; fragment shader samples the atlas and applies relief lighting. Renders into the existing `asciiBitmap` FBO so the persistence trail (`asciiFade`) and present stage (`asciiPresent` zoom/pan/CRT triad) are untouched. Legacy fragment path kept as fallback.

**Tech Stack:** Vanilla ES6 modules, WebGL2, no build system. Files served by `python -m http.server 8080` from repo root.

## Global Constraints

- All `.js` files: **tabs** for indentation, **CRLF** line endings.
- Edit tool: `old_string` must use tabs; NEVER include lines containing `` ` `` or `${}` in `old_string` (shader template-literal delimiter lines). Pure GLSL body lines are safe anchors (no backticks in GLSL). If Edit fails, use the temp `.mjs` script pattern from CLAUDE.md.
- Shaders: GLSL ES 1.00 (compiles under WebGL2 via `gl-program.js`). No `#version 300 es`, no `gl_InstanceID` — instancing via `vertexAttribDivisor` + an instanced attribute.
- No new dependencies, no build step.
- Performance floor: desktop dGPU at 60fps with everything on (spec).
- Headless verification: use the **verify-ascii-fluid** skill (ASCII mode is off by default; the skill knows the boot params and that the screenshot tool fails silently under the Bash tool — PowerShell only).
- Verify server: `python -m http.server 8080` from repo root (run in background).
- Commit after every task. Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## Existing code map (read before starting)

- `FluidSimulation/main.js` — sim loop, ASCII targets (`initAsciiTargets` ~line 251), `renderAscii()` (~line 679), `splat()` (~line 479), `step()` (~line 568), `drawDisplay()` (~line 666), HUD wiring (`wireUI` ~line 1029), `applyAsciiPreset` (~line 992), boot params (~line 1149).
- `FluidSimulation/asciiShaders.js` — legacy `asciiArt` shader (the parity reference for glyph pick + color formulas).
- `FluidSimulation/gl-program.js` — `compileShader(gl, type, src, keywords)`, `Program`, `Material`, `getUniforms`.
- `FluidSimulation/framebuffers.js` — `createFBO`, `createDoubleFBO`, `createBlit`. NOTE: `blit` relies on attribute 0 being the fullscreen quad on the **null VAO**; any custom draw must isolate its attributes in its own VAO and `bindVertexArray(null)` afterwards (see `initParticles` ~line 266 for the established pattern).
- `FluidSimulation/config.js` — flat config object; ASCII keys at the bottom.
- `FluidSimulation/FluidSimulation.html` — HUD controls (ASCII block ~lines 200–221, scene buttons ~line 240).

---

### Task 1: `dye2` background dye field + `asciiScene2` (plumbing, no visual change)

**Files:**
- Modify: `FluidSimulation/config.js`
- Modify: `FluidSimulation/main.js`

**Interfaces:**
- Consumes: existing `createDoubleFBO`, `advectionProgram`, `splatProgram`, `getResolution`, `blit`.
- Produces: module-level `dye2` (double FBO, ~512 res, advected each `step()` at half speed), `asciiScene2` (cols×rows LDR FBO), and `drawDisplay(target, source?)` where `source` is an FBO defaulting to `dye.read`. Task 6 consumes all three.

- [ ] **Step 1: Add config flag**

In `FluidSimulation/config.js`, after the `ASCII_PARTICLES` line, add:

```js
	ASCII_LAYER2: true,        // parallax background glyph layer (second, slower dye field)
```

- [ ] **Step 2: Declare and create `dye2`**

In `FluidSimulation/main.js`:

Change the framebuffer declaration line (~246):

```js
let dye, velocity, divergenceFBO, curlFBO, pressure, obstacleMask;
```
to
```js
let dye, dye2, velocity, divergenceFBO, curlFBO, pressure, obstacleMask;
```

In `initFramebuffers()`, right after the `dye` create/resize pair, add:

```js
	// Background-layer dye: coarser + advected at half speed → distant-parallax feel (Glyph Engine 2).
	const dye2Res = getResolution(512);
	if (dye2 == null) dye2 = createDoubleFBO(gl, dye2Res.width, dye2Res.height, rgba.internalFormat, rgba.format, texType, filtering);
	else dye2 = resizeDoubleFBO(gl, blit, copyProgram, dye2, dye2Res.width, dye2Res.height, rgba.internalFormat, rgba.format, texType, filtering);
```

- [ ] **Step 3: Advect `dye2` in `step()`**

In `step()`, immediately after the dye advection block (anchor: the line `gl.uniform1f(advectionProgram.uniforms.dissipation, config.DENSITY_DISSIPATION);` followed by `blit(dye.write); dye.swap();`), add:

```js
	if (config.ASCII_LAYER2) {
		gl.uniform2f(advectionProgram.uniforms.dyeTexelSize, dye2.texelSizeX, dye2.texelSizeY);
		gl.uniform1i(advectionProgram.uniforms.uVelocity, velocity.read.attach(0));
		gl.uniform1i(advectionProgram.uniforms.uSource, dye2.read.attach(1));
		gl.uniform1i(advectionProgram.uniforms.uObstacle, ob.attach(2));
		gl.uniform1f(advectionProgram.uniforms.dt, dt * 0.5);          // half-speed advection → distant layer lags the foreground
		gl.uniform1f(advectionProgram.uniforms.dissipation, config.DENSITY_DISSIPATION * 0.6);
		blit(dye2.write); dye2.swap();
	}
```

(`dt * 0.5` overwrites the `dt` uniform after its last use in `step()` — safe.)

- [ ] **Step 4: Tee splats into `dye2`**

In `splat()` (~line 479), after the final `blit(dye.write); dye.swap();`, add:

```js
	if (config.ASCII_LAYER2 && dye2) {
		gl.uniform1i(splatProgram.uniforms.uTarget, dye2.read.attach(0));
		gl.uniform1i(splatProgram.uniforms.uObstacle, obstacleMask.read.attach(1));
		gl.uniform3f(splatProgram.uniforms.color, color.r * 0.5, color.g * 0.5, color.b * 0.5);
		gl.uniform1f(splatProgram.uniforms.radius, correctRadius(config.SPLAT_RADIUS / 100.0 * 1.6));
		blit(dye2.write); dye2.swap();
	}
```

- [ ] **Step 5: Clear `dye2` in `clearDye()`**

In `clearDye()` (~line 868), after `blit(velocity.read); blit(velocity.write);`, add:

```js
	if (dye2) { blit(dye2.read); blit(dye2.write); }
```

- [ ] **Step 6: Create `asciiScene2` + parameterize `drawDisplay`**

Change the ASCII targets declaration (~line 250):

```js
let asciiScene, asciiBitmap, asciiTrail, asciiCols = 0, asciiRows = 0;
```
to
```js
let asciiScene, asciiScene2, asciiBitmap, asciiTrail, asciiCols = 0, asciiRows = 0;
```

In `initAsciiTargets()`, after the `asciiScene = createFBO(...)` line, add:

```js
	asciiScene2 = createFBO(gl, cols, rows, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR);
```

Change `drawDisplay` (~line 666): signature `function drawDisplay(target)` → `function drawDisplay(target, source)` and the uTexture line:

```js
	gl.uniform1i(displayMaterial.uniforms.uTexture, dye.read.attach(0));
```
to
```js
	gl.uniform1i(displayMaterial.uniforms.uTexture, (source || dye.read).attach(0));
```

- [ ] **Step 7: Verify no regression (headless)**

Start server in background: `python -m http.server 8080` (repo root). Invoke the **verify-ascii-fluid** skill: screenshot `http://localhost:8080/FluidSimulation/FluidSimulation.html?ascii=1&splats=6` and the non-ASCII page `...?splats=6`.
Expected: both render a visible fluid/glyph image (not black), **zero console errors**. Output must look the same as before this task (plumbing only).

- [ ] **Step 8: Commit**

```bash
git add FluidSimulation/config.js FluidSimulation/main.js
git commit -m "feat(ascii): add background dye2 field and asciiScene2 plumbing for glyph engine 2"
```

---

### Task 2: `glyphEngine.js` — instanced renderer, density-mode parity

**Files:**
- Create: `FluidSimulation/glyphEngine.js`
- Modify: `FluidSimulation/config.js`
- Modify: `FluidSimulation/main.js`
- Modify: `FluidSimulation/FluidSimulation.html`

**Interfaces:**
- Consumes: `compileShader` from `./gl-program.js`; FBO/atlas objects exposing `attach(id)` (+ `count` on atlases, `fbo/width/height` on FBOs).
- Produces (Tasks 3–7 consume):
  - `class GlyphEngine`: `constructor(gl)`; `ok: boolean` (false on link failure → caller falls back to legacy path); `resize(cols, rows)`; `render(o)`.
  - `render(o)` options: `{ target, mode /* 'density'|'edge'|'braille' */, cols, rows, obstacle, atlas, layers, jitter, phosphor, obsColor /* [r,g,b] */ }` with `layers: [{ scene, dye, scale, bright, parallax: [x, y] }]`, drawn in array order (background first). Unknown `mode` falls back to `'density'`.
  - Exported shader sources `glyphVertex`, `glyphFragment` (edited by Tasks 3–5).

- [ ] **Step 1: Add config flag**

In `FluidSimulation/config.js`, after the `ASCII_LAYER2` line, add:

```js
	ASCII_ENGINE2: true,       // instanced glyph sprite renderer (Glyph Engine 2.0); false = legacy fragment path
```

- [ ] **Step 2: Create `FluidSimulation/glyphEngine.js`** (tabs, CRLF)

Full file content:

```js
// Glyph Engine 2.0 — instanced glyph sprite renderer (one quad per ASCII cell).
// Replaces the screen-space asciiArt fragment pass when config.ASCII_ENGINE2 is on;
// the legacy path in main.js stays as fallback (link failure / quality tier 2).
// Vertex shader picks the glyph per instance (vertex texture fetch, core WebGL2),
// colors it, and positions the quad; fragment samples the atlas. Glyph-pick and
// color formulas mirror asciiShaders.js asciiArt exactly (parity).
// GLSL ES 1.00; instancing via vertexAttribDivisor (no gl_InstanceID / ES 3.00).

import { compileShader } from './gl-program.js';

export const glyphVertex = `
precision highp float;
attribute vec2 aCorner;       // quad corner, [-0.5, +0.5] — divisor 0
attribute vec2 aCell;         // (col, row) — divisor 1, one per cell
uniform sampler2D uScene;     // palette-applied fluid, one texel per cell
uniform sampler2D uDye;       // raw dye — density ramp source
uniform sampler2D uObstacle;
uniform vec2 uGrid;           // cols, rows
uniform float uGlyphCount;
uniform float uJitter;
uniform float uScale;         // per-layer glyph scale (1 fg, 0.7 bg)
uniform vec2 uParallax;       // per-layer uv sampling offset
uniform int uPhosphor;
uniform vec3 uObsColor;
varying vec2 vLocal;
varying float vIdxA;
varying float vIdxB;
varying float vRampMix;
varying vec3 vColor;

float hash (vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main () {
	vec2 cc = (aCell + 0.5) / uGrid + uParallax;
	vec3 col = texture2D(uScene, cc).rgb;
	vec3 dyec = texture2D(uDye, cc).rgb;
	float ob = step(0.5, texture2D(uObstacle, cc).x);
	float dens = max(dyec.r, max(dyec.g, dyec.b));

	// Luminance-ramp glyph pick — identical formulas to the legacy asciiArt pass.
	float lr = pow(clamp(max(dens, ob), 0.0, 1.0), 0.6);
	lr = clamp(lr + (hash(aCell) - 0.5) * uJitter * (1.0 - lr) * step(0.05, lr), 0.0, 0.9999);
	float fidx = min(lr, 0.9999) * uGlyphCount;
	vIdxA = floor(fidx);
	vRampMix = fract(fidx);
	vIdxB = min(vIdxA + 1.0, uGlyphCount - 1.0);

	// Glyph colour — identical to the legacy pass.
	float lum = clamp(dot(col, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);
	float mx = max(col.r, max(col.g, col.b));
	vec3 hueC = col / max(mx, 0.0001);
	vec3 neon = hueC * clamp(pow(lum, 0.5) * 2.4, 0.0, 1.2);
	vec3 fluidCol;
	if (uPhosphor == 0) {
		float sat = (mx - min(col.r, min(col.g, col.b))) / max(mx, 0.0001);
		vec3 tint = mix(vec3(1.0, 0.92, 0.5), vec3(1.0), sat);
		fluidCol = neon * tint;
	} else {
		fluidCol = vec3(0.20, 1.0, 0.35) * pow(clamp(dens, 0.0, 1.0), 0.55);
	}
	vColor = mix(fluidCol, uObsColor, ob);

	float alive = step(0.0005, dens + ob);   // collapse empty cells (their glyph is the blank ramp slot anyway)
	vec2 corner = aCorner * uScale * alive;
	vLocal = aCorner + 0.5;
	vec2 pos = (aCell + 0.5 + corner) / uGrid;
	gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const glyphFragment = `
precision highp float;
precision highp sampler2D;
varying vec2 vLocal;
varying float vIdxA;
varying float vIdxB;
varying float vRampMix;
varying vec3 vColor;
uniform sampler2D uGlyphs;
uniform float uGlyphCount;
uniform float uBright;
void main () {
	vec2 cuv = vLocal;
	float mA = texture2D(uGlyphs, vec2((vIdxA + cuv.x) / uGlyphCount, cuv.y)).r;
	float mB = texture2D(uGlyphs, vec2((vIdxB + cuv.x) / uGlyphCount, cuv.y)).r;
	float mask = mix(mA, mB, vRampMix);
	if (mask < 0.01) discard;
	gl_FragColor = vec4(vColor * (0.8 * mask) * uBright, 1.0);
}
`;

// Compile + link one keyword variant with fixed attribute locations
// (0 = aCorner, 1 = aCell; bound BEFORE link so the VAO layout is stable).
function link(gl, vsSrc, fsSrc, keywords) {
	const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc, keywords);
	const fsh = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc, keywords);
	const program = gl.createProgram();
	gl.attachShader(program, vs);
	gl.attachShader(program, fsh);
	gl.bindAttribLocation(program, 0, 'aCorner');
	gl.bindAttribLocation(program, 1, 'aCell');
	gl.linkProgram(program);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		console.error('GlyphEngine link failed:', gl.getProgramInfoLog(program));
		return null;
	}
	const uniforms = {};
	const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
	for (let i = 0; i < count; i++) {
		const name = gl.getActiveUniform(program, i).name;
		uniforms[name] = gl.getUniformLocation(program, name);
	}
	return { program, uniforms };
}

export class GlyphEngine {
	constructor(gl) {
		this.gl = gl;
		this.cols = 0; this.rows = 0; this.count = 0;
		this.vao = null; this.cellBuf = null; this.cornerBuf = null;
		this.programs = {
			density: link(gl, glyphVertex, glyphFragment, null),
		};
		this.ok = !!this.programs.density;
		if (this.ok) {
			const corners = new Float32Array([-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5]);
			this.cornerBuf = gl.createBuffer();
			gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuf);
			gl.bufferData(gl.ARRAY_BUFFER, corners, gl.STATIC_DRAW);
			gl.bindBuffer(gl.ARRAY_BUFFER, null);
		}
	}

	// (Re)build the per-cell instance buffer for a new grid size. No-op if unchanged.
	resize(cols, rows) {
		if (!this.ok || (cols === this.cols && rows === this.rows)) return;
		const gl = this.gl;
		this.cols = cols; this.rows = rows; this.count = cols * rows;
		const cells = new Float32Array(this.count * 2);
		let i = 0;
		for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { cells[i++] = c; cells[i++] = r; }
		if (!this.cellBuf) this.cellBuf = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, this.cellBuf);
		gl.bufferData(gl.ARRAY_BUFFER, cells, gl.STATIC_DRAW);
		if (!this.vao) {
			// Own VAO isolates the instanced attribs; bindVertexArray(null) restores the quad-blit state.
			this.vao = gl.createVertexArray();
			gl.bindVertexArray(this.vao);
			gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuf);
			gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
			gl.enableVertexAttribArray(0);
			gl.bindBuffer(gl.ARRAY_BUFFER, this.cellBuf);
			gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
			gl.enableVertexAttribArray(1);
			gl.vertexAttribDivisor(1, 1);
			gl.bindVertexArray(null);
		}
		gl.bindBuffer(gl.ARRAY_BUFFER, null);
	}

	// Draw all layers into o.target (clears it first). Additive blend: overlapping
	// glyph quads sum, matching the neon/glow aesthetic; non-overlapping quads on the
	// cleared-black bitmap reproduce the legacy opaque-write result exactly.
	render(o) {
		const gl = this.gl;
		this.resize(o.cols, o.rows);
		const P = this.programs[o.mode] || this.programs.density;
		gl.bindFramebuffer(gl.FRAMEBUFFER, o.target.fbo);
		gl.viewport(0, 0, o.target.width, o.target.height);
		gl.clearColor(0, 0, 0, 1);
		gl.clear(gl.COLOR_BUFFER_BIT);
		gl.enable(gl.BLEND);
		gl.blendFunc(gl.ONE, gl.ONE);
		gl.useProgram(P.program);
		const U = P.uniforms;
		gl.uniform2f(U.uGrid, o.cols, o.rows);
		gl.uniform1i(U.uObstacle, o.obstacle.attach(3));
		gl.uniform1i(U.uGlyphs, o.atlas.attach(4));
		gl.uniform1f(U.uGlyphCount, o.atlas.count);
		gl.uniform1f(U.uJitter, o.jitter);
		gl.uniform1i(U.uPhosphor, o.phosphor);
		gl.uniform3f(U.uObsColor, o.obsColor[0], o.obsColor[1], o.obsColor[2]);
		gl.bindVertexArray(this.vao);
		for (let li = 0; li < o.layers.length; li++) {
			const L = o.layers[li];
			gl.uniform1i(U.uScene, L.scene.attach(0));
			gl.uniform1i(U.uDye, L.dye.attach(2));
			gl.uniform1f(U.uScale, L.scale);
			gl.uniform1f(U.uBright, L.bright);
			gl.uniform2f(U.uParallax, L.parallax[0], L.parallax[1]);
			gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.count);
		}
		gl.bindVertexArray(null);
		gl.disable(gl.BLEND);
	}
}
```

Note: `uBright` lives in the fragment shader only; the vertex shader never brightens.

- [ ] **Step 3: Integrate into `main.js`**

Add import (after the `asciiShaders.js` import line):

```js
import { GlyphEngine } from './glyphEngine.js';
```

After the `const asciiPresentProgram = ...` line, add:

```js
const glyphEngine = new GlyphEngine(gl);   // instanced renderer; .ok false → legacy fragment path
```

At the end of `initAsciiTargets()` (after the `asciiTrail = createDoubleFBO(...)` line), add:

```js
	glyphEngine.resize(cols, rows);
```

In `renderAscii()`, replace the block starting at `	asciiMaterial.setKeywords(asciiKeywords());` and ending at `	blit(asciiBitmap);                               // → crisp glyph bitmap` (inclusive) with:

```js
	const ga = config.ASCII_GLYPH_SET === 'matrix' ? matrixAtlas : glyphAtlas;
	if (config.ASCII_ENGINE2 && glyphEngine.ok) {
		const layers = [{ scene: asciiScene, dye: dye.read, scale: 1.0, bright: 1.0, parallax: [0, 0] }];
		glyphEngine.render({
			target: asciiBitmap, mode: config.GLYPH_MODE, cols: asciiCols, rows: asciiRows,
			obstacle: obstacleMask.read, atlas: ga, layers,
			jitter: config.ASCII_JITTER, phosphor: phosphorIndex(), obsColor: asciiObsColor,
		});
	} else {
		asciiMaterial.setKeywords(asciiKeywords());
		asciiMaterial.bind();
		const AU = asciiMaterial.uniforms;
		gl.uniform1i(AU.uScene, asciiScene.attach(0));
		gl.uniform1i(AU.uGlyphs, ga.attach(1));
		gl.uniform1i(AU.uDye, dye.read.attach(2));
		gl.uniform1i(AU.uObstacle, obstacleMask.read.attach(3));
		gl.uniform1i(AU.uDirGlyphs, dirAtlas.attach(6));
		gl.uniform1i(AU.uBraille, brailleAtlas.attach(7));
		gl.uniform3f(AU.uObsColor, asciiObsColor[0], asciiObsColor[1], asciiObsColor[2]);
		gl.uniform2f(AU.uGrid, asciiCols, asciiRows);
		gl.uniform1f(AU.uGlyphCount, ga.count);
		gl.uniform1f(AU.uDirCount, dirAtlas.count);
		gl.uniform1f(AU.uJitter, config.ASCII_JITTER);
		gl.uniform1i(AU.uPhosphor, phosphorIndex());
		blit(asciiBitmap);                               // → crisp glyph bitmap
	}
```

(The `else` branch is the existing code verbatim minus its own `const ga` line, which moved above the branch. Delete the old `const ga = ...` line inside what was the original block.)

NOTE (interim): until Task 5, the engine renders density mode regardless of `GLYPH_MODE` (unknown modes fall back). The legacy path still honors edge/braille when `ASCII_ENGINE2` is off.

- [ ] **Step 4: HUD toggle + wiring + preset + boot param**

`FluidSimulation/FluidSimulation.html` — after the `particlesToggle` label line (~221), add:

```html
      <label><input type="checkbox" id="engine2Toggle" checked> Glyph engine 2 (instanced)</label>
```

`main.js` `wireUI()` — after the `bindCheckbox('particlesToggle', ...)` line, add:

```js
	bindCheckbox('engine2Toggle', v => config.ASCII_ENGINE2 = v);
```

`applyAsciiPreset()` — after `setCheckboxValue('particlesToggle', false);`, add:

```js
	setCheckboxValue('engine2Toggle', true);
```

Boot params block (`applyBootParams`, inside the `if (q.get('ascii') === '1')` branch) — add:

```js
		if (q.has('engine2')) setCheckboxValue('engine2Toggle', q.get('engine2') === '1');
```

- [ ] **Step 5: Verify parity (headless A/B)**

Server running. Invoke **verify-ascii-fluid**: screenshot both
`...?ascii=1&splats=6&engine2=1` and `...?ascii=1&splats=6&engine2=0`.
Expected: zero console errors; both show a colored glyph grid of the same glyph size/density character (pixel-exact diff impossible — splats are random — but structure, brightness, and glyph sharpness must match). Also verify `...?ascii=1&splats=6&engine2=1&phosphor=green` renders green mono.

- [ ] **Step 6: Commit**

```bash
git add FluidSimulation/glyphEngine.js FluidSimulation/config.js FluidSimulation/main.js FluidSimulation/FluidSimulation.html
git commit -m "feat(ascii): add instanced glyph sprite engine (density-mode parity)"
```

---

### Task 3: Lattice warp + living glyphs

**Files:**
- Modify: `FluidSimulation/glyphEngine.js`
- Modify: `FluidSimulation/config.js`
- Modify: `FluidSimulation/main.js`
- Modify: `FluidSimulation/FluidSimulation.html`

**Interfaces:**
- Consumes: Task 2 `GlyphEngine.render(o)`.
- Produces: `render(o)` gains required options `velocity` (FBO), `time` (seconds float), `warp` (0–1.5), `living` (0–1), `cellPx` (`[ASCII_GP_X, ASCII_GP_Y]`). Config keys `ASCII_WARP`, `ASCII_LIVING`. HUD ids `warpSlider`/`warpValue`, `livingSlider`/`livingValue`.

- [ ] **Step 1: Config**

In `config.js` after `ASCII_ENGINE2`:

```js
	ASCII_WARP: 0.5,           // lattice warp — velocity bends the glyph grid (0 = rigid)
	ASCII_LIVING: 0.5,         // living glyphs — rotate to flow, density scale-pulse, sub-cell drift
```

- [ ] **Step 2: Vertex shader — add uniforms**

In `glyphEngine.js` `glyphVertex`, after the line `uniform sampler2D uObstacle;`, insert:

```glsl
uniform sampler2D uVelocity;  // sim velocity — warp / living glyphs
uniform float uWarp;          // lattice bend amount
uniform float uLiving;        // rotation/pulse/drift intensity
uniform float uTime;          // seconds
uniform vec2 uCellPx;         // atlas cell pixel size (9, 16) — isotropic-rotation correction
```

- [ ] **Step 3: Vertex shader — replace the positioning block**

Replace this block at the end of `main()`:

```glsl
	float alive = step(0.0005, dens + ob);   // collapse empty cells (their glyph is the blank ramp slot anyway)
	vec2 corner = aCorner * uScale * alive;
	vLocal = aCorner + 0.5;
	vec2 pos = (aCell + 0.5 + corner) / uGrid;
	gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
```

with:

```glsl
	vec2 vel = texture2D(uVelocity, cc).xy;
	float speed = length(vel);
	float alive = step(0.0005, dens + ob);   // collapse empty cells (their glyph is the blank ramp slot anyway)

	// Living glyphs: tilt toward the flow direction (fades in with speed so resting
	// glyphs stay upright and jitter-free), pulse scale with density, drift sub-cell.
	float rotAmt = uLiving * smoothstep(4.0, 40.0, speed);
	float ang = speed > 1.0 ? atan(vel.y, vel.x) * rotAmt : 0.0;
	float pulse = 1.0 + uLiving * 0.2 * dens * sin(uTime * 3.0 + hash(aCell) * 6.2831);
	vec2 corner = aCorner * uScale * pulse * alive;
	// Rotate in isotropic (pixel) space — cells are 9x16, rotating in cell units would shear.
	vec2 iso = corner * uCellPx;
	float ca = cos(ang), sa = sin(ang);
	iso = mat2(ca, sa, -sa, ca) * iso;   // column-major rotation by +ang
	corner = iso / uCellPx;
	// Lattice warp: the whole grid position bends with the velocity field.
	vec2 warpOff = clamp(vel * 0.012, vec2(-1.5), vec2(1.5)) * uWarp;
	vec2 drift = clamp(vel * 0.004, vec2(-0.4), vec2(0.4)) * uLiving;
	vLocal = aCorner + 0.5;
	vec2 pos = (aCell + 0.5 + warpOff + drift + corner) / uGrid;
	gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
```

- [ ] **Step 4: `render()` — set the new uniforms**

In `GlyphEngine.render`, after the `gl.uniform3f(U.uObsColor, ...)` line, add:

```js
		gl.uniform1i(U.uVelocity, o.velocity.attach(1));
		gl.uniform1f(U.uWarp, o.warp);
		gl.uniform1f(U.uLiving, o.living);
		gl.uniform1f(U.uTime, o.time);
		gl.uniform2f(U.uCellPx, o.cellPx[0], o.cellPx[1]);
```

- [ ] **Step 5: `main.js` — pass options, HUD, preset, boot params**

In the `glyphEngine.render({...})` call, extend the options (after `obsColor: asciiObsColor,`):

```js
			velocity: velocity.read, time: performance.now() / 1000.0,
			warp: config.ASCII_WARP, living: config.ASCII_LIVING,
			cellPx: [ASCII_GP_X, ASCII_GP_Y],
```

HTML — after the `engine2Toggle` label:

```html
      <span class="ctrl-label" style="font-size:0.8em;">Lattice warp: <span id="warpValue"></span></span>
      <input type="range" min="0" max="1.5" step="0.05" value="0.5" class="slider" id="warpSlider">
      <span class="ctrl-label" style="font-size:0.8em;">Living glyphs: <span id="livingValue"></span></span>
      <input type="range" min="0" max="1" step="0.05" value="0.5" class="slider" id="livingSlider">
```

`wireUI()` — after the `engine2Toggle` binding:

```js
	bindSlider('warpSlider', 'warpValue', parseFloat, v => config.ASCII_WARP = v, v => v.toFixed(2));
	bindSlider('livingSlider', 'livingValue', parseFloat, v => config.ASCII_LIVING = v, v => v.toFixed(2));
```

`applyAsciiPreset()` — after `setCheckboxValue('engine2Toggle', true);`:

```js
	setSliderValue('warpSlider', 0.5);
	setSliderValue('livingSlider', 0.5);
```

Boot params — inside the ascii branch:

```js
		if (q.has('warp')) setSliderValue('warpSlider', parseFloat(q.get('warp')));
		if (q.has('living')) setSliderValue('livingSlider', parseFloat(q.get('living')));
```

- [ ] **Step 6: Verify (headless A/B + tuning)**

Invoke **verify-ascii-fluid**: screenshot
`...?ascii=1&splats=8&engine2=1&warp=0&living=0` vs `...?ascii=1&splats=8&engine2=1&warp=1.5&living=1`.
Expected: zero console errors; warp/living=0 matches Task 2 look (rigid grid); warp/living=max shows visibly bent glyph rows and tilted glyphs near fast flow.
TUNING: if at max settings no tilt is visible (velocity scale guess wrong), adjust the constants `smoothstep(4.0, 40.0, speed)`, `vel * 0.012` (warp), `vel * 0.004` (drift) by ×0.1 or ×10 and re-screenshot until the effect is obvious at max and absent at 0. Record final constants in the commit message.

- [ ] **Step 7: Commit**

```bash
git add FluidSimulation/glyphEngine.js FluidSimulation/config.js FluidSimulation/main.js FluidSimulation/FluidSimulation.html
git commit -m "feat(ascii): add lattice warp and living glyphs to glyph engine"
```

---

### Task 4: Relief lighting

**Files:**
- Modify: `FluidSimulation/glyphEngine.js`
- Modify: `FluidSimulation/config.js`
- Modify: `FluidSimulation/main.js`
- Modify: `FluidSimulation/FluidSimulation.html`

**Interfaces:**
- Consumes: Tasks 2–3 engine.
- Produces: `render(o)` gains `relief` (0–1), `lightDir` (`[x, y]` unit-ish), `spec` (0 or 1; Task 7 drives it from the quality tier). Config `ASCII_RELIEF`. HUD `reliefSlider`/`reliefValue`. Vertex declares `float dlum(vec2 cell, vec2 par)` helper (Task 5 reuses it).

- [ ] **Step 1: Config**

After `ASCII_LIVING` in `config.js`:

```js
	ASCII_RELIEF: 0.6,         // relief lighting — density gradient → embossed diffuse + specular
```

- [ ] **Step 2: Vertex shader — normals from the dye gradient**

In `glyphVertex`, after the `hash` function line, add:

```glsl
float dlum (vec2 cell, vec2 par) { vec3 d = texture2D(uDye, (cell + 0.5) / uGrid + par).rgb; return max(d.r, max(d.g, d.b)); }
```

Add to the varyings (after `varying vec3 vColor;`):

```glsl
varying vec3 vNormal;
```

In `main()`, right before the `vec2 vel = texture2D(uVelocity, cc).xy;` line, add:

```glsl
	// Relief normal: treat density as a height field; central differences → surface normal.
	float lL = dlum(aCell + vec2(-1.0, 0.0), uParallax);
	float lR = dlum(aCell + vec2(1.0, 0.0), uParallax);
	float lB = dlum(aCell + vec2(0.0, -1.0), uParallax);
	float lT = dlum(aCell + vec2(0.0, 1.0), uParallax);
	vNormal = vec3((lL - lR) * 2.0, (lB - lT) * 2.0, 1.0);
```

- [ ] **Step 3: Fragment shader — light the ink**

In `glyphFragment`, add after `varying vec3 vColor;`:

```glsl
varying vec3 vNormal;
```

Add after `uniform float uBright;`:

```glsl
uniform float uRelief;    // 0 flat .. 1 fully embossed
uniform vec2 uLightDir;   // xy of the (drifting) light
uniform float uSpec;      // specular gate (quality tier turns it off)
```

Replace the final line pair:

```glsl
	if (mask < 0.01) discard;
	gl_FragColor = vec4(vColor * (0.8 * mask) * uBright, 1.0);
```

with:

```glsl
	if (mask < 0.01) discard;
	vec3 n = normalize(vNormal);
	vec3 L = normalize(vec3(uLightDir, 0.75));
	float diff = max(dot(n, L), 0.0);
	vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
	float spec = pow(max(dot(H, n), 0.0), 24.0) * uSpec;
	vec3 lit = vColor * mix(1.0, 0.35 + 1.15 * diff, uRelief) + vec3(1.0) * spec * uRelief * 0.7;
	gl_FragColor = vec4(lit * (0.8 * mask) * uBright, 1.0);
```

- [ ] **Step 4: `render()` uniforms**

After the `gl.uniform2f(U.uCellPx, ...)` line:

```js
		gl.uniform1f(U.uRelief, o.relief);
		gl.uniform2f(U.uLightDir, o.lightDir[0], o.lightDir[1]);
		gl.uniform1f(U.uSpec, o.spec);
```

- [ ] **Step 5: `main.js` — drifting light + HUD + preset + boot param**

Extend the `glyphEngine.render` options (after `cellPx: [ASCII_GP_X, ASCII_GP_Y],`):

```js
			relief: config.ASCII_RELIEF, spec: 1,
			lightDir: [Math.cos(performance.now() * 0.00015), Math.sin(performance.now() * 0.00015)],
```

(The light slowly orbits — one revolution ≈ 42 s — so the embossing visibly lives without any scene system yet.)

HTML — after the `livingSlider` input:

```html
      <span class="ctrl-label" style="font-size:0.8em;">Relief light: <span id="reliefValue"></span></span>
      <input type="range" min="0" max="1" step="0.05" value="0.6" class="slider" id="reliefSlider">
```

`wireUI()` — after the `livingSlider` binding:

```js
	bindSlider('reliefSlider', 'reliefValue', parseFloat, v => config.ASCII_RELIEF = v, v => v.toFixed(2));
```

`applyAsciiPreset()` — after the `livingSlider` set:

```js
	setSliderValue('reliefSlider', 0.6);
```

Boot params:

```js
		if (q.has('relief')) setSliderValue('reliefSlider', parseFloat(q.get('relief')));
```

- [ ] **Step 6: Verify**

Invoke **verify-ascii-fluid**: screenshot `...?ascii=1&splats=8&engine2=1&relief=0` vs `...?ascii=1&splats=8&engine2=1&relief=1&warp=0&living=0`.
Expected: zero console errors; relief=1 shows directional shading across dye blobs (one flank brighter, opposite darker) + specular highlights; relief=0 flat like Task 3.

- [ ] **Step 7: Commit**

```bash
git add FluidSimulation/glyphEngine.js FluidSimulation/config.js FluidSimulation/main.js FluidSimulation/FluidSimulation.html
git commit -m "feat(ascii): add relief lighting with drifting light to glyph engine"
```

---

### Task 5: EDGE + BRAILLE modes in the engine

**Files:**
- Modify: `FluidSimulation/glyphEngine.js`
- Modify: `FluidSimulation/main.js`

**Interfaces:**
- Consumes: Tasks 2–4 engine; `dlum()` helper from Task 4; existing `dirAtlas`, `brailleAtlas` in `main.js`.
- Produces: `render(o)` gains `dirAtlas`, `brailleAtlas` (always passed; only bound when the mode needs them). `GlyphEngine.programs` gains `edge` and `braille` keyword variants; `ok` requires all three.

- [ ] **Step 1: Constructor — build the variants**

In `GlyphEngine` constructor, replace:

```js
		this.programs = {
			density: link(gl, glyphVertex, glyphFragment, null),
		};
		this.ok = !!this.programs.density;
```

with:

```js
		this.programs = {
			density: link(gl, glyphVertex, glyphFragment, null),
			edge: link(gl, glyphVertex, glyphFragment, ['EDGE']),
			braille: link(gl, glyphVertex, glyphFragment, ['BRAILLE']),
		};
		this.ok = !!(this.programs.density && this.programs.edge && this.programs.braille);
```

- [ ] **Step 2: Vertex shader — EDGE / BRAILLE glyph pick**

In `glyphVertex`, add after `varying vec3 vNormal;`:

```glsl
#ifdef EDGE
uniform float uDirCount;
varying float vDirIdx;
varying float vEdgeMix;
#endif
#ifdef BRAILLE
varying float vByte;
#endif
#define PI 3.14159265
```

In `main()`, insert directly after the `vIdxB = min(vIdxA + 1.0, uGlyphCount - 1.0);` line:

```glsl
#ifdef EDGE
	{
		// Sobel over the density height field → contour orientation (same math as legacy asciiArt).
		float l00 = dlum(aCell + vec2(-1.0, -1.0), uParallax);
		float l10 = dlum(aCell + vec2(0.0, -1.0), uParallax);
		float l20 = dlum(aCell + vec2(1.0, -1.0), uParallax);
		float l01 = dlum(aCell + vec2(-1.0, 0.0), uParallax);
		float l21 = dlum(aCell + vec2(1.0, 0.0), uParallax);
		float l02 = dlum(aCell + vec2(-1.0, 1.0), uParallax);
		float l12 = dlum(aCell + vec2(0.0, 1.0), uParallax);
		float l22 = dlum(aCell + vec2(1.0, 1.0), uParallax);
		float gx = (l20 + 2.0 * l21 + l22) - (l00 + 2.0 * l01 + l02);
		float gy = (l02 + 2.0 * l12 + l22) - (l00 + 2.0 * l10 + l20);
		float gm = length(vec2(gx, gy));
		float o = mod(atan(gx, -gy), PI);
		vDirIdx = clamp(floor(o / PI * uDirCount), 0.0, uDirCount - 1.0);
		float minN = min(min(min(l00, l10), min(l20, l01)), min(min(l21, l02), min(l12, l22)));
		float interior = 1.0 - smoothstep(0.55, 0.9, minN);
		vEdgeMix = smoothstep(0.15, 0.5, gm) * interior;
	}
#endif
#ifdef BRAILLE
	{
		// 8 dye sub-taps on a 2x4 grid → one of 256 braille glyphs (bit = row*2 + col, row 0 top).
		float byteIdx = 0.0;
		for (int b = 0; b < 8; b++) {
			float fbi = float(b);
			float colb = mod(fbi, 2.0);
			float rowb = floor(fbi / 2.0);
			vec2 sp = (aCell + vec2((colb + 0.5) / 2.0, 1.0 - (rowb + 0.5) / 4.0)) / uGrid + uParallax;
			vec3 d = texture2D(uDye, sp).rgb;
			float th = pow(clamp(max(max(d.r, max(d.g, d.b)), ob), 0.0, 1.0), 0.6);
			th += (hash(aCell + vec2(fbi, 0.0)) - 0.5) * uJitter;
			if (th > 0.42) byteIdx += exp2(fbi);
		}
		vByte = byteIdx;
	}
#endif
```

Then extend the alive-collapse so contour/braille cells with an (almost) empty center still draw — insert directly after the `float alive = step(0.0005, dens + ob);` line:

```glsl
#ifdef EDGE
	alive = max(alive, step(0.01, vEdgeMix));
#endif
#ifdef BRAILLE
	alive = max(alive, step(0.5, vByte));
#endif
```

- [ ] **Step 3: Fragment shader — mode masks**

In `glyphFragment`, add after `uniform float uSpec;`:

```glsl
#ifdef EDGE
uniform sampler2D uDirGlyphs;
uniform float uDirCount;
varying float vDirIdx;
varying float vEdgeMix;
#endif
#ifdef BRAILLE
uniform sampler2D uBraille;
varying float vByte;
#endif
```

Insert directly after the `float mask = mix(mA, mB, vRampMix);` line:

```glsl
#ifdef EDGE
	float md = texture2D(uDirGlyphs, vec2((vDirIdx + cuv.x) / uDirCount, cuv.y)).r;
	mask = mix(mask, md, vEdgeMix);
#endif
#ifdef BRAILLE
	mask = texture2D(uBraille, vec2((vByte + cuv.x) / 256.0, cuv.y)).r;
#endif
```

- [ ] **Step 4: `render()` — bind mode atlases**

After the `gl.uniform1f(U.uSpec, o.spec);` line, add:

```js
		if (U.uDirGlyphs != null) { gl.uniform1i(U.uDirGlyphs, o.dirAtlas.attach(5)); gl.uniform1f(U.uDirCount, o.dirAtlas.count); }
		if (U.uBraille != null) gl.uniform1i(U.uBraille, o.brailleAtlas.attach(6));
```

- [ ] **Step 5: `main.js` — pass the atlases**

Extend the `glyphEngine.render` options (after `lightDir: [...],`):

```js
			dirAtlas, brailleAtlas,
```

- [ ] **Step 6: Verify all three modes**

Invoke **verify-ascii-fluid**: screenshot
`...?ascii=1&splats=8&engine2=1&mode=edge&warp=0&living=0`,
`...?ascii=1&splats=8&engine2=1&mode=braille`,
and each against the legacy renders (`&engine2=0` variants).
Expected: zero console errors; edge shows `-/|\` contour outlines around blobs with ramp fill inside; braille shows fine 2×4 dot patterns; both structurally match their legacy counterparts.

- [ ] **Step 7: Commit**

```bash
git add FluidSimulation/glyphEngine.js FluidSimulation/main.js
git commit -m "feat(ascii): add edge and braille keyword variants to glyph engine"
```

---

### Task 6: Background parallax layer

**Files:**
- Modify: `FluidSimulation/main.js`
- Modify: `FluidSimulation/FluidSimulation.html`

**Interfaces:**
- Consumes: Task 1 `dye2`/`asciiScene2`/`drawDisplay(target, source)`; Task 2 `layers` array (background first); existing `pointers[0]` for mouse parallax.
- Produces: HUD id `layer2Toggle`; boot param `layer2`.

- [ ] **Step 1: Render the background layer**

In `renderAscii()`, replace:

```js
		const layers = [{ scene: asciiScene, dye: dye.read, scale: 1.0, bright: 1.0, parallax: [0, 0] }];
```

with:

```js
		const layers = [];
		if (config.ASCII_LAYER2 && dye2) {
			drawDisplay(asciiScene2, dye2.read);
			// Mouse-driven parallax: the far layer's sampling window shifts against the cursor.
			const p0 = pointers[0];
			const par = [(0.5 - (p0 ? p0.texcoordX : 0.5)) * 0.04, (0.5 - (p0 ? p0.texcoordY : 0.5)) * 0.04];
			layers.push({ scene: asciiScene2, dye: dye2.read, scale: 0.7, bright: 0.4, parallax: par });
		}
		layers.push({ scene: asciiScene, dye: dye.read, scale: 1.0, bright: 1.0, parallax: [0, 0] });
```

- [ ] **Step 2: HUD toggle + wiring + preset + boot param**

HTML — after the `reliefSlider` input:

```html
      <label><input type="checkbox" id="layer2Toggle" checked> Depth layer (parallax)</label>
```

`wireUI()` — after the `reliefSlider` binding:

```js
	bindCheckbox('layer2Toggle', v => config.ASCII_LAYER2 = v);
```

`applyAsciiPreset()` — after the `reliefSlider` set:

```js
	setCheckboxValue('layer2Toggle', true);
```

Boot params:

```js
		if (q.has('layer2')) setCheckboxValue('layer2Toggle', q.get('layer2') === '1');
```

- [ ] **Step 3: Verify**

Invoke **verify-ascii-fluid**: screenshot `...?ascii=1&splats=8&engine2=1&layer2=1` vs `...&layer2=0`.
Expected: zero console errors; layer2=1 shows a second, dimmer, smaller-glyph copy of the flow behind the foreground grid (most visible in gaps/dark regions); layer2=0 matches Task 5 output.

- [ ] **Step 4: Commit**

```bash
git add FluidSimulation/main.js FluidSimulation/FluidSimulation.html
git commit -m "feat(ascii): render parallax background glyph layer"
```

---

### Task 7: Quality tiers (fps watchdog + HUD override) + docs

**Files:**
- Modify: `FluidSimulation/main.js`
- Modify: `FluidSimulation/glsl.js`
- Modify: `FluidSimulation/FluidSimulation.html`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: everything above; `Material` class from `gl-program.js`; `S.asciiPresent` in `glsl.js`.
- Produces: module-level `qualityTier` (0/1/2) and `tierMode` (`'auto'` or `'0'|'1'|'2'`). Tiers are **render-time modifiers only** — config is never mutated: tier ≥ 1 → `spec: 0` + `LOWTAPS` present-shader keyword; tier ≥ 2 → engine2 + layer2 branches skipped (legacy path). HUD id `tierSelect`; boot param `tier`.

- [ ] **Step 1: `LOWTAPS` variant of the present-stage bloom**

In `glsl.js` `asciiPresent`, insert directly after the `uniform float uGlowAmount;` line:

```glsl
#ifdef LOWTAPS
#define BSTEP 3
#else
#define BSTEP 1
#endif
```

Change the two bloom loop headers (inside the `uGlow > 0.5 && t < 1.0` block):

```glsl
		for (int bx = -3; bx <= 3; bx++) {
			for (int by = -3; by <= 3; by++) {
```
to
```glsl
		for (int bx = -3; bx <= 3; bx += BSTEP) {
			for (int by = -3; by <= 3; by += BSTEP) {
```

(Do NOT touch the triad loops `dxn`/`dyn` further down.)

- [ ] **Step 2: `asciiPresent` Program → Material**

In `main.js`, change:

```js
const asciiPresentProgram = new Program(gl, baseVS, fs(S.asciiPresent));
```
to
```js
const asciiPresentMaterial = new Material(gl, baseVS, S.asciiPresent);
```

In `renderAscii()`, replace the present-stage block. Old block starts `	asciiPresentProgram.bind();` and ends `	blit(null);                                      // → screen`. New block:

```js
	asciiPresentMaterial.setKeywords(qualityTier >= 1 ? ['LOWTAPS'] : []);
	asciiPresentMaterial.bind();
	const PU = asciiPresentMaterial.uniforms;
	gl.uniform1i(PU.uAscii, asciiTrail.read.attach(0));
	gl.uniform2f(PU.uAsciiSize, asciiTrail.read.width, asciiTrail.read.height);
	gl.uniform2f(PU.uScreen, gl.drawingBufferWidth, gl.drawingBufferHeight);
	gl.uniform1f(PU.uZoom, asciiZoom);
	gl.uniform2f(PU.uPan, asciiPanX, asciiPanY);
	const bg = normalizeColor(config.BACK_COLOR);
	gl.uniform3f(PU.uBack, bg.r, bg.g, bg.b);
	gl.uniform1f(PU.uTime, performance.now() / 1000.0);
	gl.uniform1f(PU.uGlow, config.ASCII_GLOW ? 1.0 : 0.0);
	gl.uniform1f(PU.uGlowAmount, config.ASCII_GLOW_AMOUNT);
	blit(null);                                      // → screen
```

- [ ] **Step 3: Tier state + watchdog**

Add above `renderAscii()` in `main.js`:

```js
// ── quality tiers ──
// Render-time modifiers only (config untouched): tier ≥1 kills specular + halves the
// present-stage bloom taps (LOWTAPS); tier ≥2 skips the instanced engine + depth layer
// (legacy fragment path). Watchdog only ever steps DOWN; the HUD select overrides.
let qualityTier = 0, tierMode = 'auto', tierAccum = 0, tierFrames = 0, tierHold = 0;
function tickTier(dt) {
	if (!config.ASCII || tierMode !== 'auto' || config.PAUSED) return;
	tierAccum += dt; tierFrames++;
	if (tierHold > 0) tierHold -= dt;
	if (tierAccum >= 2.0) {
		const fps = tierFrames / tierAccum;
		tierAccum = 0; tierFrames = 0;
		if (fps < 50 && tierHold <= 0 && qualityTier < 2) {
			qualityTier++;
			tierHold = 5.0;   // settle time before the next step
			console.info('[ascii] quality tier ->', qualityTier, '(' + Math.round(fps) + ' fps)');
		}
	}
}
```

Gate the engine branch in `renderAscii()` — change:

```js
	if (config.ASCII_ENGINE2 && glyphEngine.ok) {
```
to
```js
	if (config.ASCII_ENGINE2 && glyphEngine.ok && qualityTier < 2) {
```

Change the layer condition:

```js
		if (config.ASCII_LAYER2 && dye2) {
```
to
```js
		if (config.ASCII_LAYER2 && dye2 && qualityTier < 2) {
```

Change the `spec: 1,` option in the `glyphEngine.render` call to:

```js
			spec: qualityTier >= 1 ? 0 : 1,
```

Call the watchdog in `update()` — after the `const dt = calcDeltaTime();` line, add:

```js
	tickTier(dt);
```

- [ ] **Step 4: HUD select + wiring + boot param**

HTML — after the `layer2Toggle` label:

```html
      <span class="ctrl-label" style="font-size:0.8em;">Quality tier</span>
      <select id="tierSelect" style="width:100%;box-sizing:border-box;background:rgba(0,0,0,0.25);color:inherit;border:1px solid rgba(255,255,255,0.2);border-radius:4px;padding:4px 6px;">
        <option value="auto" selected>auto (fps watchdog)</option>
        <option value="0">0 — full</option>
        <option value="1">1 — no specular, low bloom</option>
        <option value="2">2 — legacy renderer</option>
      </select>
```

`wireUI()` — after the `layer2Toggle` binding:

```js
	const tierSel = document.getElementById('tierSelect');
	if (tierSel) tierSel.addEventListener('change', () => {
		tierMode = tierSel.value;
		qualityTier = tierMode === 'auto' ? 0 : parseInt(tierMode);
	});
```

Boot params:

```js
		if (q.has('tier')) { tierMode = q.get('tier'); qualityTier = parseInt(q.get('tier')) || 0; }
```

- [ ] **Step 5: Update boot-params doc comment + CLAUDE.md**

Extend the boot-params comment block above `applyBootParams` in `main.js` with the new params:

```js
//   &engine2=0|1                 → instanced glyph engine on/off (legacy fragment path A/B).
//   &warp=F &living=F &relief=F  → glyph-engine effect strengths (0 disables each).
//   &layer2=0|1                  → parallax background glyph layer.
//   &tier=0|1|2                  → force a quality tier (2 = legacy renderer).
```

In `CLAUDE.md`, Key Demos list — add after the **Fourier** bullet:

```markdown
- **FluidSimulation** — GPU stable-fluids sim (WebGL2) with obstacles + ASCII mode. ASCII pipeline: `glyphEngine.js` instanced glyph sprites (relief lighting, lattice warp, living glyphs, parallax depth layer; legacy fragment path = fallback/tier 2) → `asciiFade` persistence trail → `asciiPresent` zoom/pan/CRT-triad. Verify headlessly via `asciiTest.html`/boot params (`?ascii=1&engine2=1&...`) with the verify-ascii-fluid skill
```

- [ ] **Step 6: Verify tiers**

Invoke **verify-ascii-fluid**: screenshot
`...?ascii=1&splats=8&tier=0`, `...&tier=1`, `...&tier=2`.
Expected: zero console errors; tier 0 full effects; tier 1 same structure without specular sparkle; tier 2 identical to `engine2=0` legacy output. Also re-verify `...?ascii=1&splats=8` (auto) still renders and the non-ASCII page is unaffected.

- [ ] **Step 7: Commit**

```bash
git add FluidSimulation/main.js FluidSimulation/glsl.js FluidSimulation/FluidSimulation.html CLAUDE.md
git commit -m "feat(ascii): add fps-watchdog quality tiers with HUD override"
```

---

## Final verification (whole phase)

- [ ] Run the full headless sweep via **verify-ascii-fluid**: default ascii, `engine2=0/1`, `warp`, `living`, `relief`, `mode=edge`, `mode=braille`, `layer2=0/1`, `tier=0/1/2`, `zoom=8` (CRT triad reveal must still work over the instanced bitmap), `phosphor=green`, `glyphset=matrix`. Zero console errors everywhere.
- [ ] Manual check in a real browser (not SwiftShader): interact — splats under cursor while zoomed, typing inject, particle overlay toggle, persistence trail, pause/resume — all unchanged.
- [ ] Confirm 60 fps on the dev machine with everything on (fps badge).
