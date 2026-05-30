## Cheap visual wins (biggest bang)

1. Additive glow bloom — space sims live/die on this. Particles currently flat 2px dots + flat circles. Switch fgCtx to globalCompositeOperation = 'lighter' while drawing particles (main.js:1076-1098). Overlapping particles add light → hot white cores, colored halos, dense clusters glow. ~3 lines. Pair with cached radial-gradient sprite per particle instead of solid arc for real bloom.

2. Comet streaks — fast particles draw as line along velocity vector, not circle. In Particle.Draw (particle.js:75) draw moveTo(pos - vel*k) → lineTo(pos). Instantly reads as "speed." Length ∝ speed.

3. Sun corona — flat yellow disc → radial gradient (white core → orange → transparent) + pulsing glow. main.js:1096.

4. Blackbody temperature palette — already interpolate palette by speed (1066-1069). Add physical color preset: slow=deep red → white → blue-hot. Looks like real stars/plasma.

5. Starfield backdrop — static twinkle layer. Caveat: bg canvas gets fade-stamped every frame (1061), so stars need own layer or re-stamp. Minor.

## Simulation features (high wow)

6. Accretion / merge-on-collision — toggle: instead of bounce, overlapping particles MERGE. Conserve momentum p=m₁v₁+m₂v₂, m=m₁+m₂, r=cbrt(r₁³+r₂³), drop smaller. Emergent planet/galaxy formation from dust cloud. Hooks into collision phase (main.js:939-959). Mesmerizing.

7. Black hole mode — sun swallows anything inside radius: remove particle, add its mass to sun, sun grows. Watch it eat the cloud. Cheap, dramatic.

8. Supernova button — radial velocity impulse to all particles from a point. One button, huge payoff.

9. Time reversal — your integrator is symplectic + reversible. Flip all velocities + dt sign → sim runs backward, particles rety free.
                                                                    10. Pause / step — stop flag exipause + single-step button.
                                                                    
## Interaction
                                                                    
11. Scroll-zoom + pan camera — cte. Lets you build a galaxy thendive in. Medium effort, transforms mouse coords too.           

12. Force brush — hold key + hover = mouse becomes gravity well (attract) or repulsor. Left-drag already spawns; add moround like sand.

13. Trajectory preview on drag —7-1133 draws arrow), alsoforward-simulate N steps and draw predicted orbit ghost. Aim slingshots precisely.

14. Collision sparks — high-speed resolveCollision (main.js:883) stamps bright flash on bg. Impacts feel physical.

## Scenarios (preset button row)

15. One-click setups — Solar sysollision (two spinning discsaimed at each other) / Ring / Cold cloud collapse. Just parameter bundles + special init in GenerateRandomizedParticles (mai

---
Top 5 I'd build first: glow (1) + comet streaks (2) + merge mode (6) + supernova (8) +
galaxy-collision preset (15). Tomo, ~1 evening.
