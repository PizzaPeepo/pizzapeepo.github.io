# Canvas Lab — Improvements

A review of the site and every demo, with concrete suggestions for visual polish, new
interaction, and fixes for issues found while reading the code. Suggestions are tagged:

- **[Bug]** — something broken or wrong today
- **[Quick win]** — small effort, clear payoff
- **[Enhancement]** — a nice addition
- **[Big]** — a headline feature worth real effort

Demos are covered in gallery order (matching the cards on `index.html`). Suggestions try to
reuse what already exists — `Utils/helpers.js` (`ColorRGBA` + `LinearInterpolateColors`,
`HexToRGBA`, `Distance`, `range`, `Point2D`, `GetMousePos`), `Utils/Vector2D.js`,
`Utils/square.js`, the noise modules, the `RK4` integrators in `Utils/RungeKutta.js`, the
`SpatialHash` and the color-LUT / glow-sprite pattern in `GravitySimulation/main.js`, and the
shared `themechange` event from `JS/theme.js`.

---

## Cross-cutting (whole site)

- **[Enhancement] Standardize hotkeys + add PNG export.** The GPU demo already supports
  Space / R / B. Make Space = pause, R = reset, S = save-PNG consistent across all demos.
  Export is a three-liner (`canvas.toDataURL('image/png')` → download link) and is especially
  valuable for the math-art demos (Lissajous, Rotating Squares, Circular Motion) whose frames
  make lovely stills.
- **[Enhancement] Responsive HUD.** Demos compute `canvasWidth = innerWidth - 280` even on
  phones, where the control panel is a fixed overlay rather than a side column — so on narrow
  screens the canvas is needlessly shrunk. Below ~700px, collapse the panel into a toggle /
  bottom sheet and let the canvas use the full width.
- **[Enhancement] Shareable state.** Encode slider/preset values (and the landing-page filter)
  in the URL hash so a tuned configuration can be linked and reopened.

---

## Per-demo

### 01 · Gravity Simulation (2D)

Already the richest demo: presets (orbital / ring / galaxy-collision / collapse), supernova,
force brush, drag-to-launch with live trajectory preview, Barnes-Hut toggle + θ, the
collision-spark "excitation field", glow sprites, and three wall modes. Suggestions are
incremental.

- **[Quick win] Surface the force brush.** It is keyboard-only (hold **G** to attract, **H**
  to repel) and not mentioned in the HUD. Add on-screen toggle buttons and a small legend, and
  show a velocity-color legend so the speed→color mapping is readable.
- **[Quick win] Pause / step.** Only Reset exists today; add a pause button and single-step.
- **[Enhancement] Expose trail length.** `TRAIL_FADE` is a hardcoded `0.04`. A slider lets
  users go from crisp dots to long comet trails.
- **[Enhancement] Click-to-place extra suns.** The engine already supports arbitrary heavy
  bodies; multiple attractors make for richer orbits. (Note: the drag-to-launch trajectory
  preview only integrates against `particles[0]`, so it would be approximate with many suns.)
- **[Enhancement] Scroll wheel sets launch mass** during drag-to-launch, with the predicted
  mass shown next to the arrow.
- **[Enhancement] Add Friction slider.**

### 03 · Quadtree

- **[Bug / UX] The interaction is undiscoverable.** Left-click inserts a point; **middle-drag**
  moves the query box (hostile to trackpads); the HUD has only "Reset". Add an instructions
  blurb, make the query box follow the cursor (or use left-drag), and let scroll resize it.
- **[Big] Animate moving points.** Give the points `Vector2D` velocities and let them bounce,
  so the tree visibly subdivides and merges in real time — that live adaptation is the whole
  appeal of a quadtree.
- **[Enhancement] Efficiency counter.** Show point count, node count, and "checks: quadtree N
  vs brute-force M" so the data structure's value is legible. Highlight the cells a query
  actually visits.
- **[Enhancement] Color points by depth** or by the leaf that contains them.

### 04 · Lissajous (table)

- **[Quick win] Color by frequency ratio.** Replace the monochrome white tracing with
  `hue = f(a:b)` (reuse `ColorRGBA`) so every cell reads distinctly. Add optional a:b labels.
- **[Big] Draw the rolling generator circles** along the top row and left column — the classic
  Lissajous-table apparatus where two perpendicular circular motions sweep out each figure.
  It is the iconic visualization and would be a real standout.
