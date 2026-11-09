import { spawn } from 'node:child_process';
const [file, shot] = process.argv.slice(2);
const port = 9334;
const chrome = spawn('google-chrome', ['--headless=new', `--remote-debugging-port=${port}`, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--window-size=844,390', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let ws, id = 0; const pending = new Map(); const logs = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? 'EXC ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text) : r.result.value; };
try {
  for (let i = 0; i < 40; i++) { try { const t = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(x => x.type === 'page'); if (t) { ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; }); break; } } catch (e) {} await sleep(250); }
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(JSON.stringify(d.error))) : p.res(d.result); } else if (d.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text)); };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: 'file://' + file }); await sleep(2000);
  console.log('buttons', await ev('!!document.querySelector("#playBtn")&&!!document.querySelector("#testBtn")'));
  await ev('document.querySelector("#testBtn").click()'); await sleep(1500);
  console.log('started', await ev('window.__NS.started'), 'ov', await ev('getComputedStyle(document.querySelector("#ov")).display'));
  await send('Page.captureScreenshot', {}).then(r => import('node:fs').then(f => f.writeFileSync(shot + '-guide.png', Buffer.from(r.data, 'base64'))));
  console.log(await ev('window.__NS.buildReport()'));
  await ev('document.querySelector("#ov [data-act=render]").dispatchEvent(new PointerEvent("pointerup",{bubbles:true}))'); await sleep(1200);
  console.log('banner', await ev('document.querySelector("#banner").style.display+" | "+document.querySelector("#bt").textContent'));
  await send('Page.captureScreenshot', {}).then(r => import('node:fs').then(f => f.writeFileSync(shot + '-banner.png', Buffer.from(r.data, 'base64'))));
  await ev('document.querySelector("#tb").dispatchEvent(new PointerEvent("pointerup",{bubbles:true}))'); await sleep(500);
  await ev('document.querySelector("#ov [data-tab=palette]").dispatchEvent(new PointerEvent("pointerup",{bubbles:true}))'); await sleep(300);
  await ev('(()=>{const i=document.querySelector("#ov [data-pal=skyTop]");i.value="#ff0000";i.dispatchEvent(new Event("input",{bubbles:true}))})()'); await sleep(300);
  await send('Page.captureScreenshot', {}).then(r => import('node:fs').then(f => f.writeFileSync(shot + '-palette.png', Buffer.from(r.data, 'base64'))));
  console.log(await ev('window.__NS.buildReport().split("\\n").filter(l=>/Palette/.test(l)).join()'));
  console.log('errors', JSON.stringify(logs));
} catch (e) { console.log('FAIL', e.message, JSON.stringify(logs)); }
chrome.kill(); process.exit(0);
