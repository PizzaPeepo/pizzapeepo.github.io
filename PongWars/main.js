// Pong Wars — territory battle. N teams (2/3/4); each ball paints enemy tiles to
// its own colour and bounces off them, so the frontiers slosh around forever.
// Faithful port of the mechanic from vnglst/pong-wars (MIT), rebuilt on this repo's
// modern-HUD single-canvas pattern and extended into a stream "waiting screen":
// live scoreboard, overlay banner, and a window.PongWars remote-control API so
// Twitch chat / channel points can drive it (see TWITCH_IDEAS.md).

// #region globals
var gameW = 1000, gameH = 1000;
var canvasWidth = gameW;
var canvasHeight = gameH;

var cfg = {
	cell: 24,          // tile size in px (grid resolution)
	speed: 8,          // ball speed (px/frame magnitude)
	ballsPerTeam: 1,   // balls launched per team
};

var TEAM_COUNTS = [2, 3, 4];
var teamCount = 2;

var paused = false;
var glow = true;
var neon = true;          // neo-tokyo render style (dark fields + neon bloom)
var trails = true;        // comet trails behind balls
var TRAIL_LEN = 24;
var fieldSat = 0.7;       // field colour vibrance (0.2..1), saturation slider
var crt = true;           // CRT scanline + vignette overlay
var gridLines = true;     // faint tron grid overlay
var showScore = true;
var autoRestart = true;
var roundOver = false;       // frozen during a win celebration
var resetTimer = null;

var darkCanvasBg = "#070711";
var lightCanvasBg = "#f3eee6";
var isLight = document.documentElement.classList.contains("light");
// #endregion

// #region canvas
var backgroundCanvas = document.getElementById("backgroundCanvas");
var ctx = backgroundCanvas.getContext("2d");
var bloomCanvas = document.createElement("canvas");   // low-res bloom buffer
var bloomCtx = bloomCanvas.getContext("2d");
var fxCanvas = document.createElement("canvas");       // full-res snapshot for glitch
var fxCtx = fxCanvas.getContext("2d");

function applyCanvasSize() {
	canvasWidth = gameW;
	canvasHeight = gameH;
	backgroundCanvas.style.top = "50%";
	backgroundCanvas.style.left = "50%";
	backgroundCanvas.style.transform = "translate(-50%, -50%)";
	backgroundCanvas.width = canvasWidth;
	backgroundCanvas.height = canvasHeight;
	bloomCanvas.width = Math.max(1, Math.round(canvasWidth / 3));
	bloomCanvas.height = Math.max(1, Math.round(canvasHeight / 3));
	fxCanvas.width = canvasWidth;
	fxCanvas.height = canvasHeight;
	backgroundCanvas.style.width = canvasWidth + "px";
	backgroundCanvas.style.height = canvasHeight + "px";

	// scoreboard sits directly above the game area; frame hugs the canvas
	var gap = 12;
	var sb = document.getElementById("pwScore");
	if (sb) {
		sb.style.top = "auto";
		sb.style.bottom = "calc(50% + " + (gameH / 2 + gap) + "px)";
		sb.style.width = "min(" + gameW + "px, 92vw)";
	}
	var fr = document.getElementById("pwFrame");
	if (fr) {
		fr.style.top = "50%";
		fr.style.left = "50%";
		fr.style.transform = "translate(-50%, -50%)";
		fr.style.width = canvasWidth + "px";
		fr.style.height = canvasHeight + "px";
	}
}
applyCanvasSize();
// #endregion

// #region theme
function applyThemeColors(light) {
	isLight = light;
	backgroundCanvas.style.background = light ? lightCanvasBg : darkCanvasBg;
	document.body.classList.toggle("neon", neon && !light);
	recomputeStyle();
	tintPowerups();
}
applyThemeColors(isLight);
document.addEventListener("themechange", function (e) { applyThemeColors(e.detail.isLight); });
// #endregion

// #region state
// Block layouts per team count: [cols, rows] over the canvas. Each team owns one block.
var LAYOUTS = { 2: [2, 1], 3: [3, 1], 4: [2, 2] };

// Colour palettes (up to 8). The first two entries of each match the original 2-team
// presets; extra entries only come into play at higher team counts. A ball reads in the
// opposite colour at 2 teams (the iconic day/night look) and in its own colour + a
// contrast ring beyond that (so it stays visible on its own field).
var PALETTES = {
	neon:    ["#00eaff", "#ff2bd1", "#9b5cff", "#4dff7c", "#ffb300", "#ff3b3b", "#2b8bff", "#ff7ab8"],
	twitch:  ["#efeff1", "#9146ff", "#00c8af", "#ff5a36", "#1f8b4c", "#f5d423", "#e83e8c", "#3498db"],
	fireice: ["#dff1ff", "#ff5a36", "#3aa6ff", "#ffb000", "#00d1c1", "#ff3860", "#7ee787", "#b388ff"],
	mono:    ["#e6e6e6", "#222222", "#9e9e9e", "#4d4d4d", "#c4c4c4", "#3a3a3a", "#7a7a7a", "#5e5e5e"],
	geoblue:    ["#08F7FE", "#09FBD3", "#FE53BB", "#F5D300"],
	lights:     ["#FFACFC", "#F148FB", "#7122FA", "#560A86"],
	hyperpop:   ["#7C00FE", "#F9E400", "#FFAF00", "#F5004F"],
	orchid:     ["#6420AA", "#FF3EA5", "#FF7ED4", "#FFB5DA"],
	rave:       ["#45FFCA", "#FDFF7D", "#FF98CA", "#D67BFF"],
};
var DEFAULT_NAMES = ["Day", "Night", "Team 3", "Team 4", "Team 5", "Team 6", "Team 7", "Team 8"];

var preset = "neon";
var colors = PALETTES.neon.slice(0, teamCount);   // per-team field colours
var names = DEFAULT_NAMES.slice(0, teamCount);

var squares = [];            // squares[i][j] = team index
var nx = 0, ny = 0;          // grid dimensions
var balls = [];
var scores = [];             // tiles owned per team
var lastLeader = -1;
var boost = [];              // per-team temporary speed multiplier { factor, until }
var frozen = [];             // per-team freeze { until } — opponents frozen by a Freeze power-up
var smashArmed = [];         // per-team: next collision detonates an AoE smash of this radius (px), else 0
var particles = [];          // capture-spark particles
var PARTICLE_CAP = 600;      // hard cap on live particles
var shakeMag = 0;            // current screen-shake magnitude (px); decays each frame
var heat = null;             // Float32Array(nx*ny) fresh-capture glow, decays each frame
var impacts = [];            // expanding impact rings { x, y, r, maxR, life, maxLife, rgb }
var glitch = 0;              // glitch / RGB-split burst intensity (0..1), decays
var pulseT = 0;              // phase accumulator for breathing pulses
var transition = 1;          // round-start wipe progress (0..1; 1 = fully revealed)
var bloomOn = true;          // bloom post-process
var barW = [], pctShown = []; // animated scoreboard bar widths + rolling percents
// #endregion

