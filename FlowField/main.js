import "../Utils/simplexNoise.js"; // sets window.SimplexNoise

// #region globals
var canvasWidth = window.getCanvasWidth();
var canvasHeight = window.innerHeight;

const cfg = {
	count: 1800,
	scale: 22,       // larger = smoother, broader field cells (divides into noise freq)
	speed: 1.6,
	evolve: 0.6,     // how fast the field morphs over time
	curl: 2.0,       // turns of rotation the noise maps onto (×2π)
};

var colorMode = "angle"; // angle | speed | mono
var fadeSpeed = 0.06;
var showField = false;
var paused = false;

var particles = [];
var simplex = new SimplexNoise(Date.now());
var fieldTime = 0;
var maxLife = 220;

var darkCanvasBg = "#0d0b14";
var viperCanvasBg = "#030806";
var lightCanvasBg = "#f3eee6";
var isLight = document.documentElement.classList.contains("light");
var isViper = document.documentElement.classList.contains("viper");

// cursor vortex — particles swirl around the pointer
var mouse = { x: 0, y: 0, inside: false };
const MOUSE_RADIUS = 160;
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

// #region theme
function clearCanvas() {
	ctx.fillStyle = isLight ? lightCanvasBg : isViper ? viperCanvasBg : darkCanvasBg;
	ctx.fillRect(0, 0, canvasWidth, canvasHeight);
}
function applyThemeColors(light) {
	isLight = light;
	isViper = document.documentElement.classList.contains("viper");
	backgroundCanvas.style.background = light ? lightCanvasBg : isViper ? viperCanvasBg : darkCanvasBg;
	clearCanvas();
}
applyThemeColors(isLight);
document.addEventListener("themechange", function (e) { isViper = e.detail.theme === "viper"; applyThemeColors(e.detail.isLight); });
// #endregion

function spawnParticle(p) {
	p = p || {};
	p.x = Math.random() * canvasWidth;
	p.y = Math.random() * canvasHeight;
	p.px = p.x;
	p.py = p.y;
	p.life = Math.floor(Math.random() * maxLife);
	return p;
}

function buildParticles() {
	particles = [];
	for (let i = 0; i < cfg.count; i++) particles.push(spawnParticle());
	clearCanvas();
}
buildParticles();

function newField() {
	simplex = new SimplexNoise(Date.now() + Math.random() * 1e6);
	clearCanvas();
}

// Field angle at a point — simplex noise mapped onto a rotation.
function fieldAngle(x, y) {
	const f = 1 / (cfg.scale * 12); // spatial frequency
	const n = simplex.noise3D(x * f, y * f, fieldTime); // -1..1
	return n * Math.PI * cfg.curl;
}

// #region resize
window.addEventListener("resize", function () {
	canvasWidth = window.getCanvasWidth();
	canvasHeight = window.innerHeight;
	if (window._hudToggling) return;
	applyCanvasSize();
	buildParticles();
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
	cfg.count = v;
	buildParticles();
}, { initial: cfg.count }));

bindSlider("scaleSlider", "scaleValue", parseInt, Object.assign(function (v) {
	cfg.scale = v;
}, { initial: cfg.scale }));

bindSlider("speedSlider", "speedValue", parseFloat, Object.assign(function (v) {
	cfg.speed = v;
}, { initial: cfg.speed }), (v) => v.toFixed(1));

bindSlider("evolveSlider", "evolveValue", parseFloat, Object.assign(function (v) {
	cfg.evolve = v;
}, { initial: cfg.evolve }), (v) => v.toFixed(2));

bindSlider("curlSlider", "curlValue", parseFloat, Object.assign(function (v) {
	cfg.curl = v;
}, { initial: cfg.curl }), (v) => v.toFixed(1));

bindSlider("fadeSpeedSlider", "fadeSpeedValue", parseInt, Object.assign(function (v) {
	fadeSpeed = v / 100;
}, { initial: fadeSpeed * 100 }));

document.querySelectorAll('input[name="colorMode"]').forEach(function (radio) {
	radio.addEventListener("change", function () {
		if (this.checked) colorMode = this.value;
	});
});

var showFieldCheckbox = document.getElementById("showFieldCheckbox");
showFieldCheckbox.checked = showField;
showFieldCheckbox.onclick = function () { showField = this.checked; };

var pauseButton = document.getElementById("pauseButton");
pauseButton.onclick = togglePause;
function togglePause() {
	paused = !paused;
	pauseButton.textContent = paused ? "Resume (Space)" : "Pause (Space)";
}

document.getElementById("seedButton").onclick = newField;
document.getElementById("resetButton").onclick = buildParticles;


