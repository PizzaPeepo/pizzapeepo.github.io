// Maze generation (recursive-backtracker DFS) + animated pathfinding.
// Watch BFS / Dijkstra / A* / DFS flood the maze and backtrack the route.

// #region globals
var canvasWidth = window.getCanvasWidth();
var canvasHeight = window.innerHeight;

var cellSize = 22;
var searchSpeed = 18;     // nodes expanded per frame
var algo = "astar";       // astar | dijkstra | bfs | dfs
var animateGen = true;
var autoSolve = true;

var cols, rows;
var walls;                // Uint8Array bitmask per cell: N=1 E=2 S=4 W=8 (1 = wall present)
var startIdx, goalIdx;

var phase = "idle";       // gen | solve | done
var genStack, genVisited;
var search = null;        // solver state
var pathCells = [];
var pathAnim = 0;

const N = 1, E = 2, S = 4, W = 8;

var darkBg = "#0e0f13";
var lightBg = "#eceae3";
var isLight = document.documentElement.classList.contains("light");
// #endregion

// #region canvas
var backgroundCanvas = document.getElementById("backgroundCanvas");
var ctx = backgroundCanvas.getContext("2d");
var statusLabel = document.getElementById("statusLabel");

function applyCanvasSize() {
	backgroundCanvas.width = canvasWidth;
	backgroundCanvas.height = canvasHeight;
	backgroundCanvas.style.width = canvasWidth + "px";
	backgroundCanvas.style.height = canvasHeight + "px";
}
applyCanvasSize();
// #endregion

function ci(c, r) { return r * cols + c; }
function cx(i) { return i % cols; }
function cy(i) { return (i / cols) | 0; }

// #region generation
function initGrid() {
	cols = Math.max(4, Math.floor(canvasWidth / cellSize));
	rows = Math.max(4, Math.floor(canvasHeight / cellSize));
	walls = new Uint8Array(cols * rows).fill(N | E | S | W);
	startIdx = ci(0, 0);
	goalIdx = ci(cols - 1, rows - 1);
	genStack = [0];
	genVisited = new Uint8Array(cols * rows);
	genVisited[0] = 1;
}

function carve(a, b) {
	const ax = cx(a), ay = cy(a), bx = cx(b);
	if (bx > ax) { walls[a] &= ~E; walls[b] &= ~W; }
	else if (bx < ax) { walls[a] &= ~W; walls[b] &= ~E; }
	else if (cy(b) > ay) { walls[a] &= ~S; walls[b] &= ~N; }
	else { walls[a] &= ~N; walls[b] &= ~S; }
}

function genStep() {
	if (genStack.length === 0) { finishGen(); return; }
	const cur = genStack[genStack.length - 1];
	const c = cx(cur), r = cy(cur);
	const nb = [];
	if (r > 0 && !genVisited[ci(c, r - 1)]) nb.push(ci(c, r - 1));
	if (c < cols - 1 && !genVisited[ci(c + 1, r)]) nb.push(ci(c + 1, r));
	if (r < rows - 1 && !genVisited[ci(c, r + 1)]) nb.push(ci(c, r + 1));
	if (c > 0 && !genVisited[ci(c - 1, r)]) nb.push(ci(c - 1, r));
	if (nb.length === 0) { genStack.pop(); return; }
	const next = nb[(Math.random() * nb.length) | 0];
	carve(cur, next);
	genVisited[next] = 1;
	genStack.push(next);
}

function finishGen() {
	phase = autoSolve ? "solve" : "done";
	if (phase === "solve") startSearch();
	else setStatus("Maze ready — press Solve");
}

function generate() {
	initGrid();
	pathCells = [];
	search = null;
	if (animateGen) { phase = "gen"; setStatus("Carving maze…"); }
	else { while (genStack.length) genStep(); phase = autoSolve ? "solve" : "done"; if (autoSolve) startSearch(); else setStatus("Maze ready — press Solve"); }
}
// #endregion

// #region pathfinding
function accessible(a, b) {
	// b is a 4-neighbour of a; passable if no wall between
	const ax = cx(a), ay = cy(a), bx = cx(b), by = cy(b);
	if (bx > ax) return !(walls[a] & E);
	if (bx < ax) return !(walls[a] & W);
	if (by > ay) return !(walls[a] & S);
	return !(walls[a] & N);
}

function neighbors(i) {
	const c = cx(i), r = cy(i), out = [];
	if (r > 0) out.push(ci(c, r - 1));
	if (c < cols - 1) out.push(ci(c + 1, r));
	if (r < rows - 1) out.push(ci(c, r + 1));
	if (c > 0) out.push(ci(c - 1, r));
	return out;
}

function heuristic(i) {
	return Math.abs(cx(i) - cx(goalIdx)) + Math.abs(cy(i) - cy(goalIdx));
}

