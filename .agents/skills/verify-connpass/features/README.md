# Connpass feature map

Drive these journeys in the isolated stack started by
`node scripts/verification/app-stack.mjs --app connpass --serve`.
Current-run status and evidence belong in `../coverage.json`.
Every journey starts as `NOT VERIFIED`; a source recipe is not execution evidence.

connpass.gdgs.jp is a machine API. The only browser page is the static home page,
which has no sign-in, no session cookie, and no signed-in view. Every other journey is
HTTP with a Bearer token. The token is the name of a mock IdP identity.

| Journey IDs | Feature | Identity |
| --- | --- | --- |
| `connpass-home` | [Home page](home.md) | Anonymous browser |
| `connpass-accounts-bearer` | [Bearer authentication through real local Accounts](authentication.md) | verify-platform Accounts token from `verify-sns/fixtures/accounts-seed.sql` |
| `connpass-auth-required`, `connpass-auth-invalid`, `connpass-method-guard` | [Bearer authentication and method guard](authentication.md) | Anonymous, invalid token |
| `connpass-admin-groups`, `connpass-admin-luma`, `connpass-admin-forbidden` | [Admin allowlists](admin-allowlist.md) | `e2e-admin`; `e2e-organizer`, `e2e-member`, `e2e-developer-app-organizer` for denial |
| `connpass-job-read`, `connpass-job-missing` | [Job status](jobs.md) | All five identities |
| `connpass-relogin-job` | [Bot relogin job](jobs.md) | `e2e-admin`; `e2e-organizer`, `e2e-member`, `e2e-developer-app-organizer` for denial |
| `connpass-read-deny` | [Group access boundaries](group-access.md) | `e2e-admin`, `e2e-organizer`, `e2e-outsider` |
| `connpass-write-deny` | [Group access boundaries](group-access.md) | `e2e-member`, `e2e-outsider`, `e2e-developer-app-organizer`, `e2e-organizer` |
| `connpass-write-validation` | [Write request validation](write-validation.md) | `e2e-organizer` |
| `connpass-checkin-validation`, `connpass-checkin-deny`, `connpass-checkin-luma-unconfigured` | [QR check-in](checkin.md) | `e2e-organizer`, `e2e-member`, `e2e-outsider`, `e2e-developer-app-organizer` |
| Outside the map | [connpass.com operations](connpass-operations.md) | None. These paths must not be driven |

## Baseline preconditions

- The helper started `apps/connpass/e2e/mock-idp.mjs` on `http://127.0.0.1:6167`
  (`CONNPASS_E2E_IDP_PORT=6167`) and served the app at `http://localhost:6166` in dev
  Vite mode through `scripts/run-e2e-dev.mjs`, with `CONNPASS_E2E_ACCOUNTS_URL=http://127.0.0.1:6167`.
- The app runs from the snapshot named by `ready.json.scratch`, not from the source
  checkout. The source checkout's `apps/connpass/.dev.vars` holds real connpass and
  Luma bot credentials. Never serve the app from the source checkout for this map.
- Credential gate. Before any journey, inspect key names only (never print values) in
  `apps/connpass/.dev.vars` and `apps/connpass/.dev.vars.e2e` inside `ready.json.scratch`.
  Require that neither file defines a non-empty `CONNPASS_BOT_EMAIL`,
  `CONNPASS_BOT_PASSWORD`, or `LUMA_BOT_PASSWORD`. If any is present, stop the run and
  report every journey as not run. With those keys present, the relogin and Luma journeys
  would log in to connpass.com and api.luma.com as the shared bot.
- Persistence is fresh: local D1 has only the migrations plus
  [`../fixtures/seed.sql`](../fixtures/seed.sql), and local KV and R2 are empty.
  The helper applies the seed after migrations and before serving, from
  `apps/connpass` inside `ready.json.scratch`:
  `pnpm exec wrangler d1 execute gdgjp-connpass-db --local --file "<ready.json.source>/.agents/skills/verify-connpass/fixtures/seed.sql"`.
  The snapshot excludes `.agents`, so the file path must point at the source checkout.
