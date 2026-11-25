---
name: verify-apps
description: Drive screen, OST, MC, Deck, Roulette, Img, Live Check-in, Meet, the website, and Roster through Orca Browser in a disposable local stack with deterministic fixtures. Each app has a feature map of every user-facing feature. Use after changes to any of these apps' routes, controls, permissions, or live room behavior.
---

# Verify the event and community apps

Drive the real local apps through Orca Browser. Read the `orca-cli` skill and its
version-matched browser reference before driving a tab. Playwright specs under each app's
`e2e/` supply journeys and assertions only. Choose journeys from the
[feature map](features/README.md) and record results in [coverage.json](coverage.json).

## Launch

From the repository root:

```sh
node .agents/skills/verify-apps/scripts/verify-apps.mjs --app screen,ost --doctor
node .agents/skills/verify-apps/scripts/verify-apps.mjs --app screen,ost --serve
```

`--app` takes any comma-separated subset of `screen`, `ost`, `mc`, `deck`, `roulette`,
`img`, `meet`, `website`, `roster`, `live-checkin`. Keep the serving session running. The
helper snapshots current source with `scripts/verification/workspace-snapshot.mjs`, writes
test-only variables with the isolated E2E runner's fixtures, builds the design system when an
app needs it, applies D1 migrations to fresh local state, and builds the apps that run as a
built Worker preview (screen, ost, mc, deck, roulette, roster). img, meet and website run
under Vite; live-checkin runs `next dev`. Ports are the E2E ports: ost 6185, roster 6186,
mc 6187, screen 6188, deck 6189 (plus the fake obs-websocket on 4467), roulette 6190, meet
6193, img 6175, website 6180, live-checkin 6194. The helper refuses an occupied port and
never reuses its owner. Durable Object state starts empty, so OST's fixed slug cannot fail
on stale votes.

Screen is built with `react-router build` directly, skipping the DeepFilterNet download from
GitHub, so noise suppression reports 404 assets. No app gets a real external credential.

`READY` prints the evidence directory and `ready.json`. Readiness requires, per app: the
seeds (OST `verify-ost` and `verify-ost-layout`) to succeed, an anonymous probe with its
expected text, the gated admin path to 302 to `/signin`, and every fixture identity to sign
in and see its own probe page. Probe bodies are kept in `probes/`. Readiness does not
verify a journey.

## Doctor

`--doctor` checks the workspace packages and dependency installs for the selected apps, the
selected Node runtime, pnpm, and that every needed port is free. After launch, read
`ready.json.checks`, repeat the relevant HTTP request, and look at `server.log` when a
journey misbehaves. A listening port alone does not identify the right app or identity.

## Identities

`ready.json.applications.<app>.fixtureLogins` gives each identity's sign-in URL, user ID
and chapters. These use each app's local-only `/dev/login` (gdg-lib `handleDevLogin`,
404 unless `APP_URL` is loopback). Open the URL in a fresh isolated Orca profile to become
that identity; it sets the app's signed relying-party session cookie. `chapter=0:none`
gives a user without a chapter. live-checkin has no dev login: its `kwansai` and
`outsider` identities are NextAuth session cookies minted with the test `AUTH_SECRET`,
listed under `cookieFixtures`; set them with `orca cookie set` as in
[the platform procedure](../verify-platform/references/orca.md).

Real Accounts sign-in reuses the platform stack. Start
`node scripts/verification/verify-platform.mjs --serve`, wait for its `READY`, then pass
its `ready.json` with `--accounts <path>`. The apps then share its Worker registry, so their
`ACCOUNTS` service binding and `IDP_URL` reach that local Accounts, whose seeded clients
already list every app's E2E callback. Readiness adds an `oidc` check that `/signin` starts
at the local authorize endpoint, following the app's own redirects, and fails otherwise. See
[OIDC sign-in](features/oidc-signin.md). Check ports 6173 and 6177 first; if another verifier
holds them, run the other journeys and come back. Without `--accounts`, `/api/auth/signin` answers
500; prove gates with HTTP and one browser hop, because a burst of those 500s once crashed a
wrangler preview. If one server exits, the helper logs `STOPPED <app>`, keeps the others
running, and lists it in `result.json.stoppedServers`.

## Drive

Read [the browser procedure](../verify-platform/references/orca.md) once per run. Create an
isolated Orca profile per identity and pin every command with `--page`. Use snapshot refs,
re-snapshot after navigation. `orca mouse` acts on the current tab: `orca tab switch --page`
first, and never run mouse drags while another agent drives Orca. Use HTTP only for
preconditions and independent reads (loader data via `<route>.data`, CSV exports, the deck
fake OBS read in [deck](features/deck/README.md)). Never change the DOM or storage with
`eval` to produce the expected state; use it for observations.

## Evidence

Save receipts, snapshots, screenshots and sanitized HTTP results under the run's
`local_data/pstack/apps/<run-id>/`. Record each journey in `journeys.json` (or
`<app>-journeys.json`) with the fields of [the evidence contract](../verify-platform/references/evidence.md),
using this run's `run.json` hashes. Keep cookie values out of evidence. Update only executed
rows of `coverage.json`; set their `runEvidence`.

## Cleanup

Close the tabs this run created, then delete its profiles, and keep the receipts. Stop the
helper with Ctrl-C or SIGTERM: it stops its own process groups, removes the scratch
snapshot, checks the ports, and writes `result.json` with `scratchRemoved` and `portsFree`.
Evidence stays. Do not kill by process name or touch an existing `.wrangler` directory.

## Helpers and limits

`node --test .agents/skills/verify-apps/scripts/verify-apps.test.mjs` tests argument
parsing, the application table, doctor failures, platform records, and the readiness probe
against fake servers. `--source <checkout>` serves another installed checkout.

Outside these maps: real Realtime SFU media, microphones and cameras, OBS Studio, audio
output, Google APIs (Meet, Calendar, Drive, OAuth), connpass, TinyURL delegation, real
Google sign-in, Gemini transcription, and deployed Cloudflare behavior. Each app map names
its own exclusions. Use `/maintain-verification-skill` when routes or controls change.
