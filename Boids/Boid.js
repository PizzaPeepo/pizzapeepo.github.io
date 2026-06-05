import Vector2D from "../Utils/Vector2D.js";

// A single agent in the flock. Steering follows Reynolds' three rules —
// separation, alignment, cohesion — plus optional mouse attraction/repulsion.
export default class Boid {
	constructor(x, y, vx, vy) {
		this.position = new Vector2D(x, y);
		this.velocity = new Vector2D(vx, vy);
		this.acceleration = new Vector2D(0, 0);
		this.hue = 0; // set from speed each frame for colouring
	}

	// neighbours: array of Boid within perceptionRadius (self may be included; skipped by distance check)
	flock(neighbours, cfg) {
		let sepX = 0, sepY = 0, sepCount = 0;
		let aliX = 0, aliY = 0, aliCount = 0;
		let cohX = 0, cohY = 0, cohCount = 0;

		const px = this.position.x, py = this.position.y;
		const percSq = cfg.perception * cfg.perception;
		const sepSq = cfg.separationDist * cfg.separationDist;

		for (let i = 0; i < neighbours.length; i++) {
			const other = neighbours[i];
			if (other === this) continue;
			const dx = other.position.x - px;
			const dy = other.position.y - py;
			const dSq = dx * dx + dy * dy;
			if (dSq > percSq || dSq === 0) continue;

			// Alignment + cohesion use all perceived neighbours
			aliX += other.velocity.x; aliY += other.velocity.y; aliCount++;
			cohX += other.position.x; cohY += other.position.y; cohCount++;

			// Separation only from close ones, weighted by inverse distance
			if (dSq < sepSq) {
				const d = Math.sqrt(dSq);
				sepX -= dx / d; sepY -= dy / d; sepCount++;
			}
		}

		let ax = 0, ay = 0;

		if (sepCount > 0) {
			const s = this._steer(sepX, sepY, cfg.maxSpeed, cfg.maxForce);
			ax += s.x * cfg.separation; ay += s.y * cfg.separation;
		}
		if (aliCount > 0) {
			const s = this._steer(aliX / aliCount, aliY / aliCount, cfg.maxSpeed, cfg.maxForce);
			ax += s.x * cfg.alignment; ay += s.y * cfg.alignment;
		}
		if (cohCount > 0) {
			// steer toward the average position of neighbours
			const s = this._steer(cohX / cohCount - px, cohY / cohCount - py, cfg.maxSpeed, cfg.maxForce);
			ax += s.x * cfg.cohesion; ay += s.y * cfg.cohesion;
		}

		this.acceleration.x = ax;
		this.acceleration.y = ay;
	}

	// Steer toward a desired direction (dx,dy): normalize to maxSpeed, subtract current
	// velocity, then clamp the result to maxForce. Returns a plain {x,y}.
	_steer(dx, dy, maxSpeed, maxForce) {
		const len = Math.sqrt(dx * dx + dy * dy);
		if (len === 0) return { x: 0, y: 0 };
		let desiredX = (dx / len) * maxSpeed;
		let desiredY = (dy / len) * maxSpeed;
		let steerX = desiredX - this.velocity.x;
		let steerY = desiredY - this.velocity.y;
		const sLen = Math.sqrt(steerX * steerX + steerY * steerY);
		if (sLen > maxForce) {
			steerX = (steerX / sLen) * maxForce;
			steerY = (steerY / sLen) * maxForce;
		}
		return { x: steerX, y: steerY };
	}

	// Add an attraction (sign +1) or repulsion (sign -1) force toward the mouse point.
	applyMouse(mx, my, sign, cfg) {
		const dx = mx - this.position.x;
		const dy = my - this.position.y;
		const dSq = dx * dx + dy * dy;
		if (dSq > cfg.mouseRadius * cfg.mouseRadius || dSq === 0) return;
		const s = this._steer(dx * sign, dy * sign, cfg.maxSpeed, cfg.maxForce);
		this.acceleration.x += s.x * 1.5;
		this.acceleration.y += s.y * 1.5;
	}

	update(maxSpeed, w, h) {
		this.velocity.x += this.acceleration.x;
		this.velocity.y += this.acceleration.y;

		const speed = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.y * this.velocity.y);
		if (speed > maxSpeed) {
			this.velocity.x = (this.velocity.x / speed) * maxSpeed;
			this.velocity.y = (this.velocity.y / speed) * maxSpeed;
		}

		this.position.x += this.velocity.x;
		this.position.y += this.velocity.y;

		// Toroidal wrap
		if (this.position.x < 0) this.position.x += w;
		else if (this.position.x >= w) this.position.x -= w;
		if (this.position.y < 0) this.position.y += h;
		else if (this.position.y >= h) this.position.y -= h;

		// Hue from speed: slow = base, fast = base + 60
		this.hue = speed / maxSpeed;
	}
}
