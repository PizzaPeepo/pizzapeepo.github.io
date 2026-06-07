// Pong Wars — territory battle. N teams (2/4/6/8); each ball paints enemy tiles to
// its own colour and bounces off them, so the frontiers slosh around forever.
// Faithful port of the mechanic from vnglst/pong-wars (MIT), rebuilt on this repo's
// modern-HUD single-canvas pattern and extended into a stream "waiting screen":
// live scoreboard, overlay banner, and a window.PongWars remote-control API so
// Twitch chat / channel points can drive it (see TWITCH_IDEAS.md).

// #region globals
var canvasWidth = window.getCanvasWidth();
var canvasHeight = window.innerHeight;

var cfg = {
	cell: 24,          // tile size in px (grid resolution)
	speed: 8,          // ball speed (px/frame magnitude)
	ballsPerTeam: 1,   // balls launched per team
};

var TEAM_COUNTS = [2, 4, 6, 8];
var teamCount = 2;

var paused = false;
var glow = true;
var showScore = true;
var autoRestart = true;
var roundOver = false;       // frozen during a win celebration
var resetTimer = null;

var darkCanvasBg = "#0d0b14";
var lightCanvasBg = "#f3eee6";
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

// #region theme
function applyThemeColors(light) {
	isLight = light;
	backgroundCanvas.style.background = light ? lightCanvasBg : darkCanvasBg;
}
applyThemeColors(isLight);
document.addEventListener("themechange", function (e) { applyThemeColors(e.detail.isLight); });
// #endregion

// #region state
// Block layouts per team count: [cols, rows] over the canvas. Each team owns one block.
var LAYOUTS = { 2: [2, 1], 4: [2, 2], 6: [3, 2], 8: [4, 2] };

// Colour palettes (up to 8). The first two entries of each match the original 2-team
// presets; extra entries only come into play at higher team counts. A ball reads in the
// opposite colour at 2 teams (the iconic day/night look) and in its own colour + a
// contrast ring beyond that (so it stays visible on its own field).
var PALETTES = {
	classic: ["#d9e8e3", "#114c5a", "#f5a623", "#c0392b", "#27ae60", "#8e44ad", "#2980b9", "#e67e22"],
	twitch:  ["#efeff1", "#9146ff", "#00c8af", "#ff5a36", "#1f8b4c", "#f5d423", "#e83e8c", "#3498db"],
	fireice: ["#dff1ff", "#ff5a36", "#3aa6ff", "#ffb000", "#00d1c1", "#ff3860", "#7ee787", "#b388ff"],
	mono:    ["#e6e6e6", "#222222", "#9e9e9e", "#4d4d4d", "#c4c4c4", "#3a3a3a", "#7a7a7a", "#5e5e5e"],
};
var DEFAULT_NAMES = ["Day", "Night", "Team 3", "Team 4", "Team 5", "Team 6", "Team 7", "Team 8"];

var preset = "classic";
var colors = PALETTES.classic.slice(0, teamCount);   // per-team field colours
var names = DEFAULT_NAMES.slice(0, teamCount);

var squares = [];            // squares[i][j] = team index
var nx = 0, ny = 0;          // grid dimensions
var balls = [];
var scores = [];             // tiles owned per team
var lastLeader = -1;
var boost = [];              // per-team temporary speed multiplier { factor, until }
// #endregion

// #region dom refs
var fpsBadge = document.getElementById("fpsBadge");
var scoreEl = document.getElementById("pwScore");
var overlayEl = document.getElementById("pwOverlay");
var titleEl = document.getElementById("pwTitle");
var subEl = document.getElementById("pwSub");
var bannerEl = document.getElementById("pwBanner");
var teamControlsEl = document.getElementById("pwTeamControls");

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
}

function buildGrid() {
	nx = Math.max(2, Math.ceil(canvasWidth / cfg.cell));
	ny = Math.max(2, Math.ceil(canvasHeight / cfg.cell));
	var L = LAYOUTS[teamCount], cols = L[0], rows = L[1];
	squares = [];
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
	var L = LAYOUTS[teamCount], cols = L[0], rows = L[1];
	var col = team % cols, row = Math.floor(team / cols);
	var hx = (col + 0.5) / cols * canvasWidth;
	var hy = (row + 0.5) / rows * canvasHeight;
	var ang = (k / Math.max(1, cfg.ballsPerTeam)) * Math.PI * 2 + team * 1.3 + Math.random() * 0.6;
	return { team: team, x: hx, y: hy, dx: Math.cos(ang) * cfg.speed, dy: Math.sin(ang) * cfg.speed };
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
	emit("reset", getState());
}
// #endregion

// #region simulation
function checkSquareCollision(ball) {
	var cell = cfg.cell;
	var flipX = false, flipY = false;
	for (var a = 0; a < Math.PI * 2; a += Math.PI / 4) {
		var checkX = ball.x + Math.cos(a) * (cell / 2);
		var checkY = ball.y + Math.sin(a) * (cell / 2);
		var i = Math.floor(checkX / cell);
		var j = Math.floor(checkY / cell);
		if (i >= 0 && i < nx && j >= 0 && j < ny) {
			if (squares[i][j] !== ball.team) {
				squares[i][j] = ball.team;
				if (Math.abs(Math.cos(a)) > Math.abs(Math.sin(a))) flipX = !flipX;
				else flipY = !flipY;
			}
		}
	}
	if (flipX) ball.dx = -ball.dx;
	if (flipY) ball.dy = -ball.dy;
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
		checkSquareCollision(ball);
		checkBoundaryCollision(ball);
		var f = boostFactor(ball.team);
		ball.x += ball.dx * f;
		ball.y += ball.dy * f;
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
	for (var t = 0; t < teamCount; t++) scores[t] = 0;
	for (var i = 0; i < nx; i++) {
		for (var j = 0; j < ny; j++) {
			var team = squares[i][j];
			scores[team]++;
			ctx.fillStyle = colors[team];
			ctx.fillRect(i * cell, j * cell, cell, cell);
		}
	}
}

