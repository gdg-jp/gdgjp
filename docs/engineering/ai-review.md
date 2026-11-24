# AI review gate

Pull requests into `main` need the `ai-review` commit status from the GDG-chan app to pass
before they merge. Only the `main` ruleset's bypass actors can merge without it. The
status passes after at least one GDG-chan review has run on the pull request and GDG-chan
has confirmed every finding from every review on it resolved.

GDG-chan runs Codex CLI on GitHub-hosted runners with the model in the repository
variable `CODEX_REVIEW_MODEL` (default `gpt-6.2-astra`) at the reasoning effort in
`CODEX_REVIEW_EFFORT` (default `medium`). It signs in with a ChatGPT account through the
[AI login workflow](../../.github/workflows/ai-login.yml).

## Using it on a pull request

1. Add the `E-code-review` label. GDG-chan reviews the diff against the merge base,
   posts one review with an inline comment per finding, and removes the label. Adding the
   label again requests another review; that is optional.
2. Fix each finding, then add any reaction to its comment or reply to it (for example
   "解決しました"). A reply can also explain why the finding is wrong.
3. GDG-chan checks the current head of the pull request. When the problem is gone, or
   it agrees with your explanation after reading the code, it replies with ✅ and resolves
   the thread. Otherwise it replies with ❌ and what remains; respond again after the next
   fix.
4. To ask GDG-chan to check every unresolved finding at once, comment `/ai-review` (or
   mention `@gdg-chan`) on the pull request.

Replies, labels, and `/ai-review` comments start GDG-chan within a minute. GitHub sends
no event for reactions, so a scheduled run picks them up within about ten minutes.

| Status | Meaning |
| --- | --- |
| pending, "Add the E-code-review label ..." | No GDG-chan review has run yet. |
| pending, "queued or running" / "checking" / "working" | GDG-chan has work for this pull request. |
| failure, "N of M GDG-chan findings are unresolved" | Respond to the remaining findings. |
| failure, "finding comments were deleted or altered" | A finding listed by a review is gone or its marker no longer verifies. A maintainer reviews what happened and bypasses. |
| "#N (same change as #M): ..." | Open pull requests from this repository share the head and base, so they share one status. Each must pass on its own review; the worst state wins. Close the duplicate or review it. |
| pending, "The pull request that reviewed this commit is closed" | A closed pull request's success is withdrawn from its head commit. |
| success | At least one review ran and all of its findings are resolved. |
| error, "Codex is not signed in" | Run the AI login workflow. |
| error, "Codex agent failed" | Read the linked run; comment `/ai-review` or re-add the label to retry. |

## Checking the app in a browser

When GDG-chan reviews a pull request or checks responses to its findings, and the pull
request changes, renames, or deletes files under one of the apps that has a Playwright E2E suite
(`accounts`, `tinyurl`, `wiki`, `img`, `scheduler`, `sns`, `pay`, `ost`, `roster`, `mc`,
`screen`, `deck`, `roulette`, `meet`), GDG-chan starts that app from the pull request
head first, and Codex can open it in a headless browser. If several apps changed, it picks
the one with the most changed files. The review footer says "apps/X のプレビューを用意" when
the preview was running for Codex, or that it could not start; then the review is from the
code only. The summary says whether Codex reached it.

