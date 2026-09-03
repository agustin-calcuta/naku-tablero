// build-direccion.mjs — arma docs/data/direccion.json, la única fuente del
// tablero de dirección (docs/direccion.html).
//
// Uso:
//   node tools/build-direccion.mjs                  # datos en ../Naku Datos
//   NAKU_DATA="/ruta/a/los/datos" node tools/build-direccion.mjs
//
// Espera en ese directorio:
//   PLANILLA_MADRE.xlsx          costos por SKU (una hoja por mes, col CZ)
//   Naku - SKU+Buyer+Cat.csv     maestro SKU → nombre y familia
//   Embudos_NAKU.xlsx            export del Sheet de la central de atención
//   *Ventas_AR*.xlsx             uno o más exports de MercadoLibre / Mercado Shops
//   *TiendaNube*.csv             export de TiendaNube (cp1252, ;)
//
// TODO sale de los exports crudos: el estado de resultados, los cortes por
// producto, familia, provincia y envío, y la evolución día por día. El histórico
// del motor (docs/data/lines.json) NO se usa acá: guarda sólo el neto liquidado,
// sin los cargos desglosados, y su último mes viene cortado a mitad. Mezclar las
// dos fuentes daba variaciones falsas.
//
// Cuando lleguen los exports de los meses anteriores, alcanza con dejarlos en el
// mismo directorio: cada mes con export entra en la serie y en el comparativo.

import * as XLSX from 'xlsx';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildCostos, makeCostMatcher, hojasPorMes, IVA } from '../src/costos.mjs';
import { buildMaestro, makeMatcher } from '../src/engine.mjs';
import { ingestFinanzasMeli, ingestFinanzasTn, unirCanales, eerr, verificarMeli } from '../src/finanzas.mjs';
import { buildPostventa } from '../src/postventa.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DATA = process.env.NAKU_DATA || path.resolve(ROOT, '..', 'Naku Datos');
const OUT = path.join(ROOT, 'docs', 'data', 'direccion.json');

const MES_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MES_LARGO = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const etiqueta = (mes) => `${MES_ES[+mes.slice(5, 7) - 1]} ${mes.slice(2, 4)}`;
const largo = (mes) => `${MES_LARGO[+mes.slice(5, 7) - 1]} ${mes.slice(0, 4)}`;
const diasDelMes = (mes) => new Date(Date.UTC(+mes.slice(0, 4), +mes.slice(5, 7), 0)).getUTCDate();

function fatal(msg) { console.error('✗ ' + msg); process.exit(1); }
function buscar(re) {
  if (!fs.existsSync(DATA)) fatal(`no existe el directorio de datos: ${DATA}\n  Pasalo con NAKU_DATA="…"`);
  return fs.readdirSync(DATA).filter((f) => re.test(f) && !f.startsWith('~$')).sort();
}
const leerHoja = (file, name) => XLSX.utils.sheet_to_json(
  XLSX.read(fs.readFileSync(path.join(DATA, file)), { type: 'buffer', cellDates: true }).Sheets[name],
  { header: 1, raw: true, defval: '' },
);

/** CSV con comillas y delimitador propio (TiendaNube y el maestro usan ;). */
function parseCSV(text, delim = ';') {
  const rows = []; let f = '', row = [], q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f.length || row.length) { row.push(f); rows.push(row); }
  return rows;
}

console.log('· datos:', DATA);

/* ---------------------------------------------------------------- costos */
const fCostos = buscar(/PLANILLA.?MADRE.*\.xlsx$/i)[0] || buscar(/madre.*\.xlsx$/i)[0];
if (!fCostos) fatal('falta la planilla madre de costos (PLANILLA_MADRE.xlsx)');
const wbCostos = XLSX.read(fs.readFileSync(path.join(DATA, fCostos)), { type: 'buffer' });
const candidatas = hojasPorMes(wbCostos.SheetNames);
if (!candidatas.length) fatal(`la planilla "${fCostos}" no tiene hojas con nombre de mes`);
const { hoja: hojaCostos, mes: mesCostos } = candidatas[0];
const costos = buildCostos(
  XLSX.utils.sheet_to_json(wbCostos.Sheets[hojaCostos], { header: 1, raw: true, defval: '' }),
  hojaCostos, mesCostos,
);
const costoDe = makeCostMatcher(costos);
console.log(`· costos: hoja "${hojaCostos}" (${mesCostos}) — ${costos.costo.size} SKU con costo`);

