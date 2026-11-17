---
name: verify-platform
description: Verify Accounts sign-in, local OIDC, and Wiki authoring, search, and authorization through Orca Browser in a disposable local stack. Use after changes to these cross-app journeys.
---

# Verify Accounts and Wiki

Drive the real local Accounts and Wiki through Orca Browser. Read the `orca-cli`
skill and its version-matched browser reference before driving a tab. Playwright
specs supply recipes only. Use the [feature map](features/README.md) to choose
journeys and [coverage.json](coverage.json) to record their actual results.

## Launch

From the repository root, run:

```sh
node scripts/verification/verify-platform.mjs --doctor
node scripts/verification/verify-platform.mjs --serve
```

Keep the serving session running. The helper snapshots current source, links
installed dependencies, creates test-only variables, migrates fresh Accounts and
Wiki databases, seeds identities, and builds both applications. It starts built
Workers on `http://localhost:6173` and `http://localhost:6177`. Both ports must be
free. It refuses an occupied port and never reuses its owner.

`READY` reports the evidence directory and `ready.json`. That file identifies the
scratch checkout, fixture paths, source hashes, URLs, and identities. Readiness
requires a real Accounts session response with `platform-oidc-user` and a Wiki
author page response with the seeded title. Readiness does not verify a journey.
The helper starts no browser. Source credentials and persistence remain untouched.

## Doctor

The prelaunch doctor checks installed dependencies, workspace packages, the selected
Node runtime, pnpm, and both ports. After launch, inspect `ready.json.checks` and
repeat the relevant authenticated HTTP request when a journey looks wrong. A
listening port alone does not identify the correct application or identity.

## Drive

Read [the browser procedure](references/orca.md) once per run. Create an isolated
Orca profile, then a new tab in that profile. Pin its page ID on every action.
Use actual snapshot refs for controls. Keep profile and tab creation receipts.

`ready.json.authFixtures` lists `accounts`, `author`, `member`, and `admin` storage
states. The helper also registers the configured first-party OAuth clients through
Accounts' authenticated seed action before readiness. The Accounts fixture is a real database session. Wiki fixtures are signed
local RP sessions and bypass OIDC. For the OIDC journey, start a fresh profile and
set only the Accounts fixture. Never preload a Wiki fixture in that profile.

The map gives routes, identities, visible controls, and independent observations.
Use HTTP to establish isolated fixture preconditions and check authorization or
persistence. Perform each mapped user action in Orca. Do not change the DOM,
localStorage, or application state through JavaScript to manufacture its result.

## Evidence

Save action receipts, snapshots, screenshots, network observations, and sanitized
HTTP results under the helper's `local_data/pstack/platform/<run-id>/` directory.
Record fixture labels and expected user IDs. Keep cookie values, OAuth codes,
PKCE verifiers, tokens, and signed continuation values out of retained artifacts.

Record each journey in `journeys.json` using [the evidence contract](references/evidence.md).
A successful mutation needs the action, its HTTP outcome, and a later independent
read. Record the failure and last observation when a precondition or control fails.
The initial coverage file marks every current-run journey `NOT VERIFIED`.
Update only journeys actually executed against the recorded source snapshot.

## Cleanup

Close only the created Orca tabs, then delete only their isolated profiles. Stop
the helper session with Ctrl-C or SIGTERM. It stops its own process groups, removes
its scratch checkout, and preserves the evidence directory. Inspect `result.json`
for `scratchRemoved: true`. Check both ports and the tab/profile inventory after
cleanup. Do not kill by process name or remove an existing `.wrangler` directory.

## Helpers and limits

`node scripts/verification/verify-platform.mjs --source /Users/hari/proj/gdgjp --serve`
selects an installed checkout explicitly. The helper supplies isolated local
services and disables external AI bindings. It does not drive a browser.

This map covers local Accounts OIDC and selected Wiki journeys. It excludes actual
Google authentication, deployed Cloudflare behavior, external notifications,
knowledge ingestion, AI search, and production browser timings. Keyword search
uses local D1 `LIKE`. Use `/maintain-verification-skill` when routes or controls change.
