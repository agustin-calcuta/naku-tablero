// Cierre mensual desde las planillas de administración. Sin dependencia de exports.
// Conserva valores, fórmulas y referencias; nunca evalúa fórmulas como JavaScript.
const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const norm = v => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase().replace(/\s+/g,' ');
const numero = v => typeof v === 'number' && Number.isFinite(v) ? v : null;
const suma = a => a.reduce((s,v)=>s+(numero(v)??0),0);
const completa = a => a.every(v=>numero(v)!==null) ? suma(a) : null;
const red = n => numero(n)===null ? null : Math.round((n+Number.EPSILON)*100)/100;
const pct = (v,b) => numero(v)!==null && numero(b)!==null && b!==0 ? 100*v/b : null;
export const CATEGORIAS_GASTOS = [
  {id:'personal',nombre:'Personal',detalle:'Sueldos y cargas sociales'},
  {id:'servicios',nombre:'Servicios',detalle:'Agua, luz, gas, internet y telefonía'},
  {id:'instalaciones',nombre:'Instalaciones y mantenimiento',detalle:'Alquileres, expensas y mantenimiento'},
  {id:'tecnologia',nombre:'Tecnología y sistemas',detalle:'Software, licencias y herramientas de venta'},
  {id:'marketing',nombre:'Marketing y ventas',detalle:'Agencias, publicidad y comisiones comerciales'},
  {id:'logistica',nombre:'Logística e importación',detalle:'Depósito, preparación, entregas y descargas'},
  {id:'administracion',nombre:'Administración y asesoría',detalle:'Honorarios, consultoría y seguros'},
  {id:'impuestos',nombre:'Impuestos',detalle:'Tributos, tasas e Ingresos Brutos'},
  {id:'pendiente',nombre:'Sin mapear',detalle:'Conceptos cuyo destino falta confirmar'},
];

// Las equivalencias propias del cliente se guardan en la base privada, nunca
// en el código público. Un nombre de persona o proveedor no implica un rubro.
export function validarCategoriasGastos(mapa={}) {
  if(!mapa||typeof mapa!=='object'||Array.isArray(mapa)||Object.keys(mapa).length>500)throw new Error('Clasificación de gastos inválida.');
  const ids=new Set(CATEGORIAS_GASTOS.map(c=>c.id)),out={};
  for(const [nombre,id] of Object.entries(mapa)) {
    const clave=norm(nombre);
    if(!clave||clave.length>200||['__proto__','constructor','prototype'].includes(clave)||!ids.has(id))throw new Error('Categoría de gasto inválida.');
    out[clave]=id;
  }
  return out;
}

export function categoriaGasto(concepto,mapa={}) {
  const n=norm(concepto);
  if(Object.hasOwn(mapa,n))return mapa[n];
  const reglas=[
    ['personal',/\b(sueldos?|salarios?|suss|sindicato|cargas sociales|aguinaldos?)\b/],
    ['servicios',/\b(agua|luz|gas|electricidad|internet|telefonia|edenor|edesur|aysa|claro|metrotel|flow)\b/],
    ['instalaciones',/\b(alquiler|expensas|mantenimiento|reparaciones)\b/],
    ['tecnologia',/\b(software|licencias|sistemas|hosting)\b/],
    ['marketing',/\b(pauta|publicidad|marketing|comisiones|agencia)\b/],
    ['logistica',/\b(logistica|entregas|descargas|fletes|picking|contenedores)\b/],
    ['administracion',/\b(honorarios|consultoria|asesoria|seguros)\b/],
    ['impuestos',/\b(iibb|abl|impuestos|tributos|tasas)\b/],
  ];
  return reglas.find(([,re])=>re.test(n))?.[0]||'pendiente';
}

