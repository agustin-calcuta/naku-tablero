// reconcile.mjs — corre el motor real sobre los exports reales (3 xlsx MeLi + csv TN),
// reconcilia MeLi contra los targets conocidos y emite un snapshot consolidado.
// Uso: node tools/reconcile.mjs   (desde naku-tablero/, con xlsx instalado)
import * as XLSX from 'xlsx';
import fs from 'node:fs';
import * as E from '../src/engine.mjs';

const DATA = '/Users/agustin/Desktop/Developer/Calcula/Naku/Tablero Buyer Naku';
const fmt = (n) => Math.round(n).toLocaleString('es-AR');

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

const maestro = E.buildMaestro(parseCSV(fs.readFileSync(DATA + '/Naku - SKU+Buyer+Cat.csv', 'utf8'), ';'));
const match = E.makeMatcher(maestro);

let all = [];
for (const fn of fs.readdirSync(DATA).filter((f) => f.endsWith('.xlsx')).sort()) {
  const wb = XLSX.read(fs.readFileSync(DATA + '/' + fn), { type: 'buffer', cellDates: false });
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets['Ventas AR'], { header: 1, raw: true, defval: '' });
  all = all.concat(E.ingestMeli(aoa, match, fn));
}
all = all.concat(E.ingestTn(parseCSV(fs.readFileSync(DATA + '/Naku - Ventas Historias TN.csv').toString('latin1'), ';'), match, 'TN'));

const { lines, dups } = E.dedupe(all);
const agg = E.aggregate(lines);
const meliAgg = E.aggregate(lines.filter((l) => l.canal === 'MercadoLibre'));

// ---- reconciliación MeLi (motor real e2e) vs targets conocidos
const targets = { Juan: 1372732489, Martin: 984312547, Mariana: 604037098, Lucho: 292670684, Mario: 256594406 };
console.log('=== RECONCILIACIÓN MeLi (motor JS real, e2e) ===  lineas=%d dedup=%d', lines.length, dups);
for (const p of ['Juan', 'Martin', 'Mariana', 'Lucho', 'Mario']) {
  const got = meliAgg.byPersona[p].facturacion, t = targets[p];
  console.log(`  ${p.padEnd(8)} $${fmt(got).padStart(15)}  target $${fmt(t).padStart(15)}  Δ ${(100 * (got - t) / t).toFixed(2)}%`);
}
console.log('  cobertura MeLi:', meliAgg.totales.coberturaPct + '%');

// ---- consolidado por persona (MeLi + TN)
const canal = {}; // buyer -> {ML, TN}
for (const r of agg.porMesCanalPersona) {
  canal[r.buyer] = canal[r.buyer] || { MercadoLibre: 0, TiendaNube: 0 };
  canal[r.buyer][r.canal] += r.facturacion;
}
console.log('\n=== CONSOLIDADO por persona (MeLi + TN) ===  total $%s  cobertura %s%%', fmt(agg.totales.facturacion), agg.totales.coberturaPct);
for (const p of E.PERSONAS) {
  const b = agg.byPersona[p], c = canal[p] || { MercadoLibre: 0, TiendaNube: 0 };
  console.log(`  ${p.padEnd(12)} $${fmt(b.facturacion).padStart(15)}  share ${String(b.sharePct).padStart(5)}%  ML $${fmt(c.MercadoLibre).padStart(14)}  TN $${fmt(c.TiendaNube).padStart(11)}  ticket $${fmt(b.ticket)}`);
}

// ---- DIVERGENCIA volumen vs facturación (el caso "escarbadientes vs escritorio")
function flat(p) { return agg.topByPersona[p].flatMap((f) => f.productos.map((x) => ({ ...x, familia: f.familia }))); }
for (const p of ['Mariana', 'Juan']) {
  const prods = flat(p);
  const porUnid = [...prods].sort((a, b) => b.unidades - a.unidades).slice(0, 4);
  const porFact = [...prods].sort((a, b) => b.facturacion - a.facturacion).slice(0, 4);
  console.log(`\n=== ${p}: TOP por UNIDADES vs TOP por FACTURACIÓN ===`);
  console.log('  por UNIDADES (volumen):');
  for (const x of porUnid) console.log(`     ${String(x.unidades).padStart(5)}u  $${fmt(x.facturacion).padStart(13)}  precioProm $${fmt(x.precioProm).padStart(9)}  ${x.nombre.slice(0, 40)}`);
  console.log('  por FACTURACIÓN (impacto):');
  for (const x of porFact) console.log(`     ${String(x.unidades).padStart(5)}u  $${fmt(x.facturacion).padStart(13)}  precioProm $${fmt(x.precioProm).padStart(9)}  ${x.nombre.slice(0, 40)}`);
}

// ---- snapshot compacto para la maqueta
const snap = { totales: agg.totales, personas: {} };
for (const p of E.PERSONAS) {
  const c = canal[p] || { MercadoLibre: 0, TiendaNube: 0 };
  snap.personas[p] = {
    facturacion: agg.byPersona[p].facturacion, share: agg.byPersona[p].sharePct,
    unidades: agg.byPersona[p].unidades, ordenes: agg.byPersona[p].ordenes,
    ticket: agg.byPersona[p].ticket, cuotas: agg.byPersona[p].cuotas,
    ml: Math.round(c.MercadoLibre), tn: Math.round(c.TiendaNube),
    topFamilias: agg.topByPersona[p].slice(0, 4).map((f) => ({
      familia: f.familia, facturacion: f.facturacion, sharePct: f.sharePct, unidades: f.unidades, precioProm: f.precioProm, nProd: f.productos.length,
    })),
  };
}
console.log('\n=== SNAPSHOT_JSON ===');
console.log(JSON.stringify(snap));
