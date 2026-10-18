begin;

-- Frequent room-code lookups previously depended on a partial uniqueness index
-- that cannot serve finished-room history. This index supports latest-room
-- lookup for joins, answers, state hydration, and code reuse.
create index if not exists game_rooms_code_created_idx
  on public.game_rooms(code, created_at desc);

-- Answer submissions update one of sixteen independent counters instead of a
-- single game_rooms row. The rows contain only aggregate activity: no option,
-- correctness, score, token, or player identity is exposed to Realtime.
create table if not exists public.room_answer_counters (
  room_id uuid not null references public.game_rooms(id) on delete cascade,
  question_index integer not null check (question_index >= 0),
  bucket smallint not null check (bucket between 0 and 15),
  answer_count integer not null default 0 check (answer_count >= 0),
  updated_at timestamptz not null default pg_catalog.now(),
  primary key (room_id, question_index, bucket)
);

alter table public.room_answer_counters enable row level security;
drop policy if exists "answer counters are visible for realtime" on public.room_answer_counters;
create policy "answer counters are visible for realtime"
  on public.room_answer_counters for select to anon
  using (exists (
    select 1 from public.game_rooms room
    where room.id = public.room_answer_counters.room_id and room.expires_at > pg_catalog.now()
  ));

revoke all on public.room_answer_counters from public, anon, authenticated;
grant select on public.room_answer_counters to anon;
grant select, insert, update, delete on public.room_answer_counters to service_role;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'room_answer_counters'
  ) then
    execute 'alter publication supabase_realtime add table public.room_answer_counters';
  end if;
end;
$$;

