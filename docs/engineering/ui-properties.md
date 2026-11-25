# UI property tests and the staging fuzz loop

Property tests generate seeded sequences of user actions and check, after every
action, invariants that must always hold. The same engine runs in two places:

- **Property specs** in each app's E2E suite run against the isolated local stack
  (`pnpm test:e2e`). They know the app's domain: several signed-in actors, fixtures,
  and server state such as mock-service sends or D1 rows.
- **The staging fuzz loop** ([`ui-fuzz.yml`](../../.github/workflows/ui-fuzz.yml)) explores
  a deployed staging slot black-box, files deduplicated issues, and can hand each new
  failure to GDG-chan's Codex agent for a draft fix pull request.

## The engine

`packages/ui-properties` (`@gdgjp/ui-properties`) holds the shared pieces:

| Module | What it does |
| --- | --- |
| `src/engine.ts` | Seeded generation, replay, shrinking (chunk removal until no smaller sequence fails the same check with the same normalized message), failure signatures |
| `src/access.ts` | The staging run's Access scope and upstream, from its environment |
| `src/forwarder.ts` | The local TLS forwarder that adds the Access service token to requests for the slot's `https` hosts |
| `src/certificate.ts` | Per-run self-signed certificates and their SPKI hashes |
| `scripts/secret-scan.mjs` | Searches fuzz evidence, including Playwright and Bombadil traces, for the Access service token and issued Access JWTs before upload |
| `src/monitor.ts` | Generic invariants on every watched page: no console errors, no uncaught exceptions, no 5xx responses from the app's origins, no dead-end page that stays without a visible enabled control for three seconds, an accessible name on every control an action touches |
| `src/run.ts` | `runPlan` (budget from the environment), `checkUiProperty` (runs, shrinks, prints, and records a failure) |
| `src/explore.ts` | Generic actions for apps without a model: use a random visible control, repeat it, go back, reload, start over; destructive labels are avoided |
| `fuzz/` | The staging exploration spec and its Playwright config |
| `scripts/mutation-proof.mjs` | Runs a property spec against a disposable copy of the repository with one deliberate defect |
| `scripts/bombadil.mjs` | The pinned Bombadil binary and a wrapper that records its violations with cookie and header values removed |

An app's property is a `UiProperty`: a `setup` that builds a fresh world (fixtures,
browser contexts, monitors), `actions` with weights, enabling conditions and seeded
inputs, and `invariants`. Each action records its input as JSON so a sequence can be
replayed without the generator. Shrinking replays candidate subsequences in fresh
worlds, so `setup` must not depend on earlier runs.

| App | Spec | Model |
| --- | --- | --- |
| Wiki | `apps/wiki/tests/e2e/ui-properties.spec.ts` | Author and member on two pages: display settings per actor and page, sharing dialog scope, access API never widens, member writes refused |
| PR | `apps/pr/e2e/ui-properties.spec.ts` | Host and co-host organizers and outsiders editing text and `{{shortlink}}` link URLs: nothing reaches a send without approval of that exact version, a refused approval writes no link or log row and calls no url.gdgs.jp, each short link belongs to one approved version, and each send links to its own version's URL |
| Accounts | `apps/accounts/e2e/ui-properties.spec.ts` | Sign-in and sign-out consistency with a relying party; privileges never grow from UI actions |
| Tinyurl | `apps/tinyurl/e2e/ui-properties.spec.ts` | Two members creating, opening, and deleting private and public links: each reaches exactly the links it may see, and no dashboard lists another member's private link |
| OST | `apps/ost/e2e/ui-properties.spec.ts` | Participants submitting and voting, an organizer moderating: the screen shows every topic once with its vote count, and participants cannot moderate |
| Screen | `apps/screen/e2e/ui-properties.spec.ts` | An operator creating, renaming, and deleting stages and a speaker using invites: the stage list matches what exists, and the speaker cannot run operator actions. Media is not exercised |
| Pay | `apps/pay/e2e/ui-properties.spec.ts` | Organizers and a member of two chapters creating and opening events: management controls and the proxy form appear exactly for an event's owner and its chapter's organizers |

## Budgets and seeds

| Variable | Meaning |
| --- | --- |
| `UI_PROPERTY_PROFILE` | `pr` (default) or `long`. `long` multiplies steps and minutes by five, allows forty shrink replays, and adds four seeds derived from the UTC date |
| `UI_PROPERTY_SEEDS` | Comma-separated seeds that replace the defaults |
| `UI_PROPERTY_STEPS` | Steps per seed |
| `UI_PROPERTY_MINUTES` | Generation time limit per seed; generation stops early and passes when it is reached |
| `UI_PROPERTY_SHRINK_REPLAYS` | Replay budget for shrinking |
| `UI_PROPERTY_REPLAY` | A base64url or JSON step list (or an absolute path to one) to run instead of generating |
| `UI_PROPERTY_FAILURES_DIR` | Also write each failure record here |

