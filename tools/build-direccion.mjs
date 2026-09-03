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

import { buildCostos, makeCostMatcher, hojasPorMes, normSkuCosto, IVA } from '../src/costos.mjs';
import { buildMaestro, makeMatcher } from '../src/engine.mjs';
import { ingestFinanzasMeli, ingestFinanzasTn, unirCanales, eerr, verificarMeli, sinIva, agregar } from '../src/finanzas.mjs';
import { buildPostventa } from '../src/postventa.mjs';
import { resolverFuente, leerConfig, traerDelPuente, probarPuente } from '../src/fuentes.mjs';

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

/* ---------------------------------------------------------------- fuentes de Google
   Las planillas que alguien mantiene —costos y central de atención— se bajan
   solas antes de cada build. Los exports de los canales no: hay que dejarlos en
   el directorio de datos. Si Google no responde o la planilla dejó de estar
   compartida, se sigue con la última copia y el build avisa. */
const config = leerConfig(ROOT);
const estadoFuentes = {};

// El puente de Apps Script es el camino preferido: las planillas no se comparten
// con nadie, el script las lee con el acceso de su dueño y devuelve sólo las
// columnas que el tablero usa. Si no está configurado o no responde, se cae a los
// archivos del directorio de datos.
const puente = {
  url: process.env.NAKU_FUENTES_URL || (config.fuentes || {}).url || '',
  token: process.env.NAKU_FUENTES_TOKEN || (config.fuentes || {}).token || '',
};
let delPuente = null;
if (puente.url && puente.token) {
  const vivo = await probarPuente(puente.url, puente.token);
  if (vivo.ok) {
    try {
      delPuente = await traerDelPuente(puente.url, puente.token);
      console.log(`· puente: costos de "${delPuente.costos.hoja}" (${delPuente.costos.filas.length} SKU)`
        + ` · central con ${delPuente.central.postventa.length - 1} casos`);
      estadoFuentes.costos = { origen: 'puente' };
      estadoFuentes.postventa = { origen: 'puente' };
    } catch (e) {
      console.warn(`⚠ el puente respondió pero falló al traer los datos: ${e.message}`);
      console.warn('  sigo con los archivos locales');
    }
  } else {
    console.warn(`⚠ puente de Apps Script no disponible: ${vivo.motivo}`);
    console.warn('  sigo con los archivos locales');
  }
}

// Lo que el puente no cubrió se busca en Google por link o en el disco.
for (const clave of ['costos', 'postventa', 'maestro']) {
  if (estadoFuentes[clave]) continue;
  const f = config[clave];
  if (!f || !f.archivo) continue;
  const r = await resolverFuente(clave, f.id, path.join(DATA, f.archivo), {
    tipo: f.tipo,
    obligatoria: clave !== 'maestro',
  });
  estadoFuentes[clave] = { origen: r.origen, motivo: r.motivo || null, dias: r.dias ?? null };
  if (!r.ok && clave !== 'maestro') {
    fatal(`no pude conseguir la fuente "${clave}": ${r.motivo}`);
  }
}

/* ---------------------------------------------------------------- costos */
let costos; let hojaCostos; let mesCostos; let fCostos = null;
if (delPuente) {
  // El puente devuelve pares [sku, costo]: no hay planilla que parsear.
  hojaCostos = delPuente.costos.hoja;
  mesCostos = delPuente.costos.mes;
  const mapa = new Map();
  for (const [sku, v] of delPuente.costos.filas) {
    const k = normSkuCosto(sku);
    const n = Number(v);
    if (k && Number.isFinite(n) && n > 0 && !mapa.has(k)) mapa.set(k, n);
  }
  costos = { costo: mapa, hoja: hojaCostos, mes: mesCostos, filas: mapa.size };
} else {
  fCostos = buscar(/PLANILLA.?MADRE.*\.xlsx$/i)[0] || buscar(/madre.*\.xlsx$/i)[0];
  if (!fCostos) fatal('falta la planilla madre de costos (PLANILLA_MADRE.xlsx)');
  const wbCostos = XLSX.read(fs.readFileSync(path.join(DATA, fCostos)), { type: 'buffer' });
  const candidatas = hojasPorMes(wbCostos.SheetNames);
  if (!candidatas.length) fatal(`la planilla "${fCostos}" no tiene hojas con nombre de mes`);
  ({ hoja: hojaCostos, mes: mesCostos } = candidatas[0]);
  costos = buildCostos(
    XLSX.utils.sheet_to_json(wbCostos.Sheets[hojaCostos], { header: 1, raw: true, defval: '' }),
    hojaCostos, mesCostos,
  );
}
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
    if (agregar(a).ordenes.size < 100) continue;
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
// El tablero filtra por canal, así que el mismo mes se agrega tres veces: el
// total y cada canal por separado. unirCanales pierde de qué canal viene cada
// peso, por eso se arma desde los mapas originales en vez de partir el total.
const porMesMl = unirCanales(...mapasMeli);
const porMesTn = unirCanales(...mapasTn);