export function resumenGastos(gestion,meses) {
  const mapa=gestion.gastosCategorias||{};
  const agrupar=periodo=>{
    const grupos=new Map(CATEGORIAS_GASTOS.map(c=>[c.id,{...c,importe:0,cargados:0,sinImporte:0,conceptos:new Set()}]));
    let completo=true;
    for(const mes of periodo)for(const tipo of ['fijos','variables']) {
      const bloque=gestion.meses[mes]?.[tipo];
      if(!bloque?.items?.length)completo=false;
      for(const item of bloque?.items||[]) {
        const g=grupos.get(categoriaGasto(item.concepto,mapa));
        g.conceptos.add(norm(item.concepto));
        if(numero(item.importe)===null)g.sinImporte++;
        else {g.importe+=item.importe;g.cargados++;}
      }
    }
    return {grupos,completo};
  };
  const actuales=[...new Set(meses)].sort(),primero=actuales[0];
  if(!primero)return {items:[],total:null,anteriores:[],sinImporte:0};
  // Mismo número de meses inmediatamente anteriores al rango elegido.
  const anteriores=actuales.map((_,i)=>new Date(Date.UTC(+primero.slice(0,4),+primero.slice(5)-1-actuales.length+i,15)).toISOString().slice(0,7));
  const actual=agrupar(actuales),previo=agrupar(anteriores);
  const items=[...actual.grupos.values()].filter(c=>c.conceptos.size).map(c=>{
    const p=previo.grupos.get(c.id);
    const comparable=actual.completo&&previo.completo&&!c.sinImporte&&!p.sinImporte&&c.cargados>0;
    const importe=c.cargados?red(c.importe):null;
    return {...c,conceptos:c.conceptos.size,importe,anterior:comparable?red(p.importe):null,variacion:comparable?pct(c.importe-p.importe,p.importe):null};
  }).sort((a,b)=>(b.importe??-Infinity)-(a.importe??-Infinity));
  return {items,total:items.some(c=>c.cargados)?red(suma(items.map(c=>c.importe))):null,anteriores,sinImporte:suma(items.map(c=>c.sinImporte))};
}
export const columna = n => { let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s; };
const colNum = s => [...s].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)-1;

export function mesGestion(v, anio) {
  if(v instanceof Date)return Number.isNaN(+v)?'':v.toISOString().slice(0,7);
  const t=norm(v);let m;
  if((m=/^(20\d{2})-(\d{2})(?:-\d{2}.*)?$/.exec(t)))return +m[2]>=1&&+m[2]<=12?`${m[1]}-${m[2]}`:'';
  if((m=/^(\d{1,2})[-/](\d{2}|20\d{2})$/.exec(t)))return +m[1]>=1&&+m[1]<=12?`${m[2].length===2?'20':''}${m[2]}-${m[1].padStart(2,'0')}`:'';
  const i=MESES.indexOf(t.replace('setiembre','septiembre'));
  return i>=0&&anio?`${anio}-${String(i+1).padStart(2,'0')}`:'';
}

// Portátil: Apps Script y XLSX envían el mismo formato, sin datos de clientes.
export function libroDesdeXlsx(wb, XLSX, archivo='Planilla de gestión') {
  return {archivo,hojas:Object.fromEntries(wb.SheetNames.map(nombre=>{
    const sheet=wb.Sheets[nombre], celdas={};
    for(const [a,c] of Object.entries(sheet))if(/^[A-Z]+\d+$/.test(a)&&c.v!==undefined)
      celdas[a]={v:c.t==='e'?(c.w||'#ERROR!'):c.v instanceof Date?c.v.toISOString():c.v,f:c.f||null};
    return [nombre,{celdas,oculta:!!wb.Workbook?.Sheets?.find(s=>s.name===nombre)?.Hidden}];
  }))};
}

function hoja(libro,nombre) {
  const h=libro.hojas?.[nombre];
  if(!h)return null;
  const celdas=h.celdas||{};
  const v=a=>celdas[a]?.v??null;
  const n=a=>numero(v(a));
  const f=a=>celdas[a]?.f||'';
  const rows=[...new Set(Object.keys(celdas).map(a=>+a.match(/\d+/)?.[0]).filter(Boolean))].sort((a,b)=>a-b);
  const fila=r=>Object.entries(celdas).filter(([a])=>+a.match(/\d+/)[0]===r).map(([a,c])=>({a,col:colNum(a.match(/^[A-Z]+/)[0]),v:c.v})).sort((a,b)=>a.col-b.col);
  return {nombre,celdas,v,n,f,rows,fila,ref:a=>({hoja:nombre,celda:a,valor:v(a),formula:f(a)||null})};
}