// #region dom refs
var fpsBadge = document.getElementById("fpsBadge");
var scoreEl = document.getElementById("pwScore");
var overlayEl = document.getElementById("pwOverlay");
var titleEl = document.getElementById("pwTitle");
var subEl = document.getElementById("pwSub");
var bannerEl = document.getElementById("pwBanner");
var teamControlsEl = document.getElementById("pwTeamControls");
var pwFrame = document.getElementById("pwFrame");
var powerupsEl = document.getElementById("pwPowerups");

// dynamically-built element caches (one entry per team)
var segEls = [], pctEls = [], nameSBEls = [], dotEls = [];
var colorInputs = [], nameInputs = [];
// #endregion

// returns "#101015" or "#ffffff" — whichever contrasts the given hex fill
function contrastColor(hex) {
	var h = String(hex).replace("#", "");
	if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
	var r = parseInt(h.substr(0, 2), 16), g = parseInt(h.substr(2, 2), 16), b = parseInt(h.substr(4, 2), 16);
	var lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
	return lum > 0.6 ? "#101015" : "#ffffff";
}

// #region neon style helpers
var fields = [];        // darkened per-team tile colours (neon style)
var accentRGB = [];     // per-team [r,g,b] used for trails / bloom / seams

function hexToRgb(h) {
	h = String(h).replace("#", "");
	if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
	return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)];
}
function mixRgb(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function rgba(c, a) { return "rgba(" + (c[0] | 0) + "," + (c[1] | 0) + "," + (c[2] | 0) + "," + a + ")"; }

// recompute cached tile/accent colours whenever palette, theme or style changes
function recomputeStyle() {
	if (!colors || !colors.length) return;
	fields = []; accentRGB = [];
	var sbGlow = neon && !isLight;
	for (var t = 0; t < teamCount; t++) {
		var acc = hexToRgb(colors[t]);
		accentRGB[t] = acc;
		fields[t] = rgba(mixRgb(acc, [6, 6, 14], 1 - fieldSat), 1);   // vibrant: saturation-slider controlled
		if (dotEls[t]) dotEls[t].style.boxShadow = sbGlow ? "0 0 6px " + rgba(acc, 0.95) + ", 0 0 13px " + rgba(acc, 0.6) : "";
		if (segEls[t]) segEls[t].style.boxShadow = sbGlow ? "inset 0 0 10px " + rgba(acc, 0.5) + ", inset 0 0 2px rgba(255,255,255,0.45)" : "";
	}
}
// #endregion

function clampTeam(i) { i = i | 0; if (i < 0) i = 0; if (i >= teamCount) i = teamCount - 1; return i; }

// Accepts a team index (0..7 / numeric string), a letter "a".."h", or a (case-insensitive)
// team name. Clamped to the live team count.
function resolveTeam(t) {
	if (typeof t === "number") return clampTeam(t);
	if (typeof t === "string") {
		var s = t.trim().toLowerCase();
		if (s.length === 1 && s >= "a" && s <= "h") return clampTeam(s.charCodeAt(0) - 97);
		if (/^\d+$/.test(s)) return clampTeam(parseInt(s, 10));
		for (var i = 0; i < teamCount; i++) if (names[i].toLowerCase() === s) return i;
	}
	return 0;
}

// #region build
function applyColors() {
	for (var t = 0; t < teamCount; t++) {
		if (segEls[t]) segEls[t].style.background = colors[t];
		if (dotEls[t]) dotEls[t].style.background = colors[t];
		if (colorInputs[t]) colorInputs[t].value = colors[t];
	}
	recomputeStyle();
}

function buildGrid() {
	nx = Math.max(2, Math.ceil(canvasWidth / cfg.cell));
	ny = Math.max(2, Math.ceil(canvasHeight / cfg.cell));
	heat = new Float32Array(nx * ny);
	squares = [];
	if (teamCount === 3) {
		var cx = nx / 2, cy = ny / 2;
		for (var i = 0; i < nx; i++) {
			squares[i] = [];
			for (var j = 0; j < ny; j++) {
				var a = (Math.atan2(j - cy, i - cx) + Math.PI * 2) % (Math.PI * 2);
				squares[i][j] = Math.floor(a / (Math.PI * 2 / 3)) % 3;
			}
		}
		return;
	}
	var L = LAYOUTS[teamCount], cols = L[0], rows = L[1];
	for (var i = 0; i < nx; i++) {
		squares[i] = [];
		var col = Math.min(cols - 1, Math.floor(i / nx * cols));
		for (var j = 0; j < ny; j++) {
			var row = Math.min(rows - 1, Math.floor(j / ny * rows));
			squares[i][j] = row * cols + col;
		}
	}
}

function makeBall(team, k) {
	if (teamCount === 3) {
		var sectorStart = team * (Math.PI * 2 / 3);
		var spawnAngle = sectorStart + Math.random() * (Math.PI * 2 / 3);
		var maxDist = Math.min(canvasWidth, canvasHeight) * 0.38;
		var dist = maxDist * (0.15 + Math.random() * 0.85);
		var hx = canvasWidth / 2 + Math.cos(spawnAngle) * dist;
		var hy = canvasHeight / 2 + Math.sin(spawnAngle) * dist;
		var ang = Math.random() * Math.PI * 2;
		return { team: team, x: hx, y: hy, dx: Math.cos(ang) * cfg.speed, dy: Math.sin(ang) * cfg.speed, trail: [] };
	}
	var L = LAYOUTS[teamCount], cols = L[0], rows = L[1];
	var col = team % cols, row = Math.floor(team / cols);
	var margin = 0.12;
	var hx = ((col + margin + Math.random() * (1 - 2 * margin)) / cols) * canvasWidth;
	var hy = ((row + margin + Math.random() * (1 - 2 * margin)) / rows) * canvasHeight;
	var ang = Math.random() * Math.PI * 2;
	return { team: team, x: hx, y: hy, dx: Math.cos(ang) * cfg.speed, dy: Math.sin(ang) * cfg.speed, trail: [] };
}

function buildBalls() {
	balls = [];
	for (var t = 0; t < teamCount; t++)
		for (var k = 0; k < cfg.ballsPerTeam; k++) {
			if (balls.length >= 60) break;
			balls.push(makeBall(t, k));
		}
}

function relaunch() { buildBalls(); }   // reposition balls, keep territory

function reset() {
	if (resetTimer) { clearTimeout(resetTimer); resetTimer = null; }
	roundOver = false;
	buildGrid();
	buildBalls();
	lastLeader = -1;
	transition = 0; impacts = []; glitch = 0;
	emit("reset", getState());
}
// #endregion

// #region simulation
// convert every tile whose centre lies within radius r (px) of (x,y) to team t
function paintBlobPx(t, x, y, r) {
	var cell = cfg.cell;
	var i0 = Math.max(0, Math.floor((x - r) / cell)), i1 = Math.min(nx - 1, Math.floor((x + r) / cell));
	var j0 = Math.max(0, Math.floor((y - r) / cell)), j1 = Math.min(ny - 1, Math.floor((y + r) / cell));
	for (var i = i0; i <= i1; i++) {
		for (var j = j0; j <= j1; j++) {
			var dx = (i + 0.5) * cell - x, dy = (j + 0.5) * cell - y;
			if (dx * dx + dy * dy <= r * r) { squares[i][j] = t; if (heat) heat[i * ny + j] = 1; }
		}
	}
}

function checkSquareCollision(ball) {
	var cell = cfg.cell;
	var vx = ball.dx, vy = ball.dy;   // sample against the original velocity, flip once at the end
	var flipX = false, flipY = false, hit = false;
	for (var a = 0; a < Math.PI * 2; a += Math.PI / 4) {
		var dirX = Math.cos(a), dirY = Math.sin(a);
		var checkX = ball.x + dirX * (cell / 2);
		var checkY = ball.y + dirY * (cell / 2);
		var i = Math.floor(checkX / cell);
		var j = Math.floor(checkY / cell);
		if (i >= 0 && i < nx && j >= 0 && j < ny) {
			if (squares[i][j] !== ball.team) {
				squares[i][j] = ball.team; hit = true; if (heat) heat[i * ny + j] = 1;
				// OR the flips (never cancel) and only bounce off cells the ball moves toward —
				// toggling here let an even number of same-axis hits cancel, so the ball tunnelled
				// straight through a wall while still painting it.
				if (Math.abs(dirX) > Math.abs(dirY)) {
					if (dirX * vx > 0) flipX = true;
				} else {
					if (dirY * vy > 0) flipY = true;
				}
			}
		}
	}
	if (flipX) ball.dx = -vx;
	if (flipY) ball.dy = -vy;
	if (hit) {
		spawnSparks(ball.x, ball.y, accentRGB[ball.team], 4, 1);
		impacts.push({ x: ball.x, y: ball.y, r: cfg.cell * 0.4, maxR: cfg.cell * 2.2, life: 16, maxLife: 16, rgb: accentRGB[ball.team] });
		if (smashArmed[ball.team]) {
			var sr = smashArmed[ball.team];
			smashArmed[ball.team] = 0;
			paintBlobPx(ball.team, ball.x, ball.y, sr);
			spawnSparks(ball.x, ball.y, accentRGB[ball.team], 64, 3);
			shake(24); glitch = Math.max(glitch, 0.9); impacts.push({ x: ball.x, y: ball.y, r: cfg.cell, maxR: sr, life: 28, maxLife: 28, rgb: accentRGB[ball.team] });
		}
	}
}

function checkBoundaryCollision(ball) {
	var cell = cfg.cell;
	if (ball.x + ball.dx > canvasWidth - cell / 2 || ball.x + ball.dx < cell / 2) ball.dx = -ball.dx;
	if (ball.y + ball.dy > canvasHeight - cell / 2 || ball.y + ball.dy < cell / 2) ball.dy = -ball.dy;
}

function addRandomness(ball) {
	var maxc = cfg.speed * 1.2;
	var minc = cfg.speed * 0.45;
	ball.dx += Math.random() * 0.04 - 0.02;
	ball.dy += Math.random() * 0.04 - 0.02;
	ball.dx = Math.min(Math.max(ball.dx, -maxc), maxc);
	ball.dy = Math.min(Math.max(ball.dy, -maxc), maxc);
	if (Math.abs(ball.dx) < minc) ball.dx = ball.dx > 0 ? minc : -minc;
	if (Math.abs(ball.dy) < minc) ball.dy = ball.dy > 0 ? minc : -minc;
}

function boostFactor(team) {
	return boost[team] && Date.now() < boost[team].until ? boost[team].factor : 1;
}

function step() {
	for (var n = 0; n < balls.length; n++) {
		var ball = balls[n];
		if (frozen[ball.team] && Date.now() < frozen[ball.team].until) continue;
		checkSquareCollision(ball);
		checkBoundaryCollision(ball);
		var f = boostFactor(ball.team);
		ball.x += ball.dx * f;
		ball.y += ball.dy * f;
		if (ball.trail) { ball.trail.push({ x: ball.x, y: ball.y }); if (ball.trail.length > TRAIL_LEN) ball.trail.shift(); }
		addRandomness(ball);
	}
}

// re-normalise every ball to the current speed (used when the speed slider moves)
function rescaleBalls() {
	for (var n = 0; n < balls.length; n++) {
		var b = balls[n];
		var m = Math.hypot(b.dx, b.dy) || 1;
		var s = cfg.speed / m;
		b.dx *= s; b.dy *= s;
	}
}
// #endregion

// #region render
function drawSquares() {
	var cell = cfg.cell;
	var useNeon = neon && !isLight;
	var pal = useNeon ? fields : colors;
	for (var t = 0; t < teamCount; t++) scores[t] = 0;
	for (var i = 0; i < nx; i++) {
		for (var j = 0; j < ny; j++) {
			var team = squares[i][j];
			scores[team]++;
			ctx.fillStyle = pal[team];
			ctx.fillRect(i * cell, j * cell, cell, cell);
		}
	}
	if (useNeon && heat) {
		ctx.save();
		ctx.globalCompositeOperation = "lighter";
		for (var hi = 0; hi < nx; hi++) {
			for (var hj = 0; hj < ny; hj++) {
				var hv = heat[hi * ny + hj];
				if (hv > 0.02) {
					var hc = accentRGB[squares[hi][hj]];
					ctx.globalAlpha = hv * 0.7;
					ctx.fillStyle = rgba([(hc[0] + 255) / 2, (hc[1] + 255) / 2, (hc[2] + 255) / 2], 1);
					ctx.fillRect(hi * cell, hj * cell, cell, cell);
				}
			}
		}
		ctx.restore();
	}
	if (useNeon) { if (gridLines) drawGridLines(); drawFrontier(); }
	drawFieldVignette();
}

// faint constant tron-grid so the field reads as a lattice even on solid territory
function drawGridLines() {
	var cell = cfg.cell;
	ctx.save();
	var gpulse = (0.03 + 0.022 * (0.5 + 0.5 * Math.sin(pulseT * 0.6))).toFixed(3);
	ctx.strokeStyle = "rgba(120,200,255," + gpulse + ")";
	ctx.lineWidth = 1;
	ctx.beginPath();
	for (var x = cell; x < canvasWidth; x += cell) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, canvasHeight); }
	for (var y = cell; y < canvasHeight; y += cell) { ctx.moveTo(0, y + 0.5); ctx.lineTo(canvasWidth, y + 0.5); }
	ctx.stroke();
	ctx.restore();
}

