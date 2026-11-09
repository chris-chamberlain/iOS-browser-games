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
  console.log('buttons', await ev('!!document.querySelector("#playBtn")&&!!document.querySelector("#testBtn")&&!!document.querySelector("#pb")'));
  await ev('document.querySelector("#playBtn").click()'); await sleep(1500);
  console.log('started', await ev('window.__NS.started'), 'world', await ev('window.__NS.sim.world'));
  await send('Page.captureScreenshot', {}).then(r => import('node:fs').then(f => f.writeFileSync(shot + '-play.png', Buffer.from(r.data, 'base64'))));
  console.log('sim', await ev('JSON.stringify(window.__NS.Sim.measure ? "ok" : "no")'));
  await ev('window.__NS.startCourseReplay()'); 
  for (let i = 0; i < 40; i++) { await sleep(2000); const d = await ev('(window.__NS.rep.play||window.__NS.rep.bot||window.__NS.rep.pilot)?0:1'); if (d === 1 && i > 1) break; }
  await send('Page.captureScreenshot', {}).then(r => import('node:fs').then(f => f.writeFileSync(shot + '-replay.png', Buffer.from(r.data, 'base64'))));
  console.log(await ev('window.__NS.buildReport()'));
  console.log('errors', JSON.stringify(logs));
} catch (e) { console.log('FAIL', e.message, JSON.stringify(logs)); }
chrome.kill(); process.exit(0);
