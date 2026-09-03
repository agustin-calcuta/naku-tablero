/**
 * NAKU · Fuentes del tablero de dirección
 *
 * Un puente de sólo lectura entre las planillas de Naku y el build del tablero.
 *
 * POR QUÉ ESTO Y NO COMPARTIR LAS PLANILLAS
 * La planilla de compras tiene los costos y la de la central tiene datos de
 * clientes: ninguna se puede poner en "cualquiera con el enlace". Este script se
 * implementa **ejecutándose como vos**, así que lee las planillas con tu propio
 * acceso y nadie más las ve. Afuera sólo queda una URL con un token, que además
 * devuelve nada más que las columnas que el tablero usa — ni teléfonos, ni
 * direcciones, ni nombres de clientes.
 *
 * INSTALACIÓN (una vez, ~10 minutos)
 *   1. script.google.com → Nuevo proyecto → nombralo "Naku · Fuentes del tablero".
 *   2. Pegá este archivo como Codigo.gs.
 *   3. Completá CONFIG de abajo: los dos ids y un TOKEN inventado (largo, al azar).
 *   4. Ejecutá `probar` una vez: Google va a pedir permisos, aceptá. En el registro
 *      tenés que ver los SKU y los casos que encontró.
 *   5. Implementar → Nueva implementación → Aplicación web:
 *        Ejecutar como: **yo**
 *        Con acceso:    **cualquier persona**   ← el token es el que protege
 *      Copiá la URL que termina en /exec.
 *   6. En la compu donde corrés el tablero:
 *        export NAKU_FUENTES_URL="https://…/exec"
 *        export NAKU_FUENTES_TOKEN="el token que inventaste"
 *      (o ponelos en naku.config.json → "fuentes")
 *
 * Después de eso, `npm run actualizar` trae costos y postventa solo.
 *
 * SI CAMBIÁS EL CÓDIGO hay que volver a implementar (Implementar → Gestionar
 * implementaciones → editar → Versión: nueva). Si no, sigue corriendo la vieja.
 */

const CONFIG = {
  // Planilla madre de compras. El id sale del link:
  // docs.google.com/spreadsheets/d/ESTE_ID/edit
  COSTOS_ID: '',

  // Sheet de la central de atención (postventa y preventa).
  CENTRAL_ID: '',

  // Inventado, largo y al azar. Es lo único que separa la URL de cualquiera que
  // la encuentre; que no sea "naku123".
  TOKEN: '',
};

/** Columna de la planilla de compras que tiene el costo unitario sin IVA. */
const COL_COSTO = 'COSTO SIN IVA';
const COL_SKU = 'SKU: NAKU';

/** Las únicas columnas de la central que salen de acá. El resto no se expone. */
const CAMPOS_POSTVENTA = ['Caso', 'Ingreso del mensaje', 'Alta del caso', 'Urgencia',
  'Canal de venta', 'Tipo de reclamo', 'SKU', '3· Contactado', '5· Accionable',
  'Área derivada', '7· Estatus', 'Fecha de cierre', 'Último responsable', 'Última actualización'];
const CAMPOS_MINORISTA = ['Caso', 'Alta del caso', 'Origen', 'Canal de comunicación',
  'SKU consultado', '2· Respondido', '3· Seguimiento', 'Estatus', 'Motivo de pérdida',
  'Fecha de cierre', 'Última actualización'];
const CAMPOS_VOLUMEN = ['Caso', 'Alta del caso', 'Tipo de cliente', 'Canal de comunicación',
  'SKU', 'Cantidad estimada por SKU', '4· Cotización', 'Monto cotizado', '6· Estatus',
  'Motivo de pérdida', 'Fecha de cierre', 'Última actualización'];

/* ------------------------------------------------------------------ */
/* Endpoint                                                            */
/* ------------------------------------------------------------------ */

function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    if (!CONFIG.TOKEN) return json({ ok: false, error: 'El script no tiene TOKEN configurado.' });
    if (p.token !== CONFIG.TOKEN) return json({ ok: false, error: 'Token inválido.' });

    switch (p.action) {
      case 'ping':      return json({ ok: true, ping: 'pong', hora: new Date().toISOString() });
      case 'costos':    return json({ ok: true, costos: leerCostos_(p.mes) });
      case 'postventa': return json({ ok: true, central: leerCentral_() });
      case 'todo':      return json({ ok: true, costos: leerCostos_(p.mes), central: leerCentral_() });
      default:
        return json({ ok: false, error: 'Falta action: ping | costos | postventa | todo' });
    }
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ------------------------------------------------------------------ */
/* Costos                                                              */
/* ------------------------------------------------------------------ */

const MESES_HOJA = {
  ENERO: 1, FEBRERO: 2, MARZO: 3, ABRIL: 4, MAYO: 5, JUNIO: 6,
  JULIO: 7, AGOSTO: 8, SEPTIEMBRE: 9, OCTUBRE: 10, NOVIEMBRE: 11, DICIEMBRE: 12
};

/** 'JULIO 2026' → '2026-07'. Vacío si el nombre no es un mes limpio. */
function mesDeHoja_(nombre) {
  const m = /^([A-ZÁÉÍÓÚ]+)\s+(\d{4})$/.exec(String(nombre).trim().toUpperCase());
  if (!m || !MESES_HOJA[m[1]]) return '';
  return m[2] + '-' + ('0' + MESES_HOJA[m[1]]).slice(-2);
}

