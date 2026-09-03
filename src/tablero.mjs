// tablero.mjs — arma el JSON que consume docs/direccion.html.
//
// Lo usan los dos caminos que llegan al tablero:
//   · tools/build-direccion.mjs, cuando se procesa desde la terminal
//   · docs/importar.js, cuando alguien arrastra los exports en el navegador
//
// Está acá para que sean literalmente el mismo cálculo: si el número del botón
// no coincidiera con el publicado, el tablero dejaría de servir para decidir.

import { IVA } from './costos.mjs';
import { eerr, agregar, unirCanales, unirMeses, sinIva } from './finanzas.mjs';

const MES_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MES_LARGO = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export const etiqueta = (mes) => `${MES_ES[+mes.slice(5, 7) - 1]} ${mes.slice(2, 4)}`;
export const largo = (mes) => `${MES_LARGO[+mes.slice(5, 7) - 1]} ${mes.slice(0, 4)}`;
export const diasDelMes = (mes) => new Date(Date.UTC(+mes.slice(0, 4), +mes.slice(5, 7), 0)).getUTCDate();

/** Cuántas líneas muestra cada lista del tablero. */
const FILAS = 10;

/** Un mes con menos órdenes que esto es la cola de otro export, no un mes de operación. */
const MINIMO_ORDENES = 100;

/* «Otros» es una familia real del maestro: los productos a los que nadie les
   asignó una. Junto al agrupador del resto se leían como lo mismo. */
const RENOMBRE_FAMILIA = { Otros: 'Sin familia asignada' };
const RESTO_FAMILIAS = 'Resto de familias';

const top = (map, n) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

function share(map, n, resto) {
  const tot = [...map.values()].reduce((a, b) => a + b, 0) || 1;
  const t = top(map, n);
  const out = t.map(([k, v]) => ({ n: k, v: +(100 * v / tot).toFixed(1) }));
  const usado = t.reduce((a, [, v]) => a + v, 0);
  if (tot - usado > 1) out.push({ n: resto, v: +(100 * (tot - usado) / tot).toFixed(1) });
  return out;
}

/**
 * Todo lo que el tablero necesita de un rango de meses, para un canal.
 *
 * El gráfico cambia de grano según lo que se pida: con un mes, una barra por día;
 * con varios, una por mes. Treinta barras se leen; noventa, no.
 */
export function bloque(porMes, meses) {
  if (!porMes || !meses || !meses.length) return null;
  const { acc, origen, totalDias } = unirMeses(porMes, meses);
  const a = agregar(acc, 1, totalDias);
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
      // Lo que todavía no tiene fuente. El tablero lo dice en vez de dibujar cero.
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
    puntos: puntosDe(a.dias, origen, meses),
    granularidad: meses.length === 1 ? 'dia' : 'mes',
    meses: meses.slice(),
    neto: Math.round(e.netoLiquidado),
  };
}

/** Los puntos del gráfico: por día si es un mes solo, por mes si son varios. */
function puntosDe(dias, origen, meses) {
  if (meses.length === 1) {
    return dias.map((d) => ({ ...d, etiqueta: String(origen.get(d.d).dia) }));
  }
  const porMes = new Map(meses.map((m) => [m, { ml: 0, tn: 0, v: 0, ordenes: 0 }]));
  for (const d of dias) {
    const o = origen.get(d.d);
    if (!o) continue;
    const p = porMes.get(o.mes);
    p.ml += d.ml; p.tn += d.tn; p.v += d.v; p.ordenes += d.ordenes;
  }
  return meses.map((m) => ({ ...porMes.get(m), d: m, etiqueta: etiqueta(m) }));
}

/**
 * El JSON completo del tablero.
 *
 * @param mapasMl   Map<mes, acumulador>[] de los exports de MercadoLibre
 * @param mapasTn   idem TiendaNube
 * @param post      salida de buildPostventa (con .porCanal), o null
 * @param meta      { costos:{hoja,mes,skus}, fuentes, generado }
 * @returns {{ok:true, tablero:{}}} o {{ok:false, error:string}}
 */
