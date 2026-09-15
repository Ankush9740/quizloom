-- The service-role key bypasses RLS, but PostgreSQL privileges are still required.
-- Some Supabase projects do not apply service_role default grants to tables
-- created through the SQL editor, so grant only the server role the access used
-- by Quizloom's trusted Next.js API routes.

begin;

grant usage on schema public to service_role;

grant select, insert, update, delete on table
  public.quizzes,
  public.questions,
  public.question_options,
  public.game_rooms,
  public.room_secrets,
  public.players,
  public.player_secrets,
  public.answers
to service_role;

grant execute on function public.submit_quiz_answer(text, uuid, text, uuid)
to service_role;

alter default privileges in schema public
grant select, insert, update, delete on tables to service_role;

commit;
