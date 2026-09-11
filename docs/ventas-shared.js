window.NakuBuyer=(function({buildMaestro,makeMatcher,normSku}){
// Datos compartidos del Buyer. Se usa sin cambios en navegador y servidor.

const BUYER_COLS = ['canal','order_id','mes','buyer','familia','nombre','sku','sku_raw','unidades','facturacion','cuotas','envio','billable','provincia'];

function parseCSV(text, delimiter) {
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

function parseMaestro(text) {
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

function mergeMaestro(previous, incoming) {
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

function lineKey(l) {
  return [l.canal,l.order_id,l.sku,l.unidades,l.facturacion].join('|');
}

function packLines(lines) {
  return { cols: BUYER_COLS, rows: lines.map(l => BUYER_COLS.map(c => l[c] ?? null)) };
}

function unpackLines(data) {
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
function buyerPeriodMonths(data, preset) {
  const months=data.mesesCargados||[];
  if(preset==='1')return months.slice(-1);
  const id=({all:'rango','3':'m3','6':'m6',ytd:'anio'})[preset];
  return data.periodos?.find(p=>p.id===id)?.meses||months;
}

function mergeBuyer(current, operation) {
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

return {BUYER_COLS,parseCSV,parseMaestro,packLines,unpackLines,lineKey,mergeMaestro,mergeBuyer,buyerPeriodMonths};})(window.NakuMotor?.engine||window);
window.NakuVentas=(()=>{

// Sólo columnas consumidas por los motores. No guardamos direcciones, DNI,
// teléfonos ni emails de los exports de ventas.
const ML = ['# de venta','Fecha de venta','Estado','Ciudad','Descripción del estado','Unidades','SKU','Ingresos por productos (ARS)','Cargo por venta','Costo fijo','Costo por ofrecer cuotas','Cargo por venta e impuestos (ARS)','Ingresos por envío (ARS)','Costos de envío (ARS)','Impuestos','Descuentos y bonificaciones','Anulaciones y reembolsos (ARS)','Total (ARS)','Título de la publicación','Forma de entrega','Precio unitario de venta de la publicación (ARS)'];
const TN = ['Número de orden','Fecha','Estado de la orden','Estado del pago','SKU','Precio del producto','Cantidad del producto','Subtotal de productos','Descuento','Costo de envío','Total','Reembolso','Costo de procesamiento','Interés por cuotas','Impuestos','Total neto','Nombre del producto','Medio de envío','Provincia o estado','Cantidad de cuotas'];

function cleanExport(kind, aoa, nombre='Export') {
  if(!['ml','tn'].includes(kind)||!Array.isArray(aoa))throw new Error('Export inválido.');
  const headerAt=kind==='ml'?aoa.slice(0,12).findIndex(r=>r?.some(c=>String(c).trim()==='# de venta')):0;
  if(headerAt<0)throw new Error('No se encontró el encabezado de MercadoLibre.');
  const original=(aoa[headerAt]||[]).map(h=>String(h??'').trim().replace(/^\uFEFF/,''));
  const allowed=kind==='ml'?ML:TN;
  const indices=original.map((h,i)=>allowed.includes(h)?i:-1).filter(i=>i>=0);
  const header=indices.map(i=>original[i]);
  const required=kind==='ml'?['# de venta','Fecha de venta','SKU','Ingresos por productos (ARS)','Total (ARS)']:['Número de orden','Fecha','SKU','Precio del producto','Cantidad del producto','Subtotal de productos'];
  for(const h of required)if(!header.includes(h))throw new Error(`Falta la columna "${h}" en ${nombre}.`);
  const rows=aoa.slice(headerAt+1).filter(r=>r?.some(c=>String(c??'').trim())).map(r=>indices.map(i=>original[i]==='Ciudad'?'':r[i]??''));
  return {kind,nombre:String(nombre).slice(0,240),header,rows};
}

// Una orden de TN incluye todos sus productos; un paquete de ML conserva la
// cabecera monetaria y sus hijos. Se reemplazan juntos en exports superpuestos.
function exportOrders(file) {
  const {kind,header,rows}=file;
  const id=header.indexOf(kind==='ml'?'# de venta':'Número de orden');
  const state=header.indexOf('Estado');
  const groups=new Map();let active=null;
  for(let i=0;i<rows.length;i++) {
    const row=rows[i], order=String(row[id]??'').trim();
    if(kind==='ml') {
      if(!order)continue;
      const count=Number(/^Paquete de (\d+) productos/i.exec(String(row[state]))?.[1]||0);
      if(count>0&&i+count>=rows.length)throw new Error('Paquete de MercadoLibre incompleto.');
      const group=rows.slice(i,i+count+1);i+=count;
      const key='ml:'+order;
      if(groups.has(key))groups.get(key).rows.push(...group);
      else groups.set(key,{kind,header,rows:group});
    } else {
      if(order)active='tn:'+order;
      if(!active)throw new Error('TiendaNube tiene un producto sin cabecera de orden.');
      if(!groups.has(active))groups.set(active,{kind,header,rows:[]});
      groups.get(active).rows.push(row);
    }
  }
  return groups;
}

function mergeSources(current, exports) {
  const orders=new Map(current.orders||[]);
  const schemas=[...(current.schemas||[])];
  let added=0,updated=0,repeated=0;
  for(const input of exports||[]) {
    const file=cleanExport(input.kind,[input.header,...input.rows],input.nombre);
    let schema=schemas.findIndex(s=>s.kind===file.kind&&JSON.stringify(s.header)===JSON.stringify(file.header));
    if(schema<0){schema=schemas.length;schemas.push({kind:file.kind,header:file.header});}
    for(const [key,group] of exportOrders(file)) {
      const stored={schema,rows:group.rows};
      if(!orders.has(key))added++;
      else if(JSON.stringify(orders.get(key))!==JSON.stringify(stored))updated++;
      else repeated++;
      orders.set(key,stored);
    }
  }
  return {...current,schemas,orders:[...orders],result:{ordersAdded:added,ordersUpdated:updated,ordersRepeated:repeated}};
}

function sourceFiles(sources) {
  const schemas=new Map();
  for(const [,group] of sources.orders||[]) {
    const key=group.schema;
    if(!schemas.has(key))schemas.set(key,{...sources.schemas[key],rows:[]});
    schemas.get(key).rows.push(...group.rows);
  }
  return [...schemas.values()];
}


return {cleanExport};})();
// Transporte del Buyer: la base compartida es la fuente de datos.
// IndexedDB se consulta únicamente para rescatar cargas de la versión anterior.
window.NakuBuyerSync = (() => {
  const api = 'https://br-wispy-lake-ayf0dl28-buyer.compute.c-5.us-east-2.aws.neon.tech';
  let key = '';
  const stored = name => { try { return localStorage.getItem(name) || ''; } catch { return ''; } };
  key = stored('naku.buyer.clave') || stored('naku.clave');
  const fragment = new URLSearchParams(location.hash.slice(1));
  if(fragment.has('clave')) {
    key=fragment.get('clave');
    setKey(key);
    history.replaceState(null,'',location.pathname+location.search);
  }
  function setKey(value) {
    key=value;
    try { localStorage.setItem('naku.buyer.clave',key); } catch { /* funciona también sin storage */ }
  }
  async function encode(data) {
    const bytes=new Uint8Array(await new Response(new Blob([JSON.stringify(data)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
    let binary='';
    for(let i=0;i<bytes.length;i+=32768) binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
    return btoa(binary);
  }
  async function decode(data) {
    const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));
    return JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
  }
  async function request(path='',operation) {
    const r=await fetch(api+path,{
      method:operation?'PUT':'GET',headers:{'x-naku-clave':key,...(operation?{'content-type':'application/json'}:{})},
      body:operation?JSON.stringify({datos:await encode(operation)}):undefined,
      signal:AbortSignal.timeout(path==='/sincronizar'?180000:operation?90000:45000),cache:'no-store'
    });
    const data=await r.json();
    if(!r.ok) throw Object.assign(new Error(data.error||'No se pudo acceder al Buyer.'),{status:r.status});
    if(data.datos) data.data=await decode(data.datos);
    return data;
  }
  return {request,setKey,hasKey:()=>Boolean(key)};
})();
