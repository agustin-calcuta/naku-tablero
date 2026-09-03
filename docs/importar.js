/* ============================================================
   Motor del tablero, para el navegador. GENERADO — no editar a mano.
   Se arma con: node tools/build-importer.mjs
   Fuente: src/costos.mjs, src/engine.mjs, src/finanzas.mjs, src/postventa.mjs
   Generado el 2026-09-03
   ============================================================ */
/* ── costos.mjs ── */
const __costos = (function () {
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

const IVA = 0.21;

const HOJA_RE = /^(ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE)\s+(\d{4})$/;
const MES_NUM = {
  ENERO: 1, FEBRERO: 2, MARZO: 3, ABRIL: 4, MAYO: 5, JUNIO: 6,
  JULIO: 7, AGOSTO: 8, SEPTIEMBRE: 9, OCTUBRE: 10, NOVIEMBRE: 11, DICIEMBRE: 12,
};

/** 'JULIO 2026' → '2026-07'. Devuelve '' si el nombre no es un mes limpio. */
function mesDeHoja(nombre) {
  const m = HOJA_RE.exec(String(nombre).trim().toUpperCase());
  if (!m) return '';
  return `${m[2]}-${String(MES_NUM[m[1]]).padStart(2, '0')}`;
}

/**
 * Las hojas con mes reconocible, de la más nueva a la más vieja.
 * Ignora las variantes ('AGOSTO 2023 CON DEVALUACION', 'ABRIL', 'Hoja 1'): son
 * escenarios o borradores, no el costo del mes.
 */
function hojasPorMes(nombres) {
  return nombres
    .map((n) => ({ hoja: n, mes: mesDeHoja(n) }))
    .filter((x) => x.mes)
    .sort((a, b) => (a.mes < b.mes ? 1 : -1));
}

const normSkuCosto = (s) => String(s ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
const soloAlnum = (s) => normSkuCosto(s).replace(/[^A-Z0-9]/g, '');

/**
 * SKU base: le saca los sufijos de variante que la planilla de compras no
 * desdobla (color, "modelo eléctrico", packs "X 2 UNITS"). El costo del pack es
 * el del unitario por la cantidad, así que además devolvemos el multiplicador.
 */
function baseSku(s) {
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
function buildCostos(rows, hoja = '', mes = '') {
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
function makeCostMatcher({ costo }) {
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

  return { IVA, mesDeHoja, hojasPorMes, normSkuCosto, baseSku, buildCostos, makeCostMatcher };
})();

/* ── engine.mjs ── */
const __engine = (function () {
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

const CANCEL_RE = /cancel|devoluc|reembol/i;
const PERSONAS = ['Juan', 'Mariana', 'Lucho', 'Martin', 'Mario', 'Sin asignar'];

// Fallback heurístico: clasifica un producto sin mapear por palabras clave del título,
// reflejando el criterio de negocio (así nada queda 'Sin asignar'). Devuelve
// { buyer, familia } o null si no reconoce nada.
function heuristicBuyer(nombre) {
  const t = (nombre == null ? '' : String(nombre)).toLowerCase();
  if (!t) return null;
  const has = (...ks) => ks.some((k) => t.includes(k));
  // comercio / mostrador (Mario)
  if (has('contadora de billete', 'contador de billete', 'lector de código', 'lector de codigo', 'lector 2d', 'lector 1d', 'código de barras', 'codigo de barras', 'gaveta', 'selladora', 'registradora', 'ticketera')) return { buyer: 'Mario', familia: 'Comercio' };
  // exterior / aventura (Lucho)
  if (has('sombrilla', 'gazebo', 'reposera', 'camping', 'playa', 'pesca', 'picnic', 'carpa', 'quincho', 'cama elástica', 'cama elastica')) return { buyer: 'Lucho', familia: 'Exterior y aire libre' };
  if (has('mesa') && has('exterior', 'plegable', 'picnic', 'playa')) return { buyer: 'Lucho', familia: 'Exterior y aire libre' };
  // home office (Martin)
  if (has('escritorio', 'sit-stand', 'sit stand', 'micrófono', 'microfono')) return { buyer: 'Martin', familia: 'Escritorios ergonómicos' };
  if (has('soporte') && has('monitor')) return { buyer: 'Martin', familia: 'Soportes de monitor' };
  // organización / limpieza / hogar / deco (Mariana)
  if (has('mopa', 'balde', 'trapeador', 'lampazo', 'escurridor', 'centrifug')) return { buyer: 'Mariana', familia: 'Limpieza' };
  if (has('percha')) return { buyer: 'Mariana', familia: 'Organización de ropa' };
  if (has('proyector', 'galaxia', 'velador', 'astronauta')) return { buyer: 'Mariana', familia: 'Iluminación' };
  if (has('coser', 'costura', 'organizador', 'zapatero', 'cesto', 'estantería', 'estanteria', 'carrito organizador')) return { buyer: 'Mariana', familia: 'Organizadores multiuso' };
  // resuelve la casa (Juan) — soportes de TV, seguridad, herramientas
  if (has('caja fuerte')) return { buyer: 'Juan', familia: 'Seguridad y vigilancia' };
  if (has('cámara', 'camara', 'vigilancia', 'seguridad')) return { buyer: 'Juan', familia: 'Seguridad y vigilancia' };
  if (has('escalera', 'herramienta', 'taladro')) return { buyer: 'Juan', familia: 'Herramientas y equipamiento' };
  if (has('soporte', 'rack', 'pedestal') && has('tv', 'televis', 'pared', 'techo', '"', '”')) return { buyer: 'Juan', familia: 'Móviles con Brazo' };
  if (has('soporte', 'rack')) return { buyer: 'Juan', familia: 'Móviles con Brazo' };
  return null;
}

// Normaliza la forma de envío (ML: 'Forma de entrega'; TN: 'Medio de envío') a
// cubetas legibles y comparables entre canales. '' si no hay dato.
function bucketEnvio(s) {
  const t = (s == null ? '' : String(s)).toLowerCase().trim();
  if (!t) return '';
  if (t.includes('flex')) return 'Flex';
  if (t.includes('colecta')) return 'Colecta';
  if (t.includes('full')) return 'Full';
  if (t.includes('retiro') || t.includes('deposito') || t.includes('depósito') || t.includes('acuerdo')) return 'Retiro/Acuerdo';
  if (t.includes('correo') || t.includes('andreani') || t.includes('oca') || t.includes('urbano') || t.includes('andesmar') || t.includes('mostto') || t.includes('despacho') || t.includes('nube')) return 'Correo/Andreani';
  if (t.includes('lastmile') || t.includes('domicilio')) return 'Envío a domicilio';
  return 'Otros';
}

const MESES_ES = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10,
  noviembre: 11, diciembre: 12,
};

// ---------------------------------------------------------------- normalizadores

function normSku(s) {
  return (s == null ? '' : String(s)).trim().toUpperCase().replace(/\s+/g, ' ');
}

// Variante "pelada": saca (...), multiplicadores xN y colores, para resolver
// SKUs de venta que llegan sin el sufijo del maestro (fallback tier-2).
function stripVariant(s) {
  return normSku(s)
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\bX\d+\b/g, ' ')
    .replace(/\b(NEGRO|NEGRA|BLANCO|BLANCA|ROJO|ROJA|AZUL|VERDE|GRIS)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Limpia un nombre de producto para mostrar (saca comillas raras, colapsa espacios).
function cleanName(s) {
  return (s == null ? '' : String(s)).replace(/\s+/g, ' ').replace(/\\+$/, '').trim();
}

// Último nodo de un path "A > B > C" (toma la 1ª categoría si vienen varias con coma).
function lastCategory(s) {
  if (!s) return '';
  const first = String(s).split(',')[0];
  return first.split('>').pop().replace(/[\\/]+$/, '').replace(/\s+/g, ' ').trim();
}

// Familia = columna 'Familia' del maestro si existe; si no, último nodo de Categorías;
// si no, prefijo alfabético del SKU; último recurso 'Otros'.
function familiaOf(familiaCol, categoria, sku) {
  const f = cleanName(familiaCol);
  if (f) return f;
  const c = lastCategory(categoria);
  if (c) return c;
  const m = normSku(sku).match(/^[A-Z]+/);
  return m ? m[0] : 'Otros';
}

// Números: acepta Number ya parseado (SheetJS) o string ES ("1.234,56") o "39773.09".
function parseNumberES(x) {
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
function parseDateML(s) {
  if (!s) return '';
  const m = String(s).toLowerCase().match(/(\d{1,2})\s+de\s+([a-záéíóú]+)\s+de\s+(\d{4})/);
  if (!m) return '';
  const mes = MESES_ES[m[2]];
  if (!mes) return '';
  return `${m[3]}-${String(mes).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
}

// "01/07/2026 12:58:00" -> "2026-07-01"  (dd/mm/yyyy, día primero)
function parseDateTN(s) {
  if (!s) return '';
  const m = String(s).trim().match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return '';
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

const mesOf = (iso) => (iso && iso.length >= 7 ? iso.slice(0, 7) : ''); // YYYY-MM

// ---------------------------------------------------------------- headers duplicados

// Devuelve helpers para resolver columnas por nombre tolerando duplicados.
function headerIndex(headerRow) {
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
function buildMaestro(rows) {
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
function makeMatcher(maestro) {
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
    const h = heuristicBuyer(titulo);
    if (h) return { buyer: h.buyer, method: 'heuristica', nombre: '', familia: h.familia, categoria: '' };
    return { buyer: 'Sin asignar', method: 'unmapped', nombre: '', familia: '', categoria: '' };
  };
}

// ---------------------------------------------------------------- ingest MeLi

// aoa = hoja 'Ventas AR' completa (array-of-arrays). Detecta header por '# de venta'.
function ingestMeli(aoa, match, sourceFile = '') {
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
  const iEnvio = H.first('Forma de entrega'); // primera ocurrencia (dup en el export)
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
    const skuRaw = String(row[iSKU] ?? '').trim();
    if (!skuRaw && !titulo) continue; // fila sin producto (ajuste/envío a nivel de orden)
    const m = match(row[iSKU], titulo);
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
      envio: iEnvio >= 0 ? String(row[iEnvio] ?? '').trim() : '',
      estado_orden: billable ? 'valida' : 'cancel_devol',
      billable,
      source_file: sourceFile,
    });
  }
  return lines;
}

// ---------------------------------------------------------------- ingest TiendaNube

// aoa = CSV TN ya decodificado cp1252 y parseado (incluye header).
function ingestTn(aoa, match, sourceFile = '') {
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
  const iEnvio = H.first('Medio de envío');
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
      envio: iEnvio >= 0 ? String(row[iEnvio] ?? '').trim() : '',
      estado_orden: billable ? (estado || 'desconocido') : 'cancelada',
      billable,
      source_file: sourceFile,
    });
  }
  return lines;
}

// ---------------------------------------------------------------- dedup

const lineKey = (l) =>
  `${l.canal}|${l.order_id}|${l.sku}|${l.unidades}|${l.facturacion}`;

// Devuelve { lines, dups } deduplicando por clave compuesta.
function dedupe(lines, seen = new Set()) {
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
function basketPairs(lines) {
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
function bundlesByPersona(lines, top = 3) {
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
function aggregate(lines) {
  const byPersona = {};
  for (const p of PERSONAS) byPersona[p] = { facturacion: 0, unidades: 0, ordenes: 0, ticket: 0, cuotas: 0 };

  const orders = new Map();            // "canal|order_id" -> {total, cuotas, best, persona}
  const byMesCanalPersona = new Map(); // "mes|canal|persona" -> {facturacion, unidades}
  const unmapped = new Map();          // sku -> {sku, nombre, lines, facturacion}
  // fam[persona] = Map(familia -> { facturacion, unidades, productos: Map(sku -> {sku,nombre,facturacion,unidades}) })
  const fam = {};
  for (const p of PERSONAS) fam[p] = new Map();
  const prov = {}; // persona -> { provincia -> facturacion }
  for (const p of PERSONAS) prov[p] = {};

  for (const l of lines) {
    const p = byPersona[l.buyer] ? l.buyer : 'Sin asignar';
    // por mes/canal/persona (filtro del dashboard)
    const mk = `${l.mes}|${l.canal}|${p}`;
    const mc = byMesCanalPersona.get(mk) || { mes: l.mes, canal: l.canal, buyer: p, facturacion: 0, unidades: 0 };
    mc.facturacion += l.facturacion; mc.unidades += l.unidades;
    byMesCanalPersona.set(mk, mc);
    // órdenes (ticket y # órdenes) — persona dominante = la de mayor facturación de línea
    const ok = `${l.canal}|${l.order_id}`;
    const o = orders.get(ok) || { total: 0, cuotas: l.cuotas || 0, best: -1, persona: 'Sin asignar', envio: '' };
    o.total += l.facturacion;
    if (l.cuotas) o.cuotas = Math.max(o.cuotas, l.cuotas);
    if (!o.envio && l.envio) o.envio = l.envio;
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
    // geografía (de dónde compra cada persona)
    if (l.provincia) prov[p][l.provincia] = (prov[p][l.provincia] || 0) + l.facturacion;
    // sin asignar (reporte para completar el maestro)
    if (p === 'Sin asignar' && l.sku) {
      const u = unmapped.get(l.sku) || { sku: l.sku_raw, nombre: l.nombre, lines: 0, facturacion: 0 };
      u.lines++; u.facturacion += l.facturacion; unmapped.set(l.sku, u);
    }
  }

  const ordCount = {}, ordSum = {}, cuoSum = {}, cuoCnt = {};
  const envioByPersona = {}; for (const p of PERSONAS) envioByPersona[p] = {};
  for (const o of orders.values()) {
    const p = o.persona;
    ordCount[p] = (ordCount[p] || 0) + 1;
    ordSum[p] = (ordSum[p] || 0) + o.total;
    if (o.cuotas > 0) { cuoSum[p] = (cuoSum[p] || 0) + o.cuotas; cuoCnt[p] = (cuoCnt[p] || 0) + 1; }
    const eb = bucketEnvio(o.envio) || 'Sin dato';
    const e = envioByPersona[p][eb] || (envioByPersona[p][eb] = { ordenes: 0, facturacion: 0 });
    e.ordenes++; e.facturacion += o.total;
  }
  // evolución mensual (total, todos los canales/personas) — respeta el filtro porque
  // aggregate ya recibe las líneas filtradas.
  const porMesMap = new Map();
  for (const r of byMesCanalPersona.values()) {
    if (!r.mes) continue;
    const m = porMesMap.get(r.mes) || { mes: r.mes, facturacion: 0, ml: 0, tn: 0, unidades: 0 };
    m.facturacion += r.facturacion; m.unidades += r.unidades;
    if (r.canal === 'MercadoLibre') m.ml += r.facturacion; else if (r.canal === 'TiendaNube') m.tn += r.facturacion;
    porMesMap.set(r.mes, m);
  }
  const porMes = [...porMesMap.values()].sort((a, b) => (a.mes < b.mes ? -1 : 1));
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
    envioByPersona,
    provinciaByPersona: prov,
    porMes,
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

  return { CANCEL_RE, PERSONAS, heuristicBuyer, bucketEnvio, normSku, stripVariant, cleanName, lastCategory, familiaOf, parseNumberES, parseDateML, parseDateTN, mesOf, headerIndex, buildMaestro, makeMatcher, ingestMeli, ingestTn, lineKey, dedupe, basketPairs, bundlesByPersona, aggregate };
})();

/* ── finanzas.mjs ── */
const __finanzas = (function () {
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

const { IVA } = __costos;
const { headerIndex, bucketEnvio, normSku, cleanName, familiaOf } = __engine;

const sinIva = (v) => v / (1 + IVA);

const CANCEL_RE = /cancel|devoluc|reembol/i;

/** Números de los exports: '1.234,56', '$ 1234.56', 1234.56, ''. */
function num(v) {
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
function mesML(v) {
  const m = /(\d{1,2})\s+de\s+([a-záéíóú]+)\s+de\s+(\d{4})/i.exec(String(v ?? ''));
  if (!m) return '';
  const n = MESES_ES[m[2].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')];
  return n ? `${m[3]}-${String(n).padStart(2, '0')}` : '';
}

/** '31/07/2026 19:35:07' → '2026-07'. */
function mesTN(v) {
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
function agregar(acc, desde = 1, hasta = 31) {
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
function ingestFinanzasMeli(aoa, costoDe, match = null) {
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
function ingestFinanzasTn(aoa, costoDe, match = null) {
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
function verificarMeli(acc) {
  // acc puede venir por día: se aplana primero.
  if (acc.porDia) acc = agregar(acc);
  const suma = acc.ventaBruta + acc.envioCobrado + acc.comisiones + acc.envioCosto
    + acc.impuestos + acc.bonificaciones + acc.anulaciones;
  const delta = suma - acc.netoLiquidado;
  const rel = acc.netoLiquidado ? Math.abs(delta / acc.netoLiquidado) : 0;
  return { suma, neto: acc.netoLiquidado, delta, rel, ok: rel < 0.01 };
}

/**
 * Colapsa varios meses de un mismo mapa en un acumulador único.
 * Los días se reindexan corridos (mes 1 día 1 → 1, mes 2 día 1 → 32…) para que
 * `agregar` los recorra en orden; el mapa `origen` dice de qué mes salió cada uno.
 */
function unirMeses(porMes, meses) {
  const t = vacio();
  const origen = new Map();
  let base = 0;
  for (const mes of meses) {
    const a = porMes.get(mes);
    const dias = new Date(Date.UTC(+mes.slice(0, 4), +mes.slice(5, 7), 0)).getUTCDate();
    if (a) {
      t.ultimoDia = Math.max(t.ultimoDia, a.ultimoDia);
      for (const [dia, x] of a.porDia) {
        const d = diaDe(t, base + dia);
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
    for (let d = 1; d <= dias; d++) origen.set(base + d, { mes, dia: d });
    base += dias;
  }
  return { acc: t, origen, totalDias: base };
}

/** Une los acumuladores de los dos canales en uno por mes. */
function unirCanales(...mapas) {
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
function eerr(acc) {
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

  return { sinIva, num, mesML, mesTN, agregar, ingestFinanzasMeli, ingestFinanzasTn, verificarMeli, unirMeses, unirCanales, eerr };
})();

/* ── postventa.mjs ── */
const __postventa = (function () {
// postventa.mjs — indicadores de la central de atención al cliente.
//
// Fuente: el Google Sheet que maneja la app de Apps Script (hojas 'Postventa',
// 'Preventa Minorista', 'Preventa Volumen'). Se lee por NOMBRE de columna: la
// app agrega columnas con sincronizarEstructura(), así que los índices se mueven.
//
// QUÉ SE PUEDE MEDIR Y QUÉ NO
// Tres campos que el tablero necesitaría no se están cargando, así que en vez de
// mostrar un número inventado se informan como pendientes (ver `calidad`):
//
//   'Fecha de cierre'   la sella el servidor desde el 04/09/2026. Los 759 casos
//                       cerrados antes se rellenaron de una con la última
//                       actualización: son APROXIMADOS. Sirven para la tendencia
//                       de la cola mes a mes, no para medir cuánto tardó un caso.
//                       Ver CIERRES_REALES_DESDE.
//   '3· Contactado'     se marca junto con el alta (mediana ingreso→contactado:
//                       medio minuto, y a veces anterior al alta). Mide cuándo
//                       se cargó el caso, no cuándo se le respondió al cliente.
//   'Estatus' preventa  queda en el inicial 'Pregunta Meli' casi siempre, así
//                       que no hay resultado del embudo (ganado/perdido).
//
// Lo que sí es sólido: urgencia, tipo de reclamo, área, canal, estatus de
// postventa (abierto/resuelto) y las etapas de arriba del embudo de preventa.
//
// La fecha de referencia es el último movimiento cargado, no la fecha de hoy:
// así el snapshot da lo mismo cada vez que se regenera.

/**
 * Desde cuándo la fecha de cierre la sella el servidor de verdad.
 *
 * El relleno de los casos viejos copió 'Última actualización' en 'Fecha de
 * cierre', así que esos 759 cierres son aproximados. No alcanza con comparar los
 * dos campos para distinguirlos: al cerrar un caso, `guardarCaso()` sella los dos
 * con el mismo instante, así que un cierre real recién hecho también los tiene
 * iguales. La fecha de corte es la única señal que no se confunde.
 *
 * Es la fecha del backfill; se toca una sola vez y queda fija.
 */
const CIERRES_REALES_DESDE = new Date('2026-09-04T00:00:00Z');

const ABIERTO = 'En gestión';
const OK = 'Resuelto satisfactoriamente';
const MAL = 'Resuelto insatisfactoriamente';
const URGENCIAS = ['Alta', 'Media', 'Baja'];
const SIN_CLASIF = 'Sin clasificar';
const CLASE = { Alta: 'alta', Media: 'media', Baja: 'baja', [SIN_CLASIF]: 'nula' };
const ORDEN_URG = [...URGENCIAS, SIN_CLASIF];
const MES_LARGO = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const mesLegible = (mes) => `${MES_LARGO[+mes.slice(5, 7) - 1]} ${mes.slice(0, 4)}`;

const txt = (v) => (v == null ? '' : String(v).trim());
const vacia = (v) => { const s = txt(v); return s === '' || s === 'None'; };

/** Fecha de una celda: ISO del backend, Date de la lib de Excel, o nada. */
function fecha(v) {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const s = txt(v);
  if (!s || s === 'None' || s === 'NaT') return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
const mesDe = (d) => (d ? `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}` : '');
const dias = (a, b) => (a && b ? (b - a) / 86400000 : null);

/**
 * Mes de referencia: el último mes cerrado respecto del corte. Si el corte cae
 * en los primeros días de un mes, ese mes recién empieza y sus totales no se
 * pueden comparar contra nada — se usa el anterior.
 */
function mesReferencia(corte) {
  const d = new Date(corte);
  if (d.getUTCDate() < 28) d.setUTCDate(0); // último día del mes anterior
  return mesDe(d);
}

/** aoa (con encabezados en la fila 0) → array de objetos por nombre de columna. */
function filasPorNombre(aoa) {
  if (!aoa || !aoa.length) return [];
  const header = (aoa[0] || []).map(txt);
  return aoa.slice(1)
    .filter((r) => r && r.some((c) => !vacia(c)))
    .map((r) => {
      const o = {};
      header.forEach((h, j) => { if (h) o[h] = r[j]; });
      return o;
    });
}

const cuenta = (arr, fn) => {
  const m = new Map();
  for (const x of arr) { const k = fn(x); if (!k || k === 'None') continue; m.set(k, (m.get(k) || 0) + 1); }
  return [...m.entries()].map(([n, v]) => ({ n, v })).sort((a, b) => b.v - a.v);
};

/**
 * @param aoaPostventa   hoja 'Postventa'
 * @param aoaMinorista   hoja 'Preventa Minorista'
 * @param aoaVolumen     hoja 'Preventa Volumen'
 * @param ordenesPorMes  { '2026-08': 11385, … } para reclamos cada 100 órdenes
 * @param canal          'todos' | 'Mercado Libre' | 'Tienda Nube' — el filtro del
 *                       tablero alcanza también a la central de atención
 */
function buildPostventa(aoaPostventa, aoaMinorista, aoaVolumen, ordenesPorMes = {}, canal = 'todos') {
  const delCanal = (c) => canal === 'todos' || c === canal;
  const pv = filasPorNombre(aoaPostventa).map((r) => ({
    id: txt(r['Caso']),
    ingreso: fecha(r['Ingreso del mensaje']),
    alta: fecha(r['Alta del caso']),
    contactado: fecha(r['3· Contactado']),
    cierre: fecha(r['Fecha de cierre']),
    actualizado: fecha(r['Última actualización']),
    urgencia: URGENCIAS.includes(txt(r['Urgencia'])) ? txt(r['Urgencia']) : SIN_CLASIF,
    tipo: txt(r['Tipo de reclamo']) || 'Sin tipificar',
    canalVenta: txt(r['Canal de venta']),
    sku: txt(r['SKU']),
    area: txt(r['Área derivada']),
    estatus: txt(r['7· Estatus']),
    responsable: txt(r['Último responsable']),
  })).filter((r) => r.id && delCanal(r.canalVenta));

  if (!pv.length) return null;

  const corte = new Date(Math.max(...pv.flatMap((r) =>
    [r.actualizado, r.alta, r.cierre, r.ingreso].filter(Boolean).map((d) => d.getTime()))));
  const mesRef = mesReferencia(corte);

  // ¿Se están cargando los campos que hacen falta para medir tiempos?
  const conCierre = pv.filter((r) => r.cierre).length;
  const resueltos = pv.filter((r) => r.estatus === OK || r.estatus === MAL);
  // Todo lo cerrado antes del backfill trae una fecha copiada, no medida.
  const aproximado = (r) => r.cierre && r.cierre < CIERRES_REALES_DESDE;
  // Si contactado ≈ alta, la marca es del momento de la carga, no de la respuesta.
  const respuestaPropia = pv.filter((r) => r.contactado && r.alta
    && Math.abs(r.contactado - r.alta) > 30 * 60 * 1000).length;

  const cierresReales = resueltos.filter((r) => r.cierre && !aproximado(r));
  const calidad = {
    cierreCargado: resueltos.length ? +(100 * conCierre / resueltos.length).toFixed(0) : 0,
    cierreReal: resueltos.length ? +(100 * cierresReales.length / resueltos.length).toFixed(0) : 0,
    respuestaCargada: pv.length ? +(100 * respuestaPropia / pv.length).toFixed(0) : 0,
    faltantes: [],
  };
  if (calidad.cierreCargado < 20) {
    calidad.faltantes.push('Fecha de cierre: no se está cargando, así que no hay tiempo de resolución ni evolución de la cola mes a mes.');
  } else if (cierresReales.length < 10) {
    const desde = CIERRES_REALES_DESDE.toISOString().slice(0, 10);
    calidad.faltantes.push(`Los ${conCierre - cierresReales.length} casos cerrados antes del ${desde} `
      + 'tienen una fecha de cierre aproximada: se copió de la última actualización cuando se '
      + 'empezó a registrar el cierre. Sirve para la tendencia mes a mes, no para medir cuánto '
      + 'tardó un caso. El tiempo de resolución aparece con los cierres nuevos.');
  }
  if (calidad.respuestaCargada < 30) {
    calidad.faltantes.push('«3· Contactado» se marca junto con el alta del caso: mide cuándo se registró, no cuándo se le respondió al cliente.');
  }

  const abiertos = pv.filter((r) => r.estatus === ABIERTO);
  const conDias = abiertos.map((r) => ({
    ...r, dias: Math.max(0, Math.floor(dias(r.ingreso || r.alta, corte) ?? 0)),
  }));
  const vencidos = conDias.filter((r) => r.urgencia === 'Alta' && r.dias >= 2).length;

  const delMes = pv.filter((r) => mesDe(r.alta || r.ingreso) === mesRef);
  const base = delMes.length ? delMes : pv;
  const resueltosBase = base.filter((r) => r.estatus === OK || r.estatus === MAL);
  const okBase = base.filter((r) => r.estatus === OK).length;

  const detalle = (u) => {
    const g = conDias.filter((r) => r.urgencia === u);
    if (!g.length) return 'Ninguno abierto';
    const viejo = Math.max(...g.map((r) => r.dias));
    if (u === SIN_CLASIF) return 'Sin urgencia cargada';
    if (u === 'Alta') {
      const v = g.filter((r) => r.dias >= 2).length;
      return v ? `${v} hace más de 48 h` : 'Ninguno pasó las 48 h';
    }
    return viejo >= 7 ? `El más viejo, ${viejo} días` : 'Todos de esta semana';
  };

  // El tiempo hasta el cierre se mide sólo con cierres reales: mezclarlos con los
  // rellenados daría una mediana que no corresponde a ninguna gestión de verdad.
  const tiempos = cierresReales
    .map((r) => dias(r.ingreso || r.alta, r.cierre))
    .filter((d) => Number.isFinite(d) && d >= 0 && d < 365)
    .sort((a, b) => a - b);
  const medianaCierre = tiempos.length >= 10
    ? (tiempos.length % 2 ? tiempos[tiempos.length >> 1]
      : (tiempos[(tiempos.length >> 1) - 1] + tiempos[tiempos.length >> 1]) / 2)
    : null;

  const ordenesRef = ordenesPorMes[mesRef] || 0;
  const kpis = [
    { n: `Ingresados en ${mesLegible(mesRef).replace(/ \d{4}$/, '')}`, v: String(base.length) },
    { n: 'Resueltos', v: String(resueltosBase.length) },
    {
      n: 'Resueltos satisfactoriamente',
      v: resueltosBase.length ? `${Math.round(100 * okBase / resueltosBase.length)}%` : '—',
    },
    { n: 'Siguen abiertos', v: String(base.filter((r) => r.estatus === ABIERTO).length) },
  ];
  if (medianaCierre != null) {
    kpis.push({ n: 'Días hasta el cierre', v: medianaCierre.toFixed(1).replace('.', ',') });
  }
  if (ordenesRef) {
    kpis.push({
      n: 'Reclamos cada 100 órdenes',
      v: (100 * base.length / ordenesRef).toFixed(1).replace('.', ','),
    });
  }

  // ---------------- preventa ----------------
  const min = filasPorNombre(aoaMinorista).map((r) => ({
    id: txt(r['Caso']),
    alta: fecha(r['Alta del caso']),
    respondido: fecha(r['2· Respondido']),
    seguimiento: fecha(r['3· Seguimiento']),
    estatus: txt(r['Estatus']),
    canal: txt(r['Canal de comunicación']),
  })).filter((r) => r.id
    // La preventa no registra canal de venta —todavía no hay venta—, así que el
    // canal de comunicación es lo más cercano: Mercado Libre o el resto.
    && (canal === 'todos'
      || (canal === 'Mercado Libre' ? r.canal === 'Mercado Libre' : r.canal !== 'Mercado Libre')));

  const minMes = min.filter((r) => mesDe(r.alta) === mesRef);
  const minBase = minMes.length ? minMes : min;
  const ganados = minBase.filter((r) => r.estatus === 'Ganado').length;
  const perdidos = minBase.filter((r) => r.estatus === 'Perdido').length;
  const enSeguimiento = minBase.filter((r) => r.estatus === 'En seguimiento').length;
  const sinResolver = minBase.filter((r) => !r.estatus || r.estatus === 'None' || r.estatus === 'Pregunta Meli').length;
  const resultadoConfiable = minBase.length > 0 && sinResolver / minBase.length < 0.5;

  const vol = filasPorNombre(aoaVolumen).filter((r) => txt(r['Caso']));

  return {
    canal,
    corte: corte.toISOString().slice(0, 10),
    mesRef,
    mesRefLargo: mesLegible(mesRef),
    cierresAproximados: conCierre - cierresReales.length,
    calidad,
    postventa: {
      total: pv.length,
      abiertos: abiertos.length,
      vencidos,
      // Las cuatro categorías tienen que sumar los abiertos: si hay casos sin
      // urgencia cargada, aparecen como su propia luz en vez de desaparecer.
      urgencias: [...URGENCIAS, SIN_CLASIF]
        .map((u) => ({ u, n: conDias.filter((r) => r.urgencia === u).length, d: detalle(u), clase: CLASE[u] }))
        .filter((x) => x.n > 0 || x.u !== SIN_CLASIF),
      kpis,
      // Los urgentes primero y, dentro de cada urgencia, el que lleva más días.
      // 'Sin clasificar' no está en URGENCIAS: sin este orden explícito su -1 lo
      // ponía arriba de los de urgencia alta.
      casos: conDias
        .sort((a, b) => (ORDEN_URG.indexOf(a.urgencia) - ORDEN_URG.indexOf(b.urgencia)) || b.dias - a.dias)
        .slice(0, 40)
        .map((r) => ({ id: r.id, u: r.urgencia, t: r.tipo, p: r.sku || 'NO-APLICA', r: r.responsable, d: r.dias })),
      reclamos: cuenta(base, (r) => r.tipo),
      areas: cuenta(base.filter((r) => r.area), (r) => r.area),
      canales: cuenta(base, (r) => r.canalVenta),
      responsables: cuenta(base, (r) => r.responsable),
      // Sólo tiene sentido con 'Fecha de cierre' cargada; si no, el tablero la oculta.
      // Para la cola alcanza con saber en qué mes se cerró: los aproximados entran.
      cola: calidad.cierreCargado >= 20
        ? [...new Set(pv.map((r) => mesDe(r.alta || r.ingreso)).filter(Boolean))].sort().map((mes) => {
          const fin = new Date(Date.UTC(+mes.slice(0, 4), +mes.slice(5, 7), 0, 23, 59, 59));
          return {
            mes,
            v: pv.filter((r) => {
              const ini = r.alta || r.ingreso;
              return ini && ini <= fin && (!r.cierre || r.cierre > fin);
            }).length,
          };
        })
        : null,
    },
    preventa: {
      minorista: {
        total: minBase.length,
        resultadoConfiable,
        etapas: [
          { e: 'Consultas recibidas', v: minBase.length, clase: '' },
          { e: 'Respondidas', v: minBase.filter((r) => r.respondido).length, clase: '' },
          { e: 'Con seguimiento', v: minBase.filter((r) => r.seguimiento).length, clase: '' },
          ...(resultadoConfiable ? [
            { e: '→ Ganadas', v: ganados, clase: 'gana' },
            { e: '→ En seguimiento', v: enSeguimiento, clase: '' },
            { e: '→ Perdidas', v: perdidos, clase: 'pierde' },
          ] : []),
        ],
        sinResolver,
        ganados,
        perdidos,
        canales: cuenta(minBase, (r) => r.canal),
      },
      volumen: { casos: vol.length },
    },
  };
}

  return { fecha, mesReferencia, filasPorNombre, buildPostventa };
})();

/* ── tablero.mjs ── */
const __tablero = (function () {
// tablero.mjs — arma el JSON que consume docs/direccion.html.
//
// Lo usan los dos caminos que llegan al tablero:
//   · tools/build-direccion.mjs, cuando se procesa desde la terminal
//   · docs/importar.js, cuando alguien arrastra los exports en el navegador
//
// Está acá para que sean literalmente el mismo cálculo: si el número del botón
// no coincidiera con el publicado, el tablero dejaría de servir para decidir.

const { IVA } = __costos;
const { eerr, agregar, unirCanales, unirMeses, sinIva } = __finanzas;

const MES_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MES_LARGO = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const etiqueta = (mes) => `${MES_ES[+mes.slice(5, 7) - 1]} ${mes.slice(2, 4)}`;
const largo = (mes) => `${MES_LARGO[+mes.slice(5, 7) - 1]} ${mes.slice(0, 4)}`;
const diasDelMes = (mes) => new Date(Date.UTC(+mes.slice(0, 4), +mes.slice(5, 7), 0)).getUTCDate();

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
function bloque(porMes, meses) {
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
function armarTablero({ mapasMl = [], mapasTn = [], post = null, meta = {} } = {}) {
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

  return { etiqueta, largo, diasDelMes, bloque, armarTablero };
})();

/* ── datos que el motor necesita y no vienen en los exports ── */
const NAKU_MAESTRO_CSV = "Identificador de URL;Nombre;Categorías;Buyer Persona;Buyer Persona;SKU;Descripción para SEO\ncombo-papa-handyman-escalera-plegable-esc-005-caja-de-herramientas-ch-01-17nz9;Combo Papá Handyman -- Escalera Plegable + Caja de herramientas;Hogar > Herramientas y equipamiento, Hogar > Día del Padre , Comercio;Juan;;ESC-005 + CH-01;Escalera plegable + caja de herramientas completa. Todo para arreglar tu casa. Hasta 6 cuotas sin interés.\ncombo-papa-tecnologico-escritorio-electrico-regulable-negro-soporte-monitor-ss-1032m-1x89m;Combo Papá Tecnológico -- Escritorio Eléctrico Regulable + Soporte Monitor;Hogar > Escritorios ergonómicos, Hogar > Día del Padre ;Martin;;22D-BEL BLANCO (MODELO ELECTRICO) + SS-1032M;Escritorio Sit-Stand + soporte hidráulico para monitor. Ergonomía completa para home office. Hasta 6 cuotas sin interés.\ncombo-papa-tecnologico-escritorio-electrico-regulable-negro-soporte-monitor-ss-1032m-1x89m;;;Martin;;22D-BEL NEGRO (MODELO ELECTRICO) + SS-1032M;\ncombo-papa-asador-mesa-plegable-mp-001-reposera-rep-001-yzcro;Combo Papá Asador -- Mesa Plegable + Reposera;Hogar > Exterior y aire libre, Hogar > Día del Padre ;Lucho;;REP-001 + MP-001 NEGRA;Mesa plegable + reposera gravedad cero para camping, pesca y playa. Aluminio resistente, portátil y cómoda. Hasta 6 cuotas sin interés.\ncombo-papa-asador-mesa-plegable-mp-001-reposera-rep-001-yzcro;;;Lucho;;REP-001 + MP-001;\ntendedero-extensible-plegable-naku-amurado-soporta-18kg-65wyb;Tendedero Extensible Plegable de Pared - Soporta 35kg;Hogar > Organización de ropa, Hogar > Limpieza, Hogar > Organización, Novedades;Mariana;;TEN-004;ptimiza tu lavadero con el tendedero extensible NAKU TEN-004. Soporta hasta 35kg, incluye estación de perchas e instalación dual (con o sin tornillos).\ntendedero-extensible-plegable-naku-con-ventosa-soporta-18kg-sin-perforar-e1wq7;Tendedero Extensible Plegable NAKU con Ventosa (Soporta 18kg) - Sin Perforar;Hogar > Organización de ropa, Hogar > Limpieza, Hogar > Organización, Novedades;Mariana;;TEN-003;Descubre el tendedero plegable NAKU TEN-003. Instalación con ventosa en superficies lisas, sin perforar. Soporta 18kg y tiene 15 espacios para perchas.\ntendedero-giratorio-plegable-doble-tipo-pulpo-tncru;Tendedero Giratorio Plegable doble Tipo Pulpo;Hogar > Organización de ropa, Hogar > Exterior y aire libre, Hogar > Limpieza, Hogar > Máquinas de coser, Hogar > Organización;Mariana;;TEN-002;\ntendedero-giratorio-plegable-tipo-pulpo-e99lp;Tendedero Giratorio Plegable Tipo Pulpo;Hogar > Organización de ropa, Hogar > Exterior y aire libre, Hogar > Limpieza, Hogar > Máquinas de coser, Hogar > Organización;Mariana;;TEN-001;Tendedero giratorio plegable tipo pulpo: seca más ropa en menos espacio. Base triangular estable, ganchos antideslizantes y caños reforzados 0,5 mm.\nescalera-plegable-4-peldanos-antideslizante-1ks2l;Escalera Plegable 4 Peldaños Antideslizante;Hogar > Herramientas y equipamiento, Comercio, Novedades;Mario;Mariana;ESC-009;Escalera plegable NAKU de 4 peldaños con seguro de posición, peldaños y patas antideslizantes. Compacta, estable y soporta hasta 150 kg.\nescalera-plegable-3-peldanos-antideslizante-cf0gn;Escalera Plegable 3 Peldaños Antideslizante;Hogar > Herramientas y equipamiento, Comercio, Novedades;Mario;Mariana;ESC-008;Escalera plegable NAKU de 3 peldaños con seguro de posición, peldaños y patas antideslizantes. Compacta, estable y soporta hasta 150 kg.\nescalera-plegable-2-peldanos-antideslizante-1hwo4;Escalera Plegable 2 Peldaños Antideslizante;Hogar > Herramientas y equipamiento, Comercio, Novedades;Mario;Mariana;ESC-007;Escalera plegable NAKU de 2 peldaños con seguro de posición y patas antideslizantes. Peldaños amplios. Soporta hasta 150 kg. Compacta.\nescalera-plegable-y-compacta-de-aluminio-2x3-peldanos-1x51o;Escalera Plegable y Compacta de Aluminio 2x3 Peldaños;Hogar > Herramientas y equipamiento, Comercio, Novedades;Mario;Mariana;ESC-004;Escalera plegable 2x3 de aluminio NAKU ESC-004: ligera y resistente, soporta 150 kg, apoyos antideslizantes y manija. Se pliega en barra.\nescalera-plegable-y-compacta-de-aluminio-2x4-peldanos-u4nlo;Escalera Plegable y Compacta de Aluminio 2x4 Peldaños;Hogar > Herramientas y equipamiento, Comercio, Novedades;Mario;Mariana;ESC-005;Escalera plegable 2x4 de aluminio NAKU ESC-005: ligera y resistente, soporta 150 kg, apoyos antideslizantes y manija. Se pliega en barra.\nescalera-plegable-y-compacta-de-aluminio-2x5-peldanos-1c0rj;Escalera Plegable y Compacta de Aluminio 2x5 Peldaños;Hogar > Herramientas y equipamiento, Comercio, Novedades;Mario;Mariana;ESC-006;Escalera plegable de aluminio 2x5 peldaños, soporta hasta 150 kg. Compacta para guardar, con manija y apoyos antideslizantes. Ideal hogar y exterior.\nsoporte-de-techo-electrico-smart-para-tv-hasta-75-oys8l;\"Soporte de Techo Eléctrico Smart para TV hasta 75\"\"\";Soportes > TV > Techo;Juan;;ST-466;\"Soporte de techo eléctrico smart ST-466. Compatible VESA 200x200 a 600x400, TV hasta 75\"\", carga máx 55 kg. Ideal para ahorrar espacio.\"\nsoporte-de-tv-hidraulico-full-motion-sp-696-con-nivel-de-burbuja-wuko6;Soporte Premium Reforzado SP-696 De Pared Para Tv 32´´a 120´´extension 78cm 100kg;Soportes > TV > Móviles con Brazo;Juan;;SP-696;\"Soporte de TV full motion SP-696: hasta 120\"\", soporta 100 kg, compatible VESA hasta 900x600. Giro ±60°, inclinación +7°/-4° y nivelación ±3°.\"\nbrazo-hidraulico-de-monitor-a-pared-sp-11w-hasta-32-heive;\"Brazo Hidráulico de Monitor a Pared SP-11W (hasta 32\"\")\";Soportes > Monitor, Novedades;Juan;;SP-11W;Brazo de monitor a pared con contrabalanceo. Soporta hasta 32'' (VESA 75/100) y 2-10 kg. Ajustable e incluye gestión de cables. SP-11W.\nbase-con-ruedas-ajustable-para-heladera-y-lavarropas-5070-cm-200-kg-s-lh-oendq;Base con ruedas ajustable para heladera y lavarropas 50-70 cm (200 kg) - S-LH;Soportes, Hogar > Organizadores multiuso, Hogar > Herramientas y equipamiento, Hogar > Organización, Novedades;Mariana;Juan;S-LH;Base con ruedas regulable 50-70 cm para heladeras y lavarropas. Soporta hasta 200 kg, 4 ruedas, armado simple y ajuste a medida para tu espacio.\nsoporte-esquinero-articulado-she-446-pared-para-tv-de-22-a-75-wymxh;\"Soporte esquinero articulado SHE-446 Pared Para TV de 22\"\" a 75\"\"\";Soportes > TV > Móviles con Brazo;Juan;;SHE-446;Soporte de pared esquinero. 22-75´´, hasta 45 kg. Inclinación +6°/-12°, giro 120°, 6-47 cm de pared. VESA 200×200 a 600×400. Incluye kit y pasacables.\nsoporte-doble-hidraulico-pp-c024d-para-monitores-1332-r8gl6;\"Soporte doble hidráulico PP-C024D para monitores 13-32\"\"\";Soportes > Monitor;Juan;;PP-C024D;Brazo a gas para 2 monitores. 13-32´´, 2-10 kg c/u. VESA 75x75/100x100. Extensión 45,1 cm, inclinación ±45°, giro 180°. Abrazadera 1-5 cm. Incluye kit y pasacables.\nsoporte-hidraulico-pp-1032m-de-mesa-para-tv-monitor-13-a-32-0xx9u;Soporte Hidraulico PP-1032M De Mesa Para Tv/monitor 13 A 32;Soportes > Monitor;Juan;;PP-1032M;Brazo a gas, ajuste suave. VESA 75x75/100x100, 2-10 kg extensión 45,1 cm, inclinación ±45°. Montaje con abrazadera o tornillo pasante. Incluye kit y pasacables.\ncombo-x-2-reposera-con-reposapies-gazebo-con-pared-mesa-chica;Combo x 2 Reposera con Reposapiés + Gazebo con Pared + Mesa Chica;Hogar > Exterior y aire libre, Hogar > Día del Padre , Novedades;Lucho;Mariana;REP-003 x2 + MP-002 + GZB-002 A;Disfrutá el combo ideal: 2 reposeras ergonómicas, gazebo con protección solar y mesa práctica. Perfecto para tu jardín o playa. ¡Compralo ya!\ncombo-x-2-reposera-con-reposapies-gazebo-con-pared-mesa-chica;;;Lucho;Mariana;REP-003 x2 + MP-002 + GZB-002 R;\ncombo-x-2-reposera-aluminio-plegable-gazebo-con-pared-mesa-chica;Combo x 2 Reposera Aluminio Plegable + Gazebo con Pared + Mesa Chica;Hogar > Exterior y aire libre, Hogar > Día del Padre , Novedades;Lucho;Mariana;REP-002 x2 + MP-002 + GZB-002 A;Disfrutá al aire libre con 2 reposeras aluminio, mesa compacta y gazebo reforzado. Confort y diseño premium. ¡Compralo ahora y preparate para tu escapada!\ncombo-x-2-reposera-aluminio-plegable-gazebo-con-pared-mesa-chica;;;Lucho;Mariana;REP-002 x2 + MP-002 + GZB-002 R;\ncombo-x-2-reposera-gravedad-cero-gazebo-con-pared-mesa-chica;Combo x 2 Reposera Gravedad Cero + Gazebo con Pared + Mesa Chica;Hogar > Exterior y aire libre, Hogar > Día del Padre , Novedades;Lucho;Mariana;REP-01 x 2 + MP-02 + GZB-02 AZUL;Disfrutá del aire libre con 2 reposeras reclinables, gazebo resistente y mesa plegable. Comodidad y sombra en un combo práctico. ¡Compralo ya!\ncombo-x-2-reposera-gravedad-cero-gazebo-con-pared-mesa-chica;;;Lucho;Mariana;REP-01 x 2 + MP-02 + GZB-02 ROJO;\ncombo-x-2-reposera-con-reposapies-gazebo-plegable-mesa-chica;Combo x 2 Reposera con Reposapiés + Gazebo Plegable + Mesa Chica;Hogar > Exterior y aire libre, Hogar > Día del Padre , Novedades;Lucho;Mariana;REP-003 x2 + MP-002 + GZB-001 A;Combo con 2 reposeras ajustables, mesa portátil y gazebo UV. Ideal para descanso y sombra en exteriores. ¡Llevá confort y funcionalidad hoy!\ncombo-x-2-reposera-con-reposapies-gazebo-plegable-mesa-chica;;;Lucho;Mariana;REP-003 x2 + MP-002 + GZB-001 R;\ncombo-x-2-reposera-aluminio-plegable-gazebo-plegable-mesa-chica;Combo x 2 Reposera Aluminio Plegable + Gazebo Plegable + Mesa Chica;Hogar > Exterior y aire libre, Hogar > Día del Padre , Novedades;Lucho;Mariana;REP-002 x2 + MP-002 + GZB-001 A;Combo con 2 reposeras aluminio reclinables, mesa plegable y gazebo con protección solar. Ideal para disfrutar cómodo al aire libre. ¡Compralo ya!\ncombo-x-2-reposera-aluminio-plegable-gazebo-plegable-mesa-chica;;;Lucho;Mariana;REP-002 x2 + MP-002 + GZB-001 R;\ncombo-x-2-reposera-gravedad-cero-gazebo-plegable-mesa-chica;Combo x 2 Reposera Gravedad Cero + Gazebo Plegable + Mesa Chica;Hogar > Exterior y aire libre, Hogar > Día del Padre , Novedades;Lucho;Mariana;REP-001 x2 + MP-002 + GZB-001 A;Combo ideal para relax al aire libre: 2 reposeras plegables, gazebo con protección solar y mesa portátil. ¡Arma tu espacio en minutos!\ncombo-x-2-reposera-gravedad-cero-gazebo-plegable-mesa-chica;;;Lucho;Mariana;REP-001 x2 + MP-002 + GZB-001 R;\ncombo-x-2-reposera-con-reposapies-sombrilla-grande;Combo x 2 Reposera con Reposapiés + Sombrilla Grande;Hogar > Exterior y aire libre, Hogar > Día del Padre , Novedades;Lucho;Mariana;REP-003 x2 + SOM-2 A;Disfrutá el combo de 2 reposeras con apoyabrazos y sombrilla grande Naku, ideal para playa y jardín. Cómodo, resistente y fácil de armar. ¡Compralo ya!\ncombo-x-2-reposera-con-reposapies-sombrilla-grande;;;Lucho;Mariana;REP-003 x2 + SOM-2 R;\ncombo-x-2-reposera-aluminio-plegable-sombrilla-grande;Combo x 2 Reposera Aluminio Plegable + Sombrilla Grande;Hogar > Exterior y aire libre, Hogar > Día del Padre , Novedades;Lucho;Mariana;REP-002 x2 + SOM-2 A;Disfrutá con 2 reposeras de aluminio reforzado y 1 sombrilla amplia con filtro solar. Ideal para relax y resistencia al aire libre. ¡Compralo ya!\ncombo-x-2-reposera-aluminio-plegable-sombrilla-grande;;;Lucho;Mariana;REP-002 x2 + SOM-2 R;\ncombo-x-2-reposera-gravedad-cero-sombrilla-grande;Combo x 2 Reposera Gravedad Cero + Sombrilla Grande;Hogar > Exterior y aire libre, Hogar > Día del Padre , Novedades;Lucho;Mariana;REP-001 x2 + SOM-2 A;Disfrutá el verano con 2 reposeras plegables y una sombrilla grande regulable. Ideal para playa, parque o jardín. ¡Compralo y relajate al aire libre!\ncombo-x-2-reposera-gravedad-cero-sombrilla-grande;;;Lucho;Mariana;REP-001 x2 + SOM-2 R;\ncombo-x-2-reposera-con-reposapies-mesa-plegable-chica;Combo x 2 Reposera con Reposapiés + Mesa Plegable chica;Hogar > Exterior y aire libre, Hogar > Día del Padre , Novedades;Lucho;Mariana;REP-003 x2 + MP-002;Disfrutá el combo con 2 reposeras anatómicas y mesa plegable. Confort y funcionalidad garantizados. ¡Compralo ahora y renová tu espacio exterior!\ncombo-x-2-reposera-aluminio-plegable-mesa-plegable-chica;Combo x 2 Reposera Aluminio Plegable + Mesa Plegable Chica;Hogar > Exterior y aire libre, Hogar > Día del Padre , Novedades;Lucho;Mariana;REP-002 x2 + MP-002;Combo 2 reposeras aluminio reforzadas y mesa plegable liviana. Ideal para exteriores, fácil de guardar y resistente. Aprovechá esta oferta única hoy.\ncombo-x-2-reposera-gravedad-cero-mesa-plegable-chica;Combo x 2 Reposera Gravedad Cero + Mesa Plegable Chica;Hogar > Exterior y aire libre, Hogar > Día del Padre , Novedades;Lucho;Mariana;REP-001 x2 + MP-002;Disfrutá el combo con 2 reposeras gravedad cero y mesa plegable resistente, ideal para camping y jardín. ¡Compralo y relajate donde quieras!\ncombo-x-2-reposera-reclinable-con-reposapies-plegable-negra-naku-rep-003;Combo x 2 Reposera Reclinable con Reposapiés Plegable Negra Naku REP-003;Hogar > Exterior y aire libre, Hogar > Día del Padre , Novedades;Lucho;Mariana;REP-003 x2;Disfrutá el confort de las reposeras Naku REP-003, reclinables y plegables con reposapiés. Perfectas para relax en playa o camping. ¡Comprá ya!\ncombo-x-2-reposera-aluminio-plegable-5-posiciones-negra-naku-rep-002;Combo x 2 Reposera Aluminio Plegable 5 Posiciones Negra Naku REP-002;Hogar > Exterior y aire libre, Hogar > Día del Padre , Novedades;Lucho;Mariana;REP-002 x 2 UNITS;Combo x2 reposeras Naku REP-002 con estructura reforzada y diseño ergonómico. Plegables y livianas, ideales para playa y camping. ¡Compra ya y disfruta!\ncombo-x-2-reposera-gravedad-cero-plegable-naku-rep-001;Combo x 2 Reposera Gravedad Cero Plegable Naku REP-001;Hogar > Exterior y aire libre, Hogar > Día del Padre , Novedades;Lucho;Mariana;REP-001 x 2 UNITS;\nestanteria-plegable-5-niveles-con-ruedas-naku-org008;Estantería Plegable 5 niveles con Ruedas;Hogar > Organizadores multiuso, Hogar > Organización, Novedades;Mariana;;ORG-008;Estantería metálica plegable de 5 niveles con ruedas. Abre en segundos, sin herramientas. Ideal para cocina, taller y comercio. Estructura resistente y fácil de guardar.\nestanteria-plegable-5-niveles-con-ruedas-naku-org008;;;Mariana;;ORG-008-BLANCO;\nestanteria-plegable-4-niveles-con-ruedas-naku-org007;Estantería Plegable 4 niveles con Ruedas Naku ORG-007;Hogar > Organizadores multiuso, Hogar > Organización, Novedades;Mariana;;ORG-007;Estantería plegable Naku ORG-007 con 4 niveles, ruedas con freno y estructura de acero. Más capacidad sin ocupar espacio. Se arma en segundos.\nestanteria-plegable-4-niveles-con-ruedas-naku-org007;;;Mariana;;ORG-007-BLANCO;\nestanteria-plegable-3-niveles-con-ruedas-naku-org006;Estantería Plegable 3 niveles con Ruedas Naku ORG-006;Hogar > Organizadores multiuso, Hogar > Organización, Novedades;Mariana;;ORG-006;Organizador plegable Naku ORG-006 con ruedas y 3 niveles. Acero resistente, diseño compacto, sin instalación. Ideal para cocina, oficina o lavadero.\nestanteria-plegable-3-niveles-con-ruedas-naku-org006;;;Mariana;;ORG-006-BLANCO;\nplacard-portatil-armario-modular-negro-130170cm-naku-pla001;Placard Portátil Armario Modular Negro 130×170 cm Naku PLA-001;Hogar > Organización de ropa, Hogar > Organización, Novedades;Mariana;;PLA-001;Organizá con estilo y practicidad. Placard portátil PLA-001 de acero modulado y tela impermeable. Armalo sin herramientas. Ideal para ropa y accesorios.\norganizador-de-botas-y-zapatos-naku-9-niveles-27-pares-botinero-puerta-con-cierre-gris;Organizador De Botas Y Zapatos Naku 9 Niveles 27 Pares Botinero Puerta Con Cierre Gris;Hogar > Organización de ropa, Hogar > Organización, Novedades;Mariana;;ZAP-001;Zapatero Naku de 8 niveles con cierre enrollable, tela impermeable y estructura firme. Capacidad para 24 pares. Ideal para mantener el orden en tu hogar.\norganizador-de-botas-y-zapatos-naku-9-niveles-27-pares-botinero-puerta-con-cierre-negro;Organizador De Botas Y Zapatos Naku 9 Niveles 27 Pares Botinero Puerta Con Cierre Negro;Hogar > Organización de ropa, Hogar > Organización, Novedades;Mariana;;ZAP-002;Zapatero Naku de 8 niveles con cierre enrollable, tela impermeable y estructura firme. Capacidad para 24 pares. Ideal para mantener el orden en tu hogar.\norganizador-zapatero-giratorio-naku-zap-003-melamina-blanco;Organizador Zapatero Giratorio Naku ZAP-003 Melamina Blanco;Hogar > Organización de ropa, Hogar > Organización, Novedades;Mariana;;ZAP-003;Zapatero giratorio de melamina con 6 niveles y hasta 24 espacios. Diseño moderno, compacto y funcional. Ideal para zapatos, carteras y maquillaje.\norganizador-zapatera-perchero-metal-negro-naku-per-006;Organizador Zapatera Perchero Metal Negro Naku PER-006;Hogar > Organización de ropa, Hogar > Organización, Novedades;Mariana;;PER-006;Organizador perchero y zapatera Naku con estructura metálica y diseño funcional. Soporta hasta 12 pares de calzado y permite colgar prendas. Ideal para hogares con poco espacio.\ncaja-fuerte-electronica-llave-pared-naku-cf-001;Caja Fuerte Electrónica/Llave Pared Naku CF-001;Hogar > Herramientas y equipamiento, Hogar > Seguridad y vigilancia, Comercio, Novedades;Mario;;CF-001B;\ncaja-fuerte-electronica-llave-pared-naku-cf-001;;;Mario;;CF-001N;\ncaja-fuerte-electronica-llave-pared-naku-cf-002;Caja Fuerte Electrónica/Llave Pared Naku CF-002;Hogar > Herramientas y equipamiento, Hogar > Seguridad y vigilancia, Comercio, Novedades;Mario;;CF-002B;Caja fuerte Naku CF-002 con combinación digital y llave de emergencia. 12 L de capacidad, pernos de acero, anclajes incluidos. Ideal para hogar u oficina.\ncaja-fuerte-electronica-llave-pared-naku-cf-002;;;Mario;;CF-002N;\nreposera-reclinable-con-reposapies-plegable-negra-naku-rep-003;Reposera Reclinable con Reposapiés Plegable Negra Naku REP-003;Hogar > Exterior y aire libre, Novedades;Lucho;Mariana;REP-003;Reposera plegable con 5 posiciones y reposapiés abatible. Aluminio liviano y tela resistente. Ideal para relajarte en playa, camping o jardín.\nreposera-aluminio-plegable-5-posiciones-negra-naku-rep-002;Reposera Aluminio Plegable 5 Posiciones Negra Naku REP-002;Hogar > Exterior y aire libre, Novedades;Lucho;Mariana;REP-002;Reposera Naku de aluminio con 5 posiciones y tela resistente a la intemperie. Liviana, plegable y fácil de transportar. Ideal para playa, camping o jardín.\nreposera-gravedad-cero-plegable-naku-rep-001;Reposera Gravedad Cero Plegable REP-001;Hogar > Exterior y aire libre, Novedades;Lucho;Mariana;REP-001;Reposera gravedad cero REP-001 reclinable 0-160°. Apoyacabezas desmontable. Tela textilene resistente UV. Plegable para playa, camping, parque. Envío gratis.\npistola-de-riego-regador-8-funciones-adaptador-doble-gatillo-naku-pr-001;Pistola De Riego Regador 8 Funciones Adaptador Doble Gatillo Naku PR-001;Hogar > Exterior y aire libre, Hogar > Limpieza, Hogar > Herramientas y equipamiento, Novedades;Lucho;Mariana;PR-001;Pistola de riego Naku PR-001 con 8 modos de rociado, doble gatillo, presión regulable y acople rápido. Ideal para jardín, limpieza o autos. Diseño ergonómico y resistente.\nzapatillero-estanteria-metalica-3-niveles-naku-zap-004;Zapatillero Estantería Metálica 3 Niveles Naku ZAP-004;Hogar > Organización de ropa, Hogar > Organización, Novedades;Mariana;;ZAP-004;Zapatillero metálico Naku ZAP-004 con 3 niveles. Ideal para organizar tus zapatos con estilo y resistencia. Compacto, duradero y fácil de armar.\nperchero-metalico-con-zapatero-y-doble-barra-naku-per-005;Perchero Metálico con Zapatero y Doble Barra Naku PER-005;Hogar > Organización de ropa, Hogar > Organización, Novedades;Mariana;;PER-005;Organizá tu ropa con el perchero metálico Naku PER-005. Doble barra para colgar y base zapatero. Práctico, resistente y fácil de armar.\ncesto-ropa-sucia-doble-plegable-naku-crs-002;Cesto Ropa Sucia Doble Plegable Naku CRS-002;Hogar > Organización de ropa, Hogar > Organización, Novedades;Mariana;;CRS-002;Cesto de ropa Naku CRS-002 con doble compartimento, marco de aluminio y diseño plegable. Ideal para clasificar ropa clara y oscura. Liviano, práctico y duradero.\ncesto-plegable-tela-impermeable-ropa-sucia-naku-crs-001;Cesto Ropa Sucia Plegable Naku CRS-001;Hogar > Organización de ropa, Hogar > Organización, Novedades;Mariana;;CRS-001;Cesto Naku CRS-001 plegable con tela impermeable y estructura de aluminio. Ideal para ropa sucia. Liviano, duradero y fácil de guardar.\norganizador-plastico-multiuso-3-estantes-kf4ez;Organizador Plástico Multiuso 3 Estantes;Hogar > Organizadores multiuso, Hogar > Organización, Novedades;Mariana;;ORG-001;Carro organizador Naku ORG-001 con 3 estantes plásticos. Ideal para cocina, baño o escritorio. Compacto, liviano y funcional.\norganizador-estanteria-metalica-multiuso-4-niveles-9cegk;Organizador Estantería Metálica Multiuso 4 Niveles;Hogar > Organizadores multiuso, Hogar > Organización, Novedades;Mariana;;ORG-002;Estantería metálica Naku OR-002 con 4 estantes regulables. Ideal para cocina, baño o escritorio. Compacta, moderna y resistente.\ncarrito-organizador-auxiliar-plegable-con-ruedas-dpphk;Carrito Organizador Auxiliar Plegable con Ruedas;Hogar > Organizadores multiuso, Hogar > Organización, Novedades;Mariana;;ORG-003;Organizá tu casa u oficina con el carro plegable Naku ORG-003. Ultra liviano, resistente y fácil de mover. ¡Conseguilo online!\ncarrito-organizador-auxiliar-plegable-con-ruedas-dpphk;;;Mariana;;ORG-003-BLANCO;\ncarrito-organizador-auxiliar-plegable-con-ruedas-dpphk;;;Mariana;;ORG-003-ROSA;\nset-de-perchas-de-madera-laqueada-con-broche-naku-per-003;Set de Perchas de Madera Laqueada con Broche Naku PER-003;Hogar > Organización de ropa, Hogar > Organización, Novedades;Mariana;;PER-003x10;\"Pack de perchas Naku de madera laqueada con broches metálicos. Elegancia, resistencia y diseño funcional para organizar tu ropa con estilo.\n\"\nset-de-perchas-de-madera-laqueada-con-broche-naku-per-003;;;Mariana;;PER-003x100;\nset-de-perchas-de-madera-laqueada-con-broche-naku-per-003;;;Mariana;;PER-003x20;\nset-de-perchas-de-madera-laqueada-con-broche-naku-per-003;;;Mariana;;PER-003x50;\nperchas-de-terciopelo-naku-per-002;Perchas de Terciopelo NAKU PER-002;Hogar > Organización de ropa, Hogar > Organización, Novedades;Mariana;;PER-002 x 10 UNITS;Set de perchas NAKU de terciopelo antideslizante. Diseño fino que ahorra espacio. Con muescas para vestidos. Ideal para ropa delicada y pesada.\nperchas-de-terciopelo-naku-per-002;;;Mariana;;PER-002 x 100 UNITS;\nperchas-de-terciopelo-naku-per-002;;;Mariana;;PER-002 x 20 UNITS;\nperchas-de-terciopelo-naku-per-002;;;Mariana;;PER-002 x 50 UNITS;\nperchero-comercial-reforzado-naku-per-004;Perchero Comercial Reforzado NAKU PER-004;Hogar > Organización de ropa, Hogar > Organización, Novedades;Mariana;;PER-004;Perchero NAKU de hierro reforzado, desmontable y fácil de armar. Ideal para comercios o uso doméstico. Soporta hasta 25 kg. Diseño moderno e industrial.\ncarrito-organizador-auxiliar-con-ruedas-z1jru;Carrito Organizador Auxiliar con Ruedas;Hogar > Organizadores multiuso, Hogar > Organización, Novedades;Mariana;;ORG-004;Carrito organizador NAKU con 3 estantes fijos, ruedas con freno y estructura metálica. Ideal para cocina, baño o juguetes. Se entrega desarmado.\ncarrito-organizador-auxiliar-con-ruedas-z1jru;;;Mariana;;ORG-004-BLANCO;\ncarrito-organizador-auxiliar-con-ruedas-z1jru;;;Mariana;;ORG-004-ROSA;\nperchas-naku-per-001-de-madera-lustrada-pack;Perchas Naku PER-001 de Madera Lustrada Pack;Hogar > Organización de ropa, Hogar > Organización, Novedades;Mariana;;PER-001 x 10 UNITS;\"Pack de perchas Naku de madera lustrada con gancho giratorio y muescas para breteles. Resistentes y perfectas para todo tipo de prendas.\n\n\"\nperchas-naku-per-001-de-madera-lustrada-pack;;;Mariana;;PER-001 x 100 UNITS;\nperchas-naku-per-001-de-madera-lustrada-pack;;;Mariana;;PER-001 x 20 UNITS;\nperchas-naku-per-001-de-madera-lustrada-pack;;;Mariana;;PER-001 x 50 UNITS;\ngazebo-naku-gzb-02-plegable-3x3m-con-paredes-y-proteccion-uv;Gazebo Naku GZB-02 Plegable 3x3M con Paredes y Protección UV;Hogar > Exterior y aire libre, Novedades;Lucho;Mariana;GZB-002A;\ngazebo-naku-gzb-02-plegable-3x3m-con-paredes-y-proteccion-uv;;;Lucho;Mariana;GZB-002R;\ngazebo-naku-gzb-01-plegable-autoarmable-3x3m-con-proteccion-uv;Gazebo Naku GZB-01 Plegable Autoarmable 3x3M con Protección UV;Hogar > Exterior y aire libre, Novedades;Lucho;Mariana;GZB-001A;Gazebo Naku GZB-01 de 3x3M autoarmable y reforzado, con tela impermeable Oxford 1080D. Incluye bolso, estacas y protección UV.\ngazebo-naku-gzb-01-plegable-autoarmable-3x3m-con-proteccion-uv;;;Lucho;Mariana;GZB-001R;\nsombrilla-mediana-naku-som-01-playera-reclinable-con-proteccion-uv;Sombrilla Mediana Naku SOM-01 Playera Reclinable con Protección UV;Hogar > Exterior y aire libre, Novedades;Lucho;Mariana;SOM-1A;\nsombrilla-mediana-naku-som-01-playera-reclinable-con-proteccion-uv;;;Lucho;Mariana;SOM-1R;\nsombrilla-grande-naku-som-02-playera-reclinable-con-proteccion-uv;Sombrilla Grande Naku SOM-02 Playera Reclinable con Protección UV;Hogar > Exterior y aire libre, Novedades;Lucho;Mariana;SOM-2A;Sombrilla Grande Naku SOM-02 con protección UV 50+, reclinable y con bolso de transporte. Ideal para playa, jardín o picnic. Disponible en rojo y azul.\nsombrilla-grande-naku-som-02-playera-reclinable-con-proteccion-uv;;;Lucho;Mariana;SOM-2R;\ncama-elastica-naku-ce-03-con-red-de-seguridad-3-66m-de-diametro;Cama Elástica Naku CE-03 con Red de Seguridad 3.66m de Diámetro;Hogar > Exterior y aire libre, Comercio, Novedades;Mariana;Lucho;CE-3;Cama elástica Naku CE-03 de 3.66 m con red incluida. Ideal para exteriores, soporta 150 kg, resistente al clima y con protección UV.\ncama-elastica-naku-ce-02-con-red-de-seguridad-3-05m-de-diametro;Cama Elástica Naku CE-02 con Red de Seguridad 3.05m de Diámetro;Hogar > Exterior y aire libre, Comercio, Novedades;Mariana;Lucho;CE-2;Cama elástica Naku CE-02 de 3.05 m con red incluida. Ideal para exteriores, soporta 150 kg, estructura galvanizada y protección UV.\ncama-elastica-naku-ce-01-con-red-de-seguridad-1-8m-de-diametro;Cama Elástica Naku CE-01 con Red de Seguridad 1.8m de Diámetro;Hogar > Exterior y aire libre, Novedades;Mariana;Lucho;CE-1;Cama elástica Naku CE-01 con red de seguridad, estructura de acero y lona resistente UV. Soporta 120 kg. Ideal para niños y adultos. Medida 1.8 m.\ncontadora-y-clasificadora-de-billetes-naku-cdb-004-con-deteccion-uv-mg-ir;Contadora y Clasificadora de Billetes Naku CDB-004 con Detección UV/MG/IR;Comercio;Mario;;CDB-004;Contadora clasificadora Naku CDB-004 con detección UV/MG/IR. Alta precisión, 1200 billetes/min, portátil y segura para comercios y oficinas.\ncontadora-de-billetes-profesional-naku-cdb-003-con-deteccion-uv-mg-y-display-externo;Contadora de Billetes Profesional Naku CDB-003 con Detección UV/MG y Display Externo;Comercio;Mario;;CDB-003;Contadora Naku CDB-003 profesional con detección UV/MG. Cuenta hasta 1000 billetes por minuto, incluye display externo y es ideal para bancos o comercios.\ncontadora-de-billetes-portatil-naku-cdb-002-con-doble-alimentacion-ijuzo;Contadora de Billetes Portátil Naku CDB-002 con Doble Alimentación;Comercio;Mario;;CDB-002;Máquina contadora de billetes portátil Naku CDB-002. Clasifica billetes, cuenta hasta 600 por minuto y funciona con batería o corriente.\ncontadora-de-billetes-naku-cdb-001-con-detector-uv-y-mg;Contadora de Billetes Naku CDB-001 con Detector UV y MG;Comercio;Mario;;CDB-001;Máquina contadora de billetes Naku CDB001 con detección UV y magnética, velocidad de 1000 billetes por minuto y display móvil.\nrack-mtv-001-de-mesa-para-tv-de-32-a-75-con-base-de-vidrio-5qw2y;\"Rack MTV-001 de Mesa Para TV de 32\"\" a 75\"\" con Base de Vidrio\";Soportes > TV > Rack y Stand TV;Juan;Lucho;MTV-001;\"Soporte de mesa para TV Naku MTV-001 con base de vidrio, inclinación y rotación. Compatible con pantallas de 32\"\" a 75\"\". Firme, seguro y fácil de instalar.\"\nkit-x-4-camara-de-seguridad-wifi-ip-naku-cv-001-full-hd-4mp-motorizada-con-vision-nocturna;Kit x 4 Cámara de Seguridad WiFi IP Naku CV-001 Full HD 4MP Motorizada con Visión Nocturna;Hogar > Seguridad y vigilancia;Juan;Lucho;CV-001 x 4 UNITS;\nkit-x-3-camara-de-seguridad-wifi-ip-naku-cv-001-full-hd-4mp-motorizada-con-vision-nocturna;Kit x 3 Cámara de Seguridad WiFi IP Naku CV-001 Full HD 4MP Motorizada con Visión Nocturna;Hogar > Seguridad y vigilancia;Juan;Lucho;CV-001 x 3 UNITS;\nkit-x-2-camara-de-seguridad-wifi-ip-naku-cv-001-full-hd-4mp-motorizada-con-vision-nocturna;Kit x 2 Cámara de Seguridad WiFi IP Naku CV-001 Full HD 4MP Motorizada con Visión Nocturna;Hogar > Seguridad y vigilancia;Juan;Lucho;CV-001 x 2 UNITS;\nkit-x-4-camara-de-seguridad-doble-lente-wifi-ip-naku-cv-002-full-hd-motorizada-3mp;Kit x 4 Cámara de Seguridad Doble Lente WiFi IP Naku CV-002 Full HD Motorizada 3MP;Hogar > Seguridad y vigilancia;Juan;Lucho;CV-002 x 4 UNITS;\nkit-x-3-camara-de-seguridad-doble-lente-wifi-ip-naku-cv-002-full-hd-motorizada-3mp;Kit x 3 Cámara de Seguridad Doble Lente WiFi IP Naku CV-002 Full HD Motorizada 3MP;Hogar > Seguridad y vigilancia;Juan;Lucho;CV-002 x 3 UNITS;\nkit-x-2-camara-de-seguridad-doble-lente-wifi-ip-naku-cv-002-full-hd-motorizada-3mp;Kit x 2 Cámara de Seguridad Doble Lente WiFi IP Naku CV-002 Full HD Motorizada 3MP;Hogar > Seguridad y vigilancia;Juan;Lucho;CV-002 x 2 UNITS;\nkit-x-4-camaras-baby-call-doble-lente-wifi-ip-naku-cv-003-full-hd-motorizada-2mp;Kit x 4 Cámaras Baby Call Doble Lente WiFi IP Naku CV-003 Full HD Motorizada 2MP;Hogar > Seguridad y vigilancia;Juan;Lucho;CV-003 x 4 UNITS;\nkit-x-3-camaras-baby-call-doble-lente-wifi-ip-naku-cv-003-full-hd-motorizada-2mp;Kit x 3 Cámaras Baby Call Doble Lente WiFi IP Naku CV-003 Full HD Motorizada 2MP;Hogar > Seguridad y vigilancia;Juan;Lucho;CV-003 x 3 UNITS;\nkit-x-2-camaras-baby-call-doble-lente-wifi-ip-naku-cv-003-full-hd-motorizada-2mp;Kit x 2 Cámaras Baby Call Doble Lente WiFi IP Naku CV-003 Full HD Motorizada 2MP;Hogar > Seguridad y vigilancia;Juan;Lucho;CV-003 x 2 UNITS;\nkit-x-4-camaras-baby-call-wifi-ip-naku-cv-004-full-hd-motorizada-con-vision-nocturna;Kit x 4 Cámaras Baby Call WiFi IP Naku CV-004 Full HD Motorizada con Visión Nocturna;Hogar > Seguridad y vigilancia;Juan;Lucho;CV-004 x 4 UNITS;\nkit-x-3-camaras-baby-call-wifi-ip-naku-cv-004-full-hd-motorizada-con-vision-nocturna;Kit x 3 Cámaras Baby Call WiFi IP Naku CV-004 Full HD Motorizada con Visión Nocturna;Hogar > Seguridad y vigilancia;Juan;Lucho;CV-004 x 3 UNITS;\nkit-x-2-camaras-baby-call-wifi-ip-naku-cv-004-full-hd-motorizada-con-vision-nocturna;Kit x 2 Cámaras Baby Call WiFi IP Naku CV-004 Full HD Motorizada con Visión Nocturna;Hogar > Seguridad y vigilancia;Juan;Lucho;CV-004 x 2 UNITS;\nkit-x-4-camaras-baby-call-wifi-ip-naku-cv-005-full-hd-motorizada-con-vision-nocturna;Kit x 4 Cámaras Baby Call WiFi IP Naku CV-005 Full HD Motorizada con Visión Nocturna;Hogar > Seguridad y vigilancia;Juan;Lucho;CV-005 x 4 UNITS;\nkit-x-3-camaras-baby-call-wifi-ip-naku-cv-005-full-hd-motorizada-con-vision-nocturna;Kit x 3 Cámaras Baby Call WiFi IP Naku CV-005 Full HD Motorizada con Visión Nocturna;Hogar > Seguridad y vigilancia;Juan;Lucho;CV-005 x 3 UNITS;\nkit-x-2-camaras-baby-call-wifi-ip-naku-cv-005-full-hd-motorizada-con-vision-nocturna;Kit x 2 Cámaras Baby Call WiFi IP Naku CV-005 Full HD Motorizada con Visión Nocturna;Hogar > Seguridad y vigilancia;Juan;Lucho;CV-005 x 2 UNITS;\nmopa-plana-naku-earth-4s-con-balde-escurridor-y-2-panos-color-crema;Mopa Plana EARTH-4 Balde Escurridor Color Crema;Hogar > Limpieza, Comercio;Mariana;Mario;EARTH4S;Mopa plana EARTH-4 con balde escurridor integrado y cabezal 360°. Microfibra reutilizable. Mango ajustable hasta 130cm. Limpieza sin esfuerzo. 2 paños incluidos.\nmopa-lampazo-naku-earth-2s-con-balde-centrifugador-rojo;Mopa Lampazo Naku EARTH-2S con Balde Centrifugador Rojo;Hogar > Limpieza, Comercio;Mariana;Mario;EARTH2S;Mopa Naku EARTH-2S con balde centrífugo, dispenser de jabón y paños de microfibra. Ideal para todo tipo de pisos. ¡Limpieza sin esfuerzo!\nescritorio-regulable-manual-135x60-cm-sit-stand-con-manivela-madera-sq512;Escritorio Regulable Manual 135x60 cm - Sit-Stand con Manivela Madera;Hogar > Escritorios ergonómicos;Martin;Mariana;22D-B MADERA;\nescritorio-regulable-manual-135x60-cm-sit-stand-con-manivela-negro-yo49u;Escritorio Regulable Manual 135x60 cm - Sit-Stand con Manivela Negro;Hogar > Escritorios ergonómicos;Martin;Mariana;22D-B COLOR NEGRO;\nescritorio-electrico-regulable-135x60-cm-sit-stand-automatico-madera-x6s0n;Escritorio Eléctrico Sit-Stand 135x60 Madera;Hogar > Escritorios ergonómicos;Martin;Mariana;22D-BEL MADERA (MODELO ELECTRICO);Escritorio eléctrico regulable 135x60cm. Altura ajustable 73-120cm con motor. 2 memorias preestablecidas. Soporta 70kg. Escritorio sit-stand para home office.\nescritorio-electrico-regulable-135x60-cm-sit-stand-automatico-negro-trdei;Escritorio Eléctrico Sit-Stand 135x60 Negro;Hogar > Escritorios ergonómicos;Martin;Mariana;22D-BEL NEGRO (MODELO ELECTRICO);Escritorio eléctrico regulable 135x60cm. Altura ajustable 73-120cm con motor. 2 memorias preestablecidas. Soporta 70kg. Escritorio sit-stand para home office.\nrack-pedestal-naku-tvr-004-con-ruedas-y-estantes-para-tv-de-32-a-75;\"Rack Pedestal Naku TVR-004 con Ruedas y Estantes Para TV de 32\"\" a 75\"\"\";Soportes > TV > Rack y Stand TV;Juan;Mariana;TVR-004;\"Mové tu TV con estilo y seguridad con el rack pedestal Naku TVR-004. Ruedas, estantes y estructura robusta para pantallas de 32\"\" a 75\"\".\"\nsoporte-naku-rack-para-tv-de-32-a-55-con-ruedas-y-estante;\"Soporte Rack Naku TVR-001 Para TV de 32\"\" a 55\"\" con Ruedas y Estante\";Soportes > TV > Rack y Stand TV;Juan;Mariana;TVR-001;Mové tu TV fácilmente con el soporte rack Naku SK-03. Con ruedas, estante y rotación de 360°. Ideal para oficinas, aulas y espacios versátiles.\nsoporte-hidraulico-naku-ss-c024d-de-mesa-para-tv-monitor-de-13-a-32;\"Soporte Doble Monitor Hidráulico SS-C024D 13-32\"\"\";Soportes > Monitor;Martin;Juan;SS-C024D;\"Soporte doble monitor hidráulico SS-C024D. 2 brazos independientes 13-32\"\". Rotación 180°, inclinación +90/-45°. VESA 50/75/100. Home office y gaming.\"\nsoporte-hidraulico-naku-ss-1032m-de-mesa-para-tv-monitor-de-13-a-32;\"Soporte Hidráulico Monitor 13-32\"\" VESA 75x100\";Soportes > Monitor;Martin;Juan;SS-1032M;\"Soporte hidráulico para TV/monitor 13-32\"\" con brazo ajustable 50cm y movimiento 360°. Soporta hasta 9kg. Instalación sin herramientas. VESA 75x100.\"\nsoporte-articulado-naku-sm-c048-de-mesa-para-cuatro-monitores-de-13-a-32;\"Soporte Articulado Naku SM-C048 de Mesa Para Cuatro Monitores de 13\"\" a 32\"\"\";Soportes > Monitor;Martin;Juan;SM-C048;\"Soporte Naku SM-C048 de mesa para 4 monitores de 13\"\" a 32\"\". Inclinación, rotación y brazo articulado para máximo control visual.\"\nsoporte-articulado-naku-sm-c034-de-mesa-para-tres-monitores-de-13-a-32;\"Soporte Articulado Naku SM-C034 de Mesa Para Tres Monitores de 13\"\" a 32\"\"\";Soportes > Monitor;Martin;Juan;SM-C034;\"Soporte de mesa Naku SM-C034 para 3 monitores de 13\"\" a 32\"\". Máxima articulación, inclinación y giro para un setup profesional.\"\nsoporte-articulado-naku-sm-c024-de-mesa-para-monitores-de-13-a-32;\"Soporte Articulado Naku SM-C024 de Mesa Para Monitores de 13\"\" a 32\"\"\";Soportes > Monitor;Martin;Juan;SM-C024;\"Soporte de mesa articulado Naku SM-C024 para 2 monitores de 13\"\" a 32\"\". Inclinación, rotación y altura ajustable para mayor confort.\"\nsoporte-articulado-naku-sm-c011nbh-de-mesa-para-notebook-y-tv-de-13-a-32;\"Soporte Articulado Naku SM-C011NBH de Mesa Para Notebook y Monitor de 13\"\" a 32\"\"\";Soportes > Monitor;Martin;Juan;SM-C011NBH;\"Optimizá tu escritorio con el soporte Naku SM-C011NBH para notebook y monitor de 13\"\" a 32\"\". Robusto, articulado y fácil de instalar.\"\nsoporte-brazo-articulado-naku-sm-c012-de-mesa-para-monitor-de-13-a-32;\"Soporte Brazo Articulado Naku SM-C012 de Mesa Para Monitor de 13\"\" a 32\"\"\";Soportes > Monitor;Martin;Juan;SM-C012;Mové tu monitor como quieras con el soporte Naku SM-C012. Brazo articulado, inclinación y rotación para máxima comodidad en escritorios.\nsoporte-de-escritorio-naku-sm-c010-para-monitor-de-13-a-32;\"Soporte de Escritorio Naku SM-C010 Para Monitor de 13\"\" a 32\"\"\";Soportes > Monitor;Martin;Juan;SM-C010;\"Organiza tu escritorio con el soporte articulado Naku SM-C010 para monitor de 13\"\" a 32\"\". Estilo compacto, base firme y máxima ergonomía.\"\nsoporte-de-escritorio-naku-sm-c09-para-monitor-de-13-a-32;\"Soporte de Escritorio Naku SM-C09 Para Monitor de 13\"\" a 32\"\"\";Soportes > Monitor;Martin;Juan;SM-C09;\"Optimizá tu escritorio con el soporte Naku SM-C09 para monitor de 13\"\" a 32\"\". Inclinación, giro y diseño compacto para máxima ergonomía.\"\nsoporte-de-escritorio-naku-sm-t02-para-monitor-de-13-a-32;\"Soporte de Escritorio Naku SM-T02 Para Monitor de 13\"\" a 32\"\"\";Soportes > Monitor;Martin;Juan;SM-T02;\"Armá tu estación de trabajo dual con el soporte Naku SM-T02 para dos monitores de 13\"\" a 32\"\". Inclinación, giro y base estable de escritorio.\"\nsoporte-de-escritorio-naku-sm-t01-para-monitor-de-13-a-32;\"Soporte de Escritorio Naku SM-T01 Para Monitor de 13\"\" a 32\"\"\";Soportes > Monitor;Juan;Mariana;SM-T01;\"Ganá comodidad con el soporte Naku SM-T01 para monitor de 13\"\" a 32\"\". Base de escritorio, inclinación 45°, giro 360° y montaje VESA.\"\nsoporte-de-techo-naku-plb-ce344-para-tv-de-32-a-75;\"Soporte de Techo Naku PLB-CE344 Para TV de 32\"\" a 75\"\"\";Soportes > TV > Techo;Juan;Mariana;PLB-CE344;\"Elevá tu TV de 32\"\" a 75\"\" con el soporte de techo Naku PLB-CE344. Altura regulable, inclinación y giro para una visual perfecta en cualquier ambiente.\"\nsoporte-de-techo-naku-s-504a-para-tv-de-15-a-48;\"Soporte de Techo Naku S-504A Para TV de 15\"\" a 48\"\"\";Soportes > TV > Techo;Juan;Mariana;S-504A;\"Instalá tu TV de 15\"\" a 48\"\" en el techo con el soporte Naku S-504. Inclinación de 45°, rotación 360° y altura regulable. Ideal para comercios y hogares.\"\nsoporte-de-techo-naku-s-cm244-rebatible-para-tv-de-17-a-60;\"Soporte de Techo Naku S-CM244 Rebatible Para TV de 17\"\" a 60\"\"\";Soportes > TV > Techo;Juan;Mariana;S-CM244;\"Soporte rebatible de techo Naku S-CM244 para TV de 17\"\" a 60\"\". Movilidad, seguridad y ahorro de espacio. Incluye kit de instalación completo.\"\nsoporte-de-techo-naku-s-cm222-rebatible-para-tv-de-17-a-48;\"Soporte de Techo Naku S-CM222 Rebatible Para TV de 17\"\" a 48\"\"\";Soportes > TV > Techo;Martin;Mariana;S-CM222;\"Soporte rebatible Naku S-CM222 de techo para TV de 17\"\" a 48\"\". Ahorra espacio, gira 45° y se pliega fácilmente. Incluye instalación y accesorios.\"\nsoporte-de-pared-naku-sb-51-para-parlantes-pack-x2;Soporte de Pared Naku SB-51 Para Parlantes Pack x2;Soportes > Microfonos\\, Parlantes y Proyectores;Martin;Mariana;SB-51;Soporte Naku SB-51 de pared para parlantes. Pack por 2 unidades, metálico, resistente y ajustable. Ideal para estudios y equipos de audio.\nsoporte-articulado-para-microfono-naku-s-m1-negro;Soporte Articulado Naku S-M1 de Mesa Para Micrófono;Soportes > Microfonos\\, Parlantes y Proyectores;Martin;Mariana;S-M1;Grabá con comodidad con el soporte articulado Naku S-M1. Compatible con micrófonos comunes, rotación 270°, estructura metálica y fácil instalación.\nsoporte-naku-ftp-2w-para-proyector-de-techo-o-pared-color-negro;Soporte Naku FTP-2W Para Proyector de Techo o Pared Negro;Soportes > Microfonos\\, Parlantes y Proyectores;Martin;Mariana;FTP-2W;Instalá tu proyector con estilo y seguridad con el soporte Naku FTP-2W de techo o pared. Soporta hasta 20 kg, ajuste flexible y diseño negro moderno.\nsoporte-articulado-naku-sh36-466-de-pared-para-tv-de-32-a-85;\"Soporte Articulado Naku SH36-466 de Pared Para TV de 32\"\" a 85\"\"\";Soportes > TV > Móviles con Brazo;Juan;Mariana;SH36-466;\"Soporte reforzado y articulado Naku SH36-466 para TV de 32\"\" a 85\"\". Máxima extensión, inclinación y resistencia. Ideal para televisores grandes.\"\nsoporte-articulado-naku-sh-466-de-pared-para-tv-de-32-a-85;\"Soporte Articulado Naku SH-466 de Pared Para TV de 32\"\" a 85\"\"\";Soportes > TV > Móviles con Brazo;Juan;Mariana;SH-466;\"Mové tu TV como quieras con el soporte articulado Naku SH-466 para 32\"\" a 85\"\". Firme, extensible, rotativo y listo para instalación segura.\"\nsoporte-articulado-naku-se-466-de-pared-para-tv-de-32-a-85;\"Soporte Articulado Naku SE-466 de Pared Para TV de 32\"\" a 85\";Soportes > TV > Móviles con Brazo;Juan;Mariana;SE-466;\"Soporte articulado reforzado para TV de 32\"\" a 85\"\". El modelo SE-466 de Naku ofrece firmeza, inclinación, rotación y brazo extensible. Ideal para pantallas grandes.\"\nsoporte-articulado-naku-sp-446-de-pared-para-tv-de-32-a-75;\"Soporte Articulado Naku SP-446 de Pared Para TV de 32\"\" a 75\"\"\";Soportes > TV > Móviles con Brazo;Juan;Mariana;SP-446;\"Mové y ajustá tu pantalla con el soporte articulado Naku SP-446 para TV de 32\"\" a 75\"\". Robusto, estético y fácil de instalar.\"\nsoporte-articulado-naku-sh-446-de-pared-para-tv-de-32-a-75;\"Soporte Articulado Naku SH-446 de Pared Para TV de 32\"\" a 75\"\"\";Soportes > TV > Móviles con Brazo;Juan;Mariana;SH-446;\"Soporte Naku SH-446 para TV de 32\"\" a 75\"\", con brazos articulados, inclinación, rotación y gran resistencia. Instalación rápida y segura.\"\nsoporte-articulado-naku-se-446-de-pared-para-tv-de-20-a-75;\"Soporte Articulado Naku SE-446 de Pared Para TV de 20\"\" a 75\"\"\";Soportes > TV > Móviles con Brazo;Juan;Mariana;SE-446;\"Instalá tu pantalla con el soporte Naku SE-446 para TV de 20\"\" a 75\"\". Soporte articulado, inclinable y con brazo extensible. Seguro y fácil de montar.\"\nsoporte-articulado-naku-sh49-483xld-de-pared-para-tv-de-37-a-90;\"Soporte Articulado Naku SH49-483XLD de Pared Para TV de 37\"\" a 90\"\"\";Soportes > TV > Móviles con Brazo;Juan;Mariana;SH49-483XLD;\"Soporte articulado Naku SH49-483XLD de pared para TV de 37\"\" a 90\"\" con brazo extensible hasta 1 metro. Ideal para pantallas grandes. Seguro y fácil de instalar.\"\nsoporte-articulado-naku-sh49-463d-de-pared-para-tv-de-37-a-85;\"Soporte Articulado Naku SH49-463D de Pared Para TV de 37\"\" a 85\"\"\";Soportes > TV > Móviles con Brazo;Juan;Mariana;SH49-463D;\"Soporte articulado Naku SH49-463D de pared para TV de 37\"\" a 85\"\". Extensión de 61.5 cm, inclinación y rotación. Ideal para pantallas grandes.\"\nsoporte-articulado-naku-sp-463wl-de-pared-para-tv-de-32-a-86;\"Soporte Articulado Naku SP-463WL de Pared Para TV de 32\"\" a 86\"\"\";Soportes > TV > Móviles con Brazo;Juan;Mariana;SP-463WL;\"Soporte Naku SP-463WL articulado de pared para TV de 32\"\" a 86\"\". Extensión de 65 cm, inclinación y rotación, ideal para pantallas grandes.\"\nsoporte-articulado-naku-sh-443xwl-de-pared-para-tv-de-32-a-80;\"Soporte Articulado Naku SH-443XWL de Pared Para TV de 32\"\" a 80\"\"\";Soportes > TV > Móviles con Brazo;Juan;Mariana;SH-443XWL;\"Soporte Naku SH-443XWL articulado de brazo largo para TV de 32\"\" a 80\"\". Extensión de hasta 70 cm, inclinación y rotación. Fácil instalación.\"\nsoporte-articulado-naku-sh-443wl-de-pared-para-tv-de-32-a-75;\"Soporte Articulado Naku SH-443WL de Pared Para TV de 32\"\" a 75\"\"\";Soportes > TV > Móviles con Brazo;Juan;Mariana;SH-443WL;\"Soporte articulado Naku SH-443WL con brazo largo y rotación total para TV de 32\"\" a 75\"\". Instalación rápida, máxima extensión y movilidad.\"\nsoporte-articulado-naku-sh-443-de-pared-para-tv-de-32-a-75;\"Soporte Articulado Naku SH-443 de Pared Para TV de 32\"\" a 75\"\"\";Soportes > TV > Móviles con Brazo;Juan;Mariana;SH-443;\"Girá, incliná y extendé tu TV de 32\"\" a 75\"\" con el soporte articulado Naku SH-443. Instalación fácil y libertad total de movimiento.\"\nsoporte-articulado-naku-se-443-de-pared-para-tv-de-20-a-60;\"Soporte Articulado Naku SE-443 de Pared Para TV de 20\"\" a 60\"\"\";Soportes > TV > Móviles con Brazo;Juan;Mariana;SE-443;\"Ajustá tu pantalla con el soporte articulado Naku SE-443 para TV de 20\"\" a 60\"\". Diseño fuerte, ángulo regulable y fácil instalación.\"\nsoporte-articulado-naku-ss-443-de-pared-para-tv-de-15-a-60;\"Soporte Articulado Naku SS-443 de Pared Para TV de 15\"\" a 60\"\"\";Soportes > TV > Móviles con Brazo;Juan;Mariana;SS-443;\"Girá, incliná y extendé tu pantalla con el soporte articulado Naku SS-443 para TV de 15\"\" a 60\"\". Instalación fácil y máxima movilidad.\"\nsoporte-articulado-naku-e15sb-de-pared-para-tv-de-15-a-60;\"Soporte Articulado Naku E15SB de Pared Para TV de 15\"\" a 60\"\"\";Soportes > TV > Móviles con Brazo;Juan;Mariana;E15SB;\"Optimiza tus espacios con el soporte articulado Naku E15SB para TV de 15\"\" a 60\"\". Inclinable, con brazo móvil y fácil instalación.\"\nsoporte-naku-se-223-de-pared-para-tv-de-15-a-48;\"Soporte Articulado Naku SE-223 de Pared Para TV de 15\"\" a 48\"\"\";Soportes > TV > Móviles con Brazo;Juan;Mariana;SE-223;Soporte articulado Naku SE-223 de Pared para TV de 15 a 48 pulgadas. Con 3 brazos, inclinable, giratorio y extensible hasta 37.5 cm. Incluye kit y organizador.\nsoporte-naku-se-223wl-de-pared-para-tv-de-15-a-48;\"Soporte Articulado Naku SE-223WL de Pared Para TV de 15\"\" a 48\"\"\";Soportes > TV > Móviles con Brazo;Juan;Mariana;SE-223WL;Soporte articulado con 3 brazos Naku SE-223WL para TV de 15 a 48 pulgadas. Giratorio, inclinable y con extensión de hasta 61 cm. Incluye kit.\nsoporte-articulado-naku-se-221-de-pared-para-tv-de-15-a-48;\"Soporte Articulado Naku SE-221 de Pared Para TV de 15\"\" a 48\"\"\";Soportes > TV > Móviles con Brazo;Juan;Mariana;SE-221;\"Soporte articulado Naku SE-221 para TV de 15\"\" a 48\"\". Con brazo extensible, inclinación, rotación, organizador de cables y kit de instalación incluido.\"\nsoporte-articulado-naku-ssp-223l-de-pared-para-tv-de-15-a-55;\"Soporte Articulado Naku SSP-223L de Pared Para TV de 15\"\" a 55\"\"\";Soportes > TV > Móviles con Brazo;Juan;Mariana;SSP-223L;\"Soporte articulado Naku SSP-223L para TV de 15\"\" a 55\"\". Con brazo extensible de hasta 61 cm, inclinación, rotación y kit de instalación incluido.\"\nsoporte-articulado-naku-se-222-de-pared-para-tv-de-15-a-48;\"Soporte Articulado Naku SE-222 de Pared Para TV de 15\"\" a 48\"\"\";Soportes > TV > Móviles con Brazo;Juan;Mariana;SE-222;Soporte articulado Naku SE-222 de pared para TV de 15 a 48 pulgadas. Inclinable, giratorio y de perfil ajustable. Incluye kit de instalación.\nsoporte-fijo-naku-s-f-de-pared-para-tv-de-15-a-100;\"Soporte Fijo Naku S-F de Pared Para TV de 15\"\" a 100\"\"\";Soportes > TV > Fijos;Juan;Mariana;S-F;Soporte fijo universal de pared Naku S-F para TV y monitores de 15 a 100 pulgadas. Compatible con VESA 800x600. Resistente y fácil de instalar.\nsoporte-videowall-naku-s-vw1-pared-tv-32-a-85;\"Soporte Videowall Naku S-VW1 de Pared Para TV de 32\"\" a 85\"\"\";Soportes > TV > Fijos con inclinación;Juan;Mariana;S-VW1;Soporte multipanel Naku S-VW1 para videowall de 32 a 85 pulgadas. Montaje preciso con sistema pop-out, estructura de acero y ajuste profesional.\nsoporte-basculante-naku-sp-46-pared-tv-32-a-75;\"Soporte Basculante Naku SP-46B de Pared Para TV de 32\"\" a 75\"\"\";Soportes > TV > Fijos con inclinación;Juan;Mariana;SP-46B;Soporte de pared Naku SP-46 para TV de 32 a 75 pulgadas. Basculante, de acero, resistente y fácil de instalar. Compatible con múltiples VESA.\nsoporte-basculante-naku-sp-44b-pared-tv-32-a-60;\"Soporte Basculante SP-44B de Pared Para TV de 32\"\" a 60\"\"\";Soportes > TV > Fijos con inclinación;Juan;Mariana;SP-44B;Soporte de pared inclinable Naku SP-44B para TV de 32 a 60 pulgadas. Resistente, compacto y fácil de instalar. Ideal para mejorar tu experiencia visual.\nsoporte-basculante-naku-sp-22b-pared-tv-15-a-48;\"Soporte Basculante Naku SP-22B de Pared Para TV de 15\"\" a 48\"\"\";Soportes > TV > Fijos con inclinación;Juan;Mariana;SP-22B;Soporte inclinable Naku SP-22B de pared para TV de 15 a 48 pulgadas. Compacto, resistente y fácil de instalar. Ideal para optimizar espacios.\nsoporte-fijo-naku-s-46f-pared-tv-32-a-85;\"Soporte Fijo Naku S-46F de Pared Para TV de 32\"\" a 85\"\"\";Soportes > TV > Fijos;Juan;Mariana;S-46F;Soporte fijo Naku S-46F para TV de 32 a 85 pulgadas. De pared, resistente y seguro. Instalación fácil con kit incluido. VESA compatible.\nsoporte-fijo-naku-s-44f-pared-tv-32-a-75;\"Soporte Fijo Naku S-44F de Pared Para TV de 32\"\" a 75\"\"\";Soportes > TV > Fijos;Juan;Mariana;S-44F;\"Soporte de pared Naku S-44F para TV de 32\"\" a 75\"\". Instalación fija, diseño compacto y resistente. Compatible con múltiples VESA.\"\nsoporte-fijo-naku-s-22f-de-pared-para-tv-de-32-a-50;\"Soporte Fijo Naku S-22F de Pared Para TV de 32\"\" a 50\"\"\";Soportes > TV > Fijos;Juan;Mariana;S-22F;Soporte fijo NAKU S-22F para TV o monitor de 14 a 50 pulgadas. Fijación segura y diseño compacto. Compatible con VESA. Fácil instalación.\nlector-codigo-barras-naku-lcb2d-005-usb-fijo-2d;Lector De Código De Barras 2D Fijo NAKU LCB2D-005 USB Imager Para Negocio;Comercio;Mario;Juan;LCB2D-005;Lector fijo NAKU LCB2D-005. Escanea códigos 1D, 2D y QR con rapidez y precisión. Ideal para puntos de venta en negocios y supermercados.\nlector-codigo-barras-naku-lcb2d-004-usb-inalambrico-2d;Lector De Código De Barras y Pantallas 2D NAKU LCB2D-004 USB Inalámbrico;Comercio;Mario;Juan;LCB2D-004;Lector inalámbrico NAKU 2D modelo LCB2D-004. Escanea códigos 1D y 2D desde etiquetas o pantallas. Precisión, velocidad y comodidad en un solo equipo.\nlector-codigo-barras-naku-lcb2d-003-usb-2d-imager;Lector De Código De Barras y Pantallas 2D NAKU LCB2D-003 USB;Comercio;Mario;Juan;LCB2D-003;Lector de código de barras NAKU 2D USB modelo LCB2D-003. Escanea códigos 1D y 2D en etiquetas o pantallas. Ideal para comercios, rápido y preciso.\nlector-codigo-barras-naku-lcb1d-002-inalambrico-usb-laser-1d;Lector De Código De Barras 1D NAKU LCB1D-002 Inalámbrico USB Láser Lineal;Comercio;Mario;Juan;LCB1D-002;Lector de código de barras NAKU LCB1D-002. Conexión inalámbrica por USB, escaneo láser 1D de alta velocidad. Ideal para comercios y acciones.\nlector-codigo-barras-sker-lcb1d-001-usb-laser-lineal-1d;Lector De Código De Barras Naku 1D LCB1D-001 USB Imager Láser Lineal;Comercio;Mario;Juan;LCB1D-001;Lector de códigos NAKU 1D modelo LCB1D-001. Conexión USB, escaneo láser rápido lineal y preciso. Ideal para comercios y acciones.\nmesa-plegable-valija-sker-mp-001-picnic-exterior-playa-180x70-blanca;Mesa Plegable Picnic 180x70 cm;Hogar > Exterior y aire libre;Lucho;Mariana;MP-001;Mesa plegable tipo valija 180x70cm para camping, picnic y playa. Transportable, resistente al agua UV. Soporta hasta 8 personas. Incluye asa de traslado.\nmesa-plegable-valija-sker-mp-001-picnic-exterior-playa-180x70-blanca;;;Lucho;Mariana;MP-001-NEGRA;\nmesa-plegable-sker-mp-002-camping-playa-pesca-portatil-con-bolso;Mesa Plegable MP-002 para Camping, Playa o Pesca con Bolso - 52x53 cm;Hogar > Exterior y aire libre;Lucho;Mariana;MP-002;Mesa plegable Sker MP-002 ideal para camping, playa y pesca. Compacta, liviana y resistente. Incluye bolso. Medidas: 53x52x50 cm.\nescalera-naku-esc-003-aluminio-telescopica-9-escalones-3-5m;Escalera Naku ESC-003 de Aluminio Telescópica 9 Escalones Extensible 3,5 m;Hogar > Herramientas y equipamiento, Comercio;Juan;Mariana;ESC-003;Escalera telescópica Naku ESC-003 de aluminio. Extensible hasta 3,5 m con 9 escalones. Compacta, segura y fácil de transportar. Soporta 150 kg.\nescalera-sker-esc-002-aluminio-multiproposito-16-escalones;Escalera Naku ESC-002 de Aluminio Multipropósito 16 Escalones - 8 Posiciones;Hogar > Herramientas y equipamiento, Comercio;Juan;Mariana;ESC-002;Escalera Sker ESC-002 de aluminio con 16 escalones. Articulada, plegable y con 8 posiciones. Soporta hasta 150 kg. Altura máxima 4,56 m.\nescalera-sker-esc-001-aluminio-multiproposito-12-escalones;Escalera Naku ESC-001 de Aluminio Multipropósito 12 Escalones - 8 Posiciones;Hogar > Herramientas y equipamiento, Comercio;Juan;Mariana;ESC-001;Escalera Sker ESC-001 de aluminio con 12 escalones. 8 posiciones, plegable, articulada y segura. Altura máxima de 3,46 m. Soporta hasta 150 kg.\ngaveta-dinero-naku-cr-001-caja-registradora-electronica-5-compartimientos;Gaveta Dinero Electrónica CR-001 5 Compartimientos;Comercio;Mario;Juan;CR-001;Gaveta dinero electrónica CR-001. 5 compartimientos billetes y monedas. Ranura secreta. Cerradura 3 posiciones. Compatible facturación RJ11. Hierro.\nselladora-cortadora-sker-sb-200-40cm-con-regulador-y-repuesto;Selladora Cortadora Naku SB-400 40cm Profesional con Regulador y Repuesto;Comercio;Mario;Mariana;SB-400;Selladora profesional Sker SB-200 de 40cm. 800W, regulador de temperatura, corte automático y repuesto. Para polietileno, PVC y más.\nselladora-cortadora-sker-sb-200-20cm-con-regulador-y-repuesto;Selladora Cortadora SB-200 20cm Regulador Repuesto;Comercio;Mario;Mariana;SB-200;Selladora SB-200 20cm profesional. Potencia 300W. Regulador electrónico de temperatura. Corte automático. Repuesto incluido. Bolsas plásticas y burbujas.\nselladora-cortadora-naku-sb-300-30cm-con-regulador-y-repuesto;Selladora Cortadora SB-300 30cm Regulador y Repuesto;Comercio;Mario;Mariana;SB-300;Selladora SB-400 40cm, 400W profesional. Regulador electrónico. Corte automático. Repuesto incluido. Industria, panaderías, distribuidoras.\nionizador-solar-pileta-naku-ion-001-150000-litros;Ionizador Solar Naku ION-001 para Piletas Hasta 150.000 L - Antisarro y Sustentable;Hogar > Exterior y aire libre, Hogar > Limpieza;Lucho;Mariana;ION-001;Ionizador solar para pila Naku ION-001. Reduce el uso de cloro, elimina algas y bacterias. Apto hasta 150.000L. Incluye accesorios y tiras medidoras.\nset-x124-herramientas-manuales-en-caja-naku-ch-001;Set X124 Herramientas Manuales en Caja Naku CH-001;Hogar > Herramientas y equipamiento, Comercio;Juan;Lucho;CH-01;Kit de herramientas Naku CH-001 con 124 piezas. Caja portátil con destornilladores, alicates, martillo, linterna, llaves y más.\nastronauta-proyector-naku-vp-002-sentado-galaxia-led-blanco;Astronauta Proyector Sentado Naku VP-002 Luz Galaxia LED con Control - Blanco;Hogar > Iluminación;Mariana;;VP-002-BLANCO;Proyector galaxia LED Naku VP-002 blanco con forma de astronauta sentado. Incluye control remoto, temporizador y proyección 360°.\nastronauta-proyector-naku-vp-002-sentado-galaxia-led-negro;Astronauta Proyector Sentado Naku VP-002 Luz Galaxia LED con Control - Negro;Hogar > Iluminación;Mariana;;VP-002-NEGRO;Proyector LED galaxia Naku VP-002 con forma de astronauta sentado. Control remoto, efectos de nebulosa y temporizador. Ideal para decorar y relajar.\nastronauta-proyector-naku-vp-003-luz-galaxia-led-blanco;Astronauta Proyector Naku VP-003 Luz Galaxia LED con Control - Color Blanco;Hogar > Iluminación;Mariana;;VP-003;Proyector LED Naku VP-003 con forma de astronauta. Luz galaxia y estrellas, control remoto, diseño decorativo y relajante. Ideal para interiores.\nproyector-velador-naku-vp-001-negro-luz-galaxia-led-parlante;Proyector Velador Naku VP-001 Luz Galaxia LED con Parlante y Control Negro;Hogar > Iluminación;Mariana;;VP-001-NEGRO;Lámpara proyector Naku VP-001 negra con luces LED, Bluetooth, temporizador y control remoto. Ideal para dormir, ambientar y relajarse.\nproyector-velador-naku-vp-001-luz-galaxia-led-parlante;Proyector Velador Naku VP-001 Luz Galaxia LED con Parlante y Control Blanco;Hogar > Iluminación;Mariana;;VP-001-BLANCO;Lámpara proyector de estrellas Naku VP-001 con luz LED, Bluetooth, USB y control remoto. Ideal para dormir o ambientar espacios.\ncamara-ip-naku-cv-005-babycall-wifi-fullhd;Cámara Baby Call WiFi IP Naku CV-005 Full HD Motorizada con Visión Nocturna;Hogar > Seguridad y vigilancia;Juan;Mariana;CV-005;Cámara WiFi IP Naku CV-005 Full HD 2MP. Ideal como baby call. Audio bidireccional, visión nocturna y control remoto desde celular.\ncamara-ip-naku-cv-004-babycall-wifi-fullhd;Cámara Baby Call WiFi IP Naku CV-004 Full HD Motorizada con Visión Nocturna;Hogar > Seguridad y vigilancia;Juan;Mariana;CV-004;Cámara WiFi IP Naku CV-004 con resolución Full HD. Ideal como baby call. Visión nocturna, audio bidireccional y control desde celular o Alexa.\ncamara-ip-naku-cv-003-doble-lente-babycall-fullhd;Cámara Baby Call Doble Lente WiFi IP Naku CV-003 Full HD Motorizada 2MP;Hogar > Seguridad y vigilancia;Juan;Mariana;CV-003;Cámara de seguridad interior Naku CV-003 con doble\ncamara-ip-naku-cv-002-doble-lente-wifi-fullhd;Cámara de Seguridad Doble Lente WiFi IP Naku CV-002 Full HD Motorizada 3MP;Hogar > Seguridad y vigilancia;Juan;Mariana;CV-002;Cámara de seguridad WiFi IP Naku CV-002 con doble lente 3MP. Visión nocturna, motorizada, audio bidireccional y control desde app o Alexa.\ncamara-ip-naku-cv-001-wifi-4mp-fullhd-motorizada;Cámara de Seguridad WiFi IP Naku CV-001 Full HD 4MP Motorizada con Visión Nocturna;Hogar > Seguridad y vigilancia;Juan;Mariana;CV-001;Cámara de seguridad IP WiFi Naku CV-001 4MP Full HD. Visión nocturna, audio bidireccional, detección de movimiento y control desde el celular.\nestructura-escritorio-naku-22d-b-st-altura-regulable;Estructura Regulable Manual 135x60 cm - Sit-Stand con Manivela (SIN TABLA);Hogar > Escritorios ergonómicos;Martin;Mariana;22D-B/ST;Estructura regulable Naku 22D-B/ST con manivela. Ajuste de altura entre 72 y 120 cm. No incluye tablero. Ideal para oficinas o estudios.\nnaku-22d-estructura;Estructura Eléctrica Regulable 135x60 cm - Sit-Stand Automatico (SIN TABLA);Hogar > Escritorios ergonómicos;Martin;Mariana;22D-BEL/ST;Base eléctrica regulable Naku 22D-BEL/ST con motor. Altura ajustable de 73 a 120 cm. No incluye tablero. Ideal para armar tu propio escritorio.\nmaquina-coser-naku-mc003;Máquina de Coser Naku MC-003 Profesional 12 Puntadas con Pedal y Luz LED;Hogar > Máquinas de coser;Mariana;;MC-003;Máquina de coser profesional Naku MC-003 con 12 puntadas, pedal, función reversa y luz LED. Ideal para uso doméstico.\nmini-coser-naku-mc001;Mini Máquina de Coser Naku MC-001 Portátil 1 Puntada con Pedal y Luz LED;Hogar > Máquinas de coser;Mariana;;MC-001;Máquina de coser mini portátil Naku MC-001. Ideal para uso doméstico, con pedal, luz LED y alimentación por corriente o pilas.\nmaquina-de-coser-mc-002-mini-12-puntadas-con-pedal-y-luz-led-z2jap;Máquina de Coser MC-002 Mini 12 Puntadas con Pedal y Luz LED;Hogar > Máquinas de coser;Mariana;;MC-002;áquina de coser compacta y portátil con 12 puntadas, pedal, luz LED y auto bobinado. Ideal para principiantes y uso doméstico.\nescritorio-electrico-regulable-135x60-cm-sit-stand-automatico-blanco-q1r2y;Escritorio Eléctrico Sit-Stand 135x60 Blanco;Hogar > Escritorios ergonómicos;Martin;Mariana;22D-BEL BLANCO (MODELO ELECTRICO);Escritorio eléctrico regulable 135x60cm. Altura ajustable 73-120cm con motor. 2 memorias preestablecidas. Soporta 70kg. Escritorio sit-stand para home office.\nescritorio-regulable-manual-135x60-cm-sit-stand-con-manivela-blanco-oqowc;Escritorio Regulable Manual 135x60 cm - Sit-Stand con Manivela Blanco;Hogar > Escritorios ergonómicos;Martin;Mariana;22D-B BLANCO;Escritorio ergonómico regulable en altura con manivela. Mejora la postura y comodidad en oficina o gaming. Envíos a todo el país.";
const NAKU_COSTOS = [["22D-B",128288],["22D-B/ST",88288],["22D-BEL BLANCO (MODELO ELECTRICO)",132638.75],["22D-BEL MADERA (MODELO ELECTRICO)",143338.75],["22D-BEL NEGRO (MODELO ELECTRICO)",136338.75],["22D-BEL/ST",102338.75],["CDB-001",61127.35],["CDB-002",36956.65],["CDB-003",85105.385],["CDB-004",66381.85],["CE-1",84878],["CE-2",157751.25],["CE-3",253773.75],["CF-001B",15501.55],["CF-001N",15501.55],["CF-002B",35544.6],["CF-002N",35544.6],["CH-01",26740.6],["CR-001",35334.575],["CRS-001",7190.295],["CRS-002",8567.16],["CV-001",21299.945],["CV-001 X 2 UNITS",42599.89],["CV-001 X 3 UNITS",63899.835],["CV-002",26069.45],["CV-002 X 2 UNITS",52138.9],["CV-002 X 3 UNITS",78208.35],["CV-003",20485.575],["CV-003 X 2 UNITS",40971.15],["CV-003 X 3 UNITS",61456.725],["CV-004",12028.62],["CV-004 X 2 UNITS",24057.24],["CV-004 X 3 UNITS",36085.86],["CV-005",13819.18],["CV-005 X 2 UNITS",27638.36],["CV-005 X 3 UNITS",41457.54],["E15SB",7137.13],["EARTH2S",7188.7],["EARTH4S",7022.55],["ESC-001",59558.75],["ESC-002",68500.08],["ESC-003",66325.12],["ESC-004",45570.62],["ESC-005",55276.72],["ESC-006",64944.38],["ESC-007",11566.72],["ESC-008",13749.12],["ESC-009",17360],["FTP-2W",12853.375],["GZB-001A",62967.2],["GZB-001R",62967.2],["GZB-002A",71355.8],["GZB-002B",71355.8],["ION-001",53196],["LCB1D-001",10877.9],["LCB1D-001CON-SOPORTE",15651.9],["LCB1D-002",15191.55],["LCB1D-002CON-SOPORTE",19965.55],["LCB2D-003",14628.9],["LCB2D-003CON-SOPORTE",19402.9],["LCB2D-004",20818.05],["LCB2D-004CON-SOPORTE",25592.05],["LCB2D-005",48200.35],["MC-001",10828.3],["MC-002",20915.235],["MC-003",42510.3],["MP-001",30076.2],["MP-001 NEGRA",32354.7],["MP-002",12865.93],["MTV-001",19788.23],["ORG-001",6256.575],["ORG-002",40561.95],["ORG-003",13574.125],["ORG-003 BLANCO",13574.125],["ORG-003 ROSA",13574.125],["ORG-004",9754.15],["ORG-004 BLANCO",9754.15],["ORG-004 ROSA",9754.15],["ORG-006",18114.85],["ORG-006 BLANCO",18114.85],["ORG-007",21934.825],["ORG-007-BLANCO",21934.825],["ORG-008",25058.075],["ORG-008 BLANCO",25058.075],["PER-001 X 10 UNITS",5708.65],["PER-001 X 100 UNITS",57086.5],["PER-001 X 20 UNITS",11417.3],["PER-001 X 50 UNITS",28543.25],["PER-002 X 10 UNITS",2250.6],["PER-002 X 100 UNITS",22506],["PER-002 X 20 UNITS",4501.2],["PER-002 X 50 UNITS",11253],["PER-003 X 10 UNITS",7798.05],["PER-003 X 100 UNITS",77980.5],["PER-003 X 20 UNITS",15596.1],["PER-003 X 50 UNITS",38990.25],["PER-004",14059.43],["PER-005",19310.52],["PER-006",33685.53],["PLA-001",17088.75],["PLB-CE344",22607.37],["PP-1032M",19334.7],["PP-C024D",33298.65],["PR-001",7659.48],["REP-001",27202.5],["REP-001 X 2 UNITS",54405],["REP-002",26946.75],["REP-002 X 2 UNITS",53893.5],["REP-003",51878.965],["REP-003 X 2 UNITS",103757.93],["S-22F",1885.73],["S-44F",2983.75],["S-46B",5318.05],["S-46F",3938.55],["S-501",5521.255],["S-502",5826.45],["S-504",12476.88],["S-CM222",14298.13],["S-CM244",16446.43],["S-F",2872.15],["S-LH",8235.46],["S-M1",13043.25],["S-VW1",47299.49],["SB-200",9595.74],["SB-300",12869.34],["SB-400",18393.54],["SB-51",24159.85],["SE-111",5536.6],["SE-113",8740.76],["SE-221",5297.435],["SE-222",10460.64],["SE-223",6671.2],["SE-223WL",15019.5],["SE-443",11026.08],["SE-446",14150.725],["SE-466",15592.225],["SH-443",13941.785],["SH-443WL",19698.95],["SH-443XWL",30052.33],["SH-446",20026.93],["SH-466",25394.425],["SH36-466",35712],["SH49-463D",50967.565],["SH49-466",23226.75],["SH49-483XLD",50238.6],["SHE-446",25319.25],["SM-C010",12030.48],["SM-C011NBH",27644.25],["SM-C012",13510.42],["SM-C024",16823.235],["SM-C034",28405.3],["SM-C048",33585.09],["SM-C09",11433.73],["SM-T01",13223.98],["SM-T02",21278.4],["SOM-1 A",11613.375],["SOM-1 R",11613.375],["SOM-2 A",12534.075],["SOM-2 R",12534.075],["SOP-LCB",4774],["SP-11W",14059.43],["SP-22B",3079.23],["SP-446",21262.125],["SP-44B",4243.9],["SP-463WL",45917.82],["SP-696",76693.07],["SS-1032M",15801.94],["SS-443",15140.4],["SS-C024D",29479.45],["SSP-223L",13454],["ST-466",159690.3],["TAPABLANCA",30300],["TAPAMADERA",41000],["TAPANEGRA",34000],["TEN-001",20354.91],["TEN-002",23314.17],["TEN-003",26495.7],["TEN-004",21793],["TVR-001",53344.8],["TVR-004",70416.5],["VP-001 BLANCO",8431.535],["VP-001 NEGRO",8431.535],["VP-002 BLANCO",9311.625],["VP-002 NEGRO",9311.625],["VP-003",8377.905],["ZAP-001",9786.7],["ZAP-002",9786.7],["ZAP-003",81016.95],["ZAP-004",17621.175]];
const NAKU_MES_COSTOS = "JULIO 2026";

/* ── lo que usa el importer del tablero ── */
window.NakuMotor = {
  costos: __costos,
  engine: __engine,
  finanzas: __finanzas,
  postventa: __postventa,
  tablero: __tablero,
  maestroCSV: NAKU_MAESTRO_CSV,
  costosPares: NAKU_COSTOS,
  mesCostos: NAKU_MES_COSTOS,
};
