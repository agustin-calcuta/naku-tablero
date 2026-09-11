import assert from 'node:assert/strict';
import fs from 'node:fs';
import XLSX from 'xlsx';
import { construirGestion, bloqueGestion, libroDesdeXlsx, resumenGastos, categoriaGasto, validarCategoriasGastos } from '../src/gestion.mjs';
import { buildShared } from '../src/ventas-compartidas.mjs';
import { matcherCostosHistoricos, buildHistorialCostos } from '../src/costos.mjs';
import { packLines } from '../src/buyer.mjs';
import { createHandler, encode } from '../neon/buyer/handler.mjs';
import { recortarCentral, leerFuentes, respuestaPuente } from '../src/fuentes-sync.mjs';

const libro={archivo:'Prueba.xlsx',hojas:{'Ventas - Gastos fijos':{celdas:{}},'Ventas Meli y Tienda':{celdas:{}}}};
const g=libro.hojas['Ventas - Gastos fijos'].celdas,o=libro.hojas['Ventas Meli y Tienda'].celdas;
const set=(s,a,v,f=null)=>s[a]={v,f};
for(const [c,v] of Object.entries({A:'MES',B:'Ventas A',C:'Ventas B',D:'Ventas 3 grandes',E:'Meli limpio',F:'TIENDA NUBE limpio',G:'Total ventas netas'}))set(g,c+1,v);
for(const [c,v] of Object.entries({A:'Mes',C:'Unidades sin devoluciones',D:'Total de ingresos por producto',E:'Anulaciones y reembolsos',N:'Descuentos y bonificaciones',AI:'Total con dtos neto'}))set(o,c+1,v);
for(const [c,v] of Object.entries({A:'Mes',C:'Unidades sin devoluciones',D:'Total de ingresos por producto',F:'Descuentos',J:'Reembolso',S:'Total con dtos'}))set(o,c+10,v);
for(const [r,mes,label]of [[2,'2026-07','Julio'],[3,'2026-08','Agosto'],[4,'2026-09','Septiembre']]){
 set(g,'A'+r,mes);set(g,'B'+r,100);set(g,'C'+r,50);set(g,'E'+r,80,"'Ventas Meli y Tienda'!AI"+r);set(g,'F'+r,40,"'Ventas Meli y Tienda'!S"+(r+9));
 set(g,'K'+r,20);set(g,'L'+r,10);set(g,'M'+r,40);set(g,'O'+r,30);set(g,'P'+r,170);
 set(o,'A'+r,label);set(o,'D'+r,121);set(o,'E'+r,0);set(o,'N'+r,0);set(o,'AI'+r,80);set(o,'C'+r,2);
 set(o,'A'+(r+9),label);set(o,'D'+(r+9),60.5);set(o,'F'+(r+9),0);set(o,'J'+(r+9),0);set(o,'S'+(r+9),40);set(o,'C'+(r+9),1);
}
set(g,'A20','Gastos fijos');set(g,'B21','Sueldos');set(g,'E21','Total x mes');
set(g,'A30','Gastos variables');set(g,'B30','Entregas Last Miles');set(g,'C30','IIBB');set(g,'G30','Total Gtos. Variables');
for(let i=0;i<3;i++){set(g,'A'+(22+i),'2026-0'+(7+i));set(g,'B'+(22+i),20);set(g,'E'+(22+i),20);set(g,'A'+(31+i),'2026-0'+(7+i));set(g,'B'+(31+i),10);set(g,'C'+(31+i),0);set(g,'G'+(31+i),10);}
let gestion=construirGestion(libro,{hoy:'2026-09-11'});
assert.equal(gestion.meses['2026-09'].calendarioCerrado,false);
let b=bloqueGestion(gestion,['2026-07']);
assert.equal(b.ventas,300);assert.equal(b.neto,270);assert.equal(b.provisional,170);assert.equal(b.resultado,170);
assert.equal(bloqueGestion(gestion,['2026-07','2026-08']).provisional,340);
assert.equal(bloqueGestion(gestion,['2026-07'],'ml').costo,null,'No inventa un prorrateo');
assert.equal(bloqueGestion(gestion,['2026-07'],'online').costo,30);
assert.equal(categoriaGasto('  SUELDOS '),'personal');
assert.equal(categoriaGasto('AYSA'),'servicios');
assert.equal(categoriaGasto('Proveedor sin descripción'),'pendiente');
assert.equal(categoriaGasto('Proveedor sin descripción',validarCategoriasGastos({'Proveedor sin descripción':'logistica'})),'logistica');
assert.throws(()=>validarCategoriasGastos({'x':'categoria inventada'}));
assert.throws(()=>validarCategoriasGastos(JSON.parse('{"__proto__":"personal"}')));
let categorias=resumenGastos(gestion,['2026-08']);
assert.equal(categorias.total,30,'Las categorías concilian con fijos más variables');
assert.equal(categorias.items.find(c=>c.id==='personal').variacion,0);
assert.equal(resumenGastos(gestion,['2026-07']).items.find(c=>c.id==='personal').variacion,null,'No compara con meses ausentes');
assert.deepEqual(resumenGastos(gestion,['2026-07','2026-08']).anteriores,['2026-05','2026-06']);
delete g.C32;gestion=construirGestion(libro,{hoy:'2026-09-11'});
categorias=resumenGastos(gestion,['2026-08']);
assert.equal(categorias.items.find(c=>c.id==='impuestos').importe,null,'Un blanco no es cero');
assert.equal(categorias.items.find(c=>c.id==='impuestos').variacion,null);
assert.equal(categorias.total,30,'Un pendiente no elimina los importes conocidos');
assert.ok(gestion.meses['2026-08'].pendientes.includes('IIBB'));
assert.equal(bloqueGestion(gestion,['2026-08']).resultado,null,'Un gasto vacío bloquea el resultado definitivo');
assert.equal(bloqueGestion(gestion,['2026-08']).provisional,170);
set(g,'K3',999);gestion=construirGestion(libro,{hoy:'2026-09-11'});
assert.equal(gestion.meses['2026-08'].fijos.total,20,'El detalle por mes gana a una referencia equivocada');
assert.ok(gestion.meses['2026-08'].alertas.some(a=>a.includes('K3')));
const empty={ventas:packLines([]),maestro:'SKU;Nombre;Categorías;Buyer Persona\nA;Producto;Tipo;Juan',manifest:[]};
const built=buildShared(empty,{}, {id:'planilla',gestion:libro});
assert.equal(built.finance.gestion.meses['2026-07'].canales.a.ventas,100,'Funciona sin costos por SKU ni exports');
assert.equal(built.buyer.ventas.rows.length,0,'No inventa órdenes a partir de resúmenes');
assert.equal(built.buyer.gestion,undefined,'El Buyer no recibe costos ni estados de resultados');
const again=buildShared(built.buyer,built.sources,{id:'otra'},built.finance);
assert.deepEqual(again.finance.gestion,built.finance.gestion,'Los resúmenes se reemplazan, no se acumulan');
const clasificado=buildShared(built.buyer,built.sources,{id:'clasificar',gastosCategorias:{'Proveedor de prueba':'logistica'}},built.finance);
const actualizado=buildShared(clasificado.buyer,clasificado.sources,{id:'google',gestion:libro,sincronizacion:{revision:'otra'}},clasificado.finance);
assert.equal(actualizado.finance.gestion.gastosCategorias['proveedor de prueba'],'logistica','Google conserva la clasificación acordada');
assert.ok(!JSON.stringify(actualizado.buyer).includes('proveedor de prueba'),'La clasificación privada no se distribuye a Compradores');
const cost=matcherCostosHistoricos({historial:[{mes:'2026-01',pares:[['A',10]]},{mes:'2026-07',pares:[['A',20]]}]});
assert.equal(cost('A','2025-12').costo,null);assert.equal(cost('A','2026-03').costo,10);assert.equal(cost('A','2026-07').costo,20);
const historial=buildHistorialCostos(['AGOSTO 2026','MARZO 2026','OCTUBRE 2021'],n=>n==='AGOSTO 2026'?[['SKU: NAKU','COSTO SIN IVA'],['A',100]]:n==='MARZO 2026'?[['SKU: NAKU','COSTO DÓLAR SIN IVA'],['A',80]]:[['NAKU','COSTO DÓLAR 106'],['A',60]]);
assert.equal(historial.historial[1].pares[0][1],80,'El costo histórico ya convertido a pesos no se convierte dos veces');
assert.equal(historial.omitidas[0].mes,'2021-10','Los formatos antiguos incompatibles quedan identificados');
assert.throws(()=>buildHistorialCostos(['SEPTIEMBRE 2026','AGOSTO 2026'],n=>n==='SEPTIEMBRE 2026'?[['SKU: NAKU','OTRO COSTO']]:[['SKU: NAKU','COSTO SIN IVA'],['A',100]]),/encabezados/,'No oculta un cambio de formato en la hoja más reciente');
const central={postventa:[['Caso','Email','Alta del caso'],['1','privado','2026-07-01']],minorista:[['Caso']],volumen:[['Caso']]};
assert.ok(!JSON.stringify(recortarCentral(central)).includes('privado'));

