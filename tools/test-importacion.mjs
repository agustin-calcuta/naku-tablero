import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { ingestFinanzasMeli, ingestFinanzasTn, agregar, eerr } from '../src/finanzas.mjs';
const costo = () => ({costo:10});
const tnHeader=['Número de orden','Fecha','Estado de la orden','Estado del pago','SKU','Precio del producto','Cantidad del producto','Subtotal de productos','Descuento','Costo de envío','Total','Costo de procesamiento','Interés por cuotas','Impuestos','Total neto','Nombre del producto','Medio de envío','Provincia o estado','Reembolso'];
const tn=ingestFinanzasTn([tnHeader,
 ['1','31/08/2026','Archivada','Recibido','A',100,1,300,0,40,340,10,0,0,330,'Uno','Correo','Buenos Aires',0],
 ['1','','','','B',100,2,'','','','','','','','','Dos','','',''],
 ['2','31/08/2026','Abierta','Pendiente','A',100,1,100,0,0,100,0,0,0,'','Uno','','',0]
],costo);
const a=agregar(tn.get('2026-08'));
assert.equal(a.ordenes.size,1); assert.equal(a.unidades,3); assert.equal(a.cogs,30);
assert.equal(a.ventaBruta,300); assert.equal(a.envioCobrado,40); assert.equal(a.envioCosto,0);
assert.equal(a.netoLiquidado,330); assert.equal(a.productos.get('B').u,2);
const mh=['# de venta','Fecha de venta','Estado','Descripción del estado','Unidades','SKU','Ingresos por productos (ARS)','Cargo por venta e impuestos (ARS)','Total (ARS)','Precio unitario de venta de la publicación (ARS)','Título de la publicación','Ingresos por envío (ARS)','Costos de envío (ARS)','Descuentos y bonificaciones','Anulaciones y reembolsos (ARS)'];
const ml=ingestFinanzasMeli([mh,
 ['10','31 de agosto de 2026','Paquete de 2 productos','','','',300,-30,265,'','',0,0,0,0],
 ['11','31 de agosto de 2026','Entregado','',1,'A','','','',100,'Uno'],
 ['12','31 de agosto de 2026','Entregado','',2,'B','','','',100,'Dos']
],costo);
const b=agregar(ml.get('2026-08'));
assert.equal(b.ordenes.size,1); assert.equal(b.unidades,3); assert.equal(b.ventaBruta,300);
assert.ok(Math.abs(b.ajustes+5)<1e-9); assert.equal(b.cogs,30);
assert.equal([...b.productos.values()].reduce((s,p)=>s+p.v,0),300/1.21);
assert.ok(Math.abs(eerr(b).contribucion-((300-30-5)/1.21-30))<1e-9);
// El rango libre debe coincidir con el bloque del motor, incluso para productos
// fuera de los diez primeros de un mes y con meses de distinto volumen.
const D=JSON.parse(fs.readFileSync('datos/direccion.json'));
const html=fs.readFileSync('docs/direccion.html','utf8');
const start=html.indexOf('function sumarBloques('); const end=html.indexOf('\n/**',start);
const ctx=vm.createContext({});vm.runInContext(html.slice(start,end),ctx);
for(const [canal,vistas] of Object.entries(D.vistas)){
 const meses=D.periodos.find(p=>p.id==='m3').meses;
 const suma=ctx.sumarBloques(vistas,meses);const esperado=vistas.m3;
 assert.equal(suma.eerr.ordenes,esperado.eerr.ordenes);
 assert.equal(suma.eerr.cobertura,esperado.eerr.cobertura);
 assert.equal(suma.productos.map(p=>p.sku).join(),esperado.productos.map(p=>p.sku).join());
 for(const p of suma.productos){const orig=esperado.productos.find(x=>x.sku===p.sku);assert.ok(Math.abs(p.v-orig.v)<1);}
 assert.ok(Math.abs(suma.neto-esperado.neto)<=2);
}
for(const script of [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]) new vm.Script(script[1]);
new vm.Script(fs.readFileSync('docs/importar-ui.js','utf8'));
console.log('✓ Importación: productos adicionales, paquetes, cargos agrupados, pagos pendientes y filtros de rango');
