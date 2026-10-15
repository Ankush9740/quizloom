# Quizloom

Quizloom is an open-source, real-time multiplayer quiz app for classrooms and college events. Hosts build a four-option quiz, share a six-digit room code, and control the pace while players join without accounts, create an original avatar, answer on their phones, and climb a live leaderboard.

## Features

- Mobile-first player flow with no registration
- Quiz builder with four-option MCQs, per-question timers, and configurable fixed points
- Reusable quiz library with separate create, edit, save, host, delete, JSON import, and JSON export flows
- Unique six-digit rooms and passwordless host/player session tokens
- SVG/CSS avatar customizer with 12 character presets and reusable avatar configuration
- Supabase Realtime lobby, room-state, and leaderboard updates
- Server-authoritative scoring with a host-configured fixed value for every correct answer
- Atomic, duplicate-safe answer submissions in PostgreSQL
- Host-controlled reveals with authoritative personal feedback, a live aggregate answer counter, leaderboard, and final podium
- Refresh recovery using a device-local opaque player token
- Friendly configuration, room, session, network, and submission errors
- Accessible focus states, semantic controls, strong contrast, and reduced-motion support

## Stack

Next.js App Router, TypeScript, Tailwind CSS, Supabase PostgreSQL, Supabase Realtime, and Vercel serverless functions.

## Local setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a Supabase project.
3. Open the Supabase SQL Editor and run every file in `supabase/migrations/` in numeric order. Existing installations must apply new numbered migrations as they are added; fixed scoring and the live answer counter require `004_fixed_scoring_and_answer_counter.sql`.
4. Optionally run `supabase/seed.sql` to add the five-question **Campus Curiosity Cup** quiz. The builder also has a **Load demo quiz** button, which is the quickest end-to-end test.
5. Copy `.env.example` to `.env.local` and fill in the values.
6. Start the app:

   ```bash
   npm run dev
   ```

Open `http://localhost:3000`. Use one browser window as host and private/incognito windows as players.

## Environment variables

| Variable | Used by | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser + server | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser | Restricted public key for Realtime subscriptions |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Trusted API/database operations; never expose it with a `NEXT_PUBLIC_` prefix |
| `SESSION_TOKEN_PEPPER` | Server only | Long random secret used when hashing host and player tokens |

Generate a pepper with a password manager or a cryptographically secure random generator. Use the same value locally and on Vercel for active sessions to survive deployments.

## Architecture and security

The browser subscribes to low-frequency room/player table changes through Supabase Realtime. It does not broadcast a timer tick: the server stores question start/end timestamps and each client renders its own countdown.

All mutations go through Next.js Route Handlers using the server-only Supabase service role. Quizzes, rooms, and players receive separate opaque access tokens; only hashes are stored in dedicated, non-Realtime secret tables. The browser remembers quiz access locally, providing a simple private library without requiring host accounts. PostgreSQL RLS prevents public access to token hashes, answers, questions, and correctness flags. The `submit_quiz_answer` security-definer function locks the room row, checks the active question and deadline, verifies the player token, rejects duplicates, records the quiz's exact configured point value, and increments only an aggregate room answer count. Scores and streaks are applied atomically by `reveal_quiz_answer` when the host reveals, preventing correctness from being inferred from pre-reveal score changes. The answer API returns only acceptance; correctness is available through `get_player_reveal` only after the room has authoritatively entered the results state.

Important areas:

- `app/api/` — trusted quiz-library, room, player, answer, and host endpoints
- `components/quiz-library.tsx` — saved quiz selection, import, export, edit, and host actions
- `lib/client/http.ts` — content-type-aware JSON response handling for library operations
- `components/quiz-builder.tsx` — host authoring experience
- `components/host-room.tsx` — projected host lobby/game controls
- `components/player-room.tsx` — mobile player lobby/game/results
- `hooks/use-room.ts` — Realtime refresh and Presence tracking
- `supabase/migrations/001_initial_schema.sql` — schema, indexes, RLS, grants, scoring function, and Realtime publication
- `supabase/migrations/003_quiz_library_and_fast_reveal.sql` — reusable quiz access and secure lightweight reveal response
- `supabase/migrations/004_fixed_scoring_and_answer_counter.sql` — fixed quiz scoring and aggregate live answer count

## Portable quiz JSON

Quizloom accepts strict versioned JSON documents. Each quiz contains 1–50 questions, exactly four options per question, a zero-based `correctAnswer`, and a 5–120 second limit. See the small importable examples in `examples/quizzes/`.

```json
{
  "version": 1,
  "title": "HTML Basics",
  "description": "HTML fundamentals",
  "pointsPerCorrectAnswer": 1,
  "questions": [
    {
      "question": "What does HTML stand for?",
      "options": ["Hyper Text Markup Language", "High Text Machine Language", "Hyper Tool Markup Language", "Home Text Markup Language"],
      "correctAnswer": 0,
      "timeLimit": 20
    }
  ]
}
```

For a room of 50 players, question clocks generate no network traffic. A submission causes one answer request and one small aggregate room counter change. The host patches that count directly without refetching question or leaderboard data; player score rows change only after reveal.

## Verification

```bash
npm run typecheck
npm run lint
npm run build
```

To smoke-test manually: load the demo quiz, launch a room, join from two private windows, start, answer from both, reveal, continue through all five questions, and verify the podium. Refresh a player mid-game to verify reconnection.

With the development server running, `node scripts/regression-smoke.mjs` creates disposable test data, checks the library/create/edit/host/join/answer/reveal/scoring/delete API flow, and removes its test quizzes afterward.

Database-backed load tests require an isolated Supabase project and fail closed when staging identity cannot be verified. Follow [the performance staging guide](docs/performance-staging.md); never run the performance scripts with production credentials.

## Deploy to Vercel

1. Push the repository to GitHub and import it into Vercel.
2. Add all four environment variables from `.env.example` in Project Settings → Environment Variables.
3. Deploy with the default Next.js settings.
4. Add the production URL to the Supabase project's allowed site URLs if you later add Supabase Authentication (the current player flow does not use Auth).

Do not put `SUPABASE_SERVICE_ROLE_KEY` or `SESSION_TOKEN_PEPPER` in client-side code.

## Contributing

Fork the project, create a focused branch, run the three verification commands, and open a pull request describing the user-facing change. Keep player interactions mobile-first and security-sensitive mutations server-authoritative.

## License

MIT — see [LICENSE](LICENSE).