function gastosMensuales(h) {
  const out={};let tipo='',header=[];
  for(const r of h.rows) {
    const a=norm(h.v('A'+r));
    if(a==='gastos fijos'){tipo='fijos';header=[];continue;}
    if(a==='gastos variables'){tipo='variables';header=h.fila(r);continue;}
    if(tipo==='fijos'&&h.fila(r).some(c=>norm(c.v)==='total x mes')){header=h.fila(r);continue;}
    const mes=mesGestion(h.v('A'+r));
    if(!tipo||!mes||!header.length)continue;
    const fin=header.find(c=>/^total/.test(norm(c.v)));
    if(!fin)continue;
    const items=header.filter(c=>c.col>0&&c.col<fin.col&&norm(c.v)).map(c=>{
      const a=columna(c.col)+r;return {concepto:String(c.v).trim(),importe:h.n(a),nota:h.n(a)===null&&h.v(a)!==null?String(h.v(a)):null,ref:h.ref(a)};
    });
    const total=items.some(c=>c.importe!==null)?suma(items.map(c=>c.importe)):null;
    (out[mes]??={})[tipo]={items,total: red(total),informado:h.n(columna(fin.col)+r),ref:h.ref(columna(fin.col)+r)};
  }
  return out;
}

function canalOnline(h,ref,canal,mes) {
  const m=/!?\$?([A-Z]+)\$?(\d+)\s*$/.exec(ref||'');
  if(!m||!h)return null;
  const row=+m[2];
  if(mesGestion(h.v('A'+row),mes.slice(0,4))!==mes)return null;
  const hr=h.rows.filter(r=>r<row&&norm(h.v('A'+r))==='mes').at(-1);
  if(!hr)return null;
  const head=h.fila(hr);
  const at=(re)=>head.find(c=>re.test(norm(c.v)))?.col;
  const get=re=>{const col=at(re);return col===undefined?null:h.n(columna(col)+row);};
  const val=re=>get(re)??0;
  const bruto=get(/^total de ingresos por producto$/);
  if(bruto===null)return null;
  const devolucion=canal==='ml'?val(/^anulaciones y reembolsos$/):-Math.abs(val(/^reembolso$/));
  const descuentos=canal==='ml'?val(/^descuentos y bonificaciones$/)-Math.abs(val(/^cupones por ventas$/)):-Math.abs(val(/^descuentos$/));
  const venta=red((bruto+devolucion+descuentos)/1.21);
  const neto=h.n(m[1]+row);
  const cargos=head.filter(c=>c.col>0&&/sin iva/.test(norm(c.v))&&!/producto|descuentos|bonif|reembolso/.test(norm(c.v)))
    .map(c=>({concepto:String(c.v),importe:h.n(columna(c.col)+row),ref:h.ref(columna(c.col)+row)}));
  const alertas=[];
  if(neto===null)alertas.push('Falta neto mensual de '+canal.toUpperCase());
  // Señala conceptos con importe que la fórmula del neto no incluye. No cambia
  // signos ni descuenta otra vez gastos ya incluidos en el neto administrativo.
  const formula=h.f(m[1]+row).toUpperCase();
  for(const c of cargos)if(c.importe&&formula&&!new RegExp('(?:^|[^A-Z])'+c.ref.celda+'(?!\\d)').test(formula))
    alertas.push(`${canal.toUpperCase()}: ${c.concepto} (${c.ref.celda}) no figura en la fórmula del neto`);
  return {ventas:venta,neto,unidades:get(/^unidades sin devoluciones$/),cargos,alertas,ref:h.ref(m[1]+row),base:'sin IVA'};
}

