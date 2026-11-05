-- Suscripciones push. El servidor no conoce el contenido de los cambios: solo sabe a quién avisar.
create table if not exists public.suscripciones_push (
  hogar_id text not null,
  dispositivo_id text not null,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  actualizada_en timestamptz not null default now(),
  primary key (hogar_id, dispositivo_id),
  foreign key (hogar_id, dispositivo_id) references public.dispositivos (hogar_id, dispositivo_id) on delete cascade
);
-- RLS sin políticas: solo se accede por RPC o desde la función con service role.
alter table public.suscripciones_push enable row level security;

create or replace function public.guardar_suscripcion_push(p_hogar text, p_dispositivo text, p_endpoint text, p_p256dh text, p_auth text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from dispositivos where hogar_id = p_hogar and dispositivo_id = p_dispositivo) then
    raise exception 'NO_AUTORIZADO';
  end if;
  insert into suscripciones_push (hogar_id, dispositivo_id, endpoint, p256dh, auth)
  values (p_hogar, p_dispositivo, p_endpoint, p_p256dh, p_auth)
  on conflict (hogar_id, dispositivo_id) do update
    set endpoint = excluded.endpoint, p256dh = excluded.p256dh, auth = excluded.auth, actualizada_en = now();
end $$;

revoke all on function public.guardar_suscripcion_push from public;
grant execute on function public.guardar_suscripcion_push to anon;
