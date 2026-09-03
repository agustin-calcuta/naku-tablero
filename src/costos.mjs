// costos.mjs — costo unitario por SKU desde la "planilla madre" de compras.
//
// La planilla tiene una hoja por mes (OCTUBRE 2021 … JULIO 2026). Cada hoja
// repite el catálogo entero con los costos vigentes de ese mes, así que para el
// EERR de un mes se usa la hoja de ese mes (o la más nueva que exista).
//
// Layout (constante desde 2021):
//   fila 4  = encabezados
//   col C   = 'SKU: NAKU'        → el SKU que también usa el maestro y los canales
//   col CZ  = 'COSTO SIN IVA'    → costo landed unitario, sin IVA
//
// Se busca por NOMBRE de columna, nunca por índice: si mañana insertan una
// columna de embarque nueva (LANDED SOP 69…), esto sigue funcionando.

export const IVA = 0.21;

const HOJA_RE = /^(ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE)\s+(\d{4})$/;
const MES_NUM = {
  ENERO: 1, FEBRERO: 2, MARZO: 3, ABRIL: 4, MAYO: 5, JUNIO: 6,
  JULIO: 7, AGOSTO: 8, SEPTIEMBRE: 9, OCTUBRE: 10, NOVIEMBRE: 11, DICIEMBRE: 12,
};

/** 'JULIO 2026' → '2026-07'. Devuelve '' si el nombre no es un mes limpio. */
export function mesDeHoja(nombre) {
  const m = HOJA_RE.exec(String(nombre).trim().toUpperCase());
  if (!m) return '';
  return `${m[2]}-${String(MES_NUM[m[1]]).padStart(2, '0')}`;
}

/**
 * Las hojas con mes reconocible, de la más nueva a la más vieja.
 * Ignora las variantes ('AGOSTO 2023 CON DEVALUACION', 'ABRIL', 'Hoja 1'): son
 * escenarios o borradores, no el costo del mes.
 */
export function hojasPorMes(nombres) {
  return nombres
    .map((n) => ({ hoja: n, mes: mesDeHoja(n) }))
    .filter((x) => x.mes)
    .sort((a, b) => (a.mes < b.mes ? 1 : -1));
}

export const normSkuCosto = (s) => String(s ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
const soloAlnum = (s) => normSkuCosto(s).replace(/[^A-Z0-9]/g, '');

/**
 * SKU base: le saca los sufijos de variante que la planilla de compras no
 * desdobla (color, "modelo eléctrico", packs "X 2 UNITS"). El costo del pack es
 * el del unitario por la cantidad, así que además devolvemos el multiplicador.
 */
export function baseSku(s) {
  let t = normSkuCosto(s);
  let mult = 1;
  const pack = /\s*X\s*(\d+)\s*(UNITS?|U)?$/.exec(t);
  if (pack) { mult = parseInt(pack[1], 10) || 1; t = t.slice(0, pack.index); }
  t = t.replace(/\s*\((MODELO\s+)?ELECTRICO\)$/, '');
  t = t.replace(/\s+(COLOR\s+)?(NEGRO|NEGRA|BLANCO|BLANCA|MADERA|GRIS|ROJO|ROJA|CREMA|VERDE|AZUL|BEIGE|NATURAL)$/, '');
  t = t.replace(/[-\s]+$/, '');
  return { base: t.trim(), mult };
}

/**
 * rows = aoa de una hoja de la planilla madre (incluye las filas de título).
 * → { costo: Map<SKU, number>, hoja, mes, filas }
 */
export function buildCostos(rows, hoja = '', mes = '') {
  let h = -1;
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    if ((rows[i] || []).some((c) => c != null && /^COSTO SIN IVA$/i.test(String(c).trim()))) { h = i; break; }
  }
  if (h < 0) throw new Error(`costos: no encontré la fila de encabezados ("COSTO SIN IVA") en la hoja "${hoja}"`);

  const header = (rows[h] || []).map((c) => String(c ?? '').trim().toUpperCase());
  const iSku = header.indexOf('SKU: NAKU');
  const iCosto = header.indexOf('COSTO SIN IVA');
  if (iSku < 0) throw new Error(`costos: falta la columna "SKU: NAKU" en la hoja "${hoja}"`);

  const costo = new Map();
  let filas = 0;
  for (let r = h + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    const sku = normSkuCosto(row[iSku]);
    if (!sku) continue;
    const v = row[iCosto];
    const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^\d.-]/g, ''));
    if (!Number.isFinite(n) || n <= 0) continue;  // 0 = producto sin costear todavía
    filas++;
    if (!costo.has(sku)) costo.set(sku, n);        // primera aparición gana
  }
  return { costo, hoja, mes, filas };
}

/**
 * Matcher tolerante SKU→costo unitario. Cuatro pasadas, de la más estricta a la
 * más laxa, y cada resultado dice por dónde entró para poder auditarlo.
 *   exacto → alfanumérico (MP-01 ≈ MP-001) → base (22D-B MADERA → 22D-B) → nada
 */
export function makeCostMatcher({ costo }) {
  const porAlnum = new Map();
  const porBase = new Map();
  for (const [sku, v] of costo) {
    const a = soloAlnum(sku);
    if (!porAlnum.has(a)) porAlnum.set(a, v);
    const { base } = baseSku(sku);
    if (base && !porBase.has(base)) porBase.set(base, v);
  }

  return function costoDe(skuRaw) {
    const n = normSkuCosto(skuRaw);
    if (!n) return { costo: null, metodo: 'sin sku' };
    if (costo.has(n)) return { costo: costo.get(n), metodo: 'exacto' };

    const a = soloAlnum(n);
    if (porAlnum.has(a)) return { costo: porAlnum.get(a), metodo: 'alfanumerico' };
    // MP-01 vs MP-001: los ceros a la izquierda del número final no significan nada
    const sinCeros = a.replace(/(\D)0+(\d)/g, '$1$2');
    for (const [k, v] of porAlnum) {
      if (k.replace(/(\D)0+(\d)/g, '$1$2') === sinCeros) return { costo: v, metodo: 'alfanumerico' };
    }

    const { base, mult } = baseSku(n);
    if (porBase.has(base)) return { costo: porBase.get(base) * mult, metodo: mult > 1 ? 'pack' : 'variante' };
    const baseA = soloAlnum(base);
    for (const [k, v] of porBase) {
      if (soloAlnum(k) === baseA) return { costo: v * mult, metodo: mult > 1 ? 'pack' : 'variante' };
    }
    return { costo: null, metodo: 'sin costo' };
  };
}
