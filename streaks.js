/* streaks.js — dual diagonal glowing streaks on card hover */
(function () {
  'use strict';

  var cvs = document.createElement('canvas');
  cvs.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:3;pointer-events:none;';
  document.body.appendChild(cvs);
  var ctx = cvs.getContext('2d');

  function resize() { cvs.width = window.innerWidth; cvs.height = window.innerHeight; }
  resize();
  window.addEventListener('resize', resize);

  // ~35° below horizontal
  var DIR_X  = -0.819, DIR_Y = 0.574;
  // Perpendicular (90° CW from DIR)
  var PERP_X = DIR_Y, PERP_Y = -DIR_X; // (0.574, 0.819)

  // IN_DUR matches border animation (0.85s cubic-bezier) so arrival = circuit complete
  var IN_DUR  = 0.85;
  var OUT_DUR = 0.50;

  // perp: offset perpendicular to DIR; extraX: additional rightward shift
  var CONFIGS = [
    { perp: +11, extraX:  0, len: 78, wo: 4.0, wc: 1.5, as: 1.00 }, // main/lower
    { perp: -11, extraX: 22, len: 46, wo: 2.2, wc: 0.8, as: 0.72 }, // upper, shifted right
  ];

  var streaks = [];
  var hovered = null;
  var cardMY  = 0.5;

  function easeOutBack(t) {
    var c1 = 1.2, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }

  function getParkX() {
    var grid = document.querySelector('.grid');
    if (!grid) return Math.max(20, cvs.width * 0.08);
    return Math.max(20, grid.getBoundingClientRect().left - 160);
  }

  function getParkY() {
    if (!hovered) return cvs.height * 0.5;
    var r = hovered.getBoundingClientRect();
    return r.top + r.height * 0.5 + (cardMY - 0.5) * 45;
  }

  function streakTarget(cfg, px, py) {
    return {
      x: px + PERP_X * cfg.perp + cfg.extraX,
      y: py + PERP_Y * cfg.perp,
    };
  }

  function makeStreak(idx, px, py) {
    var cfg    = CONFIGS[idx];
    var tgt    = streakTarget(cfg, px, py);
    var startX = cvs.width + 150;
    var slope  = DIR_Y / DIR_X;
    var startY = tgt.y - slope * (tgt.x - startX);
    return {
      x: startX, y: startY,
      startX: startX, startY: startY,
      targetX: tgt.x, targetY: tgt.y,
      exitX: 0, exitY: 0,
      cfg: cfg,
      t: 0, dur: IN_DUR,
      state: 'in',
      alpha: 0,
    };
  }

  document.querySelectorAll('.card').forEach(function (card) {
    card.addEventListener('mouseenter', function () {
      hovered = card;
      cardMY  = 0.5;
      // Exit any existing streaks, spawn fresh ones for the new card
      streaks.forEach(function (s) {
        if (s.state !== 'out') {
          s.startX = s.x; s.startY = s.y;
          s.exitX  = s.x + DIR_X * 2000;
          s.exitY  = s.y + DIR_Y * 2000;
          s.t      = 0; s.dur = OUT_DUR;
          s.state  = 'out';
        }
      });
      var px = getParkX(), py = getParkY();
      CONFIGS.forEach(function (cfg, idx) { streaks.push(makeStreak(idx, px, py)); });
    });

    card.addEventListener('mouseleave', function () {
      hovered = null;
      streaks.forEach(function (s) {
        if (s.state !== 'out') {
          s.startX = s.x; s.startY = s.y;
          s.exitX  = s.x + DIR_X * 2000;
          s.exitY  = s.y + DIR_Y * 2000;
          s.t      = 0; s.dur = OUT_DUR;
          s.state  = 'out';
        }
      });
    });

    card.addEventListener('mousemove', function (e) {
      if (hovered !== card) return;
      var r = card.getBoundingClientRect();
      cardMY = (e.clientY - r.top) / r.height;
      var px = getParkX(), py = getParkY();
      streaks.forEach(function (s, i) {
        if (s.state === 'parked' && CONFIGS[i]) {
          var tgt = streakTarget(CONFIGS[i], px, py);
          s.targetX = tgt.x; s.targetY = tgt.y;
        }
      });
    });
  });

  var prevNow = performance.now();

  function frame(now) {
    var dt = Math.min((now - prevNow) * 0.001, 0.05);
    prevNow = now;
    ctx.clearRect(0, 0, cvs.width, cvs.height);

    var isLight = document.documentElement.classList.contains('light');
    var gold = isLight ? '200,85,5'  : '245,166,35';
    var hot  = isLight ? '220,100,0' : '255,235,130';

    for (var i = streaks.length - 1; i >= 0; i--) {
      var s = streaks[i];

      if (s.state === 'in') {
        s.t    += dt / s.dur;
        s.alpha = Math.min(1, s.alpha + dt * 4); // fade in over ~0.25s
        var e   = easeOutBack(Math.min(s.t, 1));
        s.x     = s.startX + (s.targetX - s.startX) * e;
        s.y     = s.startY + (s.targetY - s.startY) * e;
        if (s.t >= 1) { s.x = s.targetX; s.y = s.targetY; s.state = 'parked'; }

      } else if (s.state === 'parked') {
        var lk = Math.min(1, dt * 8);
        s.x    += (s.targetX - s.x) * lk;
        s.y    += (s.targetY - s.y) * lk;
        s.alpha = Math.min(1, s.alpha + dt * 9);

      } else { // 'out' — easeOutBack: fast exit, tiny overshoot off-screen
        s.t    += dt / s.dur;
        var eo  = easeOutBack(Math.min(s.t, 1));
        s.x     = s.startX + (s.exitX - s.startX) * eo;
        s.y     = s.startY + (s.exitY - s.startY) * eo;
        s.alpha = Math.max(0, 1 - s.t * 2.0);
        if (s.t >= 1 || s.alpha <= 0) { streaks.splice(i, 1); continue; }
      }

      var cfg = s.cfg;
      var a   = s.alpha * cfg.as;
      if (a <= 0) continue;

      var fLen = s.state === 'parked' ? cfg.len * (0.91 + Math.random() * 0.18) : cfg.len;
      var tx   = s.x - DIR_X * fLen;
      var ty   = s.y - DIR_Y * fLen;

      var grad = ctx.createLinearGradient(tx, ty, s.x, s.y);
      grad.addColorStop(0,    'rgba(' + gold + ',0)');
      grad.addColorStop(0.35, 'rgba(' + gold + ',' + (a * 0.20).toFixed(3) + ')');
      grad.addColorStop(0.75, 'rgba(' + gold + ',' + (a * 0.80).toFixed(3) + ')');
      grad.addColorStop(1,    'rgba(' + hot  + ',' + a.toFixed(3) + ')');

      ctx.save();
      ctx.shadowBlur  = 30;
      ctx.shadowColor = 'rgba(' + gold + ',1)';
      ctx.strokeStyle = grad;
      ctx.lineWidth   = cfg.wo;
      ctx.lineCap     = 'round';
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(s.x, s.y);
      ctx.stroke();
      ctx.shadowBlur  = 8;
      ctx.shadowColor = 'rgba(' + hot + ',1)';
      ctx.lineWidth   = cfg.wc;
      ctx.strokeStyle = 'rgba(' + hot + ',' + (a * 0.95).toFixed(3) + ')';
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(s.x, s.y);
      ctx.stroke();
      ctx.restore();
    }

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}());
