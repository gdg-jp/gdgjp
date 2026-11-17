# Stage 02 — Shared Go CLI client helpers

## Context

The Go CLI (`cli/`) independently reimplements the same "load stored credentials → try the
request → on a 401 call `oauth.Refresh` → save the refreshed token → retry once" logic four times:
`withConnpassToken` (`cli/internal/command/connpass.go:30-59`), `accountsService.withAccessToken`
(`cli/internal/command/accounts.go:211`), `agentService.withAccessToken`
(`cli/internal/command/agent_workspace_token.go:74`), and `wikiService.withToken`
(`cli/internal/command/wiki.go:348`) — each with its own 401-detection helper checking a
package-local `*HTTPError` type. There are also two near-duplicate JSON-output helpers,
`printConnpassJSON` (`connpass.go:61-65`) and `writeJSON` (`accounts.go:241-248`). Adding img,
tinyurl, and sns CLI packages (Stages 04, 09, 14) would make this a 7th/8th/9th copy. This stage
puts the shared token retry and the canonical indented JSON writer in one `cli/internal/cliutil`
package. All four existing token call sites move to it; connpass's already-indented JSON moves to
`PrintJSON`, while Accounts/agent retain their compact `writeJSON` adapter. Every new CLI package
uses both shared helpers from day one.

