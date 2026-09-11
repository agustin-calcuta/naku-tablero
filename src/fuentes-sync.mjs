import * as XLSX from 'xlsx';
import { createHash } from 'node:crypto';
import { libroDesdeXlsx } from './gestion.mjs';
import { buildHistorialCostos } from './costos.mjs';

export const CAMPOS_CENTRAL={
  postventa:['Caso','Ingreso del mensaje','Alta del caso','Urgencia','Canal de venta','Tipo de reclamo','SKU','3· Contactado','5· Accionable','Área derivada','7· Estatus','Fecha de cierre','Último responsable','Última actualización'],
  minorista:['Caso','Alta del caso','Origen','Canal de comunicación','SKU consultado','2· Respondido','3· Seguimiento','Estatus','Motivo de pérdida','Fecha de cierre','Última actualización'],
  volumen:['Caso','Alta del caso','Tipo de cliente','Canal de comunicación','SKU','Cantidad estimada por SKU','4· Cotización','Monto cotizado','6· Estatus','Motivo de pérdida','Fecha de cierre','Última actualización'],
};
export function recortarCentral(central) {
  return Object.fromEntries(Object.entries(CAMPOS_CENTRAL).map(([key,campos])=>{
    const data=central?.[key];if(!Array.isArray(data)||!data.length)throw new Error('Falta la hoja de central: '+key);
    const indexes=campos.map(c=>data[0].indexOf(c));
    if(indexes[0]<0)throw new Error('La central no tiene columna Caso: '+key);
    return [key,[campos,...data.slice(1).filter(r=>r[indexes[0]]).map(r=>indexes.map(i=>i<0?'':r[i]??''))]];
  }));
}
export function costosDesdeLibro(wb,archivo='Planilla de costos') {
  return {...buildHistorialCostos(wb.SheetNames,n=>XLSX.utils.sheet_to_json(wb.Sheets[n],{header:1,raw:true,defval:''})),archivo};
}
function libro(payload) {
  if(payload?.xlsx){
    const bytes=Buffer.from(payload.xlsx,'base64');
    if(bytes.length>30*1024*1024||bytes[0]!==80||bytes[1]!==75)throw new Error('El archivo de Google no es un XLSX válido o supera 30 MB.');
    return XLSX.read(bytes,{type:'buffer',cellDates:true});
  }
  return null;
}
export function normalizarFuentes(payload) {
  let costos=payload.costos,central=payload.central,gestion=payload.gestion;
  const wc=libro(costos),wp=libro(central),wg=libro(gestion);
  if(wc)costos=costosDesdeLibro(wc,costos.archivo);
  else if(costos?.filas)costos={...costos,pares:costos.filas,historial:costos.historial?.map(c=>({...c,pares:c.pares||c.filas}))};
  if(!costos?.pares?.length)throw new Error('El puente no devolvió costos válidos.');
  if(wp)central=Object.fromEntries([['postventa','Postventa'],['minorista','Preventa Minorista'],['volumen','Preventa Volumen']].map(([k,n])=>{
    if(!wp.Sheets[n])throw new Error('Falta '+n+' en la central');
    return [k,XLSX.utils.sheet_to_json(wp.Sheets[n],{header:1,raw:true,defval:''})];
  }));
  central=recortarCentral(central);
  if(wg)gestion={...libroDesdeXlsx(wg,XLSX,gestion.archivo),actualizado:gestion.actualizado};
  if(!gestion?.hojas)throw new Error('El puente no devolvió la planilla de gestión.');
  return {costos,central,gestion};
}
export async function leerFuentes({url=process.env.NAKU_FUENTES_URL,token=process.env.NAKU_FUENTES_TOKEN,fetcher=fetch}={}) {
  if(!url||!token)throw Object.assign(new Error('La conexión de las tres planillas todavía no está configurada.'),{status:503});
  const u=new URL(url);
  if(u.protocol!=='https:'||u.hostname!=='script.google.com'||!u.pathname.endsWith('/exec'))throw new Error('URL de fuentes inválida.');
  const r=await fetcher(u,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token,action:'todo'}),redirect:'follow',signal:AbortSignal.timeout(120000)});
  if(!r.ok)throw new Error('Google no respondió al sincronizar las planillas ('+r.status+').');
  let data;try{data=await r.json();}catch{throw new Error('Google no devolvió datos. Revisá la autorización del puente.');}
  if(!data.ok)throw new Error(data.error||'No se pudieron leer las planillas.');
  const normalized=normalizarFuentes(data);
  const revision=createHash('sha256').update(JSON.stringify(normalized)+new Date().toISOString().slice(0,7)).digest('hex');
  return {...normalized,sincronizacion:{revision,actualizado:new Date().toISOString(),origen:'Google · tres planillas'}};
}
