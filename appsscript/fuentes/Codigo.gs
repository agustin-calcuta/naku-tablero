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
  GESTION_ID: '',

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
  return despachar_(p);
}

function doPost(e) {
  try { return despachar_(JSON.parse(e.postData.contents)); }
  catch (err) { return json({ok:false,error:'Solicitud inválida.'}); }
}

function despachar_(p) {
  try {
    if (!CONFIG.TOKEN) return json({ ok: false, error: 'El script no tiene TOKEN configurado.' });
    if (p.token !== CONFIG.TOKEN) return json({ ok: false, error: 'Token inválido.' });

    switch (p.action) {
      case 'ping':      return json({ ok: true, ping: 'pong', hora: new Date().toISOString() });
      case 'costos':    return json({ ok: true, costos: leerCostos_(p.mes) });
      case 'postventa': return json({ ok: true, central: leerCentral_() });
      case 'todo':      return json({ ok: true, costos: leerCostosCompletos_(), central: leerCentralCompatible_(), gestion: leerGestion_() });
      default:
        return json({ ok: false, error: 'Falta action: ping | costos | postventa | todo' });
    }
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  }
}

// El formato se consulta en Drive: la longitud del ID no identifica un XLSX.
function archivoDrive_(id) {
  if(!id)throw new Error('Falta configurar una de las tres planillas.');
  const base='https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(id);
  const opts={headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()},muteHttpExceptions:true};
  const meta=UrlFetchApp.fetch(base+'?fields=name,mimeType,modifiedTime,capabilities(canDownload)',opts);
  if(meta.getResponseCode()!==200){
    let reason='';try{const e=JSON.parse(meta.getContentText()).error;reason=e.errors&&e.errors[0]&&e.errors[0].reason||e.status||'';}catch(e){}
    throw new Error('No se pudo leer la planilla en Drive ('+meta.getResponseCode()+(reason?'; '+reason:'')+').');
  }
  const data=JSON.parse(meta.getContentText());
  if(data.mimeType==='application/vnd.google-apps.spreadsheet')return {nativa:true,archivo:data.name,actualizado:data.modifiedTime};
  if(data.mimeType!=='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')throw new Error('La fuente no es una planilla compatible: '+data.name);
  if(!data.capabilities||!data.capabilities.canDownload)throw new Error('El propietario no permite descargar '+data.name+'.');
  const res=UrlFetchApp.fetch(base+'?alt=media',opts);
  if(res.getResponseCode()!==200)throw new Error('No se pudo descargar '+data.name+'.');
  const bytes=res.getContent();
  if(bytes.length>30*1024*1024)throw new Error('La planilla supera el límite de 30 MB.');
  return {xlsx:Utilities.base64Encode(bytes),archivo:data.name,actualizado:data.modifiedTime};
}

// SpreadsheetApp.openById exige permiso de escritura incluso para leer. La API
// de Sheets admite spreadsheets.readonly y conserva valores, fechas y fórmulas.
function abrirPlanilla_(id) {
  const book=Sheets.Spreadsheets.get(id,{includeGridData:true,fields:'properties(timeZone),sheets(properties(title,hidden),data(startRow,startColumn,rowData(values(effectiveValue,userEnteredValue,effectiveFormat(numberFormat(type))))))'});
  const sheets=(book.sheets||[]).map(sheet=>{
    const values=[],formulas=[];
    (sheet.data||[]).forEach(grid=>(grid.rowData||[]).forEach((row,r)=>{
      const ri=(grid.startRow||0)+r;
      (row.values||[]).forEach((cell,c)=>{
        const ci=(grid.startColumn||0)+c,e=cell.effectiveValue||{},f=cell.userEnteredValue||{};
        let v=e.numberValue!==undefined?e.numberValue:e.stringValue!==undefined?e.stringValue:e.boolValue!==undefined?e.boolValue:e.errorValue?'#'+e.errorValue.type:'';
        if(typeof v==='number'&&/^DATE(?:_TIME)?$/.test(cell.effectiveFormat&&cell.effectiveFormat.numberFormat&&cell.effectiveFormat.numberFormat.type||''))v=new Date(Math.round((v-25569)*86400000)).toISOString();
        if(v===''&&!f.formulaValue)return;
        if(!values[ri]){values[ri]=[];formulas[ri]=[];}
        values[ri][ci]=v;formulas[ri][ci]=f.formulaValue||'';
      });
    }));
    const width=values.reduce((n,row)=>Math.max(n,row?row.length:0),0);
    for(let r=0;r<values.length;r++){
      values[r]=Array.from({length:width},(_,c)=>values[r]&&values[r][c]!==undefined?values[r][c]:'');
      formulas[r]=Array.from({length:width},(_,c)=>formulas[r]&&formulas[r][c]||'');
    }
    return {getName:()=>sheet.properties.title,isSheetHidden:()=>!!sheet.properties.hidden,getLastRow:()=>values.length,getDataRange:()=>({getValues:()=>values,getFormulas:()=>formulas})};
  });
  return {getSheets:()=>sheets,getSheetByName:name=>sheets.find(s=>s.getName()===name),getSpreadsheetTimeZone:()=>book.properties.timeZone};
}

