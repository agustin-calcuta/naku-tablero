// Datos compartidos del Buyer. Se usa sin cambios en navegador y servidor.
import { buildMaestro, makeMatcher, normSku } from './engine.mjs';

export const BUYER_COLS = ['canal','order_id','mes','buyer','familia','nombre','sku','sku_raw','unidades','facturacion','cuotas','envio','billable','provincia'];

export function parseCSV(text, delimiter) {
  text = String(text).replace(/^\uFEFF/, '').replace(/^sep=[;,]\r?\n/i, '');
  const rows = []; let row = [], value = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { value += '"'; i++; } else quoted = false; }
      else value += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) { row.push(value); value = ''; }
    else if (c === '\n') { row.push(value); if (row.some(v => v.trim())) rows.push(row); row = []; value = ''; }
    else if (c !== '\r') value += c;
  }
  if (quoted) throw new Error('El CSV tiene comillas sin cerrar. Volvé a guardarlo como CSV.');
  if (value.length || row.length) { row.push(value); if (row.some(v => v.trim())) rows.push(row); }
  return rows;
}

export function parseMaestro(text) {
  for (const delimiter of [';', ',']) {
    const rows = parseCSV(text, delimiter);
    const header = (rows[0] || []).map(h => h.trim());
    if (!header.includes('SKU') || !header.includes('Buyer Persona')) continue;
    if (rows.length < 2) throw new Error('El maestro no tiene productos.');
    if (rows.some(r => r.length !== header.length)) throw new Error('Hay filas con distinta cantidad de columnas en el maestro.');
    rows[0] = header;
    return rows;
  }
  throw new Error('El archivo debe tener columnas "SKU" y "Buyer Persona". Se aceptan CSV con comas o punto y coma.');
}

export function mergeMaestro(previous, incoming) {
  const header = ['SKU', 'Nombre', 'Categorías', 'Familia', 'Buyer Persona'];
  const products = new Map();
  for (const text of [previous, incoming]) {
    if (!text) continue;
    const [cols, ...rows] = parseMaestro(text);
    for (const row of rows) {
      const record = Object.fromEntries(header.filter(h => cols.includes(h)).map(h => [h, row[cols.indexOf(h)].trim()]));
      const key = normSku(record.SKU) || ('nombre:' + normSku(record.Nombre));
      if (!record.SKU && !record.Nombre) continue;
      products.set(key, { ...products.get(key), ...record });
    }
  }
  const escape = s => '"' + String(s ?? '').replace(/"/g, '""') + '"';
  return [header, ...[...products.values()].map(p => header.map(h => p[h] || ''))].map(r => r.map(escape).join(';')).join('\n');
}

export function lineKey(l) {
  return [l.canal,l.order_id,l.sku,l.unidades,l.facturacion].join('|');
}

export function packLines(lines) {
  return { cols: BUYER_COLS, rows: lines.map(l => BUYER_COLS.map(c => l[c] ?? null)) };
}

export function unpackLines(data) {
  if (!data || JSON.stringify(data.cols) !== JSON.stringify(BUYER_COLS) || !Array.isArray(data.rows)) throw new Error('Formato de ventas inválido.');
  return data.rows.map(row => {
    if (!Array.isArray(row) || row.length !== BUYER_COLS.length) throw new Error('Fila de ventas inválida.');
    const l = Object.fromEntries(BUYER_COLS.map((c, i) => [c, row[i]]));
    if (!['MercadoLibre','TiendaNube'].includes(l.canal) || !l.order_id || (l.mes !== '' && !/^\d{4}-\d{2}$/.test(l.mes))
      || !Number.isFinite(l.unidades) || !Number.isFinite(l.facturacion)) throw new Error('La venta tiene canal, orden, mes o importes inválidos.');
    return l;
  });
}

// Los mismos meses que publica Dirección; no recalcular «Este año» con el
// último export, que puede ser un mes parcial o tener meses intermedios faltantes.
export function buyerPeriodMonths(data, preset) {
  const months=data.mesesCargados||[];
  if(preset==='1')return months.slice(-1);
  const id=({all:'rango','3':'m3','6':'m6',ytd:'anio'})[preset];
  return data.periodos?.find(p=>p.id===id)?.meses||months;
}

export function mergeBuyer(current, operation) {
  const incoming = unpackLines(operation.ventas);
  const lines = unpackLines(current.ventas);
  const seen = new Set(lines.map(lineKey));
  let nuevas = 0, dups = 0, cambios = 0;
  for (const l of incoming) {
    const key = lineKey(l);
    if (seen.has(key)) { dups++; continue; }
    seen.add(key); lines.push(l); nuevas++;
  }
  const maestro = operation.maestro ? mergeMaestro(current.maestro, operation.maestro) : current.maestro;
  const match = makeMatcher(buildMaestro(parseMaestro(maestro)));
  for (const l of lines) {
    const m = match(l.sku_raw || l.sku, l.nombre);
    const familia = m.familia || l.familia;
    if (m.buyer !== l.buyer || familia !== l.familia) cambios++;
    l.buyer = m.buyer; l.familia = familia; if (m.nombre) l.nombre = m.nombre;
  }
  const result = { nuevas, dups, cambios };
  const manifest = [...(current.manifest || []), { file: String(operation.nombre || 'Actualización').slice(0, 240), ...result, when: Date.now() }].slice(-300);
  return { data: { ventas: packLines(lines), maestro, manifest }, result };
}
