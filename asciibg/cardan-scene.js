// Cardan gimbal rendered inside the asciibg GL context (ASCII_REDESIGN_PLAN.md
// Phase 4). Port of /cardan.js: flat-band rings + neon edge tori + dot globe,
// minus MSAA and bloom — the ASCII pass quantizes away edge AA and its glow
// halo replaces the bloom. Renders into an owned color+depth FBO at scene
// resolution, then composites (premultiplied alpha) into the shared scene FBO.
// Keeps: theme colors (html.light/.viper), hover-accel on .card, scroll kick.

import { Program, compileShader } from '../FluidSimulation/gl-program.js';

/* ── shaders (verbatim from cardan.js, sans bloom pipeline) ── */
const VS = `#version 300 es
precision highp float;
in vec3 aPos;
in vec3 aNorm;
uniform mat4 uMVP;
uniform mat3 uNorm;
uniform float uShade;
out float vLight;
void main(){
	vec3 N = normalize(uNorm * aNorm);
	vec3 L = normalize(vec3(0.6, 1.0, 0.7));
	float diff = max(dot(N, L), 0.0);
	vLight = mix(1.0, 0.05 + 0.95 * diff, uShade);
	gl_Position = uMVP * vec4(aPos, 1.0);
}`;
const FS = `#version 300 es
precision highp float;
in float vLight;
uniform vec4 uCol;
out vec4 frag;
void main(){ frag = vec4(uCol.rgb * vLight, uCol.a); }`;

const VS_G = `#version 300 es
precision highp float;
in vec3 aPos;
uniform mat4 uGlobeMVP;
uniform float uAng;
uniform float uScale;
uniform float uSizeMul;
out float vVis;
out float vLat;
void main(){
	vec3 ax=normalize(vec3(sin(0.4102),cos(0.4102),0.5));
	float c=cos(uAng),s=sin(uAng);
	vec3 p=aPos*c+cross(ax,aPos)*s+ax*dot(ax,aPos)*(1.0-c);
	vVis=p.z;
	vLat=aPos.y;
	vec4 clip=uGlobeMVP*vec4(p*uScale,1.0);
	gl_Position=clip;
	float fade=clamp(p.z*1.8+0.5,0.0,1.0);
	gl_PointSize=clamp(fade*3.5*uSizeMul,1.0,8.0);
}`;
const FS_G = `#version 300 es
precision highp float;
in float vVis;
in float vLat;
uniform float uLight;
uniform float uViper;
uniform float uPulse;
uniform float uAlphaMul;
out vec4 fragColor;
void main(){
	vec2 c=2.0*gl_PointCoord-1.0;
	if(dot(c,c)>1.0)discard;
	float vis=clamp(vVis*1.8+0.4,0.0,1.0);
	if(vis<0.01)discard;
	vec3 dark=mix(vec3(0.72,0.40,0.12),vec3(1.0,0.95,0.60),(vLat*0.5+0.5));
	vec3 lite=mix(vec3(0.50,0.18,0.02),vec3(0.78,0.35,0.04),(vLat*0.5+0.5));
	vec3 col=mix(dark,lite,uLight);
	vec3 vip=mix(vec3(0.04,0.34,0.06),vec3(0.22,1.0,0.18),(vLat*0.5+0.5));
	col=mix(col,vip,uViper);
	vec3 pulseCol=mix(vec3(1.0,0.95,0.75),vec3(0.90,0.42,0.06),uLight);
	pulseCol=mix(pulseCol,vec3(0.40,1.0,0.26),uViper);
	col=mix(col,pulseCol,uPulse*0.6);
	float soft=1.0-smoothstep(0.3,1.0,dot(c,c));
	fragColor=vec4(col,vis*soft*1.0*uAlphaMul);
}`;

// Composite quad: premultiplied source over target (bound before call).
const FS_COMP = `
precision highp float;
precision highp sampler2D;
varying vec2 vUv;
uniform sampler2D uTexture;
void main () { gl_FragColor = texture2D(uTexture, vUv); }
`;

