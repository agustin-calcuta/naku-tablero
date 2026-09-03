// instalar-puente.mjs — crea y publica el Apps Script que le da las planillas al
// tablero, sin abrir el navegador más que una vez.
//
//   npx @google/clasp@2.4.2 login     ← una sola vez, autorizás con tu cuenta
//   npm run instalar-puente
//
// Hace todo lo demás: genera un token al azar, crea el proyecto, sube el código,
// lo publica como aplicación web configurada para ejecutarse con TU cuenta, y
// guarda la URL y el token en .naku-puente.json (que git ignora).
//
// Por qué el login no se puede automatizar: el script lee las planillas con tu
// acceso, y Google exige que esa autorización la des vos. Es justamente lo que
// evita tener que compartir las planillas con nadie.
//
//   npm run instalar-puente -- --actualizar   sube cambios al proyecto que ya existe

import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FUENTE = path.join(ROOT, 'appsscript', 'fuentes');
const CREDS = path.join(ROOT, '.naku-puente.json');
const CLASP = ['@google/clasp@2.4.2'];

const actualizar = process.argv.includes('--actualizar');
const neg = (t) => `\u001b[1m${t}\u001b[0m`;
const tenue = (t) => `\u001b[2m${t}\u001b[0m`;

function salir(msg, ayuda) {
  console.error(`\n✗ ${msg}`);
  if (ayuda) console.error(`\n${ayuda}`);
  process.exit(1);
}

function clasp(args, opciones = {}) {
  const r = spawnSync('npx', ['-y', ...CLASP, ...args], {
    cwd: opciones.cwd || FUENTE,
    encoding: 'utf8',
    stdio: opciones.mostrar ? 'inherit' : 'pipe',
  });
  return { ok: r.status === 0, salida: `${r.stdout || ''}${r.stderr || ''}`.trim(), status: r.status };
}

/* ---------------------------------------------------------------- 0. requisitos */
console.log(neg('\nPuente de fuentes — instalación\n'));

const sesion = path.join(os.homedir(), '.clasprc.json');
if (!fs.existsSync(sesion)) {
  salir('todavía no iniciaste sesión en Apps Script.',
    `Corré esto una vez (abre el navegador, entrás con la cuenta que tiene las planillas):\n\n`
    + `  ${neg('npx @google/clasp@2.4.2 login')}\n\n`
    + `Y después volvé a correr:\n\n  ${neg('npm run instalar-puente')}\n`);
}
console.log('✓ sesión de Apps Script iniciada');

// La API de Apps Script se habilita una vez por cuenta, desde una página web.
const API = 'https://script.google.com/home/usersettings';

/* ---------------------------------------------------------------- 1. configuración */
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'naku.config.json'), 'utf8'));
const idCostos = (config.costos || {}).idPlanilla || '1XQeYyMcS9LRv2wXmbsf_9hYj0o2vrrJU';
const idCentral = (config.postventa || {}).idPlanilla || '1Of9JnLdQu3y4wrAoIU26mjxGk1nIHwewamsIdfHiej0';

let previo = fs.existsSync(CREDS) ? JSON.parse(fs.readFileSync(CREDS, 'utf8')) : null;
const token = (previo && previo.token) || crypto.randomBytes(24).toString('hex');
if (previo) console.log('✓ reuso el token que ya estaba en .naku-puente.json');
else console.log('✓ token nuevo generado (48 caracteres)');

/* ---------------------------------------------------------------- 2. código a subir
   El fuente del repo queda con CONFIG vacío: los ids y el token se inyectan en la
   copia que va a Google, así el token no termina versionado. */
const fuente = fs.readFileSync(path.join(FUENTE, 'Codigo.gs'), 'utf8');
const conValores = fuente
  .replace(/COSTOS_ID:\s*'[^']*'/, `COSTOS_ID: '${idCostos}'`)
  .replace(/CENTRAL_ID:\s*'[^']*'/, `CENTRAL_ID: '${idCentral}'`)
  .replace(/TOKEN:\s*'[^']*'/, `TOKEN: '${token}'`);

for (const [campo, valor] of [['COSTOS_ID', idCostos], ['CENTRAL_ID', idCentral], ['TOKEN', token]]) {
  if (!conValores.includes(`${campo}: '${valor}'`)) {
    salir(`no pude inyectar ${campo} en Codigo.gs — ¿cambió el formato de CONFIG?`);
  }
}

const taller = fs.mkdtempSync(path.join(os.tmpdir(), 'naku-puente-'));
fs.writeFileSync(path.join(taller, 'Codigo.js'), conValores);
fs.copyFileSync(path.join(FUENTE, 'appsscript.json'), path.join(taller, 'appsscript.json'));

/* ---------------------------------------------------------------- 3. el proyecto */
const claspJson = path.join(taller, '.clasp.json');
let scriptId = previo && previo.scriptId;

