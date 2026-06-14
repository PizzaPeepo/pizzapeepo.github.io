// Gray-Scott reaction-diffusion. Two chemicals U, V on a toroidal grid.
//   U' = dA·∇²U − U·V² + f·(1−U)
//   V' = dB·∇²V + U·V² − (f+k)·V
// Simulated on a fixed grid, rendered scaled to the canvas.

// #region globals
var canvasWidth = window.getCanvasWidth();
var canvasHeight = window.innerHeight;

var feed = 0.0545;
var kill = 0.062;
var stepsPerFrame = 10;
var gridW = 200;
var brushSize = 8;
var palette = document.documentElement.classList.contains("viper") ? "viper" : "ember"; // viper | ember | ice | mono
var paused = false;

const dA = 1.0, dB = 0.5;

var gridH = 1;
var U, V, U2, V2;

// #endregion

// #region canvas
var backgroundCanvas = document.getElementById("backgroundCanvas");
var ctx = backgroundCanvas.getContext("2d");

var buffer = document.createElement("canvas");
var bctx = buffer.getContext("2d");
var imageData = null, pixels = null;

function applyCanvasSize() {
	backgroundCanvas.width = canvasWidth;
	backgroundCanvas.height = canvasHeight;
	backgroundCanvas.style.width = canvasWidth + "px";
	backgroundCanvas.style.height = canvasHeight + "px";
	ctx.imageSmoothingEnabled = true;
	allocate();
}

function allocate() {
	gridH = Math.max(1, Math.round(gridW * canvasHeight / canvasWidth));
	const n = gridW * gridH;
	U = new Float32Array(n);
	V = new Float32Array(n);
	U2 = new Float32Array(n);
	V2 = new Float32Array(n);
	buffer.width = gridW;
	buffer.height = gridH;
	imageData = bctx.createImageData(gridW, gridH);
	pixels = imageData.data;
	reseed();
}
// #endregion

function clearGrid() {
	U.fill(1); V.fill(0);
}

function seedBlob(cx, cy, r) {
	for (let y = -r; y <= r; y++) {
		for (let x = -r; x <= r; x++) {
			if (x * x + y * y > r * r) continue;
			const gx = (cx + x + gridW) % gridW;
			const gy = (cy + y + gridH) % gridH;
			V[gy * gridW + gx] = 1;
		}
	}
}

function reseed() {
	clearGrid();
	// a few random seed blobs + centre
	seedBlob(gridW >> 1, gridH >> 1, Math.max(4, gridW * 0.04));
	for (let i = 0; i < 4; i++) {
		seedBlob((Math.random() * gridW) | 0, (Math.random() * gridH) | 0, Math.max(3, gridW * 0.02));
	}
}

applyCanvasSize();

// #region simulation
function laplacianStep() {
	const w = gridW, h = gridH;
	for (let y = 0; y < h; y++) {
		const yn = ((y - 1 + h) % h) * w;
		const yp = ((y + 1) % h) * w;
		const yc = y * w;
		for (let x = 0; x < w; x++) {
			const xn = (x - 1 + w) % w;
			const xp = (x + 1) % w;
			const i = yc + x;

			// weighted Laplacian (orthogonal 0.2, diagonal 0.05, centre -1)
			const lu =
				U[yc + xn] * 0.2 + U[yc + xp] * 0.2 + U[yn + x] * 0.2 + U[yp + x] * 0.2 +
				U[yn + xn] * 0.05 + U[yn + xp] * 0.05 + U[yp + xn] * 0.05 + U[yp + xp] * 0.05 -
				U[i];
			const lv =
				V[yc + xn] * 0.2 + V[yc + xp] * 0.2 + V[yn + x] * 0.2 + V[yp + x] * 0.2 +
				V[yn + xn] * 0.05 + V[yn + xp] * 0.05 + V[yp + xn] * 0.05 + V[yp + xp] * 0.05 -
				V[i];

			const u = U[i], v = V[i];
			const uvv = u * v * v;
			let nu = u + (dA * lu - uvv + feed * (1 - u));
			let nv = v + (dB * lv + uvv - (kill + feed) * v);
			if (nu < 0) nu = 0; else if (nu > 1) nu = 1;
			if (nv < 0) nv = 0; else if (nv > 1) nv = 1;
			U2[i] = nu; V2[i] = nv;
		}
	}
	let tmp = U; U = U2; U2 = tmp;
	tmp = V; V = V2; V2 = tmp;
}
// #endregion

// #region render
function colorFor(v, p) {
	let r, g, b;
	if (palette === "mono") {
		const c = Math.round(v * 255);
		r = g = b = c;
	} else if (palette === "ice") {
		r = Math.round(v * 120);
		g = Math.round(40 + v * 180);
		b = Math.round(80 + v * 175);
	} else if (palette === "viper") {
		const g2 = v * v;
		const baseR = 40 * g2;
		const baseG = 255 * v;
		const baseB = 69 * g2;
		const w = Math.max(0, (v - 0.8) / 0.2)*0.75;
		r = Math.round(baseR + (255 - baseR) * w);
		g = Math.round(baseG + (255 - baseG) * w);
		b = Math.round(baseB + (255 - baseB) * w);
	} else {
		// ember: black -> deep red -> orange -> pale gold
		r = Math.round(Math.min(1, v * 2.2) * 255);
		g = Math.round(Math.max(0, Math.min(1, v * 2.2 - 0.7)) * 200);
		b = Math.round(Math.max(0, v * 2.2 - 1.5) * 255);
	}
	pixels[p] = r; pixels[p + 1] = g; pixels[p + 2] = b; pixels[p + 3] = 255;
}

