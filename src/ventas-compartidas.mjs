import { buildMaestro, makeMatcher, ingestMeli, ingestTn } from './engine.mjs';
import { parseMaestro, mergeMaestro, packLines, unpackLines, mergeBuyer, lineKey } from './buyer.mjs';
import { makeCostMatcher } from './costos.mjs';
import { ingestFinanzasMeli, ingestFinanzasTn, verificarMeli } from './finanzas.mjs';
import { armarTablero } from './tablero.mjs';
import { buildPostventa } from './postventa.mjs';

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
  if(operation.central)next.central=operation.central;
  const maestro=operation.maestro?mergeMaestro(buyer.maestro,operation.maestro):buyer.maestro;
  const match=makeMatcher(buildMaestro(parseMaestro(maestro)));
  if(!next.costos?.pares?.length)throw new Error('Falta guardar la planilla de costos desde Finanzas.');
  const costoDe=makeCostMatcher({costo:new Map(next.costos.pares)});
  const mapasMl=[],mapasTn=[],lines=[];
  const replaced=new Set();
  for(const file of sourceFiles(next)) {
    const aoa=[file.header,...file.rows];
    const orderColumn=file.header.indexOf(file.kind==='ml'?'# de venta':'Número de orden');
    for(const row of file.rows)if(String(row[orderColumn]??'').trim())replaced.add((file.kind==='ml'?'MercadoLibre':'TiendaNube')+'|'+String(row[orderColumn]).trim());
    const mapa=(file.kind==='ml'?ingestFinanzasMeli:ingestFinanzasTn)(aoa,costoDe,match);
    if(file.kind==='ml')for(const [mes,a] of mapa)if(!verificarMeli(a).ok)throw new Error(`MercadoLibre no concilia en ${mes}.`);
    (file.kind==='ml'?mapasMl:mapasTn).push(mapa);
    // TN lleva campos de orden sólo en la primera fila de productos.
    let buyerRows=aoa;
    if(file.kind==='tn') {
      let cabecera=null;
      const date=file.header.indexOf('Fecha');
      const product=new Set(['SKU','Nombre del producto','Precio del producto','Cantidad del producto']);
      buyerRows=[file.header,...file.rows.map(row=>{
        if(String(row[date]??'').trim())cabecera=row;
        return row.map((v,i)=>String(v??'').trim()||product.has(file.header[i])?v:(cabecera?.[i]??v));
      })];
    }
    const parsed=(file.kind==='ml'?ingestMeli:ingestTn)(buyerRows,match);
    for(const l of parsed){lines.push(l);replaced.add(l.canal+'|'+l.order_id);}
  }
  // Conserva el histórico antiguo del Buyer para períodos sin export crudo.
  const old=unpackLines(buyer.ventas).filter(l=>!replaced.has(l.canal+'|'+l.order_id));
  const base={...buyer,ventas:packLines(old),maestro};
  const legacy=unpackLines(operation.ventas||packLines([])).filter(l=>!replaced.has(l.canal+'|'+l.order_id));
  const merged=mergeBuyer(base,{...operation,maestro:null,ventas:packLines([...lines,...legacy])});
  let post=finance?.clientes||null;
  if(next.central) {
    const previa=armarTablero({mapasMl,mapasTn});
    if(!previa.ok)throw new Error(previa.error);
    const orders=canal=>Object.fromEntries(previa.tablero.serie.map(s=>[s.mes,previa.tablero.vistas[canal]?.[`mes:${s.mes}`]?.eerr.ordenes||0]));
    const porCanal=Object.fromEntries([['todos','todos'],['ml','Mercado Libre'],['tn','Tienda Nube']].map(([key,channel])=>[key,buildPostventa(next.central.postventa,next.central.minorista,next.central.volumen,orders(key),channel)]));
    post={...porCanal.todos,porCanal};
  }
  const built=armarTablero({mapasMl,mapasTn,post,meta:{fuentes:{...finance?.fuentes,
    costos:{archivo:next.costos.archivo,hoja:next.costos.hoja,mes:next.costos.mes,skus:next.costos.pares.length},
    ventas:{...finance?.fuentes?.ventas,origen:'compartido',meses:[...new Set([...mapasMl,...mapasTn].flatMap(m=>[...m.keys()]))].sort()},
  }}});
  if(!built.ok)throw new Error(built.error);
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