-- Authorizes, normalizes expired rooms, checks quiz content, allocates a code,
-- creates the room, and stores its host secret in one atomic database call.
create or replace function public.create_quiz_room(
  p_quiz_id uuid,
  p_quiz_token_hash text,
  p_host_token_hash text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_code text;
  v_room_id uuid;
  v_attempt integer;
begin
  if not exists (
    select 1 from public.quiz_secrets secret
    where secret.quiz_id = p_quiz_id
      and secret.quiz_token_hash = p_quiz_token_hash
  ) then
    return pg_catalog.jsonb_build_object('kind', 'forbidden');
  end if;

  update public.game_rooms
  set status = 'finished',
      current_question = -1,
      question_ends_at = v_now,
      updated_at = v_now
  where quiz_id = p_quiz_id
    and status in ('lobby', 'question', 'results')
    and expires_at <= v_now;

  if not exists (select 1 from public.questions where quiz_id = p_quiz_id) then
    return pg_catalog.jsonb_build_object('kind', 'no-questions');
  end if;

  for v_attempt in 1..30 loop
    v_code := pg_catalog.floor(100000 + pg_catalog.random() * 900000)::integer::text;
    if exists (select 1 from public.game_rooms where code = v_code) then
      continue;
    end if;
    begin
      insert into public.game_rooms(quiz_id, code, status, current_question, expires_at)
      values (p_quiz_id, v_code, 'lobby', 0, v_now + interval '6 hours')
      returning id into v_room_id;
    exception when unique_violation then
      v_room_id := null;
    end;

    if v_room_id is not null then
      insert into public.room_secrets(room_id, host_token_hash)
      values (v_room_id, p_host_token_hash);
      return pg_catalog.jsonb_build_object('kind', 'ok', 'roomId', v_room_id, 'code', v_code);
    end if;
  end loop;

  return pg_catalog.jsonb_build_object('kind', 'code-exhausted');
end;
$$;

-- Validates room lifecycle, handles an authenticated reconnect, or creates the
-- player and secret atomically. A shared room lock lets concurrent joins proceed
-- together while remaining ordered against start/reveal transitions.
create or replace function public.join_quiz_room(
  p_room_code text,
  p_nickname text,
  p_avatar jsonb,
  p_existing_player_id uuid,
  p_reconnect_token_hash text,
  p_new_player_token_hash text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.game_rooms%rowtype;
  v_player public.players%rowtype;
begin
  select * into v_room
  from public.game_rooms
  where code = p_room_code
  order by created_at desc
  limit 1;
  if not found then return pg_catalog.jsonb_build_object('kind', 'missing'); end if;

  perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended(v_room.id::text, 0));
  select * into v_room from public.game_rooms where id = v_room.id;

  if v_room.status = 'finished' then return pg_catalog.jsonb_build_object('kind', 'ended'); end if;
  if v_room.expires_at <= pg_catalog.clock_timestamp() then return pg_catalog.jsonb_build_object('kind', 'expired'); end if;
  if v_room.status <> 'lobby' then return pg_catalog.jsonb_build_object('kind', 'started'); end if;

  if p_existing_player_id is not null and p_reconnect_token_hash is not null then
    select player.* into v_player
    from public.players player
    join public.player_secrets secret on secret.player_id = player.id
    where player.id = p_existing_player_id
      and player.room_id = v_room.id
      and secret.player_token_hash = p_reconnect_token_hash;
    if found then
      return pg_catalog.jsonb_build_object(
        'kind', 'reconnected',
        'playerId', v_player.id,
        'nickname', v_player.nickname
      );
    end if;
  end if;

  begin
    insert into public.players(room_id, nickname, avatar_config)
    values (v_room.id, p_nickname, p_avatar)
    returning * into v_player;
  exception when unique_violation then
    return pg_catalog.jsonb_build_object('kind', 'nickname-taken');
  end;

  insert into public.player_secrets(player_id, player_token_hash)
  values (v_player.id, p_new_player_token_hash);

  return pg_catalog.jsonb_build_object(
    'kind', 'created',
    'playerId', v_player.id,
    'nickname', v_player.nickname
  );
end;
$$;

-- Answer validation and scoring remain fully server authoritative. Independent
-- counter buckets remove the single-row write queue created by 50 concurrent
-- updates to game_rooms.answer_count. The v2 name intentionally preserves the
-- 001-006 RPC so an older application instance remains usable during rollout.
create or replace function public.submit_quiz_answer_v2(
  p_room_code text,
  p_player_id uuid,
  p_player_token_hash text,
  p_option_id uuid
) returns table(points integer, correct boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.game_rooms%rowtype;
  v_question_id uuid;
  v_time_limit_seconds integer;
  v_correct boolean;
  v_points integer;
  v_points_per_correct integer;
  v_now timestamptz;
  v_response_time_ms integer;
  v_bucket smallint;
begin
  select * into v_room
  from public.game_rooms
  where code = p_room_code
  order by created_at desc
  limit 1;
  if not found then raise exception 'This question is no longer accepting answers'; end if;

  perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended(v_room.id::text, 0));

  select * into v_room
  from public.game_rooms
  where id = v_room.id and status = 'question';
  if not found then raise exception 'This question is no longer accepting answers'; end if;

  v_now := pg_catalog.clock_timestamp();
  if v_room.question_started_at is null or v_room.question_ends_at is null then
    raise exception 'This question is not ready yet';
  end if;
  if v_now < v_room.question_started_at then raise exception 'This question has not started yet'; end if;
  if v_now > v_room.question_ends_at then raise exception 'Time is up for this question'; end if;

  perform 1
  from public.players player
  join public.player_secrets secret on secret.player_id = player.id
  where player.id = p_player_id
    and player.room_id = v_room.id
    and secret.player_token_hash = p_player_token_hash;
  if not found then raise exception 'Your player session is not valid'; end if;

  select question.id,
         question.time_limit_seconds,
         option.is_correct,
         quiz.points_per_correct
  into v_question_id, v_time_limit_seconds, v_correct, v_points_per_correct
  from public.questions question
  join public.question_options option
    on option.question_id = question.id and option.id = p_option_id
  join public.quizzes quiz on quiz.id = question.quiz_id
  where question.quiz_id = v_room.quiz_id
    and question.position = v_room.current_question;
  if not found then raise exception 'That answer is not valid for this question'; end if;

  v_points := case when v_correct then v_points_per_correct else 0 end;
  v_response_time_ms := least(
    v_time_limit_seconds * 1000,
    greatest(0, pg_catalog.floor(extract(epoch from (v_now - v_room.question_started_at)) * 1000)::integer)
  );

  begin
    insert into public.answers(
      room_id, player_id, question_id, selected_option_id,
      submitted_at, is_correct, points_awarded, response_time_ms
    ) values (
      v_room.id, p_player_id, v_question_id, p_option_id,
      v_now, v_correct, v_points, v_response_time_ms
    );
  exception when unique_violation then
    raise exception 'You already answered this question';
  end;

  v_bucket := pg_catalog.mod(
    pg_catalog.hashtextextended(p_player_id::text, 0) & 9223372036854775807::bigint,
    16::bigint
  )::smallint;

  insert into public.room_answer_counters as counter(room_id, question_index, bucket, answer_count, updated_at)
  values (v_room.id, v_room.current_question, v_bucket, 1, v_now)
  on conflict (room_id, question_index, bucket) do update
  set answer_count = counter.answer_count + 1,
      updated_at = excluded.updated_at;

  return query select v_points, v_correct;
end;
$$;

-- Return the newly committed standings with the reveal in one API-to-database
-- round trip. This delegates scoring to the established idempotent reveal
-- function and only packages its authoritative result.
create or replace function public.reveal_quiz_answer_with_standings(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_correct_option_id uuid;
  v_players jsonb;
begin
  select revealed.correct_option_id into v_correct_option_id
  from public.reveal_quiz_answer(p_room_id) revealed;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id', player.id,
    'nickname', player.nickname,
    'avatar_config', player.avatar_config,
    'score', player.score,
    'correct_answers', player.correct_answers,
    'streak', player.streak,
    'correct_response_time_ms', player.correct_response_time_ms
  )), '[]'::jsonb)
  into v_players
  from public.players player
  where player.room_id = p_room_id;

  return pg_catalog.jsonb_build_object(
    'correctOptionId', v_correct_option_id,
    'players', v_players
  );
