-- Impossible Tower optional backend. Apply to a fresh Supabase project.
-- Public RPC wrappers use INVOKER; carefully scoped private implementations
-- use DEFINER to keep score writes and private identifiers out of the Data API.
begin;

create schema if not exists tower_private;
revoke all on schema tower_private from public, anon, authenticated;
grant usage on schema tower_private to anon, authenticated;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  public_name text not null default 'Anónimo'
    check (char_length(public_name) between 1 and 24 and public_name !~ '[^[:alnum:] _-]'),
  data jsonb not null default '{"version":2}'::jsonb
    check (jsonb_typeof(data) = 'object' and data->>'version' is not distinct from '2' and octet_length(data::text) <= 65536),
  best_height numeric(8,1) not null default 0 check (best_height between 0 and 5000),
  updated_at timestamptz not null default now()
);

create table public.scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  mode text not null check (mode in ('casual', 'daily', 'challenge')),
  seed text not null check (seed ~ '^[A-Za-z0-9:_-]{1,96}$'),
  height numeric(8,1) not null check (height between 0 and 5000),
  score integer not null check (score between 0 and 1000000),
  objects_placed integer not null check (objects_placed between 0 and 500),
  perfect_drops integer not null check (perfect_drops between 0 and objects_placed),
  max_combo integer not null check (max_combo between 0 and objects_placed),
  duration double precision not null check (duration between greatest(0.5, objects_placed * 0.65) and 2400),
  created_at timestamptz not null default now(),
  -- Reserved for a future authoritative replay validator. V1 RPC accepts no events.
  drop_events jsonb check (drop_events is null or (jsonb_typeof(drop_events) = 'array' and octet_length(drop_events::text) <= 65536)),
  check (height <= objects_placed * 20 + 1),
  check (score between round(height * 10 + objects_placed * 25) and round(height * 10 + objects_placed * 350 + 1))
);
create index scores_owner_time on public.scores(user_id, created_at desc);
create index profiles_best on public.profiles(best_height desc) where best_height > 0;

create table public.daily_scores (
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  day date not null,
  seed text not null,
  best_height numeric(8,1) not null check (best_height between 0 and 5000),
  best_score integer not null check (best_score between 0 and 1000000),
  attempts integer not null default 1 check (attempts > 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, day),
  check (seed = 'tower:daily:' || to_char(day, 'YYYY-MM-DD') || ':v1')
);
create index daily_scores_day_height on public.daily_scores(day, best_height desc);

