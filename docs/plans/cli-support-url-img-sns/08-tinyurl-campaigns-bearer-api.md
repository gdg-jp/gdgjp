# Stage 08 — tinyurl campaigns CLI API and feature boundary

## Context

tinyurl's "campaigns" feature (channels/sources/UTM-style acquisition tracking/click analytics)
is in scope per the user's resolved decision (`00-overview.md`) — it's the single largest feature
surface in the whole plan, spanning `campaigns`, `campaign_chapters`, `campaign_channels`,
`campaign_channel_sources`, and (per the repo-wide research) `campaign_participant_analytics` plus
several `campaign_participant_*` tables. This stage adds CLI-scoped routes for campaign/channel/source
CRUD and analytics reads, all synchronous (no external slow calls here, unlike Stage 07).

Depends on Stage 01 (strict `getCliIdentity`) and Stage 05's feature convention. Campaigns
logic itself is already reasonably modularized per the research that fed this plan, so this stage
should need little extraction beyond moving campaign-owned sections out of the legacy `db.ts`.
Soft-depends on Stage 06 for API-shape consistency (envelope conventions, error format) — no hard
code dependency.

Read first: the campaign tables, `app/lib/db.ts`'s existing campaign CRUD, the campaign detail
loader's Analytics Engine queries, and participant snapshot storage. Move campaign-owned types and
queries into `app/features/campaigns/` rather than creating more flat `app/lib/campaign-*.ts`
files or leaving campaign sections in the already-large `db.ts`.

## Design

### 1. Campaign feature boundary and CLI routes

Create `campaign.types.ts`, `campaign.repository.server.ts`, `campaign.service.server.ts`,
`campaign-policy.ts`, and `campaign-analytics.server.ts`. The policy matches the live dashboard:
super-admin or membership in any `campaign.chapterIds`; `ownerUserId` is metadata and not an
exclusive management rule. Creation validates every requested chapter id against the caller.
Routes live under `api.cli.v1.campaigns.*` and contain no campaign SQL or Analytics Engine logic.

