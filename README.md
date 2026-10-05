# gdgjp

Before installing dependencies, initialize the shared design system:

```sh
git submodule update --init design-system
pnpm install
```

`design-system/` tracks [gdg-jp/design-system](https://github.com/gdg-jp/design-system).
Commit and push UI changes there first, then commit the updated `design-system` pointer here.
Existing `@gdgjp/design-system` workspace imports and build commands remain unchanged.

Monorepo for the GDG Japan web properties. It uses a flat layout, pnpm workspaces, Turborepo, and
Biome. Its core web apps are React Router v7 SSR applications deployed to Cloudflare Workers, with
persistent state on Cloudflare D1; the repository also includes a public website, a Vercel gateway,
a Chrome extension, an OIDC client demo, and shared libraries.

## Local CI

`pnpm ci:staged` (also `pnpm ci:full --changed`) selects checks from staged paths and executes them
against the current working tree. It prints step durations and saves a JSON report under
`.turbo/ci-metrics/`, including failures, skipped steps, runtime architecture, Turbo task durations
and cache hits, and Playwright test timings/counts. `firstTestDelayMs` includes discovery, server
startup and global setup before the first test; it is not added to the suite duration.

```sh
pnpm ci:staged --no-cache --metrics=.turbo/ci-metrics/cold.json
```

`--no-cache` disables both Turbo cache reads and writes, and gives Go and Playwright fresh temporary
caches. It does not reinstall dependencies or erase application databases. For a cold UI build
benchmark, also remove `design-system/dist`, `design-system/build`, `design-system/node_modules/.vite`, and `design-system/node_modules/.cache`
before each run. Compare successful runs with identical staged paths and use the median of at least
three runs. Cached Playwright reports are marked `cached: true`; their recorded test durations are
historical, while the enclosing step duration is the current wall time.

- Ordinary Codex commits defer to the installed repository Git hook, so CI runs once. Custom,
  missing or disabled hooks and bypass flags retain the agent-side check.
- Application unit-test-only edits retain typechecking and related Vitest tests without rebuilding
  production bundles or rerunning application E2E. Production edits and browser specs retain their
  existing checks.
- Application typechecks and production builds share one Turbo graph, so dependency builds run
  once even with caching disabled. Test-only workspaces do not acquire production build tasks.
- A staged `design-system` gitlink is expanded using its old and staged commit IDs. Later commits and unstaged
  submodule edits do not change the selection. Missing history retains full UI validation.
- UI unit-test-only changes run typechecking and related unit tests. UI E2E-spec-only changes run
  the selected specs; shared code, styles, assets, snapshots, dependencies and configuration retain
  the full browser suite. Deleted specs also retain the full suite.
- Staged UI checks form one Turbo graph. Typechecking, unit tests, declaration emission and
  Storybook compilation run in parallel; browsers wait for the typecheck and both browser builds.
  Declaration emission does not repeat the semantic typecheck. Every story and documentation entry
  remains in the test build; only prop inference and source maps are omitted.
- UI E2E uses up to six workers and records traces on the first retry in CI. `CI=true` prevents
  reuse of an existing server. Source, dependency, environment and compiler-runtime changes
  invalidate cached results. Application E2E depends on local state and is not cached.

UI builds use [Vite 8](https://vite.dev/blog/announcing-vite8) and the native
[TypeScript 7 compiler](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/).
The TypeScript 6 API remains available for Storybook's documentation tools.
The former `gdgjp.typescriptNode` setting is no longer used.

React Router applications and Node-script typechecks also use the pinned native TypeScript 7
compiler. They invoke its explicit path so workspace-local TypeScript 5 APIs remain available to
Vite and React Router. Application checks still regenerate both Worker and route types before
checking the complete project; no incremental compiler cache or reduced checking mode is used.

Application builds use Vite 8 with its native tsconfig-path resolver. Their Wrangler versions stay
aligned so local service bindings can communicate. The previous browser targets and Worker class
names are preserved. Gzip size estimates are omitted from build logs; production
bundles and validation remain enabled. The staged `typecheck+build` graph runs at most four tasks
at once to bound contention between the native compilers' own thread pools.

On Apple Silicon with an Intel Node on `PATH`, install dependencies again with `pnpm install` to
include the declared ARM64 optional binaries, then select a normal native Node >=22.18 installation:

```sh
git config --local gdgjp.ciNode /absolute/path/to/arm64/bin/node
```

This runtime applies to staged typechecks, builds, E2E and UI unit tests. Application unit tests
use the invoking Node to match their installed native addons. `GDG_CI_NODE` can override the setting
for one run. Invalid executables fail CI; `git config --local --unset gdgjp.ciNode` restores the
invoking Node. Each step's selected runtime is recorded and participates in Turbo's cache key.

## GDG CLI

Install the `gdg` CLI with the command for your operating system:

```sh
curl -fsSL https://gdgs.jp/cli/install.sh | sh
```

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://gdgs.jp/cli/install.ps1 | iex"
```

Then sign in with `gdg login`. Run `gdg update` to install the latest stable release.

### Wiki through Git

Wiki content is authoritative in the web application (D1/R2); Git provides a normal local editing,
history, and merge workflow. Install the helper once, then use ordinary Git commands:

```sh
gdg wiki clone ./wiki
cd ./wiki
git add .
git commit -m "docs: update event guide"
git push
git pull
```

The clone's `origin` is `gdg-wiki::https://wiki.gdgs.jp/api/cli/wiki`. `git push` syncs committed
page and attachment changes to D1/R2; `git pull` fetches Web and Google Docs import changes for
Git to merge locally.

### Images

```sh
gdg img list --chapter-id 5
gdg img upload ./photo.jpg --chapter-id 5
gdg img get abcd1234
gdg img replace abcd1234 ./photo-v2.jpg
gdg img mobile abcd1234 ./photo-mobile.jpg
gdg img delete abcd1234
```

Every subcommand prints indented JSON on success and writes a one-line error message to stderr on
failure.

### Short links, domains, and campaigns

```sh
gdg tinyurl domains list --chapter-id 5
gdg tinyurl domains create --hostname go.example.org --chapter-id 5 --wait
gdg tinyurl domains sync 12 --wait

gdg tinyurl links create --domain-id 12 --slug launch --url https://example.org \
  --visibility public --new-tag campaign --share user:a@b.com:editor
gdg tinyurl links list --folder-id 3 --limit 20
gdg tinyurl links update link_01h... --url https://example.org/v2
gdg tinyurl links delete link_01h...

gdg tinyurl tags list
gdg tinyurl folders create --name "Q3 launch"

gdg tinyurl campaigns create --name "Spring 2026" --code spring26 --chapter-id 5
gdg tinyurl campaigns channels create --campaign-id 7 --name Newsletter --code nl
gdg tinyurl campaigns sources create --campaign-id 7 --channel-id 3 --name "Issue 12" --code i12
gdg tinyurl campaigns analytics 7 --from 2026-03-01T00:00:00Z --to 2026-03-31T00:00:00Z --bucket day
```

`gdg tinyurl jobs wait JOB_ID` blocks until an async domain job reaches a terminal state and exits
non-zero if it failed; `domains create`/`domains sync --wait` do the same inline. Every list
subcommand takes `--limit`/`--cursor` and prints the server's `nextCursor` rather than auto-paging.

### Scheduled X posts

```sh
gdg sns x-accounts list --chapter-id 5
gdg sns posts create --chapter-id 5 --x-account-id xa_01h... --text "See you there!" \
  --scheduled-at 2026-09-01T09:00:00Z --condition photo_required --tag-handle gdg
gdg sns media add post_01h... ./photo.jpg --sort-order 0 --alt "Room full of attendees"
gdg sns posts publish post_01h...
gdg sns posts get post_01h...

gdg sns posts list --chapter-id 5 --status scheduled
gdg sns posts update post_01h... --text "Updated copy" --scheduled-at 2026-09-02T09:00:00Z
gdg sns posts delete post_01h...

gdg sns contributors list --chapter-id 5
gdg sns contributors add --chapter-id 5 --email a@b.com
gdg sns contributors remove --chapter-id 5 --email a@b.com
gdg sns x-accounts revoke xa_01h... --x-user-id 1234567890
```

Every request is synchronous. `gdg sns posts publish` prints the terminal post; if the X API
rejects it the server replies `502` with the persisted post (`status` `failed` or
`needs_confirmation`, `failureReason` set), which is still printed before the command exits
non-zero. `contributors remove` is addressed by `--chapter-id`/`--email`, not a positional id,
because that grant has no single-column id.

## Apps

| Directory | Package | Hostname | Description |
|---|---|---|---|
| `accounts/` | `@gdgjp/accounts` | accounts.gdgs.jp | Auth IdP — built on `@cloudflare/workers-oauth-provider` over D1 + KV, issues OAuth credentials to the other apps. |
| `accounts-oidc-client-demo/` | `@gdgjp/accounts-oidc-client-demo` | Cloudflare Workers demo | Independent OpenID Connect relying-party example for GDG Accounts; uses encrypted cookies and no D1, KV, or service binding. |
| `agent-host/` | — | — | Self-hosted counterpart to `agents/`: xangi + Cursor CLI (Composer 2.5) driving the LLM Wiki from a home Ubuntu server. |
| `cli/` | `github.com/gdg-jp/gdgjp/cli` | — | Go-based `gdg` command-line tool for authenticating with GDG Accounts, managing OAuth clients, and installing updates. |
| `gdg-lib/` | `@gdgjp/gdg-lib` | — | Shared RP factory (`initializeRpAuth`) + signed-cookie HMAC helpers, consumed via `workspace:*`. Source-only (no build step). |
| `go-extension/` | `@gdgjp/go-extension` | Chrome extension | Manifest V3 extension for GDG Japan Go Links. Redirects `go/<slug>` URLs, supports the `go` omnibox keyword, and recognizes exact searches. |
| `img/` | `@gdgjp/img` | img.gdgs.jp | Image hosting. D1 + R2 + Cloudflare Images; OAuth client of `accounts`. |
| `learn/` | Git submodule ([`gdg-jp/learn`](https://github.com/gdg-jp/learn)) | learn.gdgs.jp | Codelab and learning-resource delivery app. |
| `ost/` | `@gdgjp/ost` | ost.gdgs.jp | Open Space Technology topic board. Participant form + live projector screen; Cloudflare Worker + a single Durable Object (SQLite storage, hibernatable WebSockets), no D1, no auth. |
| `roster/` | `@gdgjp/roster` | roster.gdgs.jp | Staff shift-schedule generator for events: owners define time slots/tracks/roles/demand, staff self-register, a solver drafts a schedule for hand-editing. D1-backed; OAuth client of `accounts`. |
| `scheduler/` | `@gdgjp/scheduler` | scheduler.gdgs.jp | Meeting scheduler. Anonymous-friendly: anyone can create an event with a weekly schedule and meeting length, and pick available slots; authenticated owners get a cross-device "My events" list plus edit/delete. D1-backed; OAuth client of `accounts`. |
| `sns/` | `@gdgjp/sns` | sns.gdgs.jp | Social-post management and publishing tool. D1 + R2-backed, with scheduled publishing and X and Google Photos integrations; OAuth client of `accounts`. |
| `connpass/` | `@gdgjp/connpass` | connpass.gdgs.jp | Connpass group admin automation API. D1 + KV + Queues + Browser Run; Bearer token API for CLI and agents. |
| `pay/` | `@gdgjp/pay` | pay.gdgs.jp | Event expense reimbursement. D1 + R2, Gemini receipt extraction, Google Sheets/Drive sync; OAuth client of `accounts`. |
| `tinyurl/` | `@gdgjp/tinyurl` | url.gdgs.jp | URL shortener. D1-backed; OAuth client of `accounts`. |
| `tinyurl-gateway/` | `@gdgjp/tinyurl-gateway` | Custom short-link domains | Vercel Edge gateway for TinyURL custom domains. It serves an optional upstream first, then resolves a short link when the upstream returns 404. |
| `design-system/` | `@gdgjp/design-system` | — | Shared React 19 design system submodule (`gdg-jp/design-system`) for GDG Apps, independent of application routing, authentication, and data fetching. |
| `website/` | `@gdgjp/website` | gdgs.jp | Public GDG Japan website. Cloudflare Worker using the TinyURL service binding. |
| `wiki/` | `@gdgjp/wiki` | wiki.gdgs.jp | Community wiki. D1 + R2 + Queues + Browser Rendering + Workers AI + Vectorize + Durable Object (Yjs collab); OAuth client of `accounts`. |

See [CONTRIBUTING.md](./CONTRIBUTING.md) for local development and contribution guidance.
