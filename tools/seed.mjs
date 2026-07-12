// seed.mjs — genera docs/data/lines.json: el histórico base como LÍNEAS compactas
// (formato columnar {cols, rows} para pesar menos). El tablero lo baja en la 1ª visita,
// lo siembra en IndexedDB, y desde ahí Leo acumula sus updates. Uso: node tools/seed.mjs
import * as XLSX from 'xlsx';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as E from '../src/engine.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.resolve(ROOT, '..', 'Tablero Buyer Naku');
const OUT = path.join(ROOT, 'docs', 'data', 'lines.json');

function parseCSV(text, delim) {
  const rows = []; let f = '', row = [], q = false;
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c === '\r') {} else f += c; }
  if (f.length || row.length) { row.push(f); rows.push(row); } return rows;
}
const match = E.makeMatcher(E.buildMaestro(parseCSV(fs.readFileSync(DATA + '/Naku - SKU+Buyer+Cat.csv', 'utf8'), ';')));
let all = [];
for (const fn of fs.readdirSync(DATA).filter((f) => f.endsWith('.xlsx')).sort()) {
  const wb = XLSX.read(fs.readFileSync(DATA + '/' + fn), { type: 'buffer' });
  all = all.concat(E.ingestMeli(XLSX.utils.sheet_to_json(wb.Sheets['Ventas AR'], { header: 1, raw: true, defval: '' }), match, fn));
}
all = all.concat(E.ingestTn(parseCSV(fs.readFileSync(DATA + '/Naku - Ventas Historias TN.csv').toString('latin1'), ';'), match, 'TN'));
const lines = E.dedupe(all).lines;

const cols = ['canal', 'order_id', 'mes', 'buyer', 'familia', 'nombre', 'sku', 'sku_raw', 'unidades', 'facturacion', 'cuotas', 'envio', 'billable', 'provincia'];
const rows = lines.map((l) => cols.map((c) => l[c]));
const out = { updated: '2026-06-16', ventana: 'jun 2025 – jun 2026', cols, rows };
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const json = JSON.stringify(out);
fs.writeFileSync(OUT, json);
console.log('✓ seed', lines.length, 'líneas ·', (json.length / 1e6).toFixed(1) + 'MB (', OUT.replace(ROOT + '/', ''), ')');
