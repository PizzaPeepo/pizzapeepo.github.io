import * as helpers from "../Utils/helpers.js";

export default class Vector2D {
	constructor(x, y) {
		this._x = x;
		this._y = y;
		this.length = this.GetLength();
	}

	get x() {
		return this._x;
	}

	set x(value) {
		this._x = value;
	}

	get y() {
		return this._y;
	}

	set y(value) {
		this._y = value;
	}

	GetLength() {
		return Math.sqrt(this.x * this.x + this.y * this.y);
	}

	UpdateLength() {
		this.length = this.GetLength();
	}

	Update(x, y) {
		this.x = x;
		this.y = y;
		this.length = this.GetLength();
	}

	Negative() {
		return new Vector2D(this.x * -1, this.y * -1);
	}

	Add(otherVector) {
		return new Vector2D(this.x + otherVector.x, this.y + otherVector.y);
	}

	Multiply(scalar) {
		return new Vector2D(this.x * scalar, this.y * scalar);
	}

	DotProduct(otherVector) {
		return this.x * otherVector.x + this.y * otherVector.y;
	}

	GetAngleInRadian(otherVector) {
		if (this.length > 0 && otherVector.length > 0) {
			return Math.acos(this.DotProduct(otherVector) / (this.length * otherVector.length));
		} else {
			return null;
		}
	}

	GetAngleInDegree(otherVector) {
		var alpha_radian = this.GetAngleInRadian(otherVector);
		if (alpha_radian != null) {
			return helpers.RadianToDegree(alpha_radian);
		}
	}

	Normalize() {
		if (this.length > 0) {
			return new Vector2D(this.x / this.length, this.y / this.length);
		}
	}

	CrossProduct(otherVector) {
		return new Vector2D(this.x * otherVector.y, -(this.y * otherVector.x));
	}

	IsCollinear(otherVector) {
		return Math.abs(0 - this.GetAngleInDegree(otherVector)) < helpers.epsilon ||
			Math.abs(180 - this.GetAngleInDegree(otherVector)) < helpers.epsilon
			? true
			: false;
	}

	IsOrthogonal(otherVector) {
		return Math.abs(0 - this.DotProduct(otherVector)) < helpers.epsilon ? true : false;
	}

	// Core rotation — mutates in place and refreshes the cached length. Pass sin/cos of the
	// angle; clockwise is counter-clockwise with a negated sine, so every public variant below
	// routes through these two helpers (single source of truth for the rotation math).
	_applyRotation(sinAngle, cosAngle) {
		const rotatedX = this.x * cosAngle - this.y * sinAngle;
		const rotatedY = this.x * sinAngle + this.y * cosAngle;
		this.x = rotatedX;
		this.y = rotatedY;
		this.UpdateLength();
		return this;
	}

	_applyRotationAroundPoint(center, sinAngle, cosAngle) {
		const dx = this.x - center.x;
		const dy = this.y - center.y;
		this.x = dx * cosAngle - dy * sinAngle + center.x;
		this.y = dx * sinAngle + dy * cosAngle + center.y;
		this.UpdateLength();
		return this;
	}

	// In-place (mutating) variants — modify this vector and return it for chaining.
	RotateCCWInPlace(alpha_radian) {
		return this._applyRotation(Math.sin(alpha_radian), Math.cos(alpha_radian));
	}

	RotateCWInPlace(alpha_radian) {
		return this._applyRotation(-Math.sin(alpha_radian), Math.cos(alpha_radian));
	}

	RotateCCWAroundPointInPlace(center, alpha_radian) {
		return this._applyRotationAroundPoint(center, Math.sin(alpha_radian), Math.cos(alpha_radian));
	}

	RotateCWAroundPointInPlace(center, alpha_radian) {
		return this._applyRotationAroundPoint(center, -Math.sin(alpha_radian), Math.cos(alpha_radian));
	}

	// Immutable variants — return a rotated copy, leaving this vector unchanged.
	RotateCCW(alpha_radian) {
		return this.Clone()._applyRotation(Math.sin(alpha_radian), Math.cos(alpha_radian));
	}

	RotateCW(alpha_radian) {
		return this.Clone()._applyRotation(-Math.sin(alpha_radian), Math.cos(alpha_radian));
	}

	RotateCCWAroundPoint(center, alpha_radian) {
		return this.Clone()._applyRotationAroundPoint(center, Math.sin(alpha_radian), Math.cos(alpha_radian));
	}

	RotateCWAroundPoint(center, alpha_radian) {
		return this.Clone()._applyRotationAroundPoint(center, -Math.sin(alpha_radian), Math.cos(alpha_radian));
	}

	Clone() {
		return new Vector2D(this.x, this.y);
	}

	Equals(otherVector) {
		return Math.abs(this.x - otherVector.x) < helpers.epsilon && Math.abs(this.y - otherVector.y) < helpers.epsilon;
	}

	DistanceTo(otherVec) {
		const temp = new Vector2D(otherVec.x - this.x, otherVec.y - this.y);
		return temp.GetLength();
	}

	static GetRandomVector(xmin, xmax, ymin, ymax) {
		return new Vector2D(helpers.GetRandomIntFromRange(xmin, xmax), helpers.GetRandomIntFromRange(ymin, ymax));
	}

	static GetVectorBetween(v1, v2) {
		return new Vector2D(v2.x - v1.x, v2.y - v1.y);
	}
}
