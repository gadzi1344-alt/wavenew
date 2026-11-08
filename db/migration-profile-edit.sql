-- ===== Миграция: редактирование профиля (ник, описание, аватар). Выполнить один раз в SQL Editor. =====

-- Описание не длиннее 200 символов (на случай обхода клиента)
alter table profiles drop constraint if exists profiles_bio_len;
alter table profiles add constraint profiles_bio_len check (char_length(bio) <= 200);

-- Смена ника. Ник администратора менять нельзя (его имя проверяется в is_admin)
create or replace function change_username(new_name text) returns void
language plpgsql security definer set search_path = public as $$
declare n text := lower(trim(new_name));
begin
  if auth.uid() is null then raise exception 'Нужен вход'; end if;
  if n !~ '^[a-z0-9_.\-]{3,20}$' then raise exception 'Ник: 3–20 символов, латиница, цифры, _ . -'; end if;
  if exists (select 1 from profiles where id = auth.uid() and name = 'bibnaq') then
    raise exception 'Ник администратора менять нельзя';
  end if;
  if n = 'bibnaq' then raise exception 'Это имя зарезервировано'; end if;
  update profiles set name = n where id = auth.uid();
end $$;
grant execute on function change_username(text) to authenticated;
notify pgrst, 'reload schema';