// glowing neon seams along every border between two territories (the battle frontier)
function drawFrontier() {
	var cell = cfg.cell;
	var w = Math.min(4, Math.max(2, cell * 0.16));
	ctx.save();
	ctx.globalCompositeOperation = "lighter";
	for (var i = 0; i < nx; i++) {
		for (var j = 0; j < ny; j++) {
			var t = squares[i][j];
			if (i + 1 < nx) {
				var tr = squares[i + 1][j];
				if (tr !== t) {
					var x = (i + 1) * cell;
					ctx.fillStyle = rgba(accentRGB[t], 0.16);  ctx.fillRect(x - w / 2, j * cell, w, cell);
					ctx.fillStyle = rgba(accentRGB[tr], 0.16); ctx.fillRect(x - w / 2, j * cell, w, cell);
				}
			}
			if (j + 1 < ny) {
				var tb = squares[i][j + 1];
				if (tb !== t) {
					var y = (j + 1) * cell;
					ctx.fillStyle = rgba(accentRGB[t], 0.16);  ctx.fillRect(i * cell, y - w / 2, cell, w);
					ctx.fillStyle = rgba(accentRGB[tb], 0.16); ctx.fillRect(i * cell, y - w / 2, cell, w);
				}
			}
		}
	}
	ctx.restore();
}

