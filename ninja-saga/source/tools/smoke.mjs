// Headless smoke test over CDP. Usage: node smoke.mjs <index.html> <shot.png>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const [file, shot] = process.argv.slice(2);
const port = 9333;
const chrome = spawn('google-chrome', ['--headless=new', `--remote-debugging-port=${port}`, '--no-sandbox', '--disable-gpu-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--window-size=844,390', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let ws, id = 0; const pending = new Map(); const logs = [];
function send(method, params = {}) { return new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); }); }
async function connect() {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json`); const t = (await r.json()).find(x => x.type === 'page'); if (t) { ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; }); return; } } catch (e) { /* retry */ }
    await sleep(250);
  }
  throw new Error('no chrome');
}
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return 'EXC ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text); return r.result.value; };
const touch = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id })) });
try {
  await connect();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(JSON.stringify(d.error))) : p.res(d.result); }
    else if (d.method === 'Runtime.consoleAPICalled') logs.push(d.params.type + ': ' + d.params.args.map(a => a.value ?? a.description).join(' '));
    else if (d.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION: ' + JSON.stringify(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text));
    else if (d.method === 'Log.entryAdded') logs.push('log ' + d.params.entry.level + ': ' + d.params.entry.text);
  };
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 1, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Page.navigate', { url: 'file://' + file });
  await sleep(2500);
  console.log('loaded:', await ev('typeof window.__NS + " gl2=" + JSON.stringify(window.__NS && window.__NS.CHK.sandbox)'));
  await touch('touchStart', [[422, 200, 1]]); await touch('touchEnd', []);
  await sleep(1500);
  console.log('started:', await ev('window.__NS.started'), 'audio:', await ev('JSON.stringify(window.__NS.CHK.audio)'));
  // stick drag right while camera drag and ATK held (three pointers)
  await touch('touchStart', [[120, 280, 1]]); await touch('touchMove', [[190, 280, 1]]);
  await sleep(300);
  await touch('touchMove', [[190, 280, 1], [500, 150, 2]]); // cam finger down (touchMove with a new id acts as start in CDP? use touchStart)
  await sleep(100);
  console.log('owners (after stick):', await ev('JSON.stringify([...window.__NS.owners.values()].map(o=>o.kind))'));
  await sleep(1200);
  console.log('pos after 1.5s right:', await ev('JSON.stringify([window.__NS.sim.x.toFixed(2), window.__NS.sim.y.toFixed(2), window.__NS.sim.z.toFixed(2)])'));
  const btn = await ev('JSON.stringify(window.__NS.btnPos)');
  console.log('btnPos', btn);
  const bp = JSON.parse(btn);
  // tap jump
  await touch('touchStart', [[120, 280, 1], [bp[1].x, bp[1].y, 3]]); await sleep(120); await touch('touchEnd', [[120, 280, 1]]);
  await sleep(150);
  console.log('jumps', await ev('window.__NS.sim.jumps'), 'y', await ev('window.__NS.sim.y.toFixed(2)'));
  await touch('touchEnd', []);
  await sleep(300);
  // earth tap and hold on EAR
  await touch('touchStart', [[bp[3].x, bp[3].y, 4]]); await sleep(100); await touch('touchEnd', []); await sleep(100);
  await touch('touchStart', [[bp[3].x, bp[3].y, 5]]); await sleep(500); await touch('touchEnd', []); await sleep(100);
  console.log('needles', await ev('window.__NS.sim.needles'), 'boulders', await ev('window.__NS.sim.boulders'));
  // slide ATK -> JMP
  await touch('touchStart', [[bp[0].x, bp[0].y, 6]]); await sleep(80); await touch('touchMove', [[bp[1].x, bp[1].y, 6]]); await sleep(80); await touch('touchEnd', []);
  console.log('slideAJ', await ev('window.__NS.TOUCH.slideAJ'), 'attacks', await ev('window.__NS.sim.attacks'));
  // open overlay via five taps, run scripted bot
  for (let i = 0; i < 5; i++) { await touch('touchStart', [[422, 20, 7]]); await touch('touchEnd', []); await sleep(60); }
  await sleep(500);
  console.log('overlay display:', await ev('getComputedStyle(document.querySelector("#ov")).display'));
  await ev('window.__NS.startBot()'); await ev('window.__NS.startRenderTest()');
  await sleep(35000);
  console.log('bot:', await ev('JSON.stringify(window.__NS.CHK.replay)'));
  console.log('stats:', await ev('JSON.stringify({fps:window.__NS.M.fps.toFixed(1),avg:window.__NS.M.avg.toFixed(1),calls:window.__NS.M.calls,tris:window.__NS.M.tris})'));
  const s = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(shot, Buffer.from(s.data, 'base64'));
  console.log('cyan flags', await ev('window.__NS.ROLE_FLAGS.length'));
} catch (e) { console.log('ERR', e.message); }
console.log('--- console ---'); console.log(logs.slice(0, 30).join('\n'));
chrome.kill(); process.exit(0);
