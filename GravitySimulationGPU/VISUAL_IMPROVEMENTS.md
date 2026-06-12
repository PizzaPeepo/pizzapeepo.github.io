# GravitySimulationGPU — Visual Improvement Ideas

Suggestions for making the GPU galaxy demo visually exceptional, ordered by impact-vs-effort.

> **Status (2026-06-13)**: all 15 items implemented (Tier 1–3 complete; item 7's
> velocity-stretch replaced the need for a separate speed attribute — hue now derives from
> the uploaded velocity vector). Deviations from the spec:
> - Neutral tone mapping instead of ACES (ACES skews the saturated blue ramp toward
>   magenta); chromatic aberration is edge-masked (a full-frame RGB shift dissolves
>   sub-pixel splats into r/g/b triplets).
> - Item 13: dust re-draws the first `count·dustFrac` particles dark (NormalBlending,
>   renderOrder 1) instead of simulating a separate population; disk/spiral presets seed
>   those indices tighter to the midplane. HUD slider 0–30%.
> - Item 14: above ~50k particles the kernel is not pure n² — each particle sums a random
>   strided partner subset per frame (fixed 2.5e9 pair budget, mass-compensated, fresh
>   offset every frame): Monte-Carlo far field instead of workgroup tiling; exact n² below
>   50k. Render meshes are `InstancedBufferGeometry` + plain `Mesh` (no instanceMatrix);
>   `positionNode` reads the storage buffers via `.toAttribute()`. CPU↔GPU toggle in the
>   HUD carries the running state across (upload on enter, readback on leave).
> - Item 15: DOF sits between bloom and CA; focus tracks `camera.position.length()`.
>
> Found & fixed along the way: the original color ramp used TSL's method-form `.mix()`,
> which is `mixElement(t, e1, e2)` — the receiver is the *factor*, not the start color —
> so the ramp was producing garbage colors; it now uses global `mix(a, b, t)`. Also: the
> WebGPU backend re-strides vec3 storage buffers 3→4 floats (16-byte WGSL alignment) at
> buffer creation and flips the attribute's `itemSize` to 4 — `getArrayBufferAsync`
> readback must be indexed with the *current* `itemSize`, while CPU→GPU uploads must stay
> packed at `[3i]` (the backend re-pads from that layout on every update). And: never let
> the kernel step between the position and velocity readbacks (suspend it), or the two
> snapshots come from different times and the phase-space mismatch heats the disk.

**Current state**: gaussian-splat billboards with velocity stretch, speed→hue + density→brightness,
dust-lane second pass, animated core (black-hole mode at high mass), fBM nebula + three twinkling
star shells, post chain afterimage→bloom→DOF→CA→grade/vignette/grain. Compute: Barnes-Hut CPU tree
(≤100k) or TSL GPU kernel (≤1M, HUD toggle).

---

## Tier 1 — Quick wins (parameter/shader tweaks, hours not days)

### 1. HDR tone mapping + stronger bloom
**Look**: filmic glow — the dense core blooms into a hot white-gold center with smooth rolloff
instead of clipping flat.
**Why**: with additive blending at 100k particles, overlapping splats saturate to pure white and
detail dies. ACES tone mapping compresses the highlights so the core reads as "blindingly bright"
while keeping color in the midtones. The current bloom strength of 0.15 is barely visible.
**How**: set `renderer.toneMapping = THREE.ACESFilmicToneMapping` in `init()`; raise bloom
strength to ~0.6–1.0 and radius to ~0.3–0.5, keep threshold near 0.4 so only the hot core and
fast particles bloom. Expose strength on the existing Bloom button as a cycle (Off / Low / High).
**Effort**: tiny.

### 2. Soft gaussian splats instead of hard spheres
**Look**: gas-cloud/nebula rendering — particles melt into each other instead of reading as
distinct balls.
**Why**: icosahedron instances have a hard silhouette; real astrophotography is all soft point
spread functions. The demo already builds exactly the needed radial gradient on a 2D canvas in
`makeDotTexture()` for the starfield — the main particles deserve the same treatment.
**How**: swap `IcosahedronGeometry` for a `PlaneGeometry(2, 2)` billboard. In `positionNode`,
orient the quad to the camera (build from `cameraViewMatrix` basis vectors or use TSL `billboarding`).
In `colorNode`/`opacityNode`, compute `exp(-r²·k)` falloff from the quad UV. Bonus: this renders
2 triangles per particle instead of 20, so 100k gets cheaper.
**Effort**: small.

### 3. Per-particle size and color variation
**Look**: a believable star field — a handful of bright giants, a sea of dim dwarfs, subtle hue
scatter instead of a uniform color ramp.
**Why**: identical-size identical-ramp dots are the single biggest "programmer art" tell. Real
luminosity functions are heavy-tailed.
**How**: add one static `InstancedBufferAttribute` (vec2: sizeScale, hueJitter) filled once at
init — log-normal size (`Math.exp(gauss() * 0.5)`, clamp ~0.4–4×; the `gauss()` helper already
exists) and ±0.05 hue jitter mixed into the ramp in `colorNode`. No per-frame upload cost.
**Effort**: small.

