// actualizar.mjs — el único comando de la rutina mensual.
//
//   npm run actualizar
//
// Hace, en orden:
//   1. baja las planillas de Google (costos y central de atención)
//   2. procesa los exports de los canales que haya en el directorio de datos
//   3. regenera docs/data/direccion.json
//   4. si cambió, lo commitea y lo publica
//
// Después de eso, GitHub Pages redeploya solo en un minuto. Nadie toca el HTML.
//
//   npm run actualizar -- --sin-publicar    regenera y no toca git
//   NAKU_DATA="/ruta" npm run actualizar    datos en otro lado

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const JSON_SALIDA = path.join(ROOT, 'docs', 'data', 'direccion.json');

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
paso(2, 'Novedades');
console.log(`   mes cerrado    ${datos.mesCerrado.largo}`);
console.log(`   órdenes        ${datos.vistas.todos.mes.eerr.ordenes.toLocaleString('es-AR')}`);
const linea = (c) => (datos.vistas.todos.mes.eerr.lineas.find((l) => l.c === c) || {}).pct;
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
  console.log('\n✓ Listo (--sin-publicar): el JSON quedó actualizado sin tocar git.');
  process.exit(0);
}

/* ---------------------------------------------------------------- 4: publicar */
paso(3, 'Publicando');

let rama;
try {
  rama = git('rev-parse', '--abbrev-ref', 'HEAD');
} catch {
  salir('esto no parece un repo git');
}

const sucio = git('status', '--porcelain', '--', 'docs/data/direccion.json');
if (!sucio) {
  console.log('   git no ve cambios en el JSON; nada para publicar.');
  process.exit(0);
}

// Sólo se publica el JSON: si hay otros cambios en curso, quedan donde están.
const otros = git('status', '--porcelain').split('\n')
  .filter((l) => l.trim() && !l.includes('docs/data/direccion.json'));
if (otros.length) {
  console.log(`   (quedan ${otros.length} cambio(s) sin commitear que no se tocan)`);
}

git('add', 'docs/data/direccion.json');
const mensaje = `Actualiza el tablero — ${datos.mesCerrado.largo}, generado el ${datos.generado}`;
git('commit', '-m', mensaje);
console.log(`   commit: ${mensaje}`);

let empujado = false;
for (let intento = 1; intento <= 4 && !empujado; intento++) {
  const r = spawnSync('git', ['push', 'origin', `HEAD:${rama}`], { cwd: ROOT, encoding: 'utf8' });
  if (r.status === 0) { empujado = true; break; }
  const espera = 2 ** intento;
  console.log(`   push falló (intento ${intento}/4), reintento en ${espera}s…`);
  if (intento < 4) execFileSync(process.execPath, ['-e', `setTimeout(()=>{}, ${espera * 1000})`]);
}
if (!empujado) salir('el commit quedó hecho pero el push falló. Reintentá con: git push');

console.log('\n✓ Publicado. GitHub Pages actualiza el tablero en un minuto:');
console.log('  https://agustin-calcuta.github.io/naku-tablero/direccion.html');
