// Wave interference / ripple tank — sum of circular waves from point sources.
// The scalar field is computed on a low-res buffer then scaled up for speed.

// #region globals
var canvasWidth = window.getCanvasWidth();
var canvasHeight = window.innerHeight;

var wavelength = 70;   // canvas px between crests
var speed = 1.4;       // temporal angular speed
var falloff = 30;      // amplitude decay with distance (0 = none)
var sampleW = 240;     // buffer width in cells
var palette = "lab";   // lab | ink | spectral | mono
var lighting = true;   // gradient-lit relief
var showNodes = false; // stationary nodal-line overlay
var showMarkers = true;
var paused = false;

var sources = [];      // {x, y} in canvas px
var t = 0;

var isLight = document.documentElement.classList.contains("light");
var isViper = document.documentElement.classList.contains("viper");
// #endregion

// #region canvas
var backgroundCanvas = document.getElementById("backgroundCanvas");
var ctx = backgroundCanvas.getContext("2d");

// Low-res offscreen buffer
var buffer = document.createElement("canvas");
var bctx = buffer.getContext("2d");
var sampleH = 1, imageData = null, pixels = null, pix32 = null;
var field = null;      // Float32Array scalar field — shade() maps it to pixels
var envelope = null;   // Float32Array stationary |sum of phasors| (nodal lines)
var envDirty = true;   // envelope recompute needed (sources/wavelength/falloff changed)

function applyCanvasSize() {
	backgroundCanvas.width = canvasWidth;
	backgroundCanvas.height = canvasHeight;
	backgroundCanvas.style.width = canvasWidth + "px";
	backgroundCanvas.style.height = canvasHeight + "px";
	ctx.imageSmoothingEnabled = true;
	allocBuffer();
}

function allocBuffer() {
	sampleH = Math.max(1, Math.round(sampleW * canvasHeight / canvasWidth));
	buffer.width = sampleW;
	buffer.height = sampleH;
	imageData = bctx.createImageData(sampleW, sampleH);
	pixels = imageData.data;
	pix32 = new Uint32Array(imageData.data.buffer);
	field = new Float32Array(sampleW * sampleH);
	envelope = new Float32Array(sampleW * sampleH);
	envDirty = true;
}
applyCanvasSize();
// #endregion

function mkSource(x, y) {
	return { x: x, y: y, phase: 0, amp: 1, vx: 0, vy: 0 };
}

function defaultSources() {
	sources = [
		mkSource(canvasWidth * 0.42, canvasHeight * 0.5),
		mkSource(canvasWidth * 0.58, canvasHeight * 0.5),
	];
	envDirty = true;
}
defaultSources();