function leerCostosCompletos_() {
  const meta=archivoDrive_(CONFIG.COSTOS_ID);
  if(!meta.nativa)return meta;
  const ss=abrirPlanilla_(CONFIG.COSTOS_ID);
  const candidatas=ss.getSheets().map(h=>({h:h,mes:mesDeHoja_(h.getName())})).filter(c=>c.mes).sort((a,b)=>b.mes.localeCompare(a.mes));
  const historial=[],omitidas=[];
  candidatas.forEach((c,i)=>{
    try{const parsed=extraerCostos_(c.h,c.mes);if(!parsed.filas.length)throw new Error('No hay costos positivos por SKU en '+c.h.getName());historial.push(parsed);}
    catch(e){if(i===0)throw e;omitidas.push({hoja:c.h.getName(),mes:c.mes,motivo:e.message});}
  });
  if(!historial.length)throw new Error('No hay costos mensuales cargados.');
  return Object.assign({},historial[0],{historial:historial,omitidas:omitidas,archivo:meta.archivo});
}

function leerCentralCompatible_() {
  const meta=archivoDrive_(CONFIG.CENTRAL_ID);
  return meta.nativa?leerCentral_():meta;
}

function leerGestion_() {
  const meta=archivoDrive_(CONFIG.GESTION_ID);
  if(!meta.nativa)return meta;
  const ss=abrirPlanilla_(CONFIG.GESTION_ID),hojas={};
  ss.getSheets().forEach(h=>{
    const range=h.getDataRange(),values=range.getValues(),formulas=range.getFormulas(),celdas={};
    values.forEach((row,r)=>row.forEach((v,c)=>{
      if(v===''&&!formulas[r][c])return;
      let col='',n=c+1;while(n){col=String.fromCharCode(65+(n-1)%26)+col;n=Math.floor((n-1)/26);}
      celdas[col+(r+1)]={v:v instanceof Date?Utilities.formatDate(v,ss.getSpreadsheetTimeZone(),"yyyy-MM-dd'T'HH:mm:ss"):v,f:formulas[r][c]||null};
    }));
    hojas[h.getName()]={celdas:celdas,oculta:h.isSheetHidden()};
  });
  return {archivo:meta.archivo,actualizado:meta.actualizado,hojas:hojas};
}

// Ejecutar una vez al activar. La cuenta debe tener acceso lector a las fuentes.
// API_URL y API_CLAVE se guardan en Propiedades del script, nunca en el tablero.
function instalarSincronizacion() {
  const props=PropertiesService.getScriptProperties();
  if(!props.getProperty('API_URL')||!props.getProperty('API_CLAVE'))throw new Error('Faltan API_URL y API_CLAVE en Propiedades del script.');
  ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()==='sincronizarProgramado').forEach(t=>ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('sincronizarProgramado').timeBased().everyHours(1).create();
}

function sincronizarProgramado() {
  const lock=LockService.getScriptLock();if(!lock.tryLock(1000))return;
  const props=PropertiesService.getScriptProperties();
  try {
    const url=props.getProperty('API_URL'),key=props.getProperty('API_CLAVE');
    if(!/^https:\/\/.+\.neon\.tech$/.test(url||'')||!key)throw new Error('Falta configurar la API compartida.');
    const packed=Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(JSON.stringify({id:Utilities.getUuid()}))).getBytes());
    const res=UrlFetchApp.fetch(url+'/sincronizar',{method:'put',contentType:'application/json',headers:{'x-naku-clave':key},payload:JSON.stringify({datos:packed}),muteHttpExceptions:true});
    if(res.getResponseCode()!==200)throw new Error('Falló la sincronización ('+res.getResponseCode()+'). Se conserva la última versión.');
    props.setProperty('ULTIMA_SINCRONIZACION',new Date().toISOString());props.deleteProperty('ERROR_SINCRONIZACION');
  } catch(e) {props.setProperty('ERROR_SINCRONIZACION',String(e.message));throw e;}
  finally{lock.releaseLock();}
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
  const ss = abrirPlanilla_(CONFIG.COSTOS_ID);

  const candidatas = ss.getSheets()
    .map(function (h) { return { hoja: h, mes: mesDeHoja_(h.getName()) }; })
    .filter(function (x) { return x.mes && (!mes || x.mes === mes); })
    .sort(function (a, b) { return a.mes < b.mes ? 1 : -1; });
  if (!candidatas.length) throw new Error('No encontré una hoja con nombre de mes' + (mes ? ' para ' + mes : ''));

  const elegida = candidatas[0];
  const hoja = elegida.hoja;
  return extraerCostos_(hoja,elegida.mes);
}

