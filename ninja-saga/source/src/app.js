/* ===== APP: Ninja Saga M0 sandbox. Sections follow the Technical Spec order. ===== */
(function () {
'use strict';
const BUILD = '__BUILD__';
const FILE_SIZE = Number('__SIZE__');
const $ = (s) => document.querySelector(s);
const now = () => performance.now();
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

/* ---------- tuning tables ---------- */
const PAL = { basalt: '#1f2421', cyan: '#00f5d4', orange: '#ff9f1c', teal: '#0f3d40', water: '#1c7c86', red: '#d62828', white: '#ffffff', ink: '#0b0d0c' };
const LADDER = [1.5, 1.25, 1.0, 0.85];
const PART_SCALE = [1, 1, 0.5, 0.25];
const TUNE = { downMs: 18.5, upMs: 13.5, outlinePx: 3, fov: 55 };
const UI = { stickR: 56, stickDead: 0.12, slop: 8, stickZoneFrac: 0.4, edge: 44 };
const BTN = [
  { id: 'ATK', bit: Sim.B.ATK, r: 34, label: 'ATK', dx: 62, dy: 56 },
  { id: 'JMP', bit: Sim.B.JMP, r: 28, label: 'JMP', dx: 52, dy: 150 },
  { id: 'DSH', bit: Sim.B.DSH, r: 26, label: 'DSH', dx: 148, dy: 38 },
  { id: 'EAR', bit: Sim.B.EAR, r: 26, label: 'EAR', dx: 150, dy: 112 },
  { id: 'LCK', bit: Sim.B.LCK, r: 24, label: 'LCK', dx: 236, dy: 62 }
];

/* ---------- math and utilities ---------- */
function hex3(h) { const n = parseInt(h.slice(1), 16); return new THREE.Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); }
function hexRGB(h) { const n = parseInt(h.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }
let cosSeed = 1234567;
function cosRand() { cosSeed = (cosSeed * 1664525 + 1013904223) >>> 0; return cosSeed / 4294967296; } // cosmetic generator, never used inside Sim
function tryStore(fn, dflt) { try { return fn(); } catch (e) { return dflt; } }

/* ---------- global state ---------- */
let W = innerWidth, H = innerHeight;
let started = false;
const P = new Set(); // pause reasons: rot, vis, audio, gl
const sim = Sim.create();
const CHK = {
  sandbox: null, render: null, touch: null, audio: { fx: 0, hit: 0, music: 0, amb: 0, uw: 0, silent: [], decodeOk: null, state: '' },
  soak: null, orient: { portraitPauses: 0, resizesApplied: 0, resizesSeen: 0, last: '', lateFixes: 0, lowestH: 9999 },
  replay: null, ctxLost: 0, ctxRestored: 0, visHidden: 0, renderRuns: {}
};
const TOUCH = { down: 0, maxSim: 0, slideAJ: 0, cancels: 0, edgeCancels: 0, violations: 0, testT0: 0, testEnd: 0, testMax: 0, edgeDrags: 0, edgeDowns: 0, minX0: 1e9, baseN: 0, baseB: 0, result: null, earthLast: '' };

/* ---------- input ---------- */
const inEl = $('#in');
const owners = new Map();
const held = [0, 0, 0, 0, 0], latch = [false, false, false, false, false];
const SN = { sx: 0, sy: 0, bits: 0, dx: 0, dy: 0 };
let pendDX = 0, pendDY = 0;
const insets = { t: 0, r: 0, b: 0, l: 0 };
const btnPos = BTN.map(() => ({ x: 0, y: 0 }));
const btnEl = [];
const dbgTaps = [];

function readInsets() {
  const p = $('#probe'); const cs = getComputedStyle(p);
  insets.t = parseFloat(cs.paddingTop) || 0; insets.r = parseFloat(cs.paddingRight) || 0;
  insets.b = parseFloat(cs.paddingBottom) || 0; insets.l = parseFloat(cs.paddingLeft) || 0;
}
function layoutControls() {
  readInsets();
  const mR = Math.max(44, insets.r), mB = Math.max(44, insets.b), mL = Math.max(44, insets.l);
  const R = W - mR, Bm = H - mB;
  BTN.forEach((b, i) => {
    btnPos[i].x = R - b.dx; btnPos[i].y = Bm - b.dy;
    const e = btnEl[i];
    e.style.width = e.style.height = b.r * 2 + 'px';
    e.style.left = btnPos[i].x - b.r + 'px'; e.style.top = btnPos[i].y - b.r + 'px';
  });
  const hb = $('#hp'); hb.style.left = mL + 'px';
  UI.edge = Math.max(72, insets.l + 25); // wide enough to catch a thumb that starts beside the notch
}
function buildControls() {
  const hud = $('#hud');
  BTN.forEach((b, i) => {
    const e = document.createElement('div'); e.className = 'btn'; e.textContent = b.label; hud.appendChild(e); btnEl.push(e);
  });
}
function btnAt(x, y) {
  let best = -1, bd = 1e9;
  for (let i = 0; i < BTN.length; i++) {
    const d = Math.hypot(x - btnPos[i].x, y - btnPos[i].y);
    if (d <= BTN[i].r + UI.slop && d < bd) { bd = d; best = i; }
  }
  return best;
}
function btnPress(i) { held[i]++; latch[i] = true; btnEl[i].classList.add('on'); }
function btnRelease(i) { if (held[i] > 0) held[i]--; if (held[i] === 0) btnEl[i].classList.remove('on'); }

function stickVec(o) {
  let dx = (o.x - o.ox) / UI.stickR, dy = (o.oy - o.y) / UI.stickR;
  const len = Math.hypot(dx, dy);
  if (len > 1) { dx /= len; dy /= len; }
  const m = Math.min(1, len);
  if (m < UI.stickDead) return [0, 0, 0, 0, 0];
  const k = (m - UI.stickDead) / (1 - UI.stickDead) / (m || 1);
  return [dx * k, dy * k, dx, dy, m];
}
function drawStick() {
  const base = $('#stBase'), th = $('#stThumb');
  let so = null; owners.forEach(o => { if (o.kind === 'stick') so = o; });
  if (!so) { base.style.display = th.style.display = 'none'; return; }
  const v = stickVec(so);
  base.style.display = th.style.display = 'block';
  base.style.transform = `translate(${so.ox - UI.stickR}px,${so.oy - UI.stickR}px)`;
  const tx = so.ox + (v[2] || 0) * UI.stickR, ty = so.oy - (v[3] || 0) * UI.stickR;
  th.style.transform = `translate(${tx - 22}px,${ty - 22}px)`;
}
function dropAllPointers() {
  owners.forEach(o => { if (o.kind === 'btn') btnRelease(o.btn); });
  owners.clear(); pendDX = pendDY = 0; drawStick();
}
function onDown(e) {
  e.preventDefault();
  const x = e.clientX, y = e.clientY, t = now();
  if (!started) return;
  // five taps within 2 s on the top center toggle the debug overlay
  if (y < 56 && Math.abs(x - W / 2) < 90) {
    dbgTaps.push(t); while (dbgTaps.length && t - dbgTaps[0] > 2000) dbgTaps.shift();
    if (dbgTaps.length >= 5) { dbgTaps.length = 0; toggleOverlay(); }
    return;
  }
  if (owners.size >= 5 || P.size) return;
  if (TOUCH.result === 'running') { TOUCH.minX0 = Math.min(TOUCH.minX0, x); if (x < UI.edge) TOUCH.edgeDowns++; }
  let o;
  const bi = btnAt(x, y);
  if (bi >= 0) { o = { kind: 'btn', btn: bi, x, y, x0: x, y0: y }; btnPress(bi); }
  else if (x < UI.edge) o = { kind: 'edge', x, y, x0: x, y0: y };
  else if (x < W * UI.stickZoneFrac) o = { kind: 'stick', ox: x, oy: y, x, y, x0: x, y0: y };
  else o = { kind: 'cam', x, y, x0: x, y0: y };
  try { inEl.setPointerCapture(e.pointerId); } catch (er) { /* sandbox may refuse */ }
  owners.set(e.pointerId, o);
  TOUCH.down++; TOUCH.maxSim = Math.max(TOUCH.maxSim, owners.size);
  if (TOUCH.result === 'running') TOUCH.testMax = Math.max(TOUCH.testMax, owners.size);
}
function onMove(e) {
  const o = owners.get(e.pointerId); if (!o) return;
  e.preventDefault();
  const x = e.clientX, y = e.clientY;
  if (o.kind === 'cam') { pendDX += x - o.x; pendDY += y - o.y; }
  else if (o.kind === 'btn') {
    const bi = btnAt(x, y);
    if (bi >= 0 && bi !== o.btn) {
      if (BTN[o.btn].id === 'ATK' && BTN[bi].id === 'JMP') TOUCH.slideAJ++;
      btnRelease(o.btn); o.btn = bi; btnPress(bi);
    }
  }
  o.x = x; o.y = y;
}
function onUp(e) {
  const o = owners.get(e.pointerId); if (!o) return;
  e.preventDefault();
  if (o.kind === 'btn') btnRelease(o.btn);
  if (o.kind === 'edge' && Math.hypot(o.x - o.x0, o.y - o.y0) > 40 && TOUCH.result === 'running') TOUCH.edgeDrags++;
  owners.delete(e.pointerId);
  try { inEl.releasePointerCapture(e.pointerId); } catch (er) { /* ignore */ }
}
function onCancel(e) {
  const o = owners.get(e.pointerId); if (!o) return;
  TOUCH.cancels++;
  if (o.x0 < UI.edge + 4 || o.x0 > W - UI.edge - 4) TOUCH.edgeCancels++;
  else if (TOUCH.result === 'running') TOUCH.violations++;
  if (o.kind === 'btn') btnRelease(o.btn);
  owners.delete(e.pointerId);
}
function sample() {
  let sx = 0, sy = 0;
  owners.forEach(o => { if (o.kind === 'stick') { const v = stickVec(o); sx = v[0]; sy = v[1]; } });
  let bits = 0;
  for (let i = 0; i < BTN.length; i++) { if (held[i] > 0 || latch[i]) bits |= BTN[i].bit; latch[i] = false; }
  SN.sx = sx; SN.sy = sy; SN.bits = bits; SN.dx = pendDX; SN.dy = pendDY; pendDX = pendDY = 0;
  return SN;
}
inEl.addEventListener('pointerdown', onDown);
inEl.addEventListener('pointermove', onMove);
inEl.addEventListener('pointerup', onUp);
inEl.addEventListener('pointercancel', onCancel);
['gesturestart', 'gesturechange', 'gestureend', 'contextmenu'].forEach(n => document.addEventListener(n, e => e.preventDefault()));
document.addEventListener('touchmove', e => { if (!e.target.closest || !e.target.closest('.scroll')) e.preventDefault(); }, { passive: false });

/* ---------- renderer, materials and scene ---------- */
let renderer = null, canvas = null, aaOn = false;
const stage = $('#stage');
const camera = new THREE.PerspectiveCamera(TUNE.fov, W / H, 0.1, 300);
const scene = new THREE.Scene();
let ladderStep = 0, floorMode = false, lpm = false;

function webgl2Ok() { try { return !!document.createElement('canvas').getContext('webgl2'); } catch (e) { return false; } }
function makeRenderer(aa) {
  if (canvas) { canvas.remove(); try { renderer.dispose(); } catch (e) { /* ignore */ } }
  canvas = document.createElement('canvas'); canvas.id = 'gl'; stage.appendChild(canvas);
  renderer = new THREE.WebGLRenderer({ canvas, antialias: aa, alpha: false, stencil: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(LADDER[ladderStep]); renderer.setSize(W, H, false);
  renderer.setClearColor(0x0f3d40, 1);
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); CHK.ctxLost++; P.add('gl'); updatePause(); });
  canvas.addEventListener('webglcontextrestored', () => { CHK.ctxRestored++; P.delete('gl'); updatePause(); });
  aaOn = aa;
}

const U = { // shared uniforms
  uKeyDir: { value: new THREE.Vector3(-0.45, 0.75, 0.5).normalize() },
  uKeyCol: { value: hex3('#ffd9a0') }, uSky: { value: hex3('#2a7a80') }, uGround: { value: hex3('#2b1c14') },
  uRim: { value: hex3('#ff9f1c') }, uFogCol: { value: hex3(PAL.teal) },
  uFogNear: { value: 40 }, uFogFar: { value: 220 }
};
const VERT_TOON = `
attribute vec3 aCol; varying vec3 vN; varying vec3 vCol; varying vec3 vW; varying float vD;
void main(){ vec4 wp=modelMatrix*vec4(position,1.0); vW=wp.xyz; vN=normalize(mat3(modelMatrix)*normal); vCol=aCol;
 vec4 mv=viewMatrix*wp; vD=-mv.z; gl_Position=projectionMatrix*mv; }`;
const FRAG_TOON = `
precision highp float;
uniform vec3 uKeyDir,uKeyCol,uSky,uGround,uRim,uFogCol; uniform float uSteps,uFogNear,uFogFar,uRimAmt;
varying vec3 vN; varying vec3 vCol; varying vec3 vW; varying float vD;
void main(){ vec3 n=normalize(vN); float ndl=dot(n,uKeyDir)*0.5+0.5;
 float band=min(floor(ndl*uSteps),uSteps-1.0)/(uSteps-1.0); float lit=mix(0.32,1.0,band);
 vec3 hemi=mix(uGround,uSky,n.y*0.5+0.5); vec3 v=normalize(cameraPosition-vW);
 float rim=smoothstep(0.62,0.92,1.0-max(dot(n,v),0.0))*step(0.35,ndl);
 vec3 col=vCol*(uKeyCol*lit*0.85+hemi*0.4)+uRim*rim*uRimAmt;
 float f=clamp((vD-uFogNear)/(uFogFar-uFogNear),0.0,1.0); gl_FragColor=vec4(mix(col,uFogCol,f),1.0); }`;
const VERT_OUT = `
uniform float uPx,uTan; varying float vD;
void main(){ vec4 mv=viewMatrix*modelMatrix*vec4(position,1.0); float d=-mv.z; float w=uPx*2.0*d*uTan/1080.0;
 vec4 mv2=viewMatrix*modelMatrix*vec4(position+normal*w,1.0); vD=d; gl_Position=projectionMatrix*mv2; }`;
const FRAG_OUT = `
precision highp float; uniform vec3 uInk,uFogCol; uniform float uFogNear,uFogFar; varying float vD;
void main(){ float f=clamp((vD-uFogNear)/(uFogFar-uFogNear),0.0,1.0); gl_FragColor=vec4(mix(uInk,uFogCol,f),1.0); }`;
const OUT_U = { uPx: { value: TUNE.outlinePx }, uTan: { value: Math.tan(TUNE.fov * Math.PI / 360) }, uInk: { value: hex3(PAL.ink) }, uFogCol: U.uFogCol, uFogNear: U.uFogNear, uFogFar: U.uFogFar };
// Material factory. The role argument lets the debug build flag cyan on anything except Storm and UI.
const ROLE_FLAGS = [];
function toonMaterial(role, steps, rimAmt) {
  const m = new THREE.ShaderMaterial({ vertexShader: VERT_TOON, fragmentShader: FRAG_TOON, uniforms: Object.assign({ uSteps: { value: steps }, uRimAmt: { value: rimAmt } }, U) });
  m.userData.role = role; return m;
}
const matChar = toonMaterial('storm', 3, 0.45), matEnv = toonMaterial('env', 4, 0.08), matEnemy = toonMaterial('enemy', 3, 0.3);
const matOutline = new THREE.ShaderMaterial({ vertexShader: VERT_OUT, fragmentShader: FRAG_OUT, uniforms: OUT_U, side: THREE.BackSide });
function colorGeom(geo, hex, role) {
  if (hex.toLowerCase() === PAL.cyan && role !== 'storm' && role !== 'ui') ROLE_FLAGS.push('cyan on ' + role);
  const c = hexRGB(hex), n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c[0]; a[i * 3 + 1] = c[1]; a[i * 3 + 2] = c[2]; }
  geo.setAttribute('aCol', new THREE.BufferAttribute(a, 3)); return geo;
}