/* ── matrix math (column-major, verbatim) ── */
function m4() { return new Float32Array(16); }
function m3() { return new Float32Array(9); }
function ident() { const m = m4(); m[0] = m[5] = m[10] = m[15] = 1; return m; }
function mul(a, b) {
	const o = m4();
	for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
		let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s;
	}
	return o;
}
function mat3of(v) {
	const n = m3();
	n[0] = v[0]; n[1] = v[1]; n[2] = v[2];
	n[3] = v[4]; n[4] = v[5]; n[5] = v[6];
	n[6] = v[8]; n[7] = v[9]; n[8] = v[10];
	return n;
}
function rx(a) { const m = ident(), c = Math.cos(a), s = Math.sin(a); m[5] = c; m[6] = s; m[9] = -s; m[10] = c; return m; }
function ry(a) { const m = ident(), c = Math.cos(a), s = Math.sin(a); m[0] = c; m[2] = -s; m[8] = s; m[10] = c; return m; }
function rz(a) { const m = ident(), c = Math.cos(a), s = Math.sin(a); m[0] = c; m[1] = s; m[4] = -s; m[5] = c; return m; }
function rAxis(ax, ay, az, a) {
	const m = ident(), c = Math.cos(a), s = Math.sin(a), mc = 1 - c;
	m[0] = c + ax * ax * mc;    m[4] = ax * ay * mc - az * s; m[8] = ax * az * mc + ay * s;
	m[1] = ay * ax * mc + az * s; m[5] = c + ay * ay * mc;    m[9] = ay * az * mc - ax * s;
	m[2] = az * ax * mc - ay * s; m[6] = az * ay * mc + ax * s; m[10] = c + az * az * mc;
	return m;
}
function persp(fov, asp, n, f) {
	const m = m4(), fv = 1 / Math.tan(fov * 0.5);
	m[0] = fv / asp; m[5] = fv; m[10] = (f + n) / (n - f); m[11] = -1; m[14] = 2 * f * n / (n - f);
	return m;
}
function tz(z) { const m = ident(); m[14] = z; return m; }
function txy(x, y) { const m = ident(); m[12] = x; m[13] = y; return m; }

