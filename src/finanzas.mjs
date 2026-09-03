// finanzas.mjs — estado de resultados desde los exports crudos de los canales.
//
// El motor de ventas (engine.mjs) sólo se queda con 'Total (ARS)', que es el
// NETO que Mercado Libre liquida — ya descontó comisión, envío e impuestos. Para
// un estado de resultados eso no alcanza: hace falta la venta bruta arriba y cada
// cargo como una línea. Los dos exports traen todo:
//
//   MercadoLibre  Ingresos por productos · Cargo por venta · Costo fijo ·
//                 Costo por ofrecer cuotas · Ingresos/Costos de envío ·
//                 Impuestos · Descuentos y bonificaciones · Anulaciones
//   TiendaNube    Subtotal de productos · Descuento · Costo de envío ·
//                 Costo de procesamiento · Interés por cuotas · Impuestos
//
// IVA: los importes de venta y los cargos de los canales vienen CON IVA; el
// costo de la planilla madre es SIN IVA. Comparar los dos sin corregir infla el
// margen unos 8 puntos. Todo el estado de resultados se expresa SIN IVA
// (criterio contable habitual: el IVA no es ingreso ni gasto, es un pasaje).
//
// Este módulo es aparte de engine.mjs a propósito: el tablero de ventas que ya
// usa Leo no se toca, así que sus números y su histórico quedan como están.

import { IVA } from './costos.mjs';
import { headerIndex, bucketEnvio, normSku, cleanName, familiaOf } from './engine.mjs';

export const sinIva = (v) => v / (1 + IVA);

const CANCEL_RE = /cancel|devoluc|reembol/i;

/** Números de los exports: '1.234,56', '$ 1234.56', 1234.56, ''. */
export function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  let s = String(v ?? '').trim().replace(/\$|\s/g, '');
  if (!s) return 0;
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.'); // es-AR
  else s = s.replace(/,/g, '');                                        // en-US
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

const MESES_ES = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};

/** '31 de julio de 2026 19:35 hs' → '2026-07'. */
export function mesML(v) {
  const m = /(\d{1,2})\s+de\s+([a-záéíóú]+)\s+de\s+(\d{4})/i.exec(String(v ?? ''));
  if (!m) return '';
  const n = MESES_ES[m[2].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')];
  return n ? `${m[3]}-${String(n).padStart(2, '0')}` : '';
}

/** '31/07/2026 19:35:07' → '2026-07'. */
export function mesTN(v) {
  const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(v ?? ''));
  return m ? `${m[3]}-${m[2].padStart(2, '0')}` : '';
}

/** Índice de encabezados por nombre; primera ocurrencia (los exports duplican). */
function idx(headerRow) {
  const pos = new Map();
  (headerRow || []).forEach((h, j) => {
    const k = String(h ?? '').trim();
    if (k && !pos.has(k)) pos.set(k, j);
  });
  return (name) => (pos.has(name) ? pos.get(name) : -1);
}

/** Los importes que se suman día por día. */
const MONTOS = ['ventaBruta', 'bonificaciones', 'anulaciones', 'descuentos', 'comisiones',
  'envioCobrado', 'envioCosto', 'impuestos', 'netoLiquidado', 'cogs', 'cogsFaltante',
  'lineas', 'canceladas', 'unidades', 'ml', 'tn'];

/**
 * TODO —importes y cortes— se acumula por día del mes. Así el tablero recorta
 * cualquier rango de fechas, estado de resultados incluido, sin volver a leer el
 * export. `agregar()` aplana el rango que se pida.
 */
const vacio = () => ({
  ultimoDia: 0,          // día de la venta más reciente: detecta meses a medio cerrar
  porDia: new Map(),
});

/** El casillero de un día, creado a demanda. */
function diaDe(a, dia) {
  if (!a.porDia.has(dia)) {
    const d = { ordenes: new Set(), skusSinCosto: new Map(),
      productos: new Map(), familias: new Map(), provincias: new Map(), envios: new Map() };
    for (const k of MONTOS) d[k] = 0;
    a.porDia.set(dia, d);
  }
  return a.porDia.get(dia);
}

/**
 * Aplana los días de un rango en un acumulador con la forma que espera eerr().
 * Sin argumentos devuelve el mes entero.
 */
