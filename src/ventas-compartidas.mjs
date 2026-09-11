import { buildMaestro, makeMatcher } from './engine.mjs';
import { parseMaestro, mergeMaestro, packLines, unpackLines, mergeBuyer, lineKey } from './buyer.mjs';
import { makeCostMatcher } from './costos.mjs';
import { matcherCostosHistoricos } from './costos.mjs';
import { construirGestion, validarCategoriasGastos } from './gestion.mjs';
import { recortarCentral } from './fuentes-sync.mjs';
import { ingestFinanzasMeli, ingestFinanzasTn, verificarMeli } from './finanzas.mjs';
import { armarTablero } from './tablero.mjs';
import { buildPostventa, postventaMensual } from './postventa.mjs';

// Sólo columnas consumidas por los motores. No guardamos direcciones, DNI,
// teléfonos ni emails de los exports de ventas.
const ML = ['# de venta','Fecha de venta','Estado','Ciudad','Descripción del estado','Unidades','SKU','Ingresos por productos (ARS)','Cargo por venta','Costo fijo','Costo por ofrecer cuotas','Cargo por venta e impuestos (ARS)','Ingresos por envío (ARS)','Costos de envío (ARS)','Impuestos','Descuentos y bonificaciones','Anulaciones y reembolsos (ARS)','Total (ARS)','Título de la publicación','Forma de entrega','Precio unitario de venta de la publicación (ARS)'];
const TN = ['Número de orden','Fecha','Estado de la orden','Estado del pago','SKU','Precio del producto','Cantidad del producto','Subtotal de productos','Descuento','Costo de envío','Total','Reembolso','Costo de procesamiento','Interés por cuotas','Impuestos','Total neto','Nombre del producto','Medio de envío','Provincia o estado','Cantidad de cuotas'];

