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

### Dual-Canvas Pattern
Every demo: two stacked `<canvas>` elements:
- `backgroundCanvas` (z-index: 1) — persistent/slow-update drawings
- `foregroundCanvas` (z-index: 2) — per-frame clear + interactive/animated elements

Both fetched by ID in `main.js`, sized to `canvasWidth × canvasHeight` (typically 800×800).

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

### Shared Scripts (`JS/`)
| File | Purpose |
|------|---------|
| `theme.js` | Dark/light theme toggle — loaded by demo pages that have a `#themeToggle` button |

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

HTML links shared CSS from `../CSS/`, includes back-to-mainpage link. Templates: `BoilerplateCode/HTMLWithCanvas.html`, `BoilerplateCode/mainWithCanvas.js`.

### Key Demos
- **GravitySimulation** — N-body gravity via RK4; `particle.js` elastic collision physics; three wall modes (none/infinite/collision)
- **GravitySimulationGPU** — Barnes-Hut N-body (CPU octree via `Octree.js`, GPU render via Three.js WebGPU). **Outlier**: uses Three.js loaded via importmap from CDN; no dual-canvas pattern; 3D OrbitControls camera
- **Raycaster** — 2D line-segment raycasting; `Raycaster.js` casts rays, finds closest wall via `Line2D.GetIntersectionPointWith`
- **Lissajous / LissajousRotating** — Parametric figures as table; `LissajousTable` manages 2D array of `LissajousFigure` instances
- **Quadtree** — Spatial partitioning viz; `Quadtree.js` implements Wikipedia pseudocode
- **RotatingSquares** — rotating square animation; standard dual-canvas pattern
- **CircularMotion** — circular motion demo; standard dual-canvas pattern
- **Bouncink** — bouncing animation with custom font asset
- **PhaseshiftDemo1** — phase shift visualization
- **pr0xmas** — holiday demo. **Outlier**: uses p5.js (loaded locally), not ES6 modules

### CSS (`CSS/`)
- `fontStyles.css` — typography
- `Slider.css` — styled range inputs
- `horizontalDiv.css` — flex layout for control panels
- `radioButton.css` — custom radio button styling

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
