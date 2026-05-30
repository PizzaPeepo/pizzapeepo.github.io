// Spatial hash grid for O(n) average-case collision broadphase.
// cellSize should be >= 2 * max particle radius so overlapping particles always share a cell or adjacent cells.
export class SpatialHash {
	constructor(cellSize) {
		this.cellSize = cellSize;
		this.cells = new Map();
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

	queryNeighbors(x, y) {
		const cx = Math.floor(x / this.cellSize);
		const cy = Math.floor(y / this.cellSize);
		const result = [];
		for (let dx = -1; dx <= 1; dx++) {
			for (let dy = -1; dy <= 1; dy++) {
				const cell = this.cells.get(this._key(cx + dx, cy + dy));
				if (cell) for (const idx of cell) result.push(idx);
			}
		}
		return result;
	}
}