export function agregar(acc, desde = 1, hasta = 31) {
  const t = { ordenes: new Set(), skusSinCosto: new Map(),
    productos: new Map(), familias: new Map(), provincias: new Map(), envios: new Map(),
    dias: [], ultimoDia: acc.ultimoDia };
  for (const k of MONTOS) t[k] = 0;

  for (let dia = desde; dia <= hasta; dia++) {
    const x = acc.porDia.get(dia);
    t.dias.push({
      d: dia,
      ml: x ? Math.round(x.ml) : 0,
      tn: x ? Math.round(x.tn) : 0,
      v: x ? Math.round(x.ml + x.tn) : 0,
      ordenes: x ? x.ordenes.size : 0,
    });
    if (!x) continue;
    for (const k of MONTOS) t[k] += x[k];
    for (const o of x.ordenes) t.ordenes.add(o);
    for (const [k, v] of x.skusSinCosto) {
      const p = t.skusSinCosto.get(k) || { facturacion: 0, lineas: 0 };
      p.facturacion += v.facturacion; p.lineas += v.lineas;
      t.skusSinCosto.set(k, p);
    }
    for (const [k, p] of x.productos) {
      const q = t.productos.get(k) || { sku: p.sku, n: p.n, v: 0, u: 0 };
      q.v += p.v; q.u += p.u;
      t.productos.set(k, q);
    }
    for (const campo of ['familias', 'provincias']) {
      for (const [k, v] of x[campo]) t[campo].set(k, (t[campo].get(k) || 0) + v);
    }
    for (const [k, set] of x.envios) {
      if (!t.envios.has(k)) t.envios.set(k, new Set());
      for (const o of set) t.envios.get(k).add(o);
    }
  }
  return t;
}

/** Acumula una línea sin costo del día, para el reporte de cobertura. */
function faltante(d, sku, monto) {
  const k = String(sku ?? '').trim().toUpperCase() || '(sin sku)';
  const p = d.skusSinCosto.get(k) || { facturacion: 0, lineas: 0 };
  p.facturacion += monto; p.lineas++;
  d.skusSinCosto.set(k, p);
}

/** Día del mes de una fecha de export ('31 de julio de 2026' / '31/07/2026'). */
function diaDelMes(v) {
  const m = /(\d{1,2})(?:\s+de\s+[a-záéíóú]+\s+de|\/\d{1,2}\/)/i.exec(String(v ?? ''));
  return m ? +m[1] : 0;
}

/** Suma una línea a los cortes del día que le toca. */
function acumularCortes(a, { sku, nombre, familia, unidades, monto, provincia, envio, orden, dia, canal }) {
  if (!dia) return;                 // sin fecha no entra en ningún corte
  const d = diaDe(a, dia);

  if (sku || nombre) {
    const k = sku || nombre;
    const p = d.productos.get(k) || { sku, n: nombre || sku, v: 0, u: 0 };
    p.v += monto; p.u += unidades;
    if (!p.n && nombre) p.n = nombre;
    d.productos.set(k, p);
  }
  if (familia) d.familias.set(familia, (d.familias.get(familia) || 0) + monto);
  if (provincia) d.provincias.set(provincia, (d.provincias.get(provincia) || 0) + monto);
  const b = bucketEnvio(envio);
  if (b) {
    if (!d.envios.has(b)) d.envios.set(b, new Set());
    d.envios.get(b).add(orden);
  }
  d[canal] += monto;
  d.ordenes.add(orden);
}

/**
 * Export de MercadoLibre / Mercado Shops (hoja 'Ventas AR').
 * @param aoa       matriz de la hoja, con las filas de título arriba
 * @param costoDe   matcher de src/costos.mjs
 * @returns Map<mes, acumulador>
 */
