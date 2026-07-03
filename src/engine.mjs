// engine.mjs — Motor de normalización + matching + agregación para el tablero NAKU.
// PURO: sin I/O, sin DOM, sin dependencias. Corre igual en el browser (dashboard)
// y en Node (tests) y en Apps Script (con transpile mínimo si hiciera falta).
//
// Adaptadores (fuera de este archivo):
//   - MeLi .xlsx  -> SheetJS: XLSX.utils.sheet_to_json(ws,{header:1,raw:true}) => aoa
//   - TN   .csv   -> TextDecoder('windows-1252') + PapaParse(delimiter:';')   => aoa
// El aoa (array-of-arrays, incluye fila(s) de header) entra a ingestMeli/ingestTn.
//
// Reglas críticas implementadas (ver PLAN §4):
//   - MeLi: header en la fila que contiene '# de venta'; columnas por NOMBRE, no por índice
//           (el export deriva a 64 vs 67 columnas). Headers duplicados -> primera ocurrencia.
//   - Maestro: columna 'Buyer Persona' está DUPLICADA -> usar la PRIMERA (la poblada).
//   - Combos 'A + B' en el maestro -> se splitean del lado maestro.
//   - Cancel/devolución -> se excluyen de facturación.
//   - Dedup por clave compuesta (los 3 xlsx son cortes; re-subidas no deben duplicar).
//   - Cada línea carga NOMBRE de producto y FAMILIA (para mostrar nombre>SKU y agrupar
//     el "top productos" por familia con drill-down).

export const CANCEL_RE = /cancel|devoluc|reembol/i;
export const PERSONAS = ['Juan', 'Mariana', 'Lucho', 'Martin', 'Mario', 'Sin asignar'];

const MESES_ES = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10,
  noviembre: 11, diciembre: 12,
};

// ---------------------------------------------------------------- normalizadores

export function normSku(s) {
  return (s == null ? '' : String(s)).trim().toUpperCase().replace(/\s+/g, ' ');
}