The isolated E2E runner forwards every `UI_PROPERTY_*` variable into its snapshot.
Pull requests run the property specs inside the normal **E2E** job with the `pr`
profile and fixed seeds, so a pull request cannot pass on one run and fail on the
next because of a new seed. Changes to `packages/ui-properties` select the E2E jobs
of every app that has a property spec, without selecting their deploys. The
[long-budget workflow](../../.github/workflows/ui-properties.yml) runs every spec with
the `long` profile weekly and on manual dispatch, with optional seeds and steps.
Property specs set `retries: 0`, so a failure is never reported as flaky.

## Reading a failure

A failure prints and throws:

```text
UI property "wiki page display and access" failed with seed 1701 after 37 steps (pr profile)
violated: invariant "each actor sees its own display settings for the page it is on"
  ...
minimal sequence: 4 steps after 7 shrink replays
  1. toggle small text {"role":"member","page":"b"}
  ...
signature: 5f0c...
replay the seed: UI_PROPERTY_PROFILE=pr UI_PROPERTY_SEEDS=1701 UI_PROPERTY_STEPS=37 pnpm test:e2e --workspace @gdgjp/wiki -- tests/e2e/ui-properties.spec.ts -g ' seed 1701 ...$'
replay the minimal sequence: UI_PROPERTY_SEEDS=1701 UI_PROPERTY_REPLAY=W3si... pnpm test:e2e ...
```

The same record is `ui-property-failure.json` in the test's output directory, which
the isolated runner copies to `local_data/pstack/e2e/<run>/`. The signature hashes the
property, the violated check, and the first line of its message with numbers and IDs
removed, so the same defect found by different seeds shares one signature. A replay is
exact only while the app behaves deterministically for the same inputs.

## Proving the checks can fail

```sh
node packages/ui-properties/scripts/mutation-proof.mjs --mutations packages/ui-properties/mutations/wiki.json
```

Each entry in `packages/ui-properties/mutations/<app>.json` names a file, an exact
source fragment, and its replacement. The script copies the working tree to a
temporary directory, applies one mutation there, runs the named spec through the
isolated runner, and deletes the copy; the source tree is never edited. A mutant is
`killed` only when the run fails with a property failure record whose check matches
the entry's `expect`; a run that fails for another reason (for example an occupied
port) is reported as `failed-without-property-violation`. Evidence and a
`summary.json` go to `local_data/pstack/ui-properties/mutations/<run>/`. The fragments
go stale when the source changes; the script refuses a fragment that does not match
exactly once.

## The staging fuzz loop

Run it from Actions → **UI fuzz (staging)** → **Run workflow** on `main`, after the
chosen slot has a successful deployment. It is manual only; nothing schedules it or
starts it after a deploy. Inputs: `slot`, `apps`, `minutes` per app and seed, `seeds`,
`bombadil`, `open_fix_prs` (default off), and `max_fix_prs`.

1. **Check the slot's deployment** reads the slot's latest GitHub deployment and stops
   unless it succeeded. It records whether the slot runs `main` or a pull request.
