---
name: verify-connpass
description: Exercise connpass.gdgs.jp's machine API over HTTP and its home page through Orca Browser in an isolated local stack with the repository's mock IdP and no bot credentials. Use after changes to apps/connpass authorization, validation, admin allowlists, or job status.
---

# Verify Connpass

Drive the real local app through Orca Browser. Read the `orca-cli` skill and its
version-matched browser reference before driving a tab, then
[the shared Orca procedure](../verify-platform/references/orca.md). Use the
[feature map](features/README.md) to choose journeys and [coverage.json](coverage.json)
for their recorded results. Existing Playwright specs in `apps/connpass/e2e/` supply recipes only.

## Launch

From the repository root:

```sh
node scripts/verification/app-stack.mjs --app connpass --doctor
node scripts/verification/app-stack.mjs --app connpass --serve
```

Keep the serving session running. The helper snapshots the current source (including
uncommitted changes) into a scratch checkout, writes test-only variables, applies fresh
local D1 migrations and the skill's fixtures, and serves the app at `http://localhost:6166`.
Its ports sit in the 6161-6169 verification block, apart from `pnpm test:e2e`, so a
concurrent E2E run does not collide. It refuses an occupied port and never stops its owner.
The helper starts `apps/connpass/e2e/mock-idp.mjs` on `127.0.0.1:6167`, applies `fixtures/seed.sql`, and refuses to start when `CONNPASS_BOT_EMAIL`, `CONNPASS_BOT_PASSWORD`, or `LUMA_BOT_PASSWORD` appears in the scratch variables (the source checkout's `.dev.vars` holds real ones). Bearer tokens are the mock IdP identity names. Jobs run immediately in dev, so only send requests the map says are denied or invalid.

`READY` prints the evidence directory and `ready.json`: scratch path, D1 name and
persistence, dev-login URLs per identity, source hashes, and readiness checks. Readiness
means an anonymous probe and a signed-in probe returned the expected page; it does not
verify any journey.

`--platform <verify-platform ready.json>` attaches to a running
[verify-platform](../verify-platform/SKILL.md) stack (its Accounts and service registry)
for journeys that need Accounts. Start it first with
`node scripts/verification/verify-platform.mjs --serve`. The driver registers this stack's
callback and post-logout URLs on the Accounts OAuth client before the app starts; Accounts
caches trusted clients after first use, so attach a fresh verify-platform stack rather than
one an earlier app already used. Accounts' dev registry can lose its entry when other stacks
stop; if `/api/auth/signin` answers 503 (**サインインサービスに接続できませんでした**), restart
verify-platform and the app.

## Doctor

`--doctor` checks installed dependencies, the skill's seed files, the Node runtime, pnpm,
and every port. After launch, read `ready.json.checks` and `ready.json.credentials`, and
repeat the relevant HTTP probe when a journey looks wrong. A listening port alone does
not identify this stack.

## Drive

Sign in by navigating an isolated Orca profile to the identity's dev-login URL from
`ready.json.applications.connpass.identities` (the RP's local-only `/dev/login`; user id
`dev-user-<as>`). Use one profile per identity that must stay signed in. Use actual
snapshot refs. Native `datetime-local` inputs appear as five spinbuttons; focus each and
`type` its digits. Use HTTP and read-only D1 queries for preconditions and independent
checks; perform each mapped user action in Orca. Never change the DOM or application state
with `eval` to manufacture a result.

## Evidence

Keep action receipts, snapshots, screenshots, sanitized HTTP outcomes, and D1 reads under
the run's `local_data/pstack/connpass/<run-id>/` directory, following
[the evidence contract](../verify-platform/references/evidence.md). Record each executed
journey in that run's `journeys.json` and update only executed rows in `coverage.json`.
Never retain cookie values or tokens.

## Cleanup

Close the tabs you created, then delete their profiles. Stop the helper with Ctrl-C or
SIGTERM to its own PID. It stops its process groups, removes the scratch checkout, and
keeps the evidence. Check `result.json` for `scratchRemoved: true` and `portsFree: true`.
Do not kill by process name or delete another run's scratch directory.

## Helpers and limits

`scripts/verification/app-stack.mjs` serves `pr`, `pay`, `sns`, `connpass`, `scheduler`,
and `tinyurl`; its tests are `node --test scripts/verification/app-stack.test.mjs`.
Outside this map: Every authorized request that reaches connpass.com or Luma (see `features/connpass-operations.md`), `live.spec.ts`, and the `PrService` entrypoint (verify it from verify-pr). Use `/maintain-verification-skill` when routes or
controls change.
