// Physarum (slime mould) — agents sense a trail map ahead, turn toward the
// strongest scent, deposit as they move. The map diffuses and evaporates each
// frame, so simple sense-and-turn rules grow emergent transport networks.

// #region globals
var canvasWidth = window.getCanvasWidth();
var canvasHeight = window.innerHeight;

var agentCount = 12000;
var sensorAngle = 0.5;   // radians
var sensorDist = 9;      // sim px
var turnSpeed = 0.45;    // radians per step
var stepSize = 1.0;      // sim px per step
var decay = 0.10;        // evaporation fraction per frame
var palette = "gold";    // gold | plasma | mono
var paused = false;

var simW = 480, simH = 1;
var trail, trail2;       // Float32Array scent maps
var agents = null;       // packed [x, y, heading] × N

var depositAmount = 1.0;
var maxDisplay = 6.0;    // scent value mapped to full brightness

var mouse = { x: 0, y: 0, active: false };

var isLight = document.documentElement.classList.contains("light");
var isViper = document.documentElement.classList.contains("viper");
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
	simH = Math.max(1, Math.round(simW * canvasHeight / canvasWidth));
	trail = new Float32Array(simW * simH);
	trail2 = new Float32Array(simW * simH);
	buffer.width = simW;
	buffer.height = simH;
	imageData = bctx.createImageData(simW, simH);
	pixels = imageData.data;
	spawnAgents();
}
// #endregion

function spawnAgents() {
	agents = new Float32Array(agentCount * 3);
	const cx = simW / 2, cy = simH / 2;
	const r = Math.min(simW, simH) * 0.3;
	for (let i = 0; i < agentCount; i++) {
		const a = Math.random() * Math.PI * 2;
		const rr = Math.sqrt(Math.random()) * r;
		agents[i * 3] = cx + Math.cos(a) * rr;
		agents[i * 3 + 1] = cy + Math.sin(a) * rr;
		agents[i * 3 + 2] = Math.random() * Math.PI * 2;
	}
	if (trail) trail.fill(0);
}

function reset() {
	if (trail) trail.fill(0);
	spawnAgents();
}

applyCanvasSize();

// #region simulation
function sampleTrail(x, y) {
	let xi = x | 0, yi = y | 0;
	xi = ((xi % simW) + simW) % simW;
	yi = ((yi % simH) + simH) % simH;
	return trail[yi * simW + xi];
}

function stepAgents() {
	const N = agentCount;
	const sa = sensorAngle, sd = sensorDist, turn = turnSpeed, step = stepSize;
	const mAttract = mouse.active;
	const mx = mouse.x, my = mouse.y;

	for (let i = 0; i < N; i++) {
		const o = i * 3;
		let x = agents[o], y = agents[o + 1], h = agents[o + 2];

		// three sensors
		const fx = x + Math.cos(h) * sd, fy = y + Math.sin(h) * sd;
		const lx = x + Math.cos(h - sa) * sd, ly = y + Math.sin(h - sa) * sd;
		const rx = x + Math.cos(h + sa) * sd, ry = y + Math.sin(h + sa) * sd;
		const F = sampleTrail(fx, fy);
		const L = sampleTrail(lx, ly);
		const R = sampleTrail(rx, ry);

		if (F > L && F > R) {
			// keep heading
		} else if (F < L && F < R) {
			h += (Math.random() < 0.5 ? -1 : 1) * turn;
		} else if (R > L) {
			h += turn;
		} else if (L > R) {
			h -= turn;
		}

		// gentle pull toward the mouse when dragging
		if (mAttract) {
			const dx = mx - x, dy = my - y;
			const target = Math.atan2(dy, dx);
			let diff = target - h;
			while (diff > Math.PI) diff -= Math.PI * 2;
			while (diff < -Math.PI) diff += Math.PI * 2;
			h += diff * 0.08;
		}

		x += Math.cos(h) * step;
		y += Math.sin(h) * step;

		// wrap
		if (x < 0) x += simW; else if (x >= simW) x -= simW;
		if (y < 0) y += simH; else if (y >= simH) y -= simH;

		agents[o] = x; agents[o + 1] = y; agents[o + 2] = h;

		// deposit
		const ti = (y | 0) * simW + (x | 0);
		const nv = trail[ti] + depositAmount;
		trail[ti] = nv > maxDisplay ? maxDisplay : nv;
	}
}

function diffuseAndDecay() {
	const w = simW, h = simH;
	const keep = 1 - decay;
	for (let y = 0; y < h; y++) {
		const yn = ((y - 1 + h) % h) * w;
		const yp = ((y + 1) % h) * w;
		const yc = y * w;
		for (let x = 0; x < w; x++) {
			const xn = (x - 1 + w) % w;
			const xp = (x + 1) % w;
			const sum =
				trail[yc + xn] + trail[yc + x] + trail[yc + xp] +
				trail[yn + xn] + trail[yn + x] + trail[yn + xp] +
				trail[yp + xn] + trail[yp + x] + trail[yp + xp];
			trail2[yc + x] = (sum / 9) * keep;
		}
	}
	const tmp = trail; trail = trail2; trail2 = tmp;
}
// #endregion

