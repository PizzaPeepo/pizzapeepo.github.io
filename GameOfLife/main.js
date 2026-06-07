// Conway's Game of Life — paintable grid, presets, wrap toggle, age colouring.

// #region globals
var canvasWidth = window.getCanvasWidth();
var canvasHeight = window.innerHeight;

var cellSize = 8;
var gensPerSec = 12;
var density = 0.28;
var wrap = true;
var showGrid = false;
var colorByAge = true;
var paused = false;

var cols, rows;
var grid, next, age;
var generation = 0;

var darkBg = "#0c0f0c";
var lightBg = "#eef1ea";
var isLight = document.documentElement.classList.contains("light");
// #endregion

// #region canvas
var backgroundCanvas = document.getElementById("backgroundCanvas");
var ctx = backgroundCanvas.getContext("2d");

function applyCanvasSize() {
	backgroundCanvas.width = canvasWidth;
	backgroundCanvas.height = canvasHeight;
	backgroundCanvas.style.width = canvasWidth + "px";
	backgroundCanvas.style.height = canvasHeight + "px";
}
applyCanvasSize();
// #endregion

function allocate() {
	cols = Math.max(1, Math.floor(canvasWidth / cellSize));
	rows = Math.max(1, Math.floor(canvasHeight / cellSize));
	grid = new Uint8Array(cols * rows);
	next = new Uint8Array(cols * rows);
	age = new Uint16Array(cols * rows);
}

function idx(x, y) { return y * cols + x; }

function randomize() {
	for (let i = 0; i < grid.length; i++) {
		grid[i] = Math.random() < density ? 1 : 0;
		age[i] = grid[i];
	}
	generation = 0;
	render();
}

function clearGrid() {
	grid.fill(0); age.fill(0);
	generation = 0;
	render();
}

// Place a pattern (array of [dx,dy] live cells) near the centre.
function placePattern(cells) {
	clearGrid();
	let maxX = 0, maxY = 0;
	for (const [cx, cy] of cells) { if (cx > maxX) maxX = cx; if (cy > maxY) maxY = cy; }
	const ox = Math.floor((cols - maxX) / 2);
	const oy = Math.floor((rows - maxY) / 2);
	for (const [cx, cy] of cells) {
		const x = ox + cx, y = oy + cy;
		if (x >= 0 && x < cols && y >= 0 && y < rows) { grid[idx(x, y)] = 1; age[idx(x, y)] = 1; }
	}
	render();
}

// Gosper glider gun coordinates.
const GLIDER_GUN = [
	[24,0],[22,1],[24,1],[12,2],[13,2],[20,2],[21,2],[34,2],[35,2],
	[11,3],[15,3],[20,3],[21,3],[34,3],[35,3],[0,4],[1,4],[10,4],[16,4],[20,4],[21,4],
	[0,5],[1,5],[10,5],[14,5],[16,5],[17,5],[22,5],[24,5],[10,6],[16,6],[24,6],
	[11,7],[15,7],[12,8],[13,8],
];

// Pulsar — period-3 oscillator, the standard symmetric 13×13 figure.
const PULSAR = [
	[2,0],[3,0],[4,0],[8,0],[9,0],[10,0],
	[0,2],[5,2],[7,2],[12,2],
	[0,3],[5,3],[7,3],[12,3],
	[0,4],[5,4],[7,4],[12,4],
	[2,5],[3,5],[4,5],[8,5],[9,5],[10,5],
	[2,7],[3,7],[4,7],[8,7],[9,7],[10,7],
	[0,8],[5,8],[7,8],[12,8],
	[0,9],[5,9],[7,9],[12,9],
	[0,10],[5,10],[7,10],[12,10],
	[2,12],[3,12],[4,12],[8,12],[9,12],[10,12],
];

// Pentadecathlon — period-15 oscillator.
const PENTADECATHLON = [
	[1,0],[1,1],[0,2],[2,2],[1,3],[1,4],[1,5],[1,6],[0,7],[2,7],[1,8],[1,9],
];

function applyThemeColors(light) {
	isLight = light;
	backgroundCanvas.style.background = light ? lightBg : darkBg;
	render();
}

function step() {
	for (let y = 0; y < rows; y++) {
		for (let x = 0; x < cols; x++) {
			let n = 0;
			for (let dy = -1; dy <= 1; dy++) {
				for (let dx = -1; dx <= 1; dx++) {
					if (dx === 0 && dy === 0) continue;
					let nx = x + dx, ny = y + dy;
					if (wrap) {
						nx = (nx + cols) % cols;
						ny = (ny + rows) % rows;
					} else if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) {
						continue;
					}
					n += grid[ny * cols + nx];
				}
			}
			const i = y * cols + x;
			const alive = grid[i];
			const live = alive ? (n === 2 || n === 3) : (n === 3);
			next[i] = live ? 1 : 0;
			if (live) age[i] = alive ? Math.min(age[i] + 1, 4000) : 1;
			else age[i] = 0;
		}
	}
	const tmp = grid; grid = next; next = tmp;
	generation++;
}

