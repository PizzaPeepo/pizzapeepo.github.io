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
- **Raycaster** — 2D line-segment raycasting; `Raycaster.js` casts rays, finds closest wall via `Line2D.GetIntersectionPointWith`
- **Lissajous / LissajousRotating** — Parametric figures as table; `LissajousTable` manages 2D array of `LissajousFigure` instances
- **Quadtree** — Spatial partitioning viz; `Quadtree.js` implements Wikipedia pseudocode

### CSS (`CSS/`)
- `fontStyles.css` — typography
- `Slider.css` — styled range inputs
- `horizontalDiv.css` — flex layout for control panels
- `radioButton.css` — custom radio button styling
