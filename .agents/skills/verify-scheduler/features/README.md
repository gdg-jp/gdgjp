# Scheduler feature map

Drive these journeys against the isolated Scheduler started by
`node scripts/verification/app-stack.mjs --app scheduler --serve`, which serves
the built Worker at `http://localhost:6168`. Current-run status and evidence belong
in the skill's `coverage.json`. Every journey starts as `NOT VERIFIED`; a source
recipe is not execution evidence.

| Journey IDs | Feature | Identity |
| --- | --- | --- |
| `scheduler-shell-theme`, `scheduler-shell-viewport` | [Header, theme, and viewport](shell.md) | Anonymous |
| `scheduler-create-anon`, `scheduler-create-owner`, `scheduler-create-validation` | [Create an event](create.md) | Anonymous and `verify-owner` |
| `scheduler-respond-anon`, `scheduler-respond-signed-in`, `scheduler-anon-identity`, `scheduler-event-missing` | [Respond to an event](respond.md) | Anonymous, seeded guest cookie, and `verify-owner` |
| `scheduler-my-events`, `scheduler-my-events-gate` | [My events](my-events.md) | `verify-owner` and anonymous |
| `scheduler-edit`, `scheduler-owner-boundaries`, `scheduler-owner-remove-participant`, `scheduler-delete` | [Owner management](manage.md) | `verify-owner`, `verify-other`, and anonymous |
| `scheduler-signin-redirect`, `scheduler-signout` | [Sign-in and sign-out](shell.md) | Anonymous and `verify-owner`, with `--platform <verify-platform ready.json>` |

## Baseline preconditions

- The helper reports ready for `http://localhost:6168` with `APP_URL=http://localhost:6168`
  and `ENVIRONMENT=development`. A local `APP_URL` is required: the development
  login returns 404 and development sessions are rejected for any other host.
- Readiness probe: anonymous `GET http://localhost:6168/` returns 200 and contains
  `Schedule a meeting`. A gated probe, anonymous `GET /events` without following
  redirects, returns 302 with `Location: /signin?return_to=%2Fevents`.
- Apply [`../fixtures/seed.sql`](../fixtures/seed.sql) once after migrations, from the
  scratch `apps/scheduler` directory:
  `pnpm exec wrangler d1 execute gdgjp-scheduler-db --local --file <skill>/fixtures/seed.sql`.
  Confirm with `pnpm exec wrangler d1 execute gdgjp-scheduler-db --local --command
  "SELECT id, owner_user_id, deleted_at IS NOT NULL AS deleted FROM events WHERE id LIKE 'evt_0VERFYSCHEDX%'"`,
  which must return two rows.
- The seed creates:
  - `evt_0VERFYSCHEDXFRGN0000000001`, titled `Verify foreign event`. It is owned by
    `dev-user-verify-other`, uses 60-minute slots, and has slots `9101` (Mon 19:00),
    `9102` (Mon 20:00), and `9103` (Tue 19:00). Participant `9201` is the
    anonymous `Seed Guest` and has availability for `9101`. Participant `9202` is
    `verify-other (dev)` and has availability for `9101` and `9102`.
  - `evt_0VERFYSCHEDXGNE00000000002`, titled `Verify deleted event`, owned by
    `dev-user-verify-owner`. It is soft-deleted.
  - The anonymous token `VERFYSEEDGVESTT0KEN0000001`, whose SHA-256 hash is stored
    for `Seed Guest`. The guest cookie is
    `scheduler_p_evt_0VERFYSCHEDXFRGN0000000001=9201.VERFYSEEDGVESTT0KEN0000001`
    with domain `localhost`, path `/e/evt_0VERFYSCHEDXFRGN0000000001`, HttpOnly,
    and SameSite Lax.

## Identities

Sign in by navigating the Orca tab to the RP's development login. Each login sets
the `gdgjp-scheduler-session` cookie on `/` and upserts a local `user` row.
Scheduler ignores chapters and `admin`; they are present only to match the
shared helper's login shape.

