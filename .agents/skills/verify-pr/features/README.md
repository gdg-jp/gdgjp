# PR feature map

Drive these journeys in the isolated stack from [verify-pr](../SKILL.md), started with
`node scripts/verification/app-stack.mjs --app pr --serve`. It serves the current source at
`http://localhost:6161` in dev Vite mode with the app's own local fakes bound in place of
`SNS`, `TINYURL`, `CONNPASS`, and `IMG_UPLOAD` (`apps/pr/e2e/mock-services`), a Discord
webhook capture server at `http://127.0.0.1:6162`, and a Playwright render server at
`http://127.0.0.1:6163` standing in for Browser Rendering. Current-run status and evidence
belong in [coverage.json](../coverage.json). Every journey starts as `NOT VERIFIED`.

The stakes: nothing may be posted, mailed, or sent to connpass without a person's approval
of the exact version that goes out, given by a member of the chapter that owns the account.
The approval journeys come first and every one of them reads the fakes' call counts.

| Journey IDs | Feature | Identity |
| --- | --- | --- |
| `pr-signin-gate`, `pr-runner-token` | [Sign-in gate and runner API](access.md) | Anonymous, runner |
| `pr-accounts-signin` | [Real local Accounts sign-in](access.md) | verify-platform Accounts fixture |
| `pr-events-empty`, `pr-campaign-brief` | [Events and the brief](campaigns.md) | `lead` |
| `pr-cohost-access` | [Co-hosts and outsiders](campaigns.md) | `lead`, `cohost`, `outsider` |
| `pr-schedule-derived` | [Schedule and derived reminders](schedule.md) | `lead` |
| `pr-delivery-setup` | [Delivery accounts, tinyurl, webhook](delivery.md) | `lead`, `osaka` |
| `pr-no-send-before-approval` | [Draft review and approval](delivery.md) | `lead` |
| `pr-stale-version-refused` | [Draft review and approval](delivery.md) | `lead` (two tabs) |
| `pr-target-own-chapter`, `pr-target-double-press` | [Dispatch targets](delivery.md) | `lead`, `osaka` |
| `pr-status-and-alerts` | [Status follow-up and Discord](delivery.md) | `lead` |
| `pr-mail-waits-for-time` | [connpass pages and mail](connpass.md) | `lead` |
| `pr-connpass-page` | [connpass pages and mail](connpass.md) | `lead` |
| `pr-assistant-source` | [Assistant thread](assistant.md) | `lead` |
| `pr-assets-kit`, `pr-live-posts` | [Images and live posts](assets.md) | `lead` |
| `pr-listings` | [Listings](operations.md) | `lead` |
| `pr-metrics-budget`, `pr-learning-export` | [Metrics, budget, analysis, learning](operations.md) | `lead` |
| `pr-chapter-switch`, `pr-admin-runner` | [Shell, chapter switcher, administration](operations.md) | `lead`, `admin`, `member` |

## Identities

Sign in by navigating an isolated Orca profile to the RP's local dev login. The user id is
`dev-user-<as>`; the display name is `<as> (dev)`. `ready.json.applications.pr.identities`
lists the exact URLs.

| Label | Dev login |
| --- | --- |
| `lead` | `/dev/login?as=lead&chapter=1:gdg-kwansai:organizer&return_to=/` |
| `osaka` | `/dev/login?as=osaka&chapter=2:gdgoc-osaka:organizer&return_to=/` |
| `cohost` | `/dev/login?as=cohost&chapter=2:gdgoc-osaka:organizer&return_to=/` |
| `member` | `/dev/login?as=kwansai-member&chapter=1:gdg-kwansai:member&return_to=/` |
| `outsider` | `/dev/login?as=outsider&chapter=3:other:organizer&return_to=/` |
| `admin` | `/dev/login?as=pr-admin&chapter=3:other:member&admin=1&return_to=/` |

Navigating to another dev login in the same profile replaces the session. Use one profile
per identity when two identities must stay signed in.

## Observing sends

- `GET http://localhost:6161/dev/mock-services` returns the fakes' state: `sns.calls`,
  `sns.posts[]` (`chapterId`, `text`, `actor`, `status`), `tinyurl.campaigns`,
  `tinyurl.links`, and `connpass` jobs. Read it before and after every approval.
- `GET http://127.0.0.1:6162/messages` returns every Discord webhook body the app sent.
- Runner jobs are leased through the runner API with the scratch `RUNNER_TOKEN` (in
  `apps/pr/.dev.vars` of `ready.json.scratch`). Acting as the runner is a fixture
  precondition: it produces a draft version the way the OCI runner would. Never approve,
  dispatch, or change a target through HTTP; those are the user actions under test.
- D1 reads run from `ready.json.applications.pr.directory` with
  `pnpm exec wrangler d1 execute gdgjp-pr-db --local --persist-to <persistence> --json --command "<SQL>"`,
  where `<persistence>` is `ready.json.applications.pr.persistence`.

## Baseline

`ready.json.checks.pr.sendBaseline` must show `snsCalls: 0`, `snsPosts: 0`, and
`discordMessages: 0`. Any other value means something was sent before a journey ran.
The helper refuses to start with `PR_REAL_SERVICES` set.

## What the map does not cover

- Real sns, tinyurl, connpass, img, X, Discord, and connpass.com. Only the fakes above.
- Contacts import from the Wiki: dev-login sessions have no access token and no Wiki fake is
  bound, so `/contacts` import is outside the map (the page itself renders).
- The OCI runner and Codex. The journeys post runner results over HTTP.
- Real Accounts sign-in and Google file sources.
- Fonts: `RENDER-FONTS-LOADED` is evaluated only when the helper seeded fonts from a local
  cache (`ready.json.applications.pr.fixtures.fonts`).
