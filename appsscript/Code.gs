/**
 * NAKU · Backend del tablero de compradores (Google Apps Script Web App)
 * ---------------------------------------------------------------------------
 * Rol: guardar las LÍNEAS de venta normalizadas (que el browser parsea con el
 * motor engine.mjs) en un Google Sheet (histórico/DB), deduplicar, recomputar
 * el rollup agregado y servírselo al tablero. También sirve el maestro.
 *
 * El parseo pesado (schema drift MeLi, cp1252 TN, matching SKU→buyer) ocurre en
 * el navegador; acá NO se parsea Excel. Este backend solo persiste y agrega.
 *
 * IMPORTANTE: la agregación de acá es un PORT de engine.mjs `aggregate()`.
 * Si cambiás el motor, actualizá esta función para que los números coincidan.
 *
 * Setup: ver appsscript/README.md
 */

// ======================= CONFIG (completar) =======================
const CONFIG = {
  SPREADSHEET_ID: 'PEGAR_ID_DEL_SHEET',   // el ID que aparece en la URL del Google Sheet
  RAW_FOLDER_ID: '',                      // (opcional) carpeta Drive para archivar los xlsx crudos
  TOKEN: 'CAMBIAR_ESTE_TOKEN',            // secreto compartido con el frontend (no es auth fuerte)
  TAB_VENTAS: 'Ventas',                   // DB de líneas
  TAB_MAESTRO: 'Maestro',                 // SKU → comprador (editable por la agencia)
  TAB_META: 'Meta',                       // guarda el rollup JSON en A1
};

const VENTAS_HEADER = ['key','canal','order_id','fecha','mes','sku','buyer','familia','nombre','unidades','facturacion','cuotas','provincia','estado','source','uploaded_at'];
const PERSONAS = ['Juan','Mariana','Lucho','Martin','Mario','Sin asignar'];

// ======================= ROUTER =======================
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.token !== CONFIG.TOKEN) return jsonOut({ ok: false, error: 'token inválido' });
  try {
    if (p.action === 'rollup')  return jsonOut({ ok: true, rollup: getRollup() });
    if (p.action === 'maestro') return jsonOut({ ok: true, maestro: getMaestro() });
    if (p.action === 'ping')    return jsonOut({ ok: true, ping: 'pong' });
    return jsonOut({ ok: false, error: 'action desconocida' });
  } catch (err) { return jsonOut({ ok: false, error: String(err) }); }
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); }
  catch (err) { return jsonOut({ ok: false, error: 'body no es JSON' }); }
  if (!body || body.token !== CONFIG.TOKEN) return jsonOut({ ok: false, error: 'token inválido' });
  try {
    if (body.action === 'save') {
      const res = appendLines(body.lines || []);
      if (body.final) res.rollup = recomputeRollup();  // recomputar al terminar de subir todos los chunks
      return jsonOut(Object.assign({ ok: true }, res));
    }
    if (body.action === 'recompute') return jsonOut({ ok: true, rollup: recomputeRollup() });
    return jsonOut({ ok: false, error: 'action desconocida' });
  } catch (err) { return jsonOut({ ok: false, error: String(err) }); }
}

// ======================= PERSISTENCIA =======================
function ss() { return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID); }

function getOrCreateSheet(name, header) {
  const book = ss();
  let sh = book.getSheetByName(name);
  if (!sh) { sh = book.insertSheet(name); if (header) sh.appendRow(header); }
  return sh;
}

/** Appendea líneas nuevas al Sheet Ventas, deduplicando por `key`. */
function appendLines(lines) {
  const sh = getOrCreateSheet(CONFIG.TAB_VENTAS, VENTAS_HEADER);
  const last = sh.getLastRow();
  const seen = {};
  if (last > 1) {
    const keys = sh.getRange(2, 1, last - 1, 1).getValues();
    for (let i = 0; i < keys.length; i++) seen[keys[i][0]] = true;
  }
  const stamp = new Date().toISOString();
  const rows = [];
  for (const l of lines) {
    const key = [l.canal, l.order_id, l.sku, l.unidades, l.facturacion].join('|');
    if (seen[key]) continue;
    seen[key] = true;
    rows.push([key, l.canal, l.order_id, l.fecha, l.mes, l.sku, l.buyer, l.familia || '', l.nombre || '',
      Number(l.unidades) || 0, Number(l.facturacion) || 0, Number(l.cuotas) || 0, l.provincia || '', l.estado_orden || '', l.source_file || '', stamp]);
  }
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, VENTAS_HEADER.length).setValues(rows);
  return { added: rows.length, skipped: lines.length - rows.length, total: sh.getLastRow() - 1 };
}

function getMaestro() {
  const sh = ss().getSheetByName(CONFIG.TAB_MAESTRO);
  if (!sh || sh.getLastRow() < 2) return [];
  const values = sh.getDataRange().getValues();
  const header = values[0].map(String);
  return values.slice(1).map((r) => { const o = {}; header.forEach((h, i) => (o[h] = r[i])); return o; });
}

function getRollup() {
  const sh = getOrCreateSheet(CONFIG.TAB_META);
  const cell = sh.getRange('A1').getValue();
  if (!cell) return recomputeRollup();
  try { return JSON.parse(cell); } catch (e) { return recomputeRollup(); }
}

