import Particle from "./particle.js";
import Vector2D from "../Utils/Vector2D.js";
import * as helpers from "../Utils/helpers.js";

// Random-particle construction for the GravitySimulation demo. Kept out of the Particle class
// so Particle stays a plain physics body with no spawn / distribution policy baked in.

// Give up trying to place a non-overlapping particle after this many overlapping attempts.
const MAX_PLACEMENT_ATTEMPTS = 150000;

// Position, velocity, radius and mass are each drawn from a gaussian over [min, max].
export function GenerateRandomParticle(
	xmin, xmax, ymin, ymax,
	vxMin, vxMax, vyMin, vyMax,
	radiusMin, radiusMax, massMin, massMax
) {
	return new Particle(
		new Vector2D(
			helpers.GetRandomGaussianNormal_BoxMuller(xmin, xmax, 1),
			helpers.GetRandomGaussianNormal_BoxMuller(ymin, ymax, 1)
		),
		new Vector2D(
			helpers.GetRandomGaussianNormal_BoxMuller(vxMin, vxMax, 1),
			helpers.GetRandomGaussianNormal_BoxMuller(vyMin, vyMax, 1)
		),
		new Vector2D(0, 0),
		helpers.GetRandomGaussianNormal_BoxMuller(radiusMin, radiusMax, 1),
		helpers.GetRandomGaussianNormal_BoxMuller(massMin, massMax, 1)
	);
}

// Returns particleList plus count new non-overlapping random particles.
export function AddNRandomParticles(
	particleList,
	count,
	xmin, xmax, ymin, ymax,
	vxMin, vxMax, vyMin, vyMax,
	radiusMin, radiusMax, massMin, massMax
) {
	const particles = particleList.slice();
	let placed = 0;
	let overlappingCounter = 0;
	while (placed < count) {
		const particle = GenerateRandomParticle(
			xmin, xmax, ymin, ymax,
			vxMin, vxMax, vyMin, vyMax,
			radiusMin, radiusMax, massMin, massMax
		);
		let twoParticlesOverlap = false;
		for (let j = 0; j < particles.length; j++) {
			if (particle.Overlaps(particles[j])) {
				twoParticlesOverlap = true;
				overlappingCounter++;
				break;
			}
		}
		if (overlappingCounter > MAX_PLACEMENT_ATTEMPTS) {
			alert("The radius min/max are probably too large and/or the x/y ranges are too small.");
			break;
		}
		if (!twoParticlesOverlap) {
			particles.push(particle);
			placed++;
		}
	}
	return particles;
}
