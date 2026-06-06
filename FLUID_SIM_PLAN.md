# Fluid Simulation Demo — Implementation Plan

A GPU (WebGL2) real-time Navier–Stokes fluid demo for the Canvas Lab site, with
**user-placeable obstacles** and a rich HUD of behaviour sliders. Inspired by
[PavelDoGreat/WebGL-Fluid-Simulation](https://github.com/PavelDoGreat/WebGL-Fluid-Simulation)
(solver structure, bloom/sunrays polish) and
[haxiomic/GPU-Fluid-Experiments](https://github.com/haxiomic/GPU-Fluid-Experiments)
(visual experiments). Obstacles are the differentiator — neither reference repo has them.

Status: **PLANNED. Do not implement until asked.** Build in the milestone order below.

---

## 1. Technology choice

- **Raw WebGL2 + GLSL fragment shaders**, no libraries. Matches both reference repos and
  the repo's existing `wavegrid.js` (WebGL2). Broader support than WebGPU; keeps the
  dependency-free, no-build ethos. (GravitySimulationGPU's WebGPU/Three.js path is the
  outlier — do **not** follow it here.)
- Native ES6 modules (`type="module"`), tabs + CRLF per repo convention.
- Single-canvas **modern-HUD** pattern (copy `FlowField/` scaffold): one full-window
  `#backgroundCanvas` (here a WebGL2 context) + right-side `.hud-panel`. Uses
  `window.getCanvasWidth()` (`JS/hudUtils.js`), `JS/theme.js`, `Utils/ResizeManager.js`.

---

## 2. Solver — stable fluids (Stam 1999), GPU ping-pong

Every field lives in a float/half-float framebuffer texture. Most are **double-buffered**
(ping-pong: read source, write target, swap). Two grid resolutions, as PavelDoGreat does:

- **Sim grid** — low res (default 128²). Holds velocity, pressure, divergence, curl, obstacle mask.
- **Dye grid** — high res (default 1024²). Holds the visible colour density. Sharper visuals,
  cheap solver.

### Fields / framebuffers
| Field | Buffer | Format | Grid |
|-------|--------|--------|------|
| velocity | double | RG16F | sim |
| dye / density | double | RGBA16F | dye |
| pressure | double | R16F | sim |
| divergence | single | R16F | sim |
| curl | single | R16F | sim |
| **obstacle mask** | single | R16F (or R8) | sim (+ dye-res copy for crisp overlay) |
| bloom mip chain | N FBOs | RGBA16F | ≤256 |
| sunrays + temp | single×2 | R16F | 196 |

### Per-frame step order (mirrors PavelDoGreat `step(dt)`)
1. **curl** — compute ∇×velocity into curl texture.
2. **vorticity confinement** — add curl-based swirl force back into velocity (`CURL` strength).
3. **divergence** — compute ∇·velocity.
4. **clear pressure** — multiply previous pressure by `PRESSURE` (dissipation seed).
5. **pressure Jacobi** — iterate `PRESSURE_ITERATIONS` (default 20) solving ∇²p = divergence.
6. **gradient subtract** — velocity -= ∇pressure → divergence-free (incompressible) field.
7. **advect velocity** — semi-Lagrangian back-trace, * `VELOCITY_DISSIPATION`.
8. **advect dye** — back-trace dye along velocity, * `DENSITY_DISSIPATION`.
9. **(inputs)** — splats from pointer/obstacle interaction injected before/within the frame.
10. **display** — composite dye (+ shading, bloom, sunrays, obstacle overlay) to screen.

### Texture format detection + fallback (mirror PavelDoGreat)
- WebGL2: require `EXT_color_buffer_float` (render to float) and `OES_texture_float_linear`
  (linear filtering of float). Format ladder `R16F → RG16F → RGBA16F`; downgrade per tier
  if a target is unsupported.
- If float-linear is missing: fall back to nearest filtering (or in-shader manual bilinear
  for advection), and **disable SHADING / BLOOM / SUNRAYS**, drop dye res to 512.
- If WebGL2 itself is missing: show a full-screen overlay (copy GravitySimGPU's
  `#webgpuError` box pattern) pointing to a simpler demo.

---

## 3. Obstacles (the novel feature)

Neither reference repo has solid boundaries. We add an **obstacle mask** `C(x)` — `1` = solid,
`0` = fluid — sampled by the solver shaders to enforce no-penetration / no-slip walls. Done
right, a cylinder in a stream produces a **von Kármán vortex street** (great default showcase).

### Mask storage
- Sim-res single FBO, value 1 inside solids. Painted by pointer, stamped by presets, or moved.
- Keep a dye-res copy (or upscale in the display shader) so the rendered obstacle edge is crisp.

### Boundary conditions baked into each shader (add a `uObstacle` sampler to all)
1. **Velocity in solids = 0** (or the obstacle's velocity if moving): final velocity pass
   multiplies by `(1 - C)`. A dedicated boundary pass zeroes the wall-normal component on
   fluid cells adjacent to solids (no-slip).
2. **Advection** — if the back-traced sample lands in a solid, clamp to the cell / use zero,
   so wall garbage isn't dragged into the fluid.
3. **Divergence** — for any solid neighbour, substitute its face velocity with `0` (wall is
   impermeable) when summing ∂u/∂x + ∂v/∂y.
4. **Pressure Jacobi** — Neumann BC (∂p/∂n = 0): when a neighbour cell is solid, use the
   **centre** cell's pressure in its place. Implement by sampling the neighbour's mask.
5. **Gradient subtract** — same substitution: don't apply a pressure gradient across a
   solid face; zero velocity in solid cells afterward.
6. **Splat** — multiply injected dye/force by `(1 - C)` so you can't paint fluid inside walls.

A shared GLSL helper (`vec2 sampleVelocity(uv)` / `float solid(uv)`) keeps the BC logic in one
place across shaders.

### Obstacle interaction (HUD mode / toolbar)
- **Add obstacle** — paint a circle at the pointer; drag to enlarge. Brush-size slider.
- **Erase obstacle** — paint `0` into the mask (or right-click in any mode).
- **Move obstacle** — drag re-rasterizes the mask at the new position.
- **Presets** (stamp into mask): Cylinder, Airfoil, Double-slit, Funnel/nozzle, Clear all.
- Render: display shader mixes a solid fill + soft rim/AO over the dye where `C > 0`
  (theme-aware colour). Optional subtle specular so obstacles read as physical.
- **Moving obstacles** = stretch goal (store obstacle velocity, feed it as the wall velocity
  BC). v1 ships static + drag-to-reposition.

---

## 4. Interaction model

- **Default mode — Drag fluid**: pointer drag injects a dye splat + a velocity force along
  the drag vector (`SPLAT_RADIUS`, `SPLAT_FORCE`). Hold **Shift** = force only (no dye).
- **Modes** (radio buttons or a small icon toolbar): Drag fluid · Add obstacle · Erase
  obstacle · Move obstacle.
- **Multi-touch / mobile**: track multiple pointers, one splat each (PavelDoGreat does this).
- **Right-click** = erase obstacle from any mode. **Middle-drag** = pan-free (n/a).
- **Initial state**: a handful of random colour splats **plus a default cylinder** in a gentle
  left-to-right flow, so the page opens on a live vortex street.

---

## 5. HUD controls

Reuse the `FlowField` HUD scaffold and its `bindSlider(id, valId, parse, onChange, fmt)` helper.
Group with `.hud-section` / `.hud-divider`.

### Sliders / numeric
| Control | Range / options | Config key | Note |
|---------|-----------------|------------|------|
| Sim resolution | 64 / 128 / 256 | SIM_RESOLUTION | reallocates sim FBOs |
| Dye resolution | 512 / 1024 / 2048 | DYE_RESOLUTION | reallocates dye FBOs |
| Velocity dissipation | 0 – 4 | VELOCITY_DISSIPATION | "friction" |
| Dye dissipation | 0 – 4 | DENSITY_DISSIPATION | fade rate |
| Pressure | 0 – 1 | PRESSURE | |
| Pressure iterations | 10 – 50 | PRESSURE_ITERATIONS | quality vs perf |
| Vorticity (curl) | 0 – 50 | CURL | swirliness |
| Splat radius | 0.05 – 1 | SPLAT_RADIUS | |
| Splat force | 1000 – 12000 | SPLAT_FORCE | |
| Colour update speed | 1 – 20 | COLOR_UPDATE_SPEED | hue cycling |
| Bloom intensity | 0 – 2 | BLOOM_INTENSITY | |
| Bloom threshold | 0 – 1 | BLOOM_THRESHOLD | |
| Sunrays weight | 0 – 2 | SUNRAYS_WEIGHT | |
| Obstacle brush size | small – large | — | |

### Toggles
- Shading (fake 3D normals from dye gradient + directional light)
- Colorful (rotating hue) vs fixed palette
- Bloom · Sunrays
- Transparent / background colour (theme-aware)
- Paused

### Colour mode (radio)
Rainbow-cycle · Single hue · Two-colour gradient · Velocity-mapped.

### Obstacle (radio / dropdown)
Mode toolbar (above) + preset dropdown (Cylinder · Airfoil · Double-slit · Funnel · Clear).

### Actions (buttons)
Random splats (P) · Pause (Space) · Reset (R) · Clear dye (C) · Clear obstacles · Save PNG (S).

### Hotkeys
Space = pause · R = reset · S = save PNG · C = clear dye · P = random splats ·
D / O / E = drag / obstacle / erase mode. FPS badge in panel header.

---

## 6. Polish (the "as polished as possible" bar)

- **Bloom** — prefilter (threshold + soft-knee) → iterative down/up blur on a mip chain →
  additive composite. PavelDoGreat defaults: 8 iterations, 256 res, intensity 0.8, threshold 0.6.
- **Sunrays** — radial light-scatter masked by dye, weight ~1.0.
- **Shading** — derive pseudo-normals from the dye gradient, apply a directional light for a
  volumetric look.
- **Colour** — HSV hue cycling ("colorful"), selectable palettes, theme-aware background via
  `Utils/ThemeManager.js` (`onThemeChange`); dither the final output to kill banding.
- **Responsive** — full-window canvas offset by `getCanvasWidth()`; reallocate FBOs on resize
  via `Utils/ResizeManager.js` (debounced). Pause sim when tab hidden.
- **Mobile** — multi-touch splats; lower default sim res on small screens; HUD panel collapses
  (existing `hudUtils.js` toggle).
- **First impression** — open with random splats + a cylinder shedding vortices.

---

## 7. File structure

```
FluidSimulation/
  FluidSimulation.html   <- modern-HUD scaffold; #backgroundCanvas → WebGL2; loads main.js (module)
  main.js                <- GL init, FBO orchestration, sim loop, HUD wiring, input, presets, hotkeys
  glsl.js                <- all shader sources as exported template strings
  gl-program.js          <- compileShader, Program (uniform-location cache), Material (keyword variants for display)
  framebuffers.js        <- createFBO / createDoubleFBO, resize+copy, getSupportedFormat (format ladder)
  obstacles.js           <- obstacle mask FBO, paint/erase/move, presets, overlay params
  pointer.js             <- pointer/multi-touch state + mode
  config.js              <- default config object + named parameter presets
```
Splitting (vs PavelDoGreat's single 1500-line `script.js`) fits the repo's per-demo file
convention. Boilerplate references: `BoilerplateCode/`, and copy `FlowField/` for the HUD.

### Shader programs to author (per PavelDoGreat, + obstacle-aware variants)
copy · clear · splat · advection · divergence · curl · vorticity · pressure ·
gradientSubtract · display(Material, keyword variants: SHADING/BLOOM/SUNRAYS) ·
bloomPrefilter · bloomBlur · bloomFinal · sunraysMask · sunrays · (obstacle overlay).
Advection / divergence / pressure / gradientSubtract / splat each gain `uObstacle` BC logic.

---

## 8. Site registration (3 places — easy to miss one; CLAUDE.md §"Adding a Demo")

1. **`FluidSimulation/`** — the files above.
2. **`index.html`** — add `<a class="card" href="FluidSimulation/FluidSimulation.html">` to
   `#demoGrid` (card-num cosmetic, next ≈ 23; the demos badge auto-counts `.card`), **and** a
   `CAT_MAP` entry: slug `fluidsimulation` → a category (use `physics` to sit with Gravity /
   Cloth / Boids — confirm the exact category strings in `index.html` at implementation time).
3. **`cardpreviews.js`** — append `'FluidSimulation'` (href slug) to `ORDER` at **index 22**
   (Pong Wars is the current last at 21) **and** an index-aligned draw fn to `DEMOS` (a small
   animated swirling-dye + obstacle preview). The `// N:` comments track each index.

---

## 9. Milestones (incremental build order)

- **M1 — GL boilerplate**: WebGL2 context, fullscreen-quad blit, `getSupportedFormat` + format
  fallback, `createFBO` / `createDoubleFBO`, copy/clear programs. Renders a cleared canvas.
- **M2 — Core solver**: advection, divergence, pressure Jacobi, gradient subtract, curl,
  vorticity, splat. Mouse drag injects dye + force. Working fluid (no obstacles), basic display.
- **M3 — HUD & shell**: copy FlowField scaffold; wire all sliders/toggles/radios; theme;
  resize (FBO realloc); FPS; hotkeys; Reset / Pause / Clear dye / Save PNG.
- **M4 — Obstacles**: mask FBO; add `uObstacle` BC to solver shaders; paint / erase / move;
  presets; overlay render. Default cylinder → verify von Kármán shedding.
- **M5 — Polish**: bloom, sunrays, shading, colour palettes + hue cycling, dithering,
  multi-touch / mobile, initial splats + cylinder, theme-aware background.
- **M6 — Register & ship**: index card + CAT_MAP + cardpreviews draw fn; cross-browser +
  mobile test; perf pass (sim res / iteration tuning).

---

## 10. Risks / open questions

- **Float-linear support** — older/mobile GPUs may lack `OES_texture_float_linear`; advection
  then needs manual bilinear or quality drops. Fallback path must be tested, not assumed.
- **Obstacle pressure BC correctness** — vortex shedding only looks right if the Neumann
  solid BC is applied consistently in divergence, pressure, and gradient-subtract. Most likely
  source of bugs; build M4 with a single static cylinder and validate before adding paint/move.
- **Performance on mobile** — keep sim res ≤128 and iterations ≤20 by default; expose higher
  via sliders. Pause on hidden tab.
- **Half-float precision** — pressure can drift; clamp / use `PRESSURE` dissipation as PavelDoGreat does.
- **Default config seeds** (PavelDoGreat): DENSITY_DISSIPATION 1, VELOCITY_DISSIPATION 0.2,
  PRESSURE 0.8, PRESSURE_ITERATIONS 20, CURL 30, SPLAT_RADIUS 0.25, SPLAT_FORCE 6000,
  SIM_RESOLUTION 128, DYE_RESOLUTION 1024 — start here, then tune for the obstacle showcase.
