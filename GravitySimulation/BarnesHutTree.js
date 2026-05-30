class BHNode {
	constructor() {
		this.x = 0; this.y = 0; this.w = 0; this.h = 0;
		this.totalMass = 0; this.cx = 0; this.cy = 0;
		this.particle = null; this.children = null;
		this._c = [null, null, null, null]; // pre-allocated child slot array — reused each frame
	}

	init(x, y, w, h) {
		this.x = x; this.y = y; this.w = w; this.h = h;
		this.totalMass = 0; this.cx = 0; this.cy = 0;
		this.particle = null; this.children = null;
		return this;
	}

	insert(particle, tree) {
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
			this._c[0] = tree._alloc(this.x, this.y, hw, hh); // NW
			this._c[1] = tree._alloc(mx,     this.y, hw, hh); // NE
			this._c[2] = tree._alloc(this.x, my,     hw, hh); // SW
			this._c[3] = tree._alloc(mx,     my,     hw, hh); // SE
			this.children = this._c;
			const existing = this.particle;
			this.particle = null;
			this._insertIntoChild(existing, tree);
		}

		const m = this.totalMass + particle.mass;
		this.cx = (this.cx * this.totalMass + particle.position.x * particle.mass) / m;
		this.cy = (this.cy * this.totalMass + particle.position.y * particle.mass) / m;
		this.totalMass = m;
		this._insertIntoChild(particle, tree);
	}

	_insertIntoChild(particle, tree) {
		const mx = this.x + this.w * 0.5;
		const my = this.y + this.h * 0.5;
		const idx = (particle.position.x >= mx ? 1 : 0) | (particle.position.y >= my ? 2 : 0);
		this.children[idx].insert(particle, tree);
	}

	// px, py — query position; excludeParticle — original particle object to skip (prevents self-force)
	computeAccel(px, py, gravConst, theta, excludeParticle) {
		if (this.totalMass === 0) return [0, 0];

		if (this.children === null) {
			if (this.particle === excludeParticle) return [0, 0];
			const dx = this.cx - px, dy = this.cy - py;
			const r2s = dx * dx + dy * dy + 25; // +5² Plummer softening
			const r3s = r2s * Math.sqrt(r2s);
			return [gravConst * this.totalMass * dx / r3s, gravConst * this.totalMass * dy / r3s];
		}

		const dx = this.cx - px, dy = this.cy - py;
		const r2 = dx * dx + dy * dy;
		if (r2 > 0) {
			const r = Math.sqrt(r2);
			const s = this.w > this.h ? this.w : this.h;
			if (s / r < theta) {
				const sr2 = r2 + 25; // +5² Plummer softening
				const r3 = sr2 * Math.sqrt(sr2);
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
	// poolSize pre-allocates BHNode objects — reset() reclaims them each frame, no GC pressure.
	constructor(theta = 0.5, poolSize = 30000) {
		this.theta = theta;
		this._pool = new Array(poolSize);
		for (let i = 0; i < poolSize; i++) this._pool[i] = new BHNode();
		this._ptr = 0;
		this.root = null;
	}

	_alloc(x, y, w, h) {
		if (this._ptr >= this._pool.length) this._pool.push(new BHNode());
		return this._pool[this._ptr++].init(x, y, w, h);
	}

	// Call once per frame before inserting — resets pool pointer, creates new root from pool.
	reset(x, y, w, h) {
		this._ptr = 0;
		this.root = this._alloc(x, y, w, h);
	}

	insert(particle) {
		this.root.insert(particle, this);
	}

	// Query acceleration at (px,py), excluding originalParticle's contribution (self-force prevention)
	computeAccelAt(px, py, excludeParticle, gravConst) {
		return this.root.computeAccel(px, py, gravConst, this.theta, excludeParticle);
	}
}
