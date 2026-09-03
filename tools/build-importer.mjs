// build-importer.mjs — arma docs/importar.js, el motor del tablero corriendo en el
// navegador.
//
//   node tools/build-importer.mjs
//
// El tablero de dirección tiene un botón para arrastrar los exports de los
// canales y ver los números al instante, sin terminal. Para eso necesita el mismo
// motor que usa el build, pero como script clásico: acá se toman los módulos de
// src/, se les sacan los import/export y se envuelve cada uno en su propio ámbito.
//
// Por qué cada uno en el suyo: engine.mjs y finanzas.mjs declaran los dos un
// `MESES_ES`. Concatenados sin más, el navegador corta con "identificador ya
// declarado" y el importer no arranca.
//
// Los costos y el maestro se embeben del último build: son los que ya usó el
// tablero publicado, así lo que se calcula en el navegador coincide con lo que se
// ve. Se regeneran cuando cambien.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'docs', 'importar.js');
const DATA = process.env.NAKU_DATA || path.resolve(ROOT, '..', 'Naku Datos');

function fatal(m) { console.error('✗ ' + m); process.exit(1); }

/** Los nombres que un módulo exporta, para armarle el `return`. */
function exportados(codigo) {
  const nombres = new Set();
  const re = /^export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm;
  let m;
  while ((m = re.exec(codigo))) nombres.add(m[1]);
  return [...nombres];
}

/**
 * Convierte un módulo ESM en una fábrica con ámbito propio.
 * Los `import … from './x.mjs'` se resuelven contra los módulos ya construidos.
 */
function envolver(nombre, archivo, disponibles) {
  let codigo = fs.readFileSync(path.join(SRC, archivo), 'utf8');

  // import { a, b } from './costos.mjs';  →  const { a, b } = __costos;
  codigo = codigo.replace(
    /^import\s+\{([^}]+)\}\s+from\s+'\.\/([\w.-]+)\.mjs';?$/gm,
    (linea, simbolos, mod) => {
      if (!disponibles.includes(mod)) fatal(`${archivo} importa de "${mod}", que todavía no se construyó`);
      return `const {${simbolos}} = __${mod};`;
    },
  );
  if (/^\s*import\s/m.test(codigo)) {
    fatal(`${archivo} tiene un import que no supe traducir:\n  ${/^\s*import\s.*/m.exec(codigo)[0]}`);
  }

  const nombres = exportados(codigo);
  if (!nombres.length) fatal(`${archivo} no exporta nada`);
  codigo = codigo.replace(/^export\s+/gm, '');

  return {
    nombres,
    js: `/* ── ${archivo} ── */\nconst __${nombre} = (function () {\n${codigo}\n`
      + `  return { ${nombres.join(', ')} };\n})();\n`,
  };
}

/* ---------------------------------------------------------------- el motor */
const construidos = [];
const partes = [];
for (const [nombre, archivo] of [['costos', 'costos.mjs'], ['engine', 'engine.mjs'],
  ['finanzas', 'finanzas.mjs'], ['postventa', 'postventa.mjs'], ['tablero', 'tablero.mjs']]) {
  const r = envolver(nombre, archivo, construidos);
  construidos.push(nombre);
  partes.push(r.js);
  console.log(`· ${archivo}: ${r.nombres.length} símbolos`);
}

/* ---------------------------------------------------------------- datos embebidos
   El maestro (nombre y familia por SKU) y los costos del mes: sin ellos el
   navegador podría contar unidades pero no calcular margen ni agrupar familias. */
function leerMaestro() {
  const local = fs.readdirSync(DATA).find((f) => /SKU.*Buyer.*\.csv$/i.test(f));
  if (local) return fs.readFileSync(path.join(DATA, local), 'utf8');
  // Segunda opción: el que quedó embebido en el tablero de ventas.
  const nueva = path.join(ROOT, 'docs', 'nueva.html');
  if (fs.existsSync(nueva)) {
    const m = /id="maestroCSV"[^>]*>([\s\S]*?)<\/script>/.exec(fs.readFileSync(nueva, 'utf8'));
    if (m) return m[1].trim();
  }
  fatal('no encontré el maestro de SKU (ni en los datos ni en docs/nueva.html)');
  return '';
}

const jsonTablero = path.join(ROOT, 'docs', 'data', 'direccion.json');
if (!fs.existsSync(jsonTablero)) fatal('falta docs/data/direccion.json — corré antes: npm run tablero');
const tablero = JSON.parse(fs.readFileSync(jsonTablero, 'utf8'));

// Los costos salen de la planilla del mes; se embeben como pares [sku, costo].
let costosPares = [];
const fCostos = fs.existsSync(DATA)
  ? fs.readdirSync(DATA).find((f) => /PLANILLA.?MADRE.*\.xlsx$/i.test(f)) : null;
if (fCostos) {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(fs.readFileSync(path.join(DATA, fCostos)), { type: 'buffer' });
  const { hojasPorMes, buildCostos } = await import('../src/costos.mjs');
  const cand = hojasPorMes(wb.SheetNames)[0];
  if (cand) {
    const c = buildCostos(
      XLSX.utils.sheet_to_json(wb.Sheets[cand.hoja], { header: 1, raw: true, defval: '' }),
      cand.hoja, cand.mes,
    );
    costosPares = [...c.costo.entries()];
    console.log(`· costos embebidos: ${costosPares.length} SKU de "${cand.hoja}"`);
  }
}
if (!costosPares.length) {
  console.warn('⚠ sin costos embebidos: el importer va a poder mostrar ventas, no margen');
}

const maestro = leerMaestro();
console.log(`· maestro embebido: ${maestro.split('\n').length} filas`);

/* ---------------------------------------------------------------- salida */
const cabecera = `/* ============================================================
   Motor del tablero, para el navegador. GENERADO — no editar a mano.
   Se arma con: node tools/build-importer.mjs
   Fuente: src/costos.mjs, src/engine.mjs, src/finanzas.mjs, src/postventa.mjs
   Generado el ${new Date().toISOString().slice(0, 10)}
   ============================================================ */
`;

const cola = `
/* ── datos que el motor necesita y no vienen en los exports ── */
const NAKU_MAESTRO_CSV = ${JSON.stringify(maestro)};
const NAKU_COSTOS = ${JSON.stringify(costosPares)};
const NAKU_MES_COSTOS = ${JSON.stringify(tablero.fuentes.costos.hoja || '')};

/* ── lo que usa el importer del tablero ── */
window.NakuMotor = {
  costos: __costos,
  engine: __engine,
  finanzas: __finanzas,
  postventa: __postventa,
  tablero: __tablero,
  maestroCSV: NAKU_MAESTRO_CSV,
  costosPares: NAKU_COSTOS,
  mesCostos: NAKU_MES_COSTOS,
};
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, cabecera + partes.join('\n') + cola);
const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log(`✓ ${path.relative(ROOT, OUT)} — ${kb} KB`);

// Que sea JS válido se comprueba acá, no en el navegador de alguien.
try {
  // eslint-disable-next-line no-new-func
  new Function('window', fs.readFileSync(OUT, 'utf8'));
  console.log('✓ sintaxis verificada');
} catch (e) {
  fatal(`el archivo generado no es JS válido: ${e.message}`);
}