create table public.challenges (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(user_id) on delete cascade,
  version integer not null default 1 check (version = 1),
  seed text not null check (seed ~ '^[A-Za-z0-9:_-]{1,96}$'),
  height numeric(8,1) not null check (height between 0 and 5000),
  score integer not null check (score between 0 and 1000000),
  public_name text not null
    check (char_length(public_name) between 1 and 24 and public_name !~ '[^[:alnum:] _-]'),
  created_at timestamptz not null default now()
);
create index challenges_owner_time on public.challenges(owner_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.scores enable row level security;
alter table public.daily_scores enable row level security;
alter table public.challenges enable row level security;
create policy profiles_owner_read on public.profiles for select to authenticated using ((select auth.uid()) = user_id);
create policy scores_owner_read on public.scores for select to authenticated using ((select auth.uid()) = user_id);
create policy daily_owner_read on public.daily_scores for select to authenticated using ((select auth.uid()) = user_id);
create policy challenges_owner_read on public.challenges for select to authenticated using ((select auth.uid()) = owner_id);

-- No INSERT/UPDATE/DELETE table privileges or policies: validation cannot be
-- bypassed by calling .from('scores').insert() with the browser's anon key.
revoke all on table public.profiles, public.scores, public.daily_scores, public.challenges from public, anon, authenticated;
grant select on table public.profiles, public.scores, public.daily_scores, public.challenges to authenticated;

create function tower_private.safe_name(p_name text)
returns text language sql immutable security invoker set search_path = '' as $$
  select coalesce(nullif(left(trim(regexp_replace(regexp_replace(coalesce(p_name, ''), '[^[:alnum:] _-]', '', 'g'), '\s+', ' ', 'g')), 24), ''), 'Anónimo');
$$;

create function tower_private.submit_run(
  p_mode text, p_seed text, p_height numeric, p_score integer,
  p_objects integer, p_perfect integer, p_max_combo integer,
  p_duration double precision, p_name text, p_assisted boolean
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_day date := (clock_timestamp() at time zone 'UTC')::date;
  v_name text := tower_private.safe_name(p_name);
begin
  if v_user is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_assisted is distinct from false then raise exception 'Assisted runs cannot enter rankings' using errcode = '22023'; end if;
  if p_mode is null or p_mode not in ('casual', 'daily', 'challenge')
     or p_seed is null or p_seed !~ '^[A-Za-z0-9:_-]{1,96}$'
     or p_height is null or not (p_height between 0 and 5000)
     or p_score is null or not (p_score between 0 and 1000000)
     or p_objects is null or not (p_objects between 0 and 500)
     or p_height > p_objects * 20 + 1
     or p_perfect is null or not (p_perfect between 0 and p_objects)
     or p_max_combo is null or not (p_max_combo between 0 and p_objects)
     or p_duration is null or not (p_duration between greatest(0.5, p_objects * 0.65) and 2400)
     or not (p_score between round(p_height * 10 + p_objects * 25) and round(p_height * 10 + p_objects * 350 + 1))
  then raise exception 'Implausible run' using errcode = '22023'; end if;
  if p_mode = 'daily' and p_seed <> 'tower:daily:' || to_char(v_day, 'YYYY-MM-DD') || ':v1'
  then raise exception 'Daily seed must match the current UTC day' using errcode = '22023'; end if;

  -- Serialize all write RPCs per owner: parallel requests cannot race limits.
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));
  if exists (select 1 from public.scores where user_id = v_user and created_at > now() - interval '3 seconds')
     or (select count(*) from public.scores where user_id = v_user and created_at > now() - interval '1 minute') >= 30
  then raise exception 'Run submission rate limit reached' using errcode = 'P0001'; end if;

  insert into public.profiles(user_id, public_name) values (v_user, v_name)
  on conflict (user_id) do update set public_name = excluded.public_name;
  insert into public.scores(user_id, mode, seed, height, score, objects_placed, perfect_drops, max_combo, duration)
  values (v_user, p_mode, p_seed, p_height, p_score, p_objects, p_perfect, p_max_combo, p_duration);
  update public.profiles set best_height = greatest(best_height, p_height), updated_at = now() where user_id = v_user;
  if p_mode = 'daily' then
    insert into public.daily_scores(user_id, day, seed, best_height, best_score)
    values (v_user, v_day, p_seed, p_height, p_score)
    on conflict (user_id, day) do update
    set best_height = greatest(public.daily_scores.best_height, excluded.best_height),
        best_score = greatest(public.daily_scores.best_score, excluded.best_score),
        attempts = public.daily_scores.attempts + 1, updated_at = now();
  end if;
end;
$$;

create function tower_private.sync_profile(p_name text, p_data jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' or p_data->>'version' is distinct from '2' or octet_length(p_data::text) > 65536
  then raise exception 'Invalid profile' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));
  insert into public.profiles(user_id, public_name, data)
  values (v_user, tower_private.safe_name(p_name), jsonb_set(p_data, '{publicName}', to_jsonb(tower_private.safe_name(p_name))))
  on conflict (user_id) do update
  set public_name = excluded.public_name, data = excluded.data, updated_at = now();
  -- best_height is exclusively derived from accepted runs, never profile JSON.
end;
$$;

create function tower_private.create_challenge(p_seed text, p_height numeric, p_score integer, p_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_id uuid;
begin
  if v_user is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_seed is null or p_seed !~ '^[A-Za-z0-9:_-]{1,96}$'
     or p_height is null or not (p_height between 0 and 5000)
     or p_score is null or not (p_score between 0 and 1000000)
  then raise exception 'Invalid challenge' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));
  if (select count(*) from public.challenges where owner_id = v_user and created_at > now() - interval '1 minute') >= 8
     or (select count(*) from public.challenges where owner_id = v_user and created_at > now() - interval '1 day') >= 100
  then raise exception 'Challenge creation rate limit reached' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.scores where user_id = v_user and seed = p_seed and height = p_height and score = p_score)
  then raise exception 'Challenge must reference an accepted run' using errcode = '22023'; end if;
  insert into public.challenges(owner_id, seed, height, score, public_name)
  values (v_user, p_seed, p_height, p_score, tower_private.safe_name(p_name)) returning id into v_id;
  return v_id;
