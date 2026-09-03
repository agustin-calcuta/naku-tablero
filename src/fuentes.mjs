// fuentes.mjs — de dónde sale cada archivo que alimenta el tablero.
//
// Una fuente puede estar en Google (una planilla que alguien mantiene) o en el
// disco (un export que hay que bajar a mano, como el de MercadoLibre). Este
// módulo resuelve las dos con la misma llamada y deja copia local de lo que baja,
// así el build sigue funcionando sin internet y no se pierde el histórico.
//
// Google sirve dos cosas distintas con URLs distintas:
//   · Planilla nativa de Sheets (id de 44 caracteres) → /export?format=xlsx
//   · Archivo .xlsx subido a Drive (id más corto)     → uc?export=download
// Las dos necesitan que el archivo esté compartido como "cualquiera con el
// enlace puede ver". Si no lo está, Google devuelve el HTML del login en vez del
// archivo: eso se detecta y se avisa, en vez de guardar basura.

import fs from 'node:fs';
import path from 'node:path';

/** Saca el id de archivo de un link de Google, o devuelve la cadena si ya es un id. */
export function idDeGoogle(url) {
  if (!url) return '';
  const m = /\/d\/([A-Za-z0-9_-]{20,})/.exec(String(url));
  return m ? m[1] : String(url).trim();
}

/**
 * URL de descarga directa. Los ids de Sheets nativos son largos; los de archivos
 * subidos a Drive son más cortos y no aceptan /export.
 */
export function urlDescarga(id, tipo) {
  const clase = tipo || (id.length >= 40 ? 'sheet' : 'drive');
  return clase === 'sheet'
    ? `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`
    : `https://drive.google.com/uc?export=download&id=${id}`;
}

const esHtml = (buf) => {
  const cabeza = buf.subarray(0, 200).toString('latin1').trim().toLowerCase();
  return cabeza.startsWith('<!doctype html') || cabeza.startsWith('<html');
};
const esZip = (buf) => buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b;  // xlsx = zip

/**
 * Baja una fuente de Google y la guarda en `destino`.
 * @returns {{ok:boolean, motivo?:string, bytes?:number}}
 */
export async function bajarDeGoogle(id, destino, { tipo, timeoutMs = 60000 } = {}) {
  const url = urlDescarga(id, tipo);
  const corte = AbortSignal.timeout(timeoutMs);
  let res;
  try {
    res = await fetch(url, { redirect: 'follow', signal: corte });
  } catch (e) {
    return { ok: false, motivo: `no se pudo conectar con Google (${e.message})` };
  }
  if (!res.ok) {
    return {
      ok: false,
      motivo: res.status === 404
        ? 'Google devolvió 404: el id no existe o el archivo se borró'
        : `Google devolvió ${res.status}`,
    };
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (esHtml(buf)) {
    return {
      ok: false,
      motivo: 'Google devolvió una página en vez del archivo. Casi siempre es que no '
        + 'está compartido: abrilo → Compartir → Acceso general → "Cualquiera con el enlace" (Lector)',
    };
  }
  if (!esZip(buf)) {
    return { ok: false, motivo: `lo que bajó no es un .xlsx (${buf.length} bytes)` };
  }

  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, buf);
  return { ok: true, bytes: buf.length };
}

/**
 * Deja lista una fuente en disco: la baja si tiene id de Google, y si eso falla
 * usa la copia anterior. Sólo corta el build cuando no hay ninguna de las dos.
 *
 * @param nombre    para los mensajes ("costos", "postventa")
 * @param id        id o link de Google; vacío = sólo local
 * @param destino   dónde queda el archivo
 * @param opciones  { tipo, obligatoria, log }
 */
export async function resolverFuente(nombre, id, destino, opciones = {}) {
  const { tipo, obligatoria = true, log = console.log } = opciones;
  const hayLocal = fs.existsSync(destino);

  if (!id) {
    if (hayLocal) { log(`· ${nombre}: archivo local (sin id de Google configurado)`); return { ok: true, origen: 'local' }; }
    if (!obligatoria) return { ok: false, origen: 'ninguno' };
    return { ok: false, origen: 'ninguno', motivo: `falta ${path.basename(destino)} y no hay id de Google configurado` };
  }

  const r = await bajarDeGoogle(idDeGoogle(id), destino, { tipo });
  if (r.ok) {
    log(`· ${nombre}: bajado de Google (${(r.bytes / 1024).toFixed(0)} KB)`);
    return { ok: true, origen: 'google', bytes: r.bytes };
  }
  if (hayLocal) {
    const edad = Math.round((Date.now() - fs.statSync(destino).mtimeMs) / 86400000);
    log(`⚠ ${nombre}: ${r.motivo}`);
    log(`  sigo con la copia local, de hace ${edad} día${edad === 1 ? '' : 's'}`);
    return { ok: true, origen: 'local-viejo', motivo: r.motivo, dias: edad };
  }
  return { ok: false, origen: 'ninguno', motivo: r.motivo };
}

/* ================================================================
   Puente de Apps Script
   Las planillas de Naku no se pueden compartir por link: la de compras tiene los
   costos y la de la central, datos de clientes. En vez de abrirlas, un Apps
   Script implementado "como el dueño" las lee con su propio acceso y devuelve
   sólo las columnas que el tablero usa, detrás de un token.
   Ver appsscript/fuentes/Codigo.gs.
   ================================================================ */

/** Una llamada al puente. Devuelve el JSON o tira con un mensaje entendible. */
async function pedirAlPuente(url, token, action, extra = {}, timeoutMs = 120000) {
  const u = new URL(url);
  u.searchParams.set('token', token);
  u.searchParams.set('action', action);
  for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);

  let res;
  try {
    res = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw new Error(`no se pudo conectar con el puente (${e.message})`);
  }
  const texto = await res.text();
  if (texto.trim().startsWith('<')) {
    throw new Error('el puente devolvió HTML en vez de JSON. Suele ser que la '
      + 'implementación quedó con acceso restringido: Implementar → Gestionar '
      + 'implementaciones → Con acceso: "cualquier persona"');
  }
  let j;
  try { j = JSON.parse(texto); } catch { throw new Error(`respuesta ilegible del puente: ${texto.slice(0, 120)}`); }
  if (!j.ok) throw new Error(j.error || 'el puente devolvió un error sin detalle');
  return j;
}

/** ¿Está vivo el puente? Para avisar temprano y con un mensaje claro. */
export async function probarPuente(url, token) {
  try {
    await pedirAlPuente(url, token, 'ping', {}, 30000);
    return { ok: true };
  } catch (e) {
    return { ok: false, motivo: e.message };
  }
}

/**
 * Trae costos y central en una sola llamada.
 * @returns {{costos:{hoja,mes,filas:[[sku,costo]]}, central:{postventa,minorista,volumen}}}
 */
export async function traerDelPuente(url, token, { mes } = {}) {
  const j = await pedirAlPuente(url, token, 'todo', mes ? { mes } : {});
  return { costos: j.costos, central: j.central };
}

/** Lee naku.config.json si existe; devuelve {} si no. */
export function leerConfig(raiz) {
  const p = path.join(raiz, 'naku.config.json');
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    throw new Error(`naku.config.json tiene un error de sintaxis: ${e.message}`);
  }
}