function drawTrails() {
	if (!trails) return;
	var r = cfg.cell / 2;
	var useNeon = neon && !isLight;
	var twoTeam = teamCount === 2;
	ctx.save();
	ctx.globalCompositeOperation = useNeon ? "lighter" : "source-over";
	for (var n = 0; n < balls.length; n++) {
		var ball = balls[n];
		var pts = ball.trail;
		if (!pts || pts.length < 2) continue;
		var rgb = useNeon ? accentRGB[ball.team] : hexToRgb(twoTeam ? colors[1 - ball.team] : colors[ball.team]);
		var L = pts.length;
		for (var k = 0; k < L; k++) {
			var a = (k + 1) / L;                 // 0 = tail, 1 = head
			ctx.globalAlpha = (useNeon ? 0.5 : 0.28) * a * a;
			var rad = r * (0.2 + a * 0.85);
			ctx.beginPath();
			ctx.arc(pts[k].x, pts[k].y, rad, 0, Math.PI * 2);
			ctx.fillStyle = rgba(rgb, 1);
			ctx.fill();
		}
	}
	ctx.restore();
}

function drawBalls() {
	drawTrails();
	var r = cfg.cell / 2;
	var useNeon = neon && !isLight;
	var twoTeam = teamCount === 2;
	for (var n = 0; n < balls.length; n++) {
		var ball = balls[n];
		var teamCol = colors[ball.team];

		if (useNeon) {
			var rgb = accentRGB[ball.team];
			var _ang = Math.atan2(ball.dy, ball.dx), _sp = Math.hypot(ball.dx, ball.dy) || 1, _st = Math.min(1.9, 1 + _sp / (cfg.speed * 2.2)), _ha = 1.5 + 0.2 * Math.sin(pulseT * 1.6 + n);
			ctx.save();
			ctx.globalCompositeOperation = "lighter";
			if (glow) { ctx.shadowBlur = cfg.cell * 1.4; ctx.shadowColor = teamCol; }
			ctx.globalAlpha = 0.45;
			ctx.beginPath(); ctx.ellipse(ball.x, ball.y, r * _ha * _st, r * _ha, _ang, 0, Math.PI * 2);
			ctx.fillStyle = rgba(rgb, 1); ctx.fill();
			ctx.shadowBlur = 0;
			ctx.globalAlpha = 1;
			ctx.beginPath(); ctx.ellipse(ball.x, ball.y, r * _st, r, _ang, 0, Math.PI * 2);
			ctx.fillStyle = rgba(rgb, 1); ctx.fill();
			ctx.beginPath(); ctx.arc(ball.x, ball.y, r * 0.42, 0, Math.PI * 2);
			ctx.fillStyle = "#ffffff"; ctx.fill();
			ctx.restore();
			continue;
		}

		var fill = twoTeam ? colors[1 - ball.team] : teamCol;
		if (glow) { ctx.shadowBlur = cfg.cell * 0.7; ctx.shadowColor = teamCol; }
		ctx.beginPath();
		ctx.arc(ball.x, ball.y, r, 0, Math.PI * 2);
		ctx.fillStyle = fill;
		ctx.fill();
		if (!twoTeam) {
			ctx.shadowBlur = 0;
			ctx.lineWidth = Math.max(2, cfg.cell * 0.16);
			ctx.strokeStyle = contrastColor(fill);
			ctx.stroke();
		}
	}
	ctx.shadowBlur = 0;
}

function updateScoreboard() {
	var total = 0;
	for (var t = 0; t < teamCount; t++) total += scores[t];
	if (!total) total = 1;

	var leader = 0, maxv = -1, tie = false;
	for (var k = 0; k < teamCount; k++) {
		var p = scores[k] / total;
		barW[k] = (barW[k] == null ? p : barW[k] + (p - barW[k]) * 0.12);
		if (segEls[k]) segEls[k].style.width = (barW[k] * 100) + "%";
		pctShown[k] = (pctShown[k] == null ? p * 100 : pctShown[k] + (p * 100 - pctShown[k]) * 0.16);
		if (pctEls[k]) pctEls[k].textContent = Math.round(pctShown[k]) + "%";
		if (scores[k] > maxv) { maxv = scores[k]; leader = k; tie = false; }
		else if (scores[k] === maxv) tie = true;
	}

	var L = tie ? -1 : leader;
	if (L !== -1 && L !== lastLeader && lastLeader !== -1) { emit("lead", { team: L, name: names[L] }); var lcChip = dotEls[L] ? dotEls[L].parentNode : null; if (lcChip) { lcChip.classList.remove("pw-leadflash"); void lcChip.offsetWidth; lcChip.classList.add("pw-leadflash"); } }
	if (L !== -1) lastLeader = L;
	for (var c = 0; c < teamCount; c++) {
		var chip = dotEls[c] ? dotEls[c].parentNode : null;
		if (chip) chip.classList.toggle("pw-lead", c === L);
	}
}

function endRound() {
	if (roundOver) return;
	if (resetTimer) { clearTimeout(resetTimer); resetTimer = null; }
	var w = 0, mx = -1;
	for (var t = 0; t < teamCount; t++) { if ((scores[t] || 0) > mx) { mx = scores[t]; w = t; } }
	roundOver = true;
	emit("win", { team: w, name: names[w] });
	showBanner(names[w] + " wins! 🏆", autoRestart ? 3000 : 4000);
	shake(22); spawnSparks(canvasWidth / 2, canvasHeight / 2, accentRGB[w], 120, 4); glitch = Math.max(glitch, 1);
	if (autoRestart) resetTimer = setTimeout(reset, 3200);
}

function checkWin() {
	if (roundOver) return;
	var total = 0;
	for (var t = 0; t < teamCount; t++) total += scores[t];
	if (!total) return;
	// a near-total wipeout ends the round (pure pong-wars usually oscillates forever,
	// but boosts / drops can run it to the wall — don't let the screen freeze solid).
	for (var w = 0; w < teamCount; w++) {
		if (scores[w] / total >= 0.99) {
			roundOver = true;
			emit("win", { team: w, name: names[w] });
			showBanner(names[w] + " wins! 🏆", autoRestart ? 3000 : 4000);
			shake(22); spawnSparks(canvasWidth / 2, canvasHeight / 2, accentRGB[w], 120, 4); glitch = Math.max(glitch, 1);
			if (autoRestart) resetTimer = setTimeout(reset, 3200);
			return;
		}
	}
}
// #endregion

// #region overlay / banner / shake
var bannerTimer = null;
function showBanner(text, ms) {
	bannerEl.textContent = text;
	bannerEl.classList.add("pw-show");
	if (bannerTimer) clearTimeout(bannerTimer);
	bannerTimer = setTimeout(function () { bannerEl.classList.remove("pw-show"); }, ms || 3000);
}

// magnitude-based screen shake; applyShake() (called each frame) consumes + decays it
function shake(mag) {
	shakeMag = Math.min(48, Math.max(shakeMag, mag || 12));
}