function rotacion(h) {
  if(!h)return {meses:{},alcance:'Unidades por SKU; canal no identificado'};
  const meses={};
  // Sólo la matriz principal. Los bloques de la derecha son sus precedentes,
  // con algunos títulos de año incorrectos, y no se vuelven a sumar.
  for(const c of h.fila(1).filter(c=>c.col>0)) {
    if(c.v===null)continue;
    const mes=mesGestion(c.v);if(!mes)continue;
    // Se termina en la primera columna vacía entre la matriz y los precedentes.
    if(c.col>1&&h.v(columna(c.col-1)+'1')===null)break;
    const items=h.rows.filter(r=>r>1&&typeof h.v('A'+r)==='string'&&!/^total/i.test(h.v('A'+r)))
      .map(r=>({sku:h.v('A'+r),unidades:h.n(columna(c.col)+r),ref:h.ref(columna(c.col)+r)}));
    const disponible=items.some(p=>p.unidades>0);
    meses[mes]={disponible,items:disponible?items.filter(p=>p.unidades!==null):[],motivo:disponible?null:'Sin cantidades cargadas; los ceros de fórmulas no confirman actividad nula'};
  }
  return {meses,alcance:'Unidades por SKU según ROTACION DE STOCK; la hoja no identifica el canal'};
}

function categorias(h) {
  const meses={};if(!h)return {meses};
  for(const c of h.fila(1)) {
    const mes=mesGestion(c.v);if(!mes)continue;
    const items=[];
    for(let off=0;off<8;off+=2) {
      const canal=norm(h.v(columna(c.col+off)+'2'));
      const id=canal==='meli'?'ml':canal==='t. nube'?'tn':canal==='dragon'?'a':canal==='dragon b'?'b':null;
      if(!id)continue;
      for(const r of h.rows.filter(r=>r>3)) {
        const tipo=h.v('A'+r);if(typeof tipo!=='string'||/^total/i.test(tipo))continue;
        const ref=columna(c.col+off)+r, importe=h.n(ref), unidades=h.n(columna(c.col+off+1)+r);
        if(importe!==null||unidades!==null)items.push({canal:id,tipo,importe,unidades,ref:h.ref(ref)});
      }
    }
    if(items.length)meses[mes]={items};
  }
  return {meses};
}

function saldos(h) {
  if(!h)return {mensuales:{}};
  const mensuales={};
  for(const r of h.rows) {
    const date=h.v('A'+r),mes=mesGestion(date);if(!mes||typeof date!=='string'||date.length<10)continue;
    const items=[['B','Credicoop · cuenta 1','bancos'],['C','Credicoop · cuenta 2','bancos'],['D','Fondo Credicoop','fondos'],['E','BAPRO','bancos'],['F','Mercado Pago · saldo','plataformas'],['G','Mercado Pago · a liquidar','pendiente'],['H','Tienda Nube · saldo','plataformas'],['I','Tienda Nube · a ingresar','pendiente'],['P','Cohen · NAK','inversiones']]
      .map(([col,concepto,tipo])=>({concepto,tipo,importe:h.n(col+r),ref:h.ref(col+r)}));
    if(!items.some(c=>c.importe!==null))continue;
    const snap={fecha:date.slice(0,10),items};
    if(!mensuales[mes]||snap.fecha>mensuales[mes].fecha)mensuales[mes]=snap;
  }
  return {mensuales,alcance:'NAK STUFF. Saldos a la última fecha informada; no se suman días ni otras sociedades.'};
}

function fechaPestana(n) {
  let m=/^(\d{2})(\d{2})(\d{2}|\d{4})$/.exec(n.trim());
  if(!m)m=/^(?:Al )?(\d{2})-(\d{2})-(\d{2}|\d{4})$/i.exec(n.trim());
  if(!m)return '';
  const iso=`${m[3].length===2?'20':''}${m[3]}-${m[2]}-${m[1]}`;
  return Number.isNaN(Date.parse(iso))?'':iso;
}