export function createCardanScene(gl, blit, baseVS) {
	/* ── programs ── */
	function mkShader(type, src) {
		const s = gl.createShader(type);
		gl.shaderSource(s, src); gl.compileShader(s);
		if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error('[cardan-scene]', gl.getShaderInfoLog(s)); return null; }
		return s;
	}
	function mkProg(vsSrc, fsSrc) {
		const p = gl.createProgram();
		const v = mkShader(gl.VERTEX_SHADER, vsSrc), f = mkShader(gl.FRAGMENT_SHADER, fsSrc);
		if (!v || !f) return null;
		gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p);
		if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { console.error('[cardan-scene]', gl.getProgramInfoLog(p)); return null; }
		return p;
	}
	const prog = mkProg(VS, FS);
	const progG = mkProg(VS_G, FS_G);
	if (!prog) return null;
	const LOC = {
		aPos: gl.getAttribLocation(prog, 'aPos'),
		aNorm: gl.getAttribLocation(prog, 'aNorm'),
		uMVP: gl.getUniformLocation(prog, 'uMVP'),
		uNorm: gl.getUniformLocation(prog, 'uNorm'),
		uCol: gl.getUniformLocation(prog, 'uCol'),
		uShade: gl.getUniformLocation(prog, 'uShade'),
	};
	const LOC_G = progG ? {
		aPos: gl.getAttribLocation(progG, 'aPos'),
		uGlobeMVP: gl.getUniformLocation(progG, 'uGlobeMVP'),
		uAng: gl.getUniformLocation(progG, 'uAng'),
		uScale: gl.getUniformLocation(progG, 'uScale'),
		uSizeMul: gl.getUniformLocation(progG, 'uSizeMul'),
		uPulse: gl.getUniformLocation(progG, 'uPulse'),
		uAlphaMul: gl.getUniformLocation(progG, 'uAlphaMul'),
		uLight: gl.getUniformLocation(progG, 'uLight'),
		uViper: gl.getUniformLocation(progG, 'uViper'),
	} : null;
	const compProgram = new Program(gl, baseVS, compileShader(gl, gl.FRAGMENT_SHADER, FS_COMP));

	/* ── geometry (verbatim builders) ── */
	function uploadVAO(verts, norms, idx) {
		const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
		const vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
		gl.enableVertexAttribArray(LOC.aPos);
		gl.vertexAttribPointer(LOC.aPos, 3, gl.FLOAT, false, 0, 0);
		const nbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, nbo);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(norms), gl.STATIC_DRAW);
		gl.enableVertexAttribArray(LOC.aNorm);
		gl.vertexAttribPointer(LOC.aNorm, 3, gl.FLOAT, false, 0, 0);
		const ibo = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
		gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(idx), gl.STATIC_DRAW);
		gl.bindVertexArray(null);
		return { vao, count: idx.length };
	}

	function buildFlatRing(R, w, h, NS) {
		const hw = w / 2, hh = h / 2;
		const verts = [], norms = [], idx = [];
		let base = 0;
		function addStrip(getA, getB, getNorm) {
			for (let i = 0; i <= NS; i++) {
				const u = i / NS * Math.PI * 2;
				const a = getA(u), b = getB(u), n = getNorm(u);
				verts.push(a[0], a[1], a[2], b[0], b[1], b[2]);
				norms.push(n[0], n[1], n[2], n[0], n[1], n[2]);
			}
			for (let i = 0; i < NS; i++) {
				const a = base + i * 2, b = a + 1, c = base + (i + 1) * 2, d = c + 1;
				idx.push(a, c, b, b, c, d);
			}
			base += (NS + 1) * 2;
		}
		addStrip(u => [(R - hw) * Math.cos(u), (R - hw) * Math.sin(u), -hh],
			u => [(R + hw) * Math.cos(u), (R + hw) * Math.sin(u), -hh],
			() => [0, 0, -1]);
		addStrip(u => [(R + hw) * Math.cos(u), (R + hw) * Math.sin(u), -hh],
			u => [(R + hw) * Math.cos(u), (R + hw) * Math.sin(u), hh],
			u => [Math.cos(u), Math.sin(u), 0]);
		addStrip(u => [(R + hw) * Math.cos(u), (R + hw) * Math.sin(u), hh],
			u => [(R - hw) * Math.cos(u), (R - hw) * Math.sin(u), hh],
			() => [0, 0, 1]);
		addStrip(u => [(R - hw) * Math.cos(u), (R - hw) * Math.sin(u), hh],
			u => [(R - hw) * Math.cos(u), (R - hw) * Math.sin(u), -hh],
			u => [-Math.cos(u), -Math.sin(u), 0]);
		return uploadVAO(verts, norms, idx);
	}

	function buildNeonEdges(R, hw, hh, rTube, NS) {
		const NT = 8;
		const verts = [], norms = [], idx = [];
		let base = 0;
		[[R + hw, hh], [R - hw, hh], [R + hw, -hh], [R - hw, -hh]].forEach(e => {
			const er = e[0], ez = e[1];
			for (let i = 0; i <= NS; i++) {
				const u = i / NS * Math.PI * 2;
				const cu = Math.cos(u), su = Math.sin(u);
				for (let j = 0; j <= NT; j++) {
					const v = j / NT * Math.PI * 2;
					const cv = Math.cos(v), sv = Math.sin(v);
					verts.push((er + rTube * cv) * cu, (er + rTube * cv) * su, ez + rTube * sv);
					norms.push(cv * cu, cv * su, sv);
				}
			}
			for (let i = 0; i < NS; i++) {
				for (let j = 0; j < NT; j++) {
					const a = base + i * (NT + 1) + j, b = a + 1, k = base + (i + 1) * (NT + 1) + j, d = k + 1;
					idx.push(a, k, b, b, k, d);
				}
			}
			base += (NS + 1) * (NT + 1);
		});
		return uploadVAO(verts, norms, idx);
	}

	const RINGS = [
		buildFlatRing(1.62, 0.30, 0.30, 128),
		buildFlatRing(1.33, 0.26, 0.26, 108),
		buildFlatRing(1.08, 0.22, 0.22, 80),
	];
	// rTube fattened well past the original bloom-fed 0.0035 (ASCII pass has no
	// bloom to fill in sub-pixel geometry) and graded up for the two inner
	// rings, whose smaller circumference means the same absolute tube width
	// covers fewer glyph cells — thicker tubes keep all three rings legible.
	const NEON_CORE = [
		buildNeonEdges(1.62, 0.15, 0.15, 0.010, 128),
		buildNeonEdges(1.33, 0.13, 0.13, 0.013, 108),
		buildNeonEdges(1.08, 0.11, 0.11, 0.016, 80),
	];

	const GLOBE_N = 480;
	const globeVAO = (() => {
		const pts = [], PHI = Math.PI * (3 - Math.sqrt(5));
		for (let i = 0; i < GLOBE_N; i++) {
			const y = 1 - (i / (GLOBE_N - 1)) * 2, r = Math.sqrt(1 - y * y), th = PHI * i;
			pts.push(r * Math.cos(th), y, r * Math.sin(th));
		}
		const vao = gl.createVertexArray();
		gl.bindVertexArray(vao);   // own VAO — never touch the default one (blit quad lives there)
		const b = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, b);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pts), gl.STATIC_DRAW);
		gl.enableVertexAttribArray(LOC_G.aPos);
		gl.vertexAttribPointer(LOC_G.aPos, 3, gl.FLOAT, false, 0, 0);
		gl.bindVertexArray(null);
		gl.bindBuffer(gl.ARRAY_BUFFER, null);
		return vao;
	})();

	const PRE = [ident(), rx(Math.PI / 2), mul(rx(Math.PI / 3), rz(Math.PI / 5))];
	const DARK = [[0.98, 0.84, 0.30, 1.0], [0.98, 0.84, 0.30, 1.0], [0.98, 0.84, 0.30, 1.0]];
	const LITE = [[0.65, 0.42, 0.08, 1.0], [0.65, 0.42, 0.08, 1.0], [0.65, 0.42, 0.08, 1.0]];
	const VIPER = [[0.13, 1.00, 0.13, 1.0], [0.13, 1.00, 0.13, 1.0], [0.26, 1.00, 0.22, 1.0]];

	/* ── owned render target (color + depth) ── */
	let fbo = null, tex = null, depthRB = null, W = 0, H = 0;
	function resize(w, h) {
		if (w === W && h === H && fbo) return;
		W = w; H = h;
		if (tex) { gl.deleteTexture(tex); gl.deleteRenderbuffer(depthRB); gl.deleteFramebuffer(fbo); }
		tex = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, tex);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		fbo = gl.createFramebuffer();
		gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
		depthRB = gl.createRenderbuffer();
		gl.bindRenderbuffer(gl.RENDERBUFFER, depthRB);
		gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, W, H);
		gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthRB);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.bindRenderbuffer(gl.RENDERBUFFER, null);
		gl.bindTexture(gl.TEXTURE_2D, null);
	}

	/* ── motion state (verbatim behavior) ── */
	const BASE_SPEED = 0.125, PEAK_MULT = 75, ACCEL_DUR = 0.28;
	const GLOBE_BASE = 0.004;
	let currentSpeed = BASE_SPEED, accAng = 0, gAng = 0;
	let hoverStartTime = -1;
	let lastScrollY = window.scrollY, spinKick = 0;

	window.addEventListener('scroll', () => {
		const y = window.scrollY;
		spinKick = Math.min(spinKick + Math.abs(y - lastScrollY) * 0.02, 24.0);
		lastScrollY = y;
	}, { passive: true });

	// Cards may not exist yet (harness) or get filtered/re-rendered — delegate.
	document.addEventListener('mouseover', e => {
		if (e.target.closest && e.target.closest('.card')) hoverStartTime = performance.now() * 0.001;
	});
	document.addEventListener('mouseout', e => {
		if (e.target.closest && e.target.closest('.card')) hoverStartTime = -1;
	});

	/* ── ring→fluid stir (Phase 4.3): faint dye splats at projected ring markers ── */
	const RING_RADII = [1.62, 1.33, 1.08];
	const MARK_ANGLES = [0, Math.PI];
	const STIR_FORCE = 2500, STIR_DYE = 0.025, STIR_RADIUS = 0.10;
	const mvps = [null, null, null];
	const markerPrev = [];
	function project(m, x, y, z) {
		const w = m[3] * x + m[7] * y + m[11] * z + m[15];
		if (w <= 0.0001) return null;
		return [
			(m[0] * x + m[4] * y + m[8] * z + m[12]) / w * 0.5 + 0.5,
			(m[1] * x + m[5] * y + m[9] * z + m[13]) / w * 0.5 + 0.5,
		];
	}
	// Splat a faint wake at each ring marker, velocity = marker's screen motion
	// since the previous frame. Call once per tick after draw().
	function stir(fluid, inks) {
		if (!mvps[0]) return;
		const keepRadius = fluid.cfg.SPLAT_RADIUS;
		fluid.cfg.SPLAT_RADIUS = STIR_RADIUS;
		let k = 0;
		for (let i = 0; i < RING_RADII.length; i++) {
			for (let j = 0; j < MARK_ANGLES.length; j++, k++) {
				const p = project(mvps[i],
					RING_RADII[i] * Math.cos(MARK_ANGLES[j]),
					RING_RADII[i] * Math.sin(MARK_ANGLES[j]), 0);
				const prev = markerPrev[k];
				markerPrev[k] = p;
				if (!p || !prev) continue;
				let dx = p[0] - prev[0], dy = p[1] - prev[1];
				const len = Math.hypot(dx, dy);
				if (len === 0 || len > 0.2) continue;   // teleport (resize / tab-back)
				if (len > 0.015) { dx *= 0.015 / len; dy *= 0.015 / len; }   // hover-accel cap
				if (p[0] < -0.02 || p[0] > 1.02 || p[1] < -0.02 || p[1] > 1.02) continue;
				const ink = inks[k % inks.length];
				fluid.splat(p[0], p[1], dx * STIR_FORCE, dy * STIR_FORCE,
					{ r: ink.r * STIR_DYE, g: ink.g * STIR_DYE, b: ink.b * STIR_DYE });
			}
		}
		fluid.cfg.SPLAT_RADIUS = keepRadius;
	}

	/* ── per-frame render into the owned FBO ── */
	function draw(now, dt) {
		gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
		gl.viewport(0, 0, W, H);
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
		gl.enable(gl.BLEND);
		gl.enable(gl.DEPTH_TEST);

		const pv = mul(persp(Math.PI / 3, W / H, 0.1, 20.0), tz(-3.5));
		const isLite = document.documentElement.classList.contains('light');
		const isViper = document.documentElement.classList.contains('viper');
		const COLS = isViper ? VIPER : isLite ? LITE : DARK;
		const offset = txy(1.55, 1.15);

		gl.useProgram(prog);

		const elapsed = hoverStartTime >= 0 ? (now * 0.001 - hoverStartTime) : -1;
		let speedMult = 1.0;
		if (elapsed >= 0 && elapsed < ACCEL_DUR) {
			const p = elapsed / ACCEL_DUR;
			speedMult = 1.0 + (PEAK_MULT - 1.0) * Math.sin(p * Math.PI);
		}
		spinKick *= Math.exp(-dt * 2.2);
		const targetSpeed = BASE_SPEED * (speedMult + spinKick);
		currentSpeed += (targetSpeed - currentSpeed) * 0.13;
		accAng += dt * currentSpeed;

		const D = 1 / Math.sqrt(3);
		const ang = accAng;
		const diag = rAxis(D, D, D, ang);
		const primarySpins = [rx, ry, rz];

		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
		gl.depthMask(true);
		gl.uniform1f(LOC.uShade, 1.0);
		RINGS.forEach((ring, i) => {
			const model = mul(offset, mul(diag, mul(primarySpins[i](ang), PRE[i])));
			mvps[i] = mul(pv, model);
			gl.uniformMatrix4fv(LOC.uMVP, false, mvps[i]);
			gl.uniformMatrix3fv(LOC.uNorm, false, mat3of(model));
			const c = COLS[i];
			const bandA = isLite ? 0.55 : isViper ? 0.18 : 0.26;
			// dark/viper bandMul nudged just past the ASCII FLOOR (0.08) so the
			// band itself contributes faint body, not only the neon edge tube.
			const bandMul = isLite ? 0.45 : isViper ? 0.09 : 0.11;
			gl.uniform4fv(LOC.uCol, new Float32Array([c[0] * bandMul, c[1] * bandMul, c[2] * bandMul, bandA]));
			gl.bindVertexArray(ring.vao);
			gl.drawElements(gl.TRIANGLES, ring.count, gl.UNSIGNED_INT, 0);
			gl.bindVertexArray(null);
		});

		gl.uniform1f(LOC.uShade, 0.0);
		NEON_CORE.forEach((neon, i) => {
			const model = mul(offset, mul(diag, mul(primarySpins[i](ang), PRE[i])));
			gl.uniformMatrix4fv(LOC.uMVP, false, mul(pv, model));
			gl.uniformMatrix3fv(LOC.uNorm, false, mat3of(model));
			const c = COLS[i];
			const tubeA = isLite ? 0.92 : 0.90;
			const coreBoost = isLite ? 1.15 : 1.35;
			gl.uniform4fv(LOC.uCol, new Float32Array([c[0] * coreBoost, c[1] * coreBoost, c[2] * coreBoost, tubeA]));
			gl.bindVertexArray(neon.vao);
			gl.drawElements(gl.TRIANGLES, neon.count, gl.UNSIGNED_INT, 0);
			gl.bindVertexArray(null);
		});

		if (progG) {
			gAng += GLOBE_BASE * (speedMult + spinKick);
			const pulseVal = Math.min((speedMult - 1.0) / (PEAK_MULT - 1.0), 1.0);
			gl.useProgram(progG);
			gl.depthMask(false);
			gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
			gl.uniformMatrix4fv(LOC_G.uGlobeMVP, false, mul(pv, offset));
			gl.uniform1f(LOC_G.uAng, gAng);
			gl.uniform1f(LOC_G.uScale, 0.15);
			gl.uniform1f(LOC_G.uSizeMul, W / 1300);
			gl.uniform1f(LOC_G.uPulse, pulseVal);
			gl.uniform1f(LOC_G.uAlphaMul, 1.0);
			gl.uniform1f(LOC_G.uLight, isLite ? 1.0 : 0.0);
			gl.uniform1f(LOC_G.uViper, isViper ? 1.0 : 0.0);
			gl.bindVertexArray(globeVAO);
			gl.drawArrays(gl.POINTS, 0, GLOBE_N);
			gl.bindVertexArray(null);
			gl.depthMask(true);
		}

		gl.disable(gl.DEPTH_TEST);
		gl.disable(gl.BLEND);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	}

	// Blend the gimbal over `target` (the shared scene FBO). The gimbal FBO was
	// rendered with standard alpha blending onto transparent black, so its RGB
	// is effectively premultiplied → ONE / ONE_MINUS_SRC_ALPHA.
	function compositeInto(target) {
		gl.enable(gl.BLEND);
		// RGB: premultiplied source-over (unchanged look). ALPHA: replace the
		// target's alpha with this gimbal's coverage (ONE, ZERO) so the ASCII pass
		// can tag gimbal cells by scene alpha and give them a thin line-art ramp.
		// The composite draws a fullscreen quad, so alpha is 0 wherever the gimbal
		// texture is transparent — fluid dye keeps the default ramp.
		gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ZERO);
		compProgram.bind();
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, tex);
		gl.uniform1i(compProgram.uniforms.uTexture, 0);
		blit(target);
		gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);   // restore default separate=off state
		gl.disable(gl.BLEND);
	}

	return { resize, draw, compositeInto, stir };
}
