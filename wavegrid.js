/* wavegrid.js — WebGL2 interactive wave-dot background */
(function () {
  'use strict';

  var canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;pointer-events:none;display:block;';
  document.body.insertBefore(canvas, document.body.firstChild);

  var gl = canvas.getContext('webgl2');
  if (!gl) { canvas.remove(); return; }

  /* ── Vertex shader ── */
  var VS = [
    '#version 300 es',
    'precision highp float;',
    'in vec2 aPos;',
    'uniform float uTime;',
    'uniform vec2  uMouse;',
    'uniform float uAspect;',
    'uniform vec4  uRipples[8];',
    'uniform vec3  uTrail[12];',
    'out float vH;',
    'out float vTrail;',
    'out vec2  vScrPos;',
    '',
    'void main() {',
    '  float tilt = 0.48;',
    '  float ct = cos(tilt), st = sin(tilt);',
    '  float cam  = 4.5;',
    '',
    '  float w0    = cam / (cam + aPos.y * st + 0.5);',
    '  vec2 scrPos = vec2(aPos.x * w0 / uAspect, (aPos.y * ct - 0.08) * w0);',
    '  vScrPos = scrPos;',
    '',
    '  float z = 0.0;',
    '  z += sin(aPos.x * 2.8 + uTime * 0.70) * 0.030;',
    '  z += sin(aPos.y * 2.2 + uTime * 0.55) * 0.025;',
    '  z += sin((aPos.x - aPos.y) * 1.8 + uTime * 0.42) * 0.018;',
    '',
    '  float md = length(scrPos - uMouse);',
    '  z += sin(md * 8.0 - uTime * 4.0) * exp(-md * 2.0) * 0.15;',
    '',
    '  for (int i = 0; i < 8; i++) {',
    '    float age = uTime - uRipples[i].z;',
    '    if (uRipples[i].w > 0.001 && age > 0.0 && age < 5.0) {',
    '      float d = length(scrPos - uRipples[i].xy);',
    '      z += sin(d * 9.0 - age * 5.5)',
    '         * exp(-d * 2.5)',
    '         * exp(-age * 1.5)',
    '         * uRipples[i].w * 0.22;',
    '    }',
    '  }',
    '',
    '  // Mouse comet trail glow',
    '  float trail = 0.0;',
    '  for (int i = 0; i < 12; i++) {',
    '    float age = uTime - uTrail[i].z;',
    '    if (uTrail[i].z > 0.001 && age >= 0.0 && age < 1.4) {',
    '      float d = length(scrPos - uTrail[i].xy);',
    '      trail += exp(-d * 10.0) * exp(-age * 3.0);',
    '    }',
    '  }',
    '  vTrail = clamp(trail, 0.0, 1.0);',
    '',
    '  vH = z;',
    '',
    '  vec3 p = vec3(aPos.x, aPos.y * ct - z * st, aPos.y * st + z * ct);',
    '  float w = cam / (cam + p.z + 0.5);',
    '  gl_Position  = vec4(p.x * w / uAspect, (p.y - 0.08) * w, 0.0, 1.0);',
    '  gl_PointSize = clamp(w * 2.8, 1.0, 5.0);',
    '}'
  ].join('\n');

  /* ── Fragment shader ── */
  var FS = [
    '#version 300 es',
    'precision highp float;',
    'in float vH;',
    'in float vTrail;',
    'in vec2  vScrPos;',
    'uniform float uTime;',
    'uniform float uLight;',
    'out vec4 fragColor;',
    '',
    'void main() {',
    '  vec2 c = 2.0 * gl_PointCoord - 1.0;',
    '  if (dot(c, c) > 1.0) discard;',
    '  float soft = 1.0 - smoothstep(0.4, 1.0, dot(c, c));',
    '',
    '  // Slow heat drift — large-scale rolling color field',
    '  float heat = sin(vScrPos.x * 2.4 + uTime * 0.25)',
    '             * sin(vScrPos.y * 1.7 + uTime * 0.18) * 0.5 + 0.5;',
    '  float t = tanh((vH + (heat - 0.5) * 0.22) * 3.5) * 0.5 + 0.5;',
    '',
    '  vec3 d0 = vec3(0.11, 0.08, 0.07);',
    '  vec3 d1 = vec3(0.48, 0.30, 0.10);',
    '  vec3 d2 = vec3(0.99, 0.85, 0.47);',
    '  vec3 l0 = vec3(0.32, 0.27, 0.21);',
    '  vec3 l1 = vec3(0.80, 0.48, 0.04);',
    '  vec3 l2 = vec3(0.38, 0.20, 0.02);',
    '',
    '  vec3 cd  = t < 0.5 ? mix(d0, d1, t * 2.0) : mix(d1, d2, (t - 0.5) * 2.0);',
    '  vec3 cl  = t < 0.5 ? mix(l0, l1, t * 2.0) : mix(l1, l2, (t - 0.5) * 2.0);',
    '  vec3 col = mix(cd, cl, uLight);',
    '',
    '  // Trail glow — bright gold in dark, deep amber in light',
    '  vec3 trailDark  = vec3(1.00, 0.96, 0.72);',
    '  vec3 trailLight = vec3(0.70, 0.35, 0.02);',
    '  col = mix(col, mix(trailDark, trailLight, uLight), vTrail * 0.88);',
    '',
    '  float a = mix(0.12 + t * 0.50, 0.60 + t * 0.38, uLight) * soft;',
    '  a = mix(a, soft * 0.95, vTrail * 0.65);',
    '  fragColor = vec4(col, a);',
    '}'
  ].join('\n');

  /* ── Compile helpers ── */
  function mkShader(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error('[wavegrid shader]', gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }
  function mkProg(vsSrc, fsSrc) {
    var v = mkShader(gl.VERTEX_SHADER,   vsSrc);
    var f = mkShader(gl.FRAGMENT_SHADER, fsSrc);
    if (!v || !f) return null;
    var p = gl.createProgram();
    gl.attachShader(p, v);
    gl.attachShader(p, f);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.error('[wavegrid link]', gl.getProgramInfoLog(p));
      return null;
    }
    return p;
  }

  var prog = mkProg(VS, FS);
  if (!prog) { canvas.remove(); return; }

  /* ── Grid geometry ── */
  var COLS = 100, ROWS = 62;
  var verts = [];
  for (var row = 0; row < ROWS; row++) {
    for (var col = 0; col < COLS; col++) {
      verts.push(
        (col / (COLS - 1)) * 6.4 - 3.2,
        (row / (ROWS - 1)) * 2.8 - 1.1
      );
    }
  }
  var vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);

  /* ── Uniform locations ── */
  var LOC = {
    aPos:     gl.getAttribLocation(prog,  'aPos'),
    uTime:    gl.getUniformLocation(prog, 'uTime'),
    uMouse:   gl.getUniformLocation(prog, 'uMouse'),
    uAspect:  gl.getUniformLocation(prog, 'uAspect'),
    uLight:   gl.getUniformLocation(prog, 'uLight'),
    uRipples: gl.getUniformLocation(prog, 'uRipples[0]'),
    uTrail:   gl.getUniformLocation(prog, 'uTrail[0]'),
  };

  /* ── State ── */
  var mouse         = new Float32Array(2);
  var ripData       = new Float32Array(32);   // 8 × vec4
  var rIdx          = 0;
  var trailData     = new Float32Array(36);   // 12 × vec3
  var tIdx          = 0;
  var lastTrailTime = 0;
  var t0            = performance.now();

  var DARK_BG  = [24/255, 18/255, 16/255];
  var LIGHT_BG = [250/255, 245/255, 238/255];

  function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  resize();
  window.addEventListener('resize', resize);

  document.addEventListener('mousemove', function (e) {
    mouse[0] =  (e.clientX / canvas.width)  * 2.0 - 1.0;
    mouse[1] = -((e.clientY / canvas.height) * 2.0 - 1.0);

    var now = performance.now();
    if (now - lastTrailTime > 50) {
      var ti = (tIdx % 12) * 3;
      trailData[ti]     = mouse[0];
      trailData[ti + 1] = mouse[1];
      trailData[ti + 2] = (now - t0) * 0.001;
      tIdx++;
      lastTrailTime = now;
    }
  });

  document.addEventListener('click', function (e) {
    var t   = (performance.now() - t0) * 0.001;
    var idx = (rIdx % 8) * 4;
    ripData[idx]     =  (e.clientX / canvas.width)  * 2.0 - 1.0;
    ripData[idx + 1] = -((e.clientY / canvas.height) * 2.0 - 1.0);
    ripData[idx + 2] = t;
    ripData[idx + 3] = 1.0;
    rIdx++;
  });

  /* ── Render loop ── */
  function frame() {
    var t    = (performance.now() - t0) * 0.001;
    var lite = document.documentElement.classList.contains('light') ? 1.0 : 0.0;
    var bg   = lite ? LIGHT_BG : DARK_BG;

    gl.clearColor(bg[0], bg[1], bg[2], 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.enableVertexAttribArray(LOC.aPos);
    gl.vertexAttribPointer(LOC.aPos, 2, gl.FLOAT, false, 0, 0);

    gl.uniform1f(LOC.uTime,   t);
    gl.uniform2fv(LOC.uMouse, mouse);
    gl.uniform1f(LOC.uAspect, canvas.width / canvas.height);
    gl.uniform1f(LOC.uLight,  lite);
    gl.uniform4fv(LOC.uRipples, ripData);
    gl.uniform3fv(LOC.uTrail,   trailData);

    gl.drawArrays(gl.POINTS, 0, COLS * ROWS);

    requestAnimationFrame(frame);
  }

  frame();
}());
