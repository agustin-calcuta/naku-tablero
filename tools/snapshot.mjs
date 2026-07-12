// snapshot.mjs — emite el JSON consolidado (personas > familias > productos, con las 3
// métricas) que alimenta la maqueta v2. Uso: node tools/snapshot.mjs > web/data/snapshot.json
import * as XLSX from 'xlsx';
import fs from 'node:fs';
import * as E from '../src/engine.mjs';

const DATA = '/Users/agustin/Desktop/Developer/Calcula/Naku/Tablero Buyer Naku';
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
  const aoa = XLSX.utils.sheet_to_json(XLSX.read(fs.readFileSync(DATA + '/' + fn), { type: 'buffer' }).Sheets['Ventas AR'], { header: 1, raw: true, defval: '' });
  all = all.concat(E.ingestMeli(aoa, match, fn));
}
all = all.concat(E.ingestTn(parseCSV(fs.readFileSync(DATA + '/Naku - Ventas Historias TN.csv').toString('latin1'), ';'), match, 'TN'));
const lines = E.dedupe(all).lines;
const agg = E.aggregate(lines);
const bundles = E.bundlesByPersona(lines);

const canal = {};
for (const r of agg.porMesCanalPersona) { canal[r.buyer] = canal[r.buyer] || { MercadoLibre: 0, TiendaNube: 0 }; canal[r.buyer][r.canal] += r.facturacion; }
const envioPct = (e) => {
  const tot = Object.values(e).reduce((a, x) => a + x.ordenes, 0) || 1;
  return Object.entries(e).map(([bucket, v]) => ({ bucket, ordenes: v.ordenes, pct: +(100 * v.ordenes / tot).toFixed(1) })).sort((a, b) => b.ordenes - a.ordenes);
};

const out = {
  meta: { ventana: 'jun 2025 – jun 2026', updated: '2026-06-16', canales: ['MercadoLibre', 'TiendaNube'] },
  totales: {
    facturacion: agg.totales.facturacion, cobertura: agg.totales.coberturaPct,
    ordenes: agg.totales.ordenes, lineas: agg.totales.lineas,
    ticket: Math.round(agg.totales.facturacion / agg.totales.ordenes),
  },
  porMes: agg.porMes.map((m) => ({ mes: m.mes, facturacion: Math.round(m.facturacion), unidades: m.unidades })),
  personas: E.PERSONAS.filter((p) => p !== 'Sin asignar').map((p) => {
    const b = agg.byPersona[p]; const c = canal[p] || { MercadoLibre: 0, TiendaNube: 0 };
    return {
      key: p, facturacion: b.facturacion, share: b.sharePct, ml: Math.round(c.MercadoLibre), tn: Math.round(c.TiendaNube),
      unidades: b.unidades, ordenes: b.ordenes, ticket: b.ticket, cuotas: b.cuotas,
      familias: agg.topByPersona[p].slice(0, 6).map((f) => ({
        familia: f.familia, facturacion: f.facturacion, sharePct: f.sharePct, unidades: f.unidades, precioProm: f.precioProm, nProd: f.productos.length,
        productos: f.productos.slice(0, 4).map((x) => ({ nombre: x.nombre, sku: x.sku, facturacion: x.facturacion, unidades: x.unidades, precioProm: x.precioProm })),
      })),
      envio: envioPct(agg.envioByPersona[p]),
      bundles: (bundles[p] || []).map((x) => ({ sug: x.sugNombre, sugSku: x.sugSku, hero: x.heroNombre, cruza: x.cruzaFamilia, n: x.n })),
    };
  }),
  sinAsignar: {
    facturacion: agg.byPersona['Sin asignar'].facturacion, share: agg.byPersona['Sin asignar'].sharePct,
    top: agg.unmapped.slice(0, 8).map((u) => ({ sku: u.sku, nombre: u.nombre, facturacion: u.facturacion, lines: u.lines })),
  },
};
process.stdout.write(JSON.stringify(out));