- **[Enhancement] Click a cell → focus mode.** Enlarge that one figure and show its
  equation / current phase.
- **[Enhancement] Global phase slider** to morph every figure together (ellipse ↔ line).
- **[Nit]** `if ((row === 0) & (col === 0))` uses bitwise `&`; harmless, but `&&` is clearer.

### 06 · Phaseshift

- **[Bug / UX] No controls at all.** `PhaseshiftDemo1.html` has only the nav pill;
  `numberOfDots` is hardcoded to 9 in `main.js`. Add sliders for spoke count, frequency, and
  per-spoke phase delta.
- **[Mismatch] Card vs. demo.** The card says "phase offset between two signals transforms
  their superposition," but the demo shows dots doing simple harmonic motion along radial
  spokes (a phase-wave wheel). Two ways to close the gap:
  - **(a)** Connect adjacent dots with a smooth curve so the travelling / standing wave is
    visible — this leans into what the demo actually is.
  - **(b)** Build the literal two-sine-waves-plus-superposition view. Notably, the card's own
    micro-preview (`cardpreviews.js`, demo #5) already draws exactly that — two waves and their
    sum — and is a better match for the description.

### 07 · Circular Motion

- **[Quick win] Drop the redundant `blackbackgroundCanvas`.** It is just a solid fill — make it
  a CSS background instead. Four stacked canvases is heavier than this demo needs.
- **[Enhancement] Expose the angular-velocity relationship.** It is hardcoded as
  `(circles.length - j) * t`; a multiplier slider would let users explore very different
  rosette / spirograph patterns. Add an option to connect every k-th point (star polygons).
- **[Enhancement] Color by radius or angle; drag to move the origin; PNG export** (this demo
  produces especially beautiful stills).

### 08 · Rotating Squares

- **[Big-ish, high ROI] Generalize square → N-gon.** A "sides" slider (triangles, pentagons,
  hexagons, …) built on an extended `Utils/square.js` yields enormous variety from a small
  change. The inscribed-rotation construction generalizes directly.
- **[Quick win] Optional fade trail** (motion blur) like the other demos, plus PNG export.
- **[Enhancement] Mouse-reactive speed** — spin faster near the cursor, mirroring the
  hover-acceleration trick `cardan.js` already uses on the landing page.

### 10 · Gravity Simulation · GPU

Strong already: per-frame Barnes-Hut octree on the CPU, WebGPU instanced rendering,
OrbitControls, burst, pause, particle-count selector, and an FPS badge.

- **[Big] Add a bloom / glow post pass.** The card promises a "glowing galaxy"; today the
  particles are additive icosahedra. A real bloom pass would transform the look.
- **[Enhancement] 3D galaxy-collision preset.** The 2D sim has a galaxy-collision preset; the
  GPU one only spawns a single disk. Add a two-galaxy setup, and/or click to drop a perturbing
  mass.
- **[Enhancement] Color modes** (by speed / radius / depth) with a legend; idle **auto-rotate**
  of the camera; motion-blur trails; a screenshot button.
- **[Quick win] Graceful WebGPU fallback.** When `navigator.gpu` is missing the user just gets
  an error card — link it to the 2D Gravity demo so there is still something to see.

---

## Unlinked / orphaned demos

These exist in the repo but are not reachable from `index.html`. Worth a deliberate decision.

- **`pr0xmas/`** — an elaborate p5 pr0gramm-meme Christmas wallpaper (bouncing logo, snow,
  badges, pepe GIFs, a "reset peepos" hold-timer, wichtel), built for Wallpaper Engine and
  pulling in many external assets. Either generalize the snow into a clean, brandless seasonal
  **"Snowfall" creative demo**, leave it hidden, or remove it. Note the personal / meme content
  before publishing it to the gallery.

---

## New demo ideas

Each leans on the existing stack and would slot into a current filter category.

- **Boids / flocking** — emergent, endlessly watchable; reuse `SpatialHash` for neighbor
  queries and `Vector2D` for steering. *(Physics / Algorithms)*
- **Double pendulum & pendulum-wave** — chaotic and hypnotic; reuse the `RK4` integrators in
  `Utils/RungeKutta.js`. *(Physics)*
- **Perlin / Simplex flow field** — thousands of particles drifting along a noise field, with
  fading trails; reuse `perlin.js` / `simplexNoise.js` and the gravity demo's trail-fade trick.
  *(Creative)*
- **Conway's Game of Life / cellular automata** — paintable grid with presets; reuse
  `make2DArray`. *(Algorithms)*
- **Fourier epicycles** — stacked rotating circles that trace a user-drawn path; a natural
  companion to the Lissajous and Circular Motion demos. *(Mathematics)*
- **Wave interference / ripple tank** — two or more sources whose waves interfere; extend the
  landing page's `wavegrid` shader idea into a standalone demo. *(Waves)*
- **Reaction-diffusion (Gray–Scott)** — organic, gorgeous patterns; GPU-friendly and a great
  fit for the Rendering tag. *(Rendering)*
- **Voronoi / Delaunay** — a natural companion to the existing Quadtree. *(Geometry / Algorithms)*
- **Fractals** — Mandelbrot / Julia with smooth zoom, or recursive trees swayed by a Perlin
  "wind". *(Mathematics / Rendering)*
- **Cloth / soft-body spring mesh** — grab, drag, and tear a Verlet-integrated mesh, reusing
  the integration approach already used in the gravity sim. *(Physics)*
- **Maze generation + A\* / BFS pathfinding** — generate, then watch the search flood-fill and
  backtrack the path. *(Algorithms)*
- **Slime-mold (Physarum) agents** — striking generative networks from simple sense-and-turn
  agents, reusing the particle + trail-fade pattern from the gravity demo. *(Creative / Rendering)*

---

## Code Refactoring Plan

Findings from a full codebase survey. Prioritized by impact. Bugs marked **[BUG]**.

---

### Phase 1 — Critical Bugs

#### 1. **[BUG]** `Cos()` calls `Math.sin()` — `Utils/helpers.js:19`
```js
// Wrong:
function Cos(degrees) { return Math.sin(degrees * Math.PI / 180); }
// Fix:
function Cos(degrees) { return Math.cos(degrees * Math.PI / 180); }
```

#### 2. **[BUG]** `RgbaToHex` logic inverted — `Utils/helpers.js:211`
```js
// Wrong — throws when input IS a ColorRGBA:
if (color instanceof ColorRGBA) throw new Error(...)
// Fix:
if (!(color instanceof ColorRGBA)) throw new Error(...)
```

#### 3. **[BUG]** `Line2D` type-check always true — `Raycaster/Raycaster.js:7`
```js
// Wrong — operator precedence makes `(!x) instanceof Y` meaningless:
if (!tempOffsetVec instanceof Vector2D)
// Fix:
if (!(tempOffsetVec instanceof Vector2D))
```

#### 4. **[BUG]** `UpdatePositon` method doesn't exist — `Lissajous/LissajousFigure.js:43`
Vector2D has no `UpdatePositon` method. Either the method was renamed or this line is dead.
Check intent and either delete or fix the call.

#### 5. **[BUG]** Loose equality in hot loop — `Raycaster/Raycaster.js:78`
Replace `!=` / `==` with `!==` / `===` throughout to avoid type coercion.

---

### Phase 2 — High-Impact Duplications

#### 6. Extract `createLinkedRangeSliders()` — saves ~350 lines

Every demo repeats this 25-line pattern per slider pair:
```js
xminSlider.addEventListener("input", function() {
    let val = parseInt(this.value);
    if (val >= xmax) { this.value = xmax - 1; val = xmax - 1; }
    xmin = val;
    xminLabel.textContent = xmin;
});
// ...repeated for xmax, ymin, ymax, vxmin, vxmax, radius, mass...
```

Extract to `Utils/sliders.js`:
```js
// Wire a min/max slider pair so they stay ordered and update a label.
export function createLinkedRangeSliders(minId, maxId, onChange) { ... }

// Wire a single slider to a label and a callback.
export function createSlider(sliderId, labelId, onChange) { ... }
```

Affected demos: GravitySimulation (~300 lines), Raycaster, Lissajous, RotatingPolygons, CircularMotion, PhaseshiftDemo1.

#### 7. Extract `CanvasManager` — saves ~200 lines

Every demo has this block (twice — once per canvas):
```js
var backgroundCanvas = document.getElementById("backgroundCanvas");
var bgCtx = backgroundCanvas.getContext("2d");
backgroundCanvas.width = canvasWidth;
backgroundCanvas.height = canvasHeight;
backgroundCanvas.style.width = canvasWidth + "px";
backgroundCanvas.style.height = canvasHeight + "px";
bgCtx.strokeStyle = whiteLineStrokeStyle;
bgCtx.lineWidth = 2;
```

Extract to `Utils/CanvasManager.js`:
```js
// Set up canvases to the given size; returns their 2D contexts.
export function setupCanvases(canvases, width, height) { ... }
// canvases: [{ id: string, setup?: (ctx) => void }]
```

#### 8. Extract `ThemeManager` — saves ~80 lines

Every demo does:
```js
function applyThemeColors(isLight) { ... }
applyThemeColors(document.documentElement.classList.contains('light'));
document.addEventListener('themechange', (e) => applyThemeColors(e.detail.isLight));
```

Extract to `Utils/ThemeManager.js`:
```js
// Fire callback immediately with current theme, then again on every change.
export function onThemeChange(callback) { ... }
```

#### 9. Extract `onWindowResize` — saves ~60 lines

Same pattern in every demo:
```js
window.addEventListener('resize', function() {
    canvasWidth = window.innerWidth - HUD_PANEL_WIDTH;
    canvasHeight = window.innerHeight;
    applyCanvasSize();
    resetDemo();
});
```

Extract to `Utils/ResizeManager.js`:
```js
// Register a debounced resize handler.
export function onWindowResize(callback, debounceMs = 100) { ... }
```

---

### Phase 3 — Global State & Long Functions

#### 10. Replace 114-line global variable block — `GravitySimulation/main.js:8–114`

Group related state into named config objects so magic numbers have names:
```js
// Before: 114 loose globals
var xmin, xmax, ymin, ymax, vxmin, vxmax, LUT_SIZE, BRUSH_STRENGTH, ...

// After:
const PARTICLE_CONFIG = { xmin: -400, xmax: 400, ymin: -400, ymax: 400 };
const RENDER_CONFIG   = { LUT_SIZE: 64, TRAIL_FADE: 0.04 };
const BRUSH_CONFIG    = { strength: 5e6, softRadiusSq: 2500 };
```

#### 11. Split `draw()` in GravitySimulation — currently 325 lines

Current `draw()` mixes physics, rendering, UI input, collisions, trails, and sparks.
Split into focused functions:
```js
function stepPhysics(dt)   { /* positions, velocities, collisions */ }
function renderParticles() { /* trails, glows, sprites */ }
function renderUI()        { /* HUD, labels */ }
function draw() {
    requestAnimationFrame(draw);
    if (document.hidden) return;
    const dt = computeDeltaTime();
    stepPhysics(dt);
    renderParticles();
    renderUI();
}
```

---

### Phase 4 — Incomplete Abstractions

#### 12. Make drawing helpers self-contained — `Utils/helpers.js`

`drawLine`, `drawCircle`, `drawPoint` add to the canvas path but don't call `stroke()`.
Every caller must remember to stroke — leaky abstraction.

Fix with explicit naming:
- `pathLine(ctx, ...)` / `pathCircle(ctx, ...)` — path only (current behavior, renamed)
- `drawLine(ctx, ...)` / `drawCircle(ctx, ...)` — path + stroke (new, what callers usually want)

Non-breaking: rename existing functions, add new `draw*` wrappers.

#### 13. Remove `Point2D` — `Utils/helpers.js:114–123`

`Point2D` is just `{ x, y }` with no methods. `Vector2D` covers the same ground plus arithmetic.
Having both forces callers to convert between them. Replace all `Point2D` usage with `Vector2D` and delete the class.

#### 14. Deduplicate `Vector2D` rotation methods — `Utils/Vector2D.js:92–154`

8 rotation methods where mutable and immutable variants share identical math.
Extract the core rotation into one private helper:
```js
_applyRotation(sinA, cosA) { ... }  // mutates in place
rotateCCW(deg)             { return this.clone()._applyRotation(...); }
rotateCCWInPlace(deg)      { return this._applyRotation(...); }
```
Rename mutable variants from `_RotateCCW` to `rotateCCWInPlace` — `_` prefix as "mutable" is an undocumented convention, `InPlace` suffix is explicit.

#### 15. `ColorRGBA` rebuilds string in every setter — `Utils/helpers.js`

4 setters each contain the identical string concatenation. Extract:
```js
_rebuildRGBA() { this._RGBA = `rgba(${this._r},${this._g},${this._b},${this._a})`; }
```
Call once per setter instead.

#### 16. `Particle._isHeavyParticle` goes stale — `GravitySimulation/particle.js`

Computed at construction; becomes wrong if mass changes later (setter exists).
Fix: make it a getter:
```js
get isHeavyParticle() { return this._mass >= 500; }
```

#### 17. Delete `Particle._lastMousePos` — `GravitySimulation/particle.js`

Set in constructor, getter/setter defined, never read anywhere. Dead code — delete it.

---

### Phase 5 — Magic Numbers

Every hardcoded constant should be a named variable at the top of its file.

| File | Value | Suggested Name |
|---|---|---|
| `Utils/RungeKutta.js:31` | `25` | `GRAVITY_SOFTENING_SQ` |
| `GravitySimulation/main.js:30` | `64` | `COLOR_LUT_SIZE` |
| `GravitySimulation/main.js:25` | `0.04` | `TRAIL_FADE_SPEED` |
| `GravitySimulation/main.js:76` | `5e6` | `BRUSH_FORCE_STRENGTH` |
| `GravitySimulation/main.js:77` | `2500` | `BRUSH_SOFT_RADIUS_SQ` |
| `GravitySimulation/BarnesHutTree.js:5` | `5` | `BH_SOFTENING_RADIUS` |
| `Raycaster/Raycaster.js:36` | `10000` | `MAX_RAY_LENGTH` |
| `Raycaster/main.js:371` | `0.0005` | `NOISE_TIME_STEP` |
| `GravitySimulation/SpatialHash.js:15` | `10000` | `HASH_KEY_MULTIPLIER` |

---

### Phase 6 — Structural Cleanups

#### 18. Move demo-specific factories out of general utilities

`Line2D.js` contains `GetRandomLine2D`, `GetWallLines2D` — demo factories in a geometry class.
Move to `Raycaster/LineFactory.js`.

`particle.js` contains `GenerateRandomParticle()`, `AddNRandomParticles()` which depend on GravitySimulation globals.
Move to `GravitySimulation/ParticleFactory.js`.

#### 19. Delete `CalcGravForce()` — `Utils/RungeKutta.js:33–49`

Exported but never imported or called anywhere. GravitySimulation uses the Barnes-Hut acceleration instead. Delete it.

#### 20. Fix unfilled placeholders in boilerplate — `BoilerplateCode/mainWithCanvas.js`

`getElementById("")` (lines ~33, ~49) throws at runtime if the template is used as-is.
Replace with clearly-commented TODOs:
```js
// TODO: replace with your canvas element ID
var backgroundCanvas = document.getElementById("backgroundCanvas");
```

---

### Refactoring Summary by File

| File | Actions |
|---|---|
| `Utils/helpers.js` | Fix Cos() bug, fix RgbaToHex bug, extract `_rebuildRGBA`, rename `path*`/`draw*`, remove `Point2D` |
| `Utils/Vector2D.js` | Deduplicate rotation, rename mutable variants to `*InPlace` |
| `Utils/RungeKutta.js` | Delete `CalcGravForce`, name `GRAVITY_SOFTENING_SQ` |
| `Utils/sliders.js` | **New file** — `createLinkedRangeSliders`, `createSlider` |
| `Utils/CanvasManager.js` | **New file** — `setupCanvases` |
| `Utils/ThemeManager.js` | **New file** — `onThemeChange` |
| `Utils/ResizeManager.js` | **New file** — `onWindowResize` |
| `GravitySimulation/main.js` | Group globals into config objects, split `draw()`, collapse slider handlers |
| `GravitySimulation/particle.js` | Delete `_lastMousePos`, make `isHeavyParticle` getter, move factories |
| `GravitySimulation/BarnesHutTree.js` | Name `BH_SOFTENING_RADIUS` |
| `GravitySimulation/SpatialHash.js` | Name `HASH_KEY_MULTIPLIER` |
| `Raycaster/Raycaster.js` | Fix instanceof bug, fix `!=` → `!==`, name `MAX_RAY_LENGTH` |
| `Raycaster/Line2D.js` | Move demo factories to `Raycaster/LineFactory.js` |
| `Lissajous/LissajousFigure.js` | Fix `UpdatePositon` bug, reduce getter/setter boilerplate |
| `BoilerplateCode/mainWithCanvas.js` | Replace `getElementById("")` with TODO comments |
| All demo `main.js` | Apply ThemeManager, CanvasManager, ResizeManager, sliders utilities |
