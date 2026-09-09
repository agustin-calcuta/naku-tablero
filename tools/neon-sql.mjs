import {execFileSync} from 'node:child_process';
export async function applySchema(sql, source) {
  // Los cuerpos de las funciones usan $$; los ; interiores no separan DDL.
  for(const statement of source.match(/(?:\$\$[\s\S]*?\$\$|[^;])+;/g)||[])await sql(statement);
}
export function connection(branch='br-wispy-lake-ayf0dl28') {
  const raw=execFileSync('neon',['connection-string',branch,'--project-id','flat-fire-69274162','--role-name','neondb_owner'],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
  const cs=raw.match(/postgres(?:ql)?:\/\/[^\s"']+/)?.[0];
  if(!cs)throw new Error('No se pudo obtener la conexión a Neon.');
  return async(query,params=[])=>{
    const r=await fetch('https://'+new URL(cs).host+'/sql',{method:'POST',headers:{'content-type':'application/json','neon-connection-string':cs},body:JSON.stringify({query,params}),signal:AbortSignal.timeout(60000)});
    const data=await r.json();
    if(!r.ok)throw Object.assign(new Error(data.message||'Error SQL'),{status:Number(/^PT(\d{3})$/.exec(data.code||'')?.[1])||502});
    return data;
  };
}
