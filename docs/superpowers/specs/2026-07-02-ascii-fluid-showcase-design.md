# ASCII Fluid Showcase — Design

**Date:** 2026-07-02
**Demo:** `FluidSimulation/` ASCII mode
**Goal:** Make ASCII mode the most creative, visually stunning demo a visualization lover could encounter.

## Vision

Two pillars, fully committed:

1. **ASCII transcends itself** — glyphs do things text can't: relief lighting, a lattice that bends like liquid, characters that swim, volumetric depth.
2. **Choreographed elemental scenes** — four tuned compositions (Inferno, Ocean, Galaxy, Matrix storm), each a distinct palette/physics/glyph identity, with cinematic transitions.

Experience target: **attract mode + playground**. Idle → self-running cinematic tour with director cameras. Any input → instant seamless handover to hands-on play.

Performance floor: **desktop dGPU at 60fps with everything on**. Weaker hardware degrades via automatic quality tiers.

## Architecture decision

**Instanced glyph sprite renderer** (Approach A, chosen over uber-fragment-shader and scene-first slices).

Rationale: the current `asciiArt` screen-space fragment shader locks glyphs into cells — per-glyph rotation/scale/drift and lattice warp need glyphs that can cross cell borders. One quad per cell (~4k instances/layer at default cols) makes all four glyph techniques natural in the vertex shader, at negligible cost for the target hardware. The old fragment path stays as a fallback (quality tier 2 / weak GPU).

## Phases

Each phase is independently shippable.

### Phase 1 — Glyph Engine 2.0

Per-frame pipeline (ASCII on):

1. Fluid sim unchanged → `velocity`, `dye`, `obstacle`.
2. **New: `dye2` background layer** — one extra advection pass driven by the same velocity field at ~0.5× scale (parallax feel), lower resolution (512), own dissipation. No second sim.
3. `asciiScene` (1 texel/cell) unchanged; **new `asciiScene2`** for the background layer.
4. **New instanced glyph pass** → renders into the existing `asciiBitmap` FBO:
   - **Background pass:** one quad per cell from `asciiScene2`; 0.7× glyph scale, 0.4× brightness, parallax offset — driven by mouse position during interaction, by camera pan during the tour.
   - **Foreground pass:** full-brightness quads from `asciiScene`.
   - **Vertex shader** (one instance = one cell): instancing via `vertexAttribDivisor` + an `aCell` (col,row) attribute — stays GLSL ES 1.00, avoids the `gl_InstanceID`/ES 3.00 migration. Uses vertex texture fetch (core WebGL2) on velocity/dye/scene textures. Computes per instance:
     - **Glyph index** — density ramp / edge orientation (Sobel) / braille byte, moved from fragment to per-instance.
     - **Lattice warp** — quad center displaced by `velocity × warpAmount` → the grid bends like liquid, glyphs stay intact.
     - **Living glyph** — continuous rotation to flow angle, blended toward upright at low speed (kills rest-jitter); scale pulse from density; sub-cell drift.
     - **Relief normal** — from dye gradient, passed to fragment.
   - **Fragment shader:** atlas sample at rotated local UV; relief lighting = ambient + diffuse + specular from a scene light direction (light can drift over time). Additive blend — overlapping rotated glyphs glow (fits the neon aesthetic).
5. Persistence trail (`asciiFade`) — unchanged, affects both layers.
6. Present stage (`asciiPresent`: zoom/pan, CRT triad reveal, glyph bloom) — unchanged.
7. Advected glyph particles overlay — kept.

HUD additions: toggles/sliders for warp amount, living intensity, relief (light angle + spec), background layer on/off.

### Phase 2 — Scene system

**Data-driven scene defs** — one object per scene, no per-scene shader forks:

