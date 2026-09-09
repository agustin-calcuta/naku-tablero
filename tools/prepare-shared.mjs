// Preparar la migración usando exactamente los exports y costos del último cierre.
// No publica: deja la comparación y el estado inicial en .backup (ignorado).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import XLSX from 'xlsx';
import assert from 'node:assert/strict';
import {cleanExport,buildShared} from '../src/ventas-compartidas.mjs';
import {parseCSV,packLines,parseMaestro} from '../src/buyer.mjs';
import {buildCostos} from '../src/costos.mjs';
import {encode} from '../neon/buyer/handler.mjs';
import {connection} from './neon-sql.mjs';

const sql=connection();
const published=(await sql("select datos,actualizado from tablero where id='direccion'")).rows[0];
const dir=path.resolve(process.env.NAKU_DOWNLOADS||path.join(os.homedir(),'Downloads'))+path.sep;
const exports=[];
for(const name of published.datos.fuentes.ventas.meli){
  const wb=XLSX.readFile(dir+name);const sheet=wb.Sheets['Ventas AR']||wb.Sheets[wb.SheetNames[0]];
  exports.push(cleanExport('ml',XLSX.utils.sheet_to_json(sheet,{header:1,raw:true,defval:''}),name));
}
for(const name of ['NAKU-TN-Ventas2025.csv','NAKU-TN-Ventas2026.csv']) {
  const text=new TextDecoder('windows-1252').decode(fs.readFileSync(dir+name));
  exports.push(cleanExport('tn',parseCSV(text,';'),name));
}
const wb=XLSX.readFile(dir+'NUEVA PLANILLA MADRE.xlsx');
const hoja=published.datos.fuentes.costos.hoja;
const costs=buildCostos(XLSX.utils.sheet_to_json(wb.Sheets[hoja],{header:1,raw:true,defval:''}),hoja,'2026-07');
const maestro=fs.readFileSync('../Tablero Buyer Naku/Naku - SKU+Buyer+Cat.csv','utf8');
console.log('Maestro:',parseMaestro(maestro).length-1,'filas. Costos:',costs.costo.size);
const base=JSON.parse(fs.readFileSync('docs/data/lines.json'));
const buyer={ventas:{cols:base.cols,rows:base.rows},maestro,manifest:[]};
const result=buildShared(buyer,{}, {exports,ventas:packLines([]),costos:{pares:[...costs.costo],hoja,mes:'2026-07',archivo:'NUEVA PLANILLA MADRE.xlsx'},nombre:'Migración inicial'},published.datos);
let checks=0;
for(const [channel,views] of Object.entries(published.datos.vistas))for(const [period,expected] of Object.entries(views)){
  const actual=result.finance.vistas[channel]?.[period];
  assert.ok(actual,channel+' '+period);
  for(const metric of ['ordenes','unidades','ticket','netoLiquidado','cobertura']) {
    assert.ok(Math.abs(actual.eerr[metric]-expected.eerr[metric])<0.01,`${channel} ${period} ${metric}: ${actual.eerr[metric]} vs ${expected.eerr[metric]}`);checks++;
  }
  for(let i=0;i<expected.eerr.lineas.length;i++) {
    assert.ok(Math.abs(actual.eerr.lineas[i].v-expected.eerr.lineas[i].v)<1,`${channel} ${period}: ${expected.eerr.lineas[i].c}`);checks++;
  }
}
fs.mkdirSync('.backup/shared',{recursive:true});
fs.writeFileSync('.backup/shared/seed.json',JSON.stringify({datos:encode(result.buyer),fuentes:encode(result.sources),finance:result.finance,finExpected:published.actualizado}));
console.log(JSON.stringify({checks,buyerLines:result.buyer.ventas.rows.length,orders:result.sources.orders.length,sourceBytes:JSON.stringify(result.sources).length,packedBytes:encode(result.sources).length,result:result.result}));
