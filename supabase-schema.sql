-- ============================================================
-- Fraynid Barbershop — esquema de Supabase para el agendador
-- Pega TODO este archivo en: Supabase Dashboard > SQL Editor > New query > Run
-- ============================================================

-- Necesaria para poder usar tipos de fecha/hora dentro de la restricción
-- de exclusión (evita citas solapadas del mismo barbero).
create extension if not exists btree_gist;

-- ---------- Tabla ----------
create table if not exists public.citas (
  id                uuid primary key default gen_random_uuid(),
  servicio          text not null check (servicio in ('Corte','Barba','Corte + Barba','Afeitado')),
  duracion_minutos  integer not null check (duracion_minutos > 0),
  barbero           text not null check (barbero in ('Fraynid','Manuel')),
  fecha             date not null,
  hora_inicio       time not null,
  hora_fin          time not null,
  nombre_cliente    text not null check (length(trim(nombre_cliente)) > 0),
  telefono          text not null check (length(trim(telefono)) > 0),
  estado            text not null default 'confirmada' check (estado in ('confirmada','cancelada')),
  created_at        timestamptz not null default now(),

  constraint hora_fin_despues_de_inicio check (hora_fin > hora_inicio)
);

-- ---------- Índice para las consultas de disponibilidad (barbero + fecha) ----------
create index if not exists idx_citas_barbero_fecha
  on public.citas (barbero, fecha)
  where estado = 'confirmada';

-- ---------- Evitar reservas duplicadas / solapadas ----------
-- Un mismo barbero no puede tener dos citas confirmadas cuyo rango de horas
-- se solape ese día (esto cubre tanto el caso de "mismo horario exacto" como
-- el de un servicio de 60 min que choca a la mitad con otro de 30 min).
-- Si dos clientes intentan reservar el mismo hueco al mismo tiempo, la
-- segunda inserción falla con el código de error 23P01.
alter table public.citas
  add constraint citas_sin_solapamiento
  exclude using gist (
    barbero with =,
    tsrange(fecha + hora_inicio, fecha + hora_fin, '[)') with &&
  ) where (estado = 'confirmada');

-- ============================================================
-- Row Level Security
-- ============================================================
alter table public.citas enable row level security;

-- El frontend usa la anon key. Con RLS activado y SIN política de SELECT,
-- nadie puede leer la tabla directamente (protege nombre y teléfono de los
-- clientes). La disponibilidad se consulta a través de la función
-- obtener_horas_ocupadas() de abajo, que solo expone horarios, no datos personales.

-- Cualquiera puede crear una cita (reservar), siempre que:
--  - quede marcada como 'confirmada' (no puede insertar citas 'canceladas')
--  - tenga nombre y teléfono
--  - la fecha no sea en el pasado
create policy "cualquiera_puede_reservar"
  on public.citas
  for insert
  to anon
  with check (
    estado = 'confirmada'
    and length(trim(nombre_cliente)) > 0
    and length(trim(telefono)) > 0
    and fecha >= current_date
  );

-- No se crean políticas de SELECT, UPDATE ni DELETE para "anon":
-- al estar RLS activado, esas operaciones quedan bloqueadas por defecto.

-- ============================================================
-- Función pública para consultar disponibilidad
-- ============================================================
-- SECURITY DEFINER: se ejecuta con los permisos de quien la creó (el dueño
-- de la tabla), así que sí puede leer citas.* internamente, pero solo
-- devuelve hora_inicio/hora_fin — nunca nombre_cliente ni telefono.
create or replace function public.obtener_horas_ocupadas(p_barbero text, p_fecha date)
returns table (hora_inicio time, hora_fin time)
language sql
security definer
set search_path = public
as $$
  select hora_inicio, hora_fin
  from public.citas
  where barbero = p_barbero
    and fecha = p_fecha
    and estado = 'confirmada';
$$;

-- Permite que el frontend (rol anon) ejecute esta función.
grant execute on function public.obtener_horas_ocupadas(text, date) to anon;

-- Permite que el frontend (rol anon) inserte citas (la política de arriba
-- decide qué inserts se aceptan).
grant insert on public.citas to anon;