// Binary min-heap keyed by priority for A*/Dijkstra.
function Heap() { this.a = []; }
Heap.prototype.push = function (node) {
	const a = this.a; a.push(node); let i = a.length - 1;
	while (i > 0) { const p = (i - 1) >> 1; if (a[p].f <= a[i].f) break; const t = a[p]; a[p] = a[i]; a[i] = t; i = p; }
};
Heap.prototype.pop = function () {
	const a = this.a; const top = a[0]; const last = a.pop();
	if (a.length) { a[0] = last; let i = 0; const n = a.length;
		for (;;) { let l = 2 * i + 1, r = l + 1, s = i;
			if (l < n && a[l].f < a[s].f) s = l;
			if (r < n && a[r].f < a[s].f) s = r;
			if (s === i) break; const t = a[s]; a[s] = a[i]; a[i] = t; i = s; } }
	return top;
};
Heap.prototype.size = function () { return this.a.length; };

function startSearch() {
	const n = cols * rows;
	search = {
		state: new Uint8Array(n),   // 0 unseen, 1 open, 2 closed
		came: new Int32Array(n).fill(-1),
		g: new Float64Array(n).fill(Infinity),
		list: [],                   // for bfs/dfs
		head: 0,
		heap: new Heap(),
		expanded: 0,
		done: false,
	};
	search.g[startIdx] = 0;
	search.state[startIdx] = 1;
	if (algo === "bfs" || algo === "dfs") search.list.push(startIdx);
	else search.heap.push({ idx: startIdx, f: heuristic(startIdx) });
	phase = "solve";
	setStatus("Searching…");
}

function popNext() {
	if (algo === "bfs") {
		if (search.head >= search.list.length) return -1;
		return search.list[search.head++];
	}
	if (algo === "dfs") {
		if (search.list.length === 0) return -1;
		return search.list.pop();
	}
	// astar / dijkstra
	while (search.heap.size()) {
		const node = search.heap.pop();
		if (search.state[node.idx] === 2) continue; // stale
		return node.idx;
	}
	return -1;
}

function searchStep() {
	for (let k = 0; k < searchSpeed; k++) {
		const cur = popNext();
		if (cur < 0) { search.done = true; reconstruct(false); return; }
		if (search.state[cur] === 2) continue;
		search.state[cur] = 2;
		search.expanded++;
		if (cur === goalIdx) { search.done = true; reconstruct(true); return; }

		const nbs = neighbors(cur);
		for (let m = 0; m < nbs.length; m++) {
			const nx = nbs[m];
			if (!accessible(cur, nx)) continue;
			if (search.state[nx] === 2) continue;
			const ng = search.g[cur] + 1;
			if (algo === "bfs" || algo === "dfs") {
				if (search.state[nx] === 0) {
					search.state[nx] = 1;
					search.came[nx] = cur;
					search.g[nx] = ng;
					search.list.push(nx);
				}
			} else {
				if (ng < search.g[nx]) {
					search.g[nx] = ng;
					search.came[nx] = cur;
					search.state[nx] = 1;
					const f = algo === "astar" ? ng + heuristic(nx) : ng;
					search.heap.push({ idx: nx, f: f });
				}
			}
		}
	}
}

function reconstruct(found) {
	pathCells = [];
	if (found) {
		let cur = goalIdx;
		while (cur !== -1) { pathCells.push(cur); cur = search.came[cur]; }
		pathCells.reverse();
	}
	pathAnim = 0;
	phase = "done";
	setStatus(found
		? "Path found · " + search.expanded + " expanded · " + pathCells.length + " steps"
		: "No path · " + search.expanded + " expanded");
}
// #endregion

function setStatus(s) { statusLabel.textContent = s; }

function applyThemeColors(light) {
	isLight = light;
	backgroundCanvas.style.background = light ? lightBg : darkBg;
}

// #region render
function fillCell(i, style) {
	ctx.fillStyle = style;
	ctx.fillRect(cx(i) * cellSize, cy(i) * cellSize, cellSize, cellSize);
}