function drawBalls() {
	var r = cfg.cell / 2;
	var twoTeam = teamCount === 2;
	for (var n = 0; n < balls.length; n++) {
		var ball = balls[n];
		var teamCol = colors[ball.team];
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
		if (segEls[k]) segEls[k].style.width = (p * 100) + "%";
		if (pctEls[k]) pctEls[k].textContent = Math.round(p * 100) + "%";
		if (scores[k] > maxv) { maxv = scores[k]; leader = k; tie = false; }
		else if (scores[k] === maxv) tie = true;
	}

	var L = tie ? -1 : leader;
	if (L !== -1 && L !== lastLeader && lastLeader !== -1) emit("lead", { team: L, name: names[L] });
	if (L !== -1) lastLeader = L;
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
			shake();
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

function shake() {
	backgroundCanvas.classList.remove("pw-shaking");
	void backgroundCanvas.offsetWidth;   // reflow so the animation can re-trigger
	backgroundCanvas.classList.add("pw-shaking");
}

function setOverlay(on) {
	overlayEl.classList.toggle("pw-show", !!on);
	overlayCheckbox.checked = !!on;
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
	dotEls = []; nameSBEls = []; pctEls = [];
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
		while (colors.length < n) colors.push(PALETTES.classic[colors.length]);
	}
	names = names.slice(0, n);
	while (names.length < n) names.push(DEFAULT_NAMES[names.length]);
	boost = [];
	for (var t = 0; t < n; t++) boost.push({ factor: 1, until: 0 });

	var radio = document.querySelector('input[name="teamcount"][value="' + n + '"]');
	if (radio) radio.checked = true;

	buildScoreboard();
	buildTeamControls();
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

var titleInput = document.getElementById("titleInput");
var subInput = document.getElementById("subInput");
var glowCheckbox = document.getElementById("glowCheckbox");
var scoreCheckbox = document.getElementById("scoreCheckbox");
var autoCheckbox = document.getElementById("autoCheckbox");
var overlayCheckbox = document.getElementById("overlayCheckbox");

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

titleInput.oninput = function () { titleEl.textContent = this.value; };
subInput.oninput = function () { subEl.textContent = this.value; };

glowCheckbox.onclick = function () { glow = this.checked; };
scoreCheckbox.onclick = function () { showScore = this.checked; scoreEl.classList.toggle("pw-hidden", !showScore); };
autoCheckbox.onclick = function () { autoRestart = this.checked; };
overlayCheckbox.onclick = function () { setOverlay(this.checked); };

var pauseButton = document.getElementById("pauseButton");
pauseButton.onclick = togglePause;
function togglePause() {
	paused = !paused;
	pauseButton.textContent = paused ? "Resume (Space)" : "Pause (Space)";
}

document.getElementById("newButton").onclick = relaunch;
document.getElementById("resetButton").onclick = reset;

// chat-event preview buttons — fire the same API a bot/redemption would
document.getElementById("testBoostA").onclick = function () { PongWars.boost("a", 2.2, 6000); showBanner(names[0] + " boosted! ⚡", 2500); };
document.getElementById("testBoostB").onclick = function () { PongWars.boost("b", 2.2, 6000); showBanner(names[1] + " boosted! ⚡", 2500); };
document.getElementById("testDropA").onclick = function () { PongWars.paintBlob("a", Math.random(), Math.random(), cfg.cell * 5); showBanner(names[0] + " dropped a bomb! 💥", 2500); };
document.getElementById("testDropB").onclick = function () { PongWars.paintBlob("b", Math.random(), Math.random(), cfg.cell * 5); showBanner(names[1] + " dropped a bomb! 💥", 2500); };
document.getElementById("testBanner").onclick = function () { showBanner("@chatter just followed! 💜", 3000); };
document.getElementById("testShake").onclick = function () { shake(); };

window.addEventListener("keydown", function (e) {
	if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;   // don't hijack text fields
	if (e.code === "Space") { e.preventDefault(); togglePause(); }
	if (e.key === "r" || e.key === "R") reset();
	if (e.key === "n" || e.key === "N") relaunch();
	if (e.key === "o" || e.key === "O") setOverlay(!overlayCheckbox.checked);
});

// #endregion

// #region resize
window.addEventListener("resize", function () {
	canvasWidth = window.getCanvasWidth();
	canvasHeight = window.innerHeight;
	if (window._hudToggling) return;
	applyCanvasSize();
	reset();
});
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
				if (dx * dx + dy * dy <= r * r) squares[i][j] = t;
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
	boost: 1, spawnBall: 1, removeBall: 1, paintBlob: 1, paintRandom: 1,
	setTeamName: 1, setTeamColor: 1, setTeamCount: 1, setPreset: 1, banner: 1, shake: 1, overlay: 1,
	setSpeed: 1, setCellSize: 1, setBallsPerTeam: 1,
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

	if (!paused && !roundOver) step();

	drawSquares();
	drawBalls();
	updateScoreboard();
	checkWin();

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
