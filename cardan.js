/* cardan.js — Cardan suspension / gyroscope gimbal, header decoration */
(function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var SIZE = 110;
  var R = [48, 35, 22]; // outer → inner ring radii

  var wrap = document.createElement('div');
  wrap.id   = 'cardan-wrap';
  wrap.style.cssText = [
    'position:absolute',
    'top:24px',
    'right:0',
    'width:' + SIZE + 'px',
    'height:' + SIZE + 'px',
    'pointer-events:none',
    'opacity:0',
    'transition:opacity 0.8s ease',
    'z-index:2',
  ].join(';');

  var header = document.querySelector('header');
  if (!header) return;
  header.style.position = 'relative'; // ensure positioning context
  header.appendChild(wrap);

  setTimeout(function () { wrap.style.opacity = '1'; }, 600);

  var svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 ' + SIZE + ' ' + SIZE);
  svg.setAttribute('width',  SIZE);
  svg.setAttribute('height', SIZE);
  svg.style.overflow = 'visible';
  wrap.appendChild(svg);

  var cx = SIZE / 2, cy = SIZE / 2;

  /* ring colors: outer warm dim → inner hot bright */
  var colors = ['rgba(245,166,35,0.25)', 'rgba(245,166,35,0.45)', 'rgba(253,216,122,0.75)'];
  var rings   = [];

  R.forEach(function (r, i) {
    var g = document.createElementNS(NS, 'g');

    var circle = document.createElementNS(NS, 'ellipse');
    circle.setAttribute('cx', cx);
    circle.setAttribute('cy', cy);
    circle.setAttribute('rx', r);
    circle.setAttribute('ry', r);
    circle.style.fill          = 'none';
    circle.style.stroke        = colors[i];
    circle.style.strokeWidth   = i === 2 ? '1.5' : '1';

    // pivot dots at 90° increments
    var pivots = document.createElementNS(NS, 'g');
    [0, 90, 180, 270].forEach(function (deg) {
      if (deg % 180 !== 0) return; // only show axis pivots
      var dot = document.createElementNS(NS, 'circle');
      dot.setAttribute('cx', cx + r * Math.cos(deg * Math.PI / 180));
      dot.setAttribute('cy', cy + r * Math.sin(deg * Math.PI / 180));
      dot.setAttribute('r',  i === 2 ? '1.8' : '1.4');
      dot.style.fill = colors[i].replace(/[\d.]+\)$/, '0.9)');
      pivots.appendChild(dot);
    });

    g.appendChild(circle);
    g.appendChild(pivots);
    svg.appendChild(g);
    rings.push({ g: g, circle: circle, baseRotZ: i * 60, tiltX: 0, tiltY: 0, velX: 0, velY: 0, r: r });
  });

  // Spin lines (axis indicators)
  rings.forEach(function (ring, i) {
    var line = document.createElementNS(NS, 'line');
    var r = ring.r;
    line.setAttribute('x1', cx - r);
    line.setAttribute('y1', cy);
    line.setAttribute('x2', cx + r);
    line.setAttribute('y2', cy);
    line.style.stroke      = colors[i].replace(/[\d.]+\)$/, '0.18)');
    line.style.strokeWidth = '0.5';
    ring.g.appendChild(line);
  });

  var targetMX = 0, targetMY = 0;
  var mouseMX  = 0, mouseMY  = 0;

  document.addEventListener('mousemove', function (e) {
    mouseMX = (e.clientX / window.innerWidth  - 0.5) * 2;
    mouseMY = (e.clientY / window.innerHeight - 0.5) * 2;
  });

  var t0 = performance.now();

  function frame(now) {
    var t = (now - t0) * 0.001;
    targetMX += (mouseMX - targetMX) * 0.04;
    targetMY += (mouseMY - targetMY) * 0.04;

    rings.forEach(function (ring, i) {
      var depth   = i + 1;
      var tiltX   = targetMY * 28 * (1 - i * 0.2);
      var tiltY   = targetMX * 28 * (1 - i * 0.2);
      var autoSpin = t * (0.18 + i * 0.09);

      // Squish ellipse to simulate 3D tilt
      var tiltMag = Math.sqrt(tiltX * tiltX + tiltY * tiltY);
      var squish  = Math.cos(tiltMag * Math.PI / 180);
      var r       = ring.r;

      ring.circle.setAttribute('ry', Math.abs(r * squish));

      var rotZ = ring.baseRotZ + autoSpin * (i % 2 === 0 ? 1 : -1) * 18;
      ring.g.setAttribute('transform',
        'rotate(' + rotZ.toFixed(2) + ',' + cx + ',' + cy + ')'
      );
    });

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}());
