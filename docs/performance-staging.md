# Quizloom performance staging

The performance benchmark creates disposable quizzes, rooms, players, answers, and Realtime subscriptions. It must never target the production Supabase project.

## One-time manual setup

1. Create a separate Supabase project from the Supabase dashboard. Choose the same geographic area as the Vercel functions when practical. Do not clone or import production user data.
2. In the staging project's SQL editor, run `supabase/migrations/001_initial_schema.sql` through `006_speed_ranking_synchronized_start_and_custom_timers.sql` in numeric order. Do not run these files against production as part of benchmarking.
3. Copy `.env.staging.example` to `.env.staging.local`.
4. Fill `.env.staging.local` with credentials from the staging project only. Set:
   - `QUIZLOOM_STAGING_PROJECT_REF` to the staging Supabase URL subdomain.
   - `QUIZLOOM_PRODUCTION_PROJECT_REF` to the production URL subdomain. This is an identity check, not a credential.
   - `QUIZLOOM_SUPABASE_REGION` to the region shown in the staging Supabase dashboard.
   - `QUIZLOOM_TEST_URL` to the local staging-backed server or an approved Vercel preview URL.
5. Keep `.env.staging.local` local. It is ignored by Git. Never copy its service-role key into a `NEXT_PUBLIC_` variable.

The benchmark refuses to start unless the staging and production project refs differ, the configured Supabase URL matches the staging ref, the write acknowledgement is exact, and `--confirm-staging` is supplied.

## Local staging-backed server

Start Next.js with the staging environment injected before Next loads `.env.local`:

```bash
npm run dev:staging -- --confirm-staging -H 127.0.0.1
```

The target exposes `/api/benchmark/identity` only when `QUIZLOOM_ENVIRONMENT=staging`. The benchmark verifies this endpoint before creating any data, so a local server that accidentally loaded production configuration is rejected.

## Optional Vercel preview

Using the existing Vercel project, add the staging variables to the **Preview** environment only and produce a branch preview after approval. Do not add `QUIZLOOM_ENVIRONMENT=staging` or the staging write acknowledgement to Production. Because `NEXT_PUBLIC_SUPABASE_URL` is embedded during the build, create a new preview deployment after changing Preview variables.

Set `QUIZLOOM_TEST_URL` locally to that exact preview origin. The report records the observed `x-vercel-id` region and the configured Supabase region so cross-region placement can be reviewed. No Vercel deployment is performed by the benchmark.

## Running benchmarks

With the staging-backed app already running:

```bash
npm run test:performance -- --confirm-staging
```

The default matrix uses 2, 10, 20, and 50 simulated players, six questions, and three runs per population. To separate API/database processing from Realtime delivery:

```bash
npm run test:performance:direct -- --confirm-staging
```

Options can be overridden, for example:

```bash
node scripts/performance-benchmark.mjs --confirm-staging --players=20,50 --questions=6 --runs=5 --delivery=realtime
```

The JSON report includes HTTP, server, network/client overhead, approximate database-to-subscriber delivery, Realtime-to-hydrated-state, scheduled-start headroom, authoritative duration, request counts, and Realtime message counts. It reports p50 for non-empty samples, p95 for 20 or more samples, and p99 for 100 or more samples.

All created quizzes are given disposable benchmark titles. Cleanup ends the room and deletes the quiz after every run. If a process is forcibly terminated, remove only quizzes whose titles begin with `Performance`; never run a broad database delete.