2. **Fuzz** runs `main`'s code in the `staging` environment. One step mints a throwaway
   Accounts user and session in the slot's own D1, with no chapter membership, using
   `CLOUDFLARE_API_TOKEN` and the slot's derived Better Auth secret. The exploration
   step gets only the Access service token and that session file: the browser, which
   runs the slot's possibly unreviewed code, never shares a process environment with
   the Cloudflare token or the staging root secret. Before exploring, the job runs the
   package's Access, forwarder, explorer, and evidence tests in a real browser. The
   Access token is added in one place, the forwarder in `src/forwarder.ts`, which the
   staging spec starts per worker. It is a local TLS server with a key and certificate
   generated with `openssl` for that run and kept in memory. Chromium is launched with
   `--host-resolver-rules` that send only port 443 of the slot domain and its
   subdomains to it, with `--ignore-certificate-errors-spki-list` naming that one
   certificate, and with QUIC disabled. Every request to an `https` slot URL then
   reaches the forwarder, including each hop of a redirect chain, form posts,
   subresources, and WebSocket upgrades, and the browser never holds the token. For
   each request the forwarder checks that the TLS server name and the `Host` header
   match and that `https://<host><path>` is in the Access scope
   (`scripts/access-origin.mjs`, shared with `ui-fuzz.mjs`): `https` on the default
   port, a host that is the slot domain or one of its subdomains after URL
   normalization, with no user information and no trailing dot. Anything else,
   including an absolute or `//` request target, gets `421` and no upstream connection.
   It then removes any `CF-Access-*` header and `CF_Authorization` cookie the page sent,
   adds the service token, and connects to the real host over `https` with normal
   certificate verification and the real host as server name, resolving it itself.
   Responses and request bodies are streamed in both directions; it removes
   `CF_Authorization` from `Set-Cookie`, so the browser and its trace never hold that
   24-hour JWT, while the slot's other cookies reach the browser for the host that set
   them. An upstream connection that stays idle for two minutes is closed, which also
   ends a quiet stream. Hosts outside the slot domain resolve normally and never reach
   the forwarder. An `http` URL on a slot host is not mapped, so the browser sends it to
   the real host itself, without the token, and the app's redirect to `https` then goes
   through the forwarder; plain `http` sent to the mapped port 443 fails the TLS
   handshake. A redirect off the slot is followed by the browser and carries neither
   the token nor the slot's cookies. If the forwarder stops, slot requests fail rather
   than going out directly, because the host mapping stays in place. The Playwright
   trace records every slot request as the browser made it, with its status and
   redirects, but not the token, because the token is added outside the browser. The
   browser process is
   launched without the `CF_ACCESS_*` variables. Every app runs the explorer with the
   `long` profile. With `bombadil` on, each app is also explored by Bombadil (see
   [Bombadil](#bombadil) for how it gets through Access). Setup checks the requested
   apps before it writes anything, and writes the user ID and database to `fuzz.json`
   before it inserts the user, so the final step deletes the user even when setup
   failed halfway. Before anything is uploaded, `scripts/secret-scan.mjs` searches every
   uploaded path for the service token's ID and secret and for every `CF_Authorization`
   value this job obtained for Bombadil, in plain, URL-encoded, JSON-escaped, and base64
   form. It looks inside trace archives, the report's embedded archive, gzip files, and
   each zstd frame of a Bombadil trace, and it walks every zstd frame to its end so a
   truncated frame cannot hide data. If it finds a value, or an archive it cannot read
   completely, the job uploads nothing. `fuzz/evidence.test.mjs` runs a failing
   exploration and a failing Bombadil run against a local Access-gated server and scans
   the paths the scan step lists together with their output, and the workflow test
   checks that those are exactly the paths the job uploads.
3. **File deduplicated issues** has `issues: write` and no environment secrets. It groups
   failure records by signature, keeps the smallest replay of each group, comments on an
   open `ui-fuzz` issue that carries the same signature marker (only markers in issues
   opened by `github-actions[bot]` count), and opens an issue otherwise. Text that came
   from the slot is placed in fenced blocks with HTML comments and review markers
   neutralized, and titles have mentions and markup removed.
4. **Propose fixes** runs only with `open_fix_prs`. It uses the `ai-review` environment,
   the `codex-auth` concurrency group, and the same login restore and refresh as
   [the AI review gate](ai-review.md). For each new issue, up to `max_fix_prs`, it adds a
   worktree of `origin/main` and confirms that Codex's sandbox can write that worktree
   but cannot write elsewhere, read the login or the agent's environment, or reach the
   network. Codex receives the failure record as delimited untrusted data. The workflow
   rejects an empty diff, a diff over 1,500 lines, and any change to `.github/`, agent
   configuration, staging or verification scripts, the mutation files, manifests, the
   lockfile, or env files. It then commits as GDG-chan, pushes `ui-fuzz/fix-<signature>`,
   and opens a **draft** pull request that refers to the issue. The pull request needs
   the required checks, a GDG-chan review through `E-code-review`, and a human merge;
   nothing enables auto-merge.

### What it needs

- `STAGING_ENABLED=true` and a successful deployment of the chosen slot.
- `staging` environment: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
  `STAGING_ROOT_SECRET`, `STAGING_ACCESS_CLIENT_ID`, `STAGING_ACCESS_CLIENT_SECRET`
  (already used by the staging deploy).
- For fix pull requests: the `ai-review` environment as described in
  [the AI review gate](ai-review.md), with a current Codex login. GDG-chan already has
  write access to code, issues, and pull requests.

### Replaying a staging failure locally

Mint a session with `node .github/scripts/ui-fuzz.mjs session --slot stg-N --apps <app>
--out <dir>` (needs the staging credentials above), export `UI_FUZZ_TARGETS`,
`UI_FUZZ_ACCOUNTS_URL`, `UI_FUZZ_DOMAIN` from `<dir>/fuzz.json`,
`UI_FUZZ_SESSION_FILE=<dir>/storage-state.json`, and the Access service token as
`CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET`, then run the issue's replay
command. Remove the user afterwards with `ui-fuzz.mjs cleanup --out <dir>`, also after a
`session` that failed. `session` refuses any target that is not an `https` origin on the
slot domain before it writes anything, and the staging spec refuses such a target
whenever the Access token is set. A loopback target
(`UI_FUZZ_TARGETS=app=http://127.0.0.1:PORT`) explores a local server without any of
this. To run the forwarder against local servers, as the evidence test does, serve them
over `https` under a `.test` domain and set `UI_FUZZ_LOCAL=1`, `UI_FUZZ_DOMAIN` to that
domain, `UI_FUZZ_LOCAL_UPSTREAM=127.0.0.1:PORT`, and `UI_FUZZ_LOCAL_CA` to the servers'
certificate. In that mode the forwarder dials only that loopback address, refuses a
domain outside `.test`, and Chromium resolves every other name to nothing; outside it,
a `.test` domain is refused.

### Data exposure

The fuzz user has no membership, so it sees what an anonymous or brand-new user sees
behind Access. The repository is public, and so are its issues; uploaded traces and
screenshots are readable by any signed-in GitHub user for seven days. Giving the fuzz
user a membership would expose copied production data in those places, so it needs
encrypted evidence and issue text that excludes page content first.

## Bombadil

[Bombadil](https://github.com/antithesishq/bombadil) 0.8.0 is pinned by version and
per-platform SHA-256 in `scripts/bombadil.mjs` and downloaded to
`local_data/pstack/tools/` (or taken from `BOMBADIL_BIN`). On a local test page it found
the same injected uncaught exception as the seeded explorer, and its `--reproduce`
replay reproduced it. It is the optional second explorer of the staging loop, not the
engine of the property specs, because:

- It has no seed option; a run is reproduced from its binary trace, best-effort, and
  the trace format changed in 0.8.0. The property specs must print a seed.
- One run drives one browser identity. The Wiki, PR, and Accounts properties need
  several signed-in actors in separate contexts within one sequence.
- Its specifications run in a restricted runtime against browser state only. The
  properties here also check server state: D1 rows, the page-access API seen by each
  actor, and the PR mock services that record every send.
- It has no setup hook for seeding fixtures per run, and `fuzz` and `shrink` are marked
  experimental.
- `--header` sends the Access service token with every request, including third-party
  subresources, and it has no proxy option, request hook, or way to pass Chrome flags
  or trust a certificate authority. A credential-injecting proxy would therefore have to
  intercept TLS in a browser it cannot configure, or serve the app from another origin,
  which changes the cookies, OIDC redirects, and URLs under test.

So the staging loop gives Bombadil a cookie instead of the service token. Per target,
`ui-fuzz.mjs access-cookie --domain <slot domain>` refuses a URL outside the same
Access scope, then sends one request with the service token, following no redirect,
and takes the `CF_Authorization` value Access sets. The cookie passed to
Bombadil has no `Domain` attribute, so the browser sends it only to that host. The step
masks the value in the job log and appends it to a file outside every uploaded path, and
the pre-upload scan searches the evidence for each value in that file. The wrapper
removes cookie and header values from what it prints and from its failure record,
because Bombadil prints them in its reproduce command; that record becomes the public
issue, so a replay needs the cookie supplied again. The JWT is valid for the Access
session duration (24 hours). Bombadil's decoded trace holds URLs, actions, and
screenshots, and the cookie is `HttpOnly`, so a page cannot copy it into a screenshot
through `document.cookie`. With strict service token authentication, Access issues no
cookie and the step fails for that app with that reason; Bombadil cannot run against
the slot in that mode.

Its default properties include `noHttpErrorCodes`, which also flags 4xx responses,
so expect noise on pages that probe for authentication.

## Limits

- The property specs check the invariants they state over the actions they model,
  within the step and time budget. They are not proofs; a passing run means those
  seeds found nothing.
- The explorer picks controls uniformly and favors repeating the last control; it does
  not use coverage feedback, so deep states that need a specific long sequence are
  found by the app models, not by exploration.
- The accessible-name check applies to controls an action touches, not to every
  control on a page.
- Staging exploration avoids destructive labels by pattern
  (`DESTRUCTIVE_CONTROLS`), which is a heuristic over English and Japanese labels.
- The staging loop and fix pull requests can only be exercised on GitHub; the scripts'
  logic is covered by `node --test .github/scripts/ui-fuzz.test.mjs`.
