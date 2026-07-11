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

// Voronoi diagram as the Delaunay dual: one segment per triangle pair sharing a
// side (circumcenter to circumcenter), plus an outward ray per hull side.
// Returns segments [{x1, y1, x2, y2, px, py}]; rayLength caps the hull rays.
// (px, py) is one of the two generating sites — every point of the segment is
// equidistant to both, which growth animations use to reveal edges by radius.
export function voronoiEdges(points, triangles, rayLength) {
	const m = triangles.length;
	const ccx = new Float64Array(m), ccy = new Float64Array(m);
	const ok = new Uint8Array(m);
	for (let t = 0; t < m; t++) {
		const a = points[triangles[t].a], b = points[triangles[t].b], c = points[triangles[t].c];
		const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
		if (Math.abs(d) < 1e-9) continue; // near-collinear: no finite circumcenter
		const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, c2 = c.x * c.x + c.y * c.y;
		ccx[t] = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
		ccy[t] = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
		ok[t] = 1;
	}

	// Map each undirected site pair to the triangle(s) sharing it.
	const shared = new Map();
	for (let t = 0; t < m; t++) {
		if (!ok[t]) continue;
		const tr = triangles[t];
		const pairs = [[tr.a, tr.b, tr.c], [tr.b, tr.c, tr.a], [tr.c, tr.a, tr.b]];
		for (const [i, j, k] of pairs) {
			const key = i < j ? i + "_" + j : j + "_" + i;
			const e = shared.get(key);
			if (e) e.t2 = t;
			else shared.set(key, { i: i, j: j, k: k, t1: t, t2: -1 });
		}
	}

	const segs = [];
	for (const e of shared.values()) {
		const x1 = ccx[e.t1], y1 = ccy[e.t1];
		const px = points[e.i].x, py = points[e.i].y;
		if (e.t2 >= 0) {
			segs.push({ x1: x1, y1: y1, x2: ccx[e.t2], y2: ccy[e.t2], px: px, py: py });
		} else {
			// Hull side: ray from the circumcenter, perpendicular to the site
			// pair, pointing away from the triangle's third site.
			const si = points[e.i], sj = points[e.j], sk = points[e.k];
			let dx = -(sj.y - si.y), dy = sj.x - si.x;
			const mx = (si.x + sj.x) / 2, my = (si.y + sj.y) / 2;
			if (dx * (mx - sk.x) + dy * (my - sk.y) < 0) { dx = -dx; dy = -dy; }
			const len = Math.hypot(dx, dy) || 1;
			segs.push({ x1: x1, y1: y1, x2: x1 + (dx / len) * rayLength, y2: y1 + (dy / len) * rayLength, px: px, py: py });
		}
	}
	return segs;
}
