// actualizar.mjs — el único comando de la rutina mensual.
//
//   npm run actualizar
//
// Hace, en orden:
//   1. baja las planillas de Google (costos y central de atención)
//   2. procesa los exports de los canales que haya en el directorio de datos
//   3. regenera datos/direccion.json
//   4. si cambió, lo sube a la base — que es lo que lee el tablero
//
// El JSON no se commitea: tiene el estado de resultados y el repositorio es
// público. Queda en datos/, que git ignora. Lo mismo hace el botón "Actualizar
// datos" del navegador, así que las dos vías terminan en el mismo lugar.
//
//   npm run actualizar -- --sin-publicar    regenera y no sube nada
//   NAKU_DATA="/ruta" npm run actualizar    datos en otro lado
//   NAKU_CLAVE="naku-…"                     clave para publicar

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const JSON_SALIDA = path.join(ROOT, 'datos', 'direccion.json');

const publicar = !process.argv.includes('--sin-publicar');
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

function paso(n, texto) { console.log(`\n[1m${n}. ${texto}[0m`); }
function salir(msg, codigo = 1) { console.error(`\n✗ ${msg}`); process.exit(codigo); }

/* ---------------------------------------------------------------- 1 y 2: el build */
paso(1, 'Bajando planillas y procesando exports');

const antes = fs.existsSync(JSON_SALIDA) ? fs.readFileSync(JSON_SALIDA, 'utf8') : null;
const build = spawnSync(process.execPath, [path.join(HERE, 'build-direccion.mjs')], {
  cwd: ROOT, stdio: 'inherit', env: process.env,
});
if (build.status !== 0) salir('el build falló; no se publicó nada');

const despues = fs.readFileSync(JSON_SALIDA, 'utf8');

/* ---------------------------------------------------------------- 3: ¿cambió algo? */
// El campo `generado` cambia todos los días aunque los datos sean los mismos:
// se ignora para no publicar commits vacíos de contenido.
const sinFecha = (t) => (t || '').replace(/"generado":\s*"[^"]*"/, '');
if (antes && sinFecha(antes) === sinFecha(despues)) {
  console.log('\n✓ El tablero ya estaba al día: no hay nada nuevo que publicar.');
  process.exit(0);
}

const datos = JSON.parse(despues);
// Los períodos dependen de cuántos meses haya cargados: se informa el primero
// que tenga datos, no uno fijo que puede no existir.
const periodo = (datos.periodos || []).find((x) => x.disponible) || { id: 'm3', n: '—' };
const eerr = ((datos.vistas.todos || {})[periodo.id] || {}).eerr || { lineas: [], ordenes: 0 };
paso(2, 'Novedades');
console.log(`   mes cerrado    ${datos.mesCerrado.largo}`);
console.log(`   período        ${periodo.n}`);
console.log(`   órdenes        ${eerr.ordenes.toLocaleString('es-AR')}`);
const linea = (c) => (eerr.lineas.find((l) => l.c === c) || {}).pct;
console.log(`   margen bruto   ${linea('Margen bruto')}%`);
console.log(`   contribución   ${linea('Resultado de contribución')}%`);
if (datos.clientes) {
  console.log(`   postventa      ${datos.clientes.postventa.total} casos · ${datos.clientes.postventa.abiertos} abiertos`);
}
for (const [k, v] of Object.entries(datos.fuentes.origen || {})) {
  if (v.origen === 'local-viejo') {
    console.log(`   ⚠ ${k}: se usó una copia de hace ${v.dias} día(s) — ${v.motivo}`);
  }
}

if (!publicar) {
  console.log('\n✓ Listo (--sin-publicar): el JSON quedó actualizado sin subirlo a ningún lado.');
  process.exit(0);
}

/* ---------------------------------------------------------------- 4: publicar */
paso(3, 'Publicando');

const API = 'https://br-wispy-lake-ayf0dl28-tablero.compute.c-5.us-east-2.aws.neon.tech';
const clave = process.env.NAKU_CLAVE;
if (!clave) {
  salir('falta NAKU_CLAVE. El JSON quedó en datos/direccion.json, pero sin la clave '
    + 'no lo puedo subir y el tablero va a seguir mostrando lo anterior.\n\n'
    + '  export NAKU_CLAVE="naku-…"   (ponelo en tu ~/.zshrc)');
}

let subido = false;
for (let intento = 1; intento <= 3 && !subido; intento++) {
  try {
    const r = await fetch(`${API}/`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-naku-clave': clave,
        'x-naku-quien': process.env.USER || 'consola',
      },
      body: despues,
      signal: AbortSignal.timeout(60000),
    });
    const j = await r.json().catch(() => ({}));
    // Una clave mal puesta no se arregla reintentando.
    if (r.status === 401) salir('la clave de NAKU_CLAVE no es la que espera la base');
    if (!r.ok || !j.ok) salir(`la base rechazó la publicación: ${j.error || r.status}`);
    subido = true;
  } catch (e) {
    const espera = 2 ** intento;
    console.log(`   falló (${e.message}); reintento en ${espera}s…`);
    if (intento < 3) execFileSync(process.execPath, ['-e', `setTimeout(()=>{}, ${espera * 1000})`]);
  }
}
if (!subido) salir('no pude subirlo. El JSON quedó en datos/direccion.json; probá de nuevo.');

console.log('\n✓ Publicado. Ya lo ve cualquiera que abra el tablero:');
console.log('  https://agustin-calcuta.github.io/naku-tablero/direccion.html');