export function ingestFinanzasMeli(aoa, costoDe, match = null) {
  let h = -1;
  for (let i = 0; i < Math.min(aoa.length, 12); i++) {
    if ((aoa[i] || []).some((c) => c != null && String(c).includes('# de venta'))) { h = i; break; }
  }
  if (h < 0) throw new Error('MeLi: no se encontró la fila de encabezados ("# de venta")');

  const at = idx(aoa[h]);
  // 'Estado' aparece dos veces: la que sigue a 'Ciudad' es la provincia del comprador.
  const iProv = headerIndex(aoa[h]).provinciaIdx();
  const C = {
    venta: at('# de venta'), fecha: at('Fecha de venta'),
    estado: at('Estado'), desc: at('Descripción del estado'),
    unidades: at('Unidades'), sku: at('SKU'),
    bruto: at('Ingresos por productos (ARS)'),
    cargoVenta: at('Cargo por venta'), costoFijo: at('Costo fijo'),
    cargoCuotas: at('Costo por ofrecer cuotas'),
    envioIngreso: at('Ingresos por envío (ARS)'), envioCosto: at('Costos de envío (ARS)'),
    impuestos: at('Impuestos'), bonif: at('Descuentos y bonificaciones'),
    anul: at('Anulaciones y reembolsos (ARS)'), total: at('Total (ARS)'),
    titulo: at('Título de la publicación'), envio: at('Forma de entrega'),
  };
  for (const req of ['venta', 'bruto', 'total']) {
    if (C[req] < 0) throw new Error(`MeLi finanzas: falta una columna requerida (${req}) — ¿cambió el export?`);
  }

  const porMes = new Map();
  for (let r = h + 1; r < aoa.length; r++) {
    const row = aoa[r];
    if (!row) continue;
    const venta = row[C.venta];
    if (venta == null || String(venta).trim() === '') continue;

    const mes = mesML(row[C.fecha]);
    if (!mes) continue;
    if (!porMes.has(mes)) porMes.set(mes, vacio());
    const a = porMes.get(mes);

    const estado = String(row[C.estado] ?? '');
    const desc = String(C.desc >= 0 ? row[C.desc] ?? '' : '');
    if (CANCEL_RE.test(estado) || CANCEL_RE.test(desc)) {
      const dc = diaDelMes(row[C.fecha]);
      if (dc) diaDe(a, dc).canceladas++;
      continue;
    }

    const dia = diaDelMes(row[C.fecha]);
    if (!dia) continue;
    a.ultimoDia = Math.max(a.ultimoDia, dia);
    const d = diaDe(a, dia);

    d.lineas++;
    d.ordenes.add(String(venta).trim());

    // Los cargos ya vienen firmados en negativo: se suman, no se restan.
    d.ventaBruta += num(row[C.bruto]);
    d.comisiones += num(row[C.cargoVenta]) + num(row[C.costoFijo]) + num(row[C.cargoCuotas]);
    d.envioCobrado += num(row[C.envioIngreso]);
    d.envioCosto += num(row[C.envioCosto]);
    d.impuestos += num(row[C.impuestos]);
    d.bonificaciones += num(row[C.bonif]);
    d.anulaciones += num(row[C.anul]);
    d.netoLiquidado += num(row[C.total]);

    const u = num(row[C.unidades]) || 1;
    d.unidades += u;
    const bruto = num(row[C.bruto]);
    const { costo } = costoDe(row[C.sku]);
    if (costo == null) { d.cogsFaltante += bruto; faltante(d, row[C.sku], bruto); }
    else d.cogs += costo * u;

    const titulo = C.titulo >= 0 ? cleanName(row[C.titulo]) : '';
    const skuRaw = String(row[C.sku] ?? '').trim();
    const m = match ? match(row[C.sku], titulo) : null;
    acumularCortes(a, {
      sku: normSku(skuRaw),
      nombre: (m && m.nombre) || titulo || skuRaw,
      familia: (m && m.familia) || familiaOf('', '', skuRaw),
      unidades: u,
      monto: sinIva(bruto),
      provincia: iProv >= 0 ? String(row[iProv] ?? '').trim() : '',
      envio: C.envio >= 0 ? String(row[C.envio] ?? '').trim() : '',
      orden: String(venta).trim(),
      dia,
      canal: 'ml',
    });
  }
  return porMes;
}

/**
 * Export de TiendaNube (CSV ;, cp1252, una fila por línea de la orden).
 * Los cargos vienen en positivo: acá se guardan firmados igual que MeLi.
 */
