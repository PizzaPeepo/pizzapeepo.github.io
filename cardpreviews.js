/* cardpreviews.js — animated canvas micro-previews on each card */
(function () {
  'use strict';

  var GOLD   = 'rgba(245,166,35,';
  var CORAL  = 'rgba(255,107,71,';
  var LITE_G = 'rgba(160,80,0,';
  var LITE_C = 'rgba(180,50,20,';

  function isLight() {
    return document.documentElement.classList.contains('light');
  }
  function g(a) { return (isLight() ? LITE_G : GOLD) + a + ')'; }
  function c(a) { return (isLight() ? LITE_C : CORAL) + a + ')'; }

  /* ── Per-card draw functions ── */
  var DEMOS = [
    // 0: Gravity Simulation — orbiting particles
    function (ctx, w, h, t, hover) {
      var cx = w * 0.5, cy = h * 0.5;
      var N = 7;
      for (var i = 0; i < N; i++) {
        var ang = t * (0.4 + i * 0.11) + (i / N) * Math.PI * 2;
        var r   = 16 + i * 5.5;
        var px  = cx + Math.cos(ang) * r;
        var py  = cy + Math.sin(ang) * r * 0.55;
        var sz  = 1.8 + (N - i) * 0.5;
        ctx.beginPath();
        ctx.arc(px, py, sz, 0, Math.PI * 2);
        ctx.fillStyle = i % 2 === 0 ? g(0.55) : c(0.45);
        ctx.fill();
      }
      // center star
      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, Math.PI * 2);
      ctx.fillStyle = g(0.8);
      ctx.fill();
    },

    // 1: Raycaster — radiating lines from center point
    function (ctx, w, h, t, hover) {
      var ox = w * 0.35, oy = h * 0.6;
      var RAYS = 14;
      for (var i = 0; i < RAYS; i++) {
        var ang = (i / RAYS) * Math.PI * 2 + t * 0.3;
        var len = 26 + Math.sin(t * 1.2 + i) * 8;
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.lineTo(ox + Math.cos(ang) * len, oy + Math.sin(ang) * len);
        var alpha = 0.15 + 0.3 * Math.max(0, Math.cos(ang - t * 0.3));
        ctx.strokeStyle = g(alpha);
        ctx.lineWidth   = 0.8;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(ox, oy, 3, 0, Math.PI * 2);
      ctx.fillStyle = c(0.7);
      ctx.fill();
    },

    // 2: Quadtree — subdividing rectangles
    function (ctx, w, h, t, hover) {
      var phase = (Math.sin(t * 0.4) * 0.5 + 0.5);
      var depth = Math.floor(phase * 3) + 1;
      function drawCell(x, y, cw, ch, d) {
        if (d === 0) {
          ctx.strokeStyle = g(0.18 + d * 0.05);
          ctx.lineWidth   = 0.5;
          ctx.strokeRect(x + 1, y + 1, cw - 2, ch - 2);
          return;
        }
        var hw = cw / 2, hh = ch / 2;
        drawCell(x,      y,      hw, hh, d - 1);
        drawCell(x + hw, y,      hw, hh, d - 1);
        drawCell(x,      y + hh, hw, hh, d - 1);
        drawCell(x + hw, y + hh, hw, hh, d - 1);
      }
      drawCell(w * 0.15, h * 0.15, w * 0.7, h * 0.7, depth);
    },

    // 3: Lissajous — parametric curve
    function (ctx, w, h, t, hover) {
      var cx = w * 0.5, cy = h * 0.5;
      var a = 3, b = 2, delta = t * 0.25;
      ctx.beginPath();
      for (var i = 0; i <= 360; i++) {
        var th = (i / 360) * Math.PI * 2;
        var px = cx + Math.sin(a * th + delta) * w * 0.3;
        var py = cy + Math.sin(b * th) * h * 0.3;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = g(0.5);
      ctx.lineWidth   = 1.2;
      ctx.stroke();
    },

    // 4: Rotating Lissajous — same but phase evolves, slightly different freq
    function (ctx, w, h, t, hover) {
      var cx = w * 0.5, cy = h * 0.5;
      var a = 4, b = 3, delta = t * 0.4;
      ctx.beginPath();
      for (var i = 0; i <= 360; i++) {
        var th = (i / 360) * Math.PI * 2;
        var px = cx + Math.sin(a * th + delta) * w * 0.3;
        var py = cy + Math.sin(b * th) * h * 0.3;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = c(0.5);
      ctx.lineWidth   = 1.2;
      ctx.stroke();
    },

    // 5: Phaseshift — two sine waves + superposition
    function (ctx, w, h, t, hover) {
      var cy = h * 0.5;
      var phase = t * 0.8;
      [0, phase, phase * 0.5].forEach(function (ph, i) {
        ctx.beginPath();
        for (var x = 0; x <= w; x += 2) {
          var y = cy + Math.sin((x / w) * Math.PI * 4 + ph) * (h * 0.18) * (i === 2 ? 1.4 : 0.7);
          if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        var col = i === 2 ? g(0.6) : (i === 0 ? g(0.25) : c(0.25));
        ctx.strokeStyle = col;
        ctx.lineWidth   = i === 2 ? 1.5 : 0.8;
        ctx.stroke();
      });
    },

    // 6: Circular Motion — dot on circle + axis projections
    function (ctx, w, h, t, hover) {
      var cx = w * 0.5, cy = h * 0.5;
      var R2 = Math.min(w, h) * 0.28;
      var ang = t * 0.9;
      var px  = cx + Math.cos(ang) * R2;
      var py  = cy + Math.sin(ang) * R2;

      ctx.beginPath();
      ctx.arc(cx, cy, R2, 0, Math.PI * 2);
      ctx.strokeStyle = g(0.2);
      ctx.lineWidth   = 0.8;
      ctx.stroke();

      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, cy);
      ctx.strokeStyle = c(0.3); ctx.lineWidth = 0.8; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(cx, py);
      ctx.strokeStyle = g(0.3); ctx.lineWidth = 0.8; ctx.stroke();

      ctx.beginPath();
      ctx.arc(px, py, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = g(0.85);
      ctx.fill();
    },

    // 7: Rotating Squares — nested squares rotating
    function (ctx, w, h, t, hover) {
      var cx = w * 0.5, cy = h * 0.5;
      var N = 6;
      for (var i = 0; i < N; i++) {
        var r   = 12 + i * 7;
        var ang = t * (0.25 + i * 0.06) * (i % 2 === 0 ? 1 : -1);
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(ang);
        ctx.strokeStyle = i % 2 === 0 ? g(0.3 + i * 0.04) : c(0.2 + i * 0.03);
        ctx.lineWidth   = 0.8;
        ctx.strokeRect(-r, -r, r * 2, r * 2);
        ctx.restore();
      }
    },

    // 8: DVD Bounce — bouncing logo rect
    function (ctx, w, h, t, hover) {
      var lw = 36, lh = 20;
      var speed = 28;
      // bounce position from time
      var px = speed * t % (2 * (w - lw));
      if (px > w - lw) px = 2 * (w - lw) - px;
      var py = speed * 0.7 * t % (2 * (h - lh));
      if (py > h - lh) py = 2 * (h - lh) - py;
      // color cycles on each "bounce period"
      var hue = (t * 40) % 360;
      ctx.save();
      ctx.strokeStyle = 'hsla(' + hue + ',80%,60%,0.9)';
      ctx.lineWidth = 2;
      ctx.strokeRect(px, py, lw, lh);
      // small dot in center
      ctx.beginPath();
      ctx.arc(px + lw / 2, py + lh / 2, 2, 0, Math.PI * 2);
      ctx.fillStyle = 'hsla(' + hue + ',80%,70%,0.9)';
      ctx.fill();
      ctx.restore();
    },

    // 9: Gravity GPU — galaxy swirl (wide card, different feel)
    function (ctx, w, h, t, hover) {
      var cx = w * 0.5, cy = h * 0.5;
      var N = 55;
      for (var i = 0; i < N; i++) {
        var frac = i / N;
        var arm  = Math.floor(i / (N / 3));
        var r    = 8 + frac * Math.min(cx, cy) * 0.82;
        var ang  = frac * Math.PI * 5 + arm * (Math.PI * 2 / 3) + t * (0.15 + frac * 0.12);
        var jx   = (Math.random() - 0.5) * 3;
        var jy   = (Math.random() - 0.5) * 3;
        var px   = cx + Math.cos(ang) * r + jx;
        var py   = cy + Math.sin(ang) * r * 0.5 + jy;
        var sz   = 1.2 + (1 - frac) * 1.5;
        ctx.beginPath();
        ctx.arc(px, py, sz, 0, Math.PI * 2);
        ctx.fillStyle = frac < 0.4 ? g(0.7 - frac * 0.4) : c(0.5 - frac * 0.2);
        ctx.fill();
      }
    },

    // 10: Flocking — little triangles drifting in a loose flock
    function (ctx, w, h, t, hover) {
      var N = 12;
      var cx = w * 0.5 + Math.cos(t * 0.3) * w * 0.18;
      var cy = h * 0.5 + Math.sin(t * 0.4) * h * 0.18;
      for (var i = 0; i < N; i++) {
        var ph = (i / N) * Math.PI * 2;
        var bx = cx + Math.cos(ph + t * 0.6) * (10 + (i % 4) * 6);
        var by = cy + Math.sin(ph * 1.3 + t * 0.6) * (8 + (i % 3) * 6);
        var dir = ph + t * 0.6 + Math.PI / 2;
        var dx = Math.cos(dir), dy = Math.sin(dir), sz = 4;
        ctx.beginPath();
        ctx.moveTo(bx + dx * sz, by + dy * sz);
        ctx.lineTo(bx - dy * sz * 0.5 - dx * sz * 0.6, by + dx * sz * 0.5 - dy * sz * 0.6);
        ctx.lineTo(bx + dy * sz * 0.5 - dx * sz * 0.6, by - dx * sz * 0.5 - dy * sz * 0.6);
        ctx.closePath();
        ctx.fillStyle = i % 2 === 0 ? g(0.6) : c(0.5);
        ctx.fill();
      }
    },

    // 11: Double Pendulum — swinging arms with a trailing arc
    function (ctx, w, h, t, hover) {
      var ox = w * 0.5, oy = h * 0.38;
      var L1 = Math.min(w, h) * 0.22, L2 = Math.min(w, h) * 0.2;
      var a1 = Math.sin(t * 1.1) * 1.4 + Math.sin(t * 0.43) * 0.6;
      var a2 = Math.sin(t * 1.7 + 1) * 1.8;
      var x1 = ox + Math.sin(a1) * L1, y1 = oy + Math.cos(a1) * L1;
      var x2 = x1 + Math.sin(a2) * L2, y2 = y1 + Math.cos(a2) * L2;
      // trail arc
      ctx.beginPath();
      for (var k = 0; k <= 30; k++) {
        var tt = t - k * 0.05;
        var b1 = Math.sin(tt * 1.1) * 1.4 + Math.sin(tt * 0.43) * 0.6;
        var b2 = Math.sin(tt * 1.7 + 1) * 1.8;
        var px = ox + Math.sin(b1) * L1 + Math.sin(b2) * L2;
        var py = oy + Math.cos(b1) * L1 + Math.cos(b2) * L2;
        if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = c(0.4); ctx.lineWidth = 1; ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ox, oy); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2);
      ctx.strokeStyle = g(0.5); ctx.lineWidth = 1.4; ctx.stroke();
      [[x1, y1, 3], [x2, y2, 3.5]].forEach(function (b) {
        ctx.beginPath(); ctx.arc(b[0], b[1], b[2], 0, Math.PI * 2);
        ctx.fillStyle = g(0.85); ctx.fill();
      });
    },
    // 12: Flow Field — particles streaming along a noise field
    function (ctx, w, h, t, hover) {
      var N = 26;
      for (var i = 0; i < N; i++) {
        var sy = (i / N) * h;
        var x0 = ((t * 30 + i * 53) % (w + 40)) - 20;
        ctx.beginPath();
        for (var s = 0; s < 10; s++) {
          var x = x0 + s * 4;
          var y = sy + Math.sin(x * 0.04 + t * 0.8 + i) * 8 + Math.cos(x * 0.02 - t) * 5;
          if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = i % 3 === 0 ? c(0.4) : g(0.35);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    },

    // 13: Game of Life — blinking cell grid
    function (ctx, w, h, t, hover) {
      var cell = 9, cols = Math.floor(w / cell), rows = Math.floor(h / cell);
      var gen = Math.floor(t * 3);
      for (var y = 0; y < rows; y++) {
        for (var x = 0; x < cols; x++) {
          var seed = (x * 73856093) ^ (y * 19349663) ^ (gen * 83492791);
          if (((seed >>> 4) & 7) < 3) {
            ctx.fillStyle = ((x + y) & 1) ? g(0.55) : c(0.4);
            ctx.fillRect(x * cell + 1, y * cell + 1, cell - 2, cell - 2);
          }
        }
      }
    },

    // 14: Wave Interference — two interfering source rings
    function (ctx, w, h, t, hover) {
      var srcs = [[w * 0.35, h * 0.5], [w * 0.65, h * 0.5]];
      ctx.lineWidth = 1;
      for (var s = 0; s < srcs.length; s++) {
        for (var r = 0; r < 5; r++) {
          var rad = ((t * 18 + r * 16) % 80);
          ctx.beginPath();
          ctx.arc(srcs[s][0], srcs[s][1], rad, 0, Math.PI * 2);
          var a = Math.max(0, 0.4 * (1 - rad / 80));
          ctx.strokeStyle = s === 0 ? g(a) : c(a);
          ctx.stroke();
        }
      }
    },

    // 15: Reaction-Diffusion — growing organic blobs
    function (ctx, w, h, t, hover) {
      var cx = w * 0.5, cy = h * 0.5;
      for (var i = 0; i < 5; i++) {
        var a = i / 5 * Math.PI * 2;
        var rr = 10 + i * 4 + Math.sin(t * 0.8 + i) * 6;
        var bx = cx + Math.cos(a + t * 0.2) * (8 + i * 3);
        var by = cy + Math.sin(a + t * 0.2) * (6 + i * 2);
        ctx.beginPath();
        ctx.arc(bx, by, rr, 0, Math.PI * 2);
        ctx.fillStyle = i % 2 ? c(0.16) : g(0.16);
        ctx.fill();
      }
    },

    // 16: Voronoi — moving sites with cell edges
    function (ctx, w, h, t, hover) {
      var pts = [];
      for (var i = 0; i < 7; i++) {
        pts.push([
          w * (0.2 + 0.6 * (0.5 + 0.5 * Math.sin(t * 0.5 + i * 1.7))),
          h * (0.2 + 0.6 * (0.5 + 0.5 * Math.cos(t * 0.4 + i * 2.3))),
        ]);
      }
      // crude cell tint by sampling a coarse grid
      var step = 7;
      for (var y = 0; y < h; y += step) {
        for (var x = 0; x < w; x += step) {
          var best = 0, bd = 1e9;
          for (var k = 0; k < pts.length; k++) {
            var dx = x - pts[k][0], dy = y - pts[k][1], d = dx * dx + dy * dy;
            if (d < bd) { bd = d; best = k; }
          }
          ctx.fillStyle = best % 2 ? g(0.12) : c(0.1);
          ctx.fillRect(x, y, step, step);
        }
      }
      for (var p = 0; p < pts.length; p++) {
        ctx.beginPath();
        ctx.arc(pts[p][0], pts[p][1], 2, 0, Math.PI * 2);
        ctx.fillStyle = g(0.8); ctx.fill();
      }
    },

    // 17: Slime Mould — branching filament network
    function (ctx, w, h, t, hover) {
      var cx = w * 0.5, cy = h * 0.5;
      ctx.lineWidth = 1;
      for (var i = 0; i < 12; i++) {
        var a = (i / 12) * Math.PI * 2 + t * 0.15;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        var x = cx, y = cy, ang = a;
        for (var s = 0; s < 8; s++) {
          ang += Math.sin(t + i + s) * 0.4;
          x += Math.cos(ang) * 5;
          y += Math.sin(ang) * 5;
          ctx.lineTo(x, y);
        }
        ctx.strokeStyle = i % 2 ? g(0.4) : c(0.3);
        ctx.stroke();
      }
    },
    // 18: Cloth — sagging hanging net
    function (ctx, w, h, t, hover) {
      var cols = 8, rows = 6, sx = w / (cols + 1), top = h * 0.18;
      function sag(col, row) {
        var x = sx * (col + 1);
        var droop = Math.sin((col / cols) * Math.PI) * (row / rows) * h * 0.28;
        var sway = Math.sin(t * 1.2 + row * 0.5) * 3 * (row / rows);
        var y = top + row * (h * 0.62 / rows) + droop;
        return [x + sway, y];
      }
      ctx.lineWidth = 1;
      ctx.strokeStyle = g(0.4);
      for (var row = 0; row <= rows; row++) {
        for (var col = 0; col <= cols; col++) {
          var p = sag(col, row);
          if (col < cols) { var q = sag(col + 1, row); ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke(); }
          if (row < rows) { var u = sag(col, row + 1); ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.strokeStyle = col % 2 ? c(0.3) : g(0.35); ctx.lineTo(u[0], u[1]); ctx.stroke(); ctx.strokeStyle = g(0.4); }
        }
      }
    },

    // 19: Maze — grid with a snaking path
    function (ctx, w, h, t, hover) {
      var cell = 10, cols = Math.floor(w / cell), rows = Math.floor(h / cell);
      ctx.strokeStyle = g(0.22); ctx.lineWidth = 0.5;
      for (var x = 0; x <= cols; x++) { ctx.beginPath(); ctx.moveTo(x * cell, 0); ctx.lineTo(x * cell, rows * cell); ctx.stroke(); }
      for (var y = 0; y <= rows; y++) { ctx.beginPath(); ctx.moveTo(0, y * cell); ctx.lineTo(cols * cell, y * cell); ctx.stroke(); }
      var steps = Math.floor((Math.sin(t * 0.5) * 0.5 + 0.5) * (cols + rows));
      ctx.strokeStyle = c(0.7); ctx.lineWidth = 2.5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(cell / 2, cell / 2);
      var cx = 0, cy = 0;
      for (var i = 0; i < steps; i++) {
        if (i % 2 === 0 && cx < cols - 1) cx++; else if (cy < rows - 1) cy++;
        ctx.lineTo(cx * cell + cell / 2, cy * cell + cell / 2);
      }
      ctx.stroke();
    },

    // 20: Fourier — nested rotating circles tracing a tip
    function (ctx, w, h, t, hover) {
      var cx = w * 0.5, cy = h * 0.5;
      var circ = [[22, 1, 0], [11, -2, 1.2], [6, 3, 2.4], [3.5, -5, 0.5]];
      var x = cx, y = cy;
      ctx.lineWidth = 1;
      for (var i = 0; i < circ.length; i++) {
        var r = circ[i][0], f = circ[i][1], ph = circ[i][2];
        ctx.strokeStyle = g(0.25);
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
        var nx = x + Math.cos(f * t + ph) * r;
        var ny = y + Math.sin(f * t + ph) * r;
        ctx.strokeStyle = c(0.5);
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(nx, ny); ctx.stroke();
        x = nx; y = ny;
      }
      ctx.fillStyle = g(0.9);
      ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill();
    },
    // 21: Pong Wars — two territories with balls bouncing along a wobbling frontier
    function (ctx, w, h, t, hover) {
      var cols = 11, rows = 8, cw = w / cols, ch = h / rows;
      for (var y = 0; y < rows; y++) {
        var front = cols * (0.5 + 0.16 * Math.sin(t * 1.1 + y * 0.7));
        for (var x = 0; x < cols; x++) {
          ctx.fillStyle = x < front ? g(0.32) : c(0.26);
          ctx.fillRect(x * cw + 0.5, y * ch + 0.5, cw - 1, ch - 1);
        }
      }
      var bx1 = w * (0.5 + 0.34 * Math.sin(t * 1.7));
      var by1 = h * (0.5 + 0.40 * Math.sin(t * 2.3 + 1));
      var bx2 = w * (0.5 + 0.34 * Math.sin(t * 1.9 + 2));
      var by2 = h * (0.5 + 0.40 * Math.cos(t * 2.1));
      ctx.beginPath(); ctx.arc(bx1, by1, 3.2, 0, Math.PI * 2); ctx.fillStyle = c(0.85); ctx.fill();
      ctx.beginPath(); ctx.arc(bx2, by2, 3.2, 0, Math.PI * 2); ctx.fillStyle = g(0.85); ctx.fill();
    },
    // 22: Fluid Simulation — dye streaming past a cylinder, shedding vortices
    function (ctx, w, h, t, hover) {
      var cx = w * 0.6, cy = h * 0.5, R = Math.min(w, h) * 0.13;
      for (var i = 0; i < 7; i++) {
        var y0 = h * (i + 0.5) / 7;
        ctx.beginPath();
        for (var x = 0; x <= w; x += 4) {
          var dx = (x - cx) / w;
          var wob = Math.sin(t * 1.6 + i * 0.9 + x * 0.05) * 5;
          var shed = x > cx ? Math.sin(t * 3 + i - x * 0.04) * 9 * Math.exp(-dx * dx * 5) : 0;
          var dy = y0 - cy;
          var around = (dy / (Math.abs(dy) + 1)) * R * 0.7 * Math.exp(-Math.pow((x - cx) / R, 2));
          ctx.lineTo(x, y0 + wob + shed + around);
        }
        ctx.strokeStyle = i % 2 ? c(0.5) : g(0.5);
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fillStyle = g(0.18); ctx.fill();
      ctx.strokeStyle = g(0.55); ctx.lineWidth = 1.5; ctx.stroke();
    },
  ];

  /* ── Attach a canvas to each card ── */
  var cards    = Array.from(document.querySelectorAll('.card'));
  var contexts = [];
  var hovState = [];

  // Map card href to demo index
  var ORDER = [
    'GravitySimulation',
    'Raycaster',
    'Quadtree',
    'Lissajous/',
    'LissajousRotating',
    'PhaseshiftDemo1',
    'CircularMotion',
    'RotatingSquares',
    'Bouncink',
    'GravitySimulationGPU',
    'Boids',
    'DoublePendulum',
    'FlowField',
    'GameOfLife',
    'Waves',
    'ReactionDiffusion',
    'Voronoi',
    'Physarum',
    'Cloth',
    'Maze',
    'Fourier',
    'PongWars',
    'FluidSimulation',
  ];

  cards.forEach(function (card, i) {
    var href    = card.getAttribute('href') || '';
    var demoIdx = ORDER.findIndex(function (k) { return href.includes(k); });
    if (demoIdx < 0) demoIdx = i % DEMOS.length;

    var cvs = document.createElement('canvas');
    cvs.style.cssText = [
      'position:absolute',
      'inset:0',
      'width:100%',
      'height:100%',
      'pointer-events:none',
      'border-radius:15px',
      'opacity:0',
      'transition:opacity 0.4s ease',
      'z-index:0',
    ].join(';');
    card.style.position = 'relative';
    card.insertBefore(cvs, card.firstChild);

    contexts.push({ cvs: cvs, ctx: cvs.getContext('2d'), demoIdx: demoIdx, hov: false });
    hovState.push(false);

    card.addEventListener('mouseenter', function () { contexts[i].hov = true; });
    card.addEventListener('mouseleave', function () { contexts[i].hov = false; });
  });

  function resizeAll() {
    contexts.forEach(function (c) {
      var r = c.cvs.getBoundingClientRect();
      if (r.width  > 0) c.cvs.width  = r.width  * window.devicePixelRatio;
      if (r.height > 0) c.cvs.height = r.height * window.devicePixelRatio;
    });
  }
  resizeAll();
  window.addEventListener('resize', resizeAll);

  var t0 = performance.now();

  function frame() {
    var t    = (performance.now() - t0) * 0.001;
    var dpr  = window.devicePixelRatio || 1;

    contexts.forEach(function (c) {
      var cvs = c.cvs;
      var ctx = c.ctx;
      var w   = cvs.width  / dpr;
      var h   = cvs.height / dpr;
      if (w < 1 || h < 1) return;

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);

      if (c.hov) {
        var fn = DEMOS[c.demoIdx] || DEMOS[0];
        fn(ctx, w, h, t, true);
      }

      ctx.restore();
      cvs.style.opacity = c.hov ? '1' : '0';
    });

    if (document.hidden) return;
    requestAnimationFrame(frame);
  }

  frame();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) requestAnimationFrame(frame); });
}());
