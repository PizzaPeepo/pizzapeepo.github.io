# ASCII Index Redesign — Implementation Plan

Drastic index-page redesign: one unified ASCII glyph lattice rendering (a) a GPU fluid
simulation background driven by the mouse, (b) the cardan gimbal converted to glyphs, and
(c) hero text living inside the lattice. UI and fluid interact both ways. Colors follow
the site theme (dark / light / viper).

Reference for the interaction model: vibe-coded.com (analyzed 2026-07-05, see
"Prior analysis" at the bottom).

---

## Resume protocol (read this first in a fresh session)

1. Read this file top to bottom. The **Status** block below says where work stopped.
2. Find the first unchecked `[ ]` step. Steps are ordered; earlier phases are hard
   prerequisites of later ones.
3. Before continuing, run the phase's **Verify** command to confirm the last checked
   step actually holds in the current working tree (a session may have died mid-edit).
4. After finishing any step: tick its box, update **Status**, append one line to
   **Worklog**. Do this immediately, not in batches — this file is the crash log.
5. Never commit without the user asking (repo rule). Steps marked `CHECKPOINT` are
   good moments to *suggest* a commit to the user.

## Worklog

<!-- one line per session-chunk: date · step(s) done · anything surprising -->
- 2026-07-05 · plan written, no code yet.
- 2026-07-05 · Phase 0+1 done. Branch created, baseline shot (viper theme, hero+gimbal+wavegrid). fluid-core.js extracted: kill-list = sunrays/blur, obstacles UI+stamp, HUD, audio, ascii zoom/pan, text-inject, matrix/braille atlases. Obstacle uniforms satisfied by static empty 4x4 FBO — stock shaders untouched. test.html renders dye, auto+mouse splats, 0 console errors.

- 2026-07-05 · Phase 2 done. glyph-atlas.js + ascii-pass.js + theme-palette.js + custom asciiPresentBg (theme composite: dark=additive, light=ink-on-paper via uLight; no zoom/CRT, 5x5 glow). test.html?theme=light|viper boot param for headless theme shots. All 3 themes verified via screenshots.

- 2026-07-05 · Phase 3 done (3.3b provisional). Ambient tuning gotchas: (1) Ashima snoise rarely exceeds ±0.6 — thresholds above ~0.5 never fire; DYE_THRESH=0.28 ≈ 15-20%% coverage. (2) rate/dissipation ratio fixes the global average — to get dark gaps + hot cores raise BOTH (rate 0.40, diss 0.90), transport distance shrinks. (3) stock asciiArt brightness pow(lum,0.5)*2.4 lights residue → forked asciiArtBg in asciibg/shaders.js with uFloor remap (0.05) + softer curve 0.25+pow(lum,0.65)*1.6. Index wired: asciibg/main.js self-mounts canvas (wavegrid slot), wavegrid+streaks tags removed, warmup 180 steps at boot, reduced-motion=static frame, mobile=96sim/512dye/72cols/DPR1. Final density/feel needs USER-GPU live check; .blobs CSS overlay maybe retire in Phase 8 (fights lattice).

- 2026-07-05 · Phase 4 done. 4.1/4.2/4.4 found already implemented from prior session (cardan-scene.js port complete: no MSAA/bloom, own color+depth FBO at half canvas res, premult ONE/ONE_MINUS_SRC_ALPHA composite; hover-accel via document-level mouseover delegation, scroll kick kept; index.html cardan.js tag was already removed) — verified via screenshots: gimbal glyph arcs top-right, two index frames differ (spin), light+viper themes OK, 0 console errors. 4.3 ring-stir implemented (cardan.stir(): 2 markers/ring projected via stored ring MVPs, screen-delta velocity, force 9000 / dye 0.05 / radius 0.10, delta cap 0.03 vs hover-accel, teleport guard; test.html?stir=0 A/B param). Verdict PROVISIONAL KEEP — SwiftShader stills inconclusive (wake too faint vs ambient; fps 12→8 is software-raster cost only). Final stir verdict + glyph quality = USER-GPU.

