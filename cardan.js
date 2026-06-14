/* cardan.js — WebGL2 3D gimbal: flat-band rings with face normals + edge glow */
(function () {
	'use strict';

	var old = document.getElementById('cardan-canvas');
	if (old) old.remove();

	var cvs = document.createElement('canvas');
	cvs.id = 'cardan-canvas';
	var FILTER_DARK = 'drop-shadow(0 0 2px #fff8e7) drop-shadow(0 0 7px #fdd87a) drop-shadow(0 0 18px #f5a623) drop-shadow(0 0 36px rgba(245,120,20,0.5)) drop-shadow(0 0 60px rgba(220,80,10,0.22))';
	var FILTER_LITE = 'drop-shadow(0 0 2px rgba(160,105,20,0.40)) drop-shadow(0 0 8px rgba(140,85,10,0.22)) drop-shadow(0 0 22px rgba(110,65,5,0.10))';
	var FILTER_VIPER = 'drop-shadow(0 0 2px #eafff2) drop-shadow(0 0 7px #a6ff84) drop-shadow(0 0 18px #22ff22) drop-shadow(0 0 36px rgba(34,255,34,0.60)) drop-shadow(0 0 60px rgba(20,220,20,0.34))';
	cvs.style.cssText = [
		'position:fixed', 'top:0', 'left:0',
		'width:100%', 'height:100%',
		'pointer-events:none', 'z-index:0',
		'opacity:0', 'transition:opacity 1.4s ease',
	].join(';');
	function updateFilter() {
		var cls = document.documentElement.classList;
		cvs.style.filter = cls.contains('viper') ? FILTER_VIPER : cls.contains('light') ? FILTER_LITE : FILTER_DARK;
	}
	updateFilter();
	document.addEventListener('themechange', updateFilter);
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
		'uniform float uShade;',
		'out float vLight;',
		'void main(){',
		'  vec3 N = normalize(uNorm * aNorm);',
		'  vec3 L = normalize(vec3(0.6, 1.0, 0.7));',
		'  float diff = max(dot(N, L), 0.0);',
		'  vLight = mix(1.0, 0.05 + 0.95 * diff, uShade);',
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

	/* ── globe: dot-sphere shaders ── */
	var VS_G = [
		'#version 300 es', 'precision highp float;',
		'in vec3 aPos;',
		'uniform mat4 uGlobeMVP;',
		'uniform float uAng;',
		'uniform float uScale;',
		'uniform float uSizeMul;',
		'out float vVis;',
		'out float vLat;',
		'void main(){',
		'  vec3 ax=normalize(vec3(sin(0.4102),cos(0.4102),0.5));',
		'  float c=cos(uAng),s=sin(uAng);',
		'  vec3 p=aPos*c+cross(ax,aPos)*s+ax*dot(ax,aPos)*(1.0-c);',
		'  vVis=p.z;',
		'  vLat=aPos.y;',
		'  vec4 clip=uGlobeMVP*vec4(p*uScale,1.0);',
		'  gl_Position=clip;',
		'  float fade=clamp(p.z*1.8+0.5,0.0,1.0);',
		'  gl_PointSize=clamp(fade*3.5*uSizeMul,1.0,8.0);',
		'}',
	].join('\n');
	var FS_G = [
		'#version 300 es', 'precision highp float;',
		'in float vVis;',
		'in float vLat;',
		'uniform float uLight;',
		'uniform float uViper;',
		'uniform float uPulse;',
		'uniform float uAlphaMul;',
		'out vec4 fragColor;',
		'void main(){',
		'  vec2 c=2.0*gl_PointCoord-1.0;',
		'  if(dot(c,c)>1.0)discard;',
		'  float vis=clamp(vVis*1.8+0.4,0.0,1.0);',
		'  if(vis<0.01)discard;',
		'  vec3 dark=mix(vec3(0.72,0.40,0.12),vec3(1.0,0.95,0.60),(vLat*0.5+0.5));',
		'  vec3 lite=mix(vec3(0.50,0.18,0.02),vec3(0.78,0.35,0.04),(vLat*0.5+0.5));',
		'  vec3 col=mix(dark,lite,uLight);',
		'  vec3 vip=mix(vec3(0.04,0.34,0.06),vec3(0.22,1.0,0.18),(vLat*0.5+0.5));',
		'  col=mix(col,vip,uViper);',
		'  vec3 pulseCol=mix(vec3(1.0,0.95,0.75),vec3(0.90,0.42,0.06),uLight);',
		'  pulseCol=mix(pulseCol,vec3(0.40,1.0,0.26),uViper);',
		'  col=mix(col,pulseCol,uPulse*0.6);',
		'  float soft=1.0-smoothstep(0.3,1.0,dot(c,c));',
		'  fragColor=vec4(col,vis*soft*1.0*uAlphaMul);',
		'}',
	].join('\n');
	var progG = gl.createProgram();
	var vsG = mkShader(gl.VERTEX_SHADER, VS_G), fsG = mkShader(gl.FRAGMENT_SHADER, FS_G);
	if (vsG && fsG) {
		gl.attachShader(progG, vsG); gl.attachShader(progG, fsG); gl.linkProgram(progG);
		if (!gl.getProgramParameter(progG, gl.LINK_STATUS)) { console.error('[cardan globe]', gl.getProgramInfoLog(progG)); progG = null; }
	} else { progG = null; }
	var LOC_G = progG ? {
		aPos:      gl.getAttribLocation(progG,  'aPos'),
		uGlobeMVP: gl.getUniformLocation(progG, 'uGlobeMVP'),
		uAng:      gl.getUniformLocation(progG, 'uAng'),
		uScale:    gl.getUniformLocation(progG, 'uScale'),
		uSizeMul:  gl.getUniformLocation(progG, 'uSizeMul'),
		uPulse:    gl.getUniformLocation(progG, 'uPulse'),
		uAlphaMul: gl.getUniformLocation(progG, 'uAlphaMul'),
		uLight:    gl.getUniformLocation(progG, 'uLight'),
		uViper:    gl.getUniformLocation(progG, 'uViper'),
	} : null;

	var LOC = {
		aPos:  gl.getAttribLocation(prog,  'aPos'),
		aNorm: gl.getAttribLocation(prog,  'aNorm'),
		uMVP:  gl.getUniformLocation(prog, 'uMVP'),
		uNorm: gl.getUniformLocation(prog, 'uNorm'),
		uCol:   gl.getUniformLocation(prog, 'uCol'),
		uShade: gl.getUniformLocation(prog, 'uShade'),
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


	/* -- neon tube-tori along all 4 circular edges -- */
	function buildNeonEdges(R, hw, hh, rTube, NS) {
		var NT = 8;
		var verts = [], norms = [], idx = [], base = 0;
		[[R + hw, hh], [R - hw, hh], [R + hw, -hh], [R - hw, -hh]].forEach(function (e) {
			var er = e[0], ez = e[1];
			for (var i = 0; i <= NS; i++) {
				var u = i / NS * Math.PI * 2;
				var cu = Math.cos(u), su = Math.sin(u);
				for (var j = 0; j <= NT; j++) {
					var v = j / NT * Math.PI * 2;
					var cv = Math.cos(v), sv = Math.sin(v);
					verts.push((er + rTube * cv) * cu, (er + rTube * cv) * su, ez + rTube * sv);
					norms.push(cv * cu, cv * su, sv);
				}
			}
			for (var i = 0; i < NS; i++) {
				for (var j = 0; j < NT; j++) {
					var a = base + i * (NT + 1) + j, b = a + 1, k = base + (i + 1) * (NT + 1) + j, d = k + 1;
					idx.push(a, k, b,  b, k, d);
				}
			}
			base += (NS + 1) * (NT + 1);
		});
		return uploadVAO(verts, norms, idx);
	}

	var RINGS = [
		buildFlatRing(1.62, 0.30, 0.30, 128),
		buildFlatRing(1.33, 0.26, 0.26, 108),
		buildFlatRing(1.08, 0.22, 0.22,  80),
	];

	var NEON_CORE = [
		buildNeonEdges(1.62, 0.15, 0.15,  0.005, 128),
		buildNeonEdges(1.33, 0.13, 0.13,  0.005, 108),
		buildNeonEdges(1.08, 0.11, 0.11,  0.005,  80),
	];
	var NEON_HALO = [
		buildNeonEdges(1.62, 0.15, 0.15,  0.024,  64),
		buildNeonEdges(1.33, 0.13, 0.13,  0.024,  54),
		buildNeonEdges(1.08, 0.11, 0.11,  0.024,  40),
	];

	/* ── globe: Fibonacci sphere, 480 points ── */
	var GLOBE_N = 480;
	(function(){
		var pts = [], PHI = Math.PI*(3-Math.sqrt(5));
		for(var i=0;i<GLOBE_N;i++){
			var y=1-(i/(GLOBE_N-1))*2, r=Math.sqrt(1-y*y), th=PHI*i;
			pts.push(r*Math.cos(th), y, r*Math.sin(th));
		}
		var gvbo = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, gvbo);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pts), gl.STATIC_DRAW);
		gl.bindBuffer(gl.ARRAY_BUFFER, null);
		window._cardanGlobeVBO = gvbo;
	}());

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
	function rAxis(ax, ay, az, a) {
		var m=ident(),c=Math.cos(a),s=Math.sin(a),mc=1-c;
		m[0]=c+ax*ax*mc;      m[4]=ax*ay*mc-az*s;   m[8]=ax*az*mc+ay*s;
		m[1]=ay*ax*mc+az*s;   m[5]=c+ay*ay*mc;      m[9]=ay*az*mc-ax*s;
		m[2]=az*ax*mc-ay*s;   m[6]=az*ay*mc+ax*s;   m[10]=c+az*az*mc;
		return m;
	}
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
		[0.98, 0.84, 0.30, 1.0],
		[0.98, 0.84, 0.30, 1.0],
		[0.98, 0.84, 0.30, 1.0],
	];
	var LITE = [
		[0.65, 0.42, 0.08, 1.0],
		[0.65, 0.42, 0.08, 1.0],
		[0.65, 0.42, 0.08, 1.0],
	];
	var VIPER = [
		[0.13, 1.00, 0.13, 1.0],
		[0.13, 1.00, 0.13, 1.0],
		[0.26, 1.00, 0.22, 1.0],
	];
	// Glow colors: lighter/warmer, used with additive blending
	var DARK_GLOW = [
		[1.0, 0.88, 0.42, 0.22],
		[1.0, 0.88, 0.42, 0.22],
		[1.0, 0.95, 0.62, 0.22],
	];
	var LITE_GLOW = [
		[0.68, 0.44, 0.12, 0.14],
		[0.68, 0.44, 0.12, 0.14],
		[0.72, 0.50, 0.18, 0.14],
	];

	var t0 = performance.now();
	var BASE_SPEED     = 0.125;
	var PEAK_MULT      = 75;
	var ACCEL_DUR      = 0.28;
	var currentSpeed   = BASE_SPEED;
	var accAng         = 0;
	var prevFrameTime  = t0;
	var hoverStartTime = -1;
	var GLOBE_BASE = 0.004;
	var gAng = 0;

	document.querySelectorAll('.card').forEach(function (card) {
		card.addEventListener('mouseenter', function () { hoverStartTime = performance.now() * 0.001; });
		card.addEventListener('mouseleave', function () { hoverStartTime = -1; });
	});

	function frame(now) {
		var t = (now - t0) * 0.001;
		var W = cvs.width, H = cvs.height;
		gl.viewport(0, 0, W, H);
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
		gl.enable(gl.BLEND);
		gl.enable(gl.DEPTH_TEST);

		var pv     = mul(persp(Math.PI / 3, W / H, 0.1, 20.0), tz(-3.5));
		var isLite  = document.documentElement.classList.contains('light');
		var isViper = document.documentElement.classList.contains('viper');
		var COLS   = isViper ? VIPER : isLite ? LITE : DARK;
		var GCOLS  = isLite ? LITE_GLOW : DARK_GLOW;
		var offset = txy(1.55, 1.15);

		gl.useProgram(prog);

		var dt = Math.min((now - prevFrameTime) * 0.001, 0.05);
		prevFrameTime = now;
		var elapsed = hoverStartTime >= 0 ? (now * 0.001 - hoverStartTime) : -1;
		var speedMult = 1.0;
		if (elapsed >= 0 && elapsed < ACCEL_DUR) {
			var p = elapsed / ACCEL_DUR;
			speedMult = 1.0 + (PEAK_MULT - 1.0) * Math.sin(p * Math.PI);
		}
		var targetSpeed = BASE_SPEED * speedMult;
		currentSpeed += (targetSpeed - currentSpeed) * 0.13;
		accAng += dt * currentSpeed;

		var D    = 1 / Math.sqrt(3);
		var ang  = accAng;
		var diag = rAxis(D, D, D, ang);
		var primarySpins = [rx, ry, rz];

		// Band pass — flat rings with diffuse shading
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
		gl.depthMask(true);
		gl.uniform1f(LOC.uShade, 1.0);
		RINGS.forEach(function (ring, i) {
			var model = mul(offset, mul(diag, mul(primarySpins[i](ang), PRE[i])));
			gl.uniformMatrix4fv(LOC.uMVP,  false, mul(pv, model));
			gl.uniformMatrix3fv(LOC.uNorm, false, mat3of(model));
			var c = COLS[i];
			var bandA  = isLite ? 0.28 : 0.06;
			var bandMul = isLite ? 0.22 : 0.04;
			gl.uniform4fv(LOC.uCol, new Float32Array([c[0] * bandMul, c[1] * bandMul, c[2] * bandMul, bandA]));
			gl.bindVertexArray(ring.vao);
			gl.drawElements(gl.TRIANGLES, ring.count, gl.UNSIGNED_INT, 0);
			gl.bindVertexArray(null);
		});

		var flicker = [1.0, 1.0, 1.0];

		// Core pass — thin bright tubes, standard alpha blend, no shading
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
		gl.depthMask(true);
		gl.uniform1f(LOC.uShade, 0.0);
		NEON_CORE.forEach(function (neon, i) {
			var model = mul(offset, mul(diag, mul(primarySpins[i](ang), PRE[i])));
			gl.uniformMatrix4fv(LOC.uMVP,  false, mul(pv, model));
			gl.uniformMatrix3fv(LOC.uNorm, false, mat3of(model));
			var c = COLS[i];
			var tubeA = isLite ? 0.60 : 0.45;
			gl.uniform4fv(LOC.uCol, new Float32Array([c[0], c[1], c[2], tubeA * flicker[i]]));
			gl.bindVertexArray(neon.vao);
			gl.drawElements(gl.TRIANGLES, neon.count, gl.UNSIGNED_INT, 0);
			gl.bindVertexArray(null);
		});

		gl.depthMask(true);

		/* globe pass — inside frame(), depth-tested against ring depth */
		if (progG && window._cardanGlobeVBO) {
			gAng += GLOBE_BASE * speedMult;
			var pulseVal = Math.min((speedMult - 1.0) / (PEAK_MULT - 1.0), 1.0);
			gl.useProgram(progG);
			gl.depthMask(false);
			gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
			gl.uniformMatrix4fv(LOC_G.uGlobeMVP, false, mul(pv, offset));
			gl.uniform1f(LOC_G.uAng, gAng);
			gl.uniform1f(LOC_G.uScale, 0.15);
			gl.uniform1f(LOC_G.uSizeMul, 1.0);
			gl.uniform1f(LOC_G.uPulse, pulseVal);
			gl.uniform1f(LOC_G.uAlphaMul, 1.0);
			gl.uniform1f(LOC_G.uLight, isLite ? 1.0 : 0.0);
			gl.uniform1f(LOC_G.uViper, isViper ? 1.0 : 0.0);
			gl.bindBuffer(gl.ARRAY_BUFFER, window._cardanGlobeVBO);
			gl.enableVertexAttribArray(LOC_G.aPos);
			gl.vertexAttribPointer(LOC_G.aPos, 3, gl.FLOAT, false, 0, 0);
			gl.drawArrays(gl.POINTS, 0, GLOBE_N);
			gl.depthMask(true);
			gl.bindBuffer(gl.ARRAY_BUFFER, null);
		}

		if (document.hidden) return;
		requestAnimationFrame(frame);
	}

	requestAnimationFrame(frame);
	document.addEventListener('visibilitychange', () => { if (!document.hidden) requestAnimationFrame(frame); });
}());
