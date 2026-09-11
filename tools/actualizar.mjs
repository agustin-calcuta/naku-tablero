// Carga compartida: planillas como fuente del cierre, exports opcionales.
// --google lee el puente privado. --publicar guarda mediante la API compartida.
// Sin --publicar sólo prepara datos/direccion.json y datos/operacion.json.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';
import { leerFuentes, costosDesdeLibro, recortarCentral } from '../src/fuentes-sync.mjs';
import { libroDesdeXlsx } from '../src/gestion.mjs';
import { buildShared } from '../src/ventas-compartidas.mjs';
import { packLines } from '../src/buyer.mjs';
import { encode } from '../neon/buyer/handler.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),option=(n)=>{const i=args.indexOf(n);return i>=0?args[i+1]:null;};
const config=JSON.parse(fs.readFileSync(path.join(root,'naku.config.json')));
const data=process.env.NAKU_DATA||path.resolve(root,'..','Naku Datos');
const op={id:crypto.randomUUID(),nombre:'Planillas de administración'};
if(args.includes('--google'))Object.assign(op,await leerFuentes({url:process.env.NAKU_FUENTES_URL||config.fuentes?.url,token:process.env.NAKU_FUENTES_TOKEN||config.fuentes?.token}));
else{
  const gestion=option('--gestion')||path.join(data,config.gestion.archivo);
  if(!fs.existsSync(gestion))throw new Error('Falta la planilla de gestión. Indicá --gestion /ruta/archivo.xlsx o --google.');
  op.gestion=libroDesdeXlsx(XLSX.readFile(gestion,{cellDates:true}),XLSX,path.basename(gestion));
  const costos=option('--costos')||path.join(data,config.costos.archivo);
  if(fs.existsSync(costos))op.costos=costosDesdeLibro(XLSX.readFile(costos,{cellDates:true}),path.basename(costos));
  const central=option('--central')||path.join(data,config.postventa.archivo);
  if(fs.existsSync(central)){
    const wb=XLSX.readFile(central,{cellDates:true});
    op.central=recortarCentral(Object.fromEntries([['postventa','Postventa'],['minorista','Preventa Minorista'],['volumen','Preventa Volumen']].map(([k,n])=>[k,XLSX.utils.sheet_to_json(wb.Sheets[n],{header:1,raw:true,defval:''})])));
  }
}
if(args.includes('--publicar')&&!args.includes('--sin-publicar')){
  const key=process.env.NAKU_CLAVE;if(!key)throw new Error('Falta NAKU_CLAVE para actualizar los tableros compartidos.');
  const api=process.env.NAKU_BUYER_API||'https://br-wispy-lake-ayf0dl28-buyer.compute.c-5.us-east-2.aws.neon.tech';
  const res=await fetch(api+'/finanzas',{method:'PUT',headers:{'content-type':'application/json','x-naku-clave':key},body:JSON.stringify({datos:encode(op)}),signal:AbortSignal.timeout(180000)});
  const r=await res.json();if(!res.ok)throw new Error(r.error||'No se confirmó la actualización.');
  console.log('Planillas guardadas mediante la carga compartida.');
}else{
  const snapshot=option('--estado');
  const state=snapshot?JSON.parse(fs.readFileSync(snapshot)):{buyer:{maestro:'SKU;Nombre;Categorías;Buyer Persona\n',ventas:packLines([]),manifest:[]},sources:{}};
  const result=buildShared(state.buyer,state.sources,op,state.finance);
  fs.mkdirSync(path.join(root,'datos'),{recursive:true});
  fs.writeFileSync(path.join(root,'datos','direccion.json'),JSON.stringify(result.finance),{mode:0o600});
  fs.writeFileSync(path.join(root,'datos','operacion.json'),JSON.stringify(op),{mode:0o600});
  console.log('Vista local preparada. '+Object.keys(result.finance.gestion.meses).length+' meses administrativos; no se publicó nada.');
}
