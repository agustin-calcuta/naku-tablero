// test-tablero.mjs — controles sobre el JSON que consume el tablero de dirección.
//
//   npm test
//
// No reemplaza mirar el tablero, pero atrapa lo que se rompe en silencio: que el
// estado de resultados deje de cerrar, que los períodos no sumen el mes, que un
// canal se coma órdenes del otro, que aparezcan cifras imposibles.
//
// Corre sobre docs/data/direccion.json, así que primero hay que generar el
// tablero (`npm run tablero`).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUTA = path.join(ROOT, 'docs', 'data', 'direccion.json');

if (!fs.existsSync(RUTA)) {
  console.error('✗ falta docs/data/direccion.json — corré antes: npm run tablero');
  process.exit(1);
}
const D = JSON.parse(fs.readFileSync(RUTA, 'utf8'));

let fallas = 0; let corridos = 0;
function check(nombre, condicion, detalle = '') {
  corridos++;
  if (condicion) { console.log(`  ✓ ${nombre}`); return; }
  fallas++;
  console.log(`  ✗ ${nombre}${detalle ? `\n      ${detalle}` : ''}`);
}
/** Compara con tolerancia: los importes se redondean en varios lugares. */
const cerca = (a, b, tol = 0.02) => Math.abs(a - b) <= Math.max(tol, Math.abs(b) * tol);
const linea = (v, c) => (v.eerr.lineas.find((l) => l.c === c) || {}).v ?? 0;
const pctDe = (v, c) => (v.eerr.lineas.find((l) => l.c === c) || {}).pct ?? 0;

console.log(`\nTablero de ${D.mesCerrado.largo}, generado el ${D.generado}\n`);

/* ---------------------------------------------------------------- estructura */
console.log('Estructura');
check('hay al menos un canal', Object.keys(D.vistas || {}).length > 0);
check('existe la vista de los dos canales', !!(D.vistas && D.vistas.todos && D.vistas.todos.mes));
check('hay períodos declarados', (D.periodos || []).length > 0);
check('cada período disponible tiene su bloque',
  (D.periodos || []).filter((p) => p.disponible).every((p) => D.vistas.todos[p.id]),
  'un período marcado disponible pero sin datos rompe el filtro');
check('los períodos sin datos están marcados',
  (D.periodos || []).filter((p) => !D.vistas.todos[p.id]).every((p) => !p.disponible));
check('los canales declarados tienen vista',
  (D.canales || []).every((c) => D.vistas[c.id]));

/* ---------------------------------------------------------------- el estado de resultados cierra */
console.log('\nEstado de resultados');
for (const [canal, porPeriodo] of Object.entries(D.vistas)) {
  for (const [per, v] of Object.entries(porPeriodo)) {
    const etq = `${canal}/${per}`;
    const netas = linea(v, 'Ventas netas');
    const arriba = linea(v, 'Ventas brutas') + linea(v, 'Bonificaciones de plataforma')
      + linea(v, 'Anulaciones y reembolsos') + linea(v, 'Descuentos y cupones');
    check(`${etq}: las ventas netas son la suma de arriba`, cerca(arriba, netas),
      `suman ${Math.round(arriba)} y dice ${Math.round(netas)}`);

    const mb = linea(v, 'Margen bruto');
    check(`${etq}: margen bruto = ventas netas − costo`,
      cerca(netas + linea(v, 'Costo de la mercadería'), mb));

    const contrib = linea(v, 'Resultado de contribución');
    const esperado = mb + linea(v, 'Comisiones de plataforma')
      + linea(v, 'Envíos (neto de lo cobrado)') + linea(v, 'Impuestos de plataforma');
    check(`${etq}: contribución = margen bruto − cargos del canal`, cerca(esperado, contrib));
  }
}

