import Vector2D from "../Utils/Vector2D.js";

export default class Particle {
	constructor(position, velocity, acceleration, radius = 3, mass = 1) {
		if (!(position instanceof Vector2D) || !(velocity instanceof Vector2D) || !(acceleration instanceof Vector2D)) {
			throw new TypeError("Particle constructor received wrong input types.");
		}
		this._position = new Vector2D(position.x, position.y);
		this._velocity = new Vector2D(velocity.x, velocity.y);
		this._acceleration = new Vector2D(acceleration.x, acceleration.y);
		this._radius = radius;
		this._mass = mass;
	}

	get position() {
		return this._position;
	}

	set position(newPosVec) {
		this._position = new Vector2D(newPosVec.x, newPosVec.y);
	}

	get velocity() {
		return this._velocity;
	}

	set velocity(newVelocityVec) {
		this._velocity = new Vector2D(newVelocityVec.x, newVelocityVec.y);
	}

	get acceleration() {
		return this._acceleration;
	}

	set acceleration(newAccel) {
		this._acceleration = new Vector2D(newAccel.x, newAccel.y);
	}

	get mass() {
		return this._mass;
	}

	set mass(newMass) {
		this._mass = newMass;
	}

	get radius() {
		return this._radius;
	}

	set radius(newRadius) {
		this._radius = newRadius;
	}

	// Derived from mass so it can never go stale when mass changes via the setter.
	get isHeavyParticle() {
		return this._mass >= 500;
	}

	Draw(context, strokeStyle, fillStyle) {
		context.beginPath();
		context.fillStyle = fillStyle;
		context.strokeStyle = strokeStyle;
		context.arc(this.position.x, this.position.y, this.radius, 0, 2 * Math.PI);
		context.stroke();
		context.fill();
	}

	DeepCopy() {
		let particle = new Particle(
			new Vector2D(this.position.x, this.position.y),
			new Vector2D(this.velocity.x, this.velocity.y),
			new Vector2D(this.acceleration.x, this.acceleration.y),
			this.radius,
			this.mass
		);
		return particle;
	}

	Overlaps(otherParticle) {
		return this.position.DistanceTo(otherParticle.position) < this.radius + otherParticle.radius;
	}

}
