create extension if not exists pgcrypto;

create table public.quizzes (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 3 and 80),
  created_at timestamptz not null default now()
);

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  prompt text not null check (char_length(prompt) between 5 and 240),
  position integer not null check (position >= 0),
  time_limit_seconds integer not null default 20 check (time_limit_seconds between 5 and 120),
  unique (quiz_id, position)
);

create table public.question_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  text text not null check (char_length(text) between 1 and 120),
  position integer not null check (position between 0 and 3),
  is_correct boolean not null default false,
  unique (question_id, position)
);
create unique index one_correct_option_per_question on public.question_options(question_id) where is_correct;

create table public.game_rooms (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  code char(6) not null,
  status text not null default 'lobby' check (status in ('lobby','question','results','finished')),
  current_question integer not null default 0,
  question_started_at timestamptz,
  question_ends_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index unique_active_room_code on public.game_rooms(code) where status <> 'finished';
create index game_rooms_quiz_idx on public.game_rooms(quiz_id);

create table public.room_secrets (
  room_id uuid primary key references public.game_rooms(id) on delete cascade,
  host_token_hash text not null
);

create table public.players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.game_rooms(id) on delete cascade,
  nickname text not null check (char_length(nickname) between 2 and 18),
  avatar_config jsonb not null,
  score integer not null default 0 check (score >= 0),
  correct_answers integer not null default 0 check (correct_answers >= 0),
  streak integer not null default 0 check (streak >= 0),
  joined_at timestamptz not null default now()
);
create unique index unique_room_nickname on public.players(room_id, lower(nickname));
create index players_room_score_idx on public.players(room_id, score desc);

create table public.player_secrets (
  player_id uuid primary key references public.players(id) on delete cascade,
  player_token_hash text not null
);

create table public.answers (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.game_rooms(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  selected_option_id uuid not null references public.question_options(id),
  submitted_at timestamptz not null default now(),
  is_correct boolean not null,
  points_awarded integer not null default 0 check (points_awarded between 0 and 1000),
  unique (player_id, question_id)
);
create index answers_room_question_idx on public.answers(room_id, question_id);

alter table public.quizzes enable row level security;
alter table public.questions enable row level security;
alter table public.question_options enable row level security;
alter table public.game_rooms enable row level security;
alter table public.room_secrets enable row level security;
alter table public.players enable row level security;
alter table public.player_secrets enable row level security;
alter table public.answers enable row level security;

create policy "rooms are visible for realtime" on public.game_rooms for select to anon using (expires_at > now());
create policy "players are visible for realtime" on public.players for select to anon using (exists (select 1 from public.game_rooms r where r.id = room_id and r.expires_at > now()));
create policy "quiz titles are visible" on public.quizzes for select to anon using (exists (select 1 from public.game_rooms r where r.quiz_id = id and r.expires_at > now()));

revoke all on public.quizzes, public.questions, public.question_options, public.game_rooms, public.room_secrets, public.players, public.player_secrets, public.answers from anon, authenticated;
grant select on public.quizzes, public.game_rooms, public.players to anon;

create or replace function public.submit_quiz_answer(p_room_code text, p_player_id uuid, p_player_token_hash text, p_option_id uuid)
returns table(points integer, correct boolean)
language plpgsql security definer set search_path = public as $$
declare
  v_room game_rooms%rowtype; v_player players%rowtype; v_question questions%rowtype;
  v_correct boolean; v_points integer; v_elapsed numeric; v_limit numeric;
begin
  select * into v_room from game_rooms where code = p_room_code and status = 'question' for update;
  if not found then raise exception 'This question is no longer accepting answers'; end if;
  if v_room.question_ends_at < clock_timestamp() then raise exception 'Time is up for this question'; end if;
  select p.* into v_player from players p join player_secrets s on s.player_id = p.id where p.id = p_player_id and p.room_id = v_room.id and s.player_token_hash = p_player_token_hash;
  if not found then raise exception 'Your player session is not valid'; end if;
  select * into v_question from questions where quiz_id = v_room.quiz_id and position = v_room.current_question;
  select is_correct into v_correct from question_options where id = p_option_id and question_id = v_question.id;
  if not found then raise exception 'That answer is not valid for this question'; end if;
  v_elapsed := extract(epoch from (clock_timestamp() - v_room.question_started_at));
  v_limit := v_question.time_limit_seconds;
  v_points := case when v_correct then 700 + floor(300 * greatest(0, 1 - v_elapsed / v_limit))::integer else 0 end;
  begin
    insert into answers(room_id, player_id, question_id, selected_option_id, is_correct, points_awarded)
    values(v_room.id, p_player_id, v_question.id, p_option_id, v_correct, v_points);
  exception when unique_violation then raise exception 'You already answered this question'; end;
  update players set score = score + v_points, correct_answers = correct_answers + case when v_correct then 1 else 0 end,
    streak = case when v_correct then streak + 1 else 0 end where id = p_player_id;
  return query select v_points, v_correct;
end; $$;
revoke all on function public.submit_quiz_answer(text, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.submit_quiz_answer(text, uuid, text, uuid) to service_role;

alter publication supabase_realtime add table public.game_rooms;
alter publication supabase_realtime add table public.players;