function threeSources() {
	const cx = canvasWidth / 2, cy = canvasHeight / 2, r = Math.min(canvasWidth, canvasHeight) * 0.22;
	sources = [];
	for (let i = 0; i < 3; i++) {
		const a = -Math.PI / 2 + i * (Math.PI * 2 / 3);
		sources.push(mkSource(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
	}
	envDirty = true;
}

function lineArray() {
	sources = [];
	const n = 6;
	const y = canvasHeight * 0.5;
	const margin = canvasWidth * 0.2;
	for (let i = 0; i < n; i++) {
		sources.push(mkSource(margin + (canvasWidth - 2 * margin) * i / (n - 1), y));
	}
	envDirty = true;
}

// Standing-wave cavity: two opposing phase-locked vertical arrays
function cavitySources() {
	sources = [];
	const n = 5;
	const x1 = canvasWidth * 0.18, x2 = canvasWidth * 0.82;
	const m = canvasHeight * 0.18;
	for (let i = 0; i < n; i++) {
		const y = m + (canvasHeight - 2 * m) * i / (n - 1);
		sources.push(mkSource(x1, y));
		sources.push(mkSource(x2, y));
	}
	envDirty = true;
}

// Doppler flyby: one source crossing the tank (bounces off the walls)
function dopplerSource() {
	sources = [mkSource(canvasWidth * 0.12, canvasHeight * 0.5)];
	sources[0].vx = 0.9;   // ~1/3 of the wave phase speed — clear Doppler, no shock
	envDirty = true;
}

// Per-frame source motion (velocity + orbit) — any movement dirties the envelope
function stepSources() {
	let moved = false;
	for (let i = 0; i < sources.length; i++) {
		const s = sources[i];
		if (i === dragging) continue;
		if (s.orbitR) {
			s.orbitA += s.orbitW;
			s.x = s.orbitCX + Math.cos(s.orbitA) * s.orbitR;
			s.y = s.orbitCY + Math.sin(s.orbitA) * s.orbitR;
			// instantaneous velocity so the Doppler term sees the orbit
			s.vx = -Math.sin(s.orbitA) * s.orbitR * s.orbitW;
			s.vy = Math.cos(s.orbitA) * s.orbitR * s.orbitW;
			moved = true;
		} else if (s.vx || s.vy) {
			s.x += s.vx; s.y += s.vy;
			if (s.x < 0) { s.x = 0; s.vx = -s.vx; }
			if (s.x > canvasWidth) { s.x = canvasWidth; s.vx = -s.vx; }
			if (s.y < 0) { s.y = 0; s.vy = -s.vy; }
			if (s.y > canvasHeight) { s.y = canvasHeight; s.vy = -s.vy; }
			moved = true;
		}
	}
	if (moved) envDirty = true;
}

// Optional per-frame preset animation (e.g. phased-array sweep)
var presetTick = null;

// #region pulses + probe
var pulses = [];   // Alt-click ring packets {x, y, t0}

function stepPulses() {
	if (!pulses.length) return;
	const c = wavelength / (Math.PI * 2);   // phase speed, px per t-unit
	const lim = Math.sqrt(canvasWidth * canvasWidth + canvasHeight * canvasHeight) + wavelength * 3;
	for (let i = pulses.length - 1; i >= 0; i--) {
		if ((t - pulses[i].t0) * c > lim) pulses.splice(i, 1);
	}
}

var probe = null;   // Shift-click oscilloscope pin {x, y}
var probeBuf = new Float32Array(220);
var probeHead = 0;

function sampleProbe() {
	if (!probe || !field) return;
	const bx = Math.min(sampleW - 1, Math.max(0, (probe.x / canvasWidth * sampleW) | 0));
	const by = Math.min(sampleH - 1, Math.max(0, (probe.y / canvasHeight * sampleH) | 0));
	probeBuf[probeHead % probeBuf.length] = field[by * sampleW + bx];
	probeHead++;
}
// #endregion

// #region barrier — one axis-aligned wall with 1-2 slits (Huygens diffraction).
// Primary sources reach only their own side; the field beyond the wall is
// re-radiated from sample points in the slits with the incident phase
// (total path length source->slit->pixel). Pulses ignore the wall (approx).
var barrier = { on: false, horiz: true, pos: 0.45, gaps: 2, gapW: 60, gapSep: 220 };
var gapPts = [];       // slit sample offsets along the barrier axis (3 per slit)
var GAP_GAIN = 0.45;   // per-sample re-radiation gain (3 samples/slit)

function gapCenters() {
	const L = barrier.horiz ? canvasWidth : canvasHeight;
	return barrier.gaps === 1
		? [L * 0.5]
		: [L * 0.5 - barrier.gapSep * 0.5, L * 0.5 + barrier.gapSep * 0.5];
}

function rebuildGaps() {
	gapPts = [];
	if (!barrier.on) return;
	const PER = 3;
	gapCenters().forEach(function (cg) {
		for (let i = 0; i < PER; i++) {
			gapPts.push(cg - barrier.gapW / 2 + barrier.gapW * (i + 0.5) / PER);
		}
	});
}

// Per-frame barrier geometry: barrier coordinate, each source's side, and each
// source's distance to every slit sample. Null when the barrier is inactive.
function barrierGeom(ns) {
	if (!barrier.on || !gapPts.length || !ns) return null;
	const bC = barrier.horiz ? barrier.pos * canvasHeight : barrier.pos * canvasWidth;
	const srcSide = [], srcGapR = [];
	for (let s = 0; s < ns; s++) {
		const src = sources[s];
		srcSide.push((barrier.horiz ? src.y : src.x) < bC ? -1 : 1);
		const row = [];
		for (let gI = 0; gI < gapPts.length; gI++) {
			const gx = barrier.horiz ? gapPts[gI] : bC;
			const gy = barrier.horiz ? bC : gapPts[gI];
			row.push(Math.hypot(gx - src.x, gy - src.y));
		}
		srcGapR.push(row);
	}
	return { bC: bC, srcSide: srcSide, srcGapR: srcGapR };
}

function drawBarrier() {
	if (!barrier.on) return;
	const bC = barrier.horiz ? barrier.pos * canvasHeight : barrier.pos * canvasWidth;
	const L = barrier.horiz ? canvasWidth : canvasHeight;
	const TH = 8;
	let prev = 0;
	const segs = [];
	gapCenters().forEach(function (c) {
		segs.push([prev, c - barrier.gapW / 2]);
		prev = c + barrier.gapW / 2;
	});
	segs.push([prev, L]);
	ctx.fillStyle = "rgba(12,9,7,0.92)";
	ctx.strokeStyle = rgbaStr(emitGold, 0.45);
	ctx.lineWidth = 1;
	segs.forEach(function (sg) {
		if (sg[1] <= sg[0]) return;
		if (barrier.horiz) {
			ctx.fillRect(sg[0], bC - TH / 2, sg[1] - sg[0], TH);
			ctx.strokeRect(sg[0] + 0.5, bC - TH / 2 + 0.5, sg[1] - sg[0] - 1, TH - 1);
		} else {
			ctx.fillRect(bC - TH / 2, sg[0], TH, sg[1] - sg[0]);
			ctx.strokeRect(bC - TH / 2 + 0.5, sg[0] + 0.5, TH - 1, sg[1] - sg[0] - 1);
		}
	});
}

// Double slit: one emitter below a horizontal two-slit wall
function doubleSlit() {
	sources = [mkSource(canvasWidth * 0.5, canvasHeight * 0.85)];
	barrier.on = true;
	barrier.horiz = true;
	barrier.pos = 0.58;
	barrier.gaps = 2;
	barrier.gapW = 46;
	barrier.gapSep = 190;
	rebuildGaps();
	syncBarrierUI();
	envDirty = true;
}
// #endregion

// #region palette — 256-entry LUTs indexed from the field value, theme-aware
var LUT = new Uint32Array(256);
var emitGold = [245, 166, 35], emitCoral = [255, 107, 71];

function cssColor(name) {
	var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
	if (v[0] === "#") {
		return [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16)];
	}
	var m = v.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
	return m ? [+m[1], +m[2], +m[3]] : [0, 0, 0];
}

function lerp3(a, b, tt) {
	return [a[0] + (b[0] - a[0]) * tt, a[1] + (b[1] - a[1]) * tt, a[2] + (b[2] - a[2]) * tt];
}

function pack(c3) {
	// little-endian ABGR through the Uint32 view
	return (255 << 24) | ((c3[2] & 255) << 16) | ((c3[1] & 255) << 8) | (c3[0] & 255);
}

var SPECTRAL = [[48, 18, 59], [27, 125, 193], [97, 201, 104], [241, 189, 63], [217, 70, 53]];

function buildLUT() {
	var i, tt, col;
	if (palette === "mono") {
		for (i = 0; i < 256; i++) LUT[i] = pack([i, i, i]);
	} else if (palette === "ink") {
		// schlieren feel: deep blue-black troughs -> paper cream crests
		var lo = [8, 12, 26], mid = [86, 108, 150], hi = [247, 241, 226];
		for (i = 0; i < 256; i++) {
			tt = i / 255;
			col = tt < 0.5 ? lerp3(lo, mid, tt * 2) : lerp3(mid, hi, tt * 2 - 1);
			LUT[i] = pack([col[0] | 0, col[1] | 0, col[2] | 0]);
		}
	} else if (palette === "spectral") {
		for (i = 0; i < 256; i++) {
			tt = (i / 255) * (SPECTRAL.length - 1);
			var s0 = Math.min(tt | 0, SPECTRAL.length - 2);
			col = lerp3(SPECTRAL[s0], SPECTRAL[s0 + 1], tt - s0);
			LUT[i] = pack([col[0] | 0, col[1] | 0, col[2] | 0]);
		}
	} else {
		// lab: site tokens — bg at rest, gold crests, coral troughs
		var bg = cssColor("--bg"), gold = cssColor("--gold"), coral = cssColor("--coral");
		for (i = 0; i < 256; i++) {
			var v = i / 127.5 - 1;
			col = v >= 0 ? lerp3(bg, gold, v) : lerp3(bg, coral, -v);
			LUT[i] = pack([col[0] | 0, col[1] | 0, col[2] | 0]);
		}
	}
}

function refreshColors() {
	emitGold = cssColor("--gold");
	emitCoral = cssColor("--coral");
	buildLUT();
}
refreshColors();
// #endregion

function computeField() {
	const k = (Math.PI * 2) / wavelength;
	const ns = sources.length;
	const fall = falloff / 100;
	const sx = canvasWidth / sampleW;
	const sy = canvasHeight / sampleH;
	const norm = ns > 0 ? 1 / Math.sqrt(ns) : 1; // keep contrast roughly stable

	// Doppler: the wave seen at radius r left the source r·k t-units ago, so a
	// moving source is evaluated against where it WAS then (first-order retarded
	// emission — crests compress ahead, stretch behind). px/frame -> px/t-unit.
	const tScale = speed > 0.01 ? 1 / (0.15 * speed) : 0;
	const bg = barrierGeom(ns);

	let p = 0;
	for (let j = 0; j < sampleH; j++) {
		const cy = j * sy;
		for (let i = 0; i < sampleW; i++) {
			const cx = i * sx;
			const pSide = bg ? ((barrier.horiz ? cy : cx) < bg.bC ? -1 : 1) : 0;
			let sum = 0;
			for (let s = 0; s < ns; s++) {
				const src = sources[s];
				if (bg && bg.srcSide[s] !== pSide) {
					// across the wall: only what diffracts through the slits arrives
					const row = bg.srcGapR[s];
					for (let gI = 0; gI < row.length; gI++) {
						const gx = barrier.horiz ? gapPts[gI] : bg.bC;
						const gy = barrier.horiz ? bg.bC : gapPts[gI];
						const ddx = cx - gx, ddy = cy - gy;
						const rt = row[gI] + Math.sqrt(ddx * ddx + ddy * ddy);
						sum += Math.sin(rt * k - t + src.phase) * src.amp * GAP_GAIN / (1 + fall * rt * 0.02);
					}
					continue;
				}
				let dx = cx - src.x, dy = cy - src.y;
				let r = Math.sqrt(dx * dx + dy * dy);
				if (tScale && (src.vx || src.vy)) {
					const back = r * k * tScale;   // frames since emission
					dx = cx - (src.x - src.vx * back);
					dy = cy - (src.y - src.vy * back);
					r = Math.sqrt(dx * dx + dy * dy);
				}
				const atten = 1 / (1 + fall * r * 0.02);
				sum += Math.sin(r * k - t + src.phase) * src.amp * atten;
			}
			for (let q = 0; q < pulses.length; q++) {
				const pu = pulses[q];
				const dx = cx - pu.x, dy = cy - pu.y;
				const r = Math.sqrt(dx * dx + dy * dy);
				const rc = (t - pu.t0) / k;
				const gs = (r - rc) / wavelength;
				const wgt = Math.exp(-gs * gs * 4);
				if (wgt > 0.01) {
					sum += Math.sin((r - rc) * k) * wgt / (1 + fall * r * 0.02);
				}
			}
			let v = sum * norm;
			if (v > 1) v = 1; else if (v < -1) v = -1;
			field[p] = v;
			p++;
		}
	}
}

// Stationary interference envelope |sum of phasors| — only changes when the
// sources / wavelength / falloff change, so it's recomputed on a dirty flag.
// Nodal lines (destructive fringes) live where it approaches zero.
function computeEnvelope() {
	const k = (Math.PI * 2) / wavelength;
	const ns = sources.length;
	const fall = falloff / 100;
	const sx = canvasWidth / sampleW;
	const sy = canvasHeight / sampleH;
	const norm = ns > 0 ? 1 / Math.sqrt(ns) : 1;
	const bg = barrierGeom(ns);

	let p = 0;
	for (let j = 0; j < sampleH; j++) {
		const cy = j * sy;
		for (let i = 0; i < sampleW; i++) {
			const cx = i * sx;
			const pSide = bg ? ((barrier.horiz ? cy : cx) < bg.bC ? -1 : 1) : 0;
			let re = 0, im = 0;
			for (let s = 0; s < ns; s++) {
				const src = sources[s];
				if (bg && bg.srcSide[s] !== pSide) {
					const row = bg.srcGapR[s];
					for (let gI = 0; gI < row.length; gI++) {
						const gx = barrier.horiz ? gapPts[gI] : bg.bC;
						const gy = barrier.horiz ? bg.bC : gapPts[gI];
						const ddx = cx - gx, ddy = cy - gy;
						const rt = row[gI] + Math.sqrt(ddx * ddx + ddy * ddy);
						const a2 = src.amp * GAP_GAIN / (1 + fall * rt * 0.02);
						const ph2 = rt * k + src.phase;
						re += Math.cos(ph2) * a2;
						im += Math.sin(ph2) * a2;
					}
					continue;
				}
				const dx = cx - src.x, dy = cy - src.y;
				const r = Math.sqrt(dx * dx + dy * dy);
				const atten = 1 / (1 + fall * r * 0.02);
				const ph = r * k + src.phase;
				re += Math.cos(ph) * atten * src.amp;
				im += Math.sin(ph) * atten * src.amp;
			}
			envelope[p++] = Math.sqrt(re * re + im * im) * norm;
		}
	}
	envDirty = false;
}

// Shade pass: field -> pixels through the LUT, with optional gradient lighting
// (finite-difference specular from a fixed light) and the nodal-line overlay.
var NODE_EPS = 0.08;

function shade() {
	const W = sampleW, Hh = sampleH;
	let p = 0;
	for (let j = 0; j < Hh; j++) {
		for (let i = 0; i < W; i++, p++) {
			let idx = (field[p] * 127.5 + 127.5) | 0;
			if (idx < 0) idx = 0; else if (idx > 255) idx = 255;
			const col = LUT[idx];
			let r = col & 255, g = (col >> 8) & 255, b = (col >> 16) & 255;

			if (lighting) {
				const gx = field[p + (i < W - 1 ? 1 : 0)] - field[p - (i > 0 ? 1 : 0)];
				const gy = field[p + (j < Hh - 1 ? W : 0)] - field[p - (j > 0 ? W : 0)];
				let s = -(gx + gy) * 0.7071;   // dot with light dir (-0.71, -0.71)
				if (s > 0) {
					const spec = s * s * 320;
					r += spec; g += spec; b += spec;
				}
			}

			if (showNodes) {
				const a = envelope[p];
				if (a < NODE_EPS) {
					const f = 0.22 + 0.78 * (a / NODE_EPS);
					r *= f; g *= f; b *= f;
				}
			}

			if (r > 255) r = 255;
			if (g > 255) g = 255;
			if (b > 255) b = 255;
			pix32[p] = (255 << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255);
		}
	}
}

// Emitters — glowing sources that pulse in phase with their emission
var hoverIdx = -1;

function rgbaStr(c3, a) {
	return "rgba(" + c3[0] + "," + c3[1] + "," + c3[2] + "," + a + ")";
}

function drawEmitters() {
	for (let i = 0; i < sources.length; i++) {
		const s = sources[i];
		const col = i % 2 ? emitCoral : emitGold;
		const pulse = 0.5 + 0.5 * Math.sin((s.phase || 0) - t);
		const R = 7 + pulse * 5;
		const grad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, R * 2.4);
		grad.addColorStop(0, rgbaStr(col, 0.9));
		grad.addColorStop(0.4, rgbaStr(col, 0.28 + pulse * 0.3));
		grad.addColorStop(1, rgbaStr(col, 0));
		ctx.beginPath();
		ctx.arc(s.x, s.y, R * 2.4, 0, Math.PI * 2);
		ctx.fillStyle = grad;
		ctx.fill();
		ctx.beginPath();
		ctx.arc(s.x, s.y, 3, 0, Math.PI * 2);
		ctx.fillStyle = "rgba(255,255,255,0.92)";
		ctx.fill();
		if (i === hoverIdx || i === dragging) {
			ctx.beginPath();
			ctx.arc(s.x, s.y, R + 5, 0, Math.PI * 2);
			ctx.lineWidth = 1.5;
			ctx.strokeStyle = rgbaStr(col, 0.85);
			ctx.stroke();
		}
		if (i === selectedIdx) {
			ctx.setLineDash([4, 3]);
			ctx.beginPath();
			ctx.arc(s.x, s.y, R + 9, 0, Math.PI * 2);
			ctx.lineWidth = 1.5;
			ctx.strokeStyle = "rgba(255,255,255,0.8)";
			ctx.stroke();
			ctx.setLineDash([]);
		}
	}
}

