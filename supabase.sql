-- ===== Wave social: база для Supabase =====
-- Вставь целиком в SQL Editor и нажми Run.
-- ВАЖНО: замени CHANGE_ME на свой админ-код (он нужен для регистрации bibnaq).

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

-- Регистрация: создаёт профиль, проверяет имя и админ-код
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  uname text := lower(new.raw_user_meta_data->>'name');
  code text := new.raw_user_meta_data->>'code';
begin
  if uname !~ '^[a-z0-9_.\-]{3,20}$' then
    raise exception 'Имя: 3–20 символов, латиница, цифры, _ . -';
  end if;
  if uname = 'bibnaq' and code is distinct from (select value from settings where key = 'admin_code') then
    raise exception 'Это имя зарезервировано. Нужен верный админ-код.';
  end if;
  insert into profiles (id, name) values (new.id, uname);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and name = 'bibnaq');
$$;

-- Просмотр засчитывается один раз на пользователя, когда пост появился в ленте
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

-- Галочка и значки: только администратор
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

-- Включаем защиту строк
alter table settings enable row level security;
alter table profiles enable row level security;
alter table posts enable row level security;
alter table post_views enable row level security;
alter table likes enable row level security;
alter table comments enable row level security;
alter table follows enable row level security;

-- settings: никому не видно (кроме триггера, который работает с правами владельца)
-- (политик нет, значит доступа через API нет)

create policy "profiles read" on profiles for select using (true);
create policy "profiles update own" on profiles for update using (auth.uid() = id);
revoke update on profiles from authenticated, anon;
grant update (bio, avatar_url) on profiles to authenticated;

create policy "posts read" on posts for select using (true);
create policy "posts insert own" on posts for insert with check (auth.uid() = user_id);
create policy "posts delete own or admin" on posts for delete using (auth.uid() = user_id or is_admin());

create policy "likes read" on likes for select using (true);
create policy "likes insert own" on likes for insert with check (auth.uid() = user_id);
create policy "likes delete own" on likes for delete using (auth.uid() = user_id);

create policy "comments read" on comments for select using (true);
create policy "comments insert own" on comments for insert with check (auth.uid() = user_id);
create policy "comments delete own or admin" on comments for delete using (auth.uid() = user_id or is_admin());

create policy "follows read" on follows for select using (true);
create policy "follows insert own" on follows for insert with check (auth.uid() = follower_id);
create policy "follows delete own" on follows for delete using (auth.uid() = follower_id);

-- post_views: читает и пишет только функция mark_views

-- Хранилище фото: публичное чтение, загрузка только в свою папку
insert into storage.buckets (id, name, public) values ('media', 'media', true)
  on conflict (id) do update set public = true;
create policy "media read" on storage.objects for select using (bucket_id = 'media');
create policy "media upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "media delete own folder" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and ((storage.foldername(name))[1] = auth.uid()::text or is_admin()));
