-- Fin del traslado: vuelve a permitir solo 2 móviles por piso (revierte 003_traslado_temporal.sql).
-- Los móviles ya registrados siguen funcionando; el límite solo se comprueba al registrar uno nuevo.
create or replace function public.registrar_dispositivo(p_hogar text, p_dispositivo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from dispositivos where hogar_id = p_hogar and dispositivo_id = p_dispositivo) then return; end if;
  if (select count(*) from dispositivos where hogar_id = p_hogar) >= 2 then
    raise exception 'MAX_2';
  end if;
  insert into dispositivos values (p_hogar, p_dispositivo);
end $$;