// jitter the play area (canvas + frame) by the current magnitude, then decay
function applyShake() {
	if (shakeMag > 0.5) {
		var ox = (Math.random() * 2 - 1) * shakeMag;
		var oy = (Math.random() * 2 - 1) * shakeMag;
		var tf = "translate(calc(-50% + " + ox.toFixed(1) + "px), calc(-50% + " + oy.toFixed(1) + "px))";
		backgroundCanvas.style.transform = tf;
		if (pwFrame) pwFrame.style.transform = tf;
		shakeMag *= 0.86;
	} else if (shakeMag !== 0) {
		shakeMag = 0;
		backgroundCanvas.style.transform = "translate(-50%, -50%)";
		if (pwFrame) pwFrame.style.transform = "translate(-50%, -50%)";
	}
}

// ── capture sparks ──
function spawnSparks(x, y, rgb, count, power) {
	power = power || 1;
	for (var k = 0; k < count; k++) {
		if (particles.length >= PARTICLE_CAP) break;
		var a = Math.random() * Math.PI * 2;
		var sp = (0.6 + Math.random() * 2.6) * power;
		var life = 12 + Math.random() * 16 * power;
		particles.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: life, maxLife: life, rgb: rgb || [255, 255, 255], size: (0.8 + Math.random() * 1.5) * Math.sqrt(power) });
	}
}

function stepHeat() {
	if (!heat) return;
	for (var i = 0; i < heat.length; i++) { if (heat[i] > 0.004) heat[i] *= 0.86; else heat[i] = 0; }
}

function stepImpacts() {
	for (var i = impacts.length - 1; i >= 0; i--) {
		var im = impacts[i];
		im.r += (im.maxR - im.r) * 0.28;
		if (--im.life <= 0) impacts.splice(i, 1);
	}
}

function drawImpacts() {
	if (!impacts.length) return;
	ctx.save();
	ctx.globalCompositeOperation = "lighter";
	for (var i = 0; i < impacts.length; i++) {
		var im = impacts[i];
		var a = im.life / im.maxLife;
		ctx.globalAlpha = a * 0.8;
		ctx.lineWidth = Math.max(1, 3 * a);
		ctx.strokeStyle = rgba(im.rgb, 1);
		ctx.beginPath();
		ctx.arc(im.x, im.y, im.r, 0, Math.PI * 2);
		ctx.stroke();
	}
	ctx.restore();
}

function applyTransition() {
	if (transition >= 1) return;
	var rx = transition * canvasWidth;
	ctx.fillStyle = isLight ? lightCanvasBg : darkCanvasBg;
	ctx.fillRect(rx, 0, canvasWidth - rx + 1, canvasHeight);
	if (neon && !isLight) {
		ctx.save();
		ctx.globalCompositeOperation = "lighter";
		ctx.fillStyle = "rgba(150,230,255,0.55)";
		ctx.fillRect(rx - 3, 0, 6, canvasHeight);
		ctx.restore();
	}
}

function applyBloom() {
	if (!bloomOn || !(neon && !isLight)) return;
	var bw = bloomCanvas.width, bh = bloomCanvas.height;
	bloomCtx.clearRect(0, 0, bw, bh);
	bloomCtx.drawImage(backgroundCanvas, 0, 0, bw, bh);
	ctx.save();
	ctx.globalCompositeOperation = "lighter";
	ctx.globalAlpha = 0.5;
	ctx.imageSmoothingEnabled = true;
	ctx.drawImage(bloomCanvas, 0, 0, bw, bh, 0, 0, canvasWidth, canvasHeight);
	ctx.restore();
}

function applyGlitch() {
	if (glitch <= 0.02) return;
	var amp = glitch * 18;
	fxCtx.clearRect(0, 0, canvasWidth, canvasHeight);
	fxCtx.drawImage(backgroundCanvas, 0, 0);
	ctx.save();
	ctx.globalCompositeOperation = "lighter";
	ctx.globalAlpha = 0.3;
	ctx.drawImage(fxCanvas, amp, 0);
	ctx.drawImage(fxCanvas, -amp, 0);
	ctx.restore();
	for (var b = 0; b < 5; b++) {
		var by = Math.random() * canvasHeight;
		var bhh = 6 + Math.random() * 46;
		var ox = (Math.random() * 2 - 1) * amp * 2.2;
		ctx.drawImage(fxCanvas, 0, by, canvasWidth, bhh, ox, by, canvasWidth, bhh);
	}
}

var _vigKey = "", _vigGrad = null;
function drawFieldVignette() {
	if (!(neon && !isLight)) return;
	var key = canvasWidth + "x" + canvasHeight;
	if (key !== _vigKey) {
		_vigKey = key;
		_vigGrad = ctx.createRadialGradient(canvasWidth / 2, canvasHeight * 0.46, canvasWidth * 0.2, canvasWidth / 2, canvasHeight / 2, canvasWidth * 0.72);
		_vigGrad.addColorStop(0, "rgba(0,0,0,0)");
		_vigGrad.addColorStop(1, "rgba(0,0,0,0.34)");
	}
	ctx.save();
	ctx.fillStyle = _vigGrad;
	ctx.fillRect(0, 0, canvasWidth, canvasHeight);
	ctx.restore();
}

function stepParticles() {
	for (var i = particles.length - 1; i >= 0; i--) {
		var p = particles[i];
		p.x += p.vx; p.y += p.vy;
		p.vx *= 0.9; p.vy *= 0.9;
		if (--p.life <= 0) particles.splice(i, 1);
	}
}

function drawParticles() {
	if (!particles.length) return;
	var useNeon = neon && !isLight;
	ctx.save();
	ctx.globalCompositeOperation = useNeon ? "lighter" : "source-over";
	for (var i = 0; i < particles.length; i++) {
		var p = particles[i];
		var al = p.life / p.maxLife;
		ctx.globalAlpha = al;
		ctx.beginPath();
		ctx.arc(p.x, p.y, p.size * (0.4 + al * 0.7), 0, Math.PI * 2);
		ctx.fillStyle = rgba(p.rgb, 1);
		ctx.fill();
	}
	ctx.restore();
}

function setOverlay(on) {
	overlayEl.classList.toggle("pw-show", !!on);
}
// #endregion

// #region dynamic UI (scoreboard + team controls)
function buildScoreboard() {
	var bar = '<div class="pw-bar" id="pwBar">';
	for (var t = 0; t < teamCount; t++) bar += "<div></div>";
	bar += '</div><div class="pw-legend" id="pwLegend">';
	for (var c = 0; c < teamCount; c++)
		bar += '<span class="pw-chip"><span class="pw-dot"></span><span class="pw-cname"></span><span class="pw-pct">0%</span></span>';
	bar += "</div>";
	scoreEl.innerHTML = bar;

	segEls = [].slice.call(scoreEl.querySelectorAll("#pwBar > div"));
	dotEls = []; nameSBEls = []; pctEls = []; barW = []; pctShown = [];
	scoreEl.querySelectorAll("#pwLegend .pw-chip").forEach(function (chip, t) {
		dotEls[t] = chip.querySelector(".pw-dot");
		nameSBEls[t] = chip.querySelector(".pw-cname");
		pctEls[t] = chip.querySelector(".pw-pct");
		nameSBEls[t].textContent = names[t];
	});
	applyColors();
}

