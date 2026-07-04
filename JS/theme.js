/* theme.js — shared theme toggle for Canvas Lab demo pages */
(function () {
  var root  = document.documentElement;

  // Cursor spotlight on HUD group headers (mirrors the index card hover)
  document.addEventListener('pointermove', function (e) {
    if (!e.target || !e.target.closest) return;
    var s = e.target.closest('.hud-details > summary');
    if (!s) return;
    var r = s.getBoundingClientRect();
    s.style.setProperty('--mx', (100 * (e.clientX - r.left) / r.width).toFixed(1) + '%');
    s.style.setProperty('--my', (100 * (e.clientY - r.top) / r.height).toFixed(1) + '%');
  });

  // LED border comet on HUD group headers (mirrors the index card border trace):
  // dim trail + bright head + blurred glow drawn as dashed SVG rect strokes.
  // Rect strokes start at the top-left corner and run clockwise, so the comet
  // finishes its lap coming up the left (accent) edge.
  var NS = 'http://www.w3.org/2000/svg';

  function makeSummaryLED(summary, idx) {
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'summary-led-svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('preserveAspectRatio', 'none');

    var defs = document.createElementNS(NS, 'defs');
    var gid  = 'sled' + idx;

    var grad = document.createElementNS(NS, 'linearGradient');
    grad.id = gid;
    grad.setAttribute('x1', '0%'); grad.setAttribute('y1', '0%');
    grad.setAttribute('x2', '100%'); grad.setAttribute('y2', '100%');
    [['0%','#fdd87a'], ['55%','#f5a623'], ['100%','#ff6b47']].forEach(function (s) {
      var stop = document.createElementNS(NS, 'stop');
      stop.setAttribute('offset', s[0]);
      stop.setAttribute('stop-color', s[1]);
      grad.appendChild(stop);
    });
    defs.appendChild(grad);

    // Viper: pastel rainbow comet — gradient slowly rotates via SMIL
    var gradV = document.createElementNS(NS, 'linearGradient');
    gradV.id = gid + 'v';
    gradV.setAttribute('x1', '0%'); gradV.setAttribute('y1', '0%');
    gradV.setAttribute('x2', '100%'); gradV.setAttribute('y2', '100%');
    [['0%','#ff3366'], ['20%','#ffa733'], ['40%','#f8ff33'],
     ['60%','#33ff70'], ['80%','#33bbff'], ['100%','#9933ff']].forEach(function (s) {
      var stop = document.createElementNS(NS, 'stop');
      stop.setAttribute('offset', s[0]);
      stop.setAttribute('stop-color', s[1]);
      gradV.appendChild(stop);
    });
    var spin = document.createElementNS(NS, 'animateTransform');
    spin.setAttribute('attributeName', 'gradientTransform');
    spin.setAttribute('type', 'rotate');
    spin.setAttribute('from', '0 0.5 0.5');
    spin.setAttribute('to', '360 0.5 0.5');
    spin.setAttribute('dur', '6s');
    spin.setAttribute('repeatCount', 'indefinite');
    gradV.appendChild(spin);
    defs.appendChild(gradV);

    svg.appendChild(defs);

    function makeRect(sw, blurPx, baseOp) {
      var r = document.createElementNS(NS, 'rect');
      r.setAttribute('rx', '5');
      r.setAttribute('pathLength', '1000');
      r.style.fill = 'none';
      r.style.stroke = 'url(#' + gid + ')';
      r.style.strokeWidth = sw;
      r.style.strokeLinecap = 'round';
      r.style.strokeDashoffset = '1000';
      r.style.opacity = '0';
      if (blurPx) r.style.filter = 'blur(' + blurPx + 'px)';
      r._op = String(baseOp);
      return r;
    }

    // Trail: dim full-border that draws progressively behind the comet
    var trailRect = makeRect('1', 0, 0.35);
    trailRect.style.strokeDasharray = '1000 1000';

    // Comet head: bright segment sized to the left edge (dasharray set in resize)
    var headRect = makeRect('1.5', 0, 1);

    // Comet glow: blurred halo around the head
    var headGlow = makeRect('5', 3, 0.5);

    var headLen = 70; // normalized path units; recomputed in resize()

    svg.appendChild(trailRect);
    svg.appendChild(headGlow);
    svg.appendChild(headRect);
    summary.appendChild(svg);

    function resize() {
      var w = summary.clientWidth, h = summary.clientHeight;
      svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
      [trailRect, headRect, headGlow].forEach(function (r) {
        r.setAttribute('x', '1');
        r.setAttribute('y', '1');
        r.setAttribute('width',  w - 2);
        r.setAttribute('height', h - 2);
      });
      // size the comet to the left edge: its share of the rounded-rect perimeter,
      // in the normalized pathLength=1000 units
      var rw = w - 2, rh = h - 2, rx = 5;
      var perim = 2 * (rw + rh) - 8 * rx + 2 * Math.PI * rx;
      headLen = Math.max(20, Math.round(1000 * rh / perim));
      [headRect, headGlow].forEach(function (r) {
        r.style.strokeDasharray = headLen + ' ' + (1000 - headLen);
      });
    }
    resize();
    new ResizeObserver(resize).observe(summary);

    var leaveTimer = null;

    summary.addEventListener('mouseenter', function () {
      if (leaveTimer) { clearTimeout(leaveTimer); leaveTimer = null; }
      var useId = root.classList.contains('viper') ? gid + 'v' : gid;
      [trailRect, headRect, headGlow].forEach(function (r) {
        r.style.stroke = 'url(#' + useId + ')';
        r.style.transition = 'none';
        r.style.strokeDashoffset = '1000';
        r.style.opacity = '0';
      });
      void summary.offsetWidth;
      var ease = '0.85s cubic-bezier(0.05, 0.72, 0.08, 1.0)';
      [trailRect, headRect, headGlow].forEach(function (r) {
        r.style.transition = 'stroke-dashoffset ' + ease + ', opacity 0.12s ease';
        r.style.opacity = r._op;
        // trail completes the full lap; head/glow stop one dash-length early,
        // so the comet parks exactly on the left (accent) edge
        r.style.strokeDashoffset = (r === trailRect) ? '0' : String(headLen);
      });
    });

    summary.addEventListener('mouseleave', function () {
      [trailRect, headRect, headGlow].forEach(function (r) {
        r.style.transition = 'opacity 0.32s ease-out';
        r.style.opacity = '0';
      });
      leaveTimer = setTimeout(function () {
        [trailRect, headRect, headGlow].forEach(function (r) {
          r.style.transition = 'none';
          r.style.strokeDashoffset = '1000';
        });
        leaveTimer = null;
      }, 350);
    });
  }

  // Wrap each summary label character in an indexed span so CSS can run one
  // rainbow keyframe per char, phase-shifted via animation-delay (RGB wave).
  // Chars go inside a single .sum-label span — summary is display:flex with a
  // gap, so bare spans as direct children would be scattered as flex items.
  function wrapSummaryChars(summary) {
    var nodes = Array.prototype.slice.call(summary.childNodes);
    var ci = 0;
    nodes.forEach(function (node) {
      if (node.nodeType !== 3 || !node.textContent.trim()) return;
      var label = document.createElement('span');
      label.className = 'sum-label';
      node.textContent.split('').forEach(function (ch) {
        if (/\s/.test(ch)) {
          label.appendChild(document.createTextNode(ch));
        } else {
          var sp = document.createElement('span');
          sp.className = 'sum-ch';
          sp.textContent = ch;
          sp.style.setProperty('--ci', ci++);
          label.appendChild(sp);
        }
      });
      summary.replaceChild(label, node);
    });
  }

  document.querySelectorAll('.hud-details > summary').forEach(function (s, i) {
    wrapSummaryChars(s);
    makeSummaryLED(s, i);
  });

  /* Reverse iris — clicking "← Home" grows the pill into a full-screen
     "Canvas Lab" title card, then the landing page loads behind it and shrinks
     the card into the demo tile you came from: the forward match cut played
     backwards. Modified clicks (new tab) get the plain navigation. */
  var irisLive = null;

  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    if (!e.target || !e.target.closest) return;
    var link = e.target.closest('a.back-link');
    if (!link) return;
    var href = link.getAttribute('href');
    if (!href) return;
    e.preventDefault();

    var r  = link.getBoundingClientRect();
    var el = document.createElement('div');
    el.className = 'page-iris';
    el.style.top          = r.top + 'px';
    el.style.left         = r.left + 'px';
    el.style.width        = r.width + 'px';
    el.style.height       = r.height + 'px';
    el.style.borderRadius = '40px';

    var t = document.createElement('span');
    t.textContent = 'Canvas Lab';
    el.appendChild(t);
    document.body.appendChild(el);
    irisLive = el;

    requestAnimationFrame(function () { requestAnimationFrame(function () {
      el.classList.add('grow');
      el.style.top          = '0px';
      el.style.left         = '0px';
      el.style.width        = '100vw';
      el.style.height       = '100vh';
      el.style.borderRadius = '0px';
    }); });

    setTimeout(function () { window.location.href = href; }, 460);
  });

  // bfcache restore (forward button back to the demo) — clear the leftover iris
  window.addEventListener('pageshow', function () {
    if (irisLive) { irisLive.remove(); irisLive = null; }
  });

  var btn   = document.getElementById('themeToggle');
  if (!btn) return;
  var icon  = btn.querySelector('.toggle-icon');
  var label = btn.querySelector('.toggle-label');

  var THEMES = ['viper', 'dark', 'light'];
  var META = {
    viper: { icon: '❋', label: 'Viper' },
    dark:  { icon: '☀', label: 'Ember' },
    light: { icon: '☾', label: 'Light' },
  };
  var BGCOL = { viper: '#030806', dark: '#181210', light: '#faf5ee' };
  var metaTheme = document.querySelector('meta[name="theme-color"]');
  if (!metaTheme) {
    metaTheme = document.createElement('meta');
    metaTheme.name = 'theme-color';
    document.head.appendChild(metaTheme);
  }

  function applyTheme(theme) {
    root.classList.toggle('light', theme === 'light');
    root.classList.toggle('viper', theme === 'viper');
    metaTheme.content = BGCOL[theme];
    if (icon)  icon.textContent  = META[theme].icon;
    if (label) label.textContent = META[theme].label;
    document.dispatchEvent(new CustomEvent('themechange', {
      detail: { theme: theme, isLight: theme === 'light' }
    }));
  }

  var theme = localStorage.getItem('theme');
  if (THEMES.indexOf(theme) === -1) theme = 'viper';
  applyTheme(theme);

  btn.addEventListener('click', function () {
    theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    applyTheme(theme);
    localStorage.setItem('theme', theme);
  });
})();
