-- Fuentes de ventas compartidas. Publica Buyer y Finanzas en una transacción.
create table if not exists buyer_clave (id int primary key check (id = 1), hash text not null);
create table if not exists buyer_estado (
  id int primary key check (id = 1), revision int not null,
  datos text not null, fuentes text, actualizado timestamptz not null default now()
);
create table if not exists buyer_historial (
  revision int primary key, datos text not null, actualizado timestamptz not null default now(), fuentes text
);
alter table buyer_historial add column if not exists fuentes text;
alter table buyer_clave enable row level security;
alter table buyer_estado enable row level security;
alter table buyer_historial enable row level security;

create or replace function buyer_autorizar(clave text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select puede_leer(clave) or exists (
    select 1 from buyer_clave where id=1 and hash=encode(sha256(coalesce(clave,'')::bytea),'hex')
  );
$$;

create or replace function buyer_leer(clave text, solo_estado boolean default false) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r buyer_estado%rowtype;
begin
  if not buyer_autorizar(clave) then raise exception using errcode='PT401', message='Clave incorrecta.'; end if;
  select * into r from buyer_estado where id=1;
  if not found then return jsonb_build_object('revision',0); end if;
  return jsonb_build_object('revision',r.revision,'actualizado',r.actualizado)
    || case when solo_estado then '{}'::jsonb else jsonb_build_object('datos',r.datos,'fuentes',r.fuentes) end;
end $$;

create or replace function buyer_guardar(clave text, esperada int, contenido text, fuentes_nuevas text, financiero jsonb, fin_esperada timestamptz) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare actual int; nueva int; fecha timestamptz := clock_timestamp();
begin
  if not buyer_autorizar(clave) then raise exception using errcode='PT401', message='Clave incorrecta.'; end if;
  if contenido is null or length(contenido)>22000000 then raise exception using errcode='PT400', message='Contenido inválido.'; end if;
  -- También serializa la primera carga, cuando todavía no existe la fila.
  perform pg_advisory_xact_lock(780122);
  select revision into actual from buyer_estado where id=1;
  if coalesce(actual,0)<>esperada then raise exception using errcode='PT409', message='El Buyer se actualizó. Reintentá la carga.'; end if;
  nueva := coalesce(actual,0)+1;
  perform 1 from tablero where id='direccion' for update;
  if (select actualizado from tablero where id='direccion') is distinct from fin_esperada then
    raise exception using errcode='PT409', message='Finanzas cambió. Reintentá la carga.';
  end if;
  insert into buyer_estado values (1,nueva,contenido,fuentes_nuevas,fecha)
    on conflict (id) do update set revision=excluded.revision, datos=excluded.datos, fuentes=excluded.fuentes, actualizado=excluded.actualizado;
  insert into buyer_historial(revision,datos,actualizado,fuentes) values (nueva,contenido,fecha,fuentes_nuevas);
  delete from buyer_historial where revision < nueva-9;
  if financiero is not null then
    if financiero #> '{vistas,todos}' is null then raise exception using errcode='PT400',message='Finanzas inválido.'; end if;
    insert into tablero (id,datos,generado,quien,actualizado) values ('direccion',financiero,financiero->>'generado','Carga compartida MeLi/TN',fecha)
      on conflict (id) do update set datos=excluded.datos,generado=excluded.generado,quien=excluded.quien,actualizado=excluded.actualizado;
    insert into tablero_historial (id,datos,quien) values ('direccion',financiero,'Carga compartida MeLi/TN');
    delete from tablero_historial where id='direccion' and n not in (select n from tablero_historial where id='direccion' order by n desc limit 30);
  end if;
  return jsonb_build_object('revision',nueva,'actualizado',fecha);
end $$;

revoke all on function buyer_autorizar(text) from public;
revoke all on function buyer_leer(text,boolean) from public;
revoke all on function buyer_guardar(text,int,text,text,jsonb,timestamptz) from public;
