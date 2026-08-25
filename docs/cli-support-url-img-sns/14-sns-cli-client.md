# Stage 14 — sns Go CLI client

## Context

Stages 12 and 13 added sns's CLI API surface (post/media/X-account/contributor CRUD, async
publish-now). This stage adds the Go CLI package, the last of the three new app packages in this
plan, following the same shape as img (Stage 04) and tinyurl (Stage 09), including job-polling
commands for X-publish.

Depends on Stages 12 and 13 (needs their bundled `sns/openapi/openapi.yaml`) and Stage 02
(`cliutil.WithToken`/`cliutil.PrintJSON`).

Read first: Stage 09's `09-tinyurl-cli-client.md` (the most structurally similar sibling — also has
a job-polling resource) and `cli/internal/connpass/client.go`'s `WaitJob`/`JobFailed`.

## Design

### 1. `cli/internal/sns/`

Same shape as Stages 04/09: `generate.go` bundling `sns/openapi/`; `client.go` with
`defaultBaseURL = "https://sns.gdgs.jp"` (confirm the actual production hostname against
`sns/wrangler.toml`/`sns/CLAUDE.md` before hardcoding — do not guess if it differs), overridable
via `GDG_SNS_URL`; `sns.HTTPError` with `HTTPStatus()`; methods for every Stage 12/13 endpoint;
`WaitJob`/`JobFailed` copied structurally from Stage 09's tinyurl version (which itself copies
connpass's), pointed at `GET /api/cli/v1/jobs/:jobId`.

### 2. `cli/internal/command/sns.go`

```go
func newSnsCommand(credentials store.CredentialStore) *cobra.Command
```

Split command construction into `sns.go`, `sns_posts.go`, `sns_media.go`, and
`sns_admin.go` (X accounts/contributors/jobs). Subcommand groups: `posts` (list/create/get/update/delete/publish — `publish` takes the same
`--wait` flag pattern as `connpass session relogin`/Stage 09's `domains create`), `media`
(add/delete), `x-accounts` (list/revoke), `contributors` (list/add/remove), `jobs` (get/wait).

Registered in `root.go`.

### 3. Wire into root `package.json` and README

`sns` was already added to the root `openapi:*` scripts in Stage 12 — confirm, don't re-add. Add a
`gdg sns ...` usage block to root `README.md`.

### API Contract

| Command | Notes | stdout shape |
|---|---|---|
| `gdg sns posts list --chapter-id ID [--status S] [--limit N] [--cursor C]` | | `{ "posts": [...], "nextCursor": ... }` |
| `gdg sns posts create --chapter-id ID --x-account-id ID --text T --scheduled-at TIME --condition scheduled\|photo_required [--tag-handle H]...` | | `{ "post": {...} }` |
| `gdg sns posts get POST_ID` | discovers existing media ids as well as post state | `{ "post": {...}, "media": [...] }` |
| `gdg sns posts update POST_ID [same flags as create, all optional]` | | `{ "post": {...} }` |
| `gdg sns posts delete POST_ID` | | `{ "id": "...", "deleted": true }` |
| `gdg sns posts publish POST_ID [--wait]` | `--wait` polls to completion; on `needs_confirmation`, the operator checks X before explicitly invoking this retry | `{ "job": {...} }` (or terminal `Job` if `--wait`) |
| `gdg sns media add POST_ID FILE --sort-order N [--alt TEXT]` | | `{ "media": {...}, "post": {...} }` |
| `gdg sns media delete MEDIA_ID` | | `{ "id": "...", "deleted": true, "post": {...} }` |
| `gdg sns x-accounts list --chapter-id ID` | discover `xAccountId` for post creation | `{ "accounts": [...] }` |
| `gdg sns x-accounts revoke ACCOUNT_ID --x-user-id ID` | confirmation matches dashboard safety | `{ "id": "...", "revoked": true }` |
| `gdg sns contributors list --chapter-id ID` | | `{ "contributors": [...] }` |
| `gdg sns contributors add --chapter-id ID --email E` | | `{ "chapterId": N, "userEmail": "..." }` |
| `gdg sns contributors remove --chapter-id ID --email E` | | `{ "deleted": true }` |
| `gdg sns jobs get JOB_ID` / `gdg sns jobs wait JOB_ID` | | `Job` object |

Every subcommand's output is 1:1 with its corresponding Stage 12/13 endpoint's response body,
including the deliberately query-param-based `contributors remove` (no positional id — the
underlying resource has no single-column id, per Stage 12's `制約`).
List commands expose `--limit`/`--cursor` wherever the server contract is paginated and do not
silently fetch every page.

### 制約

- `gdg sns contributors remove` takes `--chapter-id`/`--email` flags, not a positional id — do not
  "fix" this into a positional-id shape to match the other resources' pattern; the underlying API
  (Stage 12) genuinely has no single id for this resource, and forcing one here would require
  either inventing a fake composite-id encoding or silently diverging from the API it wraps.
- Do not skip the `--wait` flag on `posts publish` — same reasoning as Stage 09's `domains create`.

## Files to touch

- `cli/internal/sns/{generate.go,oapi-codegen.yaml,client.go,openapigen/}` (new)
- `cli/internal/command/sns*.go` (new resource-focused files)
- `cli/internal/command/root.go` (register)
- `README.md`

## Verification

1. Completion criteria: every subcommand in the API Contract table works end-to-end against a
   running sns dev server, `--wait` on `posts publish` correctly blocks until terminal, and
   `cli/internal/sns/openapigen/openapi.gen.go` is committed and in sync.
2. Commands:
   ```
   cd cli && go generate ./... && go build ./... && go vet ./... && go test ./...
   pnpm openapi:check
   ```
3. Regression to pin explicitly: `gdg sns posts publish` against a job that fails (e.g. X API
   returns an error) must exit non-zero with the job's `error` message, matching Stage 09's
   `JobFailed` behavior — write a test forcing a failed job and asserting the CLI's exit code and
   stderr content.
4. Manual E2E: after `pnpm --filter @gdgjp/sns migrate:local && pnpm --filter @gdgjp/sns dev` and
   `gdg login`, run through create-post → add-media → publish `--wait` → confirm the post's status
   in a subsequent `gdg sns posts get` call.