| Label | Login URL | User ID | Display name and email |
| --- | --- | --- | --- |
| `verify-owner` | `http://localhost:6168/dev/login?as=verify-owner&chapter=1:dev-chapter:organizer&return_to=%2Fevents` | `dev-user-verify-owner` | `verify-owner (dev)`, `verify-owner@dev.local` |
| `verify-other` | `http://localhost:6168/dev/login?as=verify-other&chapter=1:dev-chapter:member&return_to=%2Fevents` | `dev-user-verify-other` | `verify-other (dev)`, `verify-other@dev.local` |

Anonymous journeys use a new isolated Orca profile with no cookies. Use a second
isolated anonymous profile when a journey needs a second guest. For HTTP
read-backs, obtain a cookie jar with
`curl -s -c <scratch>/owner.jar -o /dev/null '<login URL>'` and reuse it with
`-b <scratch>/owner.jar`. Keep jars outside the evidence directory.

## Ordering

1. `scheduler-shell-theme`, `scheduler-shell-viewport`, and `scheduler-event-missing` are read-only.
2. `scheduler-my-events` must start before `verify-owner` creates any event, because it
   proves the empty state first.
3. `scheduler-create-anon` and `scheduler-create-owner` create the events that the
   response and management journeys use. Run `scheduler-create-validation` at any time;
   it must not create rows.
4. `scheduler-anon-identity` uses the seeded `Seed Guest`. Run it before
   `scheduler-owner-remove-participant`, which deletes and recreates that participant
   with a new token that invalidates the seeded cookie.
5. `scheduler-respond-anon` and `scheduler-respond-signed-in`, then `scheduler-edit`.
6. `scheduler-owner-boundaries` before `scheduler-delete`. Delete only the event that
   `scheduler-create-owner` created.
7. `scheduler-signin-redirect` and `scheduler-signout` last, only when the helper ran
   with `--platform <verify-platform ready.json>`. Sign-out ends the profile's session.

## Driving conventions

- Use accessible names quoted in each feature file. Take a fresh `orca snapshot`
  after every navigation or fetcher action. Use `wait --text` for toasts and
  revalidated text; toasts render at the bottom right and disappear on their own.
- Perform each mapped action in Orca. Use HTTP and D1 only for preconditions and
  independent read-backs. Never manufacture a result with `eval`, a cookie edit, or
  a direct D1 write; the seeded guest cookie is the only cookie set by hand.
- Server-rendered HTML escapes apostrophes. Search HTTP bodies for
  `Who&#x27;s available`, not `Who's available`.
- Evidence per journey: action receipts, a snapshot after the result, a screenshot
  with the `Scheduler` header visible, the HTTP or D1 read-back output, and the
  identity label with its expected user ID. Do not retain session cookie values or
  anonymous tokens other than the published seed token.

## What this map does not cover

- External sends: Scheduler sends no email, calendar invitations, or
  notifications. There is nothing to fake, and no journey depends on one.
- Real Google or production Accounts sign-in. `scheduler-signin-redirect` stops at the
  local Accounts authorization request. Completing OIDC through Accounts requires
  the Accounts OAuth client `scheduler` and its secret to be registered in the local
  Accounts stack; record that journey as unreachable when they are absent.
- App launcher destinations and their icons. They point at production
  `https://*.gdgs.jp` hosts even locally. Following them leaves the isolated stack.
- `Manage your account`, which links to Accounts `/dashboard`, beyond checking its href.
- Clipboard contents after `Copy` when the Orca profile has no clipboard permission.
- Locales other than the default, browsers other than the Orca tab, deployed
  Cloudflare behavior, and concurrency between simultaneous participants.
- Seeded Playwright specs (`apps/scheduler/e2e/home.spec.ts`) are separate regression
  evidence and do not replace these Orca journeys.