The preview is the same disposable stack as `pnpm test:e2e --workspace @gdgjp/X`: the
app and Accounts on their CI ports, freshly migrated local databases, the E2E global setup's
fixtures, and deterministic test credentials. It never holds staging or production data.
Codex signs in the way that app's E2E specs do, through `/dev/login` or the storage states
the global setup writes (Wiki's `admin`, `author`, and `member`). Starting it adds about two
minutes per pull request. `pr`, `connpass`, and `website` are not previewed: `pr`'s E2E setup
downloads fonts from the internet, and the other two run a fixed list of spec files.

[`ai-review-preview.mjs`](../../.github/scripts/ai-review-preview.mjs) runs it in two
containers on the agent runner:

- The **app container** (`mcr.microsoft.com/playwright`, pinned by digest) receives a
  `git archive` of the head and the pinned submodule commits. While it has network access it
  runs only code and configuration that do not come from the pull request: apt, Git fetching
  the submodules from their fixed URLs, npm installing the pnpm version pinned in `main`'s
  `package.json`, and `pnpm fetch` in an empty directory that holds only the pull request's
  lockfile, with the registry fixed to `registry.npmjs.org` and no user config or pnpmfile.
  The agent first checks the lockfile line by line against the plain format pnpm writes
  (keys, single-quoted or plain scalars, one-line `engines` maps and lists, `deprecated` block
  text) and requires every `resolution` to be `{integrity: ...}` alone; anything else, such as
  a tarball, Git, or directory resolution, a quoted or escaped key, an anchor, a tag, or a
  merge key, skips the preview. The container then leaves the
  Docker network, so only loopback remains, and only then runs the pull request's code:
  `pnpm install --offline` with its install scripts, and the app's Playwright config with a
  test that holds the servers open. It gets no secret, no environment variable from the
  runner, and no host directory. The agent reads at most 1 MiB from any container command
  and accepts only a loopback base URL and plain file names from its `ready.json`.
- The **browser container** (`mcr.microsoft.com/playwright/mcp`, pinned by digest) is the
  Codex `browser` MCP server. It joins the app container's network namespace, so
  `localhost` is the preview and nothing else is reachable, and it mounts the storage states
  read-only. `file://` URLs, arbitrary Playwright code, and file uploads are disabled.

Codex itself still runs in the read-only sandbox without network; it reaches the browser
only through MCP tool calls, which Codex starts outside the sandbox. The sandbox check also
confirms that the sandbox cannot connect to the Docker socket.

GDG-chan gates only pull requests into `main`, the branch the ruleset protects. Pull
requests into other branches get no status and no review. Fork pull requests do not get
GDG-chan reviews; a bypass actor merges them after a human review.

## How it runs

[`ai-review.yml`](../../.github/workflows/ai-review.yml) has two halves:

- Pull request, review comment, and PR comment events run only a **Hand off to main**
  job. It has no secrets and only `actions: write`, and it starts the same workflow on
  `main` with `workflow_dispatch` and the pull request number. Code from the pull request
  never runs with a secret.
- The dispatched run and the ten-minute schedule run the **Plan** and **Agent** jobs from
  `main`, in the `ai-review` environment. Only `main` may deploy to that environment, so
  its secrets are unavailable to any other branch's workflow. Plan publishes the status for
  the pull request (or every open pull request on the schedule) and lists pull requests
  with work. Agent runs Codex on them and posts the results.

The environment holds:

| Secret | Use |
| --- | --- |
| `GDG_CHAN_PRIVATE_KEY` | Private key of the GDG-chan GitHub App (app ID: repository variable `GDG_CHAN_APP_ID`). |
| `AI_REVIEW_SIGNING_KEY` | HMAC key for the hidden markers that record reviews, findings, and verdicts. |
| `CODEX_AUTH_KEY` | AES-256-GCM key for the stored Codex login. |
| `CODEX_ACCOUNT_SHA256` | SHA-256 of the lowercase email of the only ChatGPT account the login may use. |

GDG-chan is a GitHub App owned by the gdg-jp organization and installed only on this
repository, with write access to code, commit statuses, issues, and pull requests. The
scripts create installation tokens from its private key and refresh them before they
expire, so long runs keep working. `GITHUB_TOKEN` is used only for dispatching and for
the login artifacts. Change the name or icon in the app's settings under the
organization's GitHub Apps.

## Trust model

- The gate reads only hidden `codex-review:*` markers that end a comment by
  `gdg-chan[bot]` and carry a valid HMAC over their fields and the pull request number.
  People cannot post as GDG-chan, and editing a marker breaks its signature. A finding's
  marker also signs a digest of the finding's text, so editing the finding breaks it too.
  Resolving a thread by hand does not resolve a finding.
- Each review marker lists its finding IDs and the IDs of the `E-code-review` label events
  it answered, and reviews cannot be deleted. If a listed finding is deleted, or any
  non-empty GDG-chan comment or review lacks a valid marker of the kind expected there, or
  GitHub reports that someone other than GDG-chan edited a GDG-chan post, the gate fails
  instead of forgetting the finding.
- Reactions, replies, and `/ai-review` comments count only from people with write access
  to the repository. Other bots are ignored. Each verdict records the IDs of every response
  GDG-chan has checked for that finding, so any response it has not seen starts another
  check, whenever it arrived. A verdict written before IDs were recorded gets its responses
  checked once more.
- Codex runs without any token under a permission profile that allows reading the
  filesystem, denies the Codex home that holds the login, and allows no writes. Before
  each run, `codex-review.mjs sandbox-check` confirms through `codex sandbox` that the
  sandbox can read the checkout but cannot read `auth.json`, the agent's `/proc` environment,
  reach the Docker daemon, or write, and the job stops otherwise. The pull request's own code
  runs only in the preview containers described above. The workflow posts only the JSON that Codex returns,
  after redacting the login's values and every issued GDG-chan token and neutralizing
  `<!--`.
- The status must come from the GDG-chan app (the ruleset pins the app as the check's
  source), and its key exists only in the `main`-only environment, so a branch workflow
  cannot forge the status.

## Signing in

The login is a ChatGPT device-code sign-in stored as the `codex-auth` workflow artifact,
encrypted with `CODEX_AUTH_KEY`. The repository is public, so the artifact is never
stored in plain text. The run log, and therefore the one-time code, is public too. Anyone
who enters the code first could attach their own ChatGPT account, so the login and every
restore check the account against `CODEX_ACCOUNT_SHA256` and refuse any other account.

1. Open Actions → **AI login** → **Run workflow** on `main`.
2. Open the run. The **Show the login link** step prints the link and one-time code, and
   the run summary shows them as an annotation.
3. Open the link, sign in to the ChatGPT account the agent should use, and enter the
   code within 15 minutes. Device code sign-in must be enabled in that account's ChatGPT
   security settings.
4. The run finishes by storing the encrypted login.

Every agent run restores the newest `codex-auth` artifact uploaded by `ai-review.yml` or
`ai-login.yml` from a `workflow_dispatch`, `schedule`, or `push` run of this repository's
`main`, ignoring artifacts of the same name from anywhere else, and
stores a new one when Codex refreshed its tokens, keeping the three newest. All runs that
touch the login share the `codex-auth` concurrency group so a refresh token is never used
twice. Artifacts expire after 90 days, so an agent that has not run for 90 days needs a new
sign-in.

To rotate a key or change the account, set the environment secret and run the login
workflow again:

```sh
openssl rand -base64 48 | gh secret set CODEX_AUTH_KEY --env ai-review
printf '%s' 'agent-account@example.com' | shasum -a 256 | cut -d' ' -f1 | gh secret set CODEX_ACCOUNT_SHA256 --env ai-review
```

Rotating `AI_REVIEW_SIGNING_KEY` invalidates every existing marker, so do it only when no
pull request is waiting on GDG-chan.

## Files

- [`ai-review.yml`](../../.github/workflows/ai-review.yml): the handoff, plan, and agent
  jobs.
- [`ai-login.yml`](../../.github/workflows/ai-login.yml): the device-code sign-in.
- [`codex-review.mjs`](../../.github/scripts/codex-review.mjs): gate evaluation, markers,
  prompts, and GitHub writes.
- [`ai-review-preview.mjs`](../../.github/scripts/ai-review-preview.mjs): the app preview and
  the browser MCP server.
- [`codex-auth.mjs`](../../.github/scripts/codex-auth.mjs): login encryption, restore,
  refresh storage, redaction, and GDG-chan tokens.
