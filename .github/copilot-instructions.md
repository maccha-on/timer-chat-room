## Repository overview

- Framework: Next.js (App Router). App sources live under `app/`.
- Realtime & DB: Supabase is the primary backend. Client usage is in `app` components via `app/lib/supabaseClient.ts`. Server-side usages (admin/service role) appear in `app/api/**/route.ts` files.
- Public data: topic lists live in `public/normal.json`, `public/hard.json`, `public/expert.json` and are read by `app/api/generate-topic/route.ts`.

## Key things an AI assistant must know before editing

- Client vs Server split: Files under `app/` may be client components (`'use client'`) or server route handlers. Client code imports `supabase` from `app/lib/supabaseClient.ts` which expects NEXT_PUBLIC_* env vars. Server API routes construct a Supabase admin client with `createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)` and therefore require the service role key to be set in the environment.
- Auth pattern in API routes: server routes expect an Authorization header: `Bearer <access_token>`. They call `serviceClient.auth.getUser(token)` to resolve the user and then perform DB operations (see `app/api/rooms/route.ts`, `app/api/room-members/route.ts`, `app/api/profile/route.ts`). Follow this pattern when adding new server endpoints.
- Realtime: client pages subscribe to Supabase realtime channels (example in `app/page.tsx` for `rooms`). When updating or adding realtime behavior, mirror the existing `channel(...).on('postgres_changes', ...)` pattern and ensure channels are removed via `supabase.removeChannel(channel)` on cleanup.

## Environment variables (must be present locally and in deployment)

- NEXT_PUBLIC_SUPABASE_URL — public Supabase URL (used by both client and server code in this repo).
- NEXT_PUBLIC_SUPABASE_ANON_KEY — anon key used by client `supabase` in `app/lib/supabaseClient.ts`.
- SUPABASE_SERVICE_ROLE_KEY — server-only service role key used in API routes. NEVER expose this to client bundles.

## Important files to reference when making changes

- `app/lib/supabaseClient.ts` — single client instance; client code should import from here.
- `app/api/generate-topic/route.ts` — shows: reading `public/*.json`, role selection logic, rounds/round_roles DB inserts, and the pattern for returning limited role visibility (presenter/insider see topic; others do not).
- `app/api/rooms/route.ts` & `app/api/room-members/route.ts` — server-side patterns for auth verification and DB access with service client.
- `app/page.tsx` — example of client-only component using `supabase.auth.getSession()`, onAuthStateChange, and realtime subscriptions.

## Coding conventions and patterns found here

- Use `await supabase.from(...).select(...).maybeSingle()` or `.single()` according to expectation. Handle `error` and return readable JSON errors in server routes.
- Server API handlers return `NextResponse.json(...)` with appropriate HTTP status codes. Keep to that style.
- When modifying public topic lists, update the corresponding `public/*.json` file. `generate-topic` expects an array of strings.
- Use TypeScript types where present and preserve `use client` directives on client components.

## Examples to follow (copyable patterns)

- Server auth header check (canonical):

  - Expect `Authorization: Bearer <token>` and call `serviceClient.auth.getUser(token)` to resolve user.

- Creating a service client in a server route (do NOT expose SUPABASE_SERVICE_ROLE_KEY client-side):

  - `const serviceClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);`

## Developer workflows and scripts

- Start dev: `npm run dev` (uses `next dev --turbopack`).
- Build: `npm run build` (uses `next build --turbopack`).
- Lint: `npm run lint`.

Note: I did not run the build/lint in this editing session — ensure `node_modules` are installed locally (`npm install`) before running those commands.

## Quick tasks an AI can safely perform

- Add a new API route that follows existing auth pattern (check bearer token -> getUser -> use service client).
- Update `public/*.json` topic lists (these are static assets loaded at runtime by `generate-topic`).
- Add client-side UI components that import `supabase` from `app/lib/supabaseClient.ts` and follow `useEffect` cleanup patterns for subscriptions.

## Cautions / gotchas

- Never add `SUPABASE_SERVICE_ROLE_KEY` to client bundles. Any change that touches `app/lib/supabaseClient.ts` must not import server-only keys.
- Server routes assume service role key presence and will throw early if it's missing. When testing locally, set the env vars (Vercel or `.env.local`) appropriately.

## Where to ask for clarification

- If a change needs DB schema knowledge (table columns beyond what's used in code), ask the repo owner — the code reveals usage for `profiles`, `rooms`, `room_members`, `rounds`, `round_roles`, and `room_scores` but not the full schema.

---
If any of these sections are unclear or you'd like me to expand a particular example (for instance, an example server route scaffold or a client subscription helper), tell me which part to expand and I'll update the file.
