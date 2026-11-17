# Stage 09 — tinyurl Go CLI client

## Context

Stages 06, 07, and 08 added tinyurl's CLI API surface (links/tags/folders, domains, campaigns).
This stage adds the Go CLI package, following the same `cli/internal/<app>/` +
`cli/internal/command/<app>.go` shape used for img (Stage 04) and connpass. Every endpoint
responds synchronously, so there are no job-polling commands.

Depends on Stages 06, 07, 08 (needs their bundled `tinyurl/openapi/openapi.yaml`) and Stage 02
(`cliutil.WithToken` / `cliutil.PrintJSON`).

Read first: Stage 04's `cli/internal/img/` (the most recently written sibling package — follow its
conventions for consistency across the three new app packages more than connpass's, since connpass
predates this plan and has app-specific quirks that don't apply here).

## Design

### 1. `cli/internal/tinyurl/`

Same generation/client shape as Stage 04's `cli/internal/img/`: `generate.go` bundling
`tinyurl/openapi/` and running `oapi-codegen`; `client.go` with `defaultBaseURL =
"https://url.gdgs.jp"` overridable via `GDG_TINYURL_URL`; `tinyurl.HTTPError` with `HTTPStatus()`
(Stage 02's `cliutil.StatusError`); one thin method per endpoint in Stages 06/07/08's API
Contract tables, each a wrapper over the generated OpenAPI client plus `decodeResponse[T]`.

### 2. `cli/internal/command/tinyurl.go`

```go
func newTinyurlCommand(credentials store.CredentialStore) *cobra.Command
```

Split command construction by resource from the outset: `tinyurl.go`, `tinyurl_links.go`,
`tinyurl_domains.go`, `tinyurl_campaigns.go`, and `tinyurl_resources.go` (tags/folders).
Subcommand groups: `links` (list/create/get/update/delete; repeated typed `--share TYPE:ID:ROLE`
flags on create/update map to the API's `shares` field), `tags` (list/create/update/delete),
`folders` (list/get/create/update/delete), `domains` (list/get/create/sync/delete — `create` and
`sync` print the persisted `Domain`), `campaigns` (list/create/get/update/archive/restore, plus
complete channel/source list/create/update/archive/restore and analytics sub-groups).

Registered in `root.go` via `root.AddCommand(newTinyurlCommand(credentials))`.

### 3. Wire into root `package.json` and README

Confirm `tinyurl` is already listed in the root `openapi:*` scripts (it should be, since
`tinyurl/openapi/` already existed before this plan) — verify rather than assume. Add a
`gdg tinyurl ...` usage block to root `README.md`.

### API Contract

| Command | Notes | stdout shape |
|---|---|---|
| `gdg tinyurl links list [--folder-id ID] [--tag-id ID] [--limit N] [--cursor C]` | | `{ "links": [...], "nextCursor": ... }` |
| `gdg tinyurl links create --domain-id ID --slug S --url URL [--title ...] [--tag-id ID]... [--new-tag NAME]... [--folder-id ID] [--campaign-channel-id ID] [--visibility private\|public] [--share TYPE:ID:ROLE]...` | | `{ "link": {...} }` |
| `gdg tinyurl links get LINK_ID` | | `{ "link": {...} }` |
| `gdg tinyurl links update LINK_ID [same flags as create, all optional]` | | `{ "link": {...} }` |
| `gdg tinyurl links delete LINK_ID` | | `{ "id": "...", "deleted": true }` |
| `gdg tinyurl tags {list,create,update,delete}` | update/delete take `TAG_ID`; ids come from list | list/tag/deletion envelopes |
| `gdg tinyurl folders {list,get,create,update,delete}` | create supports `--parent-id`; get/update/delete take `FOLDER_ID` | list/folder/deletion envelopes |
| `gdg tinyurl domains list [--chapter-id ID]` / `get DOMAIN_ID` | discover ids/status before link creation or recovery | `{ "domains": [...] }` / `{ "domain": {...} }` |
| `gdg tinyurl domains create --hostname H --chapter-id ID` | server detects mode/upstream and enforces safety; provisioning is attempted inline | `{ "domain": {...} }` |
| `gdg tinyurl domains sync DOMAIN_ID` / `delete DOMAIN_ID` | retry failed/verifying provisioning; guarded removal | `{ "domain": {...} }` / deletion envelope |
| `gdg tinyurl campaigns {list,create,get,update,archive,restore}` | archived campaigns are discoverable with `list --include-archived` | list/campaign/archive envelopes |
| `gdg tinyurl campaigns channels {list,create,update,archive,restore} --campaign-id ID [--channel-id ID]` | archived rows are discoverable with `list --include-archived` | list/create/update/restore envelopes or `{ "id", "archived": true }` |
| `gdg tinyurl campaigns sources {list,create,update,archive,restore} --campaign-id ID --channel-id ID [--source-id ID]` | archived source ids remain discoverable | list/create/update/restore envelopes or `{ "id", "archived": true }` |
| `gdg tinyurl campaigns analytics CAMPAIGN_ID --from ISO_INSTANT --to ISO_INSTANT [--bucket hour\|day]` | both window flags are required; CLI performs the same order/366-day validation before calling the API | `{ "analytics": {...} }` |

Every subcommand's output is 1:1 with its corresponding Stage 06/07/08 endpoint's response body.
Non-zero exit code + the server's `{ error }` message on stderr on failure, matching Stage 04's
convention. Every list command exposes the API's common `--limit`/`--cursor` flags and prints
`nextCursor`; it does not auto-fetch an unbounded collection.

### 制約

- Do not build a generic "run any bearer endpoint" catch-all command — each resource gets its own
  typed subcommands, matching every other app command package in this CLI.
- `campaigns analytics` must mark both `--from` and `--to` required in Cobra. Do not invent
  CLI-only defaults: Stage 08/OpenAPI requires an explicit bounded window.

## Files to touch

- `cli/internal/tinyurl/{generate.go,oapi-codegen.yaml,client.go,openapigen/}` (new)
- `cli/internal/command/tinyurl*.go` (new resource-focused files; mirror connpass's established split)
- `cli/internal/command/root.go` (register)
- `README.md`

## Verification

1. Completion criteria: every subcommand in the API Contract table works end-to-end against a
   running tinyurl dev server, and `cli/internal/tinyurl/openapigen/openapi.gen.go` is committed
   and in sync.
2. Commands:
   ```
   cd cli && go generate ./... && go build ./... && go vet ./... && go test ./...
   pnpm openapi:check
   ```
3. Regression to pin explicitly: `gdg tinyurl domains create` against a hostname the provider
   rejects still prints the persisted error-state `Domain` (`status: "error"`) and exits 0 — a
   provisioning failure is data on the returned domain, not a CLI error.
4. Manual E2E: after local migration/dev and `gdg login`, start without dashboard-derived ids:
   list domains, create/list/update/delete a link, register a domain and inspect its returned
   state, sync a forced error, then delete it. Create a campaign, discover its channel/source
   ids, rename/archive/restore both, attach a link, and query aggregate analytics with an
   explicit `--from`/`--to` window.
