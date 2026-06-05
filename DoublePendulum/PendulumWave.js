// A row of uncoupled simple pendulums whose periods are tuned so the whole bank
// realigns every `period` seconds. Adjacent pendulums differ by one oscillation
// per cycle, producing the travelling-wave / snake illusion. Purely analytic —
// each bob angle is a cosine, no integration needed.
export default class PendulumWave {
	constructor(count, period, amplitude, baseCycles) {
		this.count = count;
		this.period = period;       // seconds for a full realignment cycle
		this.amplitude = amplitude; // max swing angle (radians)
		this.baseCycles = baseCycles; // oscillations the slowest pendulum makes per cycle
		this.angles = new Array(count).fill(0);
	}

	// Oscillations-per-cycle for pendulum i (slowest first).
	cyclesFor(i) {
		return this.baseCycles + i;
	}

	update(t) {
		const twoPiOverT = (2 * Math.PI) / this.period;
		for (let i = 0; i < this.count; i++) {
			this.angles[i] = this.amplitude * Math.cos(this.cyclesFor(i) * twoPiOverT * t);
		}
	}

	// Display rod length for pendulum i, normalized to [minLen, maxLen] px.
	// Physical pendulum length scales as 1/frequency^2, so slower = longer.
	rodLength(i, minLen, maxLen) {
		const fSlow = this.cyclesFor(0);
		const fFast = this.cyclesFor(this.count - 1);
		const lSlow = 1 / (fSlow * fSlow); // longest
		const lFast = 1 / (fFast * fFast); // shortest
		const l = 1 / (this.cyclesFor(i) * this.cyclesFor(i));
		const t = (l - lFast) / (lSlow - lFast || 1);
		return minLen + t * (maxLen - minLen);
	}
}
