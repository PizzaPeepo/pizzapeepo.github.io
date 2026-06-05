# CLAUDE.md

Guidance for Claude Code when working with this repo.

## Project Overview

Static GitHub Pages site — interactive JS canvas animations + physics simulations. No build system; files served as-is.

## Running Locally

ES6 module imports require HTTP server:

```bash
# Python
python -m http.server 8080

# Node
npx serve .
```

Navigate to `http://localhost:8080`. All demos accessible from `index.html`.

## Architecture

### Module System
All JS: native ES6 modules (`type="module"` in `<script>`, `import`/`export`). No bundler or transpiler.

### Canvas Patterns
Two patterns coexist — check which one a demo uses before editing.

**Legacy dual-canvas** (older demos: Gravity, Raycaster, Lissajous, RotatingSquares, CircularMotion):
two stacked `<canvas>` elements:
- `backgroundCanvas` (z-index: 1) — persistent/slow-update drawings
- `foregroundCanvas` (z-index: 2) — per-frame clear + interactive/animated elements

Both fetched by ID in `main.js`, sized to `canvasWidth × canvasHeight` (typically 800×800).

**Modern single-canvas + HUD** (Boids, DoublePendulum, and all newer demos: FlowField,
GameOfLife, Waves, ReactionDiffusion, Voronoi, Physarum, Cloth, Maze, Fourier):
one full-window `#backgroundCanvas` (z-index 0) plus a right-side `.hud-panel` (HTML
scaffold copied between demos). Canvas width comes from `window.getCanvasWidth()`
(`JS/hudUtils.js`); each `main.js` defines a local `bindSlider(id, valId, parse, onChange, fmt)`
helper to wire HUD sliders. Standard hotkeys: Space=pause, R=reset, S=save-PNG.
Compute-heavy demos (Waves, ReactionDiffusion, Voronoi, Physarum) simulate on a low-res
offscreen buffer + typed array, then `drawImage`-scale up to the visible canvas.

### Animation Loop
`window.requestAnimationFrame(draw)` recursive. FPS throttling uses `Date.now()` deltas, not `setInterval`.

### Shared Utilities (`Utils/`)
| File | Purpose |
|------|---------|
| `Vector2D.js` | 2D vector — arithmetic, rotation (CW/CCW), normalization, dot/cross product |
| `helpers.js` | `ColorRGBA`, `Point2D`, draw helpers (`drawCircle`, `drawRectangle`, etc.), math utils (`range`, `make2DArray`), `GetMousePos` |
| `RungeKutta.js` | RK4 ODE integrators — `RK4_1D`, `RK4_2D`, `RK4_ParticlesInGravField` |
| `rectangle.js` | `Rectangle` for Quadtree (`containsPoint`, `intersects`) |
| `perlin.js` / `simplexNoise.js` | Noise generation |
| `bignumber.js` | Big number arithmetic |
| `FadeTrail.js` | Ring-buffer fade trail — eliminates `fillRect` ghosting; `push(data)`, `render(speed, fn)`, `reset()` |

### Shared Scripts (`JS/`)
| File | Purpose |
|------|---------|
| `theme.js` | Dark/light theme toggle — loaded by demo pages that have a `#themeToggle` button; fires `themechange` event |
| `hudUtils.js` | HUD panel toggle + `window.getCanvasWidth()` (subtracts 280px panel on desktop, full width ≤700px mobile). Loaded by modern-HUD demos |

### Root-level Index Scripts
These are IIFE-style (not ES6 modules), loaded only by `index.html`:
| File | Purpose |
|------|---------|
| `wavegrid.js` | WebGL2 interactive wave-dot background |
| `cardpreviews.js` | Animated canvas micro-previews on each demo card |
| `streaks.js` | Streak/particle overlay on index page |
| `cardan.js` | Cardan grille animation on index page |

### Demo Structure
```
DemoName/
  DemoName.html   <- entry point; loads main.js as type="module"
  main.js         <- canvas setup, UI event wiring, animation loop
  *.js            <- demo-specific classes (Particle, Raycaster, LissajousFigure, etc.)
```

HTML links shared CSS from `../CSS/`, includes back-to-mainpage link. Templates: `BoilerplateCode/HTMLWithCanvas.html`, `BoilerplateCode/mainWithCanvas.js`. For a modern-HUD demo, copy `FlowField/` as the starting point.

### Adding a Demo — registration in 3 places
Easy to miss any one; a new demo only shows fully when all three are done:
1. `DemoName/DemoName.html` + `main.js` (copy an existing modern-HUD demo).
2. `index.html`: add an `<a class="card">` to `#demoGrid` **and** a `CAT_MAP` entry (href-slug → filter category).
3. `cardpreviews.js`: append the href slug to `ORDER` **and** a matching draw fn to `DEMOS` — the two arrays are index-aligned (the `// N:` comments track each index).

`card-num` in the card is cosmetic; the "demos" count badge auto-counts `.card` elements.

