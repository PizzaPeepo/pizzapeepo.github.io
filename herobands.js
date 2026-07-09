/* herobands.js — hero "prism" spectral wave layer.
   Three razor-thin 1/d^2 "laser" lines on >1-screen wavelengths; each line's
   R and B channels ride vertically offset copies of the curve, so every line
   reads as dispersed light — white-hot core, warm fringe above, cool fringe
   below — wrapped in a soft bloom halo. Slightly different frequency + drift
   per wave beats the trio in and out of phase (merge → fan → merge). A focus
   term funnels the three curves toward the cursor while the left mouse button
   is held, dragging them into a travelling white knot — like aligning a
   prism; release lets them breathe free again. Faded out on scroll in
   lockstep with the hero, so it rides every background mode: classic
   wavegrid, fluid lattice, or raw dye.

   Self-mounting fixed full-window canvas, pointer-events:none, z-index 0
   (above the background canvases, below the .wrap content at z-index 1).
   Mirrors wavegrid.js: WebGL2, theme read from documentElement.classList each
   frame, self-guards no-WebGL2 + reduced-motion. */
(function () {
  'use strict';

  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var knotDemo = new URLSearchParams(location.search).get('knot') === '1';   // headless: force the convergence knot

  var canvas = document.createElement('canvas');
  // z-index 0: above wavegrid (-3) / fluid dye (0, earlier in DOM) / streaks,
  // below the .wrap content (1) so the knot glows behind the hero title.
  canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;pointer-events:none;';
  document.body.appendChild(canvas);

  var gl = canvas.getContext('webgl2', { premultipliedAlpha: false, alpha: true, antialias: false });
  if (!gl) { canvas.remove(); return; }

  /* ── Full-screen triangle (no VBO — gl_VertexID) ── */
  var VS = [
    '#version 300 es',
    'precision highp float;',
    'const vec2 v[3] = vec2[3](vec2(-1.0,-1.0), vec2(3.0,-1.0), vec2(-1.0,3.0));',
    'void main() { gl_Position = vec4(v[gl_VertexID], 0.0, 1.0); }'
  ].join('\n');

  /* ── Bands + focus knot ── */
  var FS = [
    '#version 300 es',
    'precision highp float;',
    'uniform vec2  uRes;',        // drawing-buffer px
    'uniform float uTime;',
    'uniform vec2  uMouse;',      // device px, y-down
    'uniform float uFocus;',      // 0..1 — ramps up on first pointer move
    'uniform float uCenter;',     // band-band vertical centre, fraction of height (y-down)
    'uniform float uFade;',       // scroll fade (1 at top, 0 once hero is gone)
    'uniform float uOpacity;',
    'out vec4 fragColor;',
    '',
    'void main() {',
    '  float px = gl_FragCoord.x;',
    '  float py = uRes.y - gl_FragCoord.y;',          // y-down to match the cursor
    '  float vh = uRes.y * 0.01;',
    '  float base  = uCenter * uRes.y;',
    '',
    '  // Three coincident waves on very long wavelengths (>1 screen → you never',
    '  // see a full wave), slightly different frequency + drift so they beat.',
    '  // Breathing amplitudes: wave 0 stays small (a near-white thread); waves',
    '  // 1 and 2 swell and shrink over ~15-20s, out of step with each other.',
    '  float k0 = 6.2831853 / (uRes.x * 2.2);',
    '  float k1 = 6.2831853 / (uRes.x * 2.8);',
    '  float k2 = 6.2831853 / (uRes.x * 3.6);',
    '  float ph0 = px * k0 + uTime * 0.80;',
    '  float ph1 = px * k1 + uTime * 2.25 + 2.1;',
    '  float ph2 = px * k2 + uTime * 2.80 + 4.4;',
    '  // Two-sine breathing (rich, non-repeating feel) + a sharpened pow-pulse',
    '  // that briefly overshoots the amplitude → quick fan-out. On top, a slow',
    '  // macro envelope: mostly calm, then a fast-but-smooth ramp into a short',
    '  // (~6s) high-energy burst before settling back down.',
    '  float env1 = smoothstep(0.90, 0.995, 0.5 + 0.5 * sin(uTime * 0.15 + 5.2));',
    '  float env2 = smoothstep(0.90, 0.995, 0.5 + 0.5 * sin(uTime * 0.17 + 1.3));',
    '  float a0 = vh * (3.9 + 1.05 * sin(uTime * 0.19) + 0.75 * sin(uTime * 0.47 + 2.0));',
    '  float sw1 = 0.5 + 0.5 * sin(uTime * 0.23 + 3.0);',
    '  float sw2 = 0.5 + 0.5 * sin(uTime * 0.17 + 0.9);',
    '  float a1 = vh * 19.5 * (0.35 + 0.65 * env1) * (0.55 + 0.25 * sin(uTime * 0.37 + 1.7) + 0.20 * sin(uTime * 0.71 + 0.6) + 0.30 * pow(sw1, 10.0));',
    '  float a2 = vh * 18.0 * (0.35 + 0.65 * env2) * (0.55 + 0.25 * sin(uTime * 0.29 + 4.1) + 0.20 * sin(uTime * 0.61 + 2.4) + 0.30 * pow(sw2, 10.0));',
    '  float s0 = sin(ph0), s1 = sin(ph1), s2 = sin(ph2);',
    '  float y0 = base + a0 * s0;',
    '  float y1 = base + a1 * s1;',
    '  float y2 = base + a2 * s2;',
    '',
    '  // Focus: columns near the cursor pull all three centres toward the cursor',
    '  // y (hold-LMB), funnelling the waves into a travelling white knot.',
    '  float fxs = uRes.x * 0.16;',
    '  float fx  = exp(-(px - uMouse.x) * (px - uMouse.x) / (2.0 * fxs * fxs));',
    '  float f   = fx * 0.92 * uFocus;',
    '  y0 = mix(y0, uMouse.y, f);',
    '  y1 = mix(y1, uMouse.y, f);',
    '  y2 = mix(y2, uMouse.y, f);',
    '',
    '  // Slope-corrected (≈perpendicular) distance keeps line thickness uniform.',
    '  float c0 = cos(ph0), c1 = cos(ph1), c2 = cos(ph2);',
    '  float sl0 = a0 * k0 * c0 * (1.0 - f);',
    '  float sl1 = a1 * k1 * c1 * (1.0 - f);',
    '  float sl2 = a2 * k2 * c2 * (1.0 - f);',
    '  float w0 = inversesqrt(1.0 + sl0 * sl0);',
    '  float w1 = inversesqrt(1.0 + sl1 * sl1);',
    '  float w2 = inversesqrt(1.0 + sl2 * sl2);',
    '  float d0 = (py - y0) * w0;',
    '  float d1 = (py - y1) * w1;',
    '  float d2 = (py - y2) * w2;',
    '',
    '  // Velocity-coupled dispersion: fringe spread follows each line\'s vertical',
    '  // speed dy/dt = a*spd*cos(ph) — fans into a rainbow where the line sweeps',
    '  // fast (baseline crossings), fuses back to white where it hangs at a',
    '  // crest or barely moves. tanh soft-caps the spread so the R-G-B cores',
    '  // always stay a connected gradient — never separate lines with dark gaps.',
    '  // Focus (1-f) re-fuses them into white at the knot.',
    '  float cap  = 1.0 * vh;',
    '  float dsp0 = cap * tanh(0.039 * a0 * 0.80 * c0 / cap) * w0 * (1.0 - f);',
    '  float dsp1 = cap * tanh(0.039 * a1 * 2.25 * c1 / cap) * w1 * (1.0 - f);',
    '  float dsp2 = cap * tanh(0.039 * a2 * 2.80 * c2 / cap) * w2 * (1.0 - f);',
    '  float B    = 0.22 * vh * vh;',                    // line energy (1/d^2 core)
    '  float eps2 = 0.012 * vh * vh;',                   // core softness floor
    '  float hI   = 1.0 / (18.0 * vh * vh);',            // halo 1/(2*sigma^2), sigma = 3vh
    '  vec3 col = vec3(0.0);',
    '  col.r += B / ((d0 + dsp0) * (d0 + dsp0) + eps2);',
    '  col.g += B / (d0 * d0 + eps2);',
    '  col.b += B / ((d0 - dsp0) * (d0 - dsp0) + eps2);',
    '  col.r += B / ((d1 + dsp1) * (d1 + dsp1) + eps2);',
    '  col.g += B / (d1 * d1 + eps2);',
    '  col.b += B / ((d1 - dsp1) * (d1 - dsp1) + eps2);',
    '  col.r += B / ((d2 + dsp2) * (d2 + dsp2) + eps2);',
    '  col.g += B / (d2 * d2 + eps2);',
    '  col.b += B / ((d2 - dsp2) * (d2 - dsp2) + eps2);',
    '  col += vec3(0.10) * (exp(-d0 * d0 * hI) + exp(-d1 * d1 * hI) + exp(-d2 * d2 * hI));',
    '',
    '  col = vec3(1.0) - exp(-col * 2.0);',              // filmic-ish rolloff → clean white cores
    '  float lum = dot(col, vec3(0.299, 0.587, 0.114));',
    '  col = clamp(mix(vec3(lum), col, 1.45), 0.0, 1.0);',  // saturation punch — whites untouched, fringes vivid
    '',
    '  float a = clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0) * uFade * uOpacity;',
    '  fragColor = vec4(clamp(col, 0.0, 1.0), a);',
    '}'
  ].join('\n');

  function mkShader(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error('[herobands shader]', gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }
  var v = mkShader(gl.VERTEX_SHADER, VS);
  var f = mkShader(gl.FRAGMENT_SHADER, FS);
  if (!v || !f) { canvas.remove(); return; }
  var prog = gl.createProgram();
  gl.attachShader(prog, v);
  gl.attachShader(prog, f);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error('[herobands link]', gl.getProgramInfoLog(prog));
    canvas.remove();
    return;
  }

  var LOC = {
    uRes:     gl.getUniformLocation(prog, 'uRes'),
    uTime:    gl.getUniformLocation(prog, 'uTime'),
    uMouse:   gl.getUniformLocation(prog, 'uMouse'),
    uFocus:   gl.getUniformLocation(prog, 'uFocus'),
    uCenter:  gl.getUniformLocation(prog, 'uCenter'),
    uFade:    gl.getUniformLocation(prog, 'uFade'),
    uOpacity: gl.getUniformLocation(prog, 'uOpacity'),
  };

  var pr = Math.min(window.devicePixelRatio || 1, 2);
  function resize() {
    pr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width  = Math.floor(window.innerWidth  * pr);
    canvas.height = Math.floor(window.innerHeight * pr);
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  resize();
  window.addEventListener('resize', function () { resize(); measureCenter(); if (reduced) render(); });

  /* Band centre sits just below the hero title, as a fraction of the
     viewport height. Measured at rest (top of page); the layer fades on scroll,
     so the rest position is what matters. */
  var centerFrac = 0.72;
  var title = document.getElementById('kineticTitle');
  function measureCenter() {
    if (!title) return;
    var r = title.getBoundingClientRect();
    var c = (r.bottom + 20) / window.innerHeight + 0.19;   // band centre well below the hero text, above the scroll cue
    if (c > 0.2 && c < 0.84) centerFrac = c;
  }
  measureCenter();
  window.addEventListener('load', measureCenter);

  /* Damped cursor + focus ramp. Hold-to-focus: plain pointer moves are ignored;
     the knot engages only while the left button is held (drag), and releases
     back to free breathing on pointerup. */
  var mxTgt = window.innerWidth * 0.5, myTgt = window.innerHeight * centerFrac;
  var mxCur = mxTgt, myCur = myTgt, focusCur = 0, focusTgt = 0;
  if (knotDemo) focusTgt = 1;
  if (!reduced) {
    window.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      mxTgt = e.clientX; myTgt = e.clientY; focusTgt = 1;
    }, { passive: true });
    window.addEventListener('pointermove', function (e) {
      if (!(e.buttons & 1)) return;                     // follow only while LMB held
      mxTgt = e.clientX; myTgt = e.clientY; focusTgt = 1;
    }, { passive: true });
    var release = function () { if (!knotDemo) focusTgt = 0; };
    window.addEventListener('pointerup', release, { passive: true });
    window.addEventListener('pointercancel', release, { passive: true });
    window.addEventListener('blur', release);
  }

  /* Scroll fade — matches the hero-parallax dissolve (hdr-inner opacity), so the
     bands leave exactly as the title recedes. */
  var fade = 1;
  function readScroll() {
    var p = Math.min(window.scrollY / (window.innerHeight * 0.7), 1);
    fade = Math.max(1 - p * 1.15, 0);
  }
  readScroll();
  window.addEventListener('scroll', readScroll, { passive: true });

  var t0 = performance.now();
  function render(nowMs) {
    var cls = document.documentElement.classList;
    var t = ((nowMs || performance.now()) - t0) * 0.001;

    mxCur += (mxTgt - mxCur) * 0.08;
    myCur += (myTgt - myCur) * 0.08;
    focusCur += (focusTgt - focusCur) * 0.06;

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(prog);
    gl.uniform2f(LOC.uRes, canvas.width, canvas.height);
    gl.uniform1f(LOC.uTime, reduced ? 3.0 : t);
    gl.uniform2f(LOC.uMouse, mxCur * pr, myCur * pr);
    gl.uniform1f(LOC.uFocus, focusCur);
    gl.uniform1f(LOC.uCenter, centerFrac);
    gl.uniform1f(LOC.uFade, fade);
    gl.uniform1f(LOC.uOpacity, cls.contains('light') ? 0.65 : 1.0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  if (reduced) {
    // Static developed frame; re-render on theme swap only.
    render();
    document.addEventListener('themechange', function () { render(); });
    return;
  }

  function frame(now) {
    render(now);
    if (document.hidden) return;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) requestAnimationFrame(frame);
  });
}());
