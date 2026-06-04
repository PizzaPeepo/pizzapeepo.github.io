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

### 02 · Raycaster

- **[Bug / UX] Walls auto-regenerate every 5 seconds** (`setInterval(GetNewRandomLines, 5000)`
  in `main.js`), teleporting the whole scene while you are using it. Make it a toggle, slow it
  way down, or remove it entirely.
- **[Big] Render the visibility polygon.** Fill the lit region between consecutive ray-hit
  points instead of drawing bare lines — this is exactly what the card promises ("light and
  shadow") and is a dramatic visual upgrade. Add a light-colored radial glow at the source and
  optional soft shadows (a few jittered ray origins).
- **[Enhancement] Let the user draw walls.** Drag to add a segment, right-click to delete.
  Far more engaging than random walls — and it removes the auto-regenerate problem.
- **[Enhancement] Multiple colored lights** that blend additively, with a subtle flicker.

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

### 05 · Rotating Lissajous

- **[Bug] Dead initial parameters.** The figure is constructed with `(omega1=1, omega2=4)`, but
  `draw()` immediately calls `Update(..., omega1, omega2, ...)` with the slider defaults
  `1, 1`, overwriting it on the first frame. So the demo opens as a boring 1:1. Either set the
  slider defaults to a nicer ratio (e.g. 3:2 or 3:4) so it is interesting on load, or actually
  honor the `1, 4`.
- **[Quick win] Color by phase** (hue follows `t[i]`) instead of flat white, and add a glowing
  head point on the leading edge (reuse the gravity demo's glow-sprite idea).
- **[Enhancement] On-screen ω₁:ω₂ + phase readout;** allow decimal ω steps for smoother morph.

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

### 09 · Bouncink

- **[Bug / Mismatch] The card does not match the demo.** The card and its micro-preview
  (`cardpreviews.js`, demo #8) promise "physics-driven ink blobs with custom collision
  response." The actual page is a DVD-logo bouncer with a 0.4-minute countdown that flips to a
  pepe-dance GIF — and it is the only demo built on p5 (loaded from a CDN) rather than vanilla
  canvas. Resolve one of two ways:
  - **(a) Re-label** the card, tag, and preview to match reality (a "DVD Bounce" nostalgia /
    novelty piece), or
  - **(b) Build the promised demo:** gooey **metaball ink blobs** (marching squares, or simple
    additive radial fields that visually merge on contact). This would genuinely earn the name
    "Bouncink" and the Creative tag, and would fit the vanilla-canvas stack used everywhere
    else.
- **[Quick win]** If kept as-is, add a corner-hit celebration and a "will it hit the corner?"
  counter — the one thing everyone actually watches a DVD bouncer for.

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

- **`Niko/randomizer.html`** — a jQuery "pick a random item from a pasted list" utility using
  the old pre-redesign CSS. Either promote it as a styled "tools" entry, or remove it.
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