### 4. Brightness from local density
**Look**: the core and spiral-arm clumps glow hot; sparse halo particles stay faint. Structure
becomes self-illustrating.
**Why**: speed already drives hue, but brightness is flat — density is the missing visual channel
and it's what makes galaxy renders (e.g. real SPH visualizations) look deep.
**How**: cheap approximation with data already in hand — during the force walk in `step()`, the
leaf node a particle sits in is known to the tree at insert time; alternatively accumulate
`Σ m/r²·soft` magnitude (already computed as `ax,ay,az` precursors) as a density proxy. Stream it
in place of (or packed with) `instSpeed`, map to brightness with a `pow(d, 0.5)`-ish curve in
`colorNode`. Combine: density → brightness, speed → hue.
**Effort**: small–medium.

### 5. Twinkling, parallax starfield
**Look**: living background — faint scintillation and depth parallax when orbiting the camera.
**Why**: the two current shells are static; any camera move reveals them as flat wallpaper.
**How**: give `createStarField`/`createBackdrop` materials a node-based opacity:
`0.6 + 0.4·sin(time·rate + phase)` with per-star random phase (extra buffer attribute, TSL `time`).
Add one more shell at r ≈ 1200 with ~300 brighter stars so three depth layers parallax against
each other.
**Effort**: small.

---

## Tier 2 — Medium effort, big payoff

### 6. Motion trails (temporal accumulation / afterimage)
**Look**: every particle drags a fading streak; orbits become visible arcs and the whole disk
turns into flowing filaments. **This is the single biggest "stunning" multiplier for an orbital
sim.**
**Why**: trails encode the velocity field over time — the physics becomes the art.
**How**: add an accumulation pass to the `PostProcessing` chain: keep a previous-frame render
target, output `currentFrame + prevFrame·fade` (fade ≈ 0.85–0.95), feed that to bloom. With
float16/float32 HDR targets the 8-bit rounding ghost-floor problem documented in
`Utils/FadeTrail.js` doesn't apply — trails decay to true zero. Wire fade to a HUD slider
(0 = off). Beware: trails + OrbitControls camera motion smears the background too; either accept
it (looks like a long exposure) or accumulate in a scene-stable pass before compositing the
starfield.
**Effort**: medium.

### 7. Velocity-stretched billboards (long-exposure streaks)
**Look**: fast particles elongate along their direction of motion, like star trails in a
long-exposure photograph; slow ones stay round.
**Why**: communicates speed and direction per particle without any temporal state, and pairs
beautifully with (or substitutes for) item 6.
**How**: upload velocity as a vec3 instanced attribute (extend the existing `instSpeed` upload in
`uploadInstances()` — the data is already in `vx/vy/vz`). In `positionNode`, project velocity to
view space and stretch the billboard quad along it: `pos + vDir·(uv.x·stretch·speed)`. Clamp
stretch so the core doesn't turn to noodles.
**Effort**: medium.

### 8. Accretion-core upgrade
**Look**: instead of two static glowing balls — a slowly rotating accretion glow with a pulsing
halo, and at high core mass a cheap "black hole": dark disc with a hot photon ring.
**Why**: the core is the visual anchor of the scene and currently the least interesting object
in it.
**How** (in `createCore()`):
- inner sphere → noise-modulated emissive (`colorNode` with TSL noise/`time` rotation),
- halo sphere → opacity pulse `0.10 + 0.04·sin(time·0.7)`,
- "photon ring" mode when `coreMass` crosses a threshold: small black sphere
  (`depthWrite: true`, plain black) + additive torus/ring sprite just outside it,
- optional camera-facing lens-flare sprite (the `makeDotTexture()` gradient reused at large
  scale, very low opacity).
**Effort**: medium.

