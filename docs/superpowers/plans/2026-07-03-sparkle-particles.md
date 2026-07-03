# Sparkle Particles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ASCII-mode "Glyph particles" overlay in FluidSimulation with procedural twinkling star sparkles riding the streamlines.

**Architecture:** The existing 80×80 advected-particle system stays; only the point-sprite fragment shader changes from glyph-atlas sampling to a procedural star (soft core + 4 cross arms, per-particle twinkle from the seed, dye tint whitening at flare peak). Life is normalized to spawn at 1.0 so the fragment shader can fade both spawn and death ends.

**Tech Stack:** WebGL1-style GLSL in ES6 template literals, no build system, no test framework — verification is headless screenshots via the `verify-ascii-fluid` project skill.

**Spec:** `docs/superpowers/specs/2026-07-03-sparkle-particles-design.md`

## Global Constraints

- All `.js` files use **tabs** for indentation and **CRLF** line endings.
- Edit-tool rule: never put a line containing a backtick (template-literal delimiter) in `old_string` — the shader sources are inside template literals, so anchor edits on inner GLSL lines only.
- No new files, HUD controls, or config keys.
- Spec deviation (approved in this plan): `particleUpdate` gets a 2-line change to normalize spawn life to 1.0 — required for the birth-fade the spec asks for, since the render shader cannot know a randomized spawn value. Task 1 updates the spec file to match.

---

### Task 1: Sparkle shaders + render wiring

**Files:**
- Modify: `FluidSimulation/asciiShaders.js:9-10` (header comment), `:144-207` (`particleUpdate`, `particleVertex`, `particleRender`)
- Modify: `FluidSimulation/main.js:752-770` (`renderParticles`)
- Modify: `docs/superpowers/specs/2026-07-03-sparkle-particles-design.md` (record the `particleUpdate` deviation)

**Interfaces:**
- Consumes: existing `particlePos` double-FBO (xy = pos, z = life, w = seed), `dye` FBO, `blit`, `Program` — all already in `main.js`.
- Produces: `particleRender` shader expecting uniforms `uPos`, `uDye`, `uTime`, `uDim`, `uPointSize` (no more `uGlyphs`/`uGlyphCount`); `particleVertex` emitting varyings `vSeed`, `vPos`, `vLife`.

- [ ] **Step 1: Capture a BEFORE screenshot (baseline, current glyph particles)**

Invoke the `verify-ascii-fluid` skill with the request: screenshot `FluidSimulation/FluidSimulation.html?ascii=1&particles=1&splats=8`, settle ~3 s, save as `before-sparkles.png`.
Expected: ASCII fluid field with small glyph point-sprites scattered over it; no console errors.

- [ ] **Step 2: Normalize spawn life in `particleUpdate`**

In `FluidSimulation/asciiShaders.js`, inside `particleUpdate`, replace:

```glsl
	p.z -= uDt * (0.25 + 0.5 * h(vUv + 1.7));
	if (p.z <= 0.0) {
		p.x = h(vUv + uTime);
		p.y = h(vUv + uTime + 3.3);
		p.z = 0.6 + 0.9 * h(vUv + uTime + 7.7);
		p.w = h(vUv + uTime + 11.1);
	}
```

with:

```glsl
	p.z -= uDt * (0.2 + 0.8 * h(vUv + 1.7));
	if (p.z <= 0.0) {
		p.x = h(vUv + uTime);
		p.y = h(vUv + uTime + 3.3);
		p.z = 1.0;
		p.w = h(vUv + uTime + 11.1);
	}
```

Life now runs 1 → 0 for every particle (lifetime 1.25–5 s via the per-particle decay rate, same spread as before), so the render shader can ramp both ends. Also update the comment above the shader (line 141-143): `xy = pos in [0,1], z = life (1 → 0), w = twinkle seed`.

- [ ] **Step 3: Add `vLife` to `particleVertex`**

In `particleVertex`, add `varying float vLife;` after the `varying vec2 vPos;` line, and `vLife = p.z;` after the `vSeed = p.w;` line.

- [ ] **Step 4: Rewrite `particleRender` as the sparkle shader**

Replace the full body of the `particleRender` template literal (keep the `export const particleRender = \`` and closing `\`;` lines intact — anchor the edit on the inner GLSL lines) with:

```glsl
precision highp float;
precision highp sampler2D;
varying float vSeed;
varying vec2 vPos;
varying float vLife;
uniform sampler2D uDye;
uniform float uTime;
void main () {
	vec2 pc = gl_PointCoord * 2.0 - 1.0;              // sprite-local, centre 0, edge ±1
	// per-particle twinkle: unique speed + phase from the seed, pow-sharpened → brief flares
	float tw = 0.5 + 0.5 * sin(uTime * (2.0 + 5.0 * fract(vSeed * 7.31)) + vSeed * 41.0);
	tw = tw * tw * tw;
	// soft radial core
	float r = length(pc);
	float core = exp(-r * r * 8.0);
	// 4 thin cross arms, length scales with the twinkle
	float armLen = 0.35 + 0.65 * tw;
	float arms = max(0.0, 1.0 - abs(pc.y) * 14.0) * max(0.0, 1.0 - abs(pc.x) / armLen)
	           + max(0.0, 1.0 - abs(pc.x) * 14.0) * max(0.0, 1.0 - abs(pc.y) / armLen);
	float star = core * (0.55 + 0.45 * tw) + arms * arms * tw;
	// life fade: ramp in just after spawn (life starts at 1), ramp out near death
	float fade = smoothstep(0.0, 0.15, vLife) * smoothstep(1.0, 0.9, vLife);
	// dye tint under the particle, whitened as the flare peaks → reads as a light glint
	vec3 col = texture2D(uDye, vPos).rgb;
	float b = max(col.r, max(col.g, col.b));
	vec3 hue = col / max(b, 0.001);
	vec3 tint = mix(hue, vec3(1.0), 0.65 * tw);
	float bright = clamp(b * 4.0, 0.25, 1.6);
	gl_FragColor = vec4(tint * star * bright * fade, 1.0);
}
```