export function ingestFinanzasTn(aoa, costoDe, match = null) {
  const at = idx(aoa[0]);
  const C = {
    orden: at('Número de orden'), fecha: at('Fecha'),
    estado: at('Estado de la orden'), pago: at('Estado del pago'),
    sku: at('SKU'), precio: at('Precio del producto'), cant: at('Cantidad del producto'),
    subtotal: at('Subtotal de productos'), descuento: at('Descuento'),
    envio: at('Costo de envío'), total: at('Total'),
    proceso: at('Costo de procesamiento'), interes: at('Interés por cuotas'),
    impuestos: at('Impuestos'), neto: at('Total neto'),
    titulo: at('Nombre del producto'), envio: at('Medio de envío'),
    provincia: at('Provincia o estado'),
  };
  if (C.orden < 0) throw new Error('TN finanzas: falta la columna "Número de orden"');

  const porMes = new Map();
  const vistas = new Set(); // el subtotal/envío/cargos se repiten por línea: se toman una vez por orden
  for (let r = 1; r < aoa.length; r++) {
    const row = aoa[r];
    if (!row || String(row[C.orden] ?? '').trim() === '') continue;

    const mes = mesTN(row[C.fecha]);
    if (!mes) continue;
    if (!porMes.has(mes)) porMes.set(mes, vacio());
    const a = porMes.get(mes);

    const dia = diaDelMes(row[C.fecha]);
    if (!dia) continue;
    if (CANCEL_RE.test(String(row[C.estado] ?? ''))) { diaDe(a, dia).canceladas++; continue; }

    const orden = String(row[C.orden]).trim();
    a.ultimoDia = Math.max(a.ultimoDia, dia);
    const d = diaDe(a, dia);
    d.lineas++;
    d.ordenes.add(orden);

    const claveOrden = `${mes}|${orden}`;
    if (!vistas.has(claveOrden)) {
      vistas.add(claveOrden);
      d.ventaBruta += num(row[C.subtotal]);
      d.descuentos += -num(row[C.descuento]);
      d.envioCosto += -num(row[C.envio]);
      d.comisiones += -(num(row[C.proceso]) + num(row[C.interes]));
      d.impuestos += -num(row[C.impuestos]);
      d.netoLiquidado += num(row[C.neto]);
    }

    const q = num(row[C.cant]) || 1;
    d.unidades += q;
    const monto = num(row[C.precio]) * q;
    const { costo } = costoDe(row[C.sku]);
    if (costo == null) { d.cogsFaltante += monto; faltante(d, row[C.sku], monto); }
    else d.cogs += costo * q;

    const titulo = C.titulo >= 0 ? cleanName(row[C.titulo]) : '';
    const skuRaw = String(row[C.sku] ?? '').trim();
    const m = match ? match(row[C.sku], titulo) : null;
    acumularCortes(a, {
      sku: normSku(skuRaw),
      nombre: (m && m.nombre) || titulo || skuRaw,
      familia: (m && m.familia) || familiaOf('', '', skuRaw),
      unidades: q,
      monto: sinIva(monto),
      provincia: C.provincia >= 0 ? String(row[C.provincia] ?? '').trim() : '',
      envio: C.envio >= 0 ? String(row[C.envio] ?? '').trim() : '',
      orden,
      dia,
      canal: 'tn',
    });
  }
  return porMes;
}

/**
 * Chequeo de integridad del export de MercadoLibre: 'Total (ARS)' tiene que ser
 * la suma de los componentes. Si no cierra, alguna columna cambió de nombre o de
 * significado y el estado de resultados quedó mal — mejor enterarse en el build
 * que en la reunión de directorio.
 */
export function verificarMeli(acc) {
  // acc puede venir por día: se aplana primero.
  if (acc.porDia) acc = agregar(acc);
  const suma = acc.ventaBruta + acc.envioCobrado + acc.comisiones + acc.envioCosto
    + acc.impuestos + acc.bonificaciones + acc.anulaciones;
  const delta = suma - acc.netoLiquidado;
  const rel = acc.netoLiquidado ? Math.abs(delta / acc.netoLiquidado) : 0;
  return { suma, neto: acc.netoLiquidado, delta, rel, ok: rel < 0.01 };
}