/* ---------------------------------------------------------------- maestro (nombre y familia) */
const fMaestro = buscar(/SKU.*Buyer.*\.csv$/i)[0] || buscar(/maestro.*\.csv$/i)[0];
let match = null;
if (fMaestro) {
  const maestro = buildMaestro(parseCSV(fs.readFileSync(path.join(DATA, fMaestro), 'utf8'), ';'));
  match = makeMatcher(maestro);
  console.log(`· maestro: ${fMaestro} — ${maestro.skuInfo.size} SKU`);
} else {
  console.warn('⚠ sin maestro: los productos muestran el título del canal y la familia por prefijo');
}

/* ---------------------------------------------------------------- ventas */
const fMeli = buscar(/ventas.?ar.*\.xlsx$/i);
const fTn = buscar(/tiendanube.*\.csv$/i);
if (!fMeli.length && !fTn.length) fatal('no encontré exports de ventas (*Ventas_AR*.xlsx / *TiendaNube*.csv)');

const mapasMeli = fMeli.map((f) => {
  const wb = XLSX.read(fs.readFileSync(path.join(DATA, f)), { type: 'buffer', cellDates: false });
  const nombre = wb.SheetNames.find((n) => /ventas/i.test(n)) || wb.SheetNames[0];
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[nombre], { header: 1, raw: true, defval: '' });
  console.log(`· MeLi: ${f} (hoja "${nombre}")`);
  return ingestFinanzasMeli(aoa, costoDe, match);
});
const mapasTn = fTn.map((f) => {
  // Los exports de TiendaNube salen en cp1252; latin1 alcanza para los acentos.
  const aoa = parseCSV(fs.readFileSync(path.join(DATA, f)).toString('latin1'), ';');
  console.log(`· TiendaNube: ${f}`);
  return ingestFinanzasTn(aoa, costoDe, match);
});
// El export de MeLi tiene que cerrar contra su propio 'Total (ARS)'. Si no cierra,
// una columna cambió: el estado de resultados sale mal y hay que revisar el mapeo.
for (const m of mapasMeli) {
  for (const [mes, a] of m) {
    if (a.ordenes.size < 100) continue;
    const v = verificarMeli(a);
    if (!v.ok) {
      fatal(`el export de MeLi no cierra en ${mes}: los componentes suman `
        + `$${Math.round(v.suma).toLocaleString('es-AR')} y "Total (ARS)" dice `
        + `$${Math.round(v.neto).toLocaleString('es-AR')} (${(100 * v.rel).toFixed(2)}% de diferencia).\n`
        + '  Alguna columna del export cambió de nombre. Revisá el mapeo en src/finanzas.mjs.');
    }
    console.log(`· control MeLi ${mes}: cierra contra "Total (ARS)" (${(100 * v.rel).toFixed(3)}% de diferencia)`);
  }
}

const porMes = unirCanales(...mapasMeli, ...mapasTn);

// Neto por canal (unirCanales ya perdió de qué canal venía cada peso).
const netoCanal = new Map();
const sumarCanal = (mapas, campo) => {
  for (const m of mapas) for (const [mes, a] of m) {
    if (!netoCanal.has(mes)) netoCanal.set(mes, { ml: 0, tn: 0 });
    netoCanal.get(mes)[campo] += a.netoLiquidado;
  }
};
sumarCanal(mapasMeli, 'ml');
sumarCanal(mapasTn, 'tn');

/* ---------------------------------------------------------------- meses utilizables
   Un mes con pocas órdenes es la cola de otro export, no un mes de operación. Un
   mes cuyo último día con ventas queda lejos del fin de mes está a medio cerrar:
   se marca parcial y no sirve de base de comparación. */