### 9. Procedural nebula backdrop
**Look**: faint FBM nebula wisps in deep blues and rust tones behind the starfield, with a
vignette pulling the eye to center — replaces the flat near-black background.
**Why**: flat `#0c0908` reads as "unfinished"; even a barely-visible nebula adds enormous
perceived production value.
**How**: large inward-facing `SphereGeometry` (r ≈ 11000, inside the 12000 frustum) with a
`MeshBasicNodeMaterial` whose `colorNode` is 3–4 octaves of TSL noise (`mx_noise_float` /
`mx_fractal_noise_float` ship with three's TSL) mixed between two theme colors, multiplied way
down (0.03–0.08 luminance) so stars still dominate. Keep it below the bloom threshold.
(`Utils/simplexNoise.js` exists in the repo for reference, but do the noise in TSL — CPU-baking a
texture is the fallback.)
**Effort**: medium.

### 10. Cinematic camera
**Look**: the scene presents itself — slow idle orbit, smooth eased fly-ins when switching
presets, a kick of shake plus an expanding shockwave ring on Burst.
**Why**: motion design sells the simulation even when the user doesn't touch anything; instant
teleports on Reset feel cheap.
**How**:
- `controls.autoRotate = true; controls.autoRotateSpeed = 0.3`, disabled for ~5s after any
  pointer interaction (timestamp check in `animate()`),
- preset switch: tween `camera.position` toward a per-preset framing over ~1.2s with smoothstep
  easing (tiny inline lerp in `animate()`, no library needed),
- Burst: 0.3s decaying random camera offset + an additive `RingGeometry` that scales from the
  core to ~2·DISK_R while fading out.
**Effort**: medium.

### 11. Spiral-arm seeding
**Look**: the disk preset starts as a grand-design two-arm spiral instead of an axisymmetric
blob — instantly recognizable as "a galaxy" the moment the page loads.
**Why**: the first 5 seconds decide whether the demo impresses; self-gravity does form structure,
but slowly and never this photogenic.
**How**: in `initDisk()`, after drawing `(gx, gy)`, perturb the azimuth toward a logarithmic
spiral: `angle += A·cos(2·angle − ln(r/r0)/tanPitch)` (m = 2 arms, pitch ≈ 15–25°), or
accept/reject samples against the same density wave. Keep current velocity setup — orbital
shear will wind and evolve the arms naturally. Add it as a fifth preset button ("Spiral") so the
plain disk remains.
**Effort**: medium (math is fiddly, code is short).

### 12. Post-processing polish stack
**Look**: subtle vignette, fine film grain, a hint of chromatic aberration at the frame edges,
and a teal-orange grade — the "shot on a camera" feel.
**Why**: these three together are the cheapest path from "tech demo" to "title screen".
**How**: three's TSL display nodes compose directly into the existing `postProcessing.outputNode`
chain: vignette via screen-UV radial darkening, `filmGrain`/hash noise scaled to ~0.03,
chromatic aberration by sampling the scene texture at 3 slightly scaled UVs. Add after bloom.
Keep all effects at "barely perceptible" strength.
**Effort**: small–medium (each effect is a few TSL lines; tuning is the work).

---

## Tier 3 — Ambitious

### 13. Dust-lane second population
**Look**: dark dust filaments silhouetted against the bright stellar disk — the signature look of
real edge-on galaxies (and of high-end N-body renders).
**Why**: additive-only scenes have no darkness; occluding dust adds contrast and realism nothing
else can.
**How**: second `InstancedMesh` (~10–20% of count) sharing the same physics arrays but rendered
with `NormalBlending`, near-black color, ~0.3 opacity, drawn after the additive pass
(`renderOrder`). Sorting artifacts are mostly hidden by low opacity; seed them slightly tighter
to the midplane in `initDisk()` so they read as lanes.
**Effort**: medium–large (blending/draw-order tuning).

### 14. GPU compute forces → 1M particles
**Look**: a million-particle galaxy. Sheer count is itself the wow factor — filaments, shells and
arms resolve that 100k physically cannot show.
**Why**: the demo is named "GPU" but integrates on the CPU; the CPU tree walk is the hard cap.
A tiled brute-force O(n²) WebGPU compute pass outruns the CPU's O(n log n) at these counts, and
positions never leave the GPU (no per-frame upload either — `uploadInstances()` disappears).
**How**: TSL compute — `instancedArray(MAX, 'vec3')` storage buffers for position/velocity, a
`Fn().compute(MAX)` kernel doing the kick-drift step (workgroup-tiled n² force sum, same
softening + central core term as `step()`), `positionNode` reads the storage buffer directly.
three.js ships almost exactly this as the `webgpu_compute_particles` /
`compute_attractors_particles` examples — crib the structure. Keep the CPU path as fallback for
counts ≤ 10k or as an A/B toggle. Octree/`step()` stay untouched for the CPU path.
**Effort**: large (restructures the sim loop), highest ceiling of any item here.

### 15. Depth of field
**Look**: core in crisp focus, near/far particles and the starfield melting into bokeh — instant
macro-photography depth.
**Why**: DOF is the strongest single cue that a 3D scene has physical scale.
**How**: three's TSL `dof` / gaussian-blur display nodes after bloom in the `PostProcessing`
chain, focus distance driven by `camera.position.length()` so the core stays sharp while
orbiting. Needs the depth texture from `scenePass` (`scenePass.getTextureNode('depth')`).
Toggleable — DOF + trails together can get mushy.
**Effort**: medium–large (tuning against bloom/trails interplay).

---

## Suggested order of attack

1 → 2 → 3 (one afternoon, transforms the base look) → 6 (trails, the headline feature) →
11 + 10 (great first impression) → 8 + 9 + 12 (set dressing) → 14 (the flagship rewrite).
