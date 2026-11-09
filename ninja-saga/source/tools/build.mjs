// Inlines Three.js, the sim core and the app into one HTML file. Usage: node build.mjs <build-id> <out.html>
import fs from 'node:fs';
const [build, out] = process.argv.slice(2);
const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const safe = (js) => js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
let html = read('src/template.html');
const parts = { THREE: read('lib/three.bundle.js'), SIM: read('src/sim.js'), APP: read('src/app.js') };
for (const k of Object.keys(parts)) html = html.replace(`/*${k}*/`, () => safe(parts[k]));
html = html.replaceAll('__BUILD__', build);
html = html.replace("Number('__SIZE__')", "Number('0000000')");
const size = Buffer.byteLength(html, 'utf8');
html = html.replace("Number('0000000')", "Number('" + String(size).padStart(7, '0') + "')");
fs.mkdirSync(new URL('../dist/', import.meta.url), { recursive: true });
fs.writeFileSync(out, html);
console.log('built', out, size, 'bytes');