// ======================= AGREGACIÓN (port de engine.mjs) =======================
/** Lee todas las líneas del Sheet y recomputa el rollup; lo guarda en Meta!A1 como JSON. */
function recomputeRollup() {
  const sh = ss().getSheetByName(CONFIG.TAB_VENTAS);
  const rollup = emptyRollup();
  if (sh && sh.getLastRow() > 1) {
    const v = sh.getRange(2, 1, sh.getLastRow() - 1, VENTAS_HEADER.length).getValues();
    const idx = {}; VENTAS_HEADER.forEach((h, i) => (idx[h] = i));
    const lines = v.map((r) => ({
      canal: r[idx.canal], order_id: String(r[idx.order_id]), mes: r[idx.mes],
      sku: r[idx.sku], buyer: r[idx.buyer], familia: r[idx.familia], nombre: r[idx.nombre],
      unidades: Number(r[idx.unidades]) || 0, facturacion: Number(r[idx.facturacion]) || 0, cuotas: Number(r[idx.cuotas]) || 0,
    }));
    aggregateInto(rollup, lines);
  }
  const meta = getOrCreateSheet(CONFIG.TAB_META);
  meta.getRange('A1').setValue(JSON.stringify(rollup));
  return rollup;
}

function emptyRollup() {
  const byPersona = {};
  PERSONAS.forEach((p) => (byPersona[p] = { facturacion: 0, unidades: 0, ordenes: 0, ticket: 0, cuotas: 0, sharePct: 0 }));
  return { updated: new Date().toISOString(), byPersona: byPersona, porMesCanalPersona: [], topByPersona: {}, unmapped: [], totales: {} };
}

/** Mirror de engine.aggregate: byPersona + mes/canal + topByPersona(familia→productos) + cobertura. */
function aggregateInto(out, lines) {
  const byP = out.byPersona;
  const orders = {}, mcp = {}, fam = {}, unmapped = {};
  PERSONAS.forEach((p) => (fam[p] = {}));
  for (const l of lines) {
    const p = byP[l.buyer] ? l.buyer : 'Sin asignar';
    const mk = l.mes + '|' + l.canal + '|' + p;
    (mcp[mk] = mcp[mk] || { mes: l.mes, canal: l.canal, buyer: p, facturacion: 0, unidades: 0 });
    mcp[mk].facturacion += l.facturacion; mcp[mk].unidades += l.unidades;
    const ok = l.canal + '|' + l.order_id;
    const o = (orders[ok] = orders[ok] || { total: 0, cuotas: 0, best: -1, persona: 'Sin asignar' });
    o.total += l.facturacion; if (l.cuotas) o.cuotas = Math.max(o.cuotas, l.cuotas);
    if (l.facturacion > o.best) { o.best = l.facturacion; o.persona = p; }
    byP[p].facturacion += l.facturacion; byP[p].unidades += l.unidades;
    const fm = (fam[p][l.familia] = fam[p][l.familia] || { familia: l.familia, facturacion: 0, unidades: 0, productos: {} });
    fm.facturacion += l.facturacion; fm.unidades += l.unidades;
    const pk = l.sku || l.nombre;
    const pr = (fm.productos[pk] = fm.productos[pk] || { sku: l.sku, nombre: l.nombre, facturacion: 0, unidades: 0 });
    pr.facturacion += l.facturacion; pr.unidades += l.unidades;
    if (p === 'Sin asignar' && l.sku) {
      const u = (unmapped[l.sku] = unmapped[l.sku] || { sku: l.sku, nombre: l.nombre, facturacion: 0, lines: 0 });
      u.facturacion += l.facturacion; u.lines++;
    }
  }
  const oc = {}, os = {}, cs = {}, cc = {};
  for (const k in orders) { const o = orders[k]; oc[o.persona] = (oc[o.persona] || 0) + 1; os[o.persona] = (os[o.persona] || 0) + o.total; if (o.cuotas > 0) { cs[o.persona] = (cs[o.persona] || 0) + o.cuotas; cc[o.persona] = (cc[o.persona] || 0) + 1; } }
  let total = 0; PERSONAS.forEach((p) => (total += byP[p].facturacion));
  const asignada = total - byP['Sin asignar'].facturacion;
  PERSONAS.forEach((p) => {
    byP[p].ordenes = oc[p] || 0;
    byP[p].ticket = oc[p] ? Math.round(os[p] / oc[p]) : 0;
    byP[p].cuotas = cc[p] ? +(cs[p] / cc[p]).toFixed(1) : 0;
    byP[p].facturacion = Math.round(byP[p].facturacion);
    byP[p].sharePct = total ? +(100 * byP[p].facturacion / total).toFixed(1) : 0;
    const totalP = byP[p].facturacion || 1;
    out.topByPersona[p] = Object.keys(fam[p]).map((k) => {
      const f = fam[p][k];
      return { familia: f.familia, facturacion: Math.round(f.facturacion), unidades: f.unidades,
        precioProm: f.unidades ? Math.round(f.facturacion / f.unidades) : 0, sharePct: +(100 * f.facturacion / totalP).toFixed(1),
        productos: Object.keys(f.productos).map((s) => { const x = f.productos[s]; return { sku: x.sku, nombre: x.nombre, facturacion: Math.round(x.facturacion), unidades: x.unidades, precioProm: x.unidades ? Math.round(x.facturacion / x.unidades) : 0 }; }).sort((a, b) => b.facturacion - a.facturacion).slice(0, 8) };
    }).sort((a, b) => b.facturacion - a.facturacion);
  });
  out.porMesCanalPersona = Object.keys(mcp).map((k) => { const m = mcp[k]; m.facturacion = Math.round(m.facturacion); return m; });
  out.unmapped = Object.keys(unmapped).map((k) => { const u = unmapped[k]; u.facturacion = Math.round(u.facturacion); return u; }).sort((a, b) => b.facturacion - a.facturacion).slice(0, 40);
  out.totales = { facturacion: Math.round(total), facturacionAsignada: Math.round(asignada), coberturaPct: total ? +(100 * asignada / total).toFixed(1) : 0, ordenes: Object.keys(orders).length, lineas: lines.length };
}

// ======================= util =======================
function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
