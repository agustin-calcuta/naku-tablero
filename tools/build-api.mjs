// build-api.mjs — empaqueta neon/api/index.mjs para Neon Functions.
//
//   node tools/build-api.mjs            → deja .backup/api.zip
//   node tools/build-api.mjs --deploy   → además lo publica (pide NEON_API_KEY)
//
// El runtime de Neon busca un index.mjs en la raíz del zip, así que primero
// se arma un bundle ESM con esbuild (que trae adentro pg y sus dependencias) y
// después se comprime ese único archivo.
//
// El banner no es decorativo: pg usa require/__dirname por adentro y sin eso
// el bundle explota en el arranque con "Dynamic require of ... is not supported".
//
// Va minificado: el fuente legible es neon/api/index.mjs, esto es sólo el
// paquete que se sube. Los mensajes de error de pg siguen llegando enteros a los
// logs (neon functions logs tablero); lo que se pierde son los nombres internos.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRADA = path.join(ROOT, 'neon', 'api', 'index.mjs');
const SALIDA = path.join(ROOT, '.backup', 'api.zip');

const PROYECTO = 'flat-fire-69274162';
const RAMA = 'br-wispy-lake-ayf0dl28';
const SLUG = 'tablero';

const BANNER = "import{createRequire as ___cr}from'module';import{fileURLToPath as ___f}from'url';"
  + "import{dirname as ___d}from'path';const require=___cr(import.meta.url);"
  + 'const __filename=___f(import.meta.url);const __dirname=___d(__filename);';

function fatal(m) { console.error(`✗ ${m}`); process.exit(1); }

const taller = fs.mkdtempSync(path.join(os.tmpdir(), 'naku-api-'));
const bundle = path.join(taller, 'index.mjs');

console.log('· empaquetando…');
try {
  execFileSync('npx', ['--yes', 'esbuild@0.25', ENTRADA, '--bundle', '--platform=node',
    '--target=node24', '--format=esm', '--minify', `--banner:js=${BANNER}`, `--outfile=${bundle}`],
  { stdio: ['ignore', 'pipe', 'inherit'], cwd: ROOT });
} catch {
  fatal('esbuild falló. Probá: npm i -g esbuild');
}

// pg trae dependencias opcionales (pg-native) que esbuild resuelve igual; si el
// bundle no arranca, esto lo dice acá y no en producción.
const js = fs.readFileSync(bundle, 'utf8');
if (!/export\s*\{|export default/.test(js)) fatal('el bundle no exporta nada — ¿cambió la entrada?');

fs.mkdirSync(path.dirname(SALIDA), { recursive: true });
fs.rmSync(SALIDA, { force: true });
execFileSync('zip', ['-j', '-q', SALIDA, bundle]);
fs.rmSync(taller, { recursive: true, force: true });
console.log(`✓ ${path.relative(ROOT, SALIDA)} — ${(fs.statSync(SALIDA).size / 1024).toFixed(0)} KB`);

/* ---------------------------------------------------------------- publicar */
if (!process.argv.includes('--deploy')) {
  console.log('\n(para publicarlo: node tools/build-api.mjs --deploy, con NEON_API_KEY en el entorno)');
  process.exit(0);
}

const key = process.env.NEON_API_KEY;
if (!key) fatal('falta NEON_API_KEY — sacala de https://console.neon.tech/app/settings/api-keys');

const clave = process.env.NAKU_CLAVE;
const forma = new FormData();
forma.append('zip', new Blob([fs.readFileSync(SALIDA)], { type: 'application/zip' }), 'api.zip');
forma.append('runtime', 'nodejs24');
// Si no se pasa NAKU_CLAVE, la que ya tiene el deploy anterior queda como está.
if (clave) forma.append('environment', JSON.stringify({ NAKU_CLAVE: clave }));

const res = await fetch(
  `https://console.neon.tech/api/v2/projects/${PROYECTO}/branches/${RAMA}/functions/${SLUG}/deployments`,
  { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: forma },
);
const cuerpo = await res.text();
if (!res.ok) fatal(`Neon rechazó el deploy (${res.status}):\n${cuerpo}`);
console.log(`✓ publicado: ${cuerpo}`);