// Neto por canal (unirCanales ya perdió de qué canal venía cada peso).
const netoCanal = new Map();
const sumarCanal = (mapas, campo) => {
  for (const m of mapas) for (const [mes, a] of m) {
    if (!netoCanal.has(mes)) netoCanal.set(mes, { ml: 0, tn: 0 });
    netoCanal.get(mes)[campo] += sinIva(agregar(a).netoLiquidado);
  }
};
sumarCanal(mapasMeli, 'ml');
sumarCanal(mapasTn, 'tn');

/* ---------------------------------------------------------------- meses utilizables
   Un mes con pocas órdenes es la cola de otro export, no un mes de operación. Un
   mes cuyo último día con ventas queda lejos del fin de mes está a medio cerrar:
   se marca parcial y no sirve de base de comparación. */
const esParcial = (mes, a) => a.ultimoDia > 0 && a.ultimoDia < diasDelMes(mes) - 1;
const totalMes = new Map([...porMes].map(([m, a]) => [m, agregar(a, 1, diasDelMes(m))]));
const meses = [...porMes.keys()].filter((m) => totalMes.get(m).ordenes.size >= 100).sort();
if (!meses.length) fatal('ningún mes de los exports tiene volumen suficiente (≥100 órdenes)');

const serie = meses.map((mes) => {
  const a = totalMes.get(mes);
  const e = eerr(a);
  const c = netoCanal.get(mes) || { ml: 0, tn: 0 };
  return {
    mes, m: etiqueta(mes), largo: largo(mes),
    neto: Math.round(e.netoLiquidado),
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
const est = eerr(totalMes.get(mesCerrado));
const previo = completos.length > 1 ? completos[completos.length - 2] : null;

console.log(`· mes cerrado: ${mesCerrado} — ${est.ordenes} órdenes · margen bruto ${est.margenBrutoPct}% · contribución ${est.contribucionPct}%`);
if (serie.length > completos.length) {
  console.log(`  · a medio cerrar (fuera del comparativo): ${serie.filter((s) => s.parcial).map((s) => s.mes).join(', ')}`);
}
if (est.coberturaCostosPct < 95) {
  console.warn(`  ⚠ cobertura de costos ${est.coberturaCostosPct}%: hay SKU vendidos sin costo en la planilla`);
}

/* ---------------------------------------------------------------- cortes del mes */
const FILAS = 10;   // cuántas líneas muestra cada lista del tablero

const top = (map, n) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
const share = (map, n, resto) => {
  const tot = [...map.values()].reduce((a, b) => a + b, 0) || 1;
  const t = top(map, n);
  const out = t.map(([k, v]) => ({ n: k, v: +(100 * v / tot).toFixed(1) }));
  const usado = t.reduce((a, [, v]) => a + v, 0);
  if (tot - usado > 1) out.push({ n: resto, v: +(100 * (tot - usado) / tot).toFixed(1) });
  return out;
};

/* «Otros» es una familia real del maestro: los productos a los que nadie les
   asignó una. Junto al agrupador del resto se leían como lo mismo. */
const RENOMBRE_FAMILIA = { Otros: 'Sin familia asignada' };
const RESTO_FAMILIAS = 'Resto de familias';

/** Todo lo que el tablero necesita de un mes, para un canal y un rango de días. */
function bloque(acc, mes, desde = 1, hasta = 31) {
  if (!acc) return null;
  const a = agregar(acc, desde, hasta);
  if (!a.ordenes.size) return null;
  const e = eerr(a);
  const pctDe = (v) => (e.ventasNetas ? +(100 * v / e.ventasNetas).toFixed(1) : 0);

  const familias = new Map();
  for (const [k, v] of a.familias) {
    const n = RENOMBRE_FAMILIA[k] || k;
    familias.set(n, (familias.get(n) || 0) + v);
  }

  return {
    eerr: {
      lineas: [
        { c: 'Ventas brutas', v: e.ventaBruta, pct: pctDe(e.ventaBruta), tipo: 'normal' },
        { c: 'Bonificaciones de plataforma', v: e.bonificaciones, pct: pctDe(e.bonificaciones), tipo: 'normal' },
        { c: 'Anulaciones y reembolsos', v: e.anulaciones, pct: pctDe(e.anulaciones), tipo: 'normal' },
        { c: 'Descuentos y cupones', v: e.descuentos, pct: pctDe(e.descuentos), tipo: 'normal' },
        { c: 'Ventas netas', v: e.ventasNetas, pct: 100, tipo: 'total' },
        { c: 'Costo de la mercadería', v: e.cogs, pct: e.cogsPct, tipo: 'gasto' },
        { c: 'Margen bruto', v: e.margenBruto, pct: e.margenBrutoPct, tipo: 'destacado' },
        { c: 'Comisiones de plataforma', v: e.comisiones, pct: e.comisionesPct, tipo: 'gasto' },
        { c: 'Envíos (neto de lo cobrado)', v: e.envio, pct: e.envioPct, tipo: 'gasto' },
        { c: 'Impuestos de plataforma', v: e.impuestos, pct: e.impuestosPct, tipo: 'gasto' },
        { c: 'Resultado de contribución', v: e.contribucion, pct: e.contribucionPct, tipo: 'destacado' },
      ],
      ordenes: e.ordenes,
      unidades: e.unidades,
      ticket: e.ticket,
      netoLiquidado: e.netoLiquidado,
      canceladas: e.canceladas,
      cobertura: e.coberturaCostosPct,
      sinCosto: e.skusSinCosto.slice(0, FILAS).map((x) => ({ ...x, facturacion: Math.round(x.facturacion) })),
      faltan: ['Marketing y publicidad', 'Estructura y sueldos', 'Impuestos propios (IIBB, IVA)',
        'Amortizaciones', 'Resultados financieros'],
    },
    gastos: [
      { n: 'Costo de la mercadería', v: Math.abs(e.cogsPct) },
      { n: 'Comisiones de plataforma', v: Math.abs(e.comisionesPct) },
      { n: 'Envíos y logística', v: Math.abs(e.envioPct) },
      { n: 'Impuestos de plataforma', v: Math.abs(e.impuestosPct) },
    ],
    productos: [...a.productos.values()]
      .filter((p) => p.v > 0)
      .sort((x, y) => y.v - x.v)
      .slice(0, FILAS)
      .map((p) => ({ sku: p.sku, n: p.n, v: Math.round(p.v), u: Math.round(p.u) })),
    familias: share(familias, FILAS, RESTO_FAMILIAS),
    provincias: share(a.provincias, FILAS - 4, 'Resto del país'),
    envios: [...a.envios.entries()].map(([n, set]) => ({ n, v: set.size })).sort((x, y) => y.v - x.v),
    dias: a.dias,
    neto: Math.round(e.netoLiquidado),
  };
}

/* Los períodos que los datos permiten. Con un solo export sólo se puede cortar
   dentro del mes; cuando haya varios, acá entran los rangos multi-mes. */
const nDias = diasDelMes(mesCerrado);
const periodos = [
  { id: 'mes', n: `Todo ${largo(mesCerrado).split(' ')[0]}`, desde: 1, hasta: nDias },
  { id: 'q1', n: '1ª quincena', desde: 1, hasta: 15 },
  { id: 'q2', n: '2ª quincena', desde: 16, hasta: nDias },
  { id: 'u7', n: 'Últimos 7 días', desde: Math.max(1, nDias - 6), hasta: nDias },
];

const fuentesCanal = { todos: acc, ml: porMesMl.get(mesCerrado), tn: porMesTn.get(mesCerrado) };
const vistas = {};
for (const [canal, fuente] of Object.entries(fuentesCanal)) {
  if (!fuente) continue;
  vistas[canal] = {};
  for (const p of periodos) {
    const b = bloque(fuente, mesCerrado, p.desde, p.hasta);
    if (b) vistas[canal][p.id] = b;
  }
  if (!Object.keys(vistas[canal]).length) delete vistas[canal];
}
console.log(`· canales: ${Object.keys(vistas).join(', ')} × ${periodos.length} períodos`);

/* ---------------------------------------------------------------- postventa */
const fEmb = delPuente ? '(puente)' : buscar(/embudo/i)[0];
let post = null;
if (fEmb) {
  const ordenesPorMes = Object.fromEntries(serie.map((s) => [s.mes, s.ordenes]));
  // Una versión por canal, para que el filtro del tablero alcance también acá.
  const hojas = delPuente
    ? [delPuente.central.postventa, delPuente.central.minorista, delPuente.central.volumen]
    : [leerHoja(fEmb, 'Postventa'), leerHoja(fEmb, 'Preventa Minorista'),
      leerHoja(fEmb, 'Preventa Volumen')];
  const porCanal = {
    todos: buildPostventa(...hojas, ordenesPorMes, 'todos'),
    ml: buildPostventa(...hojas, ordenesPorMes, 'Mercado Libre'),
    tn: buildPostventa(...hojas, ordenesPorMes, 'Tienda Nube'),
  };
  post = { ...porCanal.todos, porCanal };
  console.log(`· postventa: ${post.postventa.total} casos, ${post.postventa.abiertos} abiertos (corte ${post.corte})`);
  console.log(`  por canal: ${Object.entries(porCanal).filter(([, v]) => v)
    .map(([k, v]) => `${k} ${v.postventa.total}`).join(' · ')}`);
} else {
  console.warn('⚠ no encontré el export de embudos: el tablero oculta la sección de clientes');
}

/* ---------------------------------------------------------------- salida */
const out = {
  generado: new Date().toISOString().slice(0, 10),
  iva: IVA,
  mesCerrado: {
    mes: mesCerrado, largo: largo(mesCerrado), dias: diasDelMes(mesCerrado),
    previo: previo ? previo.largo : null, previoMes: previo ? previo.mes : null,
  },
  fuentes: {
    origen: estadoFuentes,
    costos: { archivo: fCostos || '(puente)', hoja: hojaCostos, mes: mesCostos, skus: costos.costo.size },
    ventas: { meli: fMeli, tiendanube: fTn, meses: serie.map((s) => s.mes) },
    maestro: fMaestro || null,
    postventa: fEmb ? { archivo: fEmb, corte: post.corte } : null,
  },
  serie,
  // vistas[canal][periodo]: el tablero cambia de corte sin volver a pedir nada.
  vistas,
  periodos: periodos.filter((p) => vistas.todos && vistas.todos[p.id]),
  canales: [
    { id: 'todos', n: 'Los dos canales' },
    { id: 'ml', n: 'Mercado Libre', v: Math.round((netoCanal.get(mesCerrado) || {}).ml || 0) },
    { id: 'tn', n: 'Tienda Nube', v: Math.round((netoCanal.get(mesCerrado) || {}).tn || 0) },
  ].filter((c) => c.id === 'todos' || vistas[c.id]),
  clientes: post,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(`✓ ${path.relative(ROOT, OUT)} — ${(Buffer.byteLength(JSON.stringify(out)) / 1024).toFixed(0)} KB`);
