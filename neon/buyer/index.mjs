import { createHandler } from './handler.mjs';
import { leerFuentes } from '../../src/fuentes-sync.mjs';

async function sql(query, params) {
  const cs=process.env.DATABASE_URL;
  const r=await fetch(`https://${new URL(cs).host}/sql`,{
    method:'POST',headers:{'content-type':'application/json','neon-connection-string':cs},
    body:JSON.stringify({query,params}),signal:AbortSignal.timeout(25000)
  });
  const result=await r.json();
  if(!r.ok) {
    const status=Number(/^PT(\d{3})$/.exec(result.code||'')?.[1]) || 502;
    throw Object.assign(new Error(status===502?'No se pudo acceder al histórico.':result.message),{status});
  }
  return result;
}
export default {fetch:createHandler(sql,{leerFuentes})};
