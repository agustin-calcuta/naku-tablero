// build-tablero.mjs — arma el tablero self-contained que sirve GitHub Pages.
// Toma el source web/tablero-v2.html (con placeholders), le inyecta:
//   /*__ENGINE_JS__*/  -> src/engine.mjs sin los `export` (queda como script clásico)
//   __MAESTRO_CSV__    -> el CSV maestro SKU->comprador (para el match en el navegador)
// y escribe docs/nueva.html (lo que consume el switcher docs/index.html).
//
// Uso:  node tools/build-tablero.mjs
// Rebuild cuando cambie el motor o el maestro (p.ej. la agencia extiende el mapeo).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');                 // .../naku-tablero
const SRC = path.join(ROOT, 'web', 'tablero-v2.html');
const ENGINE = path.join(ROOT, 'src', 'engine.mjs');
const OUT = path.join(ROOT, 'docs', 'nueva.html');
// El maestro vive fuera del repo (no versionado), igual que los exports (ver README).
const MAESTRO = path.resolve(ROOT, '..', 'Tablero Buyer Naku', 'Naku - SKU+Buyer+Cat.csv');

function read(p) {
  if (!fs.existsSync(p)) { console.error('✗ falta:', p); process.exit(1); }
  return fs.readFileSync(p, 'utf8');
}

let html = read(SRC);
const engineJs = read(ENGINE).replace(/^export\s+/gm, ''); // export const/function -> global
const maestroCsv = read(MAESTRO);

if (!html.includes('/*__ENGINE_JS__*/')) { console.error('✗ no encontré el placeholder /*__ENGINE_JS__*/ en el source'); process.exit(1); }
if (!html.includes('__MAESTRO_CSV__')) { console.error('✗ no encontré el placeholder __MAESTRO_CSV__ en el source'); process.exit(1); }

// Replacer como función: evita que `$&`, `$1`, etc. del contenido rompan String.replace.
html = html.replace('/*__ENGINE_JS__*/', () => engineJs);
html = html.replace('__MAESTRO_CSV__', () => maestroCsv);

fs.writeFileSync(OUT, html);
const kb = n => (n / 1024).toFixed(0) + ' KB';
console.log('✓ build ok');
console.log('  motor   :', engineJs.split('\n').length, 'líneas');
console.log('  maestro :', maestroCsv.split('\n').length, 'filas');
console.log('  salida  :', path.relative(ROOT, OUT), '(' + kb(Buffer.byteLength(html)) + ')');
