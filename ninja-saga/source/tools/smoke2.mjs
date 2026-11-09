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
    else if (d.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION: ' + JSON.stringify(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text));
  };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 1, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Page.navigate', { url: 'file://' + file });
  await sleep(2000);
  await touch('touchStart', [[422, 200, 1]]); await touch('touchEnd', []); await sleep(1500);
  console.log('before rotate: P=', await ev('window.__NS.P.size'));
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(700);
  console.log('portrait: P=', await ev('JSON.stringify([...window.__NS.P])'), 'rot display', await ev('getComputedStyle(document.querySelector("#rot")).display'));
  await send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 1, mobile: true });
  await sleep(700);
  console.log('landscape again: P=', await ev('window.__NS.P.size'), 'orient', await ev('JSON.stringify(window.__NS.CHK.orient)'));
  for (let i = 0; i < 5; i++) { await touch('touchStart', [[422, 20, 7]]); await touch('touchEnd', []); await sleep(60); }
  await sleep(300);
  await touch('touchStart', [[360, 20, 8]]); await touch('touchEnd', []); // placeholder tap area
  await ev('document.querySelector("#ov [data-tab=checks]").dispatchEvent(new PointerEvent("pointerup",{bubbles:true}))');
  await sleep(600);
  const s = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(shot, Buffer.from(s.data, 'base64'));
  console.log('overlay tab buttons:', await ev('document.querySelectorAll("#ov button").length'));
} catch (e) { console.log('ERR', e.message); }
console.log(logs.join('\n')); chrome.kill(); process.exit(0);