window.addEventListener("keydown", function (e) {
	if (e.code === "Space") { e.preventDefault(); togglePause(); }
	if (e.key === "r" || e.key === "R") buildParticles();
	if (e.key === "n" || e.key === "N") newField();
});

window.addEventListener("mousemove", function (e) {
	const r = backgroundCanvas.getBoundingClientRect();
	mouse.x = e.clientX - r.left;
	mouse.y = e.clientY - r.top;
	mouse.inside = mouse.x >= 0 && mouse.x < canvasWidth && mouse.y >= 0 && mouse.y < canvasHeight;
});
window.addEventListener("mouseout", function () { mouse.inside = false; });
// #endregion

// #region rendering helpers
function strokeColor(angle, speed) {
	if (colorMode === "mono") {
		return isLight ? "rgba(40,30,20,0.5)" : isViper ? "rgba(40,255,69,0.45)" : "rgba(230,220,205,0.5)";
	}
	if (colorMode === "speed") {
		const t = Math.min(speed / (cfg.speed * 1.5), 1);
		const hue = 50 - t * 50; // gold -> red
		return `hsla(${hue}, 90%, ${isLight ? 45 : 60}%, 0.55)`;
	}
	// by direction
	const hue = ((angle * 57.2958) % 360 + 360) % 360;
	return `hsla(${hue}, 75%, ${isLight ? 50 : 62}%, 0.5)`;
}

function drawFieldArrows() {
	const step = cfg.scale * 4;
	ctx.strokeStyle = isLight ? "rgba(60,50,40,0.35)" : isViper ? "rgba(40,255,69,0.18)" : "rgba(200,200,220,0.25)";
	ctx.lineWidth = 1;
	for (let y = step / 2; y < canvasHeight; y += step) {
		for (let x = step / 2; x < canvasWidth; x += step) {
			const a = fieldAngle(x, y);
			const len = step * 0.4;
			ctx.beginPath();
			ctx.moveTo(x, y);
			ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
			ctx.stroke();
		}
	}
}
// #endregion

function step() {
	fieldTime += cfg.evolve * 0.002;
	ctx.lineWidth = 1.1;
	// dark theme: additive blend so dense streamlines bloom
	if (!isLight) ctx.globalCompositeOperation = "lighter";
	const R2 = MOUSE_RADIUS * MOUSE_RADIUS;
	for (let i = 0; i < particles.length; i++) {
		const p = particles[i];
		const a = fieldAngle(p.x, p.y);
		let vx = Math.cos(a) * cfg.speed;
		let vy = Math.sin(a) * cfg.speed;
		// cursor vortex: add a tangential push that falls off with distance
		if (mouse.inside) {
			const dx = p.x - mouse.x, dy = p.y - mouse.y;
			const d2 = dx * dx + dy * dy;
			if (d2 < R2 && d2 > 1) {
				const d = Math.sqrt(d2);
				const fall = (1 - d / MOUSE_RADIUS) * cfg.speed * 2.2;
				vx += (-dy / d) * fall;
				vy += ( dx / d) * fall;
			}
		}
		p.px = p.x; p.py = p.y;
		p.x += vx; p.y += vy;
		p.life++;

		// respawn off-screen or aged
		if (p.life > maxLife || p.x < 0 || p.x >= canvasWidth || p.y < 0 || p.y >= canvasHeight) {
			spawnParticle(p);
			continue;
		}
		ctx.strokeStyle = strokeColor(a, cfg.speed);
		ctx.beginPath();
		ctx.moveTo(p.px, p.py);
		ctx.lineTo(p.x, p.y);
		ctx.stroke();
	}
	ctx.globalCompositeOperation = "source-over";
}

// #region FPS
var fpsBadge = document.getElementById("fpsBadge");
var lastFpsUpdate = performance.now();
var frameCount = 0;
// #endregion

function draw(now) {
	window.requestAnimationFrame(draw);
	if (document.hidden) return;

	// fade previous frame toward background
	ctx.fillStyle = isLight ? `rgba(243,238,230,${fadeSpeed})` : isViper ? `rgba(3,8,6,${fadeSpeed})` : `rgba(13,11,20,${fadeSpeed})`;
	ctx.fillRect(0, 0, canvasWidth, canvasHeight);

	if (!paused) step();
	if (showField) drawFieldArrows();

	frameCount++;
	if (now - lastFpsUpdate >= 500) {
		const fps = Math.round((frameCount * 1000) / (now - lastFpsUpdate));
		fpsBadge.textContent = fps + " fps · " + particles.length;
		frameCount = 0;
		lastFpsUpdate = now;
	}
}
window.requestAnimationFrame(draw);
document.addEventListener("visibilitychange", () => { if (!document.hidden) window.requestAnimationFrame(draw); });