// Variante "pelada": saca (...), multiplicadores xN y colores, para resolver
// SKUs de venta que llegan sin el sufijo del maestro (fallback tier-2).
export function stripVariant(s) {
  return normSku(s)
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\bX\d+\b/g, ' ')
    .replace(/\b(NEGRO|NEGRA|BLANCO|BLANCA|ROJO|ROJA|AZUL|VERDE|GRIS)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Limpia un nombre de producto para mostrar (saca comillas raras, colapsa espacios).
export function cleanName(s) {
  return (s == null ? '' : String(s)).replace(/\s+/g, ' ').replace(/\\+$/, '').trim();
}

// Último nodo de un path "A > B > C" (toma la 1ª categoría si vienen varias con coma).
export function lastCategory(s) {
  if (!s) return '';
  const first = String(s).split(',')[0];
  return first.split('>').pop().replace(/[\\/]+$/, '').replace(/\s+/g, ' ').trim();
}

// Familia = columna 'Familia' del maestro si existe; si no, último nodo de Categorías;
// si no, prefijo alfabético del SKU; último recurso 'Otros'.
export function familiaOf(familiaCol, categoria, sku) {
  const f = cleanName(familiaCol);
  if (f) return f;
  const c = lastCategory(categoria);
  if (c) return c;
  const m = normSku(sku).match(/^[A-Z]+/);
  return m ? m[0] : 'Otros';
}

// Números: acepta Number ya parseado (SheetJS) o string ES ("1.234,56") o "39773.09".
export function parseNumberES(x) {
  if (typeof x === 'number') return isFinite(x) ? x : 0;
  if (x == null) return 0;
  let s = String(x).trim();
  if (!s) return 0;
  if (/,\d/.test(s)) s = s.replace(/\./g, '').replace(',', '.'); // formato ES: . miles, , decimal
  else s = s.replace(/,/g, '');                                  // solo , de miles
  const n = parseFloat(s.replace(/[^0-9.\-]/g, ''));
  return isFinite(n) ? n : 0;
}

// "16 de junio de 2026 11:53 hs." -> "2026-06-16"
export function parseDateML(s) {
  if (!s) return '';
  const m = String(s).toLowerCase().match(/(\d{1,2})\s+de\s+([a-záéíóú]+)\s+de\s+(\d{4})/);
  if (!m) return '';
  const mes = MESES_ES[m[2]];
  if (!mes) return '';
  return `${m[3]}-${String(mes).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
}

// "01/07/2026 12:58:00" -> "2026-07-01"  (dd/mm/yyyy, día primero)
export function parseDateTN(s) {
  if (!s) return '';
  const m = String(s).trim().match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return '';
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

export const mesOf = (iso) => (iso && iso.length >= 7 ? iso.slice(0, 7) : ''); // YYYY-MM

// ---------------------------------------------------------------- headers duplicados

// Devuelve helpers para resolver columnas por nombre tolerando duplicados.
export function headerIndex(headerRow) {
  const pos = new Map(); // name -> [idx,...]
  headerRow.forEach((h, j) => {
    const k = (h == null ? '' : String(h)).trim();
    if (!pos.has(k)) pos.set(k, []);
    pos.get(k).push(j);
  });
  const first = (name) => (pos.has(name) ? pos.get(name)[0] : -1);
  // 'Estado' aparece 2 veces: la 2ª (después de 'Ciudad') es la provincia del comprador.
  const provinciaIdx = () => {
    const ciudad = first('Ciudad');
    const estados = pos.get('Estado') || [];
    const after = estados.filter((i) => i > ciudad);
    return after.length ? after[0] : -1;
  };
  return { pos, first, provinciaIdx };
}

// ---------------------------------------------------------------- maestro SKU->buyer

// rows = aoa del CSV/Sheet maestro (incluye header). Usa la PRIMERA 'Buyer Persona'.
// Columna 'Familia' es opcional (si no está, se deriva de 'Categorías'/prefijo).
export function buildMaestro(rows) {
  const header = rows[0].map((h) => (h == null ? '' : String(h)).trim());
  const idxFirst = (name) => header.indexOf(name);
  const BP = idxFirst('Buyer Persona'); // primera ocurrencia (la poblada)
  const SK = idxFirst('SKU');
  const NM = idxFirst('Nombre');
  const CA = idxFirst('Categorías');
  const FA = idxFirst('Familia'); // opcional
  const skuInfo = new Map();  // sku_norm -> { buyer, nombre, categoria, familia }
  const nameInfo = new Map(); // nombre_norm -> { buyer, nombre, categoria, familia } (fallback por título)
  let combos = 0;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length <= SK) continue;
    const buyer = (row[BP] == null ? '' : String(row[BP])).trim();
    if (!buyer) continue;
    const nombre = NM >= 0 ? cleanName(row[NM]) : '';
    const categoria = CA >= 0 ? cleanName(row[CA]) : '';
    const familia = familiaOf(FA >= 0 ? row[FA] : '', categoria, row[SK]);
    const info = { buyer, nombre, categoria, familia };
    if (nombre) {
      const nm = normSku(nombre);
      if (nm && !nameInfo.has(nm)) nameInfo.set(nm, info);
    }
    const field = row[SK] == null ? '' : String(row[SK]);
    const isCombo = field.includes('+');
    if (isCombo) combos++;
    // Una fila standalone (SKU suelto) mejora nombre/familia de una entrada que venía de un
    // combo, pero MANTIENE el buyer ya asignado (no mueve facturación; solo mejora el display).
    const upsert = (key, infoTok) => {
      const cur = skuInfo.get(key);
      if (!cur) { skuInfo.set(key, infoTok); return; }
      if (cur._combo && !isCombo) {
        cur.nombre = infoTok.nombre; cur.categoria = infoTok.categoria; cur.familia = infoTok.familia; cur._combo = false;
      }
    };
    for (const part of field.split('+')) {
      const t = normSku(part);
      if (!t) continue;
      const familiaTok = familiaOf(FA >= 0 ? row[FA] : '', categoria, t);
      upsert(t, { buyer, nombre, categoria, familia: familiaTok, _combo: isCombo });
      const st = stripVariant(t);
      if (st) upsert(st, { buyer, nombre, categoria, familia: familiaOf(FA >= 0 ? row[FA] : '', categoria, st), _combo: isCombo });
    }
  }
  return { skuInfo, nameInfo, combos };
}

// Devuelve un matcher (skuRaw, titulo) -> { buyer, method, nombre, familia, categoria }.
export function makeMatcher(maestro) {
  const { skuInfo, nameInfo } = maestro;
  const pack = (info, method) => ({
    buyer: info.buyer, method, nombre: info.nombre, familia: info.familia, categoria: info.categoria,
  });
  return function match(skuRaw, titulo) {
    const s = normSku(skuRaw);
    if (s) {
      if (skuInfo.has(s)) return pack(skuInfo.get(s), 'sku');
      for (const tok of s.split(' ')) if (skuInfo.has(tok)) return pack(skuInfo.get(tok), 'sku_token');
      const st = stripVariant(s);
      if (st && skuInfo.has(st)) return pack(skuInfo.get(st), 'sku_stripped');
    }
    const t = normSku(titulo);
    if (t && nameInfo.has(t)) return pack(nameInfo.get(t), 'titulo');
    return { buyer: 'Sin asignar', method: 'unmapped', nombre: '', familia: '', categoria: '' };
  };
}

// ---------------------------------------------------------------- ingest MeLi

// aoa = hoja 'Ventas AR' completa (array-of-arrays). Detecta header por '# de venta'.
export function ingestMeli(aoa, match, sourceFile = '') {
  let h = -1;
  for (let i = 0; i < Math.min(aoa.length, 12); i++) {
    if ((aoa[i] || []).some((c) => c != null && String(c).includes('# de venta'))) { h = i; break; }
  }
  if (h < 0) throw new Error('MeLi: no se encontró la fila de header ("# de venta")');
  const H = headerIndex(aoa[h]);
  const iVenta = H.first('# de venta');
  const iSKU = H.first('SKU');
  const iTotal = H.first('Total (ARS)');
  const iUni = H.first('Unidades');           // primera ocurrencia = cantidad de la línea
  const iEstado = H.first('Estado');          // primera = estado de la orden
  const iDesc = H.first('Descripción del estado');
  const iFecha = H.first('Fecha de venta');
  const iTitulo = H.first('Título de la publicación');
  const iProv = H.provinciaIdx();
  for (const need of [['# de venta', iVenta], ['SKU', iSKU], ['Total (ARS)', iTotal]]) {
    if (need[1] < 0) throw new Error(`MeLi: falta columna requerida "${need[0]}" (¿schema drift?)`);
  }
  const lines = [];
  for (let r = h + 1; r < aoa.length; r++) {
    const row = aoa[r];
    if (!row) continue;
    const venta = row[iVenta];
    if (venta == null || String(venta).trim() === '') continue;
    const estado = String(row[iEstado] ?? '');
    const desc = String(iDesc >= 0 ? row[iDesc] ?? '' : '');
    const billable = !(CANCEL_RE.test(estado) || CANCEL_RE.test(desc));
    const iso = parseDateML(row[iFecha]);
    const titulo = iTitulo >= 0 ? cleanName(row[iTitulo]) : '';
    const m = match(row[iSKU], titulo);
    const skuRaw = String(row[iSKU] ?? '').trim();
    lines.push({
      canal: 'MercadoLibre',
      order_id: String(venta).trim(),
      fecha: iso,
      mes: mesOf(iso),
      sku_raw: skuRaw,
      sku: normSku(row[iSKU]),
      buyer: m.buyer,
      match_method: m.method,
      nombre: m.nombre || titulo || skuRaw,               // nombre>SKU; fallback título/SKU
      familia: m.familia || familiaOf('', '', skuRaw),     // familia por prefijo si no mapea
      unidades: parseNumberES(row[iUni]) || 0,
      facturacion: billable ? parseNumberES(row[iTotal]) : 0,
      cuotas: 0,
      provincia: iProv >= 0 ? String(row[iProv] ?? '').trim() : '',
      estado_orden: billable ? 'valida' : 'cancel_devol',
      billable,
      source_file: sourceFile,
    });
  }
  return lines;
}

// ---------------------------------------------------------------- ingest TiendaNube

// aoa = CSV TN ya decodificado cp1252 y parseado (incluye header).
export function ingestTn(aoa, match, sourceFile = '') {
  const H = headerIndex(aoa[0]);
  const iOrden = H.first('Número de orden');
  const iFecha = H.first('Fecha');
  const iEstado = H.first('Estado de la orden');
  const iSKU = H.first('SKU');
  const iNombre = H.first('Nombre del producto');
  const iPrecio = H.first('Precio del producto');
  const iCant = H.first('Cantidad del producto');
  const iCuotas = H.first('Cantidad de cuotas');
  const iProv = H.first('Provincia o estado');
  const lines = [];
  for (let r = 1; r < aoa.length; r++) {
    const row = aoa[r];
    if (!row) continue;
    const orden = row[iOrden];
    if (orden == null || String(orden).trim() === '') continue;
    const estado = String(row[iEstado] ?? '').trim();
    const billable = !/cancel/i.test(estado); // Cancelada -> fuera; Archivada/Abierta -> dentro
    const iso = parseDateTN(row[iFecha]);
    const titulo = iNombre >= 0 ? cleanName(row[iNombre]) : '';
    const m = match(row[iSKU], titulo);
    const skuRaw = String(row[iSKU] ?? '').trim();
    const precio = parseNumberES(row[iPrecio]);
    const cant = parseNumberES(row[iCant]) || 0;
    lines.push({
      canal: 'TiendaNube',
      order_id: String(orden).trim(),
      fecha: iso,
      mes: mesOf(iso),
      sku_raw: skuRaw,
      sku: normSku(row[iSKU]),
      buyer: m.buyer,
      match_method: m.method,
      nombre: m.nombre || titulo || skuRaw,
      familia: m.familia || familiaOf('', '', skuRaw),
      unidades: cant,
      facturacion: billable ? precio * cant : 0,
      cuotas: iCuotas >= 0 ? parseNumberES(row[iCuotas]) : 0,
      provincia: iProv >= 0 ? String(row[iProv] ?? '').trim() : '',
      estado_orden: billable ? (estado || 'desconocido') : 'cancelada',
      billable,
      source_file: sourceFile,
    });
  }
  return lines;
}

// ---------------------------------------------------------------- dedup

export const lineKey = (l) =>
  `${l.canal}|${l.order_id}|${l.sku}|${l.unidades}|${l.facturacion}`;

// Devuelve { lines, dups } deduplicando por clave compuesta.
export function dedupe(lines, seen = new Set()) {
  const out = [];
  let dups = 0;
  for (const l of lines) {
    const k = lineKey(l);
    if (seen.has(k)) { dups++; continue; }
    seen.add(k);
    out.push(l);
  }
  return { lines: out, dups };
}

// ---------------------------------------------------------------- market basket

// Pares de SKU co-comprados en la misma orden. Señal baja en NAKU (~0.4% multi-ítem)
// pero suficiente para sugerir "combos naturales". Devuelve [{a,b,n}] ordenado por n.
export function basketPairs(lines) {
  const orders = new Map();
  for (const l of lines) {
    if (!l.billable || !l.sku) continue;
    const k = l.canal + '|' + l.order_id;
    let o = orders.get(k); if (!o) { o = new Map(); orders.set(k, o); }
    if (!o.has(l.sku)) o.set(l.sku, l);
  }
  const pairs = new Map();
  for (const o of orders.values()) {
    const arr = [...o.values()];
    if (arr.length < 2) continue;
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
      const key = [arr[i].sku, arr[j].sku].sort().join('␟');
      let p = pairs.get(key); if (!p) { p = { a: arr[i], b: arr[j], n: 0 }; pairs.set(key, p); }
      p.n++;
    }
  }
  return [...pairs.values()].sort((x, y) => y.n - x.n);
}

// Bundles por persona: pares co-comprados donde participa la persona, priorizando el
// cruce de familias (sugerir algo distinto a lo que ya compró). Top `n` por persona.
export function bundlesByPersona(lines, top = 3) {
  const pairs = basketPairs(lines);
  const out = {};
  for (const p of PERSONAS) {
    if (p === 'Sin asignar') continue;
    const rel = pairs
      .filter((pr) => pr.a.buyer === p || pr.b.buyer === p)
      .map((pr) => {
        const hero = pr.a.buyer === p ? pr.a : pr.b;   // lo que compra la persona
        const sug = pr.a.buyer === p ? pr.b : pr.a;     // lo que se lleva junto
        return { heroSku: hero.sku, heroNombre: hero.nombre, sugSku: sug.sku, sugNombre: sug.nombre, sugFamilia: sug.familia, sugBuyer: sug.buyer, cruzaFamilia: hero.familia !== sug.familia, n: pr.n };
      })
      .sort((a, b) => (b.cruzaFamilia - a.cruzaFamilia) || (b.n - a.n))
      .slice(0, top);
    out[p] = rel;
  }
  return out;
}

// ---------------------------------------------------------------- agregación

// Produce el rollup chico que consume el dashboard (nunca las líneas crudas).
export function aggregate(lines) {
  const byPersona = {};
  for (const p of PERSONAS) byPersona[p] = { facturacion: 0, unidades: 0, ordenes: 0, ticket: 0, cuotas: 0 };

  const orders = new Map();            // "canal|order_id" -> {total, cuotas, best, persona}
  const byMesCanalPersona = new Map(); // "mes|canal|persona" -> {facturacion, unidades}
  const unmapped = new Map();          // sku -> {sku, nombre, lines, facturacion}
  // fam[persona] = Map(familia -> { facturacion, unidades, productos: Map(sku -> {sku,nombre,facturacion,unidades}) })
  const fam = {};
  for (const p of PERSONAS) fam[p] = new Map();

  for (const l of lines) {
    const p = byPersona[l.buyer] ? l.buyer : 'Sin asignar';
    // por mes/canal/persona (filtro del dashboard)
    const mk = `${l.mes}|${l.canal}|${p}`;
    const mc = byMesCanalPersona.get(mk) || { mes: l.mes, canal: l.canal, buyer: p, facturacion: 0, unidades: 0 };
    mc.facturacion += l.facturacion; mc.unidades += l.unidades;
    byMesCanalPersona.set(mk, mc);
    // órdenes (ticket y # órdenes) — persona dominante = la de mayor facturación de línea
    const ok = `${l.canal}|${l.order_id}`;
    const o = orders.get(ok) || { total: 0, cuotas: l.cuotas || 0, best: -1, persona: 'Sin asignar' };
    o.total += l.facturacion;
    if (l.cuotas) o.cuotas = Math.max(o.cuotas, l.cuotas);
    if (l.facturacion > o.best) { o.best = l.facturacion; o.persona = p; }
    orders.set(ok, o);
    // facturación/unidades por persona
    byPersona[p].facturacion += l.facturacion;
    byPersona[p].unidades += l.unidades;
    // top por familia -> producto (drill-down)
    const fm = fam[p];
    const frow = fm.get(l.familia) || { familia: l.familia, facturacion: 0, unidades: 0, productos: new Map() };
    frow.facturacion += l.facturacion; frow.unidades += l.unidades;
    const pkey = l.sku || l.nombre;
    const prow = frow.productos.get(pkey) || { sku: l.sku_raw, nombre: l.nombre, facturacion: 0, unidades: 0 };
    prow.facturacion += l.facturacion; prow.unidades += l.unidades;
    frow.productos.set(pkey, prow);
    fm.set(l.familia, frow);
    // sin asignar (reporte para completar el maestro)
    if (p === 'Sin asignar' && l.sku) {
      const u = unmapped.get(l.sku) || { sku: l.sku_raw, nombre: l.nombre, lines: 0, facturacion: 0 };
      u.lines++; u.facturacion += l.facturacion; unmapped.set(l.sku, u);
    }
  }

  const ordCount = {}, ordSum = {}, cuoSum = {}, cuoCnt = {};
  for (const o of orders.values()) {
    const p = o.persona;
    ordCount[p] = (ordCount[p] || 0) + 1;
    ordSum[p] = (ordSum[p] || 0) + o.total;
    if (o.cuotas > 0) { cuoSum[p] = (cuoSum[p] || 0) + o.cuotas; cuoCnt[p] = (cuoCnt[p] || 0) + 1; }
  }
  for (const p of PERSONAS) {
    byPersona[p].ordenes = ordCount[p] || 0;
    byPersona[p].ticket = ordCount[p] ? Math.round(ordSum[p] / ordCount[p]) : 0;
    byPersona[p].cuotas = cuoCnt[p] ? +(cuoSum[p] / cuoCnt[p]).toFixed(1) : 0;
  }

  const totalFact = PERSONAS.reduce((a, p) => a + byPersona[p].facturacion, 0);
  const asignada = totalFact - byPersona['Sin asignar'].facturacion;
  for (const p of PERSONAS) {
    byPersona[p].sharePct = totalFact ? +(100 * byPersona[p].facturacion / totalFact).toFixed(1) : 0;
    byPersona[p].shareAsignadoPct = asignada && p !== 'Sin asignar'
      ? +(100 * byPersona[p].facturacion / asignada).toFixed(1) : 0;
  }

  // top por persona: familias ordenadas por $, cada una con sus productos (para expandir)
  // top por persona: familias y productos con facturación (impacto), unidades (volumen)
  // y precio promedio (densidad de valor) -> el trío que separa "escarbadientes" de "escritorio".
  const topByPersona = {};
  for (const p of PERSONAS) {
    const totalP = byPersona[p].facturacion || 1;
    topByPersona[p] = Array.from(fam[p].values())
      .map((f) => ({
        familia: f.familia,
        facturacion: Math.round(f.facturacion),
        unidades: f.unidades,
        precioProm: f.unidades ? Math.round(f.facturacion / f.unidades) : 0,
        sharePct: +(100 * f.facturacion / totalP).toFixed(1), // % de la facturación de la persona
        productos: Array.from(f.productos.values())
          .map((x) => ({
            ...x,
            facturacion: Math.round(x.facturacion),
            precioProm: x.unidades ? Math.round(x.facturacion / x.unidades) : 0,
            sharePct: +(100 * x.facturacion / totalP).toFixed(1),
          }))
          .sort((a, b) => b.facturacion - a.facturacion),
      }))
      .sort((a, b) => b.facturacion - a.facturacion);
  }

  return {
    byPersona,
    topByPersona,
    porMesCanalPersona: Array.from(byMesCanalPersona.values()),
    unmapped: Array.from(unmapped.values())
      .map((u) => ({ ...u, facturacion: Math.round(u.facturacion) }))
      .sort((a, b) => b.facturacion - a.facturacion),
    totales: {
      facturacion: Math.round(totalFact),
      facturacionAsignada: Math.round(asignada),
      coberturaPct: totalFact ? +(100 * asignada / totalFact).toFixed(1) : 0,
      lineas: lines.length,
      ordenes: orders.size,
    },
  };
}
