/* ---------- test guide, palette, tuning and checks ---------- */
const ov = $('#ov'), banner = $('#banner'), bannerText = $('#bt'), toastEl = $('#toast');
let ovTouch = false, ovHold = 0, ovOpen = false, ovTab = 'guide', reportText = '', lastBanner = '', bannerAt = 0;
function openOverlay(tab) { if (tab) ovTab = tab; ovOpen = true; ov.style.display = 'block'; renderOverlay(true); }
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
  R.push(['render', 'Rendering', r ? (r.done ? (r.stopped ? 'PENDING' : (r.pass ? 'PASS' : 'FAIL')) : 'RUNNING') : 'PENDING', r && r.done && !r.stopped ? `average ${f1(r.fps)} fps, slowest ladder step ${r.worst + 1}, floor frames ${r.floorFrames}, ${r.calls} draw calls, ${r.tris} triangles, edge smoothing ${r.aa ? 'on' : 'off'}` : (r && !r.done ? 'running' : '')]);
  const tc = TOUCH;
  R.push(['touch', 'Touch', tc.result === 'running' ? 'RUNNING' : (tc.result || 'PENDING'), `most fingers ${tc.testMax || tc.maxSim}, slides ATK to JMP ${tc.slideAJ}, taps ${sim.needles - tc.baseN}, holds ${sim.boulders - tc.baseB}, edge swipes ${tc.edgeDrags}, cancelled touches ${tc.cancels} (edge ${tc.edgeCancels}, other ${tc.violations})`]);
  const au = CHK.audio, done = au.state === 'running' && au.decodeOk && au.fx > 0 && au.hit > 0 && au.music > 0 && au.amb > 0 && au.uw > 0;
  R.push(['audio', 'Audio', done ? 'PASS' : 'PENDING', `context ${au.state || 'off'}, decode ${au.decodeOk}, effect ${au.fx}, hit ${au.hit}, music ${au.music}${A.musicRouted === false ? ' (not routed to the music bus)' : ''}, ambience ${au.amb}, underwater ${au.uw}, silent switch: ${au.silent.join('; ') || 'not recorded'}`]);
  const so = CHK.soak;
  R.push(['soak', 'Soak', so ? (so.done ? (so.stopped ? 'PENDING' : (so.pass ? 'PASS' : 'FAIL')) : 'RUNNING') : 'PENDING', so ? `ladder changes after minute 1: ${so.changes}, GL context lost ${CHK.ctxLost} and restored ${CHK.ctxRestored}, app left ${CHK.visHidden} times, page reloaded: ${so.reload}` : '']);
  const o = CHK.orient;
  R.push(['orient', 'Orientation', o.portraitPauses > 0 && o.resizesApplied > 0 ? 'SEEN' : 'PENDING', `upright pauses ${o.portraitPauses}, resizes seen ${o.resizesSeen}, applied ${o.resizesApplied}, size ${o.last}`]);
  const rp = CHK.replay;
  R.push(['replay', 'Replay', rp ? (rp.pass ? 'PASS' : 'FAIL') : 'PENDING', rp ? `${rp.kind}, ${rp.steps} steps, same final state ${rp.same}, NaN ${rp.nan}, falls ${rp.kill}, longest frame ${rp.maxInt} ms` : rep.status]);
  return R;
}
function buildReport() {
  const lines = ['Ninja Saga ' + BUILD + ' report', 'Three.js r' + THREE.REVISION + ', page ' + (FILE_SIZE / 1e6).toFixed(2) + ' MB, screen ' + W + 'x' + H + ', ladder step ' + (ladderStep + 1) + (floorMode ? ' (30 fps floor)' : '') + (lpm ? ' (low power mode)' : '') + ', standalone ' + (navigator.standalone === true ? 'yes' : 'no') + ', cyan flags ' + ROLE_FLAGS.length];
  checkRows().forEach(l => lines.push(l[1] + ': ' + l[2] + (l[3] ? ' | ' + l[3] : '')));
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
<div class="step">${badge('render')} <b>2 &middot; Rendering</b><p>Tap Start. This panel closes and a heavy scene appears. Run around with the stick for 60 seconds. The panel returns with the result. Run it once with edge smoothing off and once on, then tell me which looks better.</p>
<div class="row wrap"><button data-act="render">Start 60 s test</button><button data-act="aa">Edge smoothing: ${aaOn ? 'on' : 'off'} (tap to switch)</button></div>${detail('render')}</div>
<div class="step">${badge('touch')} <b>3 &middot; Touch</b><p>Tap Start. For 60 seconds, do all of these: hold the stick on the left, drag on the right to turn the camera, tap EAR quickly, hold EAR for half a second, slide your thumb from ATK up to JMP, and swipe in from the very left edge of the screen. Ticks appear at the top as you go. Keep playing until the timer ends.</p>
<div class="row wrap"><button data-act="touch">Start 60 s test</button></div>${detail('touch')}</div>
<div class="step">${badge('audio')} <b>4 &middot; Audio</b><p>Turn the volume up and tap each button. A tick shows once a sound has played. These are test tones, the real sounds come later.</p>
<div class="row wrap"><button data-act="fx">${ticked(au.fx)}Effect</button><button data-act="hit">${ticked(au.hit)}Hit layers</button><button data-act="music">${ticked(au.music)}Music</button><button data-act="amb">${ticked(au.amb)}Ambience</button><button data-act="uw">${ticked(au.uw)}Underwater</button></div>
<p>Silent switch test. Flip the side switch to silent, tap Effect, then tell me what happened. Flip it back and repeat.</p>
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
edge smoothing ${aaOn ? 'on' : 'off'}  cyan flags ${ROLE_FLAGS.length}</pre>`;
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
  stress.visible = true; M.rn = 0; closeOverlay();
  CHK.render = { t0: now(), done: false, sum: 0, n: 0, worst: 0, floorFrames: 0, calls: 0, tris: 0, fps: 0, pass: false, aa: aaOn };
}
function startTouchTest() {
  Object.assign(TOUCH, { result: 'running', testT0: now(), testEnd: now() + 60000, violations: 0, testMax: 0, slideAJ: 0, edgeDrags: 0, edgeCancels: 0, cancels: 0, baseN: sim.needles, baseB: sim.boulders });
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
      r.pass = r.fps >= 58 && r.worst <= 1 && r.floorFrames === 0; finished('Render test finished: ' + (r.pass ? 'PASS' : 'FAIL') + ', ' + f1(r.fps) + ' fps.');
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

