-- ===== Wave social: полный скрипт. Безопасно запускать повторно. =====
-- Перед запуском замени CHANGE_ME на свой админ-код.

create table if not exists settings (key text primary key, value text);
insert into settings (key, value) values ('admin_code', 'CHANGE_ME') on conflict (key) do nothing;

create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  name text not null,
  bio text default '',
  avatar_url text default '',
  verified boolean default false,
  badges text[] default '{}',
  created_at timestamptz default now()
);
create unique index if not exists profiles_name_lower on profiles (lower(name));

create table if not exists posts (
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles (id) on delete cascade,
  text text default '',
  image_url text default '',
  views int default 0,
  created_at timestamptz default now()
);
create table if not exists post_views (
  post_id bigint references posts (id) on delete cascade,
  user_id uuid references profiles (id) on delete cascade,
  primary key (post_id, user_id)
);
create table if not exists likes (
  post_id bigint references posts (id) on delete cascade,
  user_id uuid references profiles (id) on delete cascade,
  primary key (post_id, user_id)
);
create table if not exists comments (
  id bigint generated always as identity primary key,
  post_id bigint references posts (id) on delete cascade,
  user_id uuid references profiles (id) on delete cascade,
  text text not null,
  created_at timestamptz default now()
);
create table if not exists follows (
  follower_id uuid references profiles (id) on delete cascade,
  followee_id uuid references profiles (id) on delete cascade,
  primary key (follower_id, followee_id)
);

-- Старый триггер больше не нужен: профиль создаёт функция ensure_profile
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists handle_new_user();

-- Создание профиля после первого входа (логин выбирает пользователь)
create or replace function ensure_profile(uname text, code text) returns void
language plpgsql security definer set search_path = public as $$
declare n text := lower(uname);
begin
  if auth.uid() is null then raise exception 'Нужен вход'; end if;
  if n !~ '^[a-z0-9_.\-]{3,20}$' then raise exception 'Логин: 3–20 символов, латиница, цифры, _ . -'; end if;
  if n = 'bibnaq' and code is distinct from (select value from settings where key = 'admin_code') then
    raise exception 'Это имя зарезервировано. Нужен верный админ-код.';
  end if;
  insert into profiles (id, name) values (auth.uid(), n) on conflict (id) do nothing;
end $$;
grant execute on function ensure_profile(text, text) to authenticated;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and name = 'bibnaq');
$$;

create or replace function mark_views(ids bigint[]) returns void
language plpgsql security definer set search_path = public as $$
declare pid bigint;
begin
  if auth.uid() is null then return; end if;
  foreach pid in array ids loop
    insert into post_views (post_id, user_id) values (pid, auth.uid()) on conflict do nothing;
    if found then
      update posts set views = views + 1 where id = pid;
    end if;
  end loop;
end $$;

create or replace function admin_set_profile(target text, is_verified boolean, new_badges text[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Только для администратора'; end if;
  update profiles
     set verified = is_verified,
         badges = (select coalesce(array_agg(b), '{}') from unnest(new_badges) b
                   where b in ('star','fire','heart','cat','crown','flower','sparkle','bunny'))
   where lower(name) = lower(target);
end $$;

alter table settings enable row level security;
alter table profiles enable row level security;
alter table posts enable row level security;
alter table post_views enable row level security;
alter table likes enable row level security;
alter table comments enable row level security;
alter table follows enable row level security;

drop policy if exists "profiles read" on profiles;
create policy "profiles read" on profiles for select using (true);
drop policy if exists "profiles update own" on profiles;
create policy "profiles update own" on profiles for update using (auth.uid() = id);
revoke update on profiles from authenticated, anon;
grant update (bio, avatar_url) on profiles to authenticated;

drop policy if exists "posts read" on posts;
create policy "posts read" on posts for select using (true);
drop policy if exists "posts insert own" on posts;
create policy "posts insert own" on posts for insert with check (auth.uid() = user_id);
drop policy if exists "posts delete own or admin" on posts;
create policy "posts delete own or admin" on posts for delete using (auth.uid() = user_id or is_admin());

drop policy if exists "likes read" on likes;
create policy "likes read" on likes for select using (true);
drop policy if exists "likes insert own" on likes;
create policy "likes insert own" on likes for insert with check (auth.uid() = user_id);
drop policy if exists "likes delete own" on likes;
create policy "likes delete own" on likes for delete using (auth.uid() = user_id);

drop policy if exists "comments read" on comments;
create policy "comments read" on comments for select using (true);
drop policy if exists "comments insert own" on comments;
create policy "comments insert own" on comments for insert with check (auth.uid() = user_id);
drop policy if exists "comments delete own or admin" on comments;
create policy "comments delete own or admin" on comments for delete using (auth.uid() = user_id or is_admin());

drop policy if exists "follows read" on follows;
create policy "follows read" on follows for select using (true);
drop policy if exists "follows insert own" on follows;
create policy "follows insert own" on follows for insert with check (auth.uid() = follower_id);
drop policy if exists "follows delete own" on follows;
create policy "follows delete own" on follows for delete using (auth.uid() = follower_id);

insert into storage.buckets (id, name, public) values ('media', 'media', true)
  on conflict (id) do update set public = true;
drop policy if exists "media read" on storage.objects;
create policy "media read" on storage.objects for select using (bucket_id = 'media');
drop policy if exists "media upload own folder" on storage.objects;
create policy "media upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "media delete own folder" on storage.objects;
create policy "media delete own folder" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and ((storage.foldername(name))[1] = auth.uid()::text or is_admin()));

notify pgrst, 'reload schema';
