begin;

-- A room code identifies a session but is not an authorization credential.
-- This lightweight check lets the application authorize callers before it
-- coalesces the existing question-transition hydration across subscribers.
create or replace function public.authorize_quiz_room_session(
  p_room_code text,
  p_host_token_hash text,
  p_player_id uuid,
  p_player_token_hash text
) returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_room_id uuid;
begin
  select room.id into v_room_id
  from public.game_rooms room
  where room.code = p_room_code
  order by room.created_at desc
  limit 1;

  if v_room_id is null then return false; end if;

  if p_host_token_hash is not null and exists (
    select 1
    from public.room_secrets secret
    where secret.room_id = v_room_id
      and secret.host_token_hash = p_host_token_hash
  ) then return true; end if;

  return p_player_id is not null
    and p_player_token_hash is not null
    and exists (
      select 1
      from public.players player
      join public.player_secrets secret on secret.player_id = player.id
      where player.id = p_player_id
        and player.room_id = v_room_id
        and secret.player_token_hash = p_player_token_hash
    );
end;
$$;

revoke all on function public.authorize_quiz_room_session(text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.authorize_quiz_room_session(text, text, uuid, text) to service_role;

-- Preserve migration 007's atomic lifecycle/reconnection behavior while
-- assigning duplicate character choices a deterministic room-local backdrop.
-- A character-scoped advisory lock makes the read/choose/insert sequence safe
-- for simultaneous joins without serializing players choosing other artwork.
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
  v_avatar jsonb;
  v_character text;
  v_accent text;
  v_character_count integer;
  v_palette text[] := array[
    '#3155E7', '#C2415C', '#16866A', '#6842C2', '#A8326D', '#196C8C',
    '#B45309', '#475569', '#0F766E', '#7C3AED', '#BE123C', '#0369A1'
  ];
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

  v_character := coalesce(nullif(p_avatar ->> 'character', ''), 'custom');
  v_accent := coalesce(nullif(p_avatar ->> 'accent', ''), v_palette[1]);

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_room.id::text || ':avatar:' || v_character, 0)
  );

  select pg_catalog.count(*)::integer into v_character_count
  from public.players player
  where player.room_id = v_room.id
    and coalesce(player.avatar_config ->> 'character', 'custom') = v_character;

  if v_character_count > 0 then
    select candidate.color into v_accent
    from pg_catalog.unnest(v_palette) with ordinality as candidate(color, position)
    where not exists (
      select 1
      from public.players player
      where player.room_id = v_room.id
        and coalesce(player.avatar_config ->> 'character', 'custom') = v_character
        and pg_catalog.upper(player.avatar_config ->> 'accent') = pg_catalog.upper(candidate.color)
    )
    order by candidate.position
    limit 1;

    if v_accent is null then
      v_accent := v_palette[(v_character_count % pg_catalog.cardinality(v_palette)) + 1];
    end if;
  end if;

  v_avatar := pg_catalog.jsonb_set(p_avatar, '{accent}'::text[], pg_catalog.to_jsonb(v_accent), true);

  begin
    insert into public.players(room_id, nickname, avatar_config)
    values (v_room.id, p_nickname, v_avatar)
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

revoke all on function public.join_quiz_room(text, text, jsonb, uuid, text, text) from public, anon, authenticated;
grant execute on function public.join_quiz_room(text, text, jsonb, uuid, text, text) to service_role;

commit;
