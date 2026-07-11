/* herobands.js — hero "prism" spectral wave layer.
   Three razor-thin 1/d^2 "laser" lines sharing one >1-screen wavelength (2.8
   screens — no visible period); R and B channels are horizontally phase-offset
   copies (B leads, R trails), so every line reads as dispersed light — RGB
   fanned along the whole curve — wrapped in a soft bloom halo. Slightly
   different drift speed per wave slides the trio from nested to fanned and
   back within seconds; a shared signed-sine breath collapses all bands through
   one flat white line ~every 5s, alternating cycles: all equal, then staggered
   1 / 1.25 / 1.5. The trio
   also rides a physical plucked wire: left-button drag grabs the string, and on
   release the deformation keeps travelling, reflecting off the screen edges and
   slowly damping (CPU 1D wave equation, uploaded as an RG32F texture; its
   acceleration feeds the dispersion so velocity *changes* flash rainbow). Faded out
   on scroll in lockstep with the hero, so it rides every background mode:
   classic wavegrid, fluid lattice, or raw dye.

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
    'uniform sampler2D uWire;',   // physical wire state: R = displacement (px), G = vertical velocity (px/s)
    'out vec4 fragColor;',
    '',
    'void main() {',
    '  float px = gl_FragCoord.x;',
    '  float py = uRes.y - gl_FragCoord.y;',          // y-down to match the cursor
    '  float vh = uRes.y * 0.01;',
    '  float base  = uCenter * uRes.y;',
    '',
    '  // Physical wire: a plucked 1D string simulated on the CPU. R displaces all',
    '  // three curves as one taut wire; G is its vertical acceleration, folded',
    '  // into the dispersion below so velocity changes flash rainbow.',
    '  vec2 wire = texture(uWire, vec2((px / uRes.x + 0.5) / 2.0, 0.5)).rg;',   // wire spans 2 screen widths (PAD 0.5 each side, matches JS)
    '  float wDisp = wire.r;',
    '  float wAcc  = wire.g;',
    '',
    '  // Three bands sharing one 2.8-screen wavelength (no visible period), drifting',
    '  // at slightly different speeds so they slide from nested (one fat rainbow',
    '  // wave) to fanned-out and back within a few seconds. Signed-sine breathing',
    '  // makes each band collapse through a flat white line and regrow, and all',
    '  // three peak at the same height (~0.14 of the viewport).',
    '  float k  = 6.2831853 / (uRes.x * 2.8);', // Wavelength = 2.8 * screenlength
    '  float ph0 = px * k + uTime * 0.8;',
    '  float ph1 = px * k + uTime * 1.25 + 2.5;',
    '  float ph2 = px * k + uTime * 1.55 + 4.4;',
    '  // Shared breathing: all three bands swell and collapse together (one',
    '  // "cycle" = one hump of |sin|, ~5s). Cycles alternate: even cycle all',
    '  // equal, odd cycle staggered 1 / 1.25 / 1.5. The pattern switches at the',
    '  // zero crossing (all bands flat), so the handover is pop-free.',
    '  float br  = sin(uTime * 0.63);',
    '  float cyc = mod(floor(uTime * 0.63 / 3.14159265), 2.0);',
    '  float a0 = vh * 14.0 * br;',
    '  float a1 = vh * 14.0 * (1.0 + 0.25 * cyc) * br;',
    '  float a2 = vh * 14.0 * (1.0 + 0.50 * cyc) * br;',
    '  float s0 = sin(ph0), s1 = sin(ph1), s2 = sin(ph2);',
    '',
    '  // Grab fuse: while the wire is held, the pinch point reads clean white',
    '  // (a narrow column near the cursor), like pinching a taut string.',
    '  float fxs = uRes.x * 0.20;',      // tracks GRABSG (64/256 nodes, slightly narrower) so the white fuse covers the grab bulge
    '  float fx  = exp(-(px - uMouse.x) * (px - uMouse.x) / (2.0 * fxs * fxs));',
    '  float f   = fx * 0.85 * uFocus;',
    '',
    '  // Slope-corrected (≈perpendicular) distance keeps line thickness uniform.',
    '  float c0 = cos(ph0), c1 = cos(ph1), c2 = cos(ph2);',
    '  float sl0 = a0 * k * c0 * (1.0 - f);',
    '  float sl1 = a1 * k * c1 * (1.0 - f);',
    '  float sl2 = a2 * k * c2 * (1.0 - f);',
    '  float w0 = inversesqrt(1.0 + sl0 * sl0);',
    '  float w1 = inversesqrt(1.0 + sl1 * sl1);',
    '  float w2 = inversesqrt(1.0 + sl2 * sl2);',
    '',
    '  // RGB separation: constant horizontal phase offset per channel (B leads',
    '  // left, R trails right) — reads as dispersed light along the whole band,',
    '  // not only at crossings. Wire acceleration adds a vertical rainbow flash',
    '  // on flicks. Focus (1-f) re-fuses the channels to white at the grab point.',
    '  float sep  = k * uRes.x * 0.0055 * (1.0 - f);',  // phase for a fixed ~0.55%-of-width horizontal RGB offset, independent of wavelength
    '  float cap  = 1.5 * vh;',
    '  // Per-band vertical acceleration: shared wire dv/dt plus per-band procedural',
    '  // motion |d2/dt2[a*sin(ph)]| = |a*w^2*sin| — magnitude only, so the ambient',
    '  // undulation disperses at crests (faster-drifting bands more) but the RGB',
    '  // order never flips at wave nodes / breath sign changes. One shared tanh cap.',
    '  float pga = 0.025;', // SPREAD: dial how much the spread during ambient waves is
    '  float dwA = 0.026 * wAcc;',
    '  float dw0 = cap * tanh((dwA + pga * abs(a0 * 0.81   * s0)) / cap) * (1.0 - f);',
    '  float dw1 = cap * tanh((dwA + pga * abs(a1 * 1.5625 * s1)) / cap) * (1.0 - f);',
    '  float dw2 = cap * tanh((dwA + pga * abs(a2 * 2.4025 * s2)) / cap) * (1.0 - f);',
    '  float yc = base + wDisp;',
    '  float d0r = (py - (yc + a0 * sin(ph0 - sep) - dw0)) * w0;',
    '  float d0g = (py - (yc + a0 * s0)) * w0;',
    '  float d0b = (py - (yc + a0 * sin(ph0 + sep) + dw0)) * w0;',
    '  float d1r = (py - (yc + a1 * sin(ph1 - sep) - dw1)) * w1;',
    '  float d1g = (py - (yc + a1 * s1)) * w1;',
    '  float d1b = (py - (yc + a1 * sin(ph1 + sep) + dw1)) * w1;',
    '  float d2r = (py - (yc + a2 * sin(ph2 - sep) - dw2)) * w2;',
    '  float d2g = (py - (yc + a2 * s2)) * w2;',
    '  float d2b = (py - (yc + a2 * sin(ph2 + sep) + dw2)) * w2;',
    '  float B    = 0.17 * vh * vh;',                    // line energy (1/d^2 core)
    '  float eps2 = 0.007 * vh * vh;',                   // core softness floor — smaller = crisper sub-band edges
    '  float hI   = 1.0 / (18.0 * vh * vh);',            // halo 1/(2*sigma^2), sigma = 3vh
    '  vec3 col = vec3(0.0);',
    '  col.r += B / (d0r * d0r + eps2);',
    '  col.g += B / (d0g * d0g + eps2);',
    '  col.b += B / (d0b * d0b + eps2);',
    '  col.r += B / (d1r * d1r + eps2);',
    '  col.g += B / (d1g * d1g + eps2);',
    '  col.b += B / (d1b * d1b + eps2);',
    '  col.r += B / (d2r * d2r + eps2);',
    '  col.g += B / (d2g * d2g + eps2);',
    '  col.b += B / (d2b * d2b + eps2);',
    '  col += vec3(0.10) * (exp(-d0g * d0g * hI) + exp(-d1g * d1g * hI) + exp(-d2g * d2g * hI));',
    '',
    '  col = vec3(1.0) - exp(-col * 2.0);',              // filmic-ish rolloff → clean white cores
    '  float lum = dot(col, vec3(0.299, 0.587, 0.114));',
    '  col = clamp(mix(vec3(lum), col, 1.75), 0.0, 1.0);',  // saturation punch — whites untouched, fringes vivid
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
    uWire:    gl.getUniformLocation(prog, 'uWire'),
  };

  /* ── Physical wire: 1D plucked string, simulated on the CPU and uploaded as an
     N×1 RG32F texture (R = displacement in device px, G = vertical acceleration
     in px/s² — frame-level dv/dt through a peak-hold envelope, so a held-static
     grab decays to zero but a passing pulse leaves a readable wake). While the
     left button is held, the node under the cursor is driven to
     the cursor's offset from the band centre — dragging along the wire leaves a
     wake of travelling waves (finger-on-a-string). On release the node is freed,
     so the existing waves keep propagating, reflect off the screen edges, and
     slowly damp. G feeds the shader's acceleration-coupled dispersion. */
  var N = 384;
  var PAD = 0.5;                          // wire extends this fraction of the screen width beyond each edge
  var EXT = 1 + 2 * PAD;                  // total wire span, screen widths — pinned ends sit offscreen, invisible when grabbing
  var wireU = new Float32Array(N);      // displacement, device px
  var wireV = new Float32Array(N);      // vertical velocity, px/s
  var wireVtmp = new Float32Array(N);   // per-substep velocity snapshot (KV damping needs old v)
  var wireVprev = new Float32Array(N);  // frame-start velocity — acceleration = (v - vprev) / dt
  var wireA = new Float32Array(N);      // peak-hold acceleration envelope: instant attack, ~0.25s release — raw dv/dt only lasts 2-3 frames as a pulse sweeps by, too brief to read
  var wireData = new Float32Array(N * 2);
  var SPEED = 71.0;                       // pulse propagation, nodes/sec (~same visible px/s as the old 256-node screen-wide wire)
  var STIFF = SPEED * SPEED;              // wave-equation stiffness (c^2)
  var WDAMP = 0.6;                        // uniform velocity damping, /sec — overall settle (~6-8s)
  var VDAMP = 15.0;                       // Kelvin-Voigt (lap-of-velocity) damping — kills flick jitter, spares the pulse
  var GRABSG = 48.0;                      // grab gaussian half-width, nodes — very wide pluck (~1/4 of visible width sigma)
  var GRABR  = Math.ceil(GRABSG * 3);     // grab loop radius, nodes (±3 sigma)

  var wireTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, wireTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  var linFloat = gl.getExtension('OES_texture_float_linear');
  var wireFilter = linFloat ? gl.LINEAR : gl.NEAREST;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, wireFilter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, wireFilter);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, N, 1, 0, gl.RG, gl.FLOAT, wireData);

  function simWire(dt) {
    dt = Math.min(dt, 0.033);
    var steps = Math.max(1, Math.ceil(dt * SPEED / 0.8));   // Courant-safe substepping
    var h = dt / steps;
    wireVprev.set(wireV);
    var basePx = centerFrac * canvas.height;
    var gi = -1, targetDisp = 0;
    if (dragCur > 0.001) {
      gi = Math.round(Math.min(Math.max((gxCur / window.innerWidth + PAD) / EXT, 0), 1) * (N - 1));
      targetDisp = gyCur * pr - basePx;
    }
    for (var s = 0; s < steps; s++) {
      wireVtmp.set(wireV);
      for (var i = 1; i < N - 1; i++) {
        var lap  = wireU[i - 1] - 2.0 * wireU[i] + wireU[i + 1];
        var lapV = wireVtmp[i - 1] - 2.0 * wireVtmp[i] + wireVtmp[i + 1];
        wireV[i] += (STIFF * lap - WDAMP * wireVtmp[i] + VDAMP * lapV) * h;
      }
      for (var j = 1; j < N - 1; j++) wireU[j] += wireV[j] * h;
      wireU[0] = 0; wireU[N - 1] = 0; wireV[0] = 0; wireV[N - 1] = 0;
      if (gi >= 0) {
        var lo = Math.max(1, gi - GRABR), hi = Math.min(N - 2, gi + GRABR);
        for (var g = lo; g <= hi; g++) {
          var dn = (g - gi) / GRABSG;
          var bell = Math.exp(-0.5 * dn * dn);
          var wt = dragCur * bell;
          wireU[g] += (targetDisp * bell - wireU[g]) * wt;
          wireV[g] *= (1.0 - wt);
        }
      }
    }
    var accInv = 1.0 / dt;
    var rel = Math.min(1, dt * 4.0);
    for (var m = 0; m < N; m++) {
      var raw = (wireV[m] - wireVprev[m]) * accInv;
      var sm  = wireA[m];
      sm += (raw - sm) * (Math.abs(raw) > Math.abs(sm) ? 1.0 : rel);
      wireA[m] = sm;
      wireData[2 * m] = wireU[m];
      wireData[2 * m + 1] = sm;
    }
    gl.bindTexture(gl.TEXTURE_2D, wireTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, N, 1, gl.RG, gl.FLOAT, wireData);
  }

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

  /* Pointer: left-button drag grabs the wire. gx/gy is the raw grab point (the
     sim pins the nearest node to it); mxCur/myCur is a damped copy used only for
     the shader's grab-fuse glow. dragCur ramps 0→1 while held for a snappy grab,
     and back to 0 on release so the wire lets go. */
  var mxTgt = window.innerWidth * 0.5, myTgt = window.innerHeight * centerFrac;
  var mxCur = mxTgt, myCur = myTgt, focusCur = 0, focusTgt = 0;
  var gx = mxTgt, gy = myTgt, gxCur = gx, gyCur = gy, dragCur = 0, dragTgt = 0;
  var gxV = 0, gyV = 0;                   // grab-point spring velocity (px/s)
  if (knotDemo) { focusTgt = 1; dragTgt = 1; gx = window.innerWidth * 0.5; gy = window.innerHeight * (centerFrac - 0.12); }
  if (!reduced) {
    window.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      gx = mxTgt = e.clientX; gy = myTgt = e.clientY; gxCur = gx; focusTgt = 1; dragTgt = 1;
      // Start the grab target at the wire's current height under the cursor and
      // let it glide to the mouse — no instant yank on click.
      var gi0 = Math.round(Math.min(Math.max((gx / window.innerWidth + PAD) / EXT, 0), 1) * (N - 1));
      gyCur = (centerFrac * canvas.height + wireU[gi0]) / pr;
      gxV = 0; gyV = 0;                   // fresh grab starts from rest — spring accelerates in
    }, { passive: true });
    window.addEventListener('pointermove', function (e) {
      if (!(e.buttons & 1)) return;                     // follow only while LMB held
      gx = mxTgt = e.clientX; gy = myTgt = e.clientY; focusTgt = 1; dragTgt = 1;
    }, { passive: true });
    var release = function () { if (!knotDemo) { focusTgt = 0; dragTgt = 0; } };
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
  var wireLast = t0;
  function render(nowMs) {
    var cls = document.documentElement.classList;
    var now = nowMs || performance.now();
    var t = (now - t0) * 0.001;
    var dt = (now - wireLast) * 0.001; wireLast = now;

    mxCur += (mxTgt - mxCur) * 0.08;
    myCur += (myTgt - myCur) * 0.08;
    // Sim grab point — critically-damped spring toward the mouse (not an exp
    // lerp, whose approach starts at max speed and reads as a hickup on grab):
    // velocity builds from zero, peaks ~1.2s in, settles on the old ~3s scale.
    var gsW = 0.8, gdt = Math.min(dt, 0.05);
    gxV += ((gx - gxCur) * gsW * gsW - 2.0 * gsW * gxV) * gdt;
    gyV += ((gy - gyCur) * gsW * gsW - 2.0 * gsW * gyV) * gdt;
    gxCur += gxV * gdt;
    gyCur += gyV * gdt;
    focusCur += (focusTgt - focusCur) * 0.06;
    dragCur += (dragTgt - dragCur) * 0.1;

    if (!reduced && dt > 0) simWire(dt);

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, wireTex);
    gl.uniform1i(LOC.uWire, 0);
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