Depends on: none. This is pure Go work with no coupling to the Worker-side stages; it can run in
parallel with everything else in the plan (see `00-overview.md`'s dependency graph). Must land
before Stages 04, 09, 14.

Read first: `cli/internal/command/root.go` (the single command-registration point — new commands
are added here, not touched by this stage but useful context), `cli/internal/oauth/oauth.go`'s
`Refresh(ctx, refreshToken)` (already the shared refresh entrypoint every duplicate calls),
`cli/internal/store/credentials.go`'s `CredentialStore` interface (already shared).

## Design

### 1. `cli/internal/cliutil/token.go`

Every package's `HTTPError` type (`connpass.HTTPError`, `accounts.HTTPError`, `wiki.HTTPError`,
and — added in Stages 04, 09, 14 — `img.HTTPError`, `tinyurl.HTTPError`, `sns.HTTPError`) already
has a public `StatusCode int` field. Add a `HTTPStatus() int` method (a *new* method name, since a
struct can't have both a field and a method literally named `StatusCode`) to each existing
`HTTPError` type returning that field, so all of them satisfy one common interface:

```go
type StatusError interface {
    error
    HTTPStatus() int
}

func WithToken[T any](
    ctx context.Context,
    store credstore.CredentialStore,
    fn func(accessToken string) (T, error),
) (T, error)
```

Behavior, ported from `withConnpassToken` (`connpass.go:30-59`): load credentials
(`store.ErrNotFound` → a typed `NotLoggedInError` whose default text is
`"not logged in; run gdg login"`);
call `fn(credential.AccessToken)`; on success return; on error, check `errors.As(err, &statusErr)`
against `StatusError` and `statusErr.HTTPStatus() == 401` — if not a 401, return the error as-is;
if it is, call `oauth.Refresh(ctx, credential.RefreshToken)`, save the refreshed credential via
`store.Save`, and call `fn` exactly once more with the new access token, returning whatever that
second call returns (success or failure, no further retry).

### 2. `cli/internal/cliutil/json.go`

```go
func PrintJSON(w io.Writer, v any) error
```

Ported from `printConnpassJSON` (`connpass.go:61-65`): `json.NewEncoder(w)` with
`SetIndent("", "  ")`, then `Encode(v)`. New img/tinyurl/sns commands use it. Do not change the
existing Accounts/agent compact output in this refactor; keep their current `writeJSON` adapter
until a separately documented CLI-format change is approved. Whitespace is observable to shell
consumers even though both encodings are valid JSON.

### 3. Refactor the four existing call sites

`cli/internal/command/{connpass.go,accounts.go,wiki.go,agent_workspace_token.go}` — replace each
package-local token-refresh/unauthorized pair with calls into `cliutil.WithToken`, keeping every
call site's own package import
(`connpass.HTTPError`, `accounts.HTTPError`, or `wiki.HTTPError`) only for the `HTTPStatus()` method
addition from step 1. The agent command uses `accounts.HTTPError`; there is no
`cli/internal/agent_workspace_token/` client package or fourth HTTP error type. Existing
tests (`connpass_test.go`, `wiki_test.go`, `accounts_test.go`, `agent_workspace_token_test.go`)
must pass byte-for-byte. Preserve each command's existing public error wrapping through thin
command adapters; do not normalize messages as an incidental effect of sharing retry mechanics.

### 4. Same-session CI groundwork (do this first, before the refactor)

`cli/`'s `go test ./...` currently only runs at release-tag time
(`.github/workflows/deploy.yml`'s `release-cli` job, gated on `refs/tags/cli/v*`) — not on every
PR. Add a PR-triggered job to `.github/workflows/ci.yml` mirroring the existing `openapi` job's
shape (`needs: changes`, gated on a path-filter output, `actions/setup-go@v5` with
`go-version: "1.23"`, then gofmt check, `go vet ./...`, `go test ./...`, `go build ./...`, and the
same cross-platform builds used by `scripts/run-ci.mjs`/release CI). Check
`.github/scripts/changed-workspaces.mjs` for whether a `cli` output already exists in the
`changes` job; add one (glob `cli/**`) if it doesn't. Do this step *before* the `cliutil` refactor
in the same session, so the refactor itself is safety-netted by CI rather than only by a local
`go test ./...` run.

### API Contract

Exported Go function signatures (no HTTP/CLI surface of their own — this is a library package
consumed by every command package):

```go
package cliutil

type StatusError interface {
    error
    HTTPStatus() int
}

func WithToken[T any](
    ctx context.Context,
    store credstore.CredentialStore,
    fn func(accessToken string) (T, error),
) (T, error)

func PrintJSON(w io.Writer, v any) error
```

Plus, on each existing per-package `HTTPError` type: `func (e *HTTPError) HTTPStatus() int { return e.StatusCode }`.

Stages 04, 09, 14 build their new `img.HTTPError`/`tinyurl.HTTPError`/`sns.HTTPError` types with
this same `HTTPStatus()` method from the start, and their command packages call
`cliutil.WithToken`/`cliutil.PrintJSON` directly rather than writing a package-local equivalent.

### 制約

- Do not change `oauth.Refresh`'s signature or `store.CredentialStore`'s interface — this stage
  only adds a consolidation layer above them, it doesn't touch the primitives underneath.
- Do not change the *observable* behavior of any of the four existing commands (`gdg connpass ...`,
  `gdg accounts ...`, `gdg wiki ...`, `gdg agent workspace-token ...`) — this is a pure internal
  refactor. Accounts/agent continue using the compact adapter; this decision is already frozen and
  is not an implementation-time question.

## Files to touch

- `cli/internal/cliutil/{token.go,json.go}` (new)
- `cli/internal/{connpass,accounts,wiki}/client.go` (add `HTTPStatus()` to the three existing
  `HTTPError` types; the agent command reuses `accounts.HTTPError`)
- `cli/internal/command/{accounts.go,connpass.go,wiki.go,agent_workspace_token.go}` (refactor call
  sites)
- `.github/workflows/ci.yml` (new PR-triggered `cli` test job)
- `.github/scripts/changed-workspaces.mjs` (add a `cli` output if missing)

## Verification

1. Completion criteria: `cliutil.WithToken` is the single retry implementation used by all four
   existing command paths; `cliutil.PrintJSON` replaces connpass's indented helper and is used by
   all new commands, while the existing compact Accounts/agent adapter remains intentionally.
   No duplicate `withXToken` helper remains in `cli/internal/command/`; `go test ./...` for `cli/`
   runs on every PR via CI, not only at release-tag time.
2. Commands:
   ```
   cd cli && go build ./... && go vet ./... && go test ./...
   ```
3. Regression tests to pin explicitly: `connpass_test.go`, `wiki_test.go`, `accounts_test.go`,
   `agent_workspace_token_test.go` — all must pass byte-for-byte with no output-format
   normalization for existing Accounts/agent commands. Specifically pin:
   the 401-refresh-retry-once sequence (a test that returns 401 once then 200 on retry must
   succeed exactly as it does today), and the "not logged in" error message text (any test
   asserting on that exact string must still pass).
4. Manual E2E: open a PR touching only a file under `cli/` and confirm the new CI job runs and
   passes (or fails loudly if `go test ./...` is broken) — this is the regression the same-session
   CI change (Design step 4) exists to catch going forward.
