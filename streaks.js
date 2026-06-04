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

      var fLen = s.state === 'parked' ? s.len * (0.91 + Math.random() * 0.18) : s.len;
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
      ctx.lineWidth   = s.wo;
      ctx.lineCap     = 'round';
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(s.x, s.y);
      ctx.stroke();
      ctx.shadowBlur  = 8;
      ctx.shadowColor = 'rgba(' + hot + ',1)';
      ctx.lineWidth   = s.wc;
      ctx.strokeStyle = 'rgba(' + hot + ',' + (a * 0.95).toFixed(3) + ')';
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
