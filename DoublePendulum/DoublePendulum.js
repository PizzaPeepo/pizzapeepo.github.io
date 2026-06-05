// A double pendulum integrated with classic RK4 over the 4-D state
// [theta1, omega1, theta2, omega2]. Chaotic: tiny changes in initial angle
// diverge exponentially, which is what makes overlaid copies fan out.
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

	// Returns the 4 derivatives for a given state, applying linear damping.
	_derivs(s, g, damping) {
		const [a1, w1, a2, w2] = s;
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

		return [w1, dw1, w2, dw2];
	}

	step(dt, g, damping) {
		const s0 = [this.theta1, this.omega1, this.theta2, this.omega2];

		const k1 = this._derivs(s0, g, damping);
		const k2 = this._derivs(this._add(s0, k1, dt * 0.5), g, damping);
		const k3 = this._derivs(this._add(s0, k2, dt * 0.5), g, damping);
		const k4 = this._derivs(this._add(s0, k3, dt), g, damping);

		for (let i = 0; i < 4; i++) {
			s0[i] += (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
		}

		this.theta1 = s0[0];
		this.omega1 = s0[1];
		this.theta2 = s0[2];
		this.omega2 = s0[3];
	}

	_add(s, k, h) {
		return [s[0] + k[0] * h, s[1] + k[1] * h, s[2] + k[2] * h, s[3] + k[3] * h];
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