const esParcial = (mes, a) => a.ultimoDia > 0 && a.ultimoDia < diasDelMes(mes) - 1;
const meses = [...porMes.keys()].filter((m) => porMes.get(m).ordenes.size >= 100).sort();
if (!meses.length) fatal('ningún mes de los exports tiene volumen suficiente (≥100 órdenes)');

const serie = meses.map((mes) => {
  const a = porMes.get(mes);
  const e = eerr(a);
  const c = netoCanal.get(mes) || { ml: 0, tn: 0 };
  return {
    mes, m: etiqueta(mes), largo: largo(mes),
    neto: Math.round(a.netoLiquidado),
    ml: Math.round(c.ml), tn: Math.round(c.tn),
    ventasNetas: Math.round(e.ventasNetas),
    ordenes: e.ordenes, unidades: Math.round(e.unidades),
    mb: e.margenBrutoPct, contrib: e.contribucionPct,
    parcial: esParcial(mes, a),
  };
});

const completos = serie.filter((s) => !s.parcial);
if (!completos.length) fatal('todos los meses de los exports están a medio cerrar');
const mesCerrado = completos[completos.length - 1].mes;
const acc = porMes.get(mesCerrado);
const est = eerr(acc);
const previo = completos.length > 1 ? completos[completos.length - 2] : null;

console.log(`· mes cerrado: ${mesCerrado} — ${est.ordenes} órdenes · margen bruto ${est.margenBrutoPct}% · contribución ${est.contribucionPct}%`);
if (serie.length > completos.length) {
  console.log(`  · a medio cerrar (fuera del comparativo): ${serie.filter((s) => s.parcial).map((s) => s.mes).join(', ')}`);
}
if (est.coberturaCostosPct < 95) {
  console.warn(`  ⚠ cobertura de costos ${est.coberturaCostosPct}%: hay SKU vendidos sin costo en la planilla`);
}

/* ---------------------------------------------------------------- cortes del mes */
const top = (map, n) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
const share = (map, n, resto) => {
  const tot = [...map.values()].reduce((a, b) => a + b, 0) || 1;
  const t = top(map, n);
  const out = t.map(([k, v]) => ({ n: k, v: +(100 * v / tot).toFixed(1) }));
  const usado = t.reduce((a, [, v]) => a + v, 0);
  if (tot - usado > 1) out.push({ n: resto, v: +(100 * (tot - usado) / tot).toFixed(1) });
  return out;
};

const productos = [...acc.productos.values()]
  .filter((p) => p.v > 0)
  .sort((a, b) => b.v - a.v)
  .slice(0, 8)
  .map((p) => ({ sku: p.sku, n: p.n, v: Math.round(p.v), u: Math.round(p.u) }));

const envios = [...acc.envios.entries()]
  .map(([n, set]) => ({ n, v: set.size }))
  .sort((a, b) => b.v - a.v);

// Un punto por día del mes, con los días sin ventas en cero (así el eje no miente).
const dias = [];
for (let d = 1; d <= diasDelMes(mesCerrado); d++) {
  const x = acc.dias.get(d);
  dias.push({
    d,
    ml: x ? Math.round(x.ml) : 0,
    tn: x ? Math.round(x.tn) : 0,
    v: x ? Math.round(x.ml + x.tn) : 0,
    ordenes: x ? x.ordenes.size : 0,
  });
}

/* ---------------------------------------------------------------- postventa */
const fEmb = buscar(/embudo/i)[0];
let post = null;
if (fEmb) {
  const ordenesPorMes = Object.fromEntries(serie.map((s) => [s.mes, s.ordenes]));
  post = buildPostventa(
    leerHoja(fEmb, 'Postventa'),
    leerHoja(fEmb, 'Preventa Minorista'),
    leerHoja(fEmb, 'Preventa Volumen'),
    ordenesPorMes,
  );
  console.log(`· postventa: ${post.postventa.total} casos, ${post.postventa.abiertos} abiertos (corte ${post.corte})`);
  console.log(`  preventa minorista: ${post.preventa.minorista.total} consultas de ${post.mesRef}, resultado ${post.preventa.minorista.resultadoConfiable ? 'cargado' : 'SIN CARGAR'}`);
} else {
  console.warn('⚠ no encontré el export de embudos: el tablero oculta la sección de clientes');
}