/** Une los acumuladores de los dos canales en uno por mes. */
export function unirCanales(...mapas) {
  const out = new Map();
  for (const m of mapas) {
    for (const [mes, a] of m) {
      if (!out.has(mes)) out.set(mes, vacio());
      const t = out.get(mes);
      t.ultimoDia = Math.max(t.ultimoDia, a.ultimoDia);
      for (const [dia, x] of a.porDia) {
        const d = diaDe(t, dia);
        for (const k of MONTOS) d[k] += x[k];
        for (const o of x.ordenes) d.ordenes.add(o);
        for (const [k, v] of x.skusSinCosto) {
          const p = d.skusSinCosto.get(k) || { facturacion: 0, lineas: 0 };
          p.facturacion += v.facturacion; p.lineas += v.lineas;
          d.skusSinCosto.set(k, p);
        }
        for (const [k, p] of x.productos) {
          const q = d.productos.get(k) || { sku: p.sku, n: p.n, v: 0, u: 0 };
          q.v += p.v; q.u += p.u;
          d.productos.set(k, q);
        }
        for (const campo of ['familias', 'provincias']) {
          for (const [k, v] of x[campo]) d[campo].set(k, (d[campo].get(k) || 0) + v);
        }
        for (const [k, set] of x.envios) {
          if (!d.envios.has(k)) d.envios.set(k, new Set());
          for (const o of set) d.envios.get(k).add(o);
        }
      }
    }
  }
  return out;
}

/**
 * Estado de resultados de un mes, sin IVA, hasta resultado de contribución.
 * De ahí para abajo (marketing, estructura, impuestos propios, amortizaciones,
 * financieros) no hay fuente todavía, así que no se inventa: se corta acá y el
 * tablero lo dice.
 */
export function eerr(acc) {
  const ventaBruta = sinIva(acc.ventaBruta);
  const bonificaciones = sinIva(acc.bonificaciones);
  const anulaciones = sinIva(acc.anulaciones);
  const descuentos = sinIva(acc.descuentos);
  const ventasNetas = ventaBruta + bonificaciones + anulaciones + descuentos;

  const cogs = -acc.cogs;                       // la planilla madre ya está sin IVA
  const margenBruto = ventasNetas + cogs;

  const comisiones = sinIva(acc.comisiones);
  const envio = sinIva(acc.envioCobrado + acc.envioCosto);
  const impuestos = sinIva(acc.impuestos);
  const contribucion = margenBruto + comisiones + envio + impuestos;

  const pct = (v) => (ventasNetas ? +(100 * v / ventasNetas).toFixed(1) : 0);
  const ordenes = acc.ordenes.size;

  return {
    ventaBruta, bonificaciones, anulaciones, descuentos, ventasNetas,
    cogs, margenBruto, comisiones, envio, impuestos, contribucion,
    margenBrutoPct: pct(margenBruto),
    contribucionPct: pct(contribucion),
    cogsPct: pct(cogs),
    comisionesPct: pct(comisiones),
    envioPct: pct(envio),
    impuestosPct: pct(impuestos),
    ordenes,
    unidades: acc.unidades,
    lineas: acc.lineas,
    canceladas: acc.canceladas,
    ticket: ordenes ? ventasNetas / ordenes : 0,
    // También sin IVA: si no, en TiendaNube —que casi no tiene cargos— lo
    // depositado daba MÁS que lo vendido, que no se entiende ni es cierto.
    netoLiquidado: sinIva(acc.netoLiquidado),
    // Qué parte de la venta quedó sin costear: si sube, el margen deja de ser confiable.
    coberturaCostosPct: acc.ventaBruta ? +(100 * (1 - acc.cogsFaltante / acc.ventaBruta)).toFixed(1) : 0,
    cogsFaltante: acc.cogsFaltante,
    // '(sin sku)' son líneas del export sin SKU cargado: no hay nada que costear
    // en la planilla, así que no van en la lista de pendientes de compras.
    skusSinCosto: [...acc.skusSinCosto.entries()]
      .filter(([sku]) => sku !== '(sin sku)')
      .map(([sku, v]) => ({ sku, ...v }))
      .sort((a, b) => b.facturacion - a.facturacion),
  };
}