- Identity gate. For each of `e2e-admin`, `e2e-organizer`, `e2e-member`, `e2e-outsider`,
  and `e2e-developer-app-organizer`, run
  `curl -sS http://127.0.0.1:6167/api/auth/oauth2/userinfo -H "Authorization: Bearer <name>"`.
  Require: admin has `https://gdgs.jp/claims/is_admin: true` and no chapters; organizer
  has chapter `10` role `organizer`; member has chapter `10` role `member`; outsider has
  chapter `99` role `organizer`; the developer-app identity has chapter `10` role
  `organizer` and client `{"id":"dev-app","first_party":false}`. Every other identity has
  client `{"id":"gdg-cli","first_party":true}`. A different claim set makes the denial
  journeys unsafe, because a request that is unexpectedly authorized enqueues a job that
  runs at once. Stop the run if any identity differs.
- Readiness: `GET http://localhost:6166/` returns 200 and contains `connpass.gdgs.jp`;
  `GET http://localhost:6166/api/admin/groups` with `Authorization: Bearer e2e-admin`
  returns 200 with a `groups` array.

## Driving conventions

- Use the base URL `http://localhost:6166` and send `accept: application/json`.
- Send one identity per request as `Authorization: Bearer <identity name>`.
- Record each request as method, path, identity name, request body, status, and response
  body. The identity names are test-only labels and may be recorded verbatim.
- Read-back for stored state uses a second, independent view: the admin list APIs, the
  job status API, or a read-only SQL query run from `apps/connpass` inside
  `ready.json.scratch`:
  `pnpm exec wrangler d1 execute gdgjp-connpass-db --local --json --command "<SELECT ...>"`.
  Only `SELECT` statements are allowed after the seed is applied.
- Job-count guard. Journeys that must not enqueue anything record
  `SELECT COUNT(*) AS n FROM jobs` before and after. The count must not change.
  A changed count means a job ran against connpass.com; stop and report it.
- Store all evidence under `ready.json.evidence`, in a subdirectory named after the
  journey ID.

## Ordering

1. `connpass-home`, `connpass-auth-required`, `connpass-auth-invalid`, `connpass-method-guard`.
2. `connpass-admin-luma` while the Luma allowlist is still empty, then `connpass-admin-groups`,
   then `connpass-admin-forbidden`.
3. `connpass-job-read`, `connpass-job-missing`.
4. `connpass-read-deny`, `connpass-write-deny`, `connpass-write-validation`.
5. `connpass-checkin-validation`, `connpass-checkin-deny`, `connpass-checkin-luma-unconfigured`.
6. `connpass-relogin-job` last. It is the only journey that intentionally creates and
   executes a job.

Never create an enabled group for chapter `99`, and never disable or delete
`verify-chapter10`, `verify-disabled`, or `verify-adminonly`. Later journeys depend on them.

## What the map does not cover

- Every route that drives connpass.com through Browser Rendering: event, sub-event, survey,
  conference, participant, statistics, and voucher reads, and every write job (create,
  update, delete draft, publish, image upload, copy, cancel, participant update, event mail,
  voucher changes, sub-event create and cancel, survey and conference upsert). See
  [connpass.com operations](connpass-operations.md) for the reasons and the exact rule.
- A successful connpass QR check-in and a successful Luma check-in.
- The `PrService` service-binding entrypoint used by apps/pr. It has no HTTP route.
- The queue consumer's retry behaviour, failure screenshots in R2, and the Browser
  Rendering live-view URL.
- Real GDG Accounts tokens, token expiry, and production role assignments. The mock IdP
  answers fixed claims for five fixed token names.
- `pnpm test:e2e:live` and `e2e/live.spec.ts`.