```js
{
  name, ramp, glyphSet, glyphMode,
  paletteLUT,        // 256×1 texture: luminance → color (new COLOR_MODE 'lut')
  physics: { curl, densityDiss, velocityDiss, persist, jitter },
  forces:  { buoyancy, gravity, wind: {dir, gustAmp, gustScale}, attractor: {strength, swirl} },
  injectors: [...],  // scripted dye/velocity sources per frame; types:
                     // bottomSplats | waveEmitter | rainColumns | starDots | autoType
  glyphFX: { warp, living, relief: {lightDir, spec}, layerParallax },
}
```

**New GPU pass `sceneForce`:** one parameterized shader applied to velocity each frame. Buoyancy (`vel.y += k·density·dt`), gravity, wind with time-noise gusts, central attractor with tangential swirl term. All params 0 = no-op; every scene is just uniform values.

**Palette LUT:** display shader gains a `lut` color mode sampling a 1D texture. Transitions lerp between two LUTs in-shader — smooth color morphs for free.

**Scenes:**

| Scene | Physics/forces | Look |
|---|---|---|
| **Inferno** | strong buoyancy; hot-splat injectors along bottom edge | fire LUT (black→red→orange→white), high jitter (heat shimmer), ember particles rising, relief light warm from below |
| **Ocean/storm** | slight gravity + horizontal gust wind; sideways wave emitter | ocean LUT (deep blue→cyan→white), braille spray on high-velocity crests, white spray particles, relief light overhead |
| **Galaxy/nebula** | central attractor + swirl | persist 0.96 (long trails), nebula LUT (purple→magenta→gold), star particles, background layer seeded with sparse dim distant-star dots, subtle living glyphs |
| **Matrix storm** | rain-column injectors (narrow downward dye+velocity stripes at random x) | matrix glyph set + green phosphor, periodic auto-typed katakana via existing `glyphDye` (code dissolving into fluid), occasional one-frame row-glitch offset in present stage |

HUD: 4 scene buttons (replace the current 2 preset buttons).

### Phase 3 — Director (attract mode + cameras)

- **Idle detection:** any pointer/key resets timer; ~10s idle → tour starts. First real input → tour stops instantly, current scene keeps running (fluid state never resets).
- **Tour timeline:** each scene runs ~25s via a beats array `[{t, action}]`. Actions: splat patterns, `typeText` injections, light-direction sweeps, camera keyframes.
- **Director cameras:** eased tweens on existing `asciiZoom` / `asciiPanX` / `asciiPanY` — slow push-ins past zoom 4 trigger the CRT triad reveal, drift pans across the flow, pull-back before each transition. Existing pan-clamp logic applies.
- **Scene transitions (~3s):** no dye reset — forces and physics params cross-fade, palette LUTs lerp in-shader, glyph atlas/ramp swap at midpoint under a full-screen dye burst (swap hidden inside the flash).

### Quality tiers

Rolling-fps watchdog (2s window):

- **Tier 0** — everything on.
- **Tier 1** — specular off, present-stage bloom taps halved.
- **Tier 2** — background layer off, living glyphs off (effectively the old pipeline).

Manual override in HUD.

## Error handling

- Instanced path compile/link failure → fall back to the existing fragment-grid path (already present), log to console.
- Vertex texture fetch is core WebGL2; no capability branch needed beyond the existing WebGL2 gate.
- Scene defs validated at load (missing fields → defaults); unknown injector types ignored with a console warn.

## Testing / verification

- Extend `FluidSimulation/asciiTest.html` boot params: `scene=<name>`, `engine2=<0|1>`, `tour=<0|1>` so each scene and engine feature can boot deterministically.
- Verify headlessly with the `verify-ascii-fluid` skill per scene + per glyph technique (screenshot + console-error capture).
- Manual checks: zoom→triad reveal still correct under instanced renderer; persistence trail identical; handover latency (input during tour) imperceptible.

## Out of scope

- Mobile pipeline (tiers degrade, but no dedicated mobile path).
- Full CRT shell expansion (boot sequence, curvature) — existing CRT triad/bloom kept as-is.
- New audio-reactivity features (existing mic FFT hooks remain).
