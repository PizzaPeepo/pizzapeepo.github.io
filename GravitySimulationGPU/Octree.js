// Barnes-Hut octree (3D) — the spatial build for the GPU-galaxy demo.
// Mirrors the project's 2D BarnesHutTree, extended to 8 children and cubic cells.
// It only builds the tree + centers of mass; the force walk lives in main.js
// (a flattened stackless traversal), so there's deliberately no computeAccel here.
//
// Cells are cubes (single side length `s`). Subdivision stops at OCT_MIN_CELL so
// dense sub-cell clumps merge into one multipole — keeps node count bounded.

const OCT_MIN_CELL = 5;

class OctNode {
	constructor() {
		this.x = 0; this.y = 0; this.z = 0; this.s = 0; // cube origin + side
		this.totalMass = 0; this.cx = 0; this.cy = 0; this.cz = 0; // center of mass
		this.particle = null; this.children = null;
		this._c = [null, null, null, null, null, null, null, null]; // reused child slots
	}

	init(x, y, z, s) {
		this.x = x; this.y = y; this.z = z; this.s = s;
		this.totalMass = 0; this.cx = 0; this.cy = 0; this.cz = 0;
		this.particle = null; this.children = null;
		return this;
	}

	insert(p, tree) {
		if (this.totalMass === 0) {
			this.particle = p;
			this.cx = p.position.x; this.cy = p.position.y; this.cz = p.position.z;
			this.totalMass = p.mass;
			return;
		}

		if (this.children === null) {
			if (this.s < OCT_MIN_CELL) {
				// at/below min cell — accumulate mass in place (finer resolution is pointless)
				const m = this.totalMass + p.mass;
				this.cx = (this.cx * this.totalMass + p.position.x * p.mass) / m;
				this.cy = (this.cy * this.totalMass + p.position.y * p.mass) / m;
				this.cz = (this.cz * this.totalMass + p.position.z * p.mass) / m;
				this.totalMass = m;
				return;
			}
			const hs = this.s * 0.5;
			const x = this.x, y = this.y, z = this.z;
			// octant index = (px>=mx?1) | (py>=my?2) | (pz>=mz?4)
			this._c[0] = tree._alloc(x,      y,      z,      hs);
			this._c[1] = tree._alloc(x + hs, y,      z,      hs);
			this._c[2] = tree._alloc(x,      y + hs, z,      hs);
			this._c[3] = tree._alloc(x + hs, y + hs, z,      hs);
			this._c[4] = tree._alloc(x,      y,      z + hs, hs);
			this._c[5] = tree._alloc(x + hs, y,      z + hs, hs);
			this._c[6] = tree._alloc(x,      y + hs, z + hs, hs);
			this._c[7] = tree._alloc(x + hs, y + hs, z + hs, hs);
			this.children = this._c;
			const existing = this.particle;
			this.particle = null;
			this._insertIntoChild(existing, tree);
		}

		const m = this.totalMass + p.mass;
		this.cx = (this.cx * this.totalMass + p.position.x * p.mass) / m;
		this.cy = (this.cy * this.totalMass + p.position.y * p.mass) / m;
		this.cz = (this.cz * this.totalMass + p.position.z * p.mass) / m;
		this.totalMass = m;
		this._insertIntoChild(p, tree);
	}

	_insertIntoChild(p, tree) {
		const hs = this.s * 0.5;
		const mx = this.x + hs, my = this.y + hs, mz = this.z + hs;
		const idx = (p.position.x >= mx ? 1 : 0) | (p.position.y >= my ? 2 : 0) | (p.position.z >= mz ? 4 : 0);
		this.children[idx].insert(p, tree);
	}
}

export class Octree {
	// poolSize pre-allocates nodes; reset() reclaims them each frame (no GC churn).
	constructor(poolSize = 60000) {
		this._pool = new Array(poolSize);
		for (let i = 0; i < poolSize; i++) this._pool[i] = new OctNode();
		this._ptr = 0;
		this.root = null;
	}

	_alloc(x, y, z, s) {
		if (this._ptr >= this._pool.length) this._pool.push(new OctNode());
		return this._pool[this._ptr++].init(x, y, z, s);
	}

	// Call once per frame before inserting — resets pool pointer, creates a fresh root cube.
	reset(x, y, z, s) {
		this._ptr = 0;
		this.root = this._alloc(x, y, z, s);
	}

	insert(p) {
		this.root.insert(p, this);
	}
}
