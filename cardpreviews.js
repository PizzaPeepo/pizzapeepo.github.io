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

    // 8: Bouncink — bouncing blobs
    function (ctx, w, h, t, hover) {
      var blobs = [
        { bx: 0.3, by: 0.4, vx: 0.9, vy: 1.1, r: 9  },
        { bx: 0.6, by: 0.7, vx: -0.7, vy: 0.8, r: 7  },
        { bx: 0.5, by: 0.3, vx: 1.1, vy: -0.9, r: 6  },
        { bx: 0.7, by: 0.5, vx: -1.0, vy: 1.2, r: 5  },
      ];
      blobs.forEach(function (bl, i) {
        var speed = 0.45;
        var px = ((bl.bx + bl.vx * t * speed) % 1 + 1) % 1;
        var py = ((bl.by + bl.vy * t * speed) % 1 + 1) % 1;
        ctx.beginPath();
        ctx.arc(px * w, py * h, bl.r, 0, Math.PI * 2);
        ctx.fillStyle = i % 2 === 0 ? g(0.4) : c(0.35);
        ctx.fill();
      });
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

    requestAnimationFrame(frame);
  }

  frame();
}());
