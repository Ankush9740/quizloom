begin;

-- Preserve existing rooms in legacy ranking mode. Only rooms created after this
-- migration use authoritative correct-answer response time as their tie-break.
alter table public.game_rooms
  add column if not exists speed_ranking_enabled boolean not null default false;
alter table public.game_rooms
  alter column speed_ranking_enabled set default true;

alter table public.players
  add column if not exists correct_response_time_ms bigint not null default 0;
alter table public.players drop constraint if exists players_correct_response_time_ms_check;
alter table public.players
  add constraint players_correct_response_time_ms_check check (correct_response_time_ms >= 0);

-- Nullable by design: answers recorded before this migration have no fabricated
-- timing value. New submissions always populate the column in the RPC below.
alter table public.answers
  add column if not exists response_time_ms integer;
alter table public.answers drop constraint if exists answers_response_time_ms_check;
alter table public.answers
  add constraint answers_response_time_ms_check check (response_time_ms between 0 and 300000);

alter table public.questions drop constraint if exists questions_time_limit_seconds_check;
alter table public.questions
  add constraint questions_time_limit_seconds_check check (time_limit_seconds between 5 and 300);

create index if not exists players_room_speed_ranking_idx
  on public.players(room_id, score desc, correct_response_time_ms asc);

create or replace function public.submit_quiz_answer(
  p_room_code text,
  p_player_id uuid,
  p_player_token_hash text,
  p_option_id uuid
) returns table(points integer, correct boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room game_rooms%rowtype;
  v_player players%rowtype;
  v_question questions%rowtype;
  v_correct boolean;
  v_points integer;
  v_points_per_correct integer;
  v_now timestamptz;
  v_response_time_ms integer;
begin
  select * into v_room from game_rooms where code = p_room_code;
  if not found then raise exception 'This question is no longer accepting answers'; end if;

  perform pg_advisory_xact_lock_shared(hashtextextended(v_room.id::text, 0));

  select * into v_room
  from game_rooms
  where id = v_room.id and status = 'question';
  if not found then raise exception 'This question is no longer accepting answers'; end if;

  v_now := clock_timestamp();
  if v_room.question_started_at is null or v_room.question_ends_at is null then
    raise exception 'This question is not ready yet';
  end if;
  if v_now < v_room.question_started_at then raise exception 'This question has not started yet'; end if;
  if v_now > v_room.question_ends_at then raise exception 'Time is up for this question'; end if;

  select p.* into v_player
  from players p
  join player_secrets s on s.player_id = p.id
  where p.id = p_player_id
    and p.room_id = v_room.id
    and s.player_token_hash = p_player_token_hash;
  if not found then raise exception 'Your player session is not valid'; end if;

  select * into v_question
  from questions
  where quiz_id = v_room.quiz_id and position = v_room.current_question;

  select is_correct into v_correct
  from question_options
  where id = p_option_id and question_id = v_question.id;
  if not found then raise exception 'That answer is not valid for this question'; end if;

  select points_per_correct into v_points_per_correct from quizzes where id = v_room.quiz_id;
  v_points := case when v_correct then v_points_per_correct else 0 end;
  v_response_time_ms := least(
    v_question.time_limit_seconds * 1000,
    greatest(0, floor(extract(epoch from (v_now - v_room.question_started_at)) * 1000)::integer)
  );

  begin
    insert into answers(room_id, player_id, question_id, selected_option_id, submitted_at, is_correct, points_awarded, response_time_ms)
    values(v_room.id, p_player_id, v_question.id, p_option_id, v_now, v_correct, v_points, v_response_time_ms);
  exception when unique_violation then
    raise exception 'You already answered this question';
  end;

  update game_rooms
  set answer_count = answer_count + 1,
      updated_at = v_now
  where id = v_room.id;

  return query select v_points, v_correct;
end;
$$;

create or replace function public.reveal_quiz_answer(p_room_id uuid)
returns table(correct_option_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room game_rooms%rowtype;
  v_question_id uuid;
  v_correct_option_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_room_id::text, 0));

  select * into v_room
  from game_rooms
  where id = p_room_id and status = 'question'
  for update;
  if not found then raise exception 'There is no active question'; end if;
  if v_room.question_started_at > clock_timestamp() then raise exception 'This question has not started yet'; end if;

  select id into v_question_id
  from questions
  where quiz_id = v_room.quiz_id and position = v_room.current_question;
  if not found then raise exception 'Current question not found'; end if;

  select id into v_correct_option_id
  from question_options
  where question_id = v_question_id and is_correct = true;

  update players player
  set score = player.score + scored.points,
      correct_answers = player.correct_answers + case when scored.correct then 1 else 0 end,
      correct_response_time_ms = player.correct_response_time_ms + case when scored.correct then coalesce(scored.response_time_ms, 0) else 0 end,
      streak = case when scored.correct then player.streak + 1 else 0 end
  from (
    select participant.id,
           coalesce(answer.points_awarded, 0) as points,
           coalesce(answer.is_correct, false) as correct,
           answer.response_time_ms
    from players participant
    left join answers answer
      on answer.player_id = participant.id
     and answer.question_id = v_question_id
    where participant.room_id = v_room.id
  ) scored
  where player.id = scored.id;

  update game_rooms
  set status = 'results', updated_at = clock_timestamp()
  where id = v_room.id;

  return query select v_correct_option_id;
