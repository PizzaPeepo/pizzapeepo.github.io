# Sparkle Particles (ride streamlines) — Design

**Date:** 2026-07-03
**Demo:** FluidSimulation (ASCII mode overlay)

## Goal

Replace the "Glyph particles (ride streamlines)" overlay with twinkling star
sparkles. The user dislikes glyphs following streamlines; light glints riding
the flow should look better. Glyph rendering is removed, not kept as an option.

## What stays the same

- Particle system: 6400 advected particles (80×80 position texture),
  `particleUpdate` shader, life/respawn cycle, additive blend overlay drawn
  after the ASCII present pass.
- Toggle plumbing: `config.ASCII_PARTICLES`, `particlesToggle` checkbox,
  `?particles=1` query param.

## What changes

### 1. `FluidSimulation/asciiShaders.js`

**`particleVertex`** — add `varying float vLife` carrying `p.z` so the
fragment shader can fade particles in/out at spawn/death (glyphs popped).

**`particleRender`** — full rewrite. Drop `uGlyphs`/`uGlyphCount` atlas
sampling; procedural star instead:

- **Shape:** soft radial core + 4 thin cross arms (axis-aligned). Arm length
  scales with the twinkle value.
- **Twinkle:** per-particle phase and speed derived from `vSeed`, driven by a
  new `uTime` uniform. Sharpened with `pow` so flares are brief bright peaks —
  the field shimmers unevenly rather than pulsing in unison.
- **Color:** base tint from dye sampled under the particle (as before); core
  mixes toward white as the flare peaks — reads as a light glint while still
  matching the sim palette.
- **Fade:** intensity scaled by a smooth ramp on `vLife` near 0 (death) and
  near its spawn value (birth).

### 2. `FluidSimulation/main.js`

`renderParticles()` — remove atlas/glyph-count uniform binds, bind `uTime`.
Dye bind stays.

### 3. Labels/comments

- `FluidSimulation.html` checkbox label → "Sparkles (ride streamlines)".
- `config.js` `ASCII_PARTICLES` comment updated to say sparkles.

## Not doing

- No new HUD controls, files, or config keys.
- No `particleUpdate` changes.
- No atlas-baked sparkle frames (rejected: rasterized, no smooth pulse).

## Verification

`verify-ascii-fluid` skill screenshot with `?particles=1`; confirm sparkles
visible over ASCII field, no console errors, and non-ASCII mode unaffected.