/**
 * Costo unitario sin IVA por SKU. Sin `mes`, usa la hoja más nueva.
 * Las columnas se buscan por nombre: la planilla suma columnas de embarque
 * seguido y los índices se corren.
 */
function leerCostos_(mes) {
  if (!CONFIG.COSTOS_ID) throw new Error('Falta COSTOS_ID en CONFIG.');
  const ss = SpreadsheetApp.openById(CONFIG.COSTOS_ID);

  const candidatas = ss.getSheets()
    .map(function (h) { return { hoja: h, mes: mesDeHoja_(h.getName()) }; })
    .filter(function (x) { return x.mes && (!mes || x.mes === mes); })
    .sort(function (a, b) { return a.mes < b.mes ? 1 : -1; });
  if (!candidatas.length) throw new Error('No encontré una hoja con nombre de mes' + (mes ? ' para ' + mes : ''));

  const elegida = candidatas[0];
  const hoja = elegida.hoja;
  const datos = hoja.getDataRange().getValues();

  // Los encabezados no están en la fila 1: se busca la que tenga COSTO SIN IVA.
  var h = -1;
  for (var i = 0; i < Math.min(datos.length, 12); i++) {
    for (var j = 0; j < datos[i].length; j++) {
      if (String(datos[i][j]).trim().toUpperCase() === COL_COSTO) { h = i; break; }
    }
    if (h >= 0) break;
  }
  if (h < 0) throw new Error('No encontré la columna "' + COL_COSTO + '" en la hoja ' + hoja.getName());

  const cab = datos[h].map(function (c) { return String(c).trim().toUpperCase(); });
  const iSku = cab.indexOf(COL_SKU);
  const iCosto = cab.indexOf(COL_COSTO);
  if (iSku < 0) throw new Error('No encontré la columna "' + COL_SKU + '"');

  const filas = [];
  for (var r = h + 1; r < datos.length; r++) {
    const sku = String(datos[r][iSku] || '').trim();
    if (!sku) continue;
    const costo = Number(datos[r][iCosto]);
    if (!isFinite(costo) || costo <= 0) continue;   // 0 = todavía sin costear
    filas.push([sku, costo]);
  }

  return { hoja: hoja.getName(), mes: elegida.mes, filas: filas };
}

/* ------------------------------------------------------------------ */
/* Central de atención                                                 */
/* ------------------------------------------------------------------ */

/**
 * Las tres hojas de la central, recortadas a las columnas que el tablero usa.
 * Devuelve arrays con el encabezado en la primera fila, igual que un export.
 */
function leerCentral_() {
  if (!CONFIG.CENTRAL_ID) throw new Error('Falta CENTRAL_ID en CONFIG.');
  const ss = SpreadsheetApp.openById(CONFIG.CENTRAL_ID);
  return {
    postventa: hojaRecortada_(ss, 'Postventa', CAMPOS_POSTVENTA),
    minorista: hojaRecortada_(ss, 'Preventa Minorista', CAMPOS_MINORISTA),
    volumen: hojaRecortada_(ss, 'Preventa Volumen', CAMPOS_VOLUMEN)
  };
}

function hojaRecortada_(ss, nombre, campos) {
  const hoja = ss.getSheetByName(nombre);
  if (!hoja || hoja.getLastRow() < 1) return [campos];

  const datos = hoja.getDataRange().getValues();
  const cab = datos[0].map(function (c) { return String(c).trim(); });
  const idx = campos.map(function (c) { return cab.indexOf(c); });

  const salida = [campos.slice()];
  for (var r = 1; r < datos.length; r++) {
    if (!String(datos[r][0] || '').trim()) continue;    // fila sin caso
    salida.push(idx.map(function (i) {
      if (i < 0) return '';
      const v = datos[r][i];
      // Las fechas viajan en ISO: el JSON de Apps Script las serializa distinto
      // según la zona horaria del proyecto y se desfasaban un día.
      return (v instanceof Date) ? v.toISOString() : v;
    }));
  }
  return salida;
}

/* ------------------------------------------------------------------ */
/* Diagnóstico                                                         */
/* ------------------------------------------------------------------ */

/** Ejecutala una vez desde el editor: autoriza los permisos y verifica todo. */
function probar() {
  const informe = [];

  if (!CONFIG.TOKEN) informe.push('✗ falta el TOKEN en CONFIG');
  else informe.push('✓ token configurado (' + CONFIG.TOKEN.length + ' caracteres)');

  try {
    const c = leerCostos_();
    informe.push('✓ costos: hoja "' + c.hoja + '" (' + c.mes + ') — ' + c.filas.length + ' SKU con costo');
    if (c.filas.length) informe.push('    ejemplo: ' + c.filas[0][0] + ' = ' + c.filas[0][1]);
  } catch (e) {
    informe.push('✗ costos: ' + e.message);
  }

  try {
    const k = leerCentral_();
    informe.push('✓ central: ' + (k.postventa.length - 1) + ' casos de postventa, '
      + (k.minorista.length - 1) + ' de preventa minorista, '
      + (k.volumen.length - 1) + ' de volumen');
  } catch (e) {
    informe.push('✗ central: ' + e.message);
  }

  const msg = informe.join('\n');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { /* sin planilla abierta */ }
  return msg;
}
