// Spatial hash grid for O(n) average-case collision broadphase.
// cellSize should be >= 2 * max particle radius so overlapping particles always share a cell or adjacent cells.
export class SpatialHash {
	constructor(cellSize) {
		this.cellSize = cellSize;
		this.cells = new Map();
		this._scratch = []; // reused by queryNeighbors — valid only until the next queryNeighbors call
	}

	clear() {
		this.cells.clear();
	}

	_key(cx, cy) {
		return cx * 10000 + cy;
	}

	insert(index, x, y) {
		const cx = Math.floor(x / this.cellSize);
		const cy = Math.floor(y / this.cellSize);
		const key = this._key(cx, cy);
		if (!this.cells.has(key)) this.cells.set(key, []);
		this.cells.get(key).push(index);
	}

	// Returns a SHARED scratch array — copy it if you need to keep the result past the next call.
	queryNeighbors(x, y) {
		const cx = Math.floor(x / this.cellSize);
		const cy = Math.floor(y / this.cellSize);
		const result = this._scratch;
		result.length = 0;
		for (let dx = -1; dx <= 1; dx++) {
			for (let dy = -1; dy <= 1; dy++) {
				const cell = this.cells.get(this._key(cx + dx, cy + dy));
				if (cell) for (let i = 0; i < cell.length; i++) result.push(cell[i]);
			}
		}
		return result;
	}
}
