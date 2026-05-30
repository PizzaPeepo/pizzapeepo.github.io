// Plummer softening length (px). Gravity is smoothed below this scale, so the tree gains
// nothing by subdividing finer — leaves bottom out here. Without this floor, dense clumps
// (e.g. tiny particles that never collide) split to sub-pixel leaves, exploding node count
// and force-eval traversal cost → severe slowdown.
const BH_SOFTENING = 5;
const BH_SOFTENING2 = BH_SOFTENING * BH_SOFTENING; // 25
const BH_MIN_CELL = BH_SOFTENING;

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
			if (this.w < BH_MIN_CELL || this.h < BH_MIN_CELL) {
				// cell at/below softening length — accumulate mass in place (resolving finer is pointless)
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

	// Accumulates the acceleration at (px,py) into tree._ax / tree._ay. Writing to shared
	// fields (instead of returning [ax,ay]) avoids one array allocation per visited node —
	// with n particles each walking many nodes, that was the dominant GC source.
	// theta2 = theta² so the opening-angle test stays sqrt/division-free.
	// excludeParticle — original particle object to skip (prevents self-force).
	computeAccel(px, py, gravConst, theta2, excludeParticle, tree) {
		if (this.totalMass === 0) return;

		if (this.children === null) {
			if (this.particle === excludeParticle) return;
			const dx = this.cx - px, dy = this.cy - py;
			const r2s = dx * dx + dy * dy + BH_SOFTENING2; // Plummer softening
			const f = gravConst * this.totalMass / (r2s * Math.sqrt(r2s));
			tree._ax += f * dx; tree._ay += f * dy;
			return;
		}

		const dx = this.cx - px, dy = this.cy - py;
		const r2 = dx * dx + dy * dy;
		if (r2 > 0) {
			const s = this.w > this.h ? this.w : this.h;
			// s/r < theta  ⇔  s² < theta²·r²  (both sides positive) — avoids sqrt + division
			if (s * s < theta2 * r2) {
				const sr2 = r2 + BH_SOFTENING2; // Plummer softening
				const f = gravConst * this.totalMass / (sr2 * Math.sqrt(sr2));
				tree._ax += f * dx; tree._ay += f * dy;
				return;
			}
		}

		const c = this.children;
		for (let i = 0; i < 4; i++) {
			if (c[i].totalMass > 0) c[i].computeAccel(px, py, gravConst, theta2, excludeParticle, tree);
		}
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
		this._ax = 0; this._ay = 0; // accumulator written by BHNode.computeAccel
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

	// Computes acceleration at (px,py) into this._ax / this._ay, excluding excludeParticle's
	// contribution (self-force prevention). Read the result from _ax/_ay after the call.
	computeAccelAt(px, py, excludeParticle, gravConst) {
		this._ax = 0; this._ay = 0;
		const theta2 = this.theta * this.theta;
		this.root.computeAccel(px, py, gravConst, theta2, excludeParticle, this);
	}
}