function buildTeamControls() {
	var html = "";
	for (var t = 0; t < teamCount; t++) {
		html += '<div class="pw-team-row">'
			+ '<input type="color" class="pw-tcolor" data-team="' + t + '">'
			+ '<input type="text" class="pw-tname" data-team="' + t + '" maxlength="18">'
			+ "</div>";
	}
	teamControlsEl.innerHTML = html;

	colorInputs = []; nameInputs = [];
	teamControlsEl.querySelectorAll(".pw-tcolor").forEach(function (el) {
		var t = +el.dataset.team;
		colorInputs[t] = el;
		el.value = colors[t];
		el.oninput = function () { colors[t] = this.value; setPresetRadio("custom"); applyColors(); };
	});
	teamControlsEl.querySelectorAll(".pw-tname").forEach(function (el) {
		var t = +el.dataset.team;
		nameInputs[t] = el;
		el.value = names[t];
		el.oninput = function () { setName(t, this.value); };
	});
}

var POWERUPS = [
	{ key: "smash", label: "Smash 💥" },
	{ key: "boost", label: "Boost ⚡" },
	{ key: "multi", label: "Multiball ✦" },
	{ key: "freeze", label: "Freeze ❄" },
];

function buildPowerups() {
	if (!powerupsEl) return;
	var html = "";
	for (var p = 0; p < POWERUPS.length; p++) {
		html += '<div class="pw-pu-row"><span class="pw-pu-label">' + POWERUPS[p].label + '</span><span class="pw-pu-btns">';
		for (var t = 0; t < teamCount; t++)
			html += '<button class="pw-pu-btn" data-pu="' + POWERUPS[p].key + '" data-team="' + t + '">' + (t + 1) + '</button>';
		html += '</span></div>';
	}
	powerupsEl.innerHTML = html;
	tintPowerups();
}

function tintPowerups() {
	if (!powerupsEl) return;
	powerupsEl.querySelectorAll(".pw-pu-btn").forEach(function (b) {
		var t = +b.dataset.team;
		b.style.borderColor = colors[t];
		b.style.color = colors[t];
		b.title = names[t];
	});
}

function firePowerup(pu, t) {
	if (pu === "smash") { PongWars.smash(t); showBanner(names[t] + " armed a SMASH! 💥", 2200); }
	else if (pu === "boost") { PongWars.boost(t, 2.2, 6000); showBanner(names[t] + " boosted! ⚡", 2200); }
	else if (pu === "multi") { PongWars.spawnBall(t, 1); showBanner(names[t] + " +1 ball ✦", 2000); }
	else if (pu === "freeze") { PongWars.freeze(t, 4000); showBanner(names[t] + " froze the field! ❄", 2200); }
}

function setName(team, value) {
	names[team] = value;
	if (nameSBEls[team]) nameSBEls[team].textContent = value;
	if (nameInputs[team]) nameInputs[team].value = value;
}

function setTeamCount(n) {
	if (TEAM_COUNTS.indexOf(n) < 0) return;
	teamCount = n;

	if (preset !== "custom" && PALETTES[preset]) {
		colors = PALETTES[preset].slice(0, n);
	} else {
		colors = colors.slice(0, n);
		while (colors.length < n) colors.push(PALETTES.neon[colors.length]);
	}
	names = names.slice(0, n);
	while (names.length < n) names.push(DEFAULT_NAMES[names.length]);
	boost = [];
	for (var t = 0; t < n; t++) boost.push({ factor: 1, until: 0 });
	frozen = []; smashArmed = [];

	var radio = document.querySelector('input[name="teamcount"][value="' + n + '"]');
	if (radio) radio.checked = true;

	buildScoreboard();
	buildTeamControls();
	buildPowerups();
	lastLeader = -1;
	reset();
}
// #endregion

// #region inputs
function bindSlider(id, valId, parse, onChange, fmt) {
	var slider = document.getElementById(id);
	var label = document.getElementById(valId);
	slider.value = onChange.initial;
	label.innerHTML = fmt ? fmt(onChange.initial) : onChange.initial;
	slider.oninput = function () {
		var v = parse(this.value);
		label.innerHTML = fmt ? fmt(v) : v;
		onChange(v);
	};
}

bindSlider("cellSlider", "cellValue", parseInt, Object.assign(function (v) {
	cfg.cell = v;
	buildGrid();
}, { initial: cfg.cell }));

bindSlider("speedSlider", "speedValue", parseFloat, Object.assign(function (v) {
	cfg.speed = v;
	rescaleBalls();
}, { initial: cfg.speed }), function (v) { return v.toFixed(1); });

bindSlider("ballsSlider", "ballsValue", parseInt, Object.assign(function (v) {
	cfg.ballsPerTeam = v;
	buildBalls();
}, { initial: cfg.ballsPerTeam }));

bindSlider("satSlider", "satValue", parseInt, Object.assign(function (v) {
	fieldSat = v / 100;
	recomputeStyle();
}, { initial: Math.round(fieldSat * 100) }), function (v) { return v + "%"; });

var glowCheckbox = document.getElementById("glowCheckbox");
var scoreCheckbox = document.getElementById("scoreCheckbox");
var autoCheckbox = document.getElementById("autoCheckbox");
var neonCheckbox = document.getElementById("neonCheckbox");
var trailCheckbox = document.getElementById("trailCheckbox");
var crtCheckbox = document.getElementById("crtCheckbox");
var gridCheckbox = document.getElementById("gridCheckbox");
var bloomCheckbox = document.getElementById("bloomCheckbox");

function applyPreset(name) {
	preset = name;
	if (name !== "custom" && PALETTES[name]) {
		colors = PALETTES[name].slice(0, teamCount);
	}
	applyColors();
}

document.querySelectorAll('input[name="preset"]').forEach(function (radio) {
	radio.addEventListener("change", function () { if (this.checked) applyPreset(this.value); });
});

document.querySelectorAll('input[name="teamcount"]').forEach(function (radio) {
	radio.addEventListener("change", function () { if (this.checked) setTeamCount(parseInt(this.value, 10)); });
});

function setPresetRadio(name) {
	preset = name;
	var el = document.querySelector('input[name="preset"][value="' + name + '"]');
	if (el) el.checked = true;
}


var gameWidthInput = document.getElementById("gameWidthInput");
var gameHeightInput = document.getElementById("gameHeightInput");

document.getElementById("applySizeBtn").onclick = function () {
	gameW = Math.max(200, parseInt(gameWidthInput.value) || 1000);
	gameH = Math.max(200, parseInt(gameHeightInput.value) || 1000);
	gameWidthInput.value = gameW;
	gameHeightInput.value = gameH;
	applyCanvasSize();
	reset();
};

glowCheckbox.onclick = function () { glow = this.checked; };
neonCheckbox.onclick = function () { neon = this.checked; document.body.classList.toggle("neon", neon && !isLight); recomputeStyle(); };
trailCheckbox.onclick = function () { trails = this.checked; };
crtCheckbox.onclick = function () { crt = this.checked; document.body.classList.toggle("crt-off", !crt); };
gridCheckbox.onclick = function () { gridLines = this.checked; };
bloomCheckbox.onclick = function () { bloomOn = this.checked; };
scoreCheckbox.onclick = function () { showScore = this.checked; scoreEl.classList.toggle("pw-hidden", !showScore); };
autoCheckbox.onclick = function () { autoRestart = this.checked; };

