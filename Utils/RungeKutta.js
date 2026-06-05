import Vector2D from "./Vector2D.js";
import Particle from "../GravitySimulation/particle.js";

export function RK4_1D(y, t, dt, diffEq) {
	let k1 = dt * diffEq(t, y);
	let k2 = dt * diffEq(t + 0.5 * dt, y + 0.5 * k1);
	let k3 = dt * diffEq(t + 0.5 * dt, y + 0.5 * k2);
	let k4 = dt * diffEq(t + dt, y + k3);
	return y + (k1 + 2 * k2 + 2 * k3 + k4) / 6.0;
}

export function RK4_2D(r, t, dt, diffEq) {
	let resultVec = new Vector2D(0, 0);

	let k1x = dt * diffEq(t, r.x);
	let k2x = dt * diffEq(t + 0.5 * dt, r.x + 0.5 * k1x);
	let k3x = dt * diffEq(t + 0.5 * dt, r.x + 0.5 * k2x);
	let k4x = dt * diffEq(t + dt, r.x + k3x);
	resultVec.x = r.x + (k1x + 2 * k2x + 2 * k3x + k4x) / 6.0;

	let k1y = dt * diffEq(t, r.y);
	let k2y = dt * diffEq(t + 0.5 * dt, r.y + 0.5 * k1y);
	let k3y = dt * diffEq(t + 0.5 * dt, r.y + 0.5 * k2y);
	let k4y = dt * diffEq(t + dt, r.x + k3y);
	resultVec.y = r.y + (k1y + 2 * k2y + 2 * k3y + k4y) / 6.0;

	return resultVec;
}

const GRAVITY_SOFTENING_SQ = 25; // 5px Plummer softening — prevents force singularity at close range

// Zero-allocation variant: writes [ax, ay, ax, ay, ...] directly into a pre-allocated Float64Array.
// buf must have length >= particles.length * 2.
export function computeAllAccelerationsInto(particles, gravConst, buf) {
	const n = particles.length;
	for (let i = 0; i < n; i++) {
		const tp = particles[i];
		const tpx = tp.position.x, tpy = tp.position.y;
		let ax = 0, ay = 0;
		for (let j = 0; j < n; j++) {
			if (j !== i) {
				const dx = particles[j].position.x - tpx;
				const dy = particles[j].position.y - tpy;
				const r2 = dx * dx + dy * dy + GRAVITY_SOFTENING_SQ;
				const r3 = r2 * Math.sqrt(r2);
				ax += particles[j].mass * dx / r3;
				ay += particles[j].mass * dy / r3;
			}
		}
		buf[2 * i]     = gravConst * ax;
		buf[2 * i + 1] = gravConst * ay;
	}
}

// Barnes-Hut variant: uses a pre-built BH tree for O(n log n) force approximation.
// Tree is built from k1 positions; k2/k3/k4 substeps query it from updated positions while
// excluding the original particle object to prevent self-force.
export function RK4_ParticlesInGravField_BH(targetParticleIndex, particles, dt, gravConst, bhTree) {
	const initial = particles[targetParticleIndex].DeepCopy();
	const originalParticle = particles[targetParticleIndex];

	function accel(px, py) {
		return bhTree.computeAccelAt(px, py, originalParticle, gravConst);
	}

	const [ax1, ay1] = accel(initial.position.x, initial.position.y);
	const vx1 = initial.velocity.x, vy1 = initial.velocity.y;

	const x2  = initial.position.x + 0.5 * vx1 * dt;
	const y2  = initial.position.y + 0.5 * vy1 * dt;
	const vx2 = initial.velocity.x + 0.5 * ax1 * dt;
	const vy2 = initial.velocity.y + 0.5 * ay1 * dt;
	const [ax2, ay2] = accel(x2, y2);

	const x3  = initial.position.x + 0.5 * vx2 * dt;
	const y3  = initial.position.y + 0.5 * vy2 * dt;
	const vx3 = initial.velocity.x + 0.5 * ax2 * dt;
	const vy3 = initial.velocity.y + 0.5 * ay2 * dt;
	const [ax3, ay3] = accel(x3, y3);

	const x4  = initial.position.x + vx3 * dt;
	const y4  = initial.position.y + vy3 * dt;
	const vx4 = initial.velocity.x + ax3 * dt;
	const vy4 = initial.velocity.y + ay3 * dt;
	const [ax4, ay4] = accel(x4, y4);

	const xf  = initial.position.x + (dt / 6) * (vx1 + 2*vx2 + 2*vx3 + vx4);
	const yf  = initial.position.y + (dt / 6) * (vy1 + 2*vy2 + 2*vy3 + vy4);
	const vxf = initial.velocity.x + (dt / 6) * (ax1 + 2*ax2 + 2*ax3 + ax4);
	const vyf = initial.velocity.y + (dt / 6) * (ay1 + 2*ay2 + 2*ay3 + ay4);
	const axf = (1 / 6) * (ax1 + 2*ax2 + 2*ax3 + ax4);
	const ayf = (1 / 6) * (ay1 + 2*ay2 + 2*ay3 + ay4);

	return new Particle(
		new Vector2D(xf, yf),
		new Vector2D(vxf, vyf),
		new Vector2D(axf, ayf),
		initial.radius,
		initial.mass
	);
}