export function armarTablero({ mapasMl = [], mapasTn = [], post = null, meta = {} } = {}) {
  const porMes = unirCanales(...mapasMl, ...mapasTn);
  const porMesMl = unirCanales(...mapasMl);
  const porMesTn = unirCanales(...mapasTn);

  // Neto por canal: unirCanales ya perdió de qué canal venía cada peso.
  const netoCanal = new Map();
  const sumarCanal = (mapas, campo) => {
    for (const m of mapas) {
      for (const [mes, a] of m) {
        if (!netoCanal.has(mes)) netoCanal.set(mes, { ml: 0, tn: 0 });
        netoCanal.get(mes)[campo] += sinIva(agregar(a).netoLiquidado);
      }
    }
  };
  sumarCanal(mapasMl, 'ml');
  sumarCanal(mapasTn, 'tn');

  /* Un mes cuyo último día con ventas queda lejos del fin de mes está a medio
     cerrar: se marca parcial y no sirve de base de comparación. */
  const esParcial = (mes, a) => a.ultimoDia > 0 && a.ultimoDia < diasDelMes(mes) - 1;
  const totalMes = new Map([...porMes].map(([m, a]) => [m, agregar(a, 1, diasDelMes(m))]));
  const meses = [...porMes.keys()].filter((m) => totalMes.get(m).ordenes.size >= MINIMO_ORDENES).sort();
  if (!meses.length) {
    return { ok: false, error: `ningún mes de los exports llega a ${MINIMO_ORDENES} órdenes. ¿Es el archivo correcto?` };
  }

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
      parcial: esParcial(mes, porMes.get(mes)),
    };
  });

  const completos = serie.filter((s) => !s.parcial);
  if (!completos.length) {
    return { ok: false, error: 'todos los meses de los exports están a medio cerrar: falta el cierre del mes.' };
  }

  const mesCerrado = completos[completos.length - 1].mes;
  const acc = porMes.get(mesCerrado);
  const est = eerr(totalMes.get(mesCerrado));
  const previo = completos.length > 1 ? completos[completos.length - 2] : null;

  /* Los períodos del filtro, todos como rangos de meses. Se resuelven contra los
     meses que hay cargados: si el rango pide más de los que hay, se muestra lo
     que hay y se dice cuántos faltan, en vez de un tablero en cero. */
  const cargados = completos.map((s) => s.mes);           // ordenados, sin parciales
  const anioActual = mesCerrado.slice(0, 4);
  const ultimos = (n) => cargados.slice(-n);

  const periodos = [
    { id: 'm3', n: 'Últimos 3 meses', pide: 3, meses: ultimos(3) },
    { id: 'm6', n: 'Últimos 6 meses', pide: 6, meses: ultimos(6) },
    { id: 'anio', n: 'Este año', pide: +mesCerrado.slice(5, 7), meses: cargados.filter((m) => m.startsWith(anioActual)) },
    { id: 'rango', n: 'Rango', pide: 0, meses: cargados.slice(), libre: true },
  ].map((p) => ({
    ...p,
    disponible: p.meses.length > 0,
    // Cuántos exports faltarían para que el rango esté completo de verdad.
    faltan: Math.max(0, p.pide - p.meses.length),
  }));

  const fuentesCanal = { todos: porMes, ml: porMesMl, tn: porMesTn };
  const vistas = {};
  for (const [canal, fuente] of Object.entries(fuentesCanal)) {
    if (!fuente || !fuente.size) continue;
    vistas[canal] = {};
    for (const p of periodos) {
      const b = bloque(fuente, p.meses);
      if (b) vistas[canal][p.id] = b;
    }
    // Además, cada mes suelto: el selector de rango arma cualquier tramo con ellos.
    for (const mes of cargados) {
      const b = bloque(fuente, [mes]);
      if (b) vistas[canal][`mes:${mes}`] = b;
    }
    if (!Object.keys(vistas[canal]).length) delete vistas[canal];
  }

  return {
    ok: true,
    resumen: {
      mes: mesCerrado, ordenes: est.ordenes,
      margenBruto: est.margenBrutoPct, contribucion: est.contribucionPct,
      cobertura: est.coberturaCostosPct,
      parciales: serie.filter((s) => s.parcial).map((s) => s.mes),
      canales: Object.keys(vistas),
    },
    tablero: {
      generado: meta.generado || new Date().toISOString().slice(0, 10),
      iva: IVA,
      mesCerrado: {
        mes: mesCerrado, largo: largo(mesCerrado), dias: diasDelMes(mesCerrado),
        previo: previo ? previo.largo : null, previoMes: previo ? previo.mes : null,
      },
      // Los meses con datos, para que el selector de rango ofrezca sólo esos.
      mesesCargados: cargados.map((m) => ({ mes: m, largo: largo(m), corto: etiqueta(m) })),
      fuentes: meta.fuentes || {},
      serie,
      // vistas[canal][periodo]: el tablero cambia de corte sin volver a pedir nada.
      vistas,
      periodos: periodos.map((p) => ({
        id: p.id, n: p.n, faltan: p.faltan, libre: !!p.libre,
        meses: p.meses, pide: p.pide,
        disponible: p.disponible && !!(vistas.todos && vistas.todos[p.id]),
      })),
      canales: [
        { id: 'todos', n: 'Los dos canales' },
        { id: 'ml', n: 'Mercado Libre', v: Math.round((netoCanal.get(mesCerrado) || {}).ml || 0) },
        { id: 'tn', n: 'Tienda Nube', v: Math.round((netoCanal.get(mesCerrado) || {}).tn || 0) },
      ].filter((c) => c.id === 'todos' || vistas[c.id]),
      clientes: post,
    },
  };
}