var pauseButton = document.getElementById("pauseButton");
pauseButton.onclick = togglePause;
function togglePause() {
	paused = !paused;
	pauseButton.textContent = paused ? "Resume (Space)" : "Pause (Space)";
}

document.getElementById("newButton").onclick = relaunch;
document.getElementById("resetButton").onclick = reset;
document.getElementById("endButton").onclick = endRound;

// power-up buttons — delegated so it survives buildPowerups() rebuilds
if (powerupsEl) powerupsEl.onclick = function (e) {
	var b = e.target.closest(".pw-pu-btn");
	if (!b) return;
	firePowerup(b.dataset.pu, +b.dataset.team);
};

// chat-event preview buttons — fire the same API a bot/redemption would
document.getElementById("testBanner").onclick = function () { showBanner("@chatter just followed! 💜", 3000); };
document.getElementById("testShake").onclick = function () { shake(); };

window.addEventListener("keydown", function (e) {
	if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;   // don't hijack text fields
	if (e.code === "Space") { e.preventDefault(); togglePause(); }
	if (e.key === "r" || e.key === "R") reset();
	if (e.key === "n" || e.key === "N") relaunch();
	if (e.key === "o" || e.key === "O") setOverlay(!overlayEl.classList.contains("pw-show"));
});

// #endregion

// #region resize
// fixed game-area canvas — no resize handling needed
// #endregion

// #region remote-control API (Twitch hook)
// Everything Twitch chat / channel points should be able to do funnels through here.
// Drive it four ways (all whitelisted to these methods): the global PongWars.*,
// window.postMessage({type:"pongwars", method, args}), a BroadcastChannel("pongwars")
// message, a localStorage "pongwars-cmd" write, or a WebSocket (?ws=). See TWITCH_IDEAS.md.
var listeners = {};

function emit(ev, data) {
	(listeners[ev] || []).forEach(function (cb) { try { cb(data); } catch (e) {} });
	window.dispatchEvent(new CustomEvent("pongwars:" + ev, { detail: data }));
}

function getState() {
	var total = 0;
	for (var t = 0; t < teamCount; t++) total += (scores[t] || 0);
	if (!total) total = 1;
	var teams = [];
	var leader = -1, maxv = -1, tie = false;
	for (var k = 0; k < teamCount; k++) {
		var sc = scores[k] || 0;
		teams.push({ index: k, name: names[k], color: colors[k], score: sc, percent: sc / total });
		if (sc > maxv) { maxv = sc; leader = k; tie = false; }
		else if (sc === maxv) tie = true;
	}
	return {
		teamCount: teamCount,
		teams: teams,
		scores: scores.slice(0, teamCount),
		names: names.slice(0, teamCount),
		colors: colors.slice(0, teamCount),
		leader: tie ? null : leader,
		paused: paused,
		roundOver: roundOver,
		ballsPerTeam: cfg.ballsPerTeam,
		cellSize: cfg.cell,
		speed: cfg.speed,
	};
}

var PongWars = {
	// ── battle actions (great for channel-point redemptions) ──
	boost: function (team, factor, ms) {
		var t = resolveTeam(team);
		boost[t] = { factor: factor || 2, until: Date.now() + (ms || 5000) };
		emit("boost", { team: t, name: names[t], factor: factor || 2 });
	},
	spawnBall: function (team, n) {
		var t = resolveTeam(team);
		n = n || 1;
		for (var k = 0; k < n; k++) {
			if (balls.length >= 60) break;
			balls.push(makeBall(t, balls.length));
		}
	},
	removeBall: function (team, n) {
		var t = resolveTeam(team);
		n = n || 1;
		for (var k = 0; k < n; k++) {
			for (var i = balls.length - 1; i >= 0; i--) {
				if (balls[i].team === t) { balls.splice(i, 1); break; }
			}
		}
	},
	// convert a circular patch to a team. x/y accept px or normalised 0..1.
	paintBlob: function (team, x, y, radius) {
		var t = resolveTeam(team);
		if (x == null) x = Math.random();
		if (y == null) y = Math.random();
		if (x <= 1) x *= canvasWidth;
		if (y <= 1) y *= canvasHeight;
		var r = radius || cfg.cell * 4;
		var cell = cfg.cell;
		var i0 = Math.max(0, Math.floor((x - r) / cell)), i1 = Math.min(nx - 1, Math.floor((x + r) / cell));
		var j0 = Math.max(0, Math.floor((y - r) / cell)), j1 = Math.min(ny - 1, Math.floor((y + r) / cell));
		for (var i = i0; i <= i1; i++) {
			for (var j = j0; j <= j1; j++) {
				var dx = (i + 0.5) * cell - x, dy = (j + 0.5) * cell - y;
				if (dx * dx + dy * dy <= r * r) { squares[i][j] = t; if (heat) heat[i * ny + j] = 1; }
			}
		}
	},
	// scatter n random tiles to a team (chaotic sprinkle)
	paintRandom: function (team, n) {
		var t = resolveTeam(team);
		n = n || 40;
		for (var k = 0; k < n; k++) {
			squares[(Math.random() * nx) | 0][(Math.random() * ny) | 0] = t;
		}
	},

	// ── power-ups (chat-triggerable) ──
	smash: function (team, radius) {
		var t = resolveTeam(team);
		smashArmed[t] = radius || cfg.cell * 6;
		emit("smash", { team: t, name: names[t] });
	},
	freeze: function (team, ms) {
		var t = resolveTeam(team);
		var until = Date.now() + (ms || 4000);
		for (var k = 0; k < teamCount; k++) if (k !== t) frozen[k] = { until: until };
		emit("freeze", { team: t, name: names[t] });
	},

	// ── presentation ──
	setTeamName: function (team, name) { setName(resolveTeam(team), String(name).slice(0, 18)); },
	setTeamColor: function (team, color) {
		var t = resolveTeam(team);
		colors[t] = color;
		if (colorInputs[t]) colorInputs[t].value = color;
		setPresetRadio("custom");
		applyColors();
	},
	setTeamCount: function (n) { setTeamCount(parseInt(n, 10)); },
	setPreset: function (name) { if (PALETTES[name]) { setPresetRadio(name); applyPreset(name); } },
	banner: function (text, ms) { showBanner(String(text), ms); },
	shake: function () { shake(); },
	endRound: function () { endRound(); },
	setNeon: function (on) { neon = !!on; neonCheckbox.checked = neon; document.body.classList.toggle("neon", neon && !isLight); recomputeStyle(); },
	setTrails: function (on) { trails = !!on; trailCheckbox.checked = trails; },
	overlay: function (on, title, sub) {
		if (title != null) { titleEl.textContent = title; titleInput.value = title; }
		if (sub != null) { subEl.textContent = sub; subInput.value = sub; }
		setOverlay(on);
	},

	// ── config ──
	setSpeed: function (v) { cfg.speed = +v; document.getElementById("speedSlider").value = v; document.getElementById("speedValue").textContent = (+v).toFixed(1); rescaleBalls(); },
	setCellSize: function (v) { cfg.cell = +v; document.getElementById("cellSlider").value = v; document.getElementById("cellValue").textContent = v; buildGrid(); },
	setBallsPerTeam: function (v) { cfg.ballsPerTeam = +v; document.getElementById("ballsSlider").value = v; document.getElementById("ballsValue").textContent = v; buildBalls(); },

	// ── lifecycle ──
	reset: reset,
	relaunch: relaunch,
	pause: function () { if (!paused) togglePause(); },
	resume: function () { if (paused) togglePause(); },
	togglePause: togglePause,

	// ── read / observe ──
	getState: getState,
	on: function (ev, cb) { (listeners[ev] = listeners[ev] || []).push(cb); return PongWars; },
	off: function (ev, cb) { listeners[ev] = (listeners[ev] || []).filter(function (f) { return f !== cb; }); return PongWars; },
};
window.PongWars = PongWars;

