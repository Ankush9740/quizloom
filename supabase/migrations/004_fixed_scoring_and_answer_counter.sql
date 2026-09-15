begin;

alter table public.quizzes
  add column if not exists points_per_correct integer not null default 1
  check (points_per_correct between 1 and 1000);

alter table public.game_rooms
  add column if not exists answer_count integer not null default 0
  check (answer_count >= 0);

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
begin
  select * into v_room
  from game_rooms
  where code = p_room_code and status = 'question'
  for update;
  if not found then raise exception 'This question is no longer accepting answers'; end if;
  if v_room.question_ends_at < clock_timestamp() then raise exception 'Time is up for this question'; end if;

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

  select points_per_correct into v_points_per_correct
  from quizzes
  where id = v_room.quiz_id;
  v_points := case when v_correct then v_points_per_correct else 0 end;

  begin
    insert into answers(room_id, player_id, question_id, selected_option_id, is_correct, points_awarded)
    values(v_room.id, p_player_id, v_question.id, p_option_id, v_correct, v_points);
  exception when unique_violation then
    raise exception 'You already answered this question';
  end;

  update game_rooms
  set answer_count = answer_count + 1,
      updated_at = clock_timestamp()
  where id = v_room.id;

  return query select v_points, v_correct;
end;
$$;

revoke all on function public.submit_quiz_answer(text, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.submit_quiz_answer(text, uuid, text, uuid) to service_role;

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
  select * into v_room
  from game_rooms
  where id = p_room_id and status = 'question'
  for update;
  if not found then raise exception 'There is no active question'; end if;

  select id into v_question_id
  from questions
  where quiz_id = v_room.quiz_id and position = v_room.current_question;
  if not found then raise exception 'Current question not found'; end if;

  select id into v_correct_option_id
  from question_options
  where question_id = v_question_id and is_correct = true;

  update players p
  set score = p.score + coalesce((
        select a.points_awarded from answers a
        where a.player_id = p.id and a.question_id = v_question_id
      ), 0),
      correct_answers = p.correct_answers + case when coalesce((
        select a.is_correct from answers a
        where a.player_id = p.id and a.question_id = v_question_id
      ), false) then 1 else 0 end,
      streak = case when coalesce((
        select a.is_correct from answers a
        where a.player_id = p.id and a.question_id = v_question_id
      ), false) then p.streak + 1 else 0 end
  where p.room_id = v_room.id;

  update game_rooms
  set status = 'results', updated_at = clock_timestamp()
  where id = v_room.id;

  return query select v_correct_option_id;
end;
$$;

revoke all on function public.reveal_quiz_answer(uuid) from public, anon, authenticated;
grant execute on function public.reveal_quiz_answer(uuid) to service_role;

commit;