// #region render
function render() {
	const n = simW * simH;
	const inv = 1 / maxDisplay;
	for (let i = 0, p = 0; i < n; i++, p += 4) {
		let v = trail[i] * inv;
		if (v > 1) v = 1;
		let r, g, b;
		if (palette === "mono") {
			const c = Math.round(v * 255);
			if (isViper) { r = Math.round(c * 0.08); g = c; b = Math.round(c * 0.25); }
			else { r = g = b = isLight ? 255 - c : c; }
		} else if (palette === "plasma") {
			r = Math.round(Math.min(1, v * 1.6) * 255);
			g = Math.round(Math.max(0, Math.min(1, v * 1.8 - 0.3)) * 120);
			b = Math.round(Math.max(0, Math.min(1, 1.2 - v * 1.5)) * 200);
		} else {
			// gold
			r = Math.round(Math.min(1, v * 1.7) * 255);
			g = Math.round(Math.min(1, v * 1.2) * 200);
			b = Math.round(Math.max(0, v * 1.4 - 0.6) * 180);
		}
		pixels[p] = r; pixels[p + 1] = g; pixels[p + 2] = b; pixels[p + 3] = 255;
	}
	bctx.putImageData(imageData, 0, 0);
	ctx.drawImage(buffer, 0, 0, simW, simH, 0, 0, canvasWidth, canvasHeight);
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

bindSlider("countSlider", "countValue", parseInt, Object.assign(function (v) {
	agentCount = v;
	spawnAgents();
}, { initial: agentCount }));

bindSlider("sensorAngleSlider", "sensorAngleValue", parseInt, Object.assign(function (v) {
	sensorAngle = v * Math.PI / 180;
}, { initial: Math.round(sensorAngle * 180 / Math.PI) }));

bindSlider("sensorDistSlider", "sensorDistValue", parseInt, Object.assign(function (v) {
	sensorDist = v;
}, { initial: sensorDist }));

bindSlider("turnSlider", "turnValue", parseInt, Object.assign(function (v) {
	turnSpeed = v * Math.PI / 180;
}, { initial: Math.round(turnSpeed * 180 / Math.PI) }));

bindSlider("stepSlider", "stepValue", parseFloat, Object.assign(function (v) {
	stepSize = v;
}, { initial: stepSize }), (v) => v.toFixed(1));

bindSlider("decaySlider", "decayValue", parseInt, Object.assign(function (v) {
	decay = v / 100;
}, { initial: Math.round(decay * 100) }));

document.querySelectorAll('input[name="palette"]').forEach(function (radio) {
	radio.addEventListener("change", function () { if (this.checked) palette = this.value; });
});

var pauseButton = document.getElementById("pauseButton");
pauseButton.onclick = togglePause;
function togglePause() {
	paused = !paused;
	pauseButton.textContent = paused ? "Resume (Space)" : "Pause (Space)";
}

document.getElementById("resetButton").onclick = reset;

window.addEventListener("keydown", function (e) {
	if (e.code === "Space") { e.preventDefault(); togglePause(); }
	if (e.key === "r" || e.key === "R") reset();
});
// #endregion

// #region mouse
function setMouse(e) {
	const rect = backgroundCanvas.getBoundingClientRect();
	mouse.x = (e.clientX - rect.left) / canvasWidth * simW;
	mouse.y = (e.clientY - rect.top) / canvasHeight * simH;
}
backgroundCanvas.addEventListener("mousedown", function (e) { mouse.active = true; setMouse(e); });
window.addEventListener("mousemove", function (e) { if (mouse.active) setMouse(e); });
window.addEventListener("mouseup", function () { mouse.active = false; });
// #endregion

document.addEventListener("themechange", function (e) { isLight = e.detail.isLight; isViper = e.detail.theme === "viper"; });

// #region loop
var fpsBadge = document.getElementById("fpsBadge");
var lastFpsUpdate = performance.now();
var frameCount = 0;

function draw(now) {
	window.requestAnimationFrame(draw);
	if (document.hidden) return;

	if (!paused) {
		stepAgents();
		diffuseAndDecay();
	}
	render();

	frameCount++;
	if (now - lastFpsUpdate >= 500) {
		const fps = Math.round((frameCount * 1000) / (now - lastFpsUpdate));
		fpsBadge.textContent = fps + " fps · " + (agentCount / 1000) + "k";
		frameCount = 0;
		lastFpsUpdate = now;
	}
}
window.requestAnimationFrame(draw);
document.addEventListener("visibilitychange", () => { if (!document.hidden) window.requestAnimationFrame(draw); });
// #endregion