// #region render
function ageColor(a) {
	// young = warm/bright, old = cool/settled
	const t = Math.min(a / 60, 1);
	const hue = 130 - t * 130; // green -> red as it survives
	const lum = isLight ? 42 : 58;
	return `hsl(${hue}, 70%, ${lum}%)`;
}

function render() {
	ctx.fillStyle = isLight ? lightBg : darkBg;
	ctx.fillRect(0, 0, canvasWidth, canvasHeight);

	const liveColor = isLight ? "#2a2a2a" : "#e8e2d4";
	for (let y = 0; y < rows; y++) {
		for (let x = 0; x < cols; x++) {
			const i = y * cols + x;
			if (!grid[i]) continue;
			ctx.fillStyle = colorByAge ? ageColor(age[i]) : liveColor;
			ctx.fillRect(x * cellSize, y * cellSize, cellSize - (showGrid ? 1 : 0), cellSize - (showGrid ? 1 : 0));
		}
	}

	if (showGrid && cellSize >= 6) {
		ctx.strokeStyle = isLight ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.06)";
		ctx.lineWidth = 1;
		ctx.beginPath();
		for (let x = 0; x <= cols; x++) { ctx.moveTo(x * cellSize, 0); ctx.lineTo(x * cellSize, rows * cellSize); }
		for (let y = 0; y <= rows; y++) { ctx.moveTo(0, y * cellSize); ctx.lineTo(cols * cellSize, y * cellSize); }
		ctx.stroke();
	}
}
// #endregion

// #region init
allocate();
randomize();
applyThemeColors(isLight);
document.addEventListener("themechange", function (e) { applyThemeColors(e.detail.isLight); });
// #endregion

// #region resize
window.addEventListener("resize", function () {
	canvasWidth = window.getCanvasWidth();
	canvasHeight = window.innerHeight;
	if (window._hudToggling) return;
	applyCanvasSize();
	allocate();
	randomize();
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
	allocate();
	randomize();
}, { initial: cellSize }));

bindSlider("speedSlider", "speedValue", parseInt, Object.assign(function (v) {
	gensPerSec = v;
}, { initial: gensPerSec }));

bindSlider("densitySlider", "densityValue", parseInt, Object.assign(function (v) {
	density = v / 100;
}, { initial: density * 100 }));

var wrapCheckbox = document.getElementById("wrapCheckbox");
wrapCheckbox.checked = wrap;
wrapCheckbox.onclick = function () { wrap = this.checked; };

var gridCheckbox = document.getElementById("gridCheckbox");
gridCheckbox.checked = showGrid;
gridCheckbox.onclick = function () { showGrid = this.checked; render(); };

var ageCheckbox = document.getElementById("ageCheckbox");
ageCheckbox.checked = colorByAge;
ageCheckbox.onclick = function () { colorByAge = this.checked; render(); };

document.getElementById("randomButton").onclick = randomize;
document.getElementById("clearButton").onclick = clearGrid;
document.getElementById("gliderGunButton").onclick = function () { placePattern(GLIDER_GUN); };
document.getElementById("pulsarButton").onclick = function () { placePattern(PULSAR); };
document.getElementById("pentaButton").onclick = function () { placePattern(PENTADECATHLON); };

var pauseButton = document.getElementById("pauseButton");
pauseButton.onclick = togglePause;
function togglePause() {
	paused = !paused;
	pauseButton.textContent = paused ? "Resume (Space)" : "Pause (Space)";
}

document.getElementById("stepButton").onclick = function () { step(); render(); };


window.addEventListener("keydown", function (e) {
	if (e.code === "Space") { e.preventDefault(); togglePause(); }
	if (e.key === "ArrowRight") { step(); render(); }
	if (e.key === "r" || e.key === "R") randomize();
	if (e.key === "c" || e.key === "C") clearGrid();
});
// #endregion

// #region painting
var painting = false;
var paintValue = 1;

function paintAt(clientX, clientY) {
	const rect = backgroundCanvas.getBoundingClientRect();
	const x = Math.floor((clientX - rect.left) / cellSize);
	const y = Math.floor((clientY - rect.top) / cellSize);
	if (x < 0 || x >= cols || y < 0 || y >= rows) return;
	const i = idx(x, y);
	grid[i] = paintValue;
	age[i] = paintValue;
	render();
}

backgroundCanvas.addEventListener("mousedown", function (e) {
	painting = true;
	paintValue = e.button === 2 ? 0 : 1;
	paintAt(e.clientX, e.clientY);
});
window.addEventListener("mousemove", function (e) { if (painting) paintAt(e.clientX, e.clientY); });
window.addEventListener("mouseup", function () { painting = false; });
backgroundCanvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });
// #endregion

// #region loop
var fpsBadge = document.getElementById("fpsBadge");
var lastStep = performance.now();

function draw(now) {
	window.requestAnimationFrame(draw);
	if (document.hidden) return;

	if (!paused) {
		const interval = 1000 / gensPerSec;
		if (now - lastStep >= interval) {
			step();
			render();
			lastStep = now;
		}
	}
	fpsBadge.textContent = "gen " + generation;
}
window.requestAnimationFrame(draw);
document.addEventListener("visibilitychange", () => { if (!document.hidden) { lastStep = performance.now(); window.requestAnimationFrame(draw); } });
// #endregion
