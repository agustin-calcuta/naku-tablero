import fs from 'node:fs';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {connection,applySchema} from './neon-sql.mjs';

const sql=connection();
await applySchema(sql,fs.readFileSync('neon/buyer/esquema.sql','utf8'));
const exists=(await sql('select exists(select 1 from buyer_estado) as hay')).rows[0].hay;
if(!exists){
  const seed=JSON.parse(fs.readFileSync('.backup/shared/seed.json'));
  // Si alguien publicó mientras se preparaba, volver a comparar con esa versión.
  const current=(await sql("select actualizado from tablero where id='direccion'")).rows[0];
  if(current.actualizado!==seed.finExpected)throw new Error('Finanzas cambió. Volvé a ejecutar prepare-shared.mjs.');
  await sql(`with seeded as (
    insert into buyer_estado(id,revision,datos,fuentes) values(1,1,$1,$2)
    on conflict(id) do nothing returning revision,datos,actualizado,fuentes
  ) insert into buyer_historial(revision,datos,actualizado,fuentes) select * from seeded`,[seed.datos,seed.fuentes]);
  console.log('✓ Histórico y fuentes iniciales guardados. Finanzas conserva su publicación actual.');
}
const hasKey=(await sql('select exists(select 1 from buyer_clave) as hay')).rows[0].hay;
if(!hasKey){
  const key='naku-buyer-'+crypto.randomBytes(12).toString('base64url');
  await sql("insert into buyer_clave values(1,encode(sha256($1::bytea),'hex'))",[key]);
  fs.mkdirSync('.backup/shared',{recursive:true});
  fs.writeFileSync('.backup/shared/acceso-buyer.txt',
    'Acceso al Buyer para Leo (también admite la clave de Finanzas).\n\n'+
    'https://agustin-calcuta.github.io/naku-tablero/nueva.html#clave='+encodeURIComponent(key)+'\n\n'+
    'Esta clave permite ver el Buyer y cargar ventas compartidas. No permite abrir Finanzas ni editar costos.\n', {mode:0o600});
  console.log('✓ Acceso propio del Buyer guardado en .backup/shared/acceso-buyer.txt (fuera de git).');
}
for(const [slug,entry] of [['buyer','neon/buyer/index.mjs'],['tablero','neon/api/index.mjs']]){
  execFileSync('neon',['functions','deploy',slug,'--project-id','flat-fire-69274162','--branch','br-wispy-lake-ayf0dl28','--src',entry,'--output','json'],{stdio:'inherit'});
}