// sky dome with painterly clouds drawn once to a 512 by 256 canvas
function makeCloudTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256; const g = c.getContext('2d');
  g.clearRect(0, 0, 512, 256);
  for (let i = 0; i < 46; i++) {
    const x = cosRand() * 512, y = 40 + cosRand() * 150, rw = 30 + cosRand() * 70, rh = 5 + cosRand() * 12;
    for (const ox of [-512, 0, 512]) {
      g.fillStyle = 'rgba(255,255,255,' + (0.12 + cosRand() * 0.22).toFixed(2) + ')';
      g.beginPath(); g.ellipse(x + ox, y, rw, rh, 0, 0, Math.PI * 2); g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace; return t;
}
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, depthTest: false,
  uniforms: { uTop: { value: hex3(PAL.teal) }, uHor: { value: hex3(PAL.orange) }, uCloud: { value: makeCloudTexture() } },
  vertexShader: 'varying vec3 vDir; void main(){ vDir=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `precision highp float; uniform vec3 uTop,uHor; uniform sampler2D uCloud; varying vec3 vDir;
  void main(){ float h=clamp(vDir.y,0.0,1.0); vec3 col=mix(uTop*0.8,uTop*1.3,smoothstep(0.1,0.7,h));
   col=mix(uHor,col,smoothstep(0.0,0.2,h)); float u=atan(vDir.z,vDir.x)/6.2831853+0.5;
   float cl=texture2D(uCloud,vec2(u*2.0,clamp(h*3.0,0.0,1.0))).a; col=mix(col,mix(uHor,vec3(0.55,0.85,0.8),smoothstep(0.0,0.4,h)),cl*0.55*smoothstep(0.02,0.12,h));
   gl_FragColor=vec4(col,1.0); }`
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(200, 24, 12), skyMat); sky.frustumCulled = false; sky.renderOrder = -10; scene.add(sky);

// ground and pillars
const groundR = [];
function fillGround(g, baseHex) {
  const n = g.attributes.position.count, a = new Float32Array(n * 3), b = hexRGB(baseHex), o = hexRGB(PAL.orange);
  for (let i = 0; i < n; i++) {
    const r = groundR[i], k = 1.0 + r * 0.7, glow = r > 0.9 ? 0.7 : 0;
    a[i * 3] = b[0] * k + o[0] * glow * 0.45; a[i * 3 + 1] = b[1] * k + o[1] * glow * 0.3; a[i * 3 + 2] = b[2] * k + o[2] * glow * 0.1;
  }
  g.setAttribute('aCol', new THREE.BufferAttribute(a, 3));
}
function makeGround() {
  const g = new THREE.PlaneGeometry(200, 200, 50, 50); g.rotateX(-Math.PI / 2);
  for (let i = 0; i < g.attributes.position.count; i++) groundR.push(cosRand());
  fillGround(g, PAL.basalt); return g;
}
const groundGeo = makeGround();
scene.add(new THREE.Mesh(groundGeo, matEnv));
for (let i = 0; i < 12; i++) {
  const h = 2 + cosRand() * 5, m = new THREE.Mesh(colorGeom(new THREE.BoxGeometry(1.4, h, 1.4), i % 3 ? '#2d332f' : '#3a322c', 'env'), matEnv);
  m.position.set(-30 + i * 6 + cosRand() * 3, h / 2, -9 - cosRand() * 8); scene.add(m);
}
const dummy = new THREE.Mesh(colorGeom(new THREE.CylinderGeometry(0.5, 0.5, 1.8, 12), '#6b3f2a', 'enemy'), matEnemy);
dummy.position.set(6, 0.9, -3); scene.add(dummy);
const dummyOut = new THREE.Mesh(dummy.geometry, matOutline); dummyOut.position.copy(dummy.position); scene.add(dummyOut);

// stress group: 100 spheres, about 98k triangles, frustum culling off so the load is constant
const stress = new THREE.Group(); stress.visible = false; scene.add(stress);
for (let i = 0; i < 100; i++) {
  const m = new THREE.Mesh(colorGeom(new THREE.IcosahedronGeometry(0.6, 6), i % 4 === 0 ? '#5a3a24' : '#3a403c', 'env'), matEnv);
  m.position.set(-8 + (i % 10) * 1.8, 0.7 + (Math.floor(i / 10) % 3) * 0.15, -4 - Math.floor(i / 10) * 1.8); m.frustumCulled = false; stress.add(m);
}

for (let i = 0; i < 8; i++) { // brings the stress scene to about 120 draw calls
  const m = new THREE.Mesh(colorGeom(new THREE.BoxGeometry(0.8, 1.2 + i * 0.2, 0.8), '#3a322c', 'env'), matEnv);
  m.position.set(-10 + i * 3, 0.6 + i * 0.1, -22); m.frustumCulled = false; stress.add(m);
}

// Storm: procedural capsule with inverted-hull outline, white hair, red scarf, cyan belt
const storm = new THREE.Group(); scene.add(storm);
const stormBody = new THREE.Mesh(colorGeom(new THREE.CapsuleGeometry(0.35, 1.0, 6, 16), '#2b302d', 'storm'), matChar); stormBody.position.y = 0.85; storm.add(stormBody);
const stormHull = new THREE.Mesh(stormBody.geometry, matOutline); stormHull.position.y = 0.85; storm.add(stormHull);
const hair = new THREE.Mesh(colorGeom(new THREE.ConeGeometry(0.3, 0.5, 8), '#f4f4f0', 'storm'), matChar); hair.position.set(0, 1.85, -0.06); hair.rotation.x = -0.35; storm.add(hair);
const scarf = new THREE.Mesh(colorGeom(new THREE.TorusGeometry(0.33, 0.07, 8, 16), PAL.red, 'storm'), matChar); scarf.position.y = 1.42; scarf.rotation.x = Math.PI / 2; storm.add(scarf);
const tail = new THREE.Mesh(colorGeom(new THREE.BoxGeometry(0.1, 0.12, 0.7), PAL.red, 'storm'), matChar); tail.position.set(0, 1.38, -0.5); tail.rotation.x = 0.25; storm.add(tail);
const belt = new THREE.Mesh(colorGeom(new THREE.TorusGeometry(0.352, 0.04, 6, 16), PAL.cyan, 'storm'), matChar); belt.position.y = 0.85; belt.rotation.x = Math.PI / 2; storm.add(belt);
const shadowMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: {}, vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }', fragmentShader: 'precision highp float; varying vec2 vUv; void main(){ float d=length(vUv-0.5)*2.0; gl_FragColor=vec4(0.0,0.0,0.0,0.45*(1.0-smoothstep(0.5,1.0,d))); }' });
const blob = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4).rotateX(-Math.PI / 2), shadowMat); blob.position.y = 0.02; blob.renderOrder = 1; scene.add(blob);

// ambient embers: one Points draw, count scaled by the resolution ladder
const EMBERS = 120;
const emberPos = new Float32Array(EMBERS * 3), emberSeed = new Float32Array(EMBERS);
for (let i = 0; i < EMBERS; i++) { emberPos[i * 3] = (cosRand() - 0.5) * 36; emberPos[i * 3 + 1] = cosRand() * 9; emberPos[i * 3 + 2] = (cosRand() - 0.5) * 36; emberSeed[i] = cosRand() * 6.28; }
const emberGeo = new THREE.BufferGeometry(); emberGeo.setAttribute('position', new THREE.BufferAttribute(emberPos, 3));
const emberMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uScale: { value: 300 }, uCol: { value: hex3(PAL.orange) } },
  vertexShader: 'uniform float uScale; void main(){ vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=clamp(0.09*uScale/(-mv.z),1.5,9.0); gl_Position=projectionMatrix*mv; }',
  fragmentShader: 'precision highp float; uniform vec3 uCol; void main(){ float d=length(gl_PointCoord-0.5)*2.0; if(d>1.0) discard; gl_FragColor=vec4(uCol,(1.0-d)*0.9); }'
});
const embers = new THREE.Points(emberGeo, emberMat); embers.frustumCulled = false; scene.add(embers);
let emberLive = EMBERS;
function updateEmbers(dt, cx, cz) {
  for (let i = 0; i < EMBERS; i++) {
    emberPos[i * 3 + 1] += (0.35 + 0.15 * Math.sin(emberSeed[i])) * dt;
    emberPos[i * 3] += Math.sin(emberSeed[i] + now() * 0.0004) * 0.2 * dt;
    if (emberPos[i * 3 + 1] > 9) emberPos[i * 3 + 1] = 0;
    // keep the field around the camera target
    if (emberPos[i * 3] - cx > 18) emberPos[i * 3] -= 36; else if (emberPos[i * 3] - cx < -18) emberPos[i * 3] += 36;
    if (emberPos[i * 3 + 2] - cz > 18) emberPos[i * 3 + 2] -= 36; else if (emberPos[i * 3 + 2] - cz < -18) emberPos[i * 3 + 2] += 36;
  }
  emberGeo.attributes.position.needsUpdate = true;
}
function setEmberLive() { emberLive = Math.round(EMBERS * PART_SCALE[ladderStep]); emberGeo.setDrawRange(0, emberLive); }

/* ---------- audio ---------- */
const AUDIO = [ // manifest: one row per audio source (M0 rows are generated test signals, no files embedded)
  { id: 'test_fx_blip_01', bus: 'fx', loop: false, gain: 0.8, pitch: [0.95, 1.05] },
  { id: 'test_fx_shing_01', bus: 'fx', loop: false, gain: 0.7, pitch: [0.95, 1.05] },
  { id: 'test_fx_thwack_01', bus: 'fx', loop: false, gain: 0.9, pitch: [0.95, 1.05] },
  { id: 'test_fx_thump_01', bus: 'fx', loop: false, gain: 0.9, pitch: [0.95, 1.05] },
  { id: 'test_amb_hum_01', bus: 'amb', loop: true, gain: 0.8, pitch: [1, 1] },
  { id: 'test_mus_pad_01', bus: 'music', loop: true, gain: 1, pitch: [1, 1] }
];
const A = { ctx: null, bus: {}, lp: null, voices: 0, buf: {}, ambSrc: null, musicEl: null, musicOn: false, ambOn: false, uw: false, ready: false };
function wavBuf(sr, data) {
  const n = data.length, ab = new ArrayBuffer(44 + n * 2), v = new DataView(ab);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.round(clamp(data[i], -1, 1) * 32767), true);
  return ab;
}
const SR = 22050;
function genSignal(sec, fn) { const n = Math.round(sec * SR), d = new Float32Array(n); for (let i = 0; i < n; i++) d[i] = fn(i / SR, i); return d; }
function genAll() {
  let prev = 0;
  const shing = genSignal(0.12, (t) => { const x = cosRand() * 2 - 1, y = x - prev; prev = x; return y * Math.exp(-t * 40) * 0.5; });
  const thwack = genSignal(0.25, (t) => (Math.sin(2 * Math.PI * 420 * t * (1 - 0.5 * t)) * Math.exp(-t * 18) + (cosRand() * 2 - 1) * Math.exp(-t * 50) * 0.4) * 0.6);
  const thump = genSignal(0.35, (t) => Math.sin(2 * Math.PI * 65 * t) * Math.exp(-t * 10) * 0.8);
  const blip = genSignal(0.3, (t) => Math.sin(2 * Math.PI * 660 * t) * Math.exp(-t * 9) * 0.5);
  const amb = genSignal(2, (t) => { // integer cycles in 2 s so the loop is seamless
    let s = 0; for (let k = 0; k < 10; k++) s += Math.sin(2 * Math.PI * (30 + k * 23.5) * t + k) * (0.12 / (1 + k * 0.4)); return s;
  });
  const mus = genSignal(8, (t) => { const trem = 0.7 + 0.3 * Math.sin(2 * Math.PI * 0.25 * t); return (Math.sin(2 * Math.PI * 110 * t) + Math.sin(2 * Math.PI * 165 * t) * 0.8 + Math.sin(2 * Math.PI * 220 * t) * 0.6) * 0.1 * trem; });
  return { blip, shing, thwack, thump, amb, mus };
}
function decodeCb(ab) { return new Promise((ok, no) => { A.ctx.decodeAudioData(ab, ok, no); }); } // callback form, supported on every iOS version
async function audioInit() {
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return false;
  const c = new AC({ latencyHint: 'interactive' }); A.ctx = c;
  const g = (v) => { const n = c.createGain(); n.gain.value = v; return n; };
  A.bus.master = g(0.9); const comp = c.createDynamicsCompressor(); A.bus.master.connect(comp); comp.connect(c.destination);
  A.bus.music = g(0.5); A.bus.ui = g(0.8); A.bus.fx = g(1.0); A.bus.amb = g(0.6);
  A.lp = c.createBiquadFilter(); A.lp.type = 'lowpass'; A.lp.frequency.value = 20000; A.lp.Q.value = 0.7;
  A.bus.music.connect(A.bus.master); A.bus.ui.connect(A.bus.master); A.bus.fx.connect(A.lp); A.bus.amb.connect(A.lp); A.lp.connect(A.bus.master);
  c.addEventListener('statechange', () => {
    CHK.audio.state = c.state;
    if (started && (c.state === 'interrupted' || c.state === 'suspended') && !P.has('audio') && !P.has('vis')) { P.add('audio'); updatePause(); }
  });
  const b = c.createBuffer(1, 1, 22050), s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start(0); // silent unlock buffer
  await c.resume();
  CHK.audio.state = c.state;
  try {
    const sig = genAll(); A.buf = {};
    for (const k of ['blip', 'shing', 'thwack', 'thump', 'amb']) A.buf[k] = await decodeCb(wavBuf(SR, sig[k]));
    A.musicUrl = URL.createObjectURL(new Blob([wavBuf(SR, sig.mus)], { type: 'audio/wav' }));
    CHK.audio.decodeOk = true;
  } catch (e) { CHK.audio.decodeOk = false; }
  A.ready = true; return true;
}
function playBuf(name, bus, gain, when, pitch) {
  if (!A.ready || !A.buf[name]) return;
  const s = A.ctx.createBufferSource(), g = A.ctx.createGain();
  s.buffer = A.buf[name]; s.playbackRate.value = pitch || 1; g.gain.value = gain; s.connect(g); g.connect(A.bus[bus]);
  A.voices++; s.onended = () => { A.voices--; }; s.start(when || 0);
}
function playFx() { playBuf('blip', 'fx', 0.8, 0, 0.95 + cosRand() * 0.1); CHK.audio.fx++; }
function playHit() { // SHING-THWACK: three layers from one scheduled start time
  const t = A.ctx.currentTime + 0.02, p = 0.95 + cosRand() * 0.1;
  playBuf('shing', 'fx', 0.7, t, p); playBuf('thwack', 'fx', 0.9, t, p); playBuf('thump', 'fx', 0.9, t, p); CHK.audio.hit++;
}
function toggleMusic() {
  if (!A.ready) return;
  if (!A.musicEl) {
    const el = new Audio(); el.src = A.musicUrl; el.loop = true; el.setAttribute('playsinline', ''); A.musicEl = el;
    try { A.musicNode = A.ctx.createMediaElementSource(el); A.musicNode.connect(A.bus.music); A.musicRouted = true; } catch (e) { A.musicRouted = false; }
  }
  if (A.musicOn) { A.musicEl.pause(); A.musicOn = false; }
  else { A.musicEl.play().then(() => { A.musicOn = true; CHK.audio.music++; }).catch(() => { CHK.audio.music = -1; }); }
}
function toggleAmb() {
  if (!A.ready) return;
  if (A.ambOn) { try { A.ambSrc.stop(); } catch (e) { /* ignore */ } A.ambOn = false; return; }
  const s = A.ctx.createBufferSource(), g = A.ctx.createGain(); s.buffer = A.buf.amb; s.loop = true; g.gain.value = 0.8; s.connect(g); g.connect(A.bus.amb); s.start(); A.ambSrc = s; A.ambOn = true; CHK.audio.amb++;
}
function toggleUW() {
  if (!A.ready) return;
  const f = A.lp.frequency, t = A.ctx.currentTime; A.uw = !A.uw;
  f.cancelScheduledValues(t); f.setValueAtTime(f.value, t); f.linearRampToValueAtTime(A.uw ? 800 : 20000, t + 0.15); if (A.uw) CHK.audio.uw++;
}

/* ---------- ladder, loop and metrics ---------- */
const M = { ring: new Float32Array(30), ri: 0, rn: 0, avg: 16.7, sd: 0, max: 0, simMs: 0, renderMs: 0, fps: 60, calls: 0, tris: 0, maxSeen: 0 };
let lastT = 0, acc = 0, skipToggle = false, lastChange = 0, upCount = 0, floorUntil = 0, retryStamp = 0, stepsThisFrame = 0;
const ladderLog = [];
function setLadder(i) {
  ladderStep = i; renderer.setPixelRatio(LADDER[i]); lastChange = now(); upCount = 0; setEmberLive();
  ladderLog.push([now(), i, floorMode ? 'floor' : '']);
  if (CHK.soak && CHK.soak.t0 && now() - CHK.soak.t0 > 60000) CHK.soak.changes++;
}
function enterFloor(ms) { floorMode = true; floorUntil = now() + ms; if (ladderStep !== 3) setLadder(3); else lastChange = now(); ladderLog.push([now(), 3, 'enter floor']); }
function pushInterval(dt) {
  M.ring[M.ri] = dt; M.ri = (M.ri + 1) % 30; if (M.rn < 30) M.rn++;
  let s = 0, q = 0; for (let i = 0; i < M.rn; i++) s += M.ring[i]; M.avg = s / M.rn;
  for (let i = 0; i < M.rn; i++) q += (M.ring[i] - M.avg) * (M.ring[i] - M.avg); M.sd = Math.sqrt(q / M.rn);
  M.fps = 1000 / M.avg; if (dt > M.max) M.max = dt; if (dt > M.maxSeen) M.maxSeen = dt;
}
function ladderUpdate() {
  const t = now();
  if (M.rn < 30 || rep.bot || rep.play) return; // the bot and replay test determinism, so the ladder holds still during them
  if (lpm) { if (M.avg < 24) { lpm = false; floorMode = false; } return; }
  if (t - lastChange < 4000) { upCount = 0; return; }
  if (floorMode) { if (t >= floorUntil) { floorMode = false; retryStamp = t; lastChange = t; M.rn = 0; ladderLog.push([t, 3, 'retry']); } return; }
  if (M.avg > TUNE.downMs) {
    if (ladderStep === 0 && M.avg > 30 && M.avg < 37 && M.sd < 3 && (M.simMs + M.renderMs) < 10) { lpm = true; floorMode = true; ladderLog.push([t, 0, 'low power mode']); return; }
    if (ladderStep < 3) setLadder(ladderStep + 1);
    else { enterFloor(retryStamp && t - retryStamp < 5000 ? 30000 : 10000); }
    upCount = 0;
  } else if (M.avg < TUNE.upMs) { if (++upCount >= 180 && ladderStep > 0) setLadder(ladderStep - 1); } else upCount = 0;
}

const rep = { rec: false, play: false, bot: false, data: [], i: 0, recHash: '', botStart: 0, botN: 0, botExpect: '', maxInt: 0, maxAt: 0, fr: 0, status: '' };
function stepOnce() {
  let snap;
  if (rep.play) snap = rep.data[rep.i++];
  else if (rep.bot) snap = Sim.scripted(sim.step, SN, sim);
  else snap = sample();
  if (rep.rec) rep.data.push({ sx: snap.sx, sy: snap.sy, bits: snap.bits, dx: snap.dx, dy: snap.dy });
  Sim.step(sim, snap);
  if (rep.play && rep.i >= rep.data.length) finishReplay();
  else if (rep.bot && sim.step >= rep.botN) finishBot();
}
function startRec() { stopReplayModes(); Sim.reset(sim); rep.data = []; rep.rec = true; rep.status = 'recording'; }
function stopRec() { if (!rep.rec) return; rep.rec = false; rep.recHash = Sim.hash(sim); rep.status = 'recorded ' + rep.data.length + ' steps'; }
function startReplay() { if (!rep.data.length || rep.rec) { rep.status = 'nothing recorded'; return; } stopReplayModes(); Sim.reset(sim); rep.i = 0; rep.maxInt = 0; rep.maxAt = 0; rep.fr = 0; rep.play = true; rep.status = 'replaying'; }
function finishReplay() {
  rep.play = false; const h = Sim.hash(sim), ok = h === rep.recHash && !sim.nan && sim.respawns === 0 && rep.maxInt <= 50;
  CHK.replay = { kind: 'recorded', pass: ok, same: h === rep.recHash, nan: sim.nan, kill: sim.respawns, maxInt: Math.round(rep.maxInt), maxAt: rep.maxAt, steps: rep.data.length };
  rep.status = 'replay ' + (ok ? 'PASS' : 'FAIL');
}
function startBot() { stopReplayModes(); Sim.reset(sim); rep.bot = true; rep.botStart = 0; rep.botN = 1800; rep.maxInt = 0; rep.maxAt = 0; rep.fr = 0; rep.botExpect = Sim.runScripted(rep.botN).hash; rep.status = 'bot running'; }
function finishBot() {
  rep.bot = false; const h = Sim.hash(sim) , ok = h === rep.botExpect && !sim.nan && sim.respawns === 0 && rep.maxInt <= 50;
  CHK.replay = { kind: 'scripted bot', pass: ok, same: h === rep.botExpect, nan: sim.nan, kill: sim.respawns, maxInt: Math.round(rep.maxInt), maxAt: rep.maxAt, steps: rep.botN };
  rep.status = 'bot ' + (ok ? 'PASS' : 'FAIL');
}
function stopReplayModes() { rep.rec = rep.play = rep.bot = false; }

function renderFrame(alpha, dt) {
  const s = sim;
  storm.position.set(lerp(s.px, s.x, alpha), lerp(s.py, s.y, alpha), lerp(s.pz, s.z, alpha));
  storm.rotation.y = s.pyaw + Sim.wrapPi(s.yaw - s.pyaw) * alpha;
  const k = s.atk > 0 ? s.atk / Sim.T.atkFrames : 0, air = s.grounded ? 0 : clamp(s.vy / 12, -1, 1);
  storm.scale.set(1 + 0.18 * k - 0.06 * air, 1 - 0.1 * k + 0.1 * air, 1 + 0.18 * k - 0.06 * air);
  blob.position.x = storm.position.x; blob.position.z = storm.position.z;
  const hs = clamp(1 - storm.position.y * 0.18, 0.35, 1); blob.scale.set(hs, 1, hs);
  camera.position.set(lerp(s.pcx, s.cx, alpha), lerp(s.pcy, s.cy, alpha), lerp(s.pcz, s.cz, alpha));
  camera.lookAt(lerp(s.ptx, s.tx, alpha), lerp(s.pty, s.ty, alpha), lerp(s.ptz, s.tz, alpha));
  sky.position.copy(camera.position);
  updateEmbers(dt / 1000, s.tx, s.tz);
  OUT_U.uPx.value = TUNE.outlinePx;
  // lock-on marker: DOM element placed from the projected dummy position
  const lm = $('#lock');
  if (s.lock) {
    const v = dummy.position.clone().project(camera);
    if (v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1) { lm.style.display = 'block'; lm.style.transform = `translate(${(v.x * 0.5 + 0.5) * W - 16}px,${(0.5 - v.y * 0.5) * H - 16}px)`; } else lm.style.display = 'none';
  } else lm.style.display = 'none';
  const t0 = now();
  renderer.render(scene, camera);
  M.renderMs = lerp(M.renderMs, now() - t0, 0.1);
  M.calls = renderer.info.render.calls; M.tris = renderer.info.render.triangles;
}

function frame(t) {
  requestAnimationFrame(frame);
  if (!started || P.size) { lastT = 0; return; }
  if (floorMode && !lpm) { skipToggle = !skipToggle; if (skipToggle) return; }
  if (!lastT) { lastT = t; return; }
  const dt = t - lastT; lastT = t;
  pushInterval(dt);
  if (rep.play || rep.bot) { rep.fr++; if (rep.fr > 10 && dt > rep.maxInt) { rep.maxInt = dt; rep.maxAt = rep.fr; } } // the first 10 frames absorb the panel closing
  acc += Math.min(dt, 100) / 1000;
  const s0 = now(); let n = 0;
  while (acc >= Sim.STEP && n < 4) { stepOnce(); acc -= Sim.STEP; n++; }
  if (acc >= Sim.STEP) acc = 0; // never snowball into catch-up
  M.simMs = lerp(M.simMs, now() - s0, 0.1); stepsThisFrame = n;
  renderFrame(acc / Sim.STEP, dt);
  drawStick();
  ladderUpdate();
  testTick();
  if (CHK.orient.last === '') CHK.orient.last = W + 'x' + H;
}

/* ---------- viewport, pause and lifecycle ---------- */
let resizeTimer = 0;
// iOS can report a stale innerHeight after rotation, about 47 px short in a Home Screen app. Size from the screen when that happens.
function viewSize() {
  const w = innerWidth; let h = innerHeight;
  if (navigator.standalone === true && w > h) {
    const sh = Math.min(screen.width, screen.height), sw = Math.max(screen.width, screen.height);
    if (h < sh && sh - h <= 60 && Math.abs(w - sw) <= 60) h = sh;
  }
  return [w, h];
}
function viewDiag() {
  const de = document.documentElement, vv = window.visualViewport;
  return `inner ${innerWidth}x${innerHeight}, client ${de.clientWidth}x${de.clientHeight}, visual ${vv ? Math.round(vv.width) + 'x' + Math.round(vv.height) : 'n/a'}, screen ${screen.width}x${screen.height}, used ${W}x${H}, lowest inner height ${CHK.orient.lowestH === 9999 ? '-' : CHK.orient.lowestH}, late size fixes ${CHK.orient.lateFixes}, insets ${insets.t}/${insets.r}/${insets.b}/${insets.l}`;
}
function applyResize(boot) {
  if (boot === undefined) CHK.orient.resizesSeen++;
  const [nw, nh] = viewSize();
  document.documentElement.style.setProperty('--vh', nh + 'px');
  const portrait = nh > nw;
  if (portrait && !P.has('rot')) { P.add('rot'); CHK.orient.portraitPauses++; }
  if (!portrait && P.has('rot')) { P.delete('rot'); lastT = 0; acc = 0; dropAllPointers(); }
  if (Math.abs(nw - W) >= 2 || Math.abs(nh - H) >= 2) {
    W = nw; H = nh; CHK.orient.resizesApplied++; CHK.orient.last = W + 'x' + H;
    if (boot === 'poll') CHK.orient.lateFixes++;
    if (renderer) renderer.setSize(W, H, false);
    camera.aspect = W / H; camera.updateProjectionMatrix(); emberMat.uniforms.uScale.value = H / (2 * Math.tan(TUNE.fov * Math.PI / 360));
    layoutControls();
  }
  updatePause();
}
function onResize() { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => applyResize(), 100); }
addEventListener('resize', onResize); addEventListener('orientationchange', onResize);
if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
// catches a size that settles after the last resize event
setInterval(() => {
  if (innerWidth > innerHeight && innerHeight < CHK.orient.lowestH) CHK.orient.lowestH = innerHeight;
  const [w, h] = viewSize();
  if (Math.abs(w - W) >= 2 || Math.abs(h - H) >= 2) applyResize('poll');
}, 400);
function updatePause() {
  const rot = P.has('rot');
  $('#rot').style.display = rot ? 'flex' : 'none';
  $('#tap').style.display = (!rot && P.size && started) ? 'flex' : 'none';
  if (P.size) { lastT = 0; acc = 0; }
}
$('#tap').addEventListener('pointerup', async (e) => {
  e.preventDefault(); P.delete('vis'); P.delete('audio');
  try { if (A.ctx) await A.ctx.resume(); } catch (er) { /* ignore */ }
  lastT = 0; acc = 0; dropAllPointers(); updatePause();
});
document.addEventListener('visibilitychange', () => { if (document.hidden) { CHK.visHidden++; if (started) { P.add('vis'); try { A.ctx && A.ctx.suspend(); } catch (e) { /* ignore */ } updatePause(); } } });
addEventListener('pagehide', () => { if (started) { P.add('vis'); updatePause(); } });

/* ---------- test guide, palette, tuning and checks ---------- */
const ov = $('#ov'), banner = $('#banner'), bannerText = $('#bt'), toastEl = $('#toast');
let ovTouch = false, ovHold = 0, ovOpen = false, ovTab = 'guide', reportText = '', lastBanner = '', bannerAt = 0;
function openOverlay(tab) { if (tab) ovTab = tab; ovOpen = true; ov.style.display = 'flex'; renderOverlay(true); }
function closeOverlay() { ovOpen = false; ov.style.display = 'none'; }
function toggleOverlay() { if (ovOpen) closeOverlay(); else openOverlay(); }
function toast(msg) { toastEl.textContent = msg; toastEl.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(() => { toastEl.style.display = 'none'; }, 4000); }
function f1(v) { return (Math.round(v * 100) / 100).toString(); }

const TUNERS = [
  ['gravity', () => Sim.T.gravity, (v) => { Sim.T.gravity = v; }, 1, 28],
  ['run speed', () => Sim.T.runSpeed, (v) => { Sim.T.runSpeed = v; }, 0.5, 7],
  ['earth hold (steps)', () => Sim.T.earthHold, (v) => { Sim.T.earthHold = v; }, 1, 15],
  ['camera settle (s)', () => Sim.T.camSettle, (v) => { Sim.T.camSettle = Math.max(0.05, v); }, 0.02, 0.2],
  ['outline px', () => TUNE.outlinePx, (v) => { TUNE.outlinePx = Math.max(0.5, v); }, 0.5, 3],
  ['fog near (m)', () => U.uFogNear.value, (v) => { U.uFogNear.value = v; }, 5, 40],
  ['fog far (m)', () => U.uFogFar.value, (v) => { U.uFogFar.value = v; }, 20, 220],
  ['ladder down ms', () => TUNE.downMs, (v) => { TUNE.downMs = v; }, 0.5, 18.5],
  ['ladder up ms', () => TUNE.upMs, (v) => { TUNE.upMs = v; }, 0.5, 13.5]
];
const PALDEF = { skyTop: PAL.teal, horizon: PAL.orange, fog: PAL.teal, ground: PAL.basalt, rim: '#ff9f1c' };
const PALNOW = Object.assign({}, PALDEF);
const PALLABEL = { skyTop: 'Sky top', horizon: 'Horizon glow', fog: 'Fog', ground: 'Ground', rim: 'Rim light' };
const PALAPPLY = {
  skyTop(h) { skyMat.uniforms.uTop.value.copy(hex3(h)); },
  horizon(h) { skyMat.uniforms.uHor.value.copy(hex3(h)); },
  fog(h) { U.uFogCol.value.copy(hex3(h)); },
  ground(h) { fillGround(groundGeo, h); },
  rim(h) { U.uRim.value.copy(hex3(h)); }
};
function palChanges() { return Object.keys(PALNOW).filter(k => PALNOW[k].toLowerCase() !== PALDEF[k].toLowerCase()).map(k => PALLABEL[k] + ' ' + PALNOW[k]); }
function tuneChanges() { return TUNERS.filter(t => Math.abs(t[1]() - t[4]) > 1e-9).map(t => t[0] + ' = ' + f1(t[1]())); }

function touchTicks() {
  const tc = TOUCH;
  return [['3 fingers at once', tc.testMax >= 3], ['slide ATK to JMP', tc.slideAJ > 0], ['tap EAR', sim.needles - tc.baseN > 0], ['hold EAR', sim.boulders - tc.baseB > 0], ['edge swipe', tc.edgeDrags > 0]];
}
// one entry per exit check: [key, title, status, detail]
function checkRows() {
  const R = [];
  const sb = CHK.sandbox;
  R.push(['sandbox', 'Sandbox', sb ? (sb.pass ? 'PASS' : 'FAIL') : 'PENDING', sb ? `WebGL2 ${sb.gl2}, Three.js r${sb.rev}, Pointer Events ${sb.pe}, audio ${sb.ac}, storage ${sb.store}, page ${(sb.size / 1e6).toFixed(2)} MB` : '']);
  const r = CHK.render;
  R.push(['render', 'Rendering', r ? (r.done ? (r.stopped ? 'PENDING' : (r.pass ? 'PASS' : 'FAIL')) : 'RUNNING') : 'PENDING', r && r.done && !r.stopped ? `average ${f1(r.fps)} fps, slowest ladder step ${r.worst + 1}, floor frames ${r.floorFrames}, ${r.calls} draw calls, ${r.tris} triangles, edge smoothing ${r.aa ? 'on' : 'off'}` + ['off', 'on'].map(k => { const q = CHK.renderRuns[k]; return q ? `; run with smoothing ${k}: ${f1(q.fps)} fps, slowest step ${q.worst + 1}, floor frames ${q.floorFrames}, ${q.pass ? 'pass' : 'fail'}` : ''; }).join('') : (r && !r.done ? 'running' : '')]);
  const tc = TOUCH;
  R.push(['touch', 'Touch', tc.result === 'running' ? 'RUNNING' : (tc.result || 'PENDING'), `most fingers ${tc.testMax || tc.maxSim}, slides ATK to JMP ${tc.slideAJ}, taps ${sim.needles - tc.baseN}, holds ${sim.boulders - tc.baseB}, edge swipes ${tc.edgeDrags}, cancelled touches ${tc.cancels} (edge ${tc.edgeCancels}, other ${tc.violations}), touches starting in the edge zone ${tc.edgeDowns}, lowest touch x ${tc.minX0 === 1e9 ? '-' : Math.round(tc.minX0)}, edge zone ${Math.round(UI.edge)} px`]);
  const au = CHK.audio, done = au.state === 'running' && au.decodeOk && au.fx > 0 && au.hit > 0 && au.music > 0 && au.amb > 0 && au.uw > 0;
  R.push(['audio', 'Audio', done ? 'PASS' : 'PENDING', `context ${au.state || 'off'}, decode ${au.decodeOk}, effect ${au.fx}, hit ${au.hit}, music ${au.music}${A.musicRouted === false ? ' (not routed to the music bus)' : ''}, ambience ${au.amb}, underwater ${au.uw}, silent switch: ${au.silent.join('; ') || 'not recorded'}`]);
  const so = CHK.soak;
  R.push(['soak', 'Soak', so ? (so.done ? (so.stopped ? 'PENDING' : (so.pass ? 'PASS' : 'FAIL')) : 'RUNNING') : 'PENDING', so ? `ladder changes after minute 1: ${so.changes}, GL context lost ${CHK.ctxLost} and restored ${CHK.ctxRestored}, app left ${CHK.visHidden} times, page reloaded: ${so.reload}` : '']);
  const o = CHK.orient;
  R.push(['orient', 'Orientation', o.portraitPauses > 0 && o.resizesApplied > 0 ? 'SEEN' : 'PENDING', `upright pauses ${o.portraitPauses}, resizes seen ${o.resizesSeen}, applied ${o.resizesApplied}, size ${o.last}`]);
  const rp = CHK.replay;
  R.push(['replay', 'Replay', rp ? (rp.pass ? 'PASS' : 'FAIL') : 'PENDING', rp ? `${rp.kind}, ${rp.steps} steps, same final state ${rp.same}, NaN ${rp.nan}, falls ${rp.kill}, longest frame ${rp.maxInt} ms at frame ${rp.maxAt}` : rep.status]);
  return R;
}
function buildReport() {
  const lines = ['Ninja Saga ' + BUILD + ' report', 'Three.js r' + THREE.REVISION + ', page ' + (FILE_SIZE / 1e6).toFixed(2) + ' MB, screen ' + W + 'x' + H + ', ladder step ' + (ladderStep + 1) + (floorMode ? ' (30 fps floor)' : '') + (lpm ? ' (low power mode)' : '') + ', standalone ' + (navigator.standalone === true ? 'yes' : 'no') + ', cyan flags ' + ROLE_FLAGS.length];
  checkRows().forEach(l => lines.push(l[1] + ': ' + l[2] + (l[3] ? ' | ' + l[3] : '')));
  lines.push('View: ' + viewDiag());
  const pc = palChanges(), tc = tuneChanges();
  lines.push('Palette changes: ' + (pc.length ? pc.join(', ') : 'none'));
  lines.push('Tuning changes: ' + (tc.length ? tc.join(', ') : 'none'));
  lines.push('Ladder log: ' + (ladderLog.slice(-12).map(l => Math.round(l[0] / 1000) + 's step ' + (l[1] + 1) + (l[2] ? ' ' + l[2] : '')).join(', ') || 'no changes'));
  return lines.join('\n');
}
function doCopy() {
  reportText = buildReport();
  const finish = (good) => {
    if (good) toast('Report copied. Switch to the Claude chat and paste it.');
    else { toast('Copy was blocked. Press and hold the box at the bottom, choose Select All, then Copy.'); openOverlay('guide'); const ta = ov.querySelector('textarea'); if (ta) { ta.focus(); ta.select(); } }
  };
  try { navigator.clipboard.writeText(reportText).then(() => finish(true), () => finish(false)); } catch (e) { finish(false); }
}

function ticked(n) { return (n > 0 ? '&#10003; ' : ''); }
function renderOverlay(force) {
  if (!ovOpen) return;
  ov.classList.toggle('narrow', ovTab !== 'guide');
  const tabs = ['guide', 'stats', 'palette', 'tune'].map(t => `<button data-tab="${t}" class="${t === ovTab ? 'sel' : ''}">${t}</button>`).join('') +
    '<button data-act="copy" class="go">Copy report</button><button data-act="close">&times;</button>';
  let body = '';
  const R = checkRows(), S = {}; R.forEach(r => { S[r[0]] = r; });
  const badge = (k) => `<b class="${S[k][2]}">${S[k][2]}</b>`;
  const detail = (k) => S[k][3] ? `<small>${S[k][3]}</small>` : '';
  if (ovTab === 'guide') {
    const au = CHK.audio;
    reportText = buildReport();
    body = `<div class="scroll">
<p class="intro"><b>How this works.</b> Work through the steps below. Each one shows PASS, FAIL or PENDING. When you are done, tap <b>Copy report</b> at the top, switch to the Claude chat, paste and send.</p>
<div class="step">${badge('sandbox')} <b>1 &middot; Sandbox</b><p>Automatic. Nothing to do.</p>${detail('sandbox')}</div>
<div class="step">${badge('render')} <b>2 &middot; Rendering</b><p>Tap Start. This panel closes and a heavy scene appears. Run around with the stick for 60 seconds. The panel returns with the result. Run it once with edge smoothing off and once on. Both results go into the report. Tell me which looks better.</p>
<div class="row wrap"><button data-act="render">Start 60 s test</button><button data-act="aa">Edge smoothing: ${aaOn ? 'on' : 'off'} (tap to switch)</button></div>${detail('render')}</div>
<div class="step">${badge('touch')} <b>3 &middot; Touch</b><p>Tap Start. For 60 seconds, do all of these: hold the stick on the left, drag on the right to turn the camera, tap EAR quickly, hold EAR for half a second, slide your thumb from ATK up to JMP, and put your thumb on the very left edge of the screen and drag it right about a centimetre. Ticks appear at the top as you go. Keep playing until the timer ends.</p>
<div class="row wrap"><button data-act="touch">Start 60 s test</button></div>${detail('touch')}</div>
<div class="step">${badge('audio')} <b>4 &middot; Audio</b><p>Turn the volume up and tap each button. A tick shows once a sound has played. These are test tones, the real sounds come later.</p>
<div class="row wrap"><button data-act="fx">${ticked(au.fx)}Effect</button><button data-act="hit">${ticked(au.hit)}Hit layers</button><button data-act="music">${ticked(au.music)}Music</button><button data-act="amb">${ticked(au.amb)}Ambience</button><button data-act="uw">${ticked(au.uw)}Underwater</button></div>
<p>Silent switch test. Flip the side switch to silent, tap Effect, then tap one of the first two buttons below. Flip it to ring, tap Effect, then tap the third button. Each button records one line.</p>
<div class="row wrap"><button data-act="sil1">Silent: I heard it</button><button data-act="sil2">Silent: no sound</button><button data-act="sil3">Ring: I heard it</button></div>${detail('audio')}</div>
<div class="step">${badge('soak')} <b>5 &middot; Soak</b><p>Set Auto-Lock to Never in iPhone Settings first. Tap Start and keep the page open for 15 minutes. You can play or leave it. Once, press the Home button for about 5 seconds and come back. The second button simulates a graphics reset.</p>
<div class="row wrap"><button data-act="soak">Start 15 min soak</button><button data-act="lose">Reset graphics once</button></div>${detail('soak')}</div>
<div class="step">${badge('orient')} <b>6 &middot; Orientation</b><p>Turn the phone upright, then back to landscape, once. The game pauses while upright and resumes in landscape. The status shows SEEN when done.</p>${detail('orient')}</div>
<div class="step">${badge('replay')} <b>7 &middot; Replay</b><p>Tap Run bot. The game plays a scripted 30 second run by itself and checks that nothing breaks. For your own run, tap Record, move for 10 seconds, tap Stop, then tap Replay.</p>
<div class="row wrap"><button data-act="bot">Run bot</button><button data-act="rec">${rep.rec ? 'Stop' : 'Record'}</button><button data-act="play">Replay</button></div><small>${rep.status}</small></div>
<div class="step"><b>8 &middot; Look</b><p>Storm has white hair, a red scarf and a cyan belt. The sky is orange at the horizon and teal above. Open the palette tab to change colors, and the report lists your changes. Tell me in the chat how it looks.</p></div>
<p class="intro">Report preview. <button data-act="copy" class="go">Copy report</button></p>
<textarea readonly rows="8">${reportText.replace(/</g, '&lt;')}</textarea></div>`;
  } else if (ovTab === 'stats') {
    let ow = []; owners.forEach(o => ow.push(o.kind + (o.kind === 'btn' ? ':' + BTN[o.btn].id : '')));
    body = `<pre>build ${BUILD}  Three r${THREE.REVISION}
fps ${f1(M.fps)}  interval ${f1(M.avg)} ms  max ${f1(M.max)}
sim ${f1(M.simMs)} ms  render cpu ${f1(M.renderMs)} ms
draws ${M.calls}  tris ${M.tris}
ladder ${ladderStep + 1} (x${LADDER[ladderStep]})${floorMode ? '  FLOOR' : ''}${lpm ? '  LOW POWER' : ''}
steps/frame ${stepsThisFrame}  step ${sim.step}
embers ${emberLive}/${EMBERS}  voices ${A.voices}
audio ${CHK.audio.state || 'off'}  pointers ${ow.join(', ') || '-'}
pos ${f1(sim.x)}, ${f1(sim.y)}, ${f1(sim.z)}  ${sim.grounded ? 'ground' : 'air'}
cam yaw ${f1(sim.yawOff)} pitch ${f1(sim.pitch)}
earth last hold ${sim.lastEarthHold} steps
edge smoothing ${aaOn ? 'on' : 'off'}  cyan flags ${ROLE_FLAGS.length}
${viewDiag()}</pre>`;
    M.max = 0;
  } else if (ovTab === 'palette') {
    body = '<div class="scroll"><p class="intro">Tap a swatch to pick a color. The scene updates live. Changed values go into the report.</p>' +
      Object.keys(PALNOW).map(k => `<div class="row"><span>${PALLABEL[k]}</span><input type="color" data-pal="${k}" value="${PALNOW[k]}"><code id="pv-${k}">${PALNOW[k]}</code><button data-reset="${k}">reset</button></div>`).join('') + '</div>';
  } else {
    body = '<div class="scroll">' + TUNERS.map((t, i) => `<div class="row"><span>${t[0]}</span><b>${f1(t[1]())}</b><button data-tune="${i}" data-d="-1">-</button><button data-tune="${i}" data-d="1">+</button></div>`).join('') + '</div>';
  }
  const sc0 = ov.querySelector('.scroll'), st0 = sc0 ? sc0.scrollTop : 0;
  ov.innerHTML = `<div class="tabs">${tabs}</div>${body}`;
  const sc1 = ov.querySelector('.scroll'); if (sc1) sc1.scrollTop = st0;
}
ov.addEventListener('pointerdown', () => { ovTouch = true; });
addEventListener('pointerup', () => { ovTouch = false; ovHold = now() + 800; }, true);
addEventListener('pointercancel', () => { ovTouch = false; ovHold = now() + 800; }, true);
ov.addEventListener('click', (e) => { const b = e.target.closest('[data-act="copy"]'); if (b) { e.preventDefault(); doCopy(); } });
ov.addEventListener('input', (e) => {
  const el = e.target; if (!el.dataset || !el.dataset.pal) return;
  PALNOW[el.dataset.pal] = el.value; PALAPPLY[el.dataset.pal](el.value);
  const c = ov.querySelector('#pv-' + el.dataset.pal); if (c) c.textContent = el.value;
});
ov.addEventListener('pointerup', (e) => {
  const b = e.target.closest('button'); if (!b || b.dataset.act === 'copy') return;
  e.preventDefault();
  if (b.dataset.tab) { ovTab = b.dataset.tab; renderOverlay(true); return; }
  if (b.dataset.tune !== undefined) { const t = TUNERS[+b.dataset.tune]; t[2](Math.round((t[1]() + t[3] * +b.dataset.d) * 1000) / 1000); renderOverlay(true); return; }
  if (b.dataset.reset) { const k = b.dataset.reset; PALNOW[k] = PALDEF[k]; PALAPPLY[k](PALDEF[k]); renderOverlay(true); return; }
  const a = b.dataset.act;
  if (a === 'close') { closeOverlay(); return; }
  else if (a === 'render') startRenderTest();
  else if (a === 'aa') { makeRenderer(!aaOn); camera.aspect = W / H; camera.updateProjectionMatrix(); M.rn = 0; }
  else if (a === 'touch') startTouchTest();
  else if (a === 'fx') playFx(); else if (a === 'hit') playHit(); else if (a === 'music') toggleMusic(); else if (a === 'amb') toggleAmb(); else if (a === 'uw') toggleUW();
  else if (a === 'sil1') { CHK.audio.silent.push('silent on, heard'); toast('Recorded: silent on, heard.'); }
  else if (a === 'sil2') { CHK.audio.silent.push('silent on, muted'); toast('Recorded: silent on, no sound.'); }
  else if (a === 'sil3') { CHK.audio.silent.push('ring on, heard'); toast('Recorded: ring on, heard.'); }
  else if (a === 'soak') startSoak();
  else if (a === 'lose') loseContext();
  else if (a === 'rec') { if (rep.rec) stopRec(); else startRec(); }
  else if (a === 'play') { startReplay(); if (rep.play) closeOverlay(); }
  else if (a === 'bot') { startBot(); closeOverlay(); }
  renderOverlay(true);
});
setInterval(() => { if (ovOpen && ovTab !== 'palette' && !ovTouch && now() > ovHold && !(document.activeElement && (document.activeElement.tagName === 'TEXTAREA' || document.activeElement.tagName === 'INPUT'))) renderOverlay(); }, 500);

// progress banner shown while a test runs, so the screen stays free for play
function bannerHtml() {
  const t = now(), r = CHK.render, so = CHK.soak;
  if (r && !r.done) return `<b>Render test</b> ${Math.max(0, 60 - Math.round((t - r.t0) / 1000))} s left. Just play. ${f1(M.fps)} fps, step ${ladderStep + 1}`;
  if (TOUCH.result === 'running') return `<b>Touch test</b> ${Math.max(0, Math.round((TOUCH.testEnd - t) / 1000))} s left. ` + touchTicks().map(x => (x[1] ? '&#10003; ' : '&#9675; ') + x[0]).join(' &nbsp; ');
  if (so && !so.done) { const left = Math.max(0, Math.round((900000 - (t - so.t0)) / 1000)); return `<b>Soak</b> ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} left. Keep the screen on. Press Home for 5 s once, then return. Left the app ${CHK.visHidden} times`; }
  if (rep.rec) return `<b>Recording</b> ${rep.data.length} steps. Open the panel and tap Stop`;
  if (rep.play || rep.bot) return `<b>${rep.bot ? 'Bot run' : 'Replay'}</b> in progress`;
  return '';
}
function updateBanner() {
  const t = now(); if (t - bannerAt < 250) return; bannerAt = t;
  const h = bannerHtml();
  if (h !== lastBanner) { lastBanner = h; bannerText.innerHTML = h; banner.style.display = h ? 'flex' : 'none'; }
}
banner.addEventListener('pointerup', (e) => {
  const b = e.target.closest('button'); if (!b) return; e.preventDefault();
  if (b.dataset.act === 'panel') openOverlay('guide'); else if (b.dataset.act === 'stop') stopTests();
});
function stopTests() {
  if (CHK.render && !CHK.render.done) { CHK.render.done = true; CHK.render.stopped = true; }
  if (CHK.soak && !CHK.soak.done) { CHK.soak.done = true; CHK.soak.stopped = true; tryStore(() => sessionStorage.removeItem('ns_soak'), 0); }
  if (TOUCH.result === 'running') TOUCH.result = null;
  stopReplayModes(); rep.status = 'stopped'; stress.visible = false; lastBanner = ''; bannerAt = 0; updateBanner(); openOverlay('guide');
}
function finished(msg) { stress.visible = false; openOverlay('guide'); toast(msg); }

function startRenderTest() {
  floorMode = false; lpm = false; if (ladderStep !== 0) setLadder(0); // every run starts from the top of the ladder
  stress.visible = true; M.rn = 0; closeOverlay();
  CHK.render = { t0: now(), done: false, sum: 0, n: 0, worst: 0, floorFrames: 0, calls: 0, tris: 0, fps: 0, pass: false, aa: aaOn };
}
function startTouchTest() {
  Object.assign(TOUCH, { result: 'running', testT0: now(), testEnd: now() + 60000, violations: 0, testMax: 0, slideAJ: 0, edgeDrags: 0, edgeDowns: 0, minX0: 1e9, edgeCancels: 0, cancels: 0, baseN: sim.needles, baseB: sim.boulders });
  closeOverlay();
}
function startSoak() {
  stress.visible = true; M.rn = 0; closeOverlay();
  const prior = tryStore(() => sessionStorage.getItem('ns_soak'), null);
  CHK.soak = { t0: now(), done: false, changes: 0, pass: false, reload: prior ? 'YES (page reloaded during an earlier soak)' : 'no' };
  tryStore(() => sessionStorage.setItem('ns_soak', String(Date.now())), 0);
}
function loseContext() {
  const gl = renderer.getContext(), ext = gl.getExtension('WEBGL_lose_context');
  if (!ext) { toast('This browser blocks the graphics reset test.'); return; }
  ext.loseContext(); setTimeout(() => ext.restoreContext(), 1000); toast('Graphics reset started. The game pauses for a second.');
}
function testTick() {
  const t = now(), r = CHK.render;
  if (r && !r.done) {
    r.sum += M.avg; r.n++; r.worst = Math.max(r.worst, ladderStep); if (floorMode) r.floorFrames++;
    if (t - r.t0 >= 60000) {
      r.done = true; r.fps = 1000 / (r.sum / r.n); r.calls = M.calls; r.tris = M.tris;
      r.pass = r.fps >= 58 && r.worst <= 2 && r.floorFrames === 0; // step 3 (x1.0) is allowed, step 4 and the floor are not
      CHK.renderRuns[r.aa ? 'on' : 'off'] = { fps: r.fps, worst: r.worst, floorFrames: r.floorFrames, pass: r.pass };
      finished('Render test finished: ' + (r.pass ? 'PASS' : 'FAIL') + ', ' + f1(r.fps) + ' fps.');
    }
  }
  const so = CHK.soak;
  if (so && !so.done && t - so.t0 >= 900000) {
    so.done = true; so.pass = so.changes <= 2 && so.reload === 'no' && CHK.ctxRestored >= CHK.ctxLost;
    tryStore(() => sessionStorage.removeItem('ns_soak'), 0); finished('Soak finished: ' + (so.pass ? 'PASS' : 'FAIL') + '.');
  }
  if (TOUCH.result === 'running' && t >= TOUCH.testEnd) {
    const ok = touchTicks().every(x => x[1]);
    TOUCH.result = (TOUCH.violations === 0 && TOUCH.edgeCancels === 0 && ok) ? 'PASS' : 'FAIL';
    finished('Touch test finished: ' + TOUCH.result + (ok ? '.' : '. Some actions were not done.'));
  }
  updateBanner();
}

/* ---------- boot ---------- */
function sandboxReport() {
  const store = !!tryStore(() => { localStorage.setItem('ns_t', '1'); localStorage.removeItem('ns_t'); return true; }, false);
  const gl2 = webgl2Ok(), pe = 'PointerEvent' in window, ac = !!(window.AudioContext || window.webkitAudioContext);
  CHK.sandbox = { gl2, pe, ac, store, rev: THREE.REVISION, size: FILE_SIZE, pass: gl2 && pe && ac && FILE_SIZE < 12e6 };
}
function boot() {
  buildControls();
  sandboxReport();
  $('#ver').textContent = `${BUILD} · Three.js r${THREE.REVISION} · ${(FILE_SIZE / 1e6).toFixed(2)} MB`;
  if (!CHK.sandbox.gl2) { $('#startMsg').textContent = 'This page needs WebGL2 (Safari 15 or later).'; return; }
  makeRenderer(false);
  camera.aspect = W / H; camera.updateProjectionMatrix(); emberMat.uniforms.uScale.value = H / (2 * Math.tan(TUNE.fov * Math.PI / 360));
  setEmberLive(); layoutControls(); applyResize(true);
  { const [vw, vh] = viewSize(); if (Math.abs(vw - W) >= 2 || Math.abs(vh - H) >= 2) applyResize('poll'); }
  const go = async (e, test) => {
    if (started) return; e.preventDefault();
    started = true;
    $('#start').style.display = 'none';
    try { await audioInit(); } catch (er) { CHK.audio.decodeOk = false; }
    lastT = 0; acc = 0;
    if (test) openOverlay('guide');
  };
  [['#playBtn', false], ['#testBtn', true]].forEach(([id, t]) => { const el = $(id); let fired = 0; const h = (e) => { if (now() - fired < 400) return; fired = now(); go(e, t); }; el.addEventListener('touchend', h); el.addEventListener('click', h); });
  $('#tb').addEventListener('pointerup', (e) => { e.preventDefault(); if (started) toggleOverlay(); });
  requestAnimationFrame(frame);
}
window.__NS = { openOverlay, closeOverlay, doCopy, buildReport, sim, Sim, CHK, TOUCH, M, owners, get started() { return started; }, P, startRenderTest, startBot, rep, ROLE_FLAGS, BTN, btnPos };
boot();
})();
