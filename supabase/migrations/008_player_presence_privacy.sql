begin;

-- Migrations 003 and 006 left service-role-only legacy functions with
-- search_path=public. They are not anonymously executable, but an untrusted
-- role must also be unable to create shadow objects in that schema. Fail closed
-- without changing unrelated schema privileges if staging has drifted.
do $$
begin
  if pg_catalog.has_schema_privilege('anon', 'public', 'CREATE')
     or pg_catalog.has_schema_privilege('authenticated', 'public', 'CREATE') then
    raise exception 'Migration 008 requires anon and authenticated to lack CREATE on schema public';
  end if;
end;
$$;

-- Anonymous Realtime clients need participant identity for lobby/presence UI,
-- but must never receive scoring or ranking fields from public.players. Keep a
-- deliberately narrow projection in a separate table so RLS is not being used
-- as column-level security.
create table public.room_player_presence (
  id uuid primary key references public.players(id) on delete cascade,
  room_id uuid not null references public.game_rooms(id) on delete cascade,
  nickname text not null check (char_length(nickname) between 2 and 18),
  avatar_config jsonb not null,
  joined_at timestamptz not null
);

create index room_player_presence_room_joined_idx
  on public.room_player_presence(room_id, joined_at);

alter table public.room_player_presence enable row level security;

create policy "player presence is visible for realtime"
  on public.room_player_presence for select to anon
  using (exists (
    select 1
    from public.game_rooms room
    where room.id = public.room_player_presence.room_id
      and room.expires_at > pg_catalog.now()
  ));

revoke all on public.room_player_presence from public, anon, authenticated;
grant select on public.room_player_presence to anon;
grant select, insert, update, delete on public.room_player_presence to service_role;

create or replace function public.sync_room_player_presence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.room_player_presence(id, room_id, nickname, avatar_config, joined_at)
  values (new.id, new.room_id, new.nickname, new.avatar_config, new.joined_at)
  on conflict (id) do update
  set room_id = excluded.room_id,
      nickname = excluded.nickname,
      avatar_config = excluded.avatar_config,
      joined_at = excluded.joined_at;
  return new;
end;
$$;

revoke all on function public.sync_room_player_presence() from public, anon, authenticated;
grant execute on function public.sync_room_player_presence() to service_role;

create trigger sync_room_player_presence_after_write
after insert or update of room_id, nickname, avatar_config, joined_at
on public.players
for each row execute function public.sync_room_player_presence();

-- Backfill existing players after the trigger exists. Concurrent inserts wait
-- for this transaction and are projected by the trigger when they continue.
insert into public.room_player_presence(id, room_id, nickname, avatar_config, joined_at)
select player.id, player.room_id, player.nickname, player.avatar_config, player.joined_at
from public.players player
on conflict (id) do update
set room_id = excluded.room_id,
    nickname = excluded.nickname,
    avatar_config = excluded.avatar_config,
    joined_at = excluded.joined_at;

do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'players'
  ) then
    execute 'alter publication supabase_realtime drop table public.players';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'room_player_presence'
  ) then
    execute 'alter publication supabase_realtime add table public.room_player_presence';
  end if;
end;
$$;

-- A read-only, service-role-only verifier reports the effective privacy and
-- publication state after the SQL Editor transaction commits. SECURITY
-- INVOKER is intentional: this function does not elevate its caller.
create or replace function public.get_quizloom_privacy_status()
returns table(
  projection_rls_enabled boolean,
  projection_anon_select_policy boolean,
  players_anon_select_policy boolean,
  players_published boolean,
  room_player_presence_published boolean,
  anon_projection_select boolean,
  anon_players_select boolean,
  anon_score_select boolean,
  anon_streak_select boolean,
  anon_correct_answers_select boolean,
  anon_response_time_select boolean,
  anon_player_secrets_select boolean,
  anon_answers_select boolean,
  anon_reveal_standings_execute boolean,
  anon_player_reveal_execute boolean,
  anon_public_schema_create boolean,
  authenticated_public_schema_create boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    coalesce((
      select relation.relrowsecurity
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public' and relation.relname = 'room_player_presence'
    ), false),
    exists (
      select 1
      from pg_catalog.pg_policy policy
      join pg_catalog.pg_class relation on relation.oid = policy.polrelid
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public'
        and relation.relname = 'room_player_presence'
        and policy.polcmd = 'r'
        and (select role.oid from pg_catalog.pg_roles role where role.rolname = 'anon') = any(policy.polroles)
    ),
    exists (
      select 1
      from pg_catalog.pg_policy policy
      join pg_catalog.pg_class relation on relation.oid = policy.polrelid
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public'
        and relation.relname = 'players'
        and policy.polcmd = 'r'
        and (
          0 = any(policy.polroles)
          or (select role.oid from pg_catalog.pg_roles role where role.rolname = 'anon') = any(policy.polroles)
        )
    ),
    exists (
      select 1 from pg_catalog.pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'players'
    ),
    exists (
      select 1 from pg_catalog.pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'room_player_presence'
    ),
    pg_catalog.has_table_privilege('anon', 'public.room_player_presence', 'SELECT'),
    pg_catalog.has_table_privilege('anon', 'public.players', 'SELECT'),
    pg_catalog.has_column_privilege('anon', 'public.players', 'score', 'SELECT'),
    pg_catalog.has_column_privilege('anon', 'public.players', 'streak', 'SELECT'),
    pg_catalog.has_column_privilege('anon', 'public.players', 'correct_answers', 'SELECT'),
    pg_catalog.has_column_privilege('anon', 'public.players', 'correct_response_time_ms', 'SELECT'),
    pg_catalog.has_table_privilege('anon', 'public.player_secrets', 'SELECT'),
    pg_catalog.has_table_privilege('anon', 'public.answers', 'SELECT'),
    pg_catalog.has_function_privilege('anon', 'public.reveal_quiz_answer_with_standings(uuid)', 'EXECUTE'),
    pg_catalog.has_function_privilege('anon', 'public.get_player_reveal(text,uuid,text)', 'EXECUTE'),
    pg_catalog.has_schema_privilege('anon', 'public', 'CREATE'),
    pg_catalog.has_schema_privilege('authenticated', 'public', 'CREATE');
$$;

revoke all on function public.get_quizloom_privacy_status() from public, anon, authenticated;
grant execute on function public.get_quizloom_privacy_status() to service_role;

-- This is the privacy boundary: trusted server routes retain service-role
-- access, while anonymous browsers can read only room_player_presence.
drop policy if exists "players are visible for realtime" on public.players;
revoke select on public.players from public, anon, authenticated;
revoke select (
  id, room_id, nickname, avatar_config, score,
  correct_answers, streak, joined_at, correct_response_time_ms
) on public.players from public, anon, authenticated;

commit;
