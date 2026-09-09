import { gzipSync, gunzipSync } from 'node:zlib';
import { packLines, parseMaestro } from '../../src/buyer.mjs';

import { buildShared } from '../../src/ventas-compartidas.mjs';

const CORS = { 'access-control-allow-origin':'*', 'access-control-allow-methods':'GET,PUT,OPTIONS', 'access-control-allow-headers':'content-type,x-naku-clave', 'access-control-max-age':'86400' };
const response = (body, status=200) => new Response(JSON.stringify(body), {status,headers:{...CORS,'content-type':'application/json','cache-control':'no-store'}});
export const encode = data => gzipSync(JSON.stringify(data)).toString('base64');
export const decode = text => JSON.parse(gunzipSync(Buffer.from(text,'base64'),{maxOutputLength:128*1024*1024}).toString('utf8'));

export function createHandler(sql) {
  const read = async (key, state=false) => (await sql('select buyer_leer($1,$2) as r',[key,state])).rows[0].r;
  return async request => {
    if(request.method==='OPTIONS') return new Response(null,{status:204,headers:CORS});
    const route = new URL(request.url).pathname.replace(/\/+$/,'') || '/';
    const key = request.headers.get('x-naku-clave') || '';
    try {
      if(request.method==='GET' && ['/', '/estado'].includes(route)) {
        const {fuentes,...data}=await read(key,route==='/estado');return response(data);
      }
      if(request.method!=='PUT' || !['/','/finanzas','/preview'].includes(route)) return response({error:'Ruta no disponible.'},404);
      // Autenticar antes de descomprimir o procesar datos.
      await read(key,true);
      if(route!=='/' && !(await sql('select puede_leer($1) as ok',[key])).rows[0].ok) return response({error:'Esta clave sólo permite actualizar el Buyer y las ventas.'},403);
      const chunks=[]; let size=0;
      for await(const chunk of request.body) {
        size+=chunk.length;
        if(size>22*1024*1024) return response({error:'La carga es demasiado grande. Subí menos archivos juntos.'},413);
        chunks.push(chunk);
      }
      let operation;
      try { operation=decode(JSON.parse(Buffer.concat(chunks).toString()).datos); }
      catch { return response({error:'No se pudo leer la carga.'},400); }
      if(!operation || typeof operation.id!=='string' || operation.id.length>100) return response({error:'Falta el identificador de carga.'},400);
      if(route==='/'&&(operation.costos||operation.central))return response({error:'Los costos y la central se actualizan desde Finanzas.'},403);
      for(let attempt=0;attempt<4;attempt++) {
        const current=await read(key);
        const data=current.datos ? decode(current.datos) : {ventas:packLines([]),maestro:'',manifest:[]};
        if(data.receipts?.[operation.id]) { const {fuentes,...visible}=current;return response({...visible,result:data.receipts[operation.id]}); }
        if(operation.maestro && operation.maestroRevision !== current.revision) return response({error:'El histórico cambió mientras editabas el maestro. Actualizá la vista y volvé a aplicar el archivo.'},409);
        const financial=(await sql("select datos,actualizado from tablero where id='direccion'",[])).rows[0];
        let merged;
        try {
          if(operation.maestro) parseMaestro(operation.maestro);
          merged=buildShared(data,current.fuentes?decode(current.fuentes):{},operation,financial?.datos);
        } catch(e) { return response({error:e.message},400); }
        merged.buyer.receipts=Object.fromEntries([...Object.entries(data.receipts||{}),[operation.id,merged.result]].slice(-100));
        if(route==='/preview')return response({finance:merged.finance,result:merged.result});
        const packed=encode(merged.buyer);
        try {
          const saved=(await sql('select buyer_guardar($1,$2,$3,$4,$5::jsonb,$6::timestamptz) as r',[key,current.revision,packed,encode(merged.sources),JSON.stringify(merged.finance),financial?.actualizado||null])).rows[0].r;
          return response({...saved,datos:packed,result:merged.result,...(route==='/finanzas'?{finance:merged.finance}:{})});
        } catch(e) { if(e.status!==409 || attempt===3) throw e; }
      }
    } catch(e) {
      if(e.status) return response({error:e.message},e.status);
      console.error('Buyer:',e.message);
      return response({error:'No se pudo guardar o consultar el Buyer. Reintentá en unos segundos.'},502);
    }
  };
}
