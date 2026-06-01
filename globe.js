/* globe.js — WebGL2 rotating dot-sphere, spin-kicks on card hover */
(function () {
  'use strict';

  var wrap = document.createElement('div');
  wrap.id = 'globe-wrap';
  wrap.style.cssText = [
    'position:fixed',
    'right:52px',
    'bottom:64px',
    'width:140px',
    'height:140px',
    'z-index:5',
    'pointer-events:none',
    'opacity:0',
    'transition:opacity 0.6s ease, transform 0.6s cubic-bezier(0.34,1.4,0.64,1)',
    'transform:scale(0.7) translateY(20px)',
  ].join(';');
  document.body.appendChild(wrap);

  var cvs = document.createElement('canvas');
  cvs.width  = 140;
  cvs.height = 140;
  cvs.style.cssText = 'display:block;width:100%;height:100%;';
  wrap.appendChild(cvs);

  var gl = cvs.getContext('webgl2');
  if (!gl) { wrap.remove(); return; }

  /* ── shaders ── */
  var VS = [
    '#version 300 es',
    'precision highp float;',
    'in vec3 aPos;',
    'uniform float uRotY;',
    'uniform float uRotX;',
    'uniform float uLight;',
    'out float vVis;',
    'out float vLat;',
    'void main(){',
    '  float cy=cos(uRotY),sy=sin(uRotY);',
    '  float cx=cos(uRotX),sx=sin(uRotX);',
    '  vec3 p=aPos;',
    '  // rotate Y',
    '  p=vec3(p.x*cy+p.z*sy, p.y, -p.x*sy+p.z*cy);',
    '  // rotate X',
    '  p=vec3(p.x, p.y*cx-p.z*sx, p.y*sx+p.z*cx);',
    '  vVis=p.z;',
    '  vLat=aPos.y;',
    '  gl_Position=vec4(p.x*0.88, p.y*0.88, p.z*0.1, 1.0);',
    '  float fade=clamp(p.z*1.8+0.5,0.0,1.0);',
    '  gl_PointSize=clamp(fade*3.2,0.8,3.2);',
    '}'
  ].join('\n');

  var FS = [
    '#version 300 es',
    'precision highp float;',
    'in float vVis;',
    'in float vLat;',
    'uniform float uLight;',
    'out vec4 fragColor;',
    'void main(){',
    '  vec2 c=2.0*gl_PointCoord-1.0;',
    '  if(dot(c,c)>1.0)discard;',
    '  float vis=clamp(vVis*1.8+0.4,0.0,1.0);',
    '  if(vis<0.01)discard;',
    '  vec3 dark=mix(vec3(0.40,0.22,0.06),vec3(0.99,0.85,0.47),(vLat*0.5+0.5));',
    '  vec3 lite=mix(vec3(0.55,0.28,0.02),vec3(0.80,0.45,0.02),(vLat*0.5+0.5));',
    '  vec3 col=mix(dark,lite,uLight);',
    '  float soft=1.0-smoothstep(0.3,1.0,dot(c,c));',
    '  fragColor=vec4(col, vis*soft*0.9);',
    '}'
  ].join('\n');

  function mkShader(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error('[globe]', gl.getShaderInfoLog(s)); return null;
    }
    return s;
  }
  var v = mkShader(gl.VERTEX_SHADER, VS);
  var f = mkShader(gl.FRAGMENT_SHADER, FS);
  if (!v || !f) { wrap.remove(); return; }
  var prog = gl.createProgram();
  gl.attachShader(prog, v); gl.attachShader(prog, f);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error('[globe link]', gl.getProgramInfoLog(prog)); wrap.remove(); return;
  }

  /* ── generate sphere points ── */
  // Fibonacci sphere for uniform distribution
  var N = 480;
  var pts = [];
  var PHI = Math.PI * (3 - Math.sqrt(5));
  for (var i = 0; i < N; i++) {
    var y  = 1 - (i / (N - 1)) * 2;
    var r  = Math.sqrt(1 - y * y);
    var th = PHI * i;
    pts.push(r * Math.cos(th), y, r * Math.sin(th));
  }
  var vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pts), gl.STATIC_DRAW);

  var LOC = {
    aPos:   gl.getAttribLocation(prog,  'aPos'),
    uRotY:  gl.getUniformLocation(prog, 'uRotY'),
    uRotX:  gl.getUniformLocation(prog, 'uRotX'),
    uLight: gl.getUniformLocation(prog, 'uLight'),
  };

  /* ── state ── */
  var rotY = 0, rotX = 0.35;
  var speedY = 0.004, targetSpeedY = 0.004;
  var visible = false;

  function show() {
    if (visible) return;
    visible = true;
    wrap.style.opacity   = '1';
    wrap.style.transform = 'scale(1) translateY(0)';
  }
  function kick() {
    targetSpeedY = 0.048;
    show();
  }
  function release() {
    targetSpeedY = 0.004;
  }

  document.querySelectorAll('.card').forEach(function (card) {
    card.addEventListener('mouseenter', kick);
    card.addEventListener('mouseleave', release);
  });

  // Show globe once page scrolls a little
  window.addEventListener('scroll', function () {
    if (window.scrollY > 80) show();
  }, { passive: true, once: true });

  // Also show on first card hover (handled by kick)
  setTimeout(show, 1800);

  /* ── render loop ── */
  function frame() {
    speedY += (targetSpeedY - speedY) * 0.06;
    rotY   += speedY;

    gl.viewport(0, 0, 140, 140);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.enableVertexAttribArray(LOC.aPos);
    gl.vertexAttribPointer(LOC.aPos, 3, gl.FLOAT, false, 0, 0);

    var lite = document.documentElement.classList.contains('light') ? 1.0 : 0.0;
    gl.uniform1f(LOC.uRotY,  rotY);
    gl.uniform1f(LOC.uRotX,  rotX);
    gl.uniform1f(LOC.uLight, lite);

    gl.drawArrays(gl.POINTS, 0, N);
    requestAnimationFrame(frame);
  }

  frame();
}());