end;
$$;

-- Deliberately public read APIs. They disclose pseudonym/height or the challenge
-- already shared by URL; neither emits owner IDs or private profile JSON.
create function tower_private.read_leaderboard(p_kind text)
returns table(name text, height numeric) language plpgsql stable security definer set search_path = '' as $$
begin
  if p_kind = 'today' then
    return query select p.public_name, d.best_height from public.daily_scores d
    join public.profiles p on p.user_id = d.user_id
    where d.day = (now() at time zone 'UTC')::date and d.best_height > 0
    order by d.best_height desc, d.updated_at asc, d.user_id limit 50;
  elsif p_kind = 'all-time' then
    return query select p.public_name, p.best_height from public.profiles p
    where p.best_height > 0 order by p.best_height desc, p.updated_at asc, p.user_id limit 50;
  else raise exception 'Invalid leaderboard kind' using errcode = '22023'; end if;
end;
$$;

create function tower_private.load_challenge(p_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('version', c.version, 'seed', c.seed, 'height', c.height, 'score', c.score, 'name', c.public_name)
  from public.challenges c where c.id = p_id;
$$;

create function public.submit_run(
  p_mode text, p_seed text, p_height numeric, p_score integer,
  p_objects integer, p_perfect integer, p_max_combo integer,
  p_duration double precision, p_name text, p_assisted boolean
)
returns void language sql security invoker set search_path = '' as $$
  select tower_private.submit_run(p_mode, p_seed, p_height, p_score, p_objects, p_perfect, p_max_combo, p_duration, p_name, p_assisted);
$$;
create function public.sync_profile(p_name text, p_data jsonb)
returns void language sql security invoker set search_path = '' as $$ select tower_private.sync_profile(p_name, p_data); $$;
create function public.create_challenge(p_seed text, p_height numeric, p_score integer, p_name text)
returns uuid language sql security invoker set search_path = '' as $$ select tower_private.create_challenge(p_seed, p_height, p_score, p_name); $$;
create function public.read_leaderboard(p_kind text)
returns table(name text, height numeric) language sql stable security invoker set search_path = '' as $$ select * from tower_private.read_leaderboard(p_kind); $$;
create function public.load_challenge(p_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$ select tower_private.load_challenge(p_id); $$;

revoke all on all functions in schema tower_private from public, anon, authenticated;
revoke all on function public.submit_run(text,text,numeric,integer,integer,integer,integer,double precision,text,boolean) from public, anon, authenticated;
revoke all on function public.sync_profile(text,jsonb) from public, anon, authenticated;
revoke all on function public.create_challenge(text,numeric,integer,text) from public, anon, authenticated;
revoke all on function public.read_leaderboard(text) from public, anon, authenticated;
revoke all on function public.load_challenge(uuid) from public, anon, authenticated;

grant execute on function tower_private.submit_run(text,text,numeric,integer,integer,integer,integer,double precision,text,boolean) to authenticated;
grant execute on function tower_private.sync_profile(text,jsonb) to authenticated;
grant execute on function tower_private.create_challenge(text,numeric,integer,text) to authenticated;
grant execute on function public.submit_run(text,text,numeric,integer,integer,integer,integer,double precision,text,boolean) to authenticated;
grant execute on function public.sync_profile(text,jsonb) to authenticated;
grant execute on function public.create_challenge(text,numeric,integer,text) to authenticated;
grant execute on function tower_private.read_leaderboard(text), tower_private.load_challenge(uuid) to anon, authenticated;
grant execute on function public.read_leaderboard(text), public.load_challenge(uuid) to anon, authenticated;

comment on column public.scores.drop_events is 'Future authoritative replay input: per-drop index, x, time, and object ID. V1 submissions cannot write this field.';
comment on table public.profiles is 'Private client meta progression; best_height is maintained only by validated score RPC.';
commit;
