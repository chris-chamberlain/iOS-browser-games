// Bundles the two Three.js ES module files into one plain script that defines `const THREE`.
// Usage: node bundle-three.mjs <module.min.js> <core.min.js> <out.js>
import fs from 'node:fs';
const [modPath, corePath, outPath] = process.argv.slice(2);
let mod = fs.readFileSync(modPath, 'utf8');
let core = fs.readFileSync(corePath, 'utf8');

const objFromList = (list) => '{' + list.split(',').map(s => {
  const [local, exported] = s.split(' as ');
  return exported ? `${exported}:${local}` : local;
}).join(',') + '}';

const impFromList = (list) => '{' + list.split(',').map(s => {
  const [exported, local] = s.split(' as ');
  return local ? `${exported}:${local}` : exported;
}).join(',') + '}';

// core: strip the single trailing export statement and return it as an object
const ci = core.lastIndexOf('export{');
const coreExport = core.slice(ci).match(/^export\{([^}]*)\};?\s*$/);
if (!coreExport) throw new Error('unexpected core export form');
const coreBody = core.slice(0, ci);
const coreRet = objFromList(coreExport[1]);

// module: import from core, re-export from core, final export
const impRe = /import\{([^}]*)\}from"\.\/three\.core\.js";?/;
const imp = mod.match(impRe);
if (!imp) throw new Error('import not found');
mod = mod.replace(impRe, '');
const reRe = /export\{[^}]*\}from"\.\/three\.core\.js";?/;
if (!reRe.test(mod)) throw new Error('re-export not found');
mod = mod.replace(reRe, '');
const mi = mod.lastIndexOf('export{');
const modExport = mod.slice(mi).match(/^export\{([^}]*)\};?\s*$/);
if (!modExport) throw new Error('unexpected module export form');
const modBody = mod.slice(0, mi);

const out =
`const THREE=(()=>{
const __core=(()=>{${coreBody}
return ${coreRet};})();
const __mod=(()=>{const ${impFromList(imp[1])}=__core;${modBody}
return ${objFromList(modExport[1])};})();
return Object.assign({},__core,__mod);})();
`;
fs.writeFileSync(outPath, out);
console.log('wrote', outPath, out.length, 'bytes');