function render() {
	ctx.fillStyle = isLight ? lightBg : darkBg;
	ctx.fillRect(0, 0, canvasWidth, canvasHeight);

	// visited / frontier overlays
	if (search) {
		const st = search.state;
		for (let i = 0; i < st.length; i++) {
			if (st[i] === 2) fillCell(i, isLight ? "rgba(245,166,35,0.18)" : "rgba(245,166,35,0.14)");
			else if (st[i] === 1) fillCell(i, isLight ? "rgba(255,107,71,0.4)" : "rgba(255,107,71,0.35)");
		}
	}

	// generation frontier
	if (phase === "gen") {
		for (let i = 0; i < genVisited.length; i++) if (genVisited[i]) fillCell(i, isLight ? "rgba(120,120,140,0.12)" : "rgba(180,180,210,0.08)");
		if (genStack.length) fillCell(genStack[genStack.length - 1], "rgba(255,107,71,0.6)");
	}

	// path (animated reveal)
	if (pathCells.length) {
		const upto = Math.min(pathAnim, pathCells.length);
		ctx.save();
		if (!isLight) { ctx.shadowBlur = 14; ctx.shadowColor = "#ffb84d"; }
		ctx.strokeStyle = isLight ? "#c25a00" : "#ffd27a";
		ctx.lineWidth = Math.max(2, cellSize * 0.28);
		ctx.lineJoin = "round";
		ctx.lineCap = "round";
		ctx.beginPath();
		for (let k = 0; k < upto; k++) {
			const i = pathCells[k];
			const px = cx(i) * cellSize + cellSize / 2;
			const py = cy(i) * cellSize + cellSize / 2;
			if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
		}
		ctx.stroke();
		ctx.restore();
	}

	// walls
	ctx.strokeStyle = isLight ? "#2a2a30" : "#c9c4b4";
	ctx.lineWidth = 1.5;
	ctx.beginPath();
	for (let i = 0; i < walls.length; i++) {
		const x = cx(i) * cellSize, y = cy(i) * cellSize;
		const w = walls[i];
		if (w & N) { ctx.moveTo(x, y); ctx.lineTo(x + cellSize, y); }
		if (w & W) { ctx.moveTo(x, y); ctx.lineTo(x, y + cellSize); }
		if (w & E) { ctx.moveTo(x + cellSize, y); ctx.lineTo(x + cellSize, y + cellSize); }
		if (w & S) { ctx.moveTo(x, y + cellSize); ctx.lineTo(x + cellSize, y + cellSize); }
	}
	ctx.stroke();

	// start / goal markers
	fillCell(startIdx, isLight ? "rgba(40,150,80,0.85)" : "rgba(80,210,120,0.85)");
	fillCell(goalIdx, isLight ? "rgba(200,40,40,0.8)" : "rgba(255,90,90,0.85)");
}
// #endregion

// #region init
initGrid();
applyThemeColors(isLight);
generate();
document.addEventListener("themechange", function (e) { applyThemeColors(e.detail.isLight); });
// #endregion

// #region resize
window.addEventListener("resize", function () {
	canvasWidth = window.getCanvasWidth();
	canvasHeight = window.innerHeight;
	if (window._hudToggling) return;
	applyCanvasSize();
	generate();
});
// #endregion

// #region inputs
function bindSlider(id, valId, parse, onChange, fmt) {
	const slider = document.getElementById(id);
	const label = document.getElementById(valId);
	slider.value = onChange.initial;
	label.innerHTML = fmt ? fmt(onChange.initial) : onChange.initial;
	slider.oninput = function () {
		const v = parse(this.value);
		label.innerHTML = fmt ? fmt(v) : v;
		onChange(v);
	};
}

bindSlider("cellSlider", "cellValue", parseInt, Object.assign(function (v) {
	cellSize = v;
	generate();
}, { initial: cellSize }));

bindSlider("speedSlider", "speedValue", parseInt, Object.assign(function (v) {
	searchSpeed = v;
}, { initial: searchSpeed }));

document.querySelectorAll('input[name="algo"]').forEach(function (radio) {
	radio.addEventListener("change", function () { if (this.checked) algo = this.value; });
});

var genAnimCheckbox = document.getElementById("genAnimCheckbox");
genAnimCheckbox.checked = animateGen;
genAnimCheckbox.onclick = function () { animateGen = this.checked; };

var autoCheckbox = document.getElementById("autoCheckbox");
autoCheckbox.checked = autoSolve;
autoCheckbox.onclick = function () { autoSolve = this.checked; };

document.getElementById("newButton").onclick = generate;
document.getElementById("solveButton").onclick = function () {
	if (phase === "gen") return;
	startSearch();
};
document.getElementById("exportButton").onclick = exportPNG;
function exportPNG() {
	const link = document.createElement("a");
	link.download = "maze.png";
	link.href = backgroundCanvas.toDataURL("image/png");
	link.click();
}

window.addEventListener("keydown", function (e) {
	if (e.key === "n" || e.key === "N") generate();
	if (e.key === "Enter") { if (phase !== "gen") startSearch(); }
	if (e.key === "s" || e.key === "S") exportPNG();
});
// #endregion

// #region loop
var fpsBadge = document.getElementById("fpsBadge");

function draw() {
	window.requestAnimationFrame(draw);
	if (document.hidden) return;

	if (phase === "gen") {
		const steps = Math.max(1, Math.floor((cols * rows) / 240));
		for (let s = 0; s < steps; s++) { if (phase !== "gen") break; genStep(); }
	} else if (phase === "solve" && search && !search.done) {
		searchStep();
	} else if (phase === "done" && pathCells.length && pathAnim < pathCells.length) {
		pathAnim += Math.max(1, Math.floor(pathCells.length / 60));
	}

	render();
	fpsBadge.textContent = cols + "×" + rows;
}
window.requestAnimationFrame(draw);
document.addEventListener("visibilitychange", () => { if (!document.hidden) window.requestAnimationFrame(draw); });
// #endregion