function proyeccion(libro) {
  const candidatas=Object.keys(libro.hojas).map(n=>({n,fecha:fechaPestana(n)})).filter(x=>x.fecha).sort((a,b)=>b.fecha.localeCompare(a.fecha));
  for(const c of candidatas) {
    const h=hoja(libro,c.n),total=h.rows.find(r=>norm(h.v('A'+r))==='total gastos mensuales');
    if(!total)continue;
    const pagos=h.rows.find(r=>norm(h.v('A'+r))==='a pagar en el mes');
    const ventas=h.rows.find(r=>norm(h.v('A'+r))==='proyeccion de ventas');
    const saldo=h.rows.find(r=>/^saldos mes/.test(norm(h.v('A'+r))));
    let anio=+c.fecha.slice(0,4),prev=0;
    const meses=h.fila(3).filter(x=>x.col>0).map(x=>{
      let mes=mesGestion(x.v,anio);if(!mes)return null;
      if(+mes.slice(5)<prev)mes=mesGestion(x.v,++anio);prev=+mes.slice(5);
      const col=columna(x.col), detalle=[];
      for(const r of h.rows.filter(r=>r>=5&&r<pagos)) {
        const concepto=h.v('A'+r);if(typeof concepto!=='string'||/total/i.test(concepto))continue;
        for(let off=0;off<3;off++) {
          const a=columna(x.col+off)+r;
          if(h.n(a)!==null)detalle.push({concepto,tramo:h.v(columna(x.col+off)+'4'),importe:h.n(a),ref:h.ref(a)});
        }
      }
      return {mes,pagosInformados:h.n(col+total),ventasPrevistas:ventas?h.n(col+ventas):null,saldoProyectado:saldo?h.n(col+saldo):null,detalle,ref:h.ref(col+total)};
    }).filter(Boolean);
    const rango=pagos?h.f('B'+pagos):'';
    const hasta=+(/SUM\(B\d+:B(\d+)\)/i.exec(rango)?.[1]||0);
    const omitidos=hasta?h.rows.filter(r=>r>hasta&&r<pagos&&h.fila(r).some(c=>c.col>0&&numero(c.v)!==null&&c.v!==0)):[];
    return {hoja:c.n,fecha:c.fecha,meses,alertas:omitidos.length?[`La suma de pagos termina en la fila ${hasta}; hay importes posteriores fuera del total. Revisar antes de usar el saldo proyectado.`]:[],alcance:'Proyección informada, con su propio corte. No es caja disponible ni resultado operativo.'};
  }
  return null;
}

function compras(h) {
  if(!h)return null;
  const header=h.rows.find(r=>norm(h.v('A'+r))==='orden');if(!header)return null;
  return {hoja:h.nombre,periodo:'2025',nota:'Importaciones históricas. FOB y landed no son costo de mercadería vendida ni se suman al resultado mensual.',items:h.rows.filter(r=>r>header&&typeof h.v('A'+r)==='string'&&/^(PN-|SOP\s)/i.test(h.v('A'+r))).map(r=>({orden:h.v('A'+r),nacionalizado: norm(h.v('B'+r))==='si',fob:h.n('C'+r),factorLanded:h.n('D'+r),landed:h.n('E'+r),nota:h.v('F'+r),ref:h.ref('E'+r)}))};
}

function prestamo(h) {
  if(!h)return null;
  const cuotas=[];let credito=null;
  for(const r of h.rows){
    if(norm(h.v('A'+r))==='prestamo')credito={id:h.nombre+':'+r,montoOriginal:h.n('B'+r)};
    if(credito&&mesGestion(h.v('B'+r))&&h.n('A'+r)!==null)cuotas.push({credito,cuota:h.n('A'+r),fecha:String(h.v('B'+r)).slice(0,10),capital:h.n('C'+r),interes:h.n('D'+r),total:h.n('E'+r),ref:h.ref('E'+r)});
  }
  return {hoja:h.nombre,cuotas,nota:'Cronograma histórico. Capital e intereses se mantienen separados; no se agregan nuevamente a la proyección de pagos.'};
}