### Key Demos
- **GravitySimulation** — N-body gravity via RK4; `particle.js` elastic collision physics; three wall modes (none/infinite/collision)
- **GravitySimulationGPU** — Barnes-Hut N-body (CPU octree via `Octree.js`, GPU render via Three.js WebGPU). **Outlier**: uses Three.js loaded via importmap from CDN; no dual-canvas pattern; 3D OrbitControls camera
- **Raycaster** — 2D line-segment raycasting; `Raycaster.js` casts rays, finds closest wall via `Line2D.GetIntersectionPointWith`
- **Lissajous / LissajousRotating** — Parametric figures as table; `LissajousTable` manages 2D array of `LissajousFigure` instances
- **Quadtree** — Spatial partitioning viz; `Quadtree.js` implements Wikipedia pseudocode
- **RotatingSquares** — rotating square animation; standard dual-canvas pattern
- **CircularMotion** — circular motion demo; **4-canvas outlier**: `blackbackgroundCanvas` + `backgroundCanvas` (bgCtx) + `middlegroundCanvas` (mgCtx, trail) + `foregroundCanvas`
- **Bouncink** — bouncing animation with custom font asset
- **PhaseshiftDemo1** — phase shift visualization
- **Boids** — Reynolds flocking; `Boid.js` does separation/alignment/cohesion steering, reuses `GravitySimulation/SpatialHash.js` for neighbour queries. Single-canvas modern-HUD pattern; fillRect trail-fade
- **DoublePendulum** — two modes (radio-switched): chaotic double pendulum (`DoublePendulum.js`, inline RK4 over the 4-D state, overlaid perturbed copies) and analytic pendulum-wave bank (`PendulumWave.js`). Single-canvas modern-HUD pattern
- **pr0xmas** — holiday demo. **Outlier**: uses p5.js (loaded locally), not ES6 modules
- **FlowField** — Simplex-noise flow field; particle streamlines with fade trails. Imports `Utils/simplexNoise.js` as a side effect (sets `window.SimplexNoise`). Modern-HUD
- **GameOfLife** — Conway CA; paintable Uint8Array grid, Gosper glider gun preset, wrap toggle. Modern-HUD
- **Waves** — ripple-tank interference; sum-of-circular-waves on offscreen buffer. Modern-HUD
- **ReactionDiffusion** — Gray-Scott; double-buffered Float32 grids, feed/kill presets, brush seed. Modern-HUD
- **Voronoi** — moving sites; per-pixel nearest-site cells + Bowyer-Watson Delaunay mesh (`Delaunay.js`). Modern-HUD
- **Physarum** — slime-mould agents; sense-and-turn on a diffusing Float32 trail map. Modern-HUD
- **Cloth** — Verlet spring mesh; grab/drag/tear, constraint relaxation, `hLink` map for O(1) quad cull. Modern-HUD
- **Maze** — recursive-backtracker gen + animated A*/Dijkstra/BFS/DFS (binary-heap open set in `main.js`). Modern-HUD
- **Fourier** — DFT of a drawn/preset closed path → epicycle chain re-traces it. Modern-HUD

### CSS (`CSS/`)
- `theme.css` — main stylesheet (17KB): theme CSS vars + dark/light, HUD panel/nav/slider/toggle/backdrop classes used by modern demos
- `fontStyles.css` — typography
- `Slider.css` — styled range inputs
- `horizontalDiv.css` — flex layout for control panels
- `radioButton.css` — custom radio button styling

### Canvas Fade Ghosting
`fillRect` with `rgba(bg, alpha)` overlay never fully clears — `round(1 × 0.7) = 1` repeats forever (8-bit integer storage). Use `FadeTrail` instead: clear canvas each frame, replay history with `globalAlpha = (1-speed)^age` computed from full-brightness colors, so pixels cleanly reach 0.
`_dummyCtx` pattern: `document.createElement('canvas').getContext('2d')` as no-op sink when a draw fn writes to both bgCtx and fgCtx but only one should receive history replay.

## Editing JS Files

All `.js` files use **tabs** for indentation and **CRLF** line endings (Windows).

### Edit tool rules
- `old_string` must use tabs, not spaces. Verify with `cat -A` or `sed -n 'Np'` if a match fails.
- Keep `old_string` as short as possible — prefer a single unique line over multi-line blocks.
- Never include lines containing template literals (`` ` ``) or `${}` in `old_string` — the Edit tool cannot match them reliably. Choose an anchor line above or below instead.

### When Edit fails: use a temp `.mjs` script
Write a `fix_something.mjs` at the repo root, run it with `node fix_something.mjs`, then delete it.
Use `import.meta.url` to resolve paths (avoids shell-escaping issues with `-e`):

```js
import { readFileSync, writeFileSync } from 'fs';
const path = new URL('./SubDir/file.js', import.meta.url).pathname.slice(1);
let c = readFileSync(path, 'utf8');
// build old/new with explicit '\r\n' for CRLF and '\t' for tabs
const CRLF = '\r\n', T = '\t';
const old = T + "some line" + CRLF + T + "next line";
const neu = T + "replacement";
if (!c.includes(old)) { console.log('NOT FOUND'); process.exit(1); }
writeFileSync(path, c.replace(old, neu), 'utf8');
console.log('OK');
```
