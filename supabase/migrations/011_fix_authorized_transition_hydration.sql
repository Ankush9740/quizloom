begin;

-- Replace the Migration 010 function without changing its authorization or
-- response contract. COALESCE is SQL syntax, not a pg_catalog function.
create or replace function public.get_authorized_quiz_room_transition(
  p_room_code text,
  p_question_index integer,
  p_host_token_hash text,
  p_player_id uuid,
  p_player_token_hash text
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_room public.game_rooms%rowtype;
  v_question public.questions%rowtype;
  v_options jsonb;
  v_authorized boolean := false;
begin
  select room.* into v_room
  from public.game_rooms room
  where room.code = p_room_code
  order by room.created_at desc
  limit 1;

  -- Do not distinguish a missing room from invalid credentials.
  if not found then
    return pg_catalog.jsonb_build_object('kind', 'unauthorized');
  end if;

  if p_host_token_hash is not null then
    select exists (
      select 1
      from public.room_secrets secret
      where secret.room_id = v_room.id
        and secret.host_token_hash = p_host_token_hash
    ) into v_authorized;
  end if;

  if not v_authorized and p_player_id is not null and p_player_token_hash is not null then
    select exists (
      select 1
      from public.players player
      join public.player_secrets secret on secret.player_id = player.id
      where player.id = p_player_id
        and player.room_id = v_room.id
        and secret.player_token_hash = p_player_token_hash
    ) into v_authorized;
  end if;

  if not v_authorized then
    return pg_catalog.jsonb_build_object('kind', 'unauthorized');
  end if;

  if v_room.status <> 'question' or v_room.current_question <> p_question_index then
    return pg_catalog.jsonb_build_object('kind', 'moved', 'status', v_room.status);
  end if;

  select question.* into v_question
  from public.questions question
  where question.quiz_id = v_room.quiz_id
    and question.position = v_room.current_question;

  if not found then
    return pg_catalog.jsonb_build_object('kind', 'question-missing');
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', option.id,
        'text', option.text,
        'position', option.position
      ) order by option.position
    ),
    '[]'::jsonb
  ) into v_options
  from public.question_options option
  where option.question_id = v_question.id;

  return pg_catalog.jsonb_build_object(
    'kind', 'ok',
    'room', pg_catalog.jsonb_build_object(
      'status', 'question',
      'currentQuestion', v_room.current_question,
      'questionStartedAt', v_room.question_started_at,
      'questionEndsAt', v_room.question_ends_at,
      'answerCount', v_room.answer_count
    ),
    'question', pg_catalog.jsonb_build_object(
      'id', v_question.id,
      'number', v_question.position + 1,
      'prompt', v_question.prompt,
      'timeLimit', v_question.time_limit_seconds,
      'options', v_options
    )
  );
end;
$$;

revoke all on function public.get_authorized_quiz_room_transition(text, integer, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.get_authorized_quiz_room_transition(text, integer, text, uuid, text)
  to service_role;

commit;
