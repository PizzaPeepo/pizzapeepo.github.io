// A double pendulum integrated with classic RK4 over the 4-D state
// [theta1, omega1, theta2, omega2]. Chaotic: tiny changes in initial angle
// diverge exponentially, which is what makes overlaid copies fan out.
// Shared RK4 scratch buffers — step() runs synchronously per instance, so
// module-level reuse is safe and keeps the hot path allocation-free.
const K1 = new Float64Array(4), K2 = new Float64Array(4), K3 = new Float64Array(4), K4 = new Float64Array(4);

export default class DoublePendulum {
	constructor(opts = {}) {
		this.L1 = opts.L1 ?? 1;
		this.L2 = opts.L2 ?? 1;
		this.m1 = opts.m1 ?? 1;
		this.m2 = opts.m2 ?? 1;
		this.theta1 = opts.theta1 ?? Math.PI / 2;
		this.theta2 = opts.theta2 ?? Math.PI / 2;
		this.omega1 = 0;
		this.omega2 = 0;
		this.hue = opts.hue ?? 45;
	}

	// Writes the 4 derivatives for the given state into out[], applying linear damping.
	_derivs(a1, w1, a2, w2, g, damping, out) {
		const m1 = this.m1, m2 = this.m2, L1 = this.L1, L2 = this.L2;
		const delta = a1 - a2;
		const cosD = Math.cos(delta);
		const sinD = Math.sin(delta);
		const den = 2 * m1 + m2 - m2 * Math.cos(2 * a1 - 2 * a2);

		const dw1 =
			(-g * (2 * m1 + m2) * Math.sin(a1)
				- m2 * g * Math.sin(a1 - 2 * a2)
				- 2 * sinD * m2 * (w2 * w2 * L2 + w1 * w1 * L1 * cosD))
			/ (L1 * den) - damping * w1;

		const dw2 =
			(2 * sinD * (w1 * w1 * L1 * (m1 + m2)
				+ g * (m1 + m2) * Math.cos(a1)
				+ w2 * w2 * L2 * m2 * cosD))
			/ (L2 * den) - damping * w2;

		out[0] = w1; out[1] = dw1; out[2] = w2; out[3] = dw2;
	}

	step(dt, g, damping) {
		const a1 = this.theta1, w1 = this.omega1, a2 = this.theta2, w2 = this.omega2;
		const h = dt * 0.5;

		this._derivs(a1, w1, a2, w2, g, damping, K1);
		this._derivs(a1 + K1[0] * h, w1 + K1[1] * h, a2 + K1[2] * h, w2 + K1[3] * h, g, damping, K2);
		this._derivs(a1 + K2[0] * h, w1 + K2[1] * h, a2 + K2[2] * h, w2 + K2[3] * h, g, damping, K3);
		this._derivs(a1 + K3[0] * dt, w1 + K3[1] * dt, a2 + K3[2] * dt, w2 + K3[3] * dt, g, damping, K4);

		const s = dt / 6;
		this.theta1 = a1 + s * (K1[0] + 2 * K2[0] + 2 * K3[0] + K4[0]);
		this.omega1 = w1 + s * (K1[1] + 2 * K2[1] + 2 * K3[1] + K4[1]);
		this.theta2 = a2 + s * (K1[2] + 2 * K2[2] + 2 * K3[2] + K4[2]);
		this.omega2 = w2 + s * (K1[3] + 2 * K2[3] + 2 * K3[3] + K4[3]);
	}

	// Pixel positions of both bobs given a pivot and a length scale (px per unit).
	positions(pivotX, pivotY, scale) {
		const x1 = pivotX + this.L1 * scale * Math.sin(this.theta1);
		const y1 = pivotY + this.L1 * scale * Math.cos(this.theta1);
		const x2 = x1 + this.L2 * scale * Math.sin(this.theta2);
		const y2 = y1 + this.L2 * scale * Math.cos(this.theta2);
		return { x1, y1, x2, y2 };
	}
}