function render() {
	const n = gridW * gridH;
	for (let i = 0, p = 0; i < n; i++, p += 4) {
		// display U - V gives crisp contrast between the two phases
		let v = U[i] - V[i];
		v = 1 - v; // invert so V-rich regions glow
		if (v < 0) v = 0; else if (v > 1) v = 1;
		colorFor(v, p);
	}
	bctx.putImageData(imageData, 0, 0);
	ctx.drawImage(buffer, 0, 0, gridW, gridH, 0, 0, canvasWidth, canvasHeight);
}
// #endregion

// #region resize
window.addEventListener("resize", function () {
	canvasWidth = window.getCanvasWidth();
	canvasHeight = window.innerHeight;
	if (window._hudToggling) return;
	applyCanvasSize();
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

var feedSlider = document.getElementById("feedSlider");
var feedLabel = document.getElementById("feedValue");
var killSlider = document.getElementById("killSlider");
var killLabel = document.getElementById("killValue");

bindSlider("feedSlider", "feedValue", parseFloat, Object.assign(function (v) {
	feed = v;
}, { initial: feed }), (v) => v.toFixed(4));

bindSlider("killSlider", "killValue", parseFloat, Object.assign(function (v) {
	kill = v;
}, { initial: kill }), (v) => v.toFixed(4));

bindSlider("stepsSlider", "stepsValue", parseInt, Object.assign(function (v) {
	stepsPerFrame = v;
}, { initial: stepsPerFrame }));

bindSlider("resSlider", "resValue", parseInt, Object.assign(function (v) {
	gridW = v;
	allocate();
}, { initial: gridW }));

bindSlider("brushSlider", "brushValue", parseInt, Object.assign(function (v) {
	brushSize = v;
}, { initial: brushSize }));

document.querySelectorAll('input[name="palette"]').forEach(function (radio) {
	radio.addEventListener("change", function () { if (this.checked) palette = this.value; });
});
(function () {
	var r = document.querySelector('input[name="palette"][value="' + palette + '"]');
	if (r) r.checked = true;
})();

document.querySelectorAll('[data-f]').forEach(function (btn) {
	btn.addEventListener("click", function () {
		feed = parseFloat(this.dataset.f);
		kill = parseFloat(this.dataset.k);
		feedSlider.value = feed; feedLabel.textContent = feed.toFixed(4);
		killSlider.value = kill; killLabel.textContent = kill.toFixed(4);
	});
});

document.getElementById("seedButton").onclick = reseed;
document.getElementById("clearButton").onclick = clearGrid;

var pauseButton = document.getElementById("pauseButton");
pauseButton.onclick = togglePause;
function togglePause() {
	paused = !paused;
	pauseButton.textContent = paused ? "Resume (Space)" : "Pause (Space)";
}


window.addEventListener("keydown", function (e) {
	if (e.code === "Space") { e.preventDefault(); togglePause(); }
	if (e.key === "r" || e.key === "R") reseed();
});
// #endregion

// #region brush
var painting = false;
function paintAt(clientX, clientY) {
	const rect = backgroundCanvas.getBoundingClientRect();
	const gx = Math.floor((clientX - rect.left) / canvasWidth * gridW);
	const gy = Math.floor((clientY - rect.top) / canvasHeight * gridH);
	seedBlob(gx, gy, brushSize);
}
backgroundCanvas.addEventListener("mousedown", function (e) { painting = true; paintAt(e.clientX, e.clientY); });
window.addEventListener("mousemove", function (e) { if (painting) paintAt(e.clientX, e.clientY); });
window.addEventListener("mouseup", function () { painting = false; });
// #endregion

document.addEventListener("themechange", function (e) {
	if (e.detail.theme === "viper") palette = "viper";
	else if (palette === "viper") palette = "ember";
	var r = document.querySelector('input[name="palette"][value="' + palette + '"]');
	if (r) r.checked = true;
});

// #region loop
var fpsBadge = document.getElementById("fpsBadge");
var lastFpsUpdate = performance.now();
var frameCount = 0;

function draw(now) {
	window.requestAnimationFrame(draw);
	if (document.hidden) return;

	if (!paused) {
		for (let s = 0; s < stepsPerFrame; s++) laplacianStep();
	}
	render();

	frameCount++;
	if (now - lastFpsUpdate >= 500) {
		const fps = Math.round((frameCount * 1000) / (now - lastFpsUpdate));
		fpsBadge.textContent = fps + " fps · " + gridW + "×" + gridH;
		frameCount = 0;
		lastFpsUpdate = now;
	}
}
window.requestAnimationFrame(draw);
document.addEventListener("visibilitychange", () => { if (!document.hidden) window.requestAnimationFrame(draw); });
// #endregion
