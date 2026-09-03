-- ============================================================
-- Esquema del tablero publicado — proyecto Neon "naku-tablero"
-- (flat-fire-69274162, rama br-wispy-lake-ayf0dl28, base neondb)
--
-- Acá vive TODA la lógica de publicar: la función de neon/api/index.mjs es
-- sólo el puente HTTP. Se hizo así porque la clave y la validación tienen
-- que estar del lado de la base, no en un archivo que se sube y se baja.
--
-- Este archivo es el registro de lo que está aplicado. Para cambiar algo,
-- editalo y corré el bloque que corresponda desde el editor SQL de Neon.
-- ============================================================

create table if not exists tablero (
  id          text primary key,          -- por ahora siempre 'direccion'
  datos       jsonb not null,            -- el JSON que arma tools/build-direccion.mjs
  generado    text,
  actualizado timestamptz not null default now(),
  quien       text
);

create table if not exists tablero_historial (
  n         bigserial primary key,
  id        text not null,
  datos     jsonb not null,
  publicado timestamptz not null default now(),
  quien     text
);

-- La clave para publicar, guardada como sha256. Se cambia con:
--   insert into naku_clave (id, hash) values (1, encode(sha256('la-nueva'::bytea),'hex'))
--     on conflict (id) do update set hash = excluded.hash, cambiada = now();
create table if not exists naku_clave (
  id       int primary key default 1,
  hash     text not null,
  cambiada timestamptz not null default now(),
  check (id = 1)
);

alter table tablero           enable row level security;
alter table tablero_historial enable row level security;
alter table naku_clave        enable row level security;

-- ------------------------------------------------------------------ publicar
-- Devuelve {ok, publicado, quien}. Levanta PT401 si la clave no va y PT400 si
-- lo que llega no parece un tablero: rechazarlo acá evita que una publicación
-- mal armada deje la pantalla en blanco para todos.
create or replace function publicar(p_clave text, p_datos jsonb, p_quien text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_hash  text;
  v_quien text := nullif(left(coalesce(p_quien, ''), 80), '');
  v_ahora timestamptz := now();
begin
  select hash into v_hash from naku_clave where id = 1;
  if v_hash is null or encode(sha256(coalesce(p_clave, '')::bytea), 'hex') is distinct from v_hash then
    raise exception using errcode = 'PT401', message = 'Clave incorrecta.';
  end if;

  if p_datos is null or jsonb_typeof(p_datos) <> 'object'
     or p_datos #> '{vistas,todos}' is null
     or p_datos -> 'mesCerrado' is null
     or jsonb_typeof(p_datos -> 'serie') <> 'array' then
    raise exception using errcode = 'PT400',
      message = 'Eso no parece un tablero armado: le faltan vistas, mesCerrado o serie.';
  end if;

  insert into tablero (id, datos, generado, quien, actualizado)
  values ('direccion', p_datos, p_datos ->> 'generado', v_quien, v_ahora)
  on conflict (id) do update
    set datos = excluded.datos, generado = excluded.generado,
        quien = excluded.quien, actualizado = excluded.actualizado;

  insert into tablero_historial (id, datos, quien) values ('direccion', p_datos, v_quien);

  -- Las últimas 30 alcanzan para volver atrás sin llenar el disco.
  delete from tablero_historial
   where id = 'direccion'
     and n not in (select n from tablero_historial where id = 'direccion' order by n desc limit 30);

  return jsonb_build_object('ok', true, 'publicado', v_ahora, 'quien', v_quien);
end $fn$;

-- -------------------------------------------------------------------- volver
create or replace function volver(p_clave text, p_n bigint)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_hash  text;
  v_datos jsonb;
begin
  select hash into v_hash from naku_clave where id = 1;
  if v_hash is null or encode(sha256(coalesce(p_clave, '')::bytea), 'hex') is distinct from v_hash then
    raise exception using errcode = 'PT401', message = 'Clave incorrecta.';
  end if;
  select datos into v_datos from tablero_historial where id = 'direccion' and n = p_n;
  if v_datos is null then
    raise exception using errcode = 'PT404', message = format('No existe la versión %s.', p_n);
  end if;
  return publicar(p_clave, v_datos, format('volvió a la versión %s', p_n));
end $fn$;

-- ----------------------------------------------------------------- versiones
create or replace function versiones(p_clave text)
returns table (n bigint, publicado timestamptz, quien text, mes text)
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare v_hash text;
begin
  select hash into v_hash from naku_clave where id = 1;
  if v_hash is null or encode(sha256(coalesce(p_clave, '')::bytea), 'hex') is distinct from v_hash then
    raise exception using errcode = 'PT401', message = 'Clave incorrecta.';
  end if;
  return query
    select h.n, h.publicado, h.quien, h.datos #>> '{mesCerrado,largo}'
      from tablero_historial h where h.id = 'direccion' order by h.n desc limit 30;
end $fn$;

revoke all on function publicar(text, jsonb, text) from public;
revoke all on function volver(text, bigint)        from public;
revoke all on function versiones(text)             from public;
