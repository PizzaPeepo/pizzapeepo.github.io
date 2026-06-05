import Vector2D from "./Vector2D.js";
import * as helpers from "./helpers.js";

export default class Square {
	constructor(center, edgeLength, alphaRadian) {
		this._center = new Vector2D(center.x, center.y);
		this._edgeLength = edgeLength;
		this._alpha = alphaRadian;
		this._cornerPoints = [];
		this.CalcAndSetCornerPoints();
	}

	get center() {
		return this._center;
	}

	set center(newCenter) {
		this._center = new Vector2D(newCenter.x, newCenter.y);
	}

	get cornerPoints() {
		return this._cornerPoints;
	}

	get edgeLength() {
		return this._edgeLength;
	}

	set edgeLength(newLength) {
		this._edgeLength = newLength;
		this.CalcAndSetCornerPoints();
	}

	get alpha() {
		return this._alpha;
	}

	set alpha(newAlpha) {
		this._alpha = newAlpha;
		this.CalcAndSetCornerPoints();
	}

	CalcAndSetCornerPoints() {
		while (this._cornerPoints.length > 0) {
			this._cornerPoints.pop();
		}
		this._cornerPoints.push(
			new Vector2D(
				Math.floor(this.center.x - this.edgeLength / 2),
				Math.floor(this.center.y - this.edgeLength / 2)
			)
		);
		this._cornerPoints.push(
			new Vector2D(
				Math.floor(this.center.x + this.edgeLength / 2),
				Math.floor(this.center.y - this.edgeLength / 2)
			)
		);
		this._cornerPoints.push(
			new Vector2D(
				Math.floor(this.center.x + this.edgeLength / 2),
				Math.floor(this.center.y + this.edgeLength / 2)
			)
		);
		this._cornerPoints.push(
			new Vector2D(
				Math.floor(this.center.x - this.edgeLength / 2),
				Math.floor(this.center.y + this.edgeLength / 2)
			)
		);
		for (let i = 0; i < 4; i++) {
			this._cornerPoints[i].RotateCCWAroundPointInPlace(this.center, this.alpha);
			// this._cornerPoints[i].x = Math.floor(this._cornerPoints[i].x);
			// this._cornerPoints[i].y = Math.floor(this._cornerPoints[i].y);
		}
	}

	RotateInsideSquare(enclosingSquare, alpha) {
		this.alpha = alpha;
		// since the edge length is only depenend on the enclosingSqaure => only look at the difference of enclosing and inner squares
		// this is sort of look at a static outer square with a rotating inner square
		const deltaAlpha = alpha - enclosingSquare.alpha;
		// Math.abs is necessary because else this calculation diverges at pi/2 (has a pole)
		this.edgeLength = enclosingSquare.edgeLength / Math.abs(Math.sin(deltaAlpha) + Math.cos(deltaAlpha));
	}

	// this is actually useless, but came up with my own trigonometry calculation,
	// seems to be way to complicated compared to the other solution
	// also only works for alpha between 0 and pi/2
	RotateInsideSquare_(enclosingSquareLength, alpha) {
		this.alpha = alpha;
		const alpha_ = alpha / (Math.PI / 2);
		this.edgeLength = Math.sqrt(2) * enclosingSquareLength * Math.sqrt(alpha_ ** 2 - alpha_ + 0.5);
	}

	Draw(ctx) {
		ctx.moveTo(this._cornerPoints[0].x, this._cornerPoints[0].y);
		ctx.lineTo(this._cornerPoints[1].x, this._cornerPoints[1].y);
		ctx.lineTo(this._cornerPoints[2].x, this._cornerPoints[2].y);
		ctx.lineTo(this._cornerPoints[3].x, this._cornerPoints[3].y);
		ctx.lineTo(this._cornerPoints[0].x, this._cornerPoints[0].y);
	}
}