// methods a remote transport is allowed to invoke (read-only/observer methods excluded)
var COMMANDS = {
	boost: 1, spawnBall: 1, removeBall: 1, paintBlob: 1, paintRandom: 1, smash: 1, freeze: 1,
	setTeamName: 1, setTeamColor: 1, setTeamCount: 1, setPreset: 1, banner: 1, shake: 1, overlay: 1, setNeon: 1, setTrails: 1,
	setSpeed: 1, setCellSize: 1, setBallsPerTeam: 1, endRound: 1,
	reset: 1, relaunch: 1, pause: 1, resume: 1, togglePause: 1,
};

function dispatchCommand(cmd) {
	if (!cmd || !COMMANDS[cmd.method] || typeof PongWars[cmd.method] !== "function") return;
	try { PongWars[cmd.method].apply(PongWars, cmd.args || []); } catch (e) {}
}

// transport 1: postMessage (OBS browser source / parent iframe)
window.addEventListener("message", function (e) {
	var d = e.data;
	if (d && d.type === "pongwars") dispatchCommand(d);
});

// transport 2: BroadcastChannel (another tab / local bot on this machine)
if (typeof BroadcastChannel !== "undefined") {
	try {
		var pwChannel = new BroadcastChannel("pongwars");
		pwChannel.onmessage = function (e) { dispatchCommand(e.data); };
	} catch (e) {}
}

// transport 3: localStorage write (cross-tab, e.g. a tiny bot page)
window.addEventListener("storage", function (e) {
	if (e.key !== "pongwars-cmd" || !e.newValue) return;
	try { dispatchCommand(JSON.parse(e.newValue)); } catch (err) {}
});

// transport 4: WebSocket (opt-in via ?ws=ws://host:port) — the cleanest path for a
// Twitch EventSub / chat bridge running in a separate process. Auto-reconnects.
function connectWS(url) {
	var ws;
	function open() {
		try { ws = new WebSocket(url); } catch (e) { return; }
		ws.onmessage = function (e) { try { dispatchCommand(JSON.parse(e.data)); } catch (err) {} };
		ws.onclose = function () { setTimeout(open, 2000); };
		ws.onerror = function () { try { ws.close(); } catch (e) {} };
	}
	open();
}
var wsParam = new URLSearchParams(window.location.search).get("ws");
if (wsParam) connectWS(wsParam);
// #endregion

// #region url params — preconfigure from the browser-source URL
(function applyParams() {
	var q = new URLSearchParams(window.location.search);
	if (!q.toString()) return;
	if (q.has("teams")) setTeamCount(parseInt(q.get("teams"), 10));
	if (q.has("preset") && PALETTES[q.get("preset")]) { setPresetRadio(q.get("preset")); applyPreset(q.get("preset")); }
	if (q.has("colors")) {
		q.get("colors").split(",").forEach(function (c, t) { if (t < teamCount) colors[t] = "#" + c.replace(/^#/, ""); });
		setPresetRadio("custom"); applyColors();
	}
	if (q.has("names")) {
		q.get("names").split(",").forEach(function (nm, t) { if (t < teamCount) setName(t, nm); });
	}
	// back-compat single-team params (2-team setups)
	if (q.has("colorA")) { colors[0] = "#" + q.get("colorA").replace(/^#/, ""); setPresetRadio("custom"); }
	if (q.has("colorB") && teamCount > 1) { colors[1] = "#" + q.get("colorB").replace(/^#/, ""); setPresetRadio("custom"); }
	if (q.has("a")) setName(0, q.get("a"));
	if (q.has("b") && teamCount > 1) setName(1, q.get("b"));
	if (q.has("speed")) PongWars.setSpeed(parseFloat(q.get("speed")));
	if (q.has("cell")) PongWars.setCellSize(parseInt(q.get("cell"), 10));
	if (q.has("balls")) PongWars.setBallsPerTeam(parseInt(q.get("balls"), 10));
	if (q.has("glow")) { glow = q.get("glow") !== "0"; glowCheckbox.checked = glow; }
	if (q.has("neon")) { neon = q.get("neon") !== "0"; neonCheckbox.checked = neon; document.body.classList.toggle("neon", neon && !isLight); recomputeStyle(); }
	if (q.has("trails")) { trails = q.get("trails") !== "0"; trailCheckbox.checked = trails; }
	if (q.has("crt")) { crt = q.get("crt") !== "0"; crtCheckbox.checked = crt; document.body.classList.toggle("crt-off", !crt); }
	if (q.has("grid")) { gridLines = q.get("grid") !== "0"; gridCheckbox.checked = gridLines; }
	if (q.has("score")) { showScore = q.get("score") !== "0"; scoreCheckbox.checked = showScore; scoreEl.classList.toggle("pw-hidden", !showScore); }
	if (q.has("title")) { titleEl.textContent = q.get("title"); titleInput.value = q.get("title"); }
	if (q.has("sub")) { subEl.textContent = q.get("sub"); subInput.value = q.get("sub"); }
	if (q.get("soon") === "1") setOverlay(true);
	applyColors();
})();
// #endregion

// #region boot
setTeamCount(teamCount);   // builds scoreboard + team controls + grid + balls
// #endregion

// #region loop + fps
var lastFpsUpdate = performance.now();
var frameCount = 0;

function draw(now) {
	window.requestAnimationFrame(draw);
	if (document.hidden) return;

	if (!paused) { stepParticles(); stepImpacts(); stepHeat(); pulseT += 0.05; if (transition < 1) transition = Math.min(1, transition + 0.045); }
	if (glitch > 0) glitch *= 0.84;
	if (!paused && !roundOver) step();

	drawSquares();
	drawImpacts();
	drawBalls();
	drawParticles();
	applyTransition();
	applyBloom();
	applyGlitch();
	updateScoreboard();
	checkWin();
	applyShake();

	frameCount++;
	if (now - lastFpsUpdate >= 500) {
		var fps = Math.round((frameCount * 1000) / (now - lastFpsUpdate));
		var tiles = 0;
		for (var t = 0; t < teamCount; t++) tiles += (scores[t] || 0);
		fpsBadge.textContent = fps + " fps · " + tiles + " tiles";
		frameCount = 0;
		lastFpsUpdate = now;
	}
}
window.requestAnimationFrame(draw);
document.addEventListener("visibilitychange", function () { if (!document.hidden) window.requestAnimationFrame(draw); });
// #endregion