let writes=0,reads=0;
const sql=async(query,params)=>{
 if(query.includes('buyer_leer'))return {rows:[{r:{revision:1,datos:encode(empty),fuentes:encode({}),actualizado:'2026-09-11T00:00:00Z'}}]};
 if(query.includes('puede_leer'))return {rows:[{ok:params[0]==='finance'}]};
 if(query.includes('select datos,actualizado'))return {rows:[]};
 if(query.includes('buyer_guardar')){writes++;return {rows:[{r:{revision:2,actualizado:'2026-09-11T01:00:00Z'}}]};}
 throw new Error('SQL inesperado');
};
const handler=createHandler(sql,{leerFuentes:async()=>{reads++;return {gestion:libro};}});
const request=(route,key,op)=>handler(new Request('https://test'+route,{method:'PUT',headers:{'x-naku-clave':key},body:JSON.stringify({datos:encode(op)})}));
assert.equal((await request('/','buyer',{id:'1',gestion:libro})).status,403);
assert.equal((await request('/','buyer',{id:'categorias',gastosCategorias:{Sueldos:'personal'}})).status,403);
assert.equal((await request('/sincronizar','buyer',{id:'2'})).status,403);assert.equal(reads,0);
assert.equal((await request('/preview','finance',{id:'3',gestion:libro})).status,200);assert.equal(writes,0);
assert.equal((await request('/sincronizar','finance',{id:'4'})).status,200);assert.equal(writes,1);
const failed=createHandler(sql,{leerFuentes:async()=>{throw new Error('Google sin acceso');}});
assert.equal((await failed(new Request('https://test/sincronizar',{method:'PUT',headers:{'x-naku-clave':'finance'},body:JSON.stringify({datos:encode({id:'fail'})})}))).status,502);assert.equal(writes,1,'Un fallo de Google no pisa la última versión');
await assert.rejects(()=>leerFuentes({url:'https://script.google.com/macros/s/example/exec',token:'private',fetcher:async(url,opts)=>{assert.ok(!url.href.includes('private'));assert.equal(opts.method,'POST');return new Response('no autorizado',{status:401});}}),/401/);
const solicitudes=[];
const puente=await respuestaPuente('https://script.google.com/macros/s/example/exec','private',async(url,opts)=>{
 solicitudes.push({url:url.href,...opts});
 if(opts.method==='POST')return new Response(null,{status:302,headers:{location:'https://script.googleusercontent.com/macros/echo?once='+solicitudes.length}});
 assert.equal(opts.body,undefined,'La credencial no se reenvía en el redirect');
 return solicitudes.length===2?new Response('caducó',{status:404}):Response.json({ok:true});
});
assert.ok(puente.ok);assert.equal(solicitudes.length,4);
assert.notEqual(solicitudes[0].url,solicitudes[2].url,'Un redirect vencido requiere una solicitud nueva');
await assert.rejects(()=>respuestaPuente('https://script.google.com/macros/s/example/exec','private',async()=>new Response(null,{status:302,headers:{location:'https://otro.example'}})),/autorización/);

// Verificación opcional con la copia del usuario; nunca contiene datos privados en git.
if(process.env.NAKU_GESTION_TEST){
 const g=construirGestion(libroDesdeXlsx(XLSX.readFile(process.env.NAKU_GESTION_TEST,{cellDates:true}),XLSX),{hoy:'2026-09-11'});
 assert.equal(g.inventario.length,92);
 const agosto=bloqueGestion(g,['2026-08']);assert.ok(Math.abs(agosto.provisional-g.meses['2026-08'].resultadoInformado)<1);
 assert.ok(agosto.pendientes.includes('IIBB'));assert.equal(g.rotacion.meses['2026-08'].disponible,false);
 assert.deepEqual(Object.keys(g.categorias.meses),['2025-10','2025-11','2025-12','2026-01']);
 assert.equal(g.proyeccion.hoja,'100926');assert.ok(g.proyeccion.alertas.length);
 assert.equal(g.caja.mensuales['2026-08'].fecha,'2026-08-31');
}
console.log('✓ Gestión mensual: fuentes, IVA, gastos pendientes, sin exports, permisos, históricos, conciliación y fallos de sincronización');