if (scriptId && actualizar) {
  fs.writeFileSync(claspJson, JSON.stringify({ scriptId, rootDir: taller }));
  console.log(`✓ actualizo el proyecto que ya existe (${scriptId.slice(0, 12)}…)`);
} else {
  if (scriptId) {
    console.log(tenue(`  (ya había un proyecto: ${scriptId.slice(0, 12)}… — para actualizarlo usá --actualizar)`));
  }
  console.log('\n· creando el proyecto en Apps Script…');
  const r = clasp(['create', '--type', 'standalone', '--title', 'Naku · Fuentes del tablero',
    '--rootDir', taller], { cwd: taller });
  if (!r.ok) {
    if (/User has not enabled the Apps Script API/i.test(r.salida)) {
      salir('la API de Apps Script está apagada en tu cuenta.',
        `Es un interruptor, se prende una vez:\n\n  1. Abrí ${neg(API)}\n`
        + `  2. Poné "API de Google Apps Script" en ${neg('Activado')}\n`
        + `  3. Volvé a correr ${neg('npm run instalar-puente')}\n`);
    }
    if (/No refresh token|invalid_grant|Could not read API credentials/i.test(r.salida)) {
      salir('la sesión de Apps Script venció.',
        `Volvé a entrar:\n\n  ${neg('npx @google/clasp@2.4.2 login')}\n`);
    }
    // La salida de npx trae avisos de paquetes viejos que no ayudan a nadie.
    const limpio = r.salida.split('\n')
      .filter((l) => !/^npm warn|DeprecationWarning|--trace-deprecation/.test(l.trim()))
      .join('\n').trim();
    salir(`clasp no pudo crear el proyecto:\n\n${limpio}`);
  }
  const m = /scriptId["':\s]+([A-Za-z0-9_-]{20,})/.exec(r.salida)
    || /projects\/([A-Za-z0-9_-]{20,})/.exec(r.salida);
  if (fs.existsSync(claspJson)) scriptId = JSON.parse(fs.readFileSync(claspJson, 'utf8')).scriptId;
  if (!scriptId && m) scriptId = m[1];
  if (!scriptId) salir(`el proyecto se creó pero no pude leer su id:\n\n${r.salida}`);
  console.log(`✓ proyecto creado (${scriptId.slice(0, 12)}…)`);
}

/* ---------------------------------------------------------------- 4. subir y publicar */
console.log('· subiendo el código…');
const push = clasp(['push', '-f'], { cwd: taller });
if (!push.ok) salir(`no pude subir el código:\n\n${push.salida}`);
console.log('✓ código subido');

console.log('· publicando como aplicación web…');
const deploy = clasp(['deploy', '--description', `tablero ${new Date().toISOString().slice(0, 10)}`],
  { cwd: taller });
if (!deploy.ok) salir(`no pude publicar:\n\n${deploy.salida}`);

const idDeploy = (/AKfyc[A-Za-z0-9_-]+/.exec(deploy.salida) || [])[0];
if (!idDeploy) salir(`se publicó pero no pude leer la URL:\n\n${deploy.salida}`);
const url = `https://script.google.com/macros/s/${idDeploy}/exec`;
console.log('✓ publicado');

/* ---------------------------------------------------------------- 5. guardar */
fs.writeFileSync(CREDS, `${JSON.stringify({
  scriptId, deploymentId: idDeploy, url, token, actualizado: new Date().toISOString(),
}, null, 2)}\n`);
fs.rmSync(taller, { recursive: true, force: true });

/* ---------------------------------------------------------------- 6. probar */
console.log('\n· probando el puente…');
let anduvo = false;
for (let intento = 1; intento <= 3; intento++) {
  try {
    const res = await fetch(`${url}?action=ping&token=${token}`, {
      redirect: 'follow', signal: AbortSignal.timeout(30000),
    });
    const t = await res.text();
    if (t.includes('pong')) { anduvo = true; break; }
    if (t.trim().startsWith('<')) {
      // La primera vez Google pide autorizar los permisos del script.
      console.log(tenue(`  (intento ${intento}: todavía no responde)`));
    }
  } catch { /* reintento */ }
  if (intento < 3) execFileSync(process.execPath, ['-e', 'setTimeout(()=>{},5000)']);
}

console.log(neg('\n' + '─'.repeat(64)));
if (anduvo) {
  console.log(neg('\n✓ El puente quedó andando.\n'));
} else {
  console.log(neg('\n⚠ El puente está publicado pero todavía no contesta.\n'));
  console.log('Falta autorizar los permisos, que es el único paso que tenés que dar vos:\n');
  console.log(`  1. Abrí ${neg('https://script.google.com')} → "Naku · Fuentes del tablero"`);
  console.log(`  2. Arriba, elegí la función ${neg('probar')} y tocá ${neg('Ejecutar')}`);
  console.log('  3. Google va a pedir permiso para leer tus planillas: aceptá');
  console.log('     (va a decir "no verificada" — es tu propio script, entrá en');
  console.log('      "Configuración avanzada" → "Ir a Naku · Fuentes del tablero")');
  console.log('  4. En el registro tenés que ver los SKU y los casos que encontró\n');
}

console.log('Para que el tablero lo use, agregá esto al final de tu ~/.zshrc:\n');
console.log(`  export NAKU_FUENTES_URL="${url}"`);
console.log(`  export NAKU_FUENTES_TOKEN="${token}"`);
console.log(`\n${tenue('(también quedó guardado en .naku-puente.json, que git ignora)')}`);
console.log('\nY después:\n');
console.log(`  ${neg('npm run tablero')}   ${tenue('→ la primera línea tiene que nombrar el puente')}\n`);
