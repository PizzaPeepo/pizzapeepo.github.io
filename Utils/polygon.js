import Vector2D from "./Vector2D.js";

export default class Polygon {
	constructor(center, edgeLength, alphaRadian, sides = 4) {
		this._center = new Vector2D(center.x, center.y);
		this._edgeLength = edgeLength;
		this._alpha = alphaRadian;
		this._sides = sides;
		this._cornerPoints = [];
		this.CalcAndSetCornerPoints();
	}

	get center() { return this._center; }
	set center(v) { this._center = new Vector2D(v.x, v.y); }

	get cornerPoints() { return this._cornerPoints; }

	get edgeLength() { return this._edgeLength; }
	set edgeLength(v) { this._edgeLength = v; this.CalcAndSetCornerPoints(); }

	get alpha() { return this._alpha; }
	set alpha(v) { this._alpha = v; this.CalcAndSetCornerPoints(); }

	get sides() { return this._sides; }
	set sides(v) { this._sides = v; this.CalcAndSetCornerPoints(); }

	CalcAndSetCornerPoints() {
		this._cornerPoints = [];
		const N = this._sides;
		const R = this._edgeLength / (2 * Math.sin(Math.PI / N));
		for (let k = 0; k < N; k++) {
			const angle = (2 * Math.PI * k / N) + this._alpha;
			this._cornerPoints.push(new Vector2D(
				this._center.x + R * Math.cos(angle),
				this._center.y + R * Math.sin(angle)
			));
		}
	}

	// Generalized inscribed-rotation formula derived from the constraint that
	// each vertex of the inner N-gon lies on an edge of the outer N-gon.
	// For N=4 reduces to: outer / |sin(d) + cos(d)|  (original Square formula).
	RotateInsidePolygon(outer, alpha) {
		const N = this._sides;
		const period = (2 * Math.PI) / N;
		let d = (alpha - outer.alpha) % period;
		if (d < 0) d += period;
		const factor = Math.cos(d) + Math.sin(d) * (1 - Math.cos(period)) / Math.sin(period);
		this._alpha = alpha;
		this._edgeLength = outer.edgeLength / Math.abs(factor);
		this.CalcAndSetCornerPoints();
	}

	Draw(ctx) {
		const pts = this._cornerPoints;
		ctx.moveTo(pts[0].x, pts[0].y);
		for (let k = 1; k < pts.length; k++) {
			ctx.lineTo(pts[k].x, pts[k].y);
		}
		ctx.closePath();
	}
}
