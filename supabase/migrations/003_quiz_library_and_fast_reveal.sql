begin;

alter table public.quizzes
  add column if not exists description text not null default '' check (char_length(description) <= 300),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.quiz_secrets (
  quiz_id uuid primary key references public.quizzes(id) on delete cascade,
  quiz_token_hash text not null
);
alter table public.quiz_secrets enable row level security;

grant select, insert, update, delete on table public.quiz_secrets to service_role;
grant select, insert, update, delete on table public.quizzes, public.questions, public.question_options to service_role;

create or replace function public.get_player_reveal(
  p_room_code text,
  p_player_id uuid,
  p_player_token_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room game_rooms%rowtype;
  v_player players%rowtype;
  v_question_id uuid;
  v_correct_option_id uuid;
  v_correct_option_text text;
  v_answer answers%rowtype;
begin
  select * into v_room from game_rooms where code = p_room_code and status = 'results';
  if not found then raise exception 'The answer has not been revealed'; end if;

  select p.* into v_player
  from players p
  join player_secrets s on s.player_id = p.id
  where p.id = p_player_id
    and p.room_id = v_room.id
    and s.player_token_hash = p_player_token_hash;
  if not found then raise exception 'Your player session is not valid'; end if;

  select id into v_question_id from questions
  where quiz_id = v_room.quiz_id and position = v_room.current_question;
  select id, text into v_correct_option_id, v_correct_option_text
  from question_options where question_id = v_question_id and is_correct = true;

  select * into v_answer from answers
  where player_id = p_player_id and question_id = v_question_id;

  return jsonb_build_object(
    'correctOptionId', v_correct_option_id,
    'correctOptionText', v_correct_option_text,
    'answered', found,
    'selectedOptionId', case when found then v_answer.selected_option_id else null end,
    'wasCorrect', case when found then v_answer.is_correct else null end,
    'lastPoints', case when found then v_answer.points_awarded else 0 end,
    'score', v_player.score,
    'correctAnswers', v_player.correct_answers,
    'streak', v_player.streak
  );
end;
$$;

revoke all on function public.get_player_reveal(text, uuid, text) from public, anon, authenticated;
grant execute on function public.get_player_reveal(text, uuid, text) to service_role;

commit;