- `POST|GET /api/cli/v1/campaigns` — create / bounded list the caller's campaigns.
- `GET|PATCH|DELETE /api/cli/v1/campaigns/:id` — read / update / archive (campaigns use
  `archived_at`, not hard delete, per the schema — `DELETE` sets `archived_at`, matching whatever
  the dashboard's archive action does today).
- `POST /api/cli/v1/campaigns/:id/restore` — restore an archived campaign, matching the dashboard.
- `POST|GET /api/cli/v1/campaigns/:id/channels` — create / bounded list channels.
- `PATCH|DELETE /api/cli/v1/campaigns/:id/channels/:channelId` and
  `POST .../:channelId/restore` — rename/reorder, archive, and restore a channel.
- `POST|GET /api/cli/v1/campaigns/:id/channels/:channelId/sources` — create / bounded list sources.
- `PATCH|DELETE /api/cli/v1/campaigns/:id/channels/:channelId/sources/:sourceId` and
  `POST .../:sourceId/restore` — rename, archive, and restore a source.
- `GET /api/cli/v1/campaigns/:id/analytics` — aggregate click/acquisition analytics only. It reuses
  the dashboard's Analytics Engine query helpers and never returns participant ids or the imported
  participant snapshot. Participant analytics is a separate future privacy review, not an
  unspecified field in this response.

### 2. Extend `tinyurl/openapi/`

Add `paths/cli-campaigns.yaml` (and `cli-campaign-channels.yaml`/`cli-campaign-sources.yaml`
if that keeps individual files manageably sized — this is the largest schema surface in the plan,
prefer several focused path files over one large one).

### API Contract

| Method | Path | Auth | Request body | Success | Errors |
|---|---|---|---|---|---|
| `POST` | `/api/cli/v1/campaigns` | CLI Bearer | `{ name, code, defaultDestinationUrl?, chapterIds: number[] }` | `201 { campaign }` | `400`, `401`, `403` |
| `GET` | `/api/cli/v1/campaigns` | CLI Bearer | query: `includeArchived?`, `limit?`, `cursor?` | `200 { campaigns, nextCursor }` | `400`, `401` |
| `GET` | `/api/cli/v1/campaigns/:id` | CLI Bearer | — | `200 { campaign }` | `401`, `403`, `404` |
| `PATCH` | `/api/cli/v1/campaigns/:id` | CLI Bearer | `{ name?, code?, defaultDestinationUrl?, chapterIds? }` | `200 { campaign }` | `400`, `401`, `403`, `404` |
| `DELETE` | `/api/cli/v1/campaigns/:id` | CLI Bearer | — | `200 { id, archived: true }` | `401`, `403`, `404` |
| `POST` | `/api/cli/v1/campaigns/:id/restore` | CLI Bearer | — | `200 { campaign }` | `401`, `403`, `404`, `409` |
| `POST` | `/api/cli/v1/campaigns/:id/channels` | CLI Bearer | `{ name, code, sortOrder? }` | `201 { channel }` | `400`, `401`, `403`, `404` |
| `GET` | `/api/cli/v1/campaigns/:id/channels` | CLI Bearer | query: `includeArchived?`, `limit?`, `cursor?` | `200 { channels, nextCursor }` | `400`, `401`, `403`, `404` |
| `PATCH` | `/api/cli/v1/campaigns/:id/channels/:channelId` | CLI Bearer | `{ name?, code?, sortOrder? }` | `200 { channel }` | `400`, `401`, `403`, `404`, `409` |
| `DELETE` | `/api/cli/v1/campaigns/:id/channels/:channelId` | CLI Bearer | — | `200 { id, archived: true }` | `401`, `403`, `404` |
| `POST` | `/api/cli/v1/campaigns/:id/channels/:channelId/restore` | CLI Bearer | — | `200 { channel }` | `401`, `403`, `404`, `409` |
| `POST` | `/api/cli/v1/campaigns/:id/channels/:channelId/sources` | CLI Bearer | `{ name, code }` | `201 { source }` | `400`, `401`, `403`, `404` |
| `GET` | `/api/cli/v1/campaigns/:id/channels/:channelId/sources` | CLI Bearer | query: `includeArchived?`, `limit?`, `cursor?` | `200 { sources, nextCursor }` | `400`, `401`, `403`, `404` |
| `PATCH` | `/api/cli/v1/campaigns/:id/channels/:channelId/sources/:sourceId` | CLI Bearer | `{ name?, code? }` | `200 { source }` | `400`, `401`, `403`, `404`, `409` |
| `DELETE` | `/api/cli/v1/campaigns/:id/channels/:channelId/sources/:sourceId` | CLI Bearer | — | `200 { id, archived: true }` | `401`, `403`, `404` |
| `POST` | `/api/cli/v1/campaigns/:id/channels/:channelId/sources/:sourceId/restore` | CLI Bearer | — | `200 { source }` | `401`, `403`, `404`, `409` |
| `GET` | `/api/cli/v1/campaigns/:id/analytics` | CLI Bearer | query: `from`, `to`, `bucket?`, `channelId?`, `linkId?`, `includeAutomated?` | `200 { analytics: { totalClicks, trend, links, sources, acquisition } }` | `400`, `401`, `403`, `404` |

Field names for `Campaign`/`CampaignChannel`/`CampaignChannelSource` are drawn directly from the
`campaigns`/`campaign_channels`/`campaign_channel_sources` D1 columns (camelCased: `id`, `name`,
`code`, `defaultDestinationUrl`, `ownerUserId`, `createdAt`, `updatedAt`, `archivedAt` for
campaigns; `id`, `campaignId`, `name`, `code`, `sortOrder`, `archivedAt` for channels; `id`,
`channelId`, `name`, `code`, `archivedAt` for sources) rather than inventing new ones.
The OpenAPI schemas fully define every analytics row and bound each top-N list (default/max 10).
Dates are required ISO instants, `from <= to`, and the inclusive range is capped at 366 days.
`bucket` is `hour | day` (default `day`); an hourly bucket is rejected for ranges over 31 days.
The service maps the validated request to existing analytics window/bucket helpers. No participant
identifier or raw click event is returned.

### 制約

- Do not implement participant-level CRUD (`campaign_participants` and its `_analytics`/
  `_channels`/`_channel_mappings`/`_mapping_channels` sibling tables) in this stage — this plan
  covers campaign/channel/source management and read-only analytics, not participant management.
  If that turns out to be needed, it's a follow-up stage, not a scope-creep addition here.
- If this stage's combined diff turns out to be too large for one delegate session, split along
  campaign-CRUD (`campaigns`/`channels`/`sources` endpoints) vs. aggregate analytics (the
  `GET .../analytics` endpoint) — they touch different tables and have no shared code path beyond
  the campaign resource-policy check.
- Reuse `app/lib/permissions.ts`'s existing patterns (`isSuperAdmin` short-circuit,
  `canManageChapterDomains`-style chapter-role check) rather than inventing a third authorization
  style for this one resource.

## Files to touch

- `tinyurl/app/features/campaigns/` (types, repository, service, policy, aggregate analytics)
- `tinyurl/app/routes/api.cli.v1.campaigns.*.ts` (new)
- `tinyurl/app/routes.ts` (register)
- `tinyurl/openapi/paths/cli-campaign*.yaml` (new)

## Verification

1. Completion criteria: every endpoint in the API Contract table works end-to-end, including
   channel/source rename, archive, and restore, and a caller
   who is neither a super-admin nor a member of any of the campaign's `campaign_chapters` gets
   `403`. `ownerUserId` alone must not override that live policy in either direction.
2. Commands:
   ```
   pnpm --filter @gdgjp/tinyurl typecheck && pnpm --filter @gdgjp/tinyurl test
   pnpm openapi:lint && pnpm openapi:generate && git diff --exit-code -- tinyurl/openapi
   ```
3. Regressions to pin explicitly: an organizer who belongs to one of the campaign's chapters may
   create/update/archive/restore a channel/source even when they are not `ownerUserId`; a caller
   outside all campaign chapters must receive `403` even if the sequential campaign id is guessable. Add both tests so
   the implementation cannot accidentally collapse the policy back to owner-only access.
4. Manual E2E: `pnpm --filter @gdgjp/tinyurl dev`, then with a valid bearer token: create a
   campaign, add and rename a channel, add and rename a source, archive/restore both, create a link
   (via Stage 06's endpoint) with that channel's `campaignChannelId`, and confirm the campaign's analytics
   endpoint reflects the new link once a click is recorded against it.