/* ---------------------------------------------------------------- los cortes suman */
console.log('\nPeríodos y canales');
const T = D.vistas.todos;
if (T.q1 && T.q2) {
  check('las dos quincenas suman el mes en órdenes',
    T.q1.eerr.ordenes + T.q2.eerr.ordenes === T.mes.eerr.ordenes,
    `${T.q1.eerr.ordenes} + ${T.q2.eerr.ordenes} ≠ ${T.mes.eerr.ordenes}`);
  check('las dos quincenas suman el mes en ventas netas',
    cerca(linea(T.q1, 'Ventas netas') + linea(T.q2, 'Ventas netas'), linea(T.mes, 'Ventas netas')));
}
if (D.vistas.ml && D.vistas.tn) {
  check('los canales suman el total en órdenes',
    D.vistas.ml.mes.eerr.ordenes + D.vistas.tn.mes.eerr.ordenes === T.mes.eerr.ordenes,
    `${D.vistas.ml.mes.eerr.ordenes} + ${D.vistas.tn.mes.eerr.ordenes} ≠ ${T.mes.eerr.ordenes}`);
  check('los canales suman el total en ventas netas',
    cerca(linea(D.vistas.ml.mes, 'Ventas netas') + linea(D.vistas.tn.mes, 'Ventas netas'),
      linea(T.mes, 'Ventas netas')));
}
check('el gráfico diario cubre el mes entero', T.mes.dias.length === D.mesCerrado.dias);
// Las barras del gráfico son la venta bruta sin IVA: no incluyen las
// bonificaciones del canal, que sí entran en las ventas netas.
check('los días suman la venta bruta del mes',
  cerca(T.mes.dias.reduce((a, d) => a + d.v, 0), linea(T.mes, 'Ventas brutas'), 0.01),
  `días ${Math.round(T.mes.dias.reduce((a, d) => a + d.v, 0) / 1e6)} M vs brutas ${Math.round(linea(T.mes, 'Ventas brutas') / 1e6)} M`);

/* ---------------------------------------------------------------- cifras plausibles */
console.log('\nCifras');
const M = T.mes;
check('el margen bruto está entre 0% y 100%', pctDe(M, 'Margen bruto') > 0 && pctDe(M, 'Margen bruto') < 100,
  `da ${pctDe(M, 'Margen bruto')}%`);
check('la contribución no supera al margen bruto',
  pctDe(M, 'Resultado de contribución') <= pctDe(M, 'Margen bruto'));
check('lo depositado no supera a lo vendido', M.neto <= linea(M, 'Ventas netas') * 1.001,
  `depositado ${Math.round(M.neto)} vs vendido ${Math.round(linea(M, 'Ventas netas'))}`);
check('la cobertura de costos es razonable', M.eerr.cobertura >= 90,
  `${M.eerr.cobertura}% — hay SKU vendidos sin costo en la planilla`);
check('los cargos del canal son negativos',
  ['Comisiones de plataforma', 'Envíos (neto de lo cobrado)', 'Costo de la mercadería']
    .every((c) => linea(M, c) <= 0));

/* ---------------------------------------------------------------- listas */
console.log('\nListas');
check('hay productos', M.productos.length > 0);
check('los productos vienen ordenados por facturación',
  M.productos.every((p, i) => i === 0 || M.productos[i - 1].v >= p.v));
check('ningún producto sin nombre', M.productos.every((p) => p.n && p.n.length > 2));
check('las familias suman ~100%',
  cerca(M.familias.reduce((a, f) => a + f.v, 0), 100, 0.02),
  `suman ${M.familias.reduce((a, f) => a + f.v, 0).toFixed(1)}%`);
check('no hay dos familias con el mismo nombre',
  new Set(M.familias.map((f) => f.n)).size === M.familias.length);
check('las provincias suman ~100%', cerca(M.provincias.reduce((a, f) => a + f.v, 0), 100, 0.02));
check('los envíos no suman más órdenes que el mes',
  M.envios.reduce((a, e) => a + e.v, 0) <= M.eerr.ordenes);

/* ---------------------------------------------------------------- atención al cliente */
if (D.clientes) {
  console.log('\nAtención al cliente');
  const C = D.clientes;
  check('las urgencias suman los casos abiertos',
    C.postventa.urgencias.reduce((a, u) => a + u.n, 0) === C.postventa.abiertos,
    `${C.postventa.urgencias.reduce((a, u) => a + u.n, 0)} ≠ ${C.postventa.abiertos}`);
  check('hay versión por canal', !!(C.porCanal && C.porCanal.todos));
  if (C.porCanal && C.porCanal.ml && C.porCanal.tn) {
    check('los canales suman los casos',
      C.porCanal.ml.postventa.total + C.porCanal.tn.postventa.total === C.postventa.total);
  }
  check('el embudo de preventa va de mayor a menor',
    C.preventa.minorista.etapas.every((e, i, a) => i === 0 || a[i - 1].v >= e.v));
  check('los casos abiertos vienen por urgencia',
    C.postventa.casos.every((c, i, a) => {
      const orden = ['Alta', 'Media', 'Baja', 'Sin clasificar'];
      return i === 0 || orden.indexOf(a[i - 1].u) <= orden.indexOf(c.u);
    }));
}

/* ---------------------------------------------------------------- tamaño */
console.log('\nPeso');
const kb = fs.statSync(RUTA).size / 1024;
check(`el JSON pesa ${kb.toFixed(0)} KB (menos de 400)`, kb < 400);

console.log(`\n${fallas ? '✗' : '✓'} ${corridos - fallas}/${corridos} controles pasaron\n`);
process.exit(fallas ? 1 : 0);