function extraerCostos_(hoja,mes) {
  const datos = hoja.getDataRange().getValues();
  const esCosto=c=>/^COSTO(?: D[ÓO]LAR)? SIN IVA$/i.test(String(c||'').trim());

  // Los encabezados no están en la fila 1: se busca la que tenga COSTO SIN IVA.
  var h = -1;
  for (var i = 0; i < Math.min(datos.length, 12); i++) {
    for (var j = 0; j < datos[i].length; j++) {
      if (esCosto(datos[i][j])) { h = i; break; }
    }
    if (h >= 0) break;
  }
  if (h < 0) throw new Error('No encontré la columna "' + COL_COSTO + '" en la hoja ' + hoja.getName());

  const cab = datos[h].map(function (c) { return String(c).trim().toUpperCase(); });
  const iSku = cab.indexOf(COL_SKU);
  const iCosto = cab.findIndex(esCosto);
  if (iSku < 0) throw new Error('No encontré la columna "' + COL_SKU + '"');

  const filas = [];
  for (var r = h + 1; r < datos.length; r++) {
    const sku = String(datos[r][iSku] || '').trim();
    if (!sku) continue;
    const costo = Number(datos[r][iCosto]);
    if (!isFinite(costo) || costo <= 0) continue;   // 0 = todavía sin costear
    filas.push([sku, costo]);
  }

  return { hoja: hoja.getName(), mes: mes, filas: filas };
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
  const nombres=['Postventa','Preventa Minorista','Preventa Volumen'];
  const response=Sheets.Spreadsheets.Values.batchGet(CONFIG.CENTRAL_ID,{
    ranges:nombres.map(n=>"'"+n+"'"),valueRenderOption:'UNFORMATTED_VALUE',dateTimeRenderOption:'SERIAL_NUMBER'
  });
  const rows=(response.valueRanges||[]).map(h=>h.values||[]);
  return {
    postventa: datosRecortados_(rows[0], CAMPOS_POSTVENTA),
    minorista: datosRecortados_(rows[1], CAMPOS_MINORISTA),
    volumen: datosRecortados_(rows[2], CAMPOS_VOLUMEN)
  };
}

function hojaRecortada_(ss, nombre, campos) {
  const hoja = ss.getSheetByName(nombre);
  if (!hoja || hoja.getLastRow() < 1) return [campos];

  return datosRecortados_(hoja.getDataRange().getValues(),campos);
}

function datosRecortados_(datos,campos) {
  if(!datos||!datos.length)throw new Error('Una hoja de la central no tiene encabezados.');
  const cab = datos[0].map(function (c) { return String(c).trim(); });
  const idx = campos.map(function (c) { return cab.indexOf(c); });
  if(idx[0]<0)throw new Error('Una hoja de la central no tiene la columna Caso.');

  const salida = [campos.slice()];
  for (var r = 1; r < datos.length; r++) {
    if (!String(datos[r][idx[0]] || '').trim()) continue;    // fila sin caso
    salida.push(idx.map(function (i,c) {
      if (i < 0) return '';
      const v = datos[r][i];
      if(typeof v==='number'&&/fecha|alta|ingreso|contactado|respondido|seguimiento|actualizaci/i.test(campos[c]))return new Date(Math.round((v-25569)*86400000)).toISOString();
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
    const c = leerCostosCompletos_();
    informe.push(c.xlsx?'✓ costos: Excel accesible; el servidor normaliza sus hojas.':'✓ costos: '+c.historial.length+' meses con costos por SKU.');
  } catch (e) {
    informe.push('✗ costos: ' + e.message);
  }

  try {
    const k = leerCentralCompatible_();
    informe.push(k.xlsx?'✓ central: Excel accesible.':'✓ central: ' + (k.postventa.length - 1) + ' casos de postventa, '
      + (k.minorista.length - 1) + ' de preventa minorista, '
      + (k.volumen.length - 1) + ' de volumen');
  } catch (e) {
    informe.push('✗ central: ' + e.message);
  }

  try {const g=leerGestion_();informe.push(g.xlsx?'✓ gestión: Excel accesible.':'✓ gestión: '+Object.keys(g.hojas).length+' pestañas accesibles.');}
  catch(e){informe.push('✗ gestión: '+e.message);}

  const msg = informe.join('\n');
  Logger.log(msg);
  return msg;
}
