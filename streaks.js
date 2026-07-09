/* streaks.js — randomised diagonal glowing streaks on card hover */
(function () {
  'use strict';

  var cvs = document.createElement('canvas');
  // z-index 0: above wavegrid (also 0, but later in DOM), below cards (z-index 1)
  cvs.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;pointer-events:none;';
  document.body.appendChild(cvs);
  var ctx = cvs.getContext('2d');

  function resize() { cvs.width = window.innerWidth; cvs.height = window.innerHeight; }
  resize();
  window.addEventListener('resize', resize);

  var DIR_X  = -0.819, DIR_Y = 0.574;

  var IN_DUR  = 0.85;
  var OUT_DUR = 0.50;
  var MARGIN  = 50;

  var streaks = [];
  var hovered = null;

  // ASCII glyph mode (index boot loader sets the flag before loading this
  // script): render streaks as a comet of Web437 density glyphs instead of the
  // smooth glow line, so they read as part of the lattice. COLS is exposed by
  // asciibg/main.js so the glyph pitch tracks the live lattice.
  var asciiMode  = window.__STREAKS_ASCII__ === true;
  // Sparkle glyphs, faint → bright. Star chars fall back to the system monospace
  // where Web437 lacks them — that's fine, they read as sparkles either way.
  var SPARKLE    = ['.', ',', "'", '`', '´', '°', ':', ';', '^', '/', '+', '*'];

  // Stable per-glyph pseudo-random (hash of index + streak seed) so the jitter
  // holds still across frames and the glyphs twinkle in place instead of buzzing.
  function rnd(i, seed) {
    var v = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453;
    return v - Math.floor(v);
  }

  function easeOutBack(t) {
    var c1 = 1.2, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }

  function makeStreak() {
    var tpx    = MARGIN + Math.random() * (cvs.width  - MARGIN * 2);
    var tpy    = MARGIN + Math.random() * (cvs.height - MARGIN * 2);
    var startX = cvs.width + 80 + Math.random() * 120;
    var slope  = DIR_Y / DIR_X;
    var startY = tpy - slope * (tpx - startX);
    return {
      x: startX, y: startY,
      startX: startX, startY: startY,
      targetX: tpx, targetY: tpy,
      exitX: 0, exitY: 0,
      len: 28 + Math.random() * 65,
      wo:  1.2 + Math.random() * 3.2,
      wc:  0.4 + Math.random() * 1.1,
      as:  0.35 + Math.random() * 0.65,
      hue: Math.floor(Math.random() * 360),
      seed: Math.random() * 100,
      t: 0, dur: IN_DUR,
      state: 'in',
      alpha: 0,
    };
  }

  function exitAll() {
    streaks.forEach(function (s) {
      if (s.state !== 'out') {
        s.startX = s.x; s.startY = s.y;
        s.exitX  = s.x + DIR_X * 2000;
        s.exitY  = s.y + DIR_Y * 2000;
        s.t      = 0; s.dur = OUT_DUR;
        s.state  = 'out';
      }
    });
  }

  document.querySelectorAll('.card').forEach(function (card) {
    card.addEventListener('mouseenter', function () {
      hovered = card;
      exitAll();
      var count = 8 + Math.floor(Math.random() * 8);
      for (var n = 0; n < count; n++) { streaks.push(makeStreak()); }
    });

    card.addEventListener('mouseleave', function () {
      hovered = null;
      exitAll();
    });
  });

  function cellPitch() {
    var cols = window.__ASCIIBG_COLS__ || 110;
    return Math.max(10, Math.min(28, cvs.width / cols));
  }

  // Scatter of twinkling sparkle glyphs along the streak. Each glyph gets a
  // stable seeded jitter (position, size, char) so it sits still, plus a smooth
  // per-glyph sine twinkle on brightness. Denser/brighter/bigger toward the head;
  // a stable random subset drops out so the trail stays sparse and sparkly.
  var SP = SPARKLE.length;
  function drawGlyphStreak(s, a, gold, hot, isViper) {
    var pitch = cellPitch();
    var step  = pitch * 0.45;                   // tight spacing → a line of glyphs
    var count = 6 + Math.round(rnd(0, s.seed) * 7);   // ~6–12 glyphs per trail
    var px = -DIR_Y, py = DIR_X;                // perpendicular unit
    var now = performance.now() * 0.006;
    var tailN = 1 + Math.floor(rnd(7.7, s.seed) * 3);   // last 1–3 glyphs flicker like fire
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (var i = 0; i < count; i++) {
      var r1 = rnd(i, s.seed), r2 = rnd(i, s.seed + 1.7), r3 = rnd(i, s.seed + 4.3);
      var f     = count > 1 ? i / (count - 1) : 0;
      var tailI = count - 1 - i;                // 0 = last glyph
      var flick = tailI < tailN;                // tail glyphs = flickering embers
      if (!flick && r3 < 0.08) continue;        // stable dropout (embers never drop)
      var base, tw, along, perp;
      if (flick) {
        // per-frame randomness → fire flicker; floor keeps the embers visible
        base  = a * (0.2 + tailI * 0.12);
        var ph = tailI * 1.7 + r3 * 6.283;
        tw    = 0.55 + 0.3 * Math.sin(now * 1.2 + ph) + (Math.random() - 0.5) * 0.08;
        along = Math.sin(now * 1.4 + ph) * step * 0.6;         // slow glide along the diagonal
        perp  = Math.sin(now * 1.1 + ph * 1.3) * pitch * 0.1;  // barely off the line
      } else {
        base  = a * Math.pow(1 - f, 1.3);
        tw    = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(now + r3 * 6.283));  // smooth twinkle
        along = (r1 - 0.5) * step * 0.6;
        perp  = (r2 - 0.5) * pitch * 0.15;      // tight to the streak line
      }
      var ga = Math.min(1, base * tw * 1.4);
      if (ga <= 0.02) continue;
      var gx = Math.round(s.x - DIR_X * step * i + DIR_X * along + px * perp);
      var gy = Math.round(s.y - DIR_Y * step * i + DIR_Y * along + py * perp);
      var bi = flick
        ? Math.floor(Math.random() * SP * 0.55)
        : Math.max(0, Math.min(SP - 1, Math.round((1 - f) * (SP - 1) * (0.55 + r2 * 0.7))));
      var size = Math.max(5, Math.round(pitch * (0.45 + (flick ? Math.random() : r1) * 0.3)));
      var col = isViper
        ? 'hsla(108,100%,' + Math.round(60 + tw * 25) + '%,'
        : 'rgba(' + (((flick && tw > 0.7) || tw > 0.82 || f < 0.3) ? hot : gold) + ',';
      ctx.font = size + "px 'Web437_ATI_9x16', monospace";
      ctx.shadowBlur  = 3 + ga * 8;
      ctx.shadowColor = col + '0.9)';
      ctx.fillStyle   = col + ga.toFixed(3) + ')';
      ctx.fillText(SPARKLE[bi], gx, gy);
    }
    ctx.restore();
  }

  var prevNow = performance.now();

  function frame(now) {
    var dt = Math.min((now - prevNow) * 0.001, 0.05);
    prevNow = now;
    ctx.clearRect(0, 0, cvs.width, cvs.height);

    var cls     = document.documentElement.classList;
    var isViper = cls.contains('viper');
    var isLight = cls.contains('light');
    var gold = isLight ? '200,85,5'  : '245,166,35';
    var hot  = isLight ? '220,100,0' : '255,235,130';

    for (var i = streaks.length - 1; i >= 0; i--) {
      var s = streaks[i];

      if (s.state === 'in') {
        s.t    += dt / s.dur;
        s.alpha = Math.min(1, s.alpha + dt * 4);
        var e   = easeOutBack(Math.min(s.t, 1));
        s.x     = s.startX + (s.targetX - s.startX) * e;
        s.y     = s.startY + (s.targetY - s.startY) * e;
        if (s.t >= 1) { s.x = s.targetX; s.y = s.targetY; s.state = 'parked'; }

      } else if (s.state === 'parked') {
        s.alpha = Math.min(1, s.alpha + dt * 9);

      } else { // 'out'
        s.t    += dt / s.dur;
        var eo  = easeOutBack(Math.min(s.t, 1));
        s.x     = s.startX + (s.exitX - s.startX) * eo;
        s.y     = s.startY + (s.exitY - s.startY) * eo;
        s.alpha = Math.max(0, 1 - s.t * 2.0);
        if (s.t >= 1 || s.alpha <= 0) { streaks.splice(i, 1); continue; }
      }

      var a = s.alpha * s.as;
      if (a <= 0) continue;

      if (asciiMode) { drawGlyphStreak(s, a, gold, hot, isViper); continue; }

      var fLen = s.state === 'parked' ? s.len * (0.91 + Math.random() * 0.18) : s.len;
      var tx   = s.x - DIR_X * fLen;
      var ty   = s.y - DIR_Y * fLen;

      // color prefixes — viper streaks each carry their own pastel hue
      var mainPre = 'rgba(' + gold + ',';
      var hotPre  = 'rgba(' + hot  + ',';
      if (isViper) {
        mainPre = 'hsla(108,100%,50%,';
        hotPre  = 'hsla(108,100%,68%,';
      }

      var grad = ctx.createLinearGradient(tx, ty, s.x, s.y);
      grad.addColorStop(0,    mainPre + '0)');
      grad.addColorStop(0.35, mainPre + (a * 0.20).toFixed(3) + ')');
      grad.addColorStop(0.75, mainPre + (a * 0.80).toFixed(3) + ')');
      grad.addColorStop(1,    hotPre  + a.toFixed(3) + ')');

      ctx.save();
      ctx.shadowBlur  = 30;
      ctx.shadowColor = mainPre + '1)';
      ctx.strokeStyle = grad;
      ctx.lineWidth   = s.wo;
      ctx.lineCap     = 'round';
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(s.x, s.y);
      ctx.stroke();
      ctx.shadowBlur  = 8;
      ctx.shadowColor = hotPre + '1)';
      ctx.lineWidth   = s.wc;
      ctx.strokeStyle = hotPre + (a * 0.95).toFixed(3) + ')';
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(s.x, s.y);
      ctx.stroke();
      ctx.restore();
    }

    if (document.hidden) return;
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) requestAnimationFrame(frame); });
}());
