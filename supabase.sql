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
-- ===== Быстрая лента: один запрос вместо пяти. Запусти этот блок в SQL Editor =====
create or replace function get_feed(p_before bigint, p_user uuid, p_only_follow boolean)
returns jsonb
language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(t) order by t.id desc), '[]'::jsonb) from (
    select p.id, p.text, p.image_url as image, p.views, p.created_at as created, p.user_id,
           pr.name as author_name, pr.verified as author_verified,
           pr.badges as author_badges, pr.avatar_url as author_avatar,
           (select count(*) from likes l where l.post_id = p.id) as likes,
           (select count(*) from comments c where c.post_id = p.id) as comments,
           exists (select 1 from likes l where l.post_id = p.id and l.user_id = p_user) as liked
      from posts p
      join profiles pr on pr.id = p.user_id
     where (p_before is null or p.id < p_before)
       and (not p_only_follow or p.user_id in (select followee_id from follows where follower_id = p_user))
     order by p.id desc
     limit 20
  ) t;
$$;
grant execute on function get_feed(bigint, uuid, boolean) to anon, authenticated;
notify pgrst, 'reload schema';
-- ===== Быстрые страницы: профиль и пост одним запросом. Запусти этот блок в SQL Editor =====
create or replace function post_json(p_id bigint, p_user uuid)
returns jsonb language sql stable security invoker set search_path = public as $$
  select to_jsonb(t) from (
    select p.id, p.text, p.image_url as image, p.views, p.created_at as created, p.user_id,
           pr.name as author_name, pr.verified as author_verified,
           pr.badges as author_badges, pr.avatar_url as author_avatar,
           (select count(*) from likes l where l.post_id = p.id) as likes,
           (select count(*) from comments c where c.post_id = p.id) as comments,
           exists (select 1 from likes l where l.post_id = p.id and l.user_id = p_user) as liked
      from posts p join profiles pr on pr.id = p.user_id
     where p.id = p_id
  ) t;
$$;

create or replace function get_post_page(p_id bigint, p_user uuid)
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'post', post_json(p_id, p_user),
    'comments', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.id) from (
        select cm.id, cm.text, cm.created_at as created,
               pr.name as author_name, pr.verified as author_verified,
               pr.badges as author_badges, pr.avatar_url as author_avatar
          from comments cm join profiles pr on pr.id = cm.user_id
         where cm.post_id = p_id
      ) c), '[]'::jsonb)
  );
$$;

create or replace function get_profile_page(p_name text, p_user uuid, p_before bigint)
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'user', (select to_jsonb(u) from (
               select id, name, bio, verified, badges, avatar_url from profiles where lower(name) = lower(p_name)
             ) u),
    'followers', (select count(*) from follows f join profiles pr on pr.id = f.followee_id where lower(pr.name) = lower(p_name)),
    'following', (select count(*) from follows f join profiles pr on pr.id = f.follower_id where lower(pr.name) = lower(p_name)),
    'posts_count', (select count(*) from posts p join profiles pr on pr.id = p.user_id where lower(pr.name) = lower(p_name)),
    'is_following', exists (select 1 from follows f join profiles pr on pr.id = f.followee_id
                             where lower(pr.name) = lower(p_name) and f.follower_id = p_user),
    'posts', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.id desc) from (
        select p.id, p.text, p.image_url as image, p.views, p.created_at as created, p.user_id,
               pr.name as author_name, pr.verified as author_verified,
               pr.badges as author_badges, pr.avatar_url as author_avatar,
               (select count(*) from likes l where l.post_id = p.id) as likes,
               (select count(*) from comments c where c.post_id = p.id) as comments,
               exists (select 1 from likes l where l.post_id = p.id and l.user_id = p_user) as liked
          from posts p join profiles pr on pr.id = p.user_id
         where lower(pr.name) = lower(p_name) and (p_before is null or p.id < p_before)
         order by p.id desc limit 20
      ) t), '[]'::jsonb)
  );
$$;

grant execute on function post_json(bigint, uuid) to anon, authenticated;
grant execute on function get_post_page(bigint, uuid) to anon, authenticated;
grant execute on function get_profile_page(text, uuid, bigint) to anon, authenticated;
notify pgrst, 'reload schema';

-- ===== Индексы для быстрых запросов (запусти один раз) =====
create index if not exists posts_user_id_idx on posts (user_id, id desc);
create index if not exists posts_id_desc_idx on posts (id desc);
create index if not exists likes_post_idx on likes (post_id);
create index if not exists comments_post_idx on comments (post_id);
create index if not exists follows_followee_idx on follows (followee_id);
create index if not exists follows_follower_idx on follows (follower_id);