end;
$$;

-- Atomically advances a room and derives both timestamps from the database
-- clock. The short lead time lets Realtime and transition hydration finish
-- before the shared answering window begins.
create or replace function public.transition_quiz_room(
  p_room_id uuid,
  p_action text,
  p_start_lead_ms integer default 3000
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room game_rooms%rowtype;
  v_question questions%rowtype;
  v_index integer;
  v_now timestamptz;
  v_started_at timestamptz;
  v_ends_at timestamptz;
  v_options jsonb;
begin
  if p_action not in ('start', 'next') then raise exception 'Room action is not valid'; end if;
  if p_start_lead_ms < 500 or p_start_lead_ms > 10000 then raise exception 'Question start lead time is not valid'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_room_id::text, 0));
  select * into v_room from game_rooms where id = p_room_id for update;
  if not found then raise exception 'Room not found'; end if;

  if p_action = 'start' then
    if v_room.status <> 'lobby' then raise exception 'The quiz has already started'; end if;
    v_index := 0;
  else
    if v_room.status <> 'results' then raise exception 'Reveal the answer before continuing'; end if;
    v_index := v_room.current_question + 1;
  end if;

  select * into v_question
  from questions
  where quiz_id = v_room.quiz_id and position = v_index;

  if not found then
    v_now := clock_timestamp();
    update game_rooms
    set status = 'finished', updated_at = v_now
    where id = v_room.id
    returning * into v_room;
    return jsonb_build_object(
      'room', jsonb_build_object(
        'status', 'finished',
        'currentQuestion', v_room.current_question,
        'questionStartedAt', v_room.question_started_at,
        'questionEndsAt', v_room.question_ends_at,
        'answerCount', v_room.answer_count
      )
    );
  end if;

  v_now := clock_timestamp();
  v_started_at := v_now + make_interval(secs => p_start_lead_ms / 1000.0);
  v_ends_at := v_started_at + make_interval(secs => v_question.time_limit_seconds);

  update game_rooms
  set status = 'question',
      current_question = v_index,
      question_started_at = v_started_at,
      question_ends_at = v_ends_at,
      answer_count = 0,
      updated_at = v_now
  where id = v_room.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', option.id,
    'text', option.text,
    'position', option.position
  ) order by option.position), '[]'::jsonb)
  into v_options
  from question_options option
  where option.question_id = v_question.id;

  return jsonb_build_object(
    'room', jsonb_build_object(
      'status', 'question',
      'currentQuestion', v_index,
      'questionStartedAt', v_started_at,
      'questionEndsAt', v_ends_at,
      'answerCount', 0
    ),
    'question', jsonb_build_object(
      'id', v_question.id,
      'number', v_question.position + 1,
      'prompt', v_question.prompt,
      'timeLimit', v_question.time_limit_seconds,
      'options', v_options
    )
  );
end;
$$;

-- One database round trip for the player transition hydration that follows a
-- Realtime room update. No correct option or future question is returned.
create or replace function public.get_quiz_room_transition(
  p_room_code text,
  p_question_index integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room game_rooms%rowtype;
  v_question questions%rowtype;
  v_options jsonb;
begin
  select * into v_room
  from game_rooms
  where code = p_room_code
  order by created_at desc
  limit 1;
  if not found then return jsonb_build_object('kind', 'missing'); end if;
  if v_room.status <> 'question' or v_room.current_question <> p_question_index then
    return jsonb_build_object('kind', 'moved', 'status', v_room.status);
  end if;

  select * into v_question
  from questions
  where quiz_id = v_room.quiz_id and position = v_room.current_question;
  if not found then return jsonb_build_object('kind', 'question-missing'); end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', option.id,
    'text', option.text,
    'position', option.position
  ) order by option.position), '[]'::jsonb)
  into v_options
  from question_options option
  where option.question_id = v_question.id;

  return jsonb_build_object(
    'kind', 'ok',
    'room', jsonb_build_object(
      'status', 'question',
      'currentQuestion', v_room.current_question,
      'questionStartedAt', v_room.question_started_at,
      'questionEndsAt', v_room.question_ends_at,
      'answerCount', v_room.answer_count
    ),
    'question', jsonb_build_object(
      'id', v_question.id,
      'number', v_question.position + 1,
      'prompt', v_question.prompt,
      'timeLimit', v_question.time_limit_seconds,
      'options', v_options
    )
  );
end;
$$;

revoke all on function public.submit_quiz_answer(text, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.reveal_quiz_answer(uuid) from public, anon, authenticated;
revoke all on function public.transition_quiz_room(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.get_quiz_room_transition(text, integer) from public, anon, authenticated;

grant execute on function public.submit_quiz_answer(text, uuid, text, uuid) to service_role;
grant execute on function public.reveal_quiz_answer(uuid) to service_role;
grant execute on function public.transition_quiz_room(uuid, text, integer) to service_role;
grant execute on function public.get_quiz_room_transition(text, integer) to service_role;

commit;
