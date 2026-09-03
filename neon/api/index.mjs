/* ============================================================
   API del tablero de dirección — Neon Function del proyecto naku-tablero.

   Guarda un único documento: el JSON que arma el tablero. Sirve para que
   cuando alguien carga los exports desde el navegador, el tablero se
   actualice para todos y no sólo en su computadora.

     GET  /            → el tablero publicado
     GET  /estado      → cuándo y quién publicó, sin bajar los 180 KB
     GET  /versiones   → las últimas publicaciones (pide la clave)
     PUT  /            → publica (pide la clave)
     PUT  /volver?n=N  → vuelve a una versión anterior (pide la clave)

   Leer es público —el tablero ya vive en una URL pública—; escribir pide
   la clave, que viaja en el header x-naku-clave.

   Acá no hay lógica: la validación de la clave y la escritura viven en la
   base, en las funciones publicar() / volver() / versiones() (ver
   neon/api/esquema.sql). Esto es sólo el puente HTTP, para poder llamarlas
   desde el navegador sin exponer la conexión a Postgres.

   Se habla con Postgres por HTTP y no con el driver `pg` a propósito: el
   paquete que hay que subir queda en 3 KB en vez de 27 KB. Es el mismo
   transporte que usa @neondatabase/serverless.

   Se despliega con: node tools/build-api.mjs --deploy
   ============================================================ */

const CS = process.env.DATABASE_URL;
const SQL_URL = `https://${new URL(CS).host}/sql`;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, PUT, OPTIONS',
  'access-control-allow-headers': 'content-type, x-naku-clave, x-naku-quien',
  'access-control-max-age': '86400',
};

const json = (cuerpo, status = 200) => new Response(JSON.stringify(cuerpo), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS },
});

/** Un error de la base que ya trae su propio código HTTP (PT401, PT400, PT404). */
class ErrorSql extends Error {
  constructor(mensaje, status) { super(mensaje); this.status = status; }
}

async function sql(query, params = []) {
  const r = await fetch(SQL_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'neon-connection-string': CS },
    body: JSON.stringify({ query, params }),
    signal: AbortSignal.timeout(25000),
  });
  const texto = await r.text();
  if (r.ok) return JSON.parse(texto);

  let e = {};
  try { e = JSON.parse(texto); } catch { /* la base contestó algo que no es JSON */ }
  // Las funciones de la base marcan con PT### el código HTTP que corresponde.
  const codigo = /^PT(\d{3})$/.exec(e.code || '');
  if (codigo) throw new ErrorSql(e.message, Number(codigo[1]));
  console.error('sql:', r.status, texto.slice(0, 500));
  throw new ErrorSql('No pude hablar con la base.', 502);
}

const primera = (r) => (r.rows && r.rows.length ? r.rows[0] : null);

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const ruta = url.pathname.replace(/\/+$/, '') || '/';
    const clave = request.headers.get('x-naku-clave') || '';
    const quien = (request.headers.get('x-naku-quien') || '').slice(0, 80) || null;

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    try {
      if (request.method === 'GET') {
        if (ruta === '/estado') {
          const f = primera(await sql(
            'select generado, actualizado, quien from tablero where id = $1', ['direccion']));
          return json(f ? { hay: true, ...f } : { hay: false });
        }

        if (ruta === '/versiones') {
          const r = await sql('select * from versiones($1)', [clave]);
          return json({ versiones: r.rows });
        }

        if (ruta !== '/') return json({ error: 'No existe esa ruta.' }, 404);

        const f = primera(await sql(
          'select datos, actualizado, quien from tablero where id = $1', ['direccion']));
        if (!f) return json({ hay: false }, 404);
        return json({ hay: true, publicado: f.actualizado, quien: f.quien, datos: f.datos });
      }

      if (request.method === 'PUT') {
        if (ruta === '/volver') {
          const n = Number(url.searchParams.get('n'));
          if (!Number.isInteger(n) || n <= 0) return json({ error: 'Falta el número de versión.' }, 400);
          return json(primera(await sql('select volver($1, $2) as r', [clave, n])).r);
        }

        if (ruta !== '/') return json({ error: 'No existe esa ruta.' }, 404);

        // 8 MB: el tablero pesa 180 KB, así que esto sólo frena algo mal armado.
        if (Number(request.headers.get('content-length') || 0) > 8 * 1024 * 1024) {
          return json({ error: 'El tablero pesa demasiado.' }, 413);
        }
        const cuerpo = await request.text();
        try { JSON.parse(cuerpo); } catch { return json({ error: 'El cuerpo no es JSON.' }, 400); }

        return json(primera(await sql(
          'select publicar($1, $2::jsonb, $3) as r', [clave, cuerpo, quien])).r);
      }

      return json({ error: 'Método no permitido.' }, 405);
    } catch (e) {
      if (e instanceof ErrorSql) return json({ error: e.message }, e.status);
      console.error('error:', e && e.stack ? e.stack : e);
      return json({ error: 'Error del servidor.' }, 500);
    }
  },
};