export function cleanExport(kind, aoa, nombre='Export') {
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
export function exportOrders(file) {
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

export function mergeSources(current, exports) {
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

export function sourceFiles(sources) {
  const schemas=new Map();
  for(const [,group] of sources.orders||[]) {
    const key=group.schema;
    if(!schemas.has(key))schemas.set(key,{...sources.schemas[key],rows:[]});
    schemas.get(key).rows.push(...group.rows);
  }
  return [...schemas.values()];
}

export function buildShared(buyer, sources, operation, finance) {
  const next=mergeSources(sources,operation.exports);
  if(operation.costos)next.costos=operation.costos;
  if(operation.central)next.central=recortarCentral(operation.central);
  if(operation.gestion)next.gestion=operation.gestion;
  if(operation.gastosCategorias!==undefined)next.gastosCategorias={...next.gastosCategorias,...validarCategoriasGastos(operation.gastosCategorias)};
  if((operation.costos||operation.central||operation.gestion)&&!operation.sincronizacion)next.sincronizacion=null;
  if(operation.sincronizacion)next.sincronizacion=operation.sincronizacion;
  const maestro=operation.maestro?mergeMaestro(buyer.maestro,operation.maestro):buyer.maestro;
  const match=makeMatcher(buildMaestro(parseMaestro(maestro)));
  if(!next.costos?.pares?.length&&!next.gestion)throw new Error('Falta guardar la planilla de costos o gestión desde Finanzas.');
  // Se preserva el cálculo anterior si sólo hay un costo importado. La nueva
  // conexión trae el historial y elige la vigencia de cada mes.
  const costoDe=next.costos?.historial?matcherCostosHistoricos(next.costos):makeCostMatcher({costo:new Map(next.costos?.pares||[])});
  const mapasMl=[],mapasTn=[],lines=[];
  const replaced=new Set();
  for(const file of sourceFiles(next)) {
    const aoa=[file.header,...file.rows];
    const orderColumn=file.header.indexOf(file.kind==='ml'?'# de venta':'Número de orden');
    for(const row of file.rows)if(String(row[orderColumn]??'').trim())replaced.add((file.kind==='ml'?'MercadoLibre':'TiendaNube')+'|'+String(row[orderColumn]).trim());
    const mapa=(file.kind==='ml'?ingestFinanzasMeli:ingestFinanzasTn)(aoa,costoDe,match,l=>lines.push(l));
    if(file.kind==='ml')for(const [mes,a] of mapa)if(!verificarMeli(a).ok)throw new Error(`MercadoLibre no concilia en ${mes}.`);
    (file.kind==='ml'?mapasMl:mapasTn).push(mapa);
  }
  // El histórico sin export se conserva separado: no se puede presentar como
  // ventas netas ni mezclar con los totales que comparte Dirección.
  const old=[...unpackLines(buyer.ventas),...unpackLines(buyer.legacyVentas||packLines([]))]
    .filter(l=>!replaced.has(l.canal+'|'+l.order_id));
  const base={...buyer,ventas:packLines(old),maestro};
  const legacy=unpackLines(operation.ventas||packLines([])).filter(l=>!replaced.has(l.canal+'|'+l.order_id));
  const merged=mergeBuyer(base,{...operation,maestro:null,ventas:packLines(legacy)});
  merged.data.legacyVentas=merged.data.ventas;
  // Las fuentes ya deduplicaron por orden completa. No deduplicar productos
  // idénticos dentro de una orden: pueden ser dos unidades realmente vendidas.
  merged.data.ventas=packLines(lines);
  let post=finance?.clientes||null;
  if(next.central) {
    const previa=armarTablero({mapasMl,mapasTn});
    if(!previa.ok&&!next.gestion)throw new Error(previa.error);
    const orders=canal=>Object.fromEntries((previa.tablero?.serie||[]).map(s=>[s.mes,previa.tablero.vistas[canal]?.[`mes:${s.mes}`]?.eerr.ordenes||0]));
    const porCanal=Object.fromEntries([['todos','todos'],['ml','Mercado Libre'],['tn','Tienda Nube']].map(([key,channel])=>[key,buildPostventa(next.central.postventa,next.central.minorista,next.central.volumen,orders(key),channel)]));
    post={...porCanal.todos,porCanal};
  }
  const built=armarTablero({mapasMl,mapasTn,post,meta:{fuentes:{...finance?.fuentes,
    costos:{archivo:next.costos?.archivo,hoja:next.costos?.hoja||'Sin costos por SKU',mes:next.costos?.mes,skus:next.costos?.pares?.length||0,historicos:!!next.costos?.historial,omitidas:next.costos?.omitidas||[]},
    ventas:{...finance?.fuentes?.ventas,origen:'compartido',meses:[...new Set([...mapasMl,...mapasTn].flatMap(m=>[...m.keys()]))].sort()},
  }}});
  if(!built.ok&&!next.gestion)throw new Error(built.error);
  if(!built.ok)built.tablero={generado:new Date().toISOString().slice(0,10),iva:0.21,serie:[],vistas:{},periodos:[],mesesCargados:[],canales:[],clientes:post,fuentes:{costos:{hoja:next.costos?.hoja||'Sin costos por SKU'}}};
  if(next.gestion){
    built.tablero.gestion=construirGestion(next.gestion,{categoriasGastos:next.gastosCategorias});
    built.tablero.gestion.postventa=next.central?postventaMensual(next.central):null;
    built.tablero.gestion.conciliacion=Object.entries(built.tablero.gestion.meses).flatMap(([mes,m])=>['ml','tn'].map(c=>{
      const v=built.tablero.vistas[c]?.['mes:'+mes]?.eerr.lineas.find(l=>l.c==='Ventas netas')?.v??null;
      const planilla=m.canales[c]?.ventas??null;
      return {mes,canal:c,planilla,detalle:v,diferencia:planilla!==null&&v!==null?planilla-v:null};
    }));
  }
  built.tablero.sincronizacion=next.sincronizacion||null;
  merged.data.metrica='ventas-netas-sin-iva-v1';
  merged.data.periodos=built.tablero.periodos;
  merged.data.mesesCargados=built.tablero.mesesCargados.map(m=>m.mes);
  merged.data.mesesParciales=built.tablero.serie.filter(m=>m.parcial).map(m=>m.mes);
  verificarCompradores(lines,built.tablero);
  const before=new Set(unpackLines(buyer.ventas).map(l=>[l.canal,l.order_id,l.sku].join('|')));
  const originalLines=new Map(unpackLines(buyer.ventas).map(l=>[lineKey(l),l]));
  merged.result.cambios=unpackLines(merged.data.ventas).filter(l=>{
    const old=originalLines.get(lineKey(l));return old&&(old.buyer!==l.buyer||old.familia!==l.familia);
  }).length;
  merged.result.nuevas=unpackLines(merged.data.ventas).filter(l=>!before.has([l.canal,l.order_id,l.sku].join('|'))).length;
  merged.result.dups=next.result.ordersRepeated;
  merged.result.actualizadas=next.result.ordersUpdated;
  Object.assign(merged.data.manifest.at(-1),merged.result);
  return {buyer:merged.data,sources:next,finance:built.tablero,result:merged.result};
}

// Una publicación se rechaza si los totales comerciales dejan de coincidir.
// Compara cada mes/canal y cada período, antes de guardar los dos tableros.
export function verificarCompradores(lines,finance) {
  const monthly=new Map();
  for(const l of lines) {
    if(l.billable===false)continue;
    const key=l.canal+'|'+l.mes;
    if(!monthly.has(key))monthly.set(key,{facturacion:0,unidades:0,ordenes:new Set()});
    const t=monthly.get(key);
    t.facturacion+=l.facturacion;t.unidades+=l.unidades;t.ordenes.add(l.canal+'|'+l.order_id);
  }
  for(const [canal,vistas] of Object.entries(finance.vistas))for(const [periodo,vista] of Object.entries(vistas)) {
    const canales=canal==='todos'?['MercadoLibre','TiendaNube']:[canal==='ml'?'MercadoLibre':'TiendaNube'];
    const total={facturacion:0,unidades:0,ordenes:new Set()};
    for(const mes of vista.meses)for(const c of canales) {
      const m=monthly.get(c+'|'+mes);if(!m)continue;
      total.facturacion+=m.facturacion;total.unidades+=m.unidades;
      for(const id of m.ordenes)total.ordenes.add(id);
    }
    const venta= vista.eerr.lineas.find(l=>l.c==='Ventas netas').v;
    if(Math.abs(total.facturacion-venta)>0.02||total.unidades!==vista.eerr.unidades||total.ordenes.size!==vista.eerr.ordenes)
      throw new Error(`Compradores y Dirección no coinciden en ${canal}, ${periodo}. No se guardaron los datos.`);
  }
}
