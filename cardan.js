/* cardan.js — WebGL2 3D gimbal: flat-band rings with face normals + edge glow */
(function () {
	'use strict';

	var old = document.getElementById('cardan-canvas');
	if (old) old.remove();

	var cvs = document.createElement('canvas');
	cvs.id = 'cardan-canvas';
	cvs.style.cssText = [
		'position:fixed', 'top:0', 'left:0',
		'width:100%', 'height:100%',
		'pointer-events:none', 'z-index:0',
		'opacity:0', 'transition:opacity 1.4s ease',
	].join(';');
	var wgRef = document.body.firstChild;
	document.body.insertBefore(cvs, wgRef ? wgRef.nextSibling : null);

	function sizeCanvas() { cvs.width = window.innerWidth; cvs.height = window.innerHeight; }
	sizeCanvas();
	window.addEventListener('resize', function () { sizeCanvas(); if (gl) gl.viewport(0, 0, cvs.width, cvs.height); });
	setTimeout(function () { cvs.style.opacity = '1'; }, 1000);

	var gl = cvs.getContext('webgl2');
	if (!gl) { cvs.remove(); return; }

	/* ── shaders ── */
	var VS = [
		'#version 300 es', 'precision highp float;',
		'in vec3 aPos;',
		'in vec3 aNorm;',
		'uniform mat4 uMVP;',
		'uniform mat3 uNorm;',
		'out float vLight;',
		'void main(){',
		'  vec3 N = normalize(uNorm * aNorm);',
		'  vec3 L = normalize(vec3(0.35, 0.70, 1.0));',
		'  float amb = 0.45;',
		'  vLight = amb + (1.0 - amb) * max(0.0, dot(N, L));',
		'  gl_Position = uMVP * vec4(aPos, 1.0);',
		'}',
	].join('\n');
	var FS = [
		'#version 300 es', 'precision highp float;',
		'in float vLight;',
		'uniform vec4 uCol;',
		'out vec4 frag;',
		'void main(){ frag = vec4(uCol.rgb * vLight, uCol.a); }',
	].join('\n');

	function mkShader(type, src) {
		var s = gl.createShader(type);
		gl.shaderSource(s, src); gl.compileShader(s);
		if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error('[cardan]', gl.getShaderInfoLog(s)); return null; }
		return s;
	}
	var prog = gl.createProgram();
	var vs = mkShader(gl.VERTEX_SHADER, VS), fs = mkShader(gl.FRAGMENT_SHADER, FS);
	if (!vs || !fs) { cvs.remove(); return; }
	gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
	if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.error('[cardan]', gl.getProgramInfoLog(prog)); cvs.remove(); return; }

	var LOC = {
		aPos:  gl.getAttribLocation(prog,  'aPos'),
		aNorm: gl.getAttribLocation(prog,  'aNorm'),
		uMVP:  gl.getUniformLocation(prog, 'uMVP'),
		uNorm: gl.getUniformLocation(prog, 'uNorm'),
		uCol:  gl.getUniformLocation(prog, 'uCol'),
	};

	/* ── geometry upload ── */
	function uploadVAO(verts, norms, idx) {
		var vao = gl.createVertexArray(); gl.bindVertexArray(vao);

		var vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
		gl.enableVertexAttribArray(LOC.aPos);
		gl.vertexAttribPointer(LOC.aPos, 3, gl.FLOAT, false, 0, 0);

		var nbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, nbo);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(norms), gl.STATIC_DRAW);
		gl.enableVertexAttribArray(LOC.aNorm);
		gl.vertexAttribPointer(LOC.aNorm, 3, gl.FLOAT, false, 0, 0);

		var ibo = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
		gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(idx), gl.STATIC_DRAW);

		gl.bindVertexArray(null);
		return { vao: vao, count: idx.length };
	}

	/* ── flat ring: rectangular cross-section, 4 face strips ── */
	function buildFlatRing(R, w, h, NS) {
		var hw = w / 2, hh = h / 2;
		var verts = [], norms = [], idx = [], base = 0;

		function addStrip(getA, getB, getNorm) {
			for (var i = 0; i <= NS; i++) {
				var u = i / NS * Math.PI * 2;
				var a = getA(u), b = getB(u), n = getNorm(u);
				verts.push(a[0], a[1], a[2],  b[0], b[1], b[2]);
				norms.push(n[0], n[1], n[2],  n[0], n[1], n[2]);
			}
			for (var i = 0; i < NS; i++) {
				var a = base + i*2, b = a+1, c = base + (i+1)*2, d = c+1;
				idx.push(a, c, b,  b, c, d);
			}
			base += (NS + 1) * 2;
		}

		addStrip(
			function (u) { return [(R - hw) * Math.cos(u), (R - hw) * Math.sin(u), -hh]; },
			function (u) { return [(R + hw) * Math.cos(u), (R + hw) * Math.sin(u), -hh]; },
			function ()  { return [0, 0, -1]; }
		);
		addStrip(
			function (u) { return [(R + hw) * Math.cos(u), (R + hw) * Math.sin(u), -hh]; },
			function (u) { return [(R + hw) * Math.cos(u), (R + hw) * Math.sin(u),  hh]; },
			function (u) { return [Math.cos(u), Math.sin(u), 0]; }
		);
		addStrip(
			function (u) { return [(R + hw) * Math.cos(u), (R + hw) * Math.sin(u),  hh]; },
			function (u) { return [(R - hw) * Math.cos(u), (R - hw) * Math.sin(u),  hh]; },
			function ()  { return [0, 0, 1]; }
		);
		addStrip(
			function (u) { return [(R - hw) * Math.cos(u), (R - hw) * Math.sin(u),  hh]; },
			function (u) { return [(R - hw) * Math.cos(u), (R - hw) * Math.sin(u), -hh]; },
			function (u) { return [-Math.cos(u), -Math.sin(u), 0]; }
		);

		return uploadVAO(verts, norms, idx);
	}

	/* ── glow edge strips along top and bottom of outer face ── */
	function buildGlowEdge(R, hw, hh, NS) {
		var gw = 0.042;
		var ro = R + hw;
		var verts = [], norms = [], idx = [], base = 0;

		function addStrip(getA, getB, getNorm) {
			for (var i = 0; i <= NS; i++) {
				var u = i / NS * Math.PI * 2;
				var a = getA(u), b = getB(u), n = getNorm(u);
				verts.push(a[0], a[1], a[2],  b[0], b[1], b[2]);
				norms.push(n[0], n[1], n[2],  n[0], n[1], n[2]);
			}
			for (var i = 0; i < NS; i++) {
				var a = base + i*2, b = a+1, c = base + (i+1)*2, d = c+1;
				idx.push(a, c, b,  b, c, d);
			}
			base += (NS + 1) * 2;
		}

		// Top-face outer rim (flat, normal up)
		addStrip(
			function (u) { return [(ro - gw) * Math.cos(u), (ro - gw) * Math.sin(u), hh + 0.001]; },
			function (u) { return [ro * Math.cos(u),         ro * Math.sin(u),         hh + 0.001]; },
			function ()  { return [0, 0, 1]; }
		);
		// Outer-face top belt (cylinder, normal outward)
		addStrip(
			function (u) { return [ro * Math.cos(u), ro * Math.sin(u), hh - gw]; },
			function (u) { return [ro * Math.cos(u), ro * Math.sin(u), hh];      },
			function (u) { return [Math.cos(u), Math.sin(u), 0]; }
		);
		// Bottom-face outer rim (flat, normal down)
		addStrip(
			function (u) { return [ro * Math.cos(u),         ro * Math.sin(u),         -hh - 0.001]; },
			function (u) { return [(ro - gw) * Math.cos(u), (ro - gw) * Math.sin(u), -hh - 0.001]; },
			function ()  { return [0, 0, -1]; }
		);
		// Outer-face bottom belt (cylinder, normal outward)
		addStrip(
			function (u) { return [ro * Math.cos(u), ro * Math.sin(u), -hh];      },
			function (u) { return [ro * Math.cos(u), ro * Math.sin(u), -hh + gw]; },
			function (u) { return [Math.cos(u), Math.sin(u), 0]; }
		);

		return uploadVAO(verts, norms, idx);
	}

	var RINGS = [
		buildFlatRing(1.62, 0.30, 0.16, 128),
		buildFlatRing(1.24, 0.26, 0.13, 108),
		buildFlatRing(0.88, 0.22, 0.10,  80),
	];
	var GLOWS = [
		buildGlowEdge(1.62, 0.15, 0.08,  64),
		buildGlowEdge(1.24, 0.13, 0.065, 54),
		buildGlowEdge(0.88, 0.11, 0.05,  40),
	];

	/* ── matrix math (column-major, GL convention) ── */
	function m4()    { return new Float32Array(16); }
	function m3()    { return new Float32Array(9); }
	function ident() { var m = m4(); m[0] = m[5] = m[10] = m[15] = 1; return m; }
	function mul(a, b) {
		var o = m4();
		for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) {
			var s = 0; for (var k = 0; k < 4; k++) s += a[k*4+r] * b[c*4+k]; o[c*4+r] = s;
		}
		return o;
	}
	function mat3of(m4v) {
		var n = m3();
		n[0]=m4v[0]; n[1]=m4v[1]; n[2]=m4v[2];
		n[3]=m4v[4]; n[4]=m4v[5]; n[5]=m4v[6];
		n[6]=m4v[8]; n[7]=m4v[9]; n[8]=m4v[10];
		return n;
	}
	function rx(a) { var m=ident(),c=Math.cos(a),s=Math.sin(a); m[5]=c;m[6]=s;m[9]=-s;m[10]=c; return m; }
	function ry(a) { var m=ident(),c=Math.cos(a),s=Math.sin(a); m[0]=c;m[2]=-s;m[8]=s;m[10]=c; return m; }
	function rz(a) { var m=ident(),c=Math.cos(a),s=Math.sin(a); m[0]=c;m[1]=s;m[4]=-s;m[5]=c; return m; }
	function persp(fov, asp, n, f) {
		var m = m4(), fv = 1 / Math.tan(fov * 0.5);
		m[0]=fv/asp; m[5]=fv; m[10]=(f+n)/(n-f); m[11]=-1; m[14]=2*f*n/(n-f);
		return m;
	}
	function tz(z)     { var m = ident(); m[14] = z; return m; }
	function txy(x, y) { var m = ident(); m[12] = x; m[13] = y; return m; }

	var PRE = [
		ident(),
		rx(Math.PI / 2),
		mul(rx(Math.PI / 3), rz(Math.PI / 5)),
	];

	var DARK = [
		[0.96, 0.65, 0.14, 1.0],
		[0.96, 0.65, 0.14, 1.0],
		[0.99, 0.85, 0.48, 1.0],
	];
	var LITE = [
		[0.63, 0.31, 0.00, 1.0],
		[0.63, 0.31, 0.00, 1.0],
		[0.70, 0.40, 0.00, 1.0],
	];
	// Glow colors: lighter/warmer, used with additive blending
	var DARK_GLOW = [
		[1.0, 0.88, 0.42, 0.75],
		[1.0, 0.88, 0.42, 0.75],
		[1.0, 0.95, 0.62, 0.75],
	];
	var LITE_GLOW = [
		[0.88, 0.52, 0.10, 0.75],
		[0.88, 0.52, 0.10, 0.75],
		[0.92, 0.64, 0.18, 0.75],
	];

	var t0 = performance.now();

	function frame(now) {
		var t = (now - t0) * 0.001;
		var W = cvs.width, H = cvs.height;
		gl.viewport(0, 0, W, H);
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
		gl.enable(gl.BLEND);
		gl.enable(gl.DEPTH_TEST);

		var pv     = mul(persp(Math.PI / 3, W / H, 0.1, 20.0), tz(-3.5));
		var isLite = document.documentElement.classList.contains('light');
		var COLS   = isLite ? LITE : DARK;
		var GCOLS  = isLite ? LITE_GLOW : DARK_GLOW;
		var offset = txy(1.55, 1.15);

		gl.useProgram(prog);

		var angs    = [t * 0.11, t * 0.17, t * 0.27];
		var spinFns = [ry, rz, rx];

		// Pass 1: opaque rings with standard alpha blend + depth writes
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
		gl.depthMask(true);

		RINGS.forEach(function (ring, i) {
			var model = mul(offset, mul(spinFns[i](angs[i]), PRE[i]));
			gl.uniformMatrix4fv(LOC.uMVP,  false, mul(pv, model));
			gl.uniformMatrix3fv(LOC.uNorm, false, mat3of(model));
			gl.uniform4fv(LOC.uCol, new Float32Array(COLS[i]));
			gl.bindVertexArray(ring.vao);
			gl.drawElements(gl.TRIANGLES, ring.count, gl.UNSIGNED_INT, 0);
			gl.bindVertexArray(null);
		});

		// Pass 2: additive glow edges, depth-test but no depth write
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
		gl.depthMask(false);

		GLOWS.forEach(function (glow, i) {
			var model = mul(offset, mul(spinFns[i](angs[i]), PRE[i]));
			gl.uniformMatrix4fv(LOC.uMVP,  false, mul(pv, model));
			gl.uniformMatrix3fv(LOC.uNorm, false, mat3of(model));
			gl.uniform4fv(LOC.uCol, new Float32Array(GCOLS[i]));
			gl.bindVertexArray(glow.vao);
			gl.drawElements(gl.TRIANGLES, glow.count, gl.UNSIGNED_INT, 0);
			gl.bindVertexArray(null);
		});

		gl.depthMask(true);

		requestAnimationFrame(frame);
	}

	requestAnimationFrame(frame);
}());
