# roster architecture

`CLAUDE.md` is operational context (dev commands, port, auth, ORM policy). This file is only
"where is the code" — table and bullets, no prose.

- This map is a **contract: move a file, update this map in the same change.** An unmaintained
  map is an immediately false one.
- Full plan and stage breakdown: `docs/roster/index.md`; design decisions: `docs/roster/adr.md`.
- Stage 01 (this PR) is done: auth + chapter gate only. No domain code exists yet.

## Code map

| What you're looking for | Where |
|---|---|
| Auth (RP session, chapter ACL, sign-in redirect, permission judgment) | `app/features/auth/` |
| Cross-cutting primitive with no domain (`safeReturnTo`) | `app/lib/` — 1 file only, see "Placement rules" |
| App shell UI | doesn't exist yet — no shared chrome, no local `ui/` (ADR-001: UI primitives come from `@gdgjp/gdg-lib`) |
| Solver (Stage 06) | will be `app/features/solver/` — pure TS, no D1/React |
| Domain schema (events, time slots, tracks, roles, demand, applications, assignments, revisions) | doesn't exist yet — Stage 02 onward, see `docs/roster/index.md` §4 |

## Route surface

`app/routes.ts` (config mode). Every route today:

```
app/routes/
  home.tsx          "/" — placeholder event list (auth + chapter required)
  signin.tsx         "/signin" — redirects into the gdg-lib auth flow
  no-chapter.tsx      "/no-chapter"
  api.auth.$.ts       "/api/auth/*" — gdg-lib RP plumbing
  auth.signout.ts     "/auth/signout"
  dev.login.tsx       "/dev/login" — local/e2e only, hard 404 in production
  dev.seed.tsx        "/dev/seed" — local/e2e only, hard 404 in production
```

`tests/architecture/route-urls.test.ts` snapshots this full URL set; a snapshot diff is the
signal that a route was added, moved, or removed — expected to fail when you add one.

## Placement rules (ADR-003)

1. **Domain code goes in `app/features/<domain>/`.** Server + client + UI + colocated tests
   together. UI subfolder (once one exists) is `app/features/<domain>/components/`.
2. **`app/lib/` holds only domain-free cross-cutting primitives.** Today: `return-to.ts`. Adding
   a new file here is presumed wrong — it almost always belongs under `app/features/<domain>/`.
   `layering.test.ts` whitelists the exact top-level set.
3. **`app/components/` would hold only the app shell + local `ui/` primitives — neither exists.**
   Per ADR-001, roster has no local UI primitive layer; shared UI comes from `@gdgjp/gdg-lib`.
4. **`app/routes/` holds only route modules.** Loader/action logic beyond "read the request, call
   a feature, shape the response" belongs in a feature's `*.server.ts`.
5. **Tests sit next to the file they exercise**, named `<subject>.test.ts` (or
   `<subject>.<aspect>.test.ts` for multiple angles per subject).
6. **1 file ≤ 400 lines** (tests and generated files excluded).
7. **`workers/` is the runtime boundary only** (Worker entry point). No Durable Object, no
   per-feature Worker-side implementation exists yet.

## Runtime boundary

| Boundary | File |
|---|---|
| Worker entry (`fetch`) | `workers/app.ts` |

## Generated — don't read, don't hand-edit

| File | Source of truth |
|---|---|
| `worker-configuration.d.ts` | `wrangler.toml` bindings (run `pnpm cf-typegen` after changing them) |
| `schema.sql` | `migrations/` (run `pnpm migrate:local` after adding a migration) |

## Where tests live

| Kind | Location | Naming |
|---|---|---|
| Unit | Next to the source | `<subject>.test.ts(x)` / `<subject>.<aspect>.test.ts(x)` |
| Architecture convention | `tests/architecture/` | name of the convention it checks |
| E2E | `e2e/` | `<flow>.spec.ts` |
