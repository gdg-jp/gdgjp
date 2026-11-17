# CLI parity for tinyurl / img / sns — overview

Not delegated to Cursor; a map for humans (and for the author of each staged plan file below).
No heading-contract requirements apply to this file.

## Why

The Go CLI (`cli/`) has real feature depth only for `connpass/` — explicitly "Bearer-API oriented
for CLI/agents" per root `CLAUDE.md` — plus narrower `accounts`/`wiki` support. This plan set
adds complete operator workflows for `tinyurl/`, `img/`, and `sns`, rather than sampling CRUD
endpoints. A workflow is complete only when every opaque id it consumes can first be discovered
from the CLI and every async failure can be inspected and retried. None of those
three apps has any bearer-token auth today; all three exclusively use cookie-session RP auth
(`initializeRpAuth` from `gdg-lib`). Getting them CLI-reachable requires, per app: Worker-side
refactoring to extract reusable service functions where logic is currently inline in route
handlers, new Bearer-authenticated JSON routes plus an OpenAPI contract, and a new Go CLI client
package.

## Resolved decisions (settled by the user via `AskUserQuestion` before this plan set was written)

| Decision | Resolution |
|---|---|
| Feature scope | tinyurl **campaigns** in scope. sns **Google Photos importer** deferred (it already has a working async pipeline via GitHub Actions). |
| `gdg-lib` bearer identity extraction | Extract both behaviors explicitly: a compatibility-preserving `/userinfo` consumer for existing connpass/wiki routes, and a strict Accounts CLI-identity endpoint/consumer for the new mutation APIs. Migrate connpass/wiki off their local copies now without changing which OAuth clients their existing routes accept. `/userinfo` alone is not sufficient authorization for new mutation APIs. |
| API response model | Synchronous JSON everywhere. tinyurl's Vercel domain provisioning and sns's "publish now to X" are ordinary bounded external HTTP calls and respond synchronously, matching their dashboards. The async Job+Queue pattern stays connpass-only — it exists there because connpass drives connpass.com through Playwright. |
| Lenient/strict identity split (confirmed 2026-08-26) | connpass/wiki are deduplicated onto a shared `getBearerIdentity` (today's `/userinfo` behavior, unchanged) but are **not** migrated onto the strict `getCliIdentity` check — wiki's `agents` OAuth client legitimately calls without the CLI scope, and reissuing it is out of scope for this plan. Only the new tinyurl/img/sns mutation APIs require `getCliIdentity`. This is final, not a placeholder pending further review. |

## Review findings incorporated

| # | Finding | Plan resolution |
|---|---|---|
| 1 | `/userinfo` authenticated tokens but did not authorize CLI scope | Stage 01 adds an Accounts CLI-identity endpoint backed by `requireCliTokenUser`; new mutation APIs reject non-`gdg-cli`, non-CLI-scoped tokens. Existing connpass/wiki routes move to a separate shared `/userinfo` consumer because wiki's `agents` client is a legitimate current caller. |
| 2 | CRUD-only commands left required ids undiscoverable | img list/get, tinyurl domain list/get and campaign-source list, and sns X-account list are required workflow steps. |
| 3 | sns contributors could accidentally administer contributors | Contributor administration is organizer/super-admin only; contributor status grants post access only. |
| 4 | Scheduled publish logic could no-op, swallow failure, or race cron | Stage 13 adds an atomic synchronous `publishNow` transition with explicit typed outcomes and a shared X-posting step, so cron and CLI cannot both post the same post. |
| 5 | TinyURL domain input trusted client-selected provider details | Clients submit only hostname/chapter; the domain service detects mode/upstream and enforces safety and capacity. |
| 6 | sns post/media mutations were not one aggregate | Stage 10 centralizes draft/media transitions and defines R2/D1 compensation and ordering semantics. |
| 7 | Campaign analytics could leak participant data and had no bounds | Only bounded aggregate analytics are exposed; participant ids, snapshots, and raw events are excluded. |
| 8 | img chapter selection and `updatedAt` were ambiguous | Multi-chapter callers must select a chapter; update responses use the persisted row returned by D1. |
| 9 | CLI helper cleanup risked changing existing behavior | Existing Accounts/agent compact output and error behavior are frozen byte-for-byte; only new commands and already-indented connpass output use `PrintJSON`. |
| 10 | Campaign channel/source management was incomplete | Channel and source update/archive/restore routes and CLI commands are part of Stage 08/09. |
| 11 | SNS CLI-created posts could lose dashboard link previews | Stage 10 keeps preview derivation from final post text inside the aggregate service; Stage 12 does not accept client-authored preview metadata. |

## Three-layer architecture

1. **Shared groundwork** (Stages 01–02) — shared bearer identity plus a
   CLI-scope-validating Accounts identity endpoint/consumer, and a Go `cliutil`
   package consolidating logic duplicated across the CLI's existing per-app command packages.
2. **Per-app Worker work** (Stages 03, 05–08, 10–13) — organize domain logic under
   `app/features/<domain>/`, add CLI-scoped JSON routes, extend or
   bootstrap each app's OpenAPI contract.
3. **Go CLI client packages** (Stages 04, 09, 14) — one `cli/internal/<app>/` + `cli/internal/command/<app>.go`
   pair per app, generated against that app's OpenAPI contract, following `cli/internal/connpass/`'s
   existing shape.

## Stage index and dependency graph

| Stage | File | Depends on | Can start immediately? |
|---|---|---|---|
| 01 | `01-shared-bearer-identity.md` | — | ✅ |
| 02 | `02-cli-shared-client-helpers.md` | — | ✅ |
| 03 | `03-img-bearer-api.md` | 01 | |
| 04 | `04-img-cli-client.md` | 03, 02 | |
| 05 | `05-tinyurl-core-refactor.md` | — | ✅ |
| 06 | `06-tinyurl-links-bearer-api.md` | 01, 05 | |
| 07 | `07-tinyurl-domains-bearer-api.md` | 01, 05 | |
| 08 | `08-tinyurl-campaigns-bearer-api.md` | 01, 05, 06 (soft) | |
| 09 | `09-tinyurl-cli-client.md` | 06, 07, 08, 02 | |
| 10 | `10-sns-posts-media-service.md` | — | ✅ |
| 11 | `11-sns-contributors-x-service.md` | — | ✅ |
| 12 | `12-sns-bearer-api.md` | 01, 10, 11 | |
| 13 | `13-sns-x-publish.md` | 12, 11 | |
| 14 | `14-sns-cli-client.md` | 12, 13, 02 | |

**Stages 01, 02, 05, 10, 11 have no dependencies on each other or on anything else** and can all
begin immediately, in parallel, across separate sessions if wall-clock time
matters. Everything else branches off those five.

Recommended sequencing if running mostly serially: 01 → 02 → (img: 03 → 04) → (tinyurl: 05 → 06 →
07 → 08 → 09) → (sns: 10 & 11 → 12 → 13 → 14). img goes first because it's the cleanest of the
three apps (routes are already thin, `app/lib/{upload.ts,images.ts,permissions.ts}` already hold
the logic) — it validates the bearer-route + CLI-client pattern at the lowest risk before tinyurl's
medium refactor and sns's substantial one. sns is last because `app/lib/db.server.ts` today has
only *read* helpers — every mutation is raw SQL inline in route actions, and sns has no `openapi/`
directory at all yet.

## Cross-cutting conventions established across all stages

- **CLI API routes live under versioned `/api/cli/v1/*` paths** with `api.cli.v1.*` route files,
  distinct from dashboard cookie-session routes. `bearer` is an authentication mechanism, not a
  product namespace; every route additionally requires the GDG CLI OAuth scope from Stage 01.
- **Feature ownership**: new domain code lives under `app/features/<domain>/`. Repository modules
  own D1 access, services own business invariants/state transitions, policy modules own resource
  authorization, providers own external APIs, and route files only parse/format HTTP.
- **Dependency direction**: routes/OpenAPI adapters → feature services → repositories/providers.
  Feature services never import generated OpenAPI types.
- **Error envelope**: `{ error: string }` for all 4xx responses, matching connpass's convention.
- **No async jobs**: every CLI endpoint responds synchronously. tinyurl domain provisioning
  (Stage 07) and sns publish-now (Stage 13) call their external APIs inline and return the
  persisted resource. There is no `jobs` table, `JOB_QUEUE` binding, `202`/poll flow, or
  `/api/cli/v1/jobs/:jobId` route in tinyurl or sns; connpass keeps its own queue unchanged.
- **List contract**: every potentially growing list has `limit` (bounded, default 50, max 100) and
  opaque `cursor`; responses use `{ items..., nextCursor }`. Analytics endpoints have explicit
  time/filter contracts and bounded result sizes.
- **HTTP boundary**: JSON endpoints require `application/json`, reject malformed/oversized bodies
  with the shared `{ error }` envelope, return `405` for unsupported methods, and use
  `Cache-Control: no-store` for authenticated responses.
- **Every stage file has a `### API Contract` subsection** inside `## Design` with concrete
  shapes — HTTP method/path/req/res for bearer-API stages, CLI command/flags/stdout JSON for
  CLI-client stages, exact function signatures for the three pure-refactor stages (05, 10, 11 —
  note 11 is refactor-only despite feeding stage 12) and the two shared-groundwork stages (01, 02).

## Risks worth tracking across the whole plan

- **08 (tinyurl campaigns)** is the single largest feature surface (10+ D1 tables touched across
  `campaigns`/`campaign_chapters`/`campaign_channels`/`campaign_channel_sources`). If a Cursor
  session struggles, it splits along campaign CRUD vs. bounded aggregate analytics.
- **10 (sns posts/media service)** has the highest density of pre-existing inline logic to
  untangle (`schedule.tsx`'s action does INSERT/UPDATE/R2/tag-resolution together) with no
  existing service layer to lean on, unlike img/tinyurl.
- **12 (sns CLI API)** bootstraps `sns/openapi/` from scratch — there is no existing contract
  to extend, unlike img/tinyurl.

## End-to-end workflow acceptance

- **img**: list/get an existing image → upload or replace/mobile → delete, including explicit
  chapter selection for multi-chapter callers. The management API defaults to 50 rows (max 100),
  intentionally independent from the current gallery helper's presentation-oriented default of 60.
- **tinyurl**: list active domains → create/list/get/update/delete a link; register a domain →
  inspect the returned provisioning state → list/get/sync/delete it; create/list a campaign → discover channels and sources →
  rename/archive/restore them → attach a link → read bounded aggregate analytics. The CLI evaluates
  link access across all bearer-token memberships; this is intentionally broader than the dashboard's
  currently selected single chapter while using the same per-membership policy.
- **sns**: list usable X accounts → create/list/get/update a draft → add/remove media → publish now
  → inspect the returned terminal post state; organizers can list/add/remove contributors.

An automated cross-app img URL → tinyurl `ogImageUrl` → sns text/preview E2E is explicitly deferred
from v1 because it requires coordinating three dev servers and auth fixtures. Each returned/accepted
URL contract is tested in its owning stage; record the three-app handoff as a manual release smoke
test and add the automated scenario when a shared multi-app harness exists.

## Delivery sizing

Each numbered stage is a product milestone, not necessarily one pull request. Land it as a small
stack while keeping the repository green after every change: (1) move existing code into the
feature boundary with behavior-preserving tests, (2) introduce/verify service and policy APIs,
(3) add HTTP/OpenAPI adapters, then (4) add CLI commands. Do not combine a large file move with
new behavior in one review diff merely because both belong to the same stage.
