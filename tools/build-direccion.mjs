// build-direccion.mjs — arma datos/direccion.json, la única fuente del
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
import { ingestFinanzasMeli, ingestFinanzasTn, verificarMeli, agregar } from '../src/finanzas.mjs';
import { buildPostventa } from '../src/postventa.mjs';
import { armarTablero } from '../src/tablero.mjs';
import { resolverFuente, leerConfig, traerDelPuente, probarPuente } from '../src/fuentes.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DATA = process.env.NAKU_DATA || path.resolve(ROOT, '..', 'Naku Datos');
// Fuera de docs/: lo que vive ahí lo sirve GitHub Pages a cualquiera, y este
// archivo tiene el estado de resultados. El tablero lo lee de la base, con clave.
const OUT = path.join(ROOT, 'datos', 'direccion.json');

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

/* ---------------------------------------------------------------- el tablero
   El armado vive en src/tablero.mjs para que sea el mismo cálculo que corre en
   el navegador cuando alguien arrastra los exports en el botón del tablero. */
const previa = armarTablero({ mapasMl: mapasMeli, mapasTn });
if (!previa.ok) fatal(previa.error);
const { mes: mesCerrado, ordenes, margenBruto, contribucion, cobertura, parciales, canales: canalesOk } = previa.resumen;
const serie = previa.tablero.serie;

console.log(`· mes cerrado: ${mesCerrado} — ${ordenes} órdenes · margen bruto ${margenBruto}% · contribución ${contribucion}%`);
if (parciales.length) console.log(`  · a medio cerrar (fuera del comparativo): ${parciales.join(', ')}`);
if (cobertura < 95) console.warn(`  ⚠ cobertura de costos ${cobertura}%: hay SKU vendidos sin costo en la planilla`);
console.log(`· canales: ${canalesOk.join(', ')} × ${previa.tablero.periodos.length} períodos`);

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
const armado = armarTablero({
  mapasMl: mapasMeli,
  mapasTn,
  post,
  meta: {
    fuentes: {
      origen: estadoFuentes,
      costos: { archivo: fCostos || '(puente)', hoja: hojaCostos, mes: mesCostos, skus: costos.costo.size },
      ventas: { meli: fMeli, tiendanube: fTn, meses: serie.map((s) => s.mes) },
      maestro: fMaestro || null,
      postventa: fEmb ? { archivo: fEmb, corte: post.corte } : null,
    },
  },
});
if (!armado.ok) fatal(armado.error);
const out = armado.tablero;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(`✓ ${path.relative(ROOT, OUT)} — ${(Buffer.byteLength(JSON.stringify(out)) / 1024).toFixed(0)} KB`);