Notes for the implementer: additive blending (`ONE, ONE`) is set by the caller, so the shader outputs premultiplied-style rgb and alpha is ignored — no `discard` needed (black adds nothing). GLSL1 (`texture2D`, `gl_PointCoord`) matches every other shader in this file.

Also update the file-header comment lines 9–10: `particleUpdate — advect a position texture by the velocity field (sparkle particles).` / `particleVertex / particleRender — draw those particles as twinkling star point-sprites.`

- [ ] **Step 5: Rewire `renderParticles()` uniforms in `main.js`**

Replace the body of `renderParticles()` (`FluidSimulation/main.js:752-770`) so the atlas binds are gone, `uTime` is bound, and the dye moves to texture unit 1:

```js
// Draw the particles as additive sparkle point-sprites over the presented ASCII frame.
function renderParticles() {
	if (!particlePos || !particleVAO) return;
	gl.enable(gl.BLEND);
	gl.blendFunc(gl.ONE, gl.ONE);
	particleRenderProgram.bind();
	gl.uniform1i(particleRenderProgram.uniforms.uPos, particlePos.read.attach(0));
	gl.uniform1i(particleRenderProgram.uniforms.uDye, dye.read.attach(1));
	gl.uniform1f(particleRenderProgram.uniforms.uTime, performance.now() / 1000.0);
	gl.uniform2f(particleRenderProgram.uniforms.uDim, PCOLS, PROWS);
	gl.uniform1f(particleRenderProgram.uniforms.uPointSize, Math.max(12, gl.drawingBufferWidth / 70));
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
	gl.bindVertexArray(particleVAO);
	gl.drawArrays(gl.POINTS, 0, PCOUNT);
	gl.bindVertexArray(null);
	gl.disable(gl.BLEND);
}
```

(Point size bumped `/90 → /70` so the cross arms have pixels to live in.)
Also update the section comment at `main.js:263`: `── advected sparkle particles (overlay riding the streamlines) ──`.

- [ ] **Step 6: Record the spec deviation**

In `docs/superpowers/specs/2026-07-03-sparkle-particles-design.md`, "Not doing" section, replace the line `- No `particleUpdate` changes.` with `- `particleUpdate`: only a 2-line change normalizing spawn life to 1.0 (enables the birth fade); no other changes.`

- [ ] **Step 7: Verify — AFTER screenshot**

Invoke the `verify-ascii-fluid` skill: screenshot `FluidSimulation/FluidSimulation.html?ascii=1&particles=1&splats=8`, settle ~3 s, save as `after-sparkles.png`.
Expected: bright star-shaped points (visible cross arms on at least some — twinkle phases differ) over the ASCII field; **zero console errors** (a GLSL compile error would blank the whole canvas and log `Program error`/shader info logs). Compare against `before-sparkles.png`: glyph shapes gone.

- [ ] **Step 8: Verify non-ASCII mode untouched**

Screenshot `FluidSimulation/FluidSimulation.html?splats=8` (no ascii param).
Expected: normal colorful fluid, no particles, no console errors.

- [ ] **Step 9: Commit**

```bash
git add FluidSimulation/asciiShaders.js FluidSimulation/main.js docs/superpowers/specs/2026-07-03-sparkle-particles-design.md
git commit -m "feat(ascii): replace glyph particles with twinkling sparkles"
```

---

### Task 2: Labels and comments

**Files:**
- Modify: `FluidSimulation/FluidSimulation.html:221`
- Modify: `FluidSimulation/config.js:36`

**Interfaces:**
- Consumes: nothing from Task 1 (pure copy changes; `particlesToggle` id and `ASCII_PARTICLES` key are unchanged).
- Produces: user-facing label "Sparkles (ride streamlines)".

- [ ] **Step 1: HTML checkbox label**

In `FluidSimulation/FluidSimulation.html:221`, replace:

```html
      <label><input type="checkbox" id="particlesToggle"> Glyph particles (ride streamlines)</label>
```

with:

```html
      <label><input type="checkbox" id="particlesToggle"> Sparkles (ride streamlines)</label>
```

- [ ] **Step 2: config.js comment**

In `FluidSimulation/config.js:36`, replace:

```js
	ASCII_PARTICLES: false,    // advected glyph particles riding the streamlines (overlay)
```

with:

```js
	ASCII_PARTICLES: false,    // advected sparkle particles riding the streamlines (overlay)
```

- [ ] **Step 3: Verify label renders**

Invoke the `verify-ascii-fluid` skill: screenshot `FluidSimulation/FluidSimulation.html?ascii=1&particles=1&splats=8` once more.
Expected: HUD checkbox reads "Sparkles (ride streamlines)" and is checked; sparkles visible; no console errors.

- [ ] **Step 4: Commit**

```bash
git add FluidSimulation/FluidSimulation.html FluidSimulation/config.js
git commit -m "feat(ascii): rename glyph-particles toggle to sparkles"
```
