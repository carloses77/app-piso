-- Temporal: permite 4 móviles por piso mientras se trasladan a la nueva URL sin dar de baja los antiguos.
-- Al terminar el traslado, volver a dejar el límite en 2.
create or replace function public.registrar_dispositivo(p_hogar text, p_dispositivo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from dispositivos where hogar_id = p_hogar and dispositivo_id = p_dispositivo) then return; end if;
  if (select count(*) from dispositivos where hogar_id = p_hogar) >= 4 then
    raise exception 'MAX_2';
  end if;
  insert into dispositivos values (p_hogar, p_dispositivo);
end $$;
