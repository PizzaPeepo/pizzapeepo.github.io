class BHNode {
	constructor(x, y, w, h) {
		this.x = x; this.y = y; this.w = w; this.h = h;
		this.totalMass = 0;
		this.cx = 0; this.cy = 0;
		this.particle = null;
		this.children = null;
	}

	insert(particle) {
		if (this.totalMass === 0) {
			this.particle = particle;
			this.cx = particle.position.x;
			this.cy = particle.position.y;
			this.totalMass = particle.mass;
			return;
		}

		if (this.children === null) {
			if (this.w < 0.5 || this.h < 0.5) {
				// cell too small to subdivide — accumulate mass in place
				const m = this.totalMass + particle.mass;
				this.cx = (this.cx * this.totalMass + particle.position.x * particle.mass) / m;
				this.cy = (this.cy * this.totalMass + particle.position.y * particle.mass) / m;
				this.totalMass = m;
				return;
			}
			const hw = this.w * 0.5, hh = this.h * 0.5;
			const mx = this.x + hw, my = this.y + hh;
			this.children = [
				new BHNode(this.x, this.y, hw, hh), // NW
				new BHNode(mx,     this.y, hw, hh), // NE
				new BHNode(this.x, my,     hw, hh), // SW
				new BHNode(mx,     my,     hw, hh), // SE
			];
			const existing = this.particle;
			this.particle = null;
			this._insertIntoChild(existing);
		}

		const m = this.totalMass + particle.mass;
		this.cx = (this.cx * this.totalMass + particle.position.x * particle.mass) / m;
		this.cy = (this.cy * this.totalMass + particle.position.y * particle.mass) / m;
		this.totalMass = m;
		this._insertIntoChild(particle);
	}

	_insertIntoChild(particle) {
		const mx = this.x + this.w * 0.5;
		const my = this.y + this.h * 0.5;
		const idx = (particle.position.x >= mx ? 1 : 0) | (particle.position.y >= my ? 2 : 0);
		this.children[idx].insert(particle);
	}

	// px, py — query position; excludeParticle — original particle object to skip (prevents self-force)
	computeAccel(px, py, gravConst, theta, excludeParticle) {
		if (this.totalMass === 0) return [0, 0];

		if (this.children === null) {
			if (this.particle === excludeParticle) return [0, 0];
			const dx = this.cx - px, dy = this.cy - py;
			const r2 = dx * dx + dy * dy;
			if (r2 < 1) return [0, 0]; // softening
			const r3 = r2 * Math.sqrt(r2);
			return [gravConst * this.totalMass * dx / r3, gravConst * this.totalMass * dy / r3];
		}

		const dx = this.cx - px, dy = this.cy - py;
		const r2 = dx * dx + dy * dy;
		if (r2 > 0) {
			const r = Math.sqrt(r2);
			const s = this.w > this.h ? this.w : this.h;
			if (s / r < theta) {
				// far enough — treat whole cell as point mass at CoM
				const r3 = r2 * r;
				return [gravConst * this.totalMass * dx / r3, gravConst * this.totalMass * dy / r3];
			}
		}

		let ax = 0, ay = 0;
		for (let i = 0; i < 4; i++) {
			const child = this.children[i];
			if (child.totalMass > 0) {
				const [cax, cay] = child.computeAccel(px, py, gravConst, theta, excludeParticle);
				ax += cax; ay += cay;
			}
		}
		return [ax, ay];
	}
}

export class BarnesHutTree {
	constructor(x, y, w, h, theta = 0.5) {
		this.root = new BHNode(x, y, w, h);
		this.theta = theta;
	}

	insert(particle) {
		this.root.insert(particle);
	}

	// Query acceleration at (px,py), excluding originalParticle's contribution (self-force prevention)
	computeAccelAt(px, py, excludeParticle, gravConst) {
		return this.root.computeAccel(px, py, gravConst, this.theta, excludeParticle);
	}
}