// Probe pin + corner oscilloscope (amplitude vs time at the pin)
function drawProbe() {
	if (!probe) return;
	ctx.beginPath();
	ctx.arc(probe.x, probe.y, 5, 0, Math.PI * 2);
	ctx.lineWidth = 2;
	ctx.strokeStyle = "rgba(255,255,255,0.9)";
	ctx.stroke();
	ctx.beginPath();
	ctx.moveTo(probe.x - 9, probe.y); ctx.lineTo(probe.x + 9, probe.y);
	ctx.moveTo(probe.x, probe.y - 9); ctx.lineTo(probe.x, probe.y + 9);
	ctx.lineWidth = 1;
	ctx.stroke();

	const PW = 220, PH = 90, x0 = 16, y0 = canvasHeight - PH - 16;
	ctx.fillStyle = "rgba(0,0,0,0.45)";
	ctx.fillRect(x0, y0, PW, PH);
	ctx.strokeStyle = rgbaStr(emitGold, 0.5);
	ctx.lineWidth = 1;
	ctx.strokeRect(x0 + 0.5, y0 + 0.5, PW - 1, PH - 1);
	ctx.beginPath();
	ctx.moveTo(x0, y0 + PH / 2); ctx.lineTo(x0 + PW, y0 + PH / 2);
	ctx.strokeStyle = "rgba(255,255,255,0.18)";
	ctx.stroke();
	ctx.beginPath();
	const n = probeBuf.length;
	for (let i = 0; i < n; i++) {
		const v = probeBuf[(probeHead + i) % n];
		const px = x0 + (i / (n - 1)) * PW;
		const py = y0 + PH / 2 - v * PH * 0.46;
		if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
	}
	ctx.strokeStyle = rgbaStr(emitGold, 0.95);
	ctx.lineWidth = 1.5;
	ctx.stroke();
}