export function construirGestion(libro,{hoy=new Date().toISOString().slice(0,10),categoriasGastos={}}={}) {
  if(!libro||!libro.hojas)throw new Error('La planilla de gestión no tiene hojas.');
  const h=hoja(libro,'Ventas - Gastos fijos'),online=hoja(libro,'Ventas Meli y Tienda');
  if(!h||!online)throw new Error('Faltan las hojas Ventas - Gastos fijos / Ventas Meli y Tienda.');
  const gastos=gastosMensuales(h), meses={};let header=[];
  for(const r of h.rows) {
    if(norm(h.v('A'+r))==='mes'&&h.fila(r).some(c=>norm(c.v)==='ventas a')){header=h.fila(r);continue;}
    if(norm(h.v('A'+r))==='gastos fijos')break;
    const mes=mesGestion(h.v('A'+r));if(!mes||!header.length)continue;
    if(meses[mes])throw new Error('Mes duplicado en el resumen de gestión: '+mes);
    const at=re=>header.find(c=>re.test(norm(c.v)))?.col;
    const celda=re=>{const col=at(re);return col===undefined?null:columna(col)+r;};
    const ca=celda(/^ventas a$/),cb=celda(/^ventas b$/),cm=celda(/^meli/),ct=celda(/^tienda nube/);
    const a=h.n(ca),b=h.n(cb),ml=canalOnline(online,h.f(cm),'ml',mes),tn=canalOnline(online,h.f(ct),'tn',mes);
    if(a===null&&b===null&&!ml&&!tn)continue;
    const g=gastos[mes]||{}, alertas=[...(ml?.alertas||[]),...(tn?.alertas||[])];
    const pendientes=[];
    for(const [nombre,v]of [['Ventas A',a],['Ventas B',b],['MeLi',ml?.neto],['Tienda Nube',tn?.neto],['Gastos fijos',g.fijos?.total],['Gastos variables',g.variables?.total],['Costo mayorista',h.n('M'+r)],['Costo MeLi/TN',h.n('O'+r)]])if(numero(v)===null)pendientes.push(nombre);
    for(const item of g.variables?.items||[])if(/entregas|iibb/i.test(item.concepto)&&item.importe===null)pendientes.push(item.concepto);
    for(const [cel,total]of [['K',g.fijos?.total],['L',g.variables?.total]])if(numero(total)!==null&&(h.n(cel+r)===null||Math.abs(total-h.n(cel+r))>1))alertas.push(`${h.nombre}!${cel+r}: el resumen no coincide con el detalle de gastos`);
    const legacy=h.n((celda(/^ventas 3 grandes$/)));
    if(legacy)alertas.push('Incluye ventas históricas de Tres Grandes, separadas de los cuatro canales actuales');
    meses[mes]={mes,calendarioCerrado:mes<hoy.slice(0,7),canales:{a:{ventas:a,neto:a,base:'Según planilla; validar base IVA',ref:h.ref(ca)},b:{ventas:b,neto:b,base:'Según planilla; validar base IVA',ref:h.ref(cb)},ml,tn},legacy:legacy||0,
      fijos:g.fijos||null,variables:g.variables||null,costos:{mayorista:h.n('M'+r),online:h.n('O'+r)},scrap:h.n('N'+r),resultadoInformado:h.n('P'+r),tipoCambio:h.n('S'+r),pendientes,alertas,
      refs:{resumen:h.ref('P'+r),costoMayorista:h.ref('M'+r),costoOnline:h.ref('O'+r)}};
  }
  if(!Object.keys(meses).length)throw new Error('No se encontraron meses en la planilla de gestión.');
  const inventario=Object.keys(libro.hojas).map(n=>{const s=hoja(libro,n);return {hoja:n,oculta:!!libro.hojas[n].oculta,celdas:Object.keys(s.celdas).length,errores:Object.entries(s.celdas).filter(([,c])=>typeof c.v==='string'&&/^#(?:REF!|DIV\/0!|VALUE!|N\/A|NAME\?|ERROR!)/.test(c.v)).map(([a])=>a)};});
  return {version:1,archivo:libro.archivo||'Planilla de gestión',actualizado:libro.actualizado||null,meses,gastosCategorias:validarCategoriasGastos(categoriasGastos),rotacion:rotacion(hoja(libro,'ROTACION DE STOCK')),categorias:categorias(hoja(libro,'Ventas por tipo artículo')),caja:saldos(hoja(libro,'Saldos')),proyeccion:proyeccion(libro),compras:compras(hoja(libro,'COMPRAS 2025')),prestamo:prestamo(hoja(libro,'Prestamo BAPRO')),inventario,
    alcance:'Cierre administrativo mensual. Los importes de mayoristas y gastos mantienen la base informada en la planilla.'};
}

export function bloqueGestion(gestion,meses,canal='empresa') {
  const ids={empresa:['a','b','ml','tn'],mayoristas:['a','b'],online:['ml','tn'],a:['a'],b:['b'],ml:['ml'],tn:['tn']}[canal];
  if(!ids)throw new Error('Canal de gestión inválido.');
  const rows=meses.map(m=>gestion.meses[m]).filter(Boolean);
  if(!rows.length)return null;
  const ventas=completa(rows.flatMap(m=>ids.map(id=>m.canales[id]?.ventas??null)));
  const neto=completa(rows.flatMap(m=>ids.map(id=>m.canales[id]?.neto??null)));
  const costoMes=m=>canal==='empresa'?completa([m.costos.mayorista,m.costos.online]):canal==='online'?m.costos.online:canal==='mayoristas'?m.costos.mayorista:null;
  const costo=completa(rows.map(costoMes));
  const fijos=canal==='empresa'?completa(rows.map(m=>m.fijos?.total??null)):null;
  const variables=canal==='empresa'?completa(rows.map(m=>m.variables?.total??null)):null;
  const legacy=canal==='empresa'?suma(rows.map(m=>m.legacy)):0;
  const ventaTotal=ventas===null?null:ventas+legacy;
  const netoTotal=neto===null?null:neto+legacy;
  const scrap=canal==='empresa'?suma(rows.map(m=>m.scrap)):0;
  const gastosCanal=ventas!==null&&neto!==null?ventas-neto:null;
  const margen=ventaTotal!==null&&costo!==null?ventaTotal-costo:null;
  const contribucion=netoTotal!==null&&costo!==null?netoTotal-costo:null;
  const provisional=contribucion!==null&&fijos!==null&&variables!==null?contribucion-fijos-variables-scrap:null;
  const pendientes=[...new Set(rows.flatMap(m=>m.pendientes))];
  const alertas=[...new Set(rows.flatMap(m=>m.alertas))];
  const resultado=pendientes.length||alertas.length?null:provisional;
  const lineas=[['Ventas antes de cargos',ventaTotal,'total'],['Costo de mercadería',costo===null?null:-costo,'gasto'],['Margen bruto',margen,'destacado'],['Cargos netos de MeLi/TN según planilla',gastosCanal===null?null:-gastosCanal,'gasto'],['Después de costos y cargos',contribucion,'destacado'],...(canal==='empresa'?[['Gastos variables',variables===null?null:-variables,'gasto'],['Gastos fijos',fijos===null?null:-fijos,'gasto'],...(scrap?[['Scrap',-scrap,'gasto']]:[]),['Resultado operativo provisional',provisional,'destacado']]:[])].map(([c,v,tipo])=>({c,v:red(v),pct:pct(v,ventaTotal),tipo}));
  const gastos=tipo=>{
    const map=new Map();for(const m of rows)for(const c of m[tipo]?.items||[])if(c.importe!==null)map.set(c.concepto,(map.get(c.concepto)||0)+c.importe);
    return [...map].map(([n,v])=>({n,v})).sort((a,b)=>b.v-a.v);
  };
  return {meses:rows.map(m=>m.mes),canal,ventas:red(ventaTotal),neto:red(netoTotal),costo:red(costo),margen:red(margen),margenPct:pct(margen,ventaTotal),resultado:red(resultado),provisional:red(provisional),lineas,pendientes,alertas,fijos:gastos('fijos'),variables:gastos('variables'),sinProrrateo:!['empresa','mayoristas','online'].includes(canal),
    conciliacion:rows.filter(m=>m.resultadoInformado!==null).map(m=>({mes:m.mes,informado:m.resultadoInformado,ref:m.refs.resumen})),
    serie:rows.map(m=>({mes:m.mes,v:completa(ids.map(id=>m.canales[id]?.ventas??null))}))};
}