end;
$$;

create or replace function public.reveal_quiz_answer(p_room_id uuid)
returns table(correct_option_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.game_rooms%rowtype;
  v_question_id uuid;
  v_correct_option_id uuid;
  v_answer_count integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_room_id::text, 0));

  select * into v_room
  from public.game_rooms
  where id = p_room_id and status = 'question'
  for update;
  if not found then raise exception 'There is no active question'; end if;
  if v_room.question_started_at > pg_catalog.clock_timestamp() then raise exception 'This question has not started yet'; end if;

  select id into v_question_id
  from public.questions
  where quiz_id = v_room.quiz_id and position = v_room.current_question;
  if not found then raise exception 'Current question not found'; end if;

  select id into v_correct_option_id
  from public.question_options
  where question_id = v_question_id and is_correct = true;

  update public.players player
  set score = player.score + scored.points,
      correct_answers = player.correct_answers + case when scored.correct then 1 else 0 end,
      correct_response_time_ms = player.correct_response_time_ms + case when scored.correct then coalesce(scored.response_time_ms, 0) else 0 end,
      streak = case when scored.correct then player.streak + 1 else 0 end
  from (
    select participant.id,
           coalesce(answer.points_awarded, 0) as points,
           coalesce(answer.is_correct, false) as correct,
           answer.response_time_ms
    from public.players participant
    left join public.answers answer
      on answer.player_id = participant.id
     and answer.question_id = v_question_id
    where participant.room_id = v_room.id
  ) scored
  where player.id = scored.id;

  select count(*)::integer into v_answer_count
  from public.answers
  where room_id = v_room.id and question_id = v_question_id;

  update public.game_rooms
  set status = 'results',
      answer_count = v_answer_count,
      updated_at = pg_catalog.clock_timestamp()
  where id = v_room.id;

  return query select v_correct_option_id;
end;
$$;

revoke all on function public.create_quiz_room(uuid, text, text) from public, anon, authenticated;
revoke all on function public.join_quiz_room(text, text, jsonb, uuid, text, text) from public, anon, authenticated;
revoke all on function public.submit_quiz_answer_v2(text, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.reveal_quiz_answer(uuid) from public, anon, authenticated;
revoke all on function public.reveal_quiz_answer_with_standings(uuid) from public, anon, authenticated;

grant execute on function public.create_quiz_room(uuid, text, text) to service_role;
grant execute on function public.join_quiz_room(text, text, jsonb, uuid, text, text) to service_role;
grant execute on function public.submit_quiz_answer_v2(text, uuid, text, uuid) to service_role;
grant execute on function public.reveal_quiz_answer(uuid) to service_role;
grant execute on function public.reveal_quiz_answer_with_standings(uuid) to service_role;

commit;
