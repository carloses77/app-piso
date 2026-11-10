-- Límites contra el abuso del servidor: sin ellos, cualquiera con la clave pública podría crear
-- pisos falsos y llenar la base de datos. Los valores dejan mucho margen al uso normal de 2 personas
-- (importar un extracto con cientos de movimientos o subir decenas de fotos de tickets en una hora).
create index if not exists eventos_hogar_disp_fecha on public.eventos_cifrados (hogar_id, dispositivo, creado_en);
create index if not exists dispositivos_creado on public.dispositivos (creado_en);

-- Máximo 10 móviles nuevos por hora en todo el servidor (un móvil ya registrado no cuenta).
create or replace function public.registrar_dispositivo(p_hogar text, p_dispositivo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from dispositivos where hogar_id = p_hogar and dispositivo_id = p_dispositivo) then return; end if;
  if length(p_hogar) > 64 or length(p_dispositivo) > 64 then raise exception 'PETICION'; end if;
  if (select count(*) from dispositivos where hogar_id = p_hogar) >= 2 then
    raise exception 'MAX_2';
  end if;
  if (select count(*) from dispositivos where creado_en > now() - interval '1 hour') >= 10 then
    raise exception 'LIMITE_RITMO';
  end if;
  insert into dispositivos (hogar_id, dispositivo_id) values (p_hogar, p_dispositivo);
end $$;

-- Por móvil: máximo 2000 cambios y 20 MB por hora. Por piso: máximo 300 MB guardados.
create or replace function public.publicar_evento(p_hogar text, p_dispositivo text, p_payload text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_num int;
  v_bytes bigint;
begin
  if not exists (select 1 from dispositivos where hogar_id = p_hogar and dispositivo_id = p_dispositivo) then
    raise exception 'NO_AUTORIZADO';
  end if;
  select count(*), coalesce(sum(length(payload)), 0) into v_num, v_bytes
    from eventos_cifrados
    where hogar_id = p_hogar and dispositivo = p_dispositivo and creado_en > now() - interval '1 hour';
  if v_num >= 2000 or v_bytes + length(p_payload) > 20000000 then
    raise exception 'LIMITE_RITMO';
  end if;
  if (select coalesce(sum(pg_column_size(payload)), 0) from eventos_cifrados where hogar_id = p_hogar) > 300000000 then
    raise exception 'LIMITE_ESPACIO';
  end if;
  insert into eventos_cifrados (hogar_id, dispositivo, payload) values (p_hogar, p_dispositivo, p_payload);
end $$;

revoke all on function public.registrar_dispositivo, public.publicar_evento from public;
grant execute on function public.registrar_dispositivo, public.publicar_evento to anon;