function render() {
	computeField();
	if (showNodes && envDirty) computeEnvelope();
	shade();
	bctx.putImageData(imageData, 0, 0);
	ctx.drawImage(buffer, 0, 0, sampleW, sampleH, 0, 0, canvasWidth, canvasHeight);
	drawBarrier();
	if (showMarkers) drawEmitters();
	if (!paused) sampleProbe();
	drawProbe();
}

// #region theme — palette already neutral; just re-render
document.addEventListener("themechange", function (e) {
	isLight = e.detail.isLight;
	isViper = e.detail.theme === "viper";
	refreshColors();   // lab palette + emitter tints track the CSS tokens
});
// #endregion

// #region resize
window.addEventListener("resize", function () {
	canvasWidth = window.getCanvasWidth();
	canvasHeight = window.innerHeight;
	if (window._hudToggling) return;
	applyCanvasSize();
	rebuildGaps();
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

bindSlider("wavelengthSlider", "wavelengthValue", parseInt, Object.assign(function (v) {
	wavelength = v;
	envDirty = true;
}, { initial: wavelength }));

bindSlider("speedSlider", "speedValue", parseFloat, Object.assign(function (v) {
	speed = v;
}, { initial: speed }), (v) => v.toFixed(2));

bindSlider("falloffSlider", "falloffValue", parseInt, Object.assign(function (v) {
	falloff = v;
	envDirty = true;
}, { initial: falloff }));

bindSlider("resSlider", "resValue", parseInt, Object.assign(function (v) {
	sampleW = v;
	allocBuffer();
}, { initial: sampleW }));

document.querySelectorAll('input[name="palette"]').forEach(function (radio) {
	radio.addEventListener("change", function () { if (this.checked) { palette = this.value; buildLUT(); } });
});

var lightingCheckbox = document.getElementById("lightingCheckbox");
lightingCheckbox.checked = lighting;
lightingCheckbox.onclick = function () { lighting = this.checked; };

var nodesCheckbox = document.getElementById("nodesCheckbox");
nodesCheckbox.checked = showNodes;
nodesCheckbox.onclick = function () { showNodes = this.checked; };

var markerCheckbox = document.getElementById("markerCheckbox");
markerCheckbox.checked = showMarkers;
markerCheckbox.onclick = function () { showMarkers = this.checked; };

function setPreset(fn, tick) {
	return function () {
		fn();
		presetTick = tick || null;
		selectedIdx = -1;
		hoverIdx = -1;
		syncSourceUI();
	};
}

document.getElementById("twoButton").onclick = setPreset(defaultSources);
document.getElementById("threeButton").onclick = setPreset(threeSources);
document.getElementById("lineButton").onclick = setPreset(lineArray);
document.getElementById("sweepButton").onclick = setPreset(lineArray, function () {
	// phased-array sweep: an oscillating phase gradient steers the beam
	const grad = Math.sin(t * 0.1) * 1.9;
	for (let i = 0; i < sources.length; i++) sources[i].phase = i * grad;
	envDirty = true;
});
document.getElementById("cavityButton").onclick = setPreset(cavitySources);
document.getElementById("dopplerButton").onclick = setPreset(dopplerSource);
document.getElementById("slitButton").onclick = setPreset(doubleSlit);
document.getElementById("clearButton").onclick = setPreset(function () { sources = []; envDirty = true; });

// Selected-source controls — click a source to select it, then steer its
// phase (beam steering on the array presets) and amplitude
var selectedIdx = -1;
var phaseSlider = document.getElementById("phaseSlider");
var ampSlider = document.getElementById("ampSlider");
var phaseValue = document.getElementById("phaseValue");
var ampValue = document.getElementById("ampValue");
var selLabel = document.getElementById("selLabel");

function syncSourceUI() {
	var has = selectedIdx >= 0 && selectedIdx < sources.length;
	phaseSlider.disabled = !has;
	ampSlider.disabled = !has;
	orbitCheckbox.disabled = !has;
	orbitCheckbox.checked = has && !!sources[selectedIdx].orbitR;
	if (!has) {
		selLabel.innerHTML = "Selected: none &mdash; click a source";
		phaseValue.innerHTML = "&ndash;";
		ampValue.innerHTML = "&ndash;";
		return;
	}
	var s = sources[selectedIdx];
	selLabel.innerHTML = "Selected: source #" + (selectedIdx + 1);
	phaseSlider.value = s.phase;
	ampSlider.value = s.amp;
	phaseValue.innerHTML = (s.phase / Math.PI).toFixed(2) + "&pi;";
	ampValue.innerHTML = s.amp.toFixed(2);
}

phaseSlider.oninput = function () {
	if (selectedIdx < 0 || selectedIdx >= sources.length) return;
	var s = sources[selectedIdx];
	s.phase = parseFloat(this.value);
	phaseValue.innerHTML = (s.phase / Math.PI).toFixed(2) + "&pi;";
	envDirty = true;
};

ampSlider.oninput = function () {
	if (selectedIdx < 0 || selectedIdx >= sources.length) return;
	var s = sources[selectedIdx];
	s.amp = parseFloat(this.value);
	ampValue.innerHTML = s.amp.toFixed(2);
	envDirty = true;
};

var orbitCheckbox = document.getElementById("orbitCheckbox");
orbitCheckbox.onclick = function () {
	if (selectedIdx < 0 || selectedIdx >= sources.length) return;
	var s = sources[selectedIdx];
	if (this.checked) {
		s.vx = 0; s.vy = 0;
		s.orbitR = Math.min(canvasWidth, canvasHeight) * 0.12;
		s.orbitCX = s.x - s.orbitR;
		s.orbitCY = s.y;
		s.orbitA = 0;
		s.orbitW = 0.02;
	} else {
		s.orbitR = 0;
		s.vx = 0; s.vy = 0;
	}
	envDirty = true;
};
syncSourceUI();

// Barrier controls
var barrierCheckbox = document.getElementById("barrierCheckbox");
barrierCheckbox.checked = barrier.on;
barrierCheckbox.onclick = function () { barrier.on = this.checked; rebuildGaps(); envDirty = true; };

var barrierVertCheckbox = document.getElementById("barrierVertCheckbox");
barrierVertCheckbox.checked = !barrier.horiz;
barrierVertCheckbox.onclick = function () { barrier.horiz = !this.checked; rebuildGaps(); envDirty = true; };

bindSlider("gapsSlider", "gapsValue", parseInt, Object.assign(function (v) {
	barrier.gaps = v;
	rebuildGaps();
	envDirty = true;
}, { initial: barrier.gaps }));

bindSlider("gapWSlider", "gapWValue", parseInt, Object.assign(function (v) {
	barrier.gapW = v;
	rebuildGaps();
	envDirty = true;
}, { initial: barrier.gapW }));

bindSlider("gapSepSlider", "gapSepValue", parseInt, Object.assign(function (v) {
	barrier.gapSep = v;
	rebuildGaps();
	envDirty = true;
}, { initial: barrier.gapSep }));

function syncBarrierUI() {
	barrierCheckbox.checked = barrier.on;
	barrierVertCheckbox.checked = !barrier.horiz;
	document.getElementById("gapsSlider").value = barrier.gaps;
	document.getElementById("gapsValue").innerHTML = barrier.gaps;
	document.getElementById("gapWSlider").value = barrier.gapW;
	document.getElementById("gapWValue").innerHTML = barrier.gapW;
	document.getElementById("gapSepSlider").value = barrier.gapSep;
	document.getElementById("gapSepValue").innerHTML = barrier.gapSep;
}

var pauseButton = document.getElementById("pauseButton");
pauseButton.onclick = togglePause;
function togglePause() {
	paused = !paused;
	pauseButton.textContent = paused ? "Resume (Space)" : "Pause (Space)";
}


window.addEventListener("keydown", function (e) {
	if (e.code === "Space") { e.preventDefault(); togglePause(); }
});
// #endregion

// #region mouse — add / remove / drag / throw sources, pulses, probe
var dragging = -1;
var dragBarrier = false;
var dragVx = 0, dragVy = 0, lastDragX = 0, lastDragY = 0, lastDragT = 0;

function nearestSource(x, y) {
	let best = -1, bestD = 1e9;
	for (let i = 0; i < sources.length; i++) {
		const dx = sources[i].x - x, dy = sources[i].y - y;
		const d = dx * dx + dy * dy;
		if (d < bestD) { bestD = d; best = i; }
	}
	return { i: best, d: Math.sqrt(bestD) };
}

backgroundCanvas.addEventListener("mousedown", function (e) {
	const rect = backgroundCanvas.getBoundingClientRect();
	const x = e.clientX - rect.left, y = e.clientY - rect.top;
	if (e.button === 2) {
		const n = nearestSource(x, y);
		if (n.i >= 0 && n.d < 30) {
			sources.splice(n.i, 1);
			envDirty = true;
			hoverIdx = -1;
			if (n.i === selectedIdx) selectedIdx = -1;
			else if (n.i < selectedIdx) selectedIdx--;
			syncSourceUI();
		}
		return;
	}
	if (e.altKey) {   // fire a single ring packet instead of adding a source
		pulses.push({ x: x, y: y, t0: t });
		return;
	}
	if (e.shiftKey) { // place / move / remove the oscilloscope probe
		if (probe && Math.hypot(probe.x - x, probe.y - y) < 16) probe = null;
		else { probe = { x: x, y: y }; probeBuf.fill(0); }
		return;
	}
	const n = nearestSource(x, y);
	if (n.i >= 0 && n.d < 14) { dragging = n.i; }
	else if (barrier.on
		&& Math.abs((barrier.horiz ? y : x) - (barrier.horiz ? barrier.pos * canvasHeight : barrier.pos * canvasWidth)) < 10) {
		dragBarrier = true;   // grab the wall instead of adding a source
		backgroundCanvas.style.cursor = "grabbing";
		return;
	}
	else { sources.push(mkSource(x, y)); dragging = sources.length - 1; envDirty = true; }
	const gs = sources[dragging];
	gs.vx = 0; gs.vy = 0; gs.orbitR = 0;   // grabbing stops any motion
	dragVx = 0; dragVy = 0;
	lastDragX = x; lastDragY = y; lastDragT = performance.now();
	selectedIdx = dragging;
	syncSourceUI();
	backgroundCanvas.style.cursor = "grabbing";
});
window.addEventListener("mousemove", function (e) {
	if (dragBarrier) {
		const rect2 = backgroundCanvas.getBoundingClientRect();
		const v = barrier.horiz
			? (e.clientY - rect2.top) / canvasHeight
			: (e.clientX - rect2.left) / canvasWidth;
		barrier.pos = Math.min(0.95, Math.max(0.05, v));
		envDirty = true;
		return;
	}
	if (dragging < 0) return;
	const rect = backgroundCanvas.getBoundingClientRect();
	const nx = e.clientX - rect.left, ny = e.clientY - rect.top;
	const now = performance.now();
	const dtm = Math.max(now - lastDragT, 1);
	// smoothed drag velocity in px/frame (60 fps) — release throws the source
	dragVx = dragVx * 0.6 + ((nx - lastDragX) / dtm * 16.7) * 0.4;
	dragVy = dragVy * 0.6 + ((ny - lastDragY) / dtm * 16.7) * 0.4;
	lastDragX = nx; lastDragY = ny; lastDragT = now;
	sources[dragging].x = nx;
	sources[dragging].y = ny;
	envDirty = true;
});
backgroundCanvas.addEventListener("mousemove", function (e) {
	if (dragging >= 0) return;
	const rect = backgroundCanvas.getBoundingClientRect();
	const n = nearestSource(e.clientX - rect.left, e.clientY - rect.top);
	hoverIdx = (n.i >= 0 && n.d < 16) ? n.i : -1;
	backgroundCanvas.style.cursor = hoverIdx >= 0 ? "grab" : "crosshair";
});
window.addEventListener("mouseup", function () {
	if (dragging >= 0 && performance.now() - lastDragT < 120) {
		const sp = Math.hypot(dragVx, dragVy);
		if (sp > 0.6) {   // moving on release -> throw
			sources[dragging].vx = Math.max(-3, Math.min(3, dragVx));
			sources[dragging].vy = Math.max(-3, Math.min(3, dragVy));
		}
	}
	dragging = -1;
	dragBarrier = false;
	backgroundCanvas.style.cursor = hoverIdx >= 0 ? "grab" : "crosshair";
});
backgroundCanvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });
// #endregion

// #region loop
var fpsBadge = document.getElementById("fpsBadge");
var lastFpsUpdate = performance.now();
var frameCount = 0;

function draw(now) {
	window.requestAnimationFrame(draw);
	if (document.hidden) return;

	if (!paused) {
		t += speed * 0.15;
		stepSources();
		stepPulses();
		if (presetTick) presetTick();
	}
	render();

	frameCount++;
	if (now - lastFpsUpdate >= 500) {
		const fps = Math.round((frameCount * 1000) / (now - lastFpsUpdate));
		fpsBadge.textContent = fps + " fps · " + sources.length + " src";
		frameCount = 0;
		lastFpsUpdate = now;
	}
}
window.requestAnimationFrame(draw);
document.addEventListener("visibilitychange", () => { if (!document.hidden) window.requestAnimationFrame(draw); });
// #endregion
