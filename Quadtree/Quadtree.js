import { Rectangle } from "../Utils/rectangle.js";
import * as helpers from "../Utils/helpers.js";

// implemented the pseudocode from the english wiki page of the Quadtree article
export class Quadtree {
	constructor(boundary, n) {
		this.boundary = boundary;
		this.capacity = n;
		this.points = [];
		this.NW = null;
		this.NE = null;
		this.SW = null;
		this.SE = null;
		this.divided = false;
	}

	subdivide() {
		let x = this.boundary.x;
		let y = this.boundary.y;
		let h = this.boundary.h;
		let w = this.boundary.w;
		this.NW = new Quadtree(new Rectangle(x, y, w / 2, h / 2), this.capacity);
		this.NE = new Quadtree(new Rectangle(x + w / 2, y, w / 2, h / 2), this.capacity);
		this.SW = new Quadtree(new Rectangle(x, y + h / 2, w / 2, h / 2), this.capacity);
		this.SE = new Quadtree(new Rectangle(x + w / 2, y + h / 2, w / 2, h / 2), this.capacity);
	}

	// Insert a point into the QuadTree
	insert(point) {
		// Ignore objects that do not belong in this quad tree
		if (!this.boundary.containsPoint(point)) {
			return false; // object cannot be added
		}

		// If there is space in this quad tree and if doesn't have subdivisions, add the object here
		if (this.points.length < this.capacity && !this.divided) {
			this.points.push(point);
			return true;
		}

		// Otherwise, subdivide and then add the point to whichever node will accept it
		if (!this.divided) {
			this.subdivide();
			this.divided = true;
		}
		//We have to add the points/data contained into this quad array to the new quads if we only want
		//the last node to hold the data

		if (this.NW.insert(point)) {
			return true;
		}
		if (this.NE.insert(point)) {
			return true;
		}
		if (this.SW.insert(point)) {
			return true;
		}
		if (this.SE.insert(point)) {
			return true;
		}

		// Otherwise, the point cannot be inserted for some unknown reason (this should never happen)
		return false;
	}

	queryArea(area) {
		let pointsInArea = [];
		// abort if the range does not intersect this quad
		if (!this.boundary.intersects(area)) {
			return pointsInArea; // empty list
		}

		// Check objects at this quad level
		this.points.forEach((point) => {
			if (area.containsPoint(point)) {
				pointsInArea.push(point);
			}
		});

		// Terminate here, if there are no children
		if (!this.divided) {
			return pointsInArea;
		}

		// Otherwise, add the points from the children
		let a = this.NW.queryArea(area);
		let b = this.NE.queryArea(area);
		let c = this.SW.queryArea(area);
		let d = this.SE.queryArea(area);
		a.forEach((p) => {
			pointsInArea.push(p);
		});
		b.forEach((p) => {
			pointsInArea.push(p);
		});
		c.forEach((p) => {
			pointsInArea.push(p);
		});
		d.forEach((p) => {
			pointsInArea.push(p);
		});
		return pointsInArea;
	}

	draw(context, strokeStyle, fillStyle) {
		helpers.drawRectangle(context, this.boundary, strokeStyle);

		if (this.divided) {
			this.NW.draw(context, strokeStyle, fillStyle);
			this.NE.draw(context, strokeStyle, fillStyle);
			this.SW.draw(context, strokeStyle, fillStyle);
			this.SE.draw(context, strokeStyle, fillStyle);
		}

		this.points.forEach((p) => {
			helpers.drawFilledCircle(context, p, 1, strokeStyle, fillStyle);
		});
	}
}