/* ---------------------------------------------------------------- salida */
const pctDe = (v) => (est.ventasNetas ? +(100 * v / est.ventasNetas).toFixed(1) : 0);
const out = {
  generado: new Date().toISOString().slice(0, 10),
  iva: IVA,
  mesCerrado: {
    mes: mesCerrado, largo: largo(mesCerrado), dias: diasDelMes(mesCerrado),
    previo: previo ? previo.largo : null, previoMes: previo ? previo.mes : null,
  },
  fuentes: {
    costos: { archivo: fCostos, hoja: hojaCostos, mes: mesCostos, skus: costos.costo.size },
    ventas: { meli: fMeli, tiendanube: fTn, meses: serie.map((s) => s.mes) },
    maestro: fMaestro || null,
    postventa: fEmb ? { archivo: fEmb, corte: post.corte } : null,
  },
  serie,
  dias,
  eerr: {
    lineas: [
      { c: 'Ventas brutas', v: est.ventaBruta, pct: pctDe(est.ventaBruta), tipo: 'normal' },
      { c: 'Bonificaciones de plataforma', v: est.bonificaciones, pct: pctDe(est.bonificaciones), tipo: 'normal' },
      { c: 'Anulaciones y reembolsos', v: est.anulaciones, pct: pctDe(est.anulaciones), tipo: 'normal' },
      { c: 'Descuentos y cupones', v: est.descuentos, pct: pctDe(est.descuentos), tipo: 'normal' },
      { c: 'Ventas netas', v: est.ventasNetas, pct: 100, tipo: 'total' },
      { c: 'Costo de la mercadería', v: est.cogs, pct: est.cogsPct, tipo: 'gasto' },
      { c: 'Margen bruto', v: est.margenBruto, pct: est.margenBrutoPct, tipo: 'destacado' },
      { c: 'Comisiones de plataforma', v: est.comisiones, pct: est.comisionesPct, tipo: 'gasto' },
      { c: 'Envíos (neto de lo cobrado)', v: est.envio, pct: est.envioPct, tipo: 'gasto' },
      { c: 'Impuestos de plataforma', v: est.impuestos, pct: est.impuestosPct, tipo: 'gasto' },
      { c: 'Resultado de contribución', v: est.contribucion, pct: est.contribucionPct, tipo: 'destacado' },
    ],
    ordenes: est.ordenes,
    unidades: est.unidades,
    ticket: est.ticket,
    netoLiquidado: est.netoLiquidado,
    canceladas: est.canceladas,
    cobertura: est.coberturaCostosPct,
    sinCosto: est.skusSinCosto.slice(0, 10).map((x) => ({ ...x, facturacion: Math.round(x.facturacion) })),
    // Lo que todavía no tiene fuente. El tablero lo dice en vez de dibujar cero.
    faltan: ['Marketing y publicidad', 'Estructura y sueldos', 'Impuestos propios (IIBB, IVA)',
      'Amortizaciones', 'Resultados financieros'],
  },
  gastos: [
    { n: 'Costo de la mercadería', v: Math.abs(est.cogsPct) },
    { n: 'Comisiones de plataforma', v: Math.abs(est.comisionesPct) },
    { n: 'Envíos y logística', v: Math.abs(est.envioPct) },
    { n: 'Impuestos de plataforma', v: Math.abs(est.impuestosPct) },
  ],
  canales: [
    { n: 'Mercado Libre', v: Math.round((netoCanal.get(mesCerrado) || {}).ml || 0) },
    { n: 'Tienda Nube', v: Math.round((netoCanal.get(mesCerrado) || {}).tn || 0) },
  ],
  productos,
  familias: share(acc.familias, 8, 'Las demás familias'),
  provincias: share(acc.provincias, 5, 'Resto del país'),
  envios,
  clientes: post,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(`✓ ${path.relative(ROOT, OUT)} — ${(Buffer.byteLength(JSON.stringify(out)) / 1024).toFixed(0)} KB`);
