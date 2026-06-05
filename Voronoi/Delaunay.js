// Bowyer-Watson Delaunay triangulation.
// Input: array of {x, y}. Output: array of {a, b, c} index triples into the input.

function inCircumcircle(p, a, b, c) {
	const ax = a.x - p.x, ay = a.y - p.y;
	const bx = b.x - p.x, by = b.y - p.y;
	const cx = c.x - p.x, cy = c.y - p.y;
	const d =
		(ax * ax + ay * ay) * (bx * cy - cx * by) -
		(bx * bx + by * by) * (ax * cy - cx * ay) +
		(cx * cx + cy * cy) * (ax * by - bx * ay);
	// Sign depends on winding; handle both orientations.
	const orient = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
	return orient > 0 ? d > 0 : d < 0;
}

function sameEdge(e1, e2) {
	return (e1[0] === e2[0] && e1[1] === e2[1]) || (e1[0] === e2[1] && e1[1] === e2[0]);
}

export function triangulate(points) {
	const n = points.length;
	if (n < 3) return [];

	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (const p of points) {
		if (p.x < minX) minX = p.x;
		if (p.y < minY) minY = p.y;
		if (p.x > maxX) maxX = p.x;
		if (p.y > maxY) maxY = p.y;
	}
	const dx = maxX - minX, dy = maxY - minY;
	const dmax = Math.max(dx, dy) || 1;
	const midx = (minX + maxX) / 2, midy = (minY + maxY) / 2;

	// Super-triangle vertices appended after the real points.
	const verts = points.concat([
		{ x: midx - 20 * dmax, y: midy - dmax },
		{ x: midx, y: midy + 20 * dmax },
		{ x: midx + 20 * dmax, y: midy - dmax },
	]);

	let triangles = [{ a: n, b: n + 1, c: n + 2 }];

	for (let i = 0; i < n; i++) {
		const p = verts[i];
		const edges = [];
		triangles = triangles.filter(function (t) {
			if (inCircumcircle(p, verts[t.a], verts[t.b], verts[t.c])) {
				edges.push([t.a, t.b], [t.b, t.c], [t.c, t.a]);
				return false;
			}
			return true;
		});

		// Drop edges shared by two removed triangles — keep the polygonal hole boundary.
		for (let j = edges.length - 1; j >= 0; j--) {
			for (let k = j - 1; k >= 0; k--) {
				if (sameEdge(edges[j], edges[k])) {
					edges.splice(j, 1);
					edges.splice(k, 1);
					j--;
					break;
				}
			}
		}

		for (const e of edges) triangles.push({ a: e[0], b: e[1], c: i });
	}

	// Discard any triangle still touching the super-triangle.
	return triangles.filter(function (t) { return t.a < n && t.b < n && t.c < n; });
}