- 2026-07-05 · Phase 5 done. hoverRepulsion + hoverDye frags in asciibg/shaders.js (aspect-corrected rounded-rect SDF; dye = band outside edge only). ui-link.js: mouseover/out delegation (.card/.filter-pill/#themeToggle), relatedTarget guard vs child flicker, rect re-read per frame while active (scroll-safe), exp ease in 0.15s/out 0.30s + smoothstep, passes skipped under strength 0.004. FORCE 110, DYE_RATE 0.22, range = max(hx*1.6, hy*10, 0.22) per reference. Headless verify: test.html?hover=1 fakes mouseover on new #hoverProbe .card div → screenshot shows clean dark cavity parting around rect, no blowup, 0 errors; index clean too. Glow band faint (outflow carries dye off) — taste-tune at USER-GPU.

- 2026-07-05 · Phase 6 done. dye-readback.js: copy-blit dye→32×18 RGBA8 FBO + readPixels into reusable Uint8Array each frame; per-card cell-box cache in grid coords rebuilt only on scroll/resize/filterBar-click(+450ms FLIP settle); per-card avg → --fluid-tint "R G B" / --fluid-amt, epsilon 0.02 gate, offscreen cards reset to 0. CSS: .card gets --card-line indirection (light/viper border-color overrides converted) + border-color color-mix(var(--card-line), rgb(var(--fluid-tint)) amt*55%) + border-color 0.35s transition; color-mix fallback = plain --card-line border. Verified: harness ?rb=1 logs live tint 255 152 47 / amt 0.305→0.288; index ?perf=1 → 2.3-3.1 ms/frame JS-side, 0 errors. SwiftShader warns GPU-stall-on-ReadPixels (expected); if real-GPU jank shows, read every 2nd frame.

- 2026-07-05 · Phase 7 done. text-layer.js: two cols×rows RGBA NEAREST textures (A: color+charset idx, B: sub-tile origin/size+enable), y-up grid, chars span S×S cells (sub-tile of 9×16 glyph per cell → chunky DOS blowup); TEXT_CHARSET = printable ASCII, idx = charCode-32. asciiArtBg text branch: text cell forces its glyph, dye hue washes color (mix by dens, cap 0.6), non-ink pixels black → solid backing bar = legibility (decision: keep, matches reference). ascii-pass owns text atlas + layer (rebuilt on resize + font-load, onFontReady hook). hero-text.js: #kineticTitle → visibility:hidden (layout/SEO kept), lines parsed by childNode walk (innerText drops <br> on hidden els!), S = fit lineH clamp [2,8] + width fit, MutationObserver mirrors em-word cycler (verified live: boot word swapped by shot time), scroll/resize/font re-snap. Verified: harness dark+light, index viper — 3 themes, 0 errors. 7.3 velocity jitter SKIPPED (wash suffices; revisit at USER-GPU if flat). 7.4 verdict: nav/filter labels stay DOM (interactive pills; hero-only lattice text). Headless index always boots viper (theme.js localStorage default) — dark/light verified via harness only.

- 2026-07-05 · Phase 8 partial. 8.2 half-done: mobile 390×844 headless shot clean (hero fits, word-cycle mirror alive, 0 errors); reduced-motion can't be emulated headless → USER check. 8.4 done: CLAUDE.md index-scripts table + asciibg section, memory updated. Open: 8.1 real-GPU perf (?perf=1 ready), 8.2 reduced-motion, 8.3 dead-file deletion (ask user: wavegrid.js/streaks.js/cardan.js + maybe .blobs CSS overlay), 8.5 acceptance + commit. All Phase 4-7 work uncommitted — suggest commit at next user contact.

- 2026-07-05 · Calm-wind tuning round 1 (USER-GPU feedback: splats too big/bright, field too fast/turbulent, wants laminar right→left flow with open edges, gimbal drowned, fluid "disappears" while scrolling). Changes: (1) divergenceOpen fork in asciibg/shaders.js — stock divergence minus the 4 domain-edge velocity reflections → edges stop being walls, wind carries fluid off-screen left / streams in right; fluid-core now compiles the fork. (2) noiseVelocity gains uWind (uniform accel, dt folded by caller); ambient WIND_X −6/s vs VELOCITY_DISSIPATION 0.40 drag → terminal ≈15 sim-texels/s ≈ 15 s screen crossing. (3) noiseDye gains uDrift — emission pattern translates left at wind speed; GOTCHA: uTime already advances at TIME_SCALE, so DYE_DRIFT must be wind-matched value ÷ TIME_SCALE (0.38 at TIME_SCALE 0.5; at 0.19 dye outran its emission zone and the left half went black). (4) Calm knobs: FORCE 45→4, FORCE_SCALE 2.4→1.5, CURL 12→3, TIME_SCALE 1→0.5, DYE_RATE 0.40→0.06, DYE_SCALE 2→1.6, DENSITY_DISSIPATION 0.90→0.22 (dye must survive the crossing), SPLAT_RADIUS 0.35→0.15, SPLAT_FORCE 6000→2000, mouse ink mul 0.35→0.10 (main+test). (5) Gimbal contrast: dark band alpha 0.12→0.26, viper 0.06→0.18 (band occludes fluid behind rings → silhouette). Scroll-disappear diagnosis: no occluding element found — old field was cursor-fed with ~0.4 s⁻¹ dye half-life, so it visibly emptied whenever the pointer idled (e.g. while wheel-scrolling); steady ambient wind should fix it — USER verify. Headless shots: full-width calm coverage, no left-edge pile-up, hero text legible, gimbal arcs clear, 0 errors ×3 runs.

- 2026-07-05 · Calm tuning round 2 (USER-GPU feedback: still calmer; drop two brightest ramp steps; random strong splat from the top). Top-splat culprit = ring-stir under hover-accel/scroll-kick: marker screen-delta hit the 0.03 cap → 0.03×9000 = 270 velocity jets from the gimbal (top of screen), >10× mouse force. STIR_FORCE 9000→2500, cap 0.03→0.015, STIR_DYE 0.05→0.025 (max jet now ≈ mouse-level 37). Ramp: DEFAULT_RAMP loses '9@' (tops out at '$8'); asciiArtBg neon clamp max 1.0→0.82 (no white-out cores). Calm knobs: FORCE 4→2.5, WIND_X −6→−5, DYE_RATE 0.06→0.045, TIME_SCALE 0.5→0.4, mouse ink 0.10→0.07. DYE_DRIFT 0.38 still matches the slower wind (required 0.39). Headless harness+index shots: dimmer sparser field, no hot cores, gimbal + all text legible, 0 errors.

- 2026-07-05 · Calm tuning round 3 (USER real-GPU shot: still far too busy, gimbal unrecognizable, yellow patches). LESSON: headless SwiftShader under-integrates (8fps → ~7× less emission per wall-second) — real GPU reaches true steady state, so density must be tuned by equilibrium math (core dens ≈ DYE_RATE/DENSITY_DISSIPATION vs FLOOR), not by headless shot brightness. Yellow = stock desaturation tint vec3(1.0,0.92,0.5) in asciiArtBg — removed entirely (gcol = neon). Dim-carpet killed: FLOOR 0.05→0.09 (was rendering ~whole-screen residue). Equilibrium dropped to just above floor: DYE_RATE 0.035, DENSITY_DISSIPATION 0.25 → cores 0.14 vs floor 0.09. Sparser blobs: DYE_THRESH 0.28→0.38. "Viscosity": VELOCITY_DISSIPATION 0.40→0.80 (wind terminal ≈6 texels/s, ~35s crossing, turbulence damps in ~1.2s), FORCE 2.5→1.5, SPLAT_FORCE 2000→1200, DYE_DRIFT 0.38→0.20 (rematched to slower wind). Headless: gimbal arcs+globe clearly recognizable, field sparse, viper all-green. Real-GPU density verdict = USER (may now be too sparse — knobs: DYE_RATE/DYE_THRESH/FLOOR).

- 2026-07-05 · Ambient flow toggle (USER request). #flowToggle button top-left: reuses .theme-toggle chrome + .flow-toggle positional override (48/28/20px breakpoints mirror theme toggle), label Flow/Still, dimmed via [aria-pressed="false"] CSS. State in asciibg/main.js: localStorage 'asciibg-flow' (default on), gates ambient.apply in warmup + tick (mouse/hover/stir still live when off; dye decays out in ~15s). Hidden when background static (no WebGL2, reduced-motion). Added to ui-link hover SELECTOR like #themeToggle. Headless: renders top-left, 0 errors.

- 2026-07-05 · No-inflow rework (USER: keep right→left drift for existing fluid, but nothing visible may enter the screen). Two changes: (1) ambient DYE_RATE → 0.0 (apply() returns before the dye pass when rate ≤ 0; noiseDye/uDrift machinery kept dormant for re-enable) — dye now comes only from interaction (mouse splats, hover glow band, gimbal stir), rides the wind left and exits. (2) advectionVacuum fork in asciibg/shaders.js: back-traced samples outside [0,1]² return 0 instead of the clamped edge texel — kills the clamp-streaming that would otherwise replicate right-edge dye inward forever under the wind; fluid-core compiles the fork (non-MANUAL_FILTERING path only, matching the core). Flow toggle now gates wind+swirl only. Index boots as a clean lattice (gimbal + hero text, no dye). Headless: harness splats smear leftward, right edge stays dark, index clean, 0 errors.

- 2026-07-06 · ASCII engine toggle (USER request). #asciiToggle pill third in top-left stack (top:124px / 108px mobile). Boot loader replaces the static asciibg script tag at bottom of index.html: localStorage 'asciibg-ascii' (default on) → injects asciibg/main.js (module); off → injects classic wavegrid.js + streaks.js + cardan.js (the pre-ASCII background) and hides Flow/Gimbal pills. Flip = reload (engines self-mount, no clean teardown). ?ascii=0|1 URL override for headless verify. Classic mode: hero title stays DOM-visible (hero-text.js never loads), card borders fall back via var() defaults (--fluid-tint 128 128 128, --fluid-amt 0). CLAUDE.md un-retired the three classic scripts. Headless: both modes shot clean, 0 errors (classic = wavegrid dots + cardan rings + DOM title; ascii = lattice + glyph hero).

- 2026-07-06 · Ring-stir disabled (USER: wakes made cardan rings harder to see). main.js tick no longer calls cardan.stir (gimbal draw-only overlay now); stir code kept in cardan-scene.js. Harness default flipped: test.html?stir=1 re-enables (was ?stir=0 to disable). CLAUDE.md boot-param line updated.

- 2026-07-06 · Flow toggle re-scoped (USER: toggle was meant to gate ambient blobs, not the wind). Wind+swirl now always run (velocity pass unconditional in warmup+tick — interaction dye always drifts right→left); pill gates only ambient dye emission via new `ambient.apply(dt, palette, emitDye)` arg (harness omits it → default true, blobs stay on in test.html). Blob emission un-retired: DYE_RATE 0→0.07 — rescaled for params that moved since round-3 tuning (DENSITY_DISSIPATION 0.25→0.5 doubles required rate: equilibrium 0.07/0.5=0.14 vs FLOOR 0.08); DYE_DRIFT 0.20→0.32 rematched to current wind terminal (WIND_X −2 / VEL_DISS 0.2 = 10 texels/s vs round-3's 6.25). Headless: blobs visible, gimbal+hero legible, 0 errors. Real-GPU density verdict = USER (SwiftShader under-integrates — may look denser live; knobs DYE_RATE/DYE_THRESH). Same-day bump (USER: more visible): DYE_RATE 0.07→0.10 (equilibrium 0.20), DYE_THRESH 0.38→0.34. Hover glow cut (USER: card-hover emission way too much): ui-link DYE_RATE 0.22→0.05 (was 2× ambient rate at 0.5 dissipation → equilibrium 0.44); repulsion FORCE untouched. Harness ?hover=1: cavity clean, band faint, 0 errors.

- 2026-07-05 · Gimbal toggle (USER request). #gimbalToggle pill stacked under Flow (top-left, top:76px / 64px mobile), same .theme-toggle chrome; dim-when-off rule generalized to .theme-toggle[aria-pressed="false"]. main.js: localStorage 'asciibg-gimbal' (default on) gates cardan.draw + stir (tick), compositeInto (drawScene), and the boot draw; hidden with Flow pill when static/no-WebGL2. Re-enable mid-session safe: stir teleport guard eats the stale-marker jump. Added to ui-link hover SELECTOR. Headless: both pills render, gimbal on by default, 0 errors.
---

## Known gotchas (from prior work — do not rediscover)

- **SwiftShader ≠ real GPU** for glyph AA: headless screenshots verify presence/
  layout, not glyph crispness. Final quality checks are `USER-GPU`.
- **Web437 exact pixels**: native grid 16, top/left integer alignment, coverage
  threshold for ramp order (memory: ascii-glyph-exact-pixels).
- **Screenshot tooling**: run via PowerShell, not Git Bash (`--path` gets mangled);
  ASCII mode on the demo page needs a keypress — for asciibg make ASCII default-on
  so harness needs no input.
- **Edit tool on this repo**: tabs + CRLF; template-literal lines can't anchor
  `old_string` — use a temp `.mjs` script fallback (CLAUDE.md has the recipe).
- **`fillRect` fade ghosting**: not relevant here (GL pipeline), but don't
  introduce canvas-2D trails anywhere.
- **rtk grep proxy** mangles `{n,m}` quantifiers and some `-E` patterns in Bash —
  use node one-liners for regex extraction.

## Prior analysis: vibe-coded.com mechanism (2026-07-05)

Bundle inspection findings (`assets/index-Ddej7G2h.js`):
- Full GPU fluid: advect/curl/vorticity/divergence/pressure-Jacobi/gradient passes,
  splat velocity+dye passes. Three.js WebGPU + TSL, ascii bloom pass.
- Ambient drifting patches (the slowly moving/merging color blobs): dedicated
  `noiseVelocityPasses` + `noiseDyePasses` gated by `proceduralNoiseForceUniform` /
  `proceduralNoiseDyeUniform` — continuous procedural-noise force + dye injection,
  independent of pointer input. This is what keeps the whole screen alive at idle.
  Replicated in plan step 3.3/3.3b.
- UI text lives in a glyph grid: `cols×rows` Uint8 `glyphData` (glyph index/cell) +
  `colorData` (RGB/cell) → two NearestFilter textures consumed by the ASCII shader.
  DOM is just `#app` + debug pane.
- UI→fluid: `setHoverRepulsionBox({centerX,centerY,width,height}, strength,
  dyeStrength)` → uniforms (`hoverRepulsionCenter/HalfSize/Range/Strength`) into
  dedicated repulsion + dye passes; eased with smoothstep mix; range ≈
  `max(w*0.8, h*5, 0.22)`.
- Fluid→UI: `sampleColor(uv)` — TSL node sampling the dye display texture, used as
  material colorNode (their dice object is tinted by fluid under it).
- Same Web437/oldschool PC font pack we already ship.
