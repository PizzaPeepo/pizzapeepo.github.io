# GravitySimulationGPU — Visual Improvement Ideas

Suggestions for making the GPU galaxy demo visually exceptional, ordered by impact-vs-effort.

## Suggested order of attack

1 → 2 → 3 (one afternoon, transforms the base look) → 6 (trails, the headline feature) →
11 + 10 (great first impression) → 8 + 9 + 12 (set dressing) → 14 (the flagship rewrite).

---

# Round 2 — physics & scene ideas (2026-07-03)

Items 1–15 above are done. This round: new physics knobs, new presets, and the
black-hole lensing centerpiece.

> **Status (2026-07-03)**: all round-2 items implemented (R2-1 … R2-7), verified
> headless on both compute paths. Deviations from the spec:
> - R2-2: impact parameter + inclinations hardcoded; HUD exposes clash mass ratio +
>   retrograde toggle. Galaxy ID lives in `instVar.z` (attribute, not instanceIndex
>   split) so dust slots can hold both galaxies.
> - R2-3: no `coreMass` growth from accretion (respawn only — atomic counter +
>   readback if the feedback loop is ever wanted); the optional background-star
>   screen-space warp was skipped. TDE preset reuses the BH knob set.
> - R2-4: bar-strength knob deferred, as planned. Dark-matter halo is centered on
>   the origin (not per-galaxy), so it's meaningful for single-galaxy presets.
> - Cores feel core↔core gravity only (no dynamical friction); the drag knob stands
>   in for it when sinking mergers are wanted.

## R2-1. Movable cores (keystone enabler)

The sim has one fixed core at the origin. `initGalaxyCollision` fakes two galaxies:
disks get orbital velocities around their own centers but no local core force exists,
so they shear apart. Promote the core to an array of ≤4 massive bodies integrated like
particles (CPU: trivial; GPU: small uniform vec4 array `[x,y,z,mass]`, short loop in
the kernel). Unlocks R2-2, R2-6, R2-7, binary BHs, satellite streams.
**Effort**: medium.

## R2-2. Two spiral galaxies clashing

`initSpiral` seeding × 2 with per-galaxy movable cores. Params: mass ratio, impact
parameter, inclination, prograde/retrograde (prograde throws huge tidal tails,
retrograde barely disturbs — great A/B). Self-gravity already produces tidal tails +
bridge → Antennae Galaxies look. Cores sink via drag → merger remnant.
**Effort**: medium (after R2-1). **Best payoff-per-effort scene.**

## R2-3. Black-hole accretion disk with per-particle gravitational lensing (Route B)

**Look**: the NASA/Interstellar shot — thin hot disk, far side bent into an arc above
and below the shadow, photon ring, Doppler-bright approaching side. Interactive: the
NASA gif is precomputed, this one orbits with the mouse.

**How**: BH = point lens, analytic lens equation per particle in view space:
- β = angular offset of particle from the BH direction as seen from the camera
- image angles: θ± = (β ± √(β² + 4·θ_E²)) / 2, Einstein angle θ_E from r_s and the
  camera–lens–source distances
- **primary image** (θ₊): displace the splat outward — far-side disk arcs over the
  top of the shadow
- **secondary image** (θ₋): second draw of the same instanced geometry, flipped,
  inside the Einstein ring — the lower/inner arc
- capture: hide particles whose impact parameter < ~2.6 r_s (light falls in)
- magnification is analytic → brightness boost near the ring for free

Fits the pipeline: `positionNode` is already the entire placement path, splats are
camera-facing, BH sits at the origin. Lens math goes in `makeSplatMaterial` (~30 lines
TSL); the secondary image is one extra mesh reusing the same buffers.

Scene half: tight thin-annulus seeding (r ∈ [r_isco, 0.3·DISK_R]), gas drag → slow
inflow, temperature color ramp (white-blue inner → orange → deep red outer), Doppler
beaming via `dot(v̂, toCam)` → brightness, existing photon-ring/shadow visuals scaled
by coreMass. Optional cheap add-on: screen-space radial UV warp post pass around the
BH for background-star lensing (can't produce the disk arc — pixels-only — but sells
the distortion).
**Effort**: medium-large. Tuning the look is the work.

## R2-4. Physics knobs (each tiny–small)

| Knob | Effect |
|------|--------|
| Dark-matter halo (0–1) | analytic isothermal/NFW term → flat rotation curve; arms wind differently. One line in both force paths |
| Gas drag (0–0.05) | `v *= 1 − drag·dt`; particles spiral inward, accretion becomes real, disk settles thin |
| Disk temperature (Toomre Q) | cold disk fragments into clumps, hot disk stays smooth; scales existing jitter in `placeDiskParticle` |
| Arm count + pitch angle | `initSpiral` hardcodes m=2, 20°; slider m=1–4, pitch 5–35° → flocculent vs grand-design |
| BH accretion radius | particle inside r_acc dies (respawn at edge), mass feeds coreMass → BH grows, photon ring scales. Feedback loop |
| Bar strength | rotating quadrupole potential → drives real spiral structure, barred-galaxy look |
| Color mode selector | speed (current) / radial Doppler / density / galaxy-ID (index < half → ramp A else B) / temperature-by-radius |

## R2-5. Cheap presets (seeding only, after the knobs)

- **Tidal disruption event**: compact Plummer blob on a plunging orbit past the BH →
  spaghettification stream, half bound half ejected.
- **Globular cluster**: Plummer sphere, coreMass = 0, pure self-gravity → core collapse.
- **Cosmic web**: near-uniform box, tiny perturbations, no core → filaments + halos.
  The only preset that structurally shows off the 1M GPU ceiling.

## R2-6. Satellite shredding / stellar stream

Dwarf galaxy on a decaying orbit around the big disk → tidal stream wraps like the
Sagittarius stream. Needs R2-1 + drag.

## R2-7. Binary BH + circumbinary disk

Two cores orbiting each other inside the gap they carve, streamers across the gap.
Needs R2-1.

## Round 3 — ASCII mode + low-end performance (2026-07-03, implemented)

- **ASCII mode** (HUD toggle, `?ascii=1`): screen-space post pass at the very end of
  `buildPost()` — the finished graded frame goes through one extra `rtt`, gets sampled
  at 8×16-px cell centers, cell luminance picks a glyph from a ` .:-=+*#%@` canvas
  atlas, glyph mask × cell color. Works with every preset/effect since it eats the
  final frame (bloom before ASCII = phosphor glow).
- **Perf knobs for low-end GPUs** (target: RTX A1000 class):
  - GPU pair budget slider (10^8–10^9.7 pairs/frame; was a hardcoded 2.5e9),
  - internal resolution scale 40–100% (post chain cost scales quadratically),
  - Quality Full/Fast button — Fast skips DOF and the chromatic-aberration `rtt`,
  - dust + secondary-lens passes auto-hide above 300k particles (`EXTRA_MESH_CAP`).
- Deferred: workgroup-tiled n² kernel (needs TSL `workgroupArray` support check) and
  the uniform-grid far-field (O(n·k), the real 1M+-on-low-end ceiling raise).

## Round-2 order of attack

R2-1 (enabler) → R2-2 (spiral clash + galaxy-ID colors + retrograde toggle) →
R2-3 (lensed accretion disk, the crown jewel) → R2-4 knobs → R2-5/6/7 presets.
