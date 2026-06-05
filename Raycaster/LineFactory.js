import Line2D from "./Line2D.js";
import Vector2D from "../Utils/Vector2D.js";

// Random and boundary Line2D factories for the Raycaster demo. Kept out of the Line2D
// geometry class so that class stays a pure primitive with no demo-specific construction.

export function GetRandomLine2D(xmin, xmax, ymin, ymax) {
	const offset = Vector2D.GetRandomVector(xmin, xmax, ymin, ymax);
	const endPoint = Vector2D.GetRandomVector(xmin, xmax, ymin, ymax);
	const direction = Vector2D.GetVectorBetween(offset, endPoint);
	return new Line2D(offset, direction);
}

export function GetRandomLines2D(numberOfLines, xmin, xmax, ymin, ymax) {
	const lines = [];
	for (let i = 0; i < numberOfLines; i++) {
		lines.push(GetRandomLine2D(xmin, xmax, ymin, ymax));
	}
	return lines;
}

export function GetWallLines2D(canvasWidth, canvasHeight) {
	const topLeft = new Vector2D(0, 0);
	const topRight = new Vector2D(canvasWidth, 0);
	const bottomLeft = new Vector2D(0, canvasHeight);
	// each wall is offset + direction vector (top, left, right, bottom edges)
	return [
		new Line2D(topLeft, topRight),
		new Line2D(topLeft, bottomLeft),
		new Line2D(topRight, bottomLeft),
		new Line2D(bottomLeft, topRight),
	];
}
