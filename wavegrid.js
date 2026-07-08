/* wavegrid.js — WebGL2 interactive wave-dot background */
(function () {
  'use strict';

  var canvas = document.createElement('canvas');
  // z-index -3: base plane. When the raw-fluid engine layers over the classic
  // background (ASCII off), the dye sits at z -1 above this and its tint (-2),
  // below streaks/cardan (0). Alone (fluid off) it's still the bottom-most layer.
  canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:-3;pointer-events:none;display:block;';
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
    'uniform float uTilt;',
    'uniform float uRise;',
    'uniform float uYaw;',
    'uniform float uCam;',
    'uniform float uTravel;',
    'uniform vec4  uRipples[8];',
    'uniform vec3  uTrail[12];',
    'out float vH;',
    'out float vTrail;',
    'out float vEdge;',
    'out float vW;',
    'out vec2  vScrPos;',
    '',
    'void main() {',
    '  float tilt = uTilt;',
    '  float ct = cos(tilt), st = sin(tilt);',
    '  float cam  = uCam;',
    '',
    '  // Dolly travel: camera advances over the plane, rows flow toward the viewer.',
    '  // World wraps (span 2.8 in y); edge bands fade so recycled rows never pop.',
    '  float yW = mod(aPos.y - uTravel + 1.1, 2.8) - 1.1;',
    '  vEdge = smoothstep(-1.10, -0.86, yW) * (1.0 - smoothstep(1.46, 1.70, yW));',
    '',
    '  float w0    = cam / (cam + yW * st + 0.5);',
    '  vec2 scrPos = vec2((aPos.x - uYaw) * w0 / uAspect, (yW * ct - uRise) * w0);',
    '  vScrPos = scrPos;',
    '',
    '  float z = 0.0;',
    '  z += sin(aPos.x * 2.8 + uTime * 0.70) * 0.030;',
    '  z += sin(yW * 2.2 + uTime * 0.55) * 0.025;',
    '  z += sin((aPos.x - yW) * 1.8 + uTime * 0.42) * 0.018;',
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
    '  vec3 p = vec3(aPos.x, yW * ct - z * st, yW * st + z * ct);',
    '  float w = cam / (cam + p.z + 0.5);',
    '  vW = w;',
    '  gl_Position  = vec4((p.x - uYaw) * w / uAspect, (p.y - uRise) * w, 0.0, 1.0);',
    '  gl_PointSize = clamp(w * 2.8, 1.0, 6.0);',
    '}'
  ].join('\n');

  /* ── Fragment shader ── */
  var FS = [
    '#version 300 es',
    'precision highp float;',
    'in float vH;',
    'in float vTrail;',
    'in float vEdge;',
    'in float vW;',
    'in vec2  vScrPos;',
    'uniform float uTime;',
    'uniform float uLight;',
    'uniform float uViper;',
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
    '  // Viper ramp: black -> emerald -> bright venom',
    '  vec3 v0 = vec3(0.02, 0.12, 0.05);',
    '  vec3 v1 = vec3(0.07, 0.82, 0.16);',
    '  vec3 v2 = vec3(0.18, 1.00, 0.22);',
    '  vec3 cv = t < 0.5 ? mix(v0, v1, t * 2.0) : mix(v1, v2, (t - 0.5) * 2.0);',
    '  col = mix(col, cv, uViper);',
    '',
    '  // Trail glow — bright gold in dark, deep amber in light',
    '  vec3 trailDark  = vec3(1.00, 0.96, 0.72);',
    '  vec3 trailLight = vec3(0.70, 0.35, 0.02);',
    '  vec3 trailCol = mix(trailDark, trailLight, uLight);',
    '',
    '  // Viper trail: pastel rainbow, hue drifts with time + position',
    '  float hue = fract(uTime * 0.08 + vScrPos.x * 0.18 + vScrPos.y * 0.10);',
    '  vec3 rb = clamp(abs(mod(hue * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);',
    '  trailCol = mix(trailCol, mix(vec3(1.0), rb, 0.5), uViper);',
    '',
    '  col = mix(col, trailCol, vTrail * 0.88);',
    '',
    '  float aBase = mix(0.12 + t * 0.50, 0.72 + t * 0.26, uLight);',
    '  float a = mix(aBase, 0.07 + t * 0.32, uViper) * soft;',
    '  a = mix(a, soft * 0.95, vTrail * 0.65);',
    '  // depth haze — far rows thin out; deepens as the dolly closes in (w spread widens)',
    '  float haze = 0.30 + 0.70 * smoothstep(0.52, 0.92, vW);',
    '  fragColor = vec4(col, min(a * (1.0 + uViper * 0.8), 0.98) * vEdge * haze);',
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

  // Remove opaque body bg so backdrop-filter on cards sees the canvas
  document.body.style.background = 'transparent';

  // Warm tint overlay — dims the raw dot grid back to the calm/warm look. Sits
  // at z -2, directly above the wavegrid canvas (-3) and below the raw fluid (-1),
  // so the dye glows over the tinted grid rather than being dimmed by it.
  var tint = document.createElement('div');
  tint.style.cssText = 'position:fixed;inset:0;z-index:-2;pointer-events:none;transition:background 0.3s;';
  canvas.insertAdjacentElement('afterend', tint);

  function updateTint() {
    var cls = document.documentElement.classList;
    tint.style.background = cls.contains('viper')
      ? 'rgba(2,7,5,0.42)'
      : cls.contains('light')
        ? 'rgba(250,245,238,0.38)'
        : 'rgba(24,18,16,0.58)';
  }
  updateTint();
  new MutationObserver(updateTint).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

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
    uTilt:    gl.getUniformLocation(prog, 'uTilt'),
    uRise:    gl.getUniformLocation(prog, 'uRise'),
    uYaw:     gl.getUniformLocation(prog, 'uYaw'),
    uCam:     gl.getUniformLocation(prog, 'uCam'),
    uTravel:  gl.getUniformLocation(prog, 'uTravel'),
    uViper:   gl.getUniformLocation(prog, 'uViper'),
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

  /* Camera dolly (scroll) + parallax yaw (mouse) — damped toward targets each frame
     so the "camera" glides instead of tracking input 1:1. */
  var scrollTgt = 0, scrollCur = 0;
  var yawTgt    = 0, yawCur    = 0;
  var surgeAmt  = 0;   // dolly impulse (card click / cue) — decays each frame

  function readScroll() {
    scrollTgt = Math.min(window.scrollY / (window.innerHeight * 0.85), 1.0);
  }
  readScroll();
  window.addEventListener('scroll', readScroll, { passive: true });

  var DARK_BG  = [24/255, 18/255, 16/255];
  var LIGHT_BG = [250/255, 245/255, 238/255];
  var VIPER_BG = [3/255, 8/255, 6/255];

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
    yawTgt = mouse[0] * 0.05;

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

  function addRipple(nx, ny, strength) {
    var idx = (rIdx % 8) * 4;
    ripData[idx]     = nx;
    ripData[idx + 1] = ny;
    ripData[idx + 2] = (performance.now() - t0) * 0.001;
    ripData[idx + 3] = strength;
    rIdx++;
  }

  document.addEventListener('click', function (e) {
    addRipple(
       (e.clientX / canvas.width)  * 2.0 - 1.0,
      -((e.clientY / canvas.height) * 2.0 - 1.0),
      1.0
    );
  });

  /* ── Render loop ── */
  function frame() {
    var t    = (performance.now() - t0) * 0.001;
    var cls  = document.documentElement.classList;
    var lite = cls.contains('light') ? 1.0 : 0.0;
    var vip  = cls.contains('viper') ? 1.0 : 0.0;
    var bg   = vip ? VIPER_BG : lite ? LIGHT_BG : DARK_BG;

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
    scrollCur += (scrollTgt - scrollCur) * 0.055;
    yawCur    += (yawTgt    - yawCur)    * 0.045;
    surgeAmt  *= 0.94;
    gl.uniform1f(LOC.uTilt,   0.48 + scrollCur * 0.24);
    gl.uniform1f(LOC.uRise,   0.08 + scrollCur * 0.20);
    gl.uniform1f(LOC.uYaw,    yawCur);
    gl.uniform1f(LOC.uCam,    4.5  - scrollCur * 1.9 - surgeAmt * 0.9);
    gl.uniform1f(LOC.uTravel, scrollCur * 1.35 + surgeAmt * 0.5);
    gl.uniform1f(LOC.uViper,  vip);
    gl.uniform4fv(LOC.uRipples, ripData);
    gl.uniform3fv(LOC.uTrail,   trailData);

    gl.drawArrays(gl.POINTS, 0, COLS * ROWS);

    if (document.hidden) return;
    requestAnimationFrame(frame);
  }

  frame();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) requestAnimationFrame(frame); });

  /* Overture — three scripted raindrops sweep the plane on load, announcing that
     the surface is live and responsive before the user ever touches it. */
  [[-0.45, 0.25, 500, 0.85], [0.5, -0.05, 950, 0.6], [0.1, 0.4, 1500, 0.5]].forEach(function (r) {
    setTimeout(function () { addRipple(r[0], r[1], r[3]); }, r[2]);
  });

  /* Public impulse API — landing-page scripts fire ripples / dolly surges into
     the grid (card click handoff, card scroll-reveal, scroll-cue gauge). */
  window.waveGrid = {
    impulse: function (clientX, clientY, strength) {
      addRipple(
         (clientX / canvas.width)  * 2.0 - 1.0,
        -((clientY / canvas.height) * 2.0 - 1.0),
        Math.max(0, Math.min(strength || 1.0, 1.5))
      );
    },
    surge: function (amt) {
      surgeAmt = Math.min(surgeAmt + (amt || 1.0), 1.2);
    },
  };
}());
