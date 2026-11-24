# Verification reference

Run commands from the repository root. Choose checks for the behavior being changed;
the repository's required validation commands remain in [AGENTS.md](../../AGENTS.md).

## Automated checks

| Check | Entry point | What it establishes | Limit |
| --- | --- | --- | --- |
| Skill installation | `node scripts/pstack.mjs doctor` | Manifest skill headers, discovery links, references, model configuration structure | Does not run models or validate prompt decisions |
| Repository scripts | `node --test .github/scripts/*.test.mjs` | Script behavior and workflow contracts | Some CLI tests require a built Go binary |
| Types | `pnpm typecheck` | Node script and workspace type contracts | Does not establish runtime behavior |
| Static conventions | `pnpm lint` | Biome, comment policy, documentation links, workspace boundaries, application conventions, and effects | Does not establish product correctness |
| Workspace boundaries | `pnpm check:boundaries` | Rejects literal imports across application ownership and bypasses of declared public workspace exports | See [scope and limits](workspace-boundaries.md); application feature layering still needs its own tests |
| Application conventions | `pnpm check:apps` | Rejects hand-edited or stale `schema.sql`, misnumbered migrations, unregistered relying parties, conflicting dev ports, unscheduled or undispatched crons, model use in LLM-free Workers, and misplaced tests | Lexical and configuration-level; see [scope and limits](app-conventions.md) |
| Effects and timers | `pnpm check:effects` | Rejects new `useEffect`, `useLayoutEffect`, and raw timer calls in product code outside the shared hooks, against a shrink-only per-file baseline and exact allowances | Counts calls per file and API, so a replaced call in the same file is not distinguished; see [the policy](effects.md) |
| New code comments | `pnpm check:comments` | Rejects new or edited first-party JS/TS/Go comments without exact reviewed exceptions | Existing comments and other languages still need semantic review; see [the policy](comments.md) |
| Unit and architecture tests | `pnpm test` | Repository scripts and workspace test assertions | Coverage depends on each suite's assertions |
| Mutation tests | `pnpm test:mutation` (diff against `main`), `pnpm test:mutation:full` (every mutant, kill matrix) | Unit tests detect each mutant of changed shared RP auth and Accounts auth/OAuth code, or the mutant is accepted with a reason | Unit tests only, against mocked `openid-client` and Better Auth; mutants of unchanged code and test-only edits are not rechecked |
| Browser regressions | `pnpm test:e2e` | Existing automated browser journeys | Does not establish external service or production behavior |
| UI property specs | `apps/*/e2e/ui-properties.spec.ts` and Wiki `tests/e2e/ui-properties.spec.ts`, through the isolated E2E runner; [reference](ui-properties.md) | Seeded action sequences over each app's model (Wiki, PR, Accounts, Tinyurl, OST, Screen, Pay) keep their invariants and the generic ones: no console errors, uncaught exceptions, 5xx responses, or dead ends, and an accessible name on every touched control. A failure prints its seed, a shrunk replay, and a signature | Fixed seeds and a short budget on pull requests; a passing run covers only the modeled actions within the budget |
| UI property long budget | [`ui-properties.yml`](../../.github/workflows/ui-properties.yml), weekly and manual | Five times the steps, four dated seeds per spec | Same models; dated seeds change daily, so reproduce with the printed seed |
| UI property mutation proof | `node packages/ui-properties/scripts/mutation-proof.mjs --mutations packages/ui-properties/mutations/<app>.json` | Each listed deliberate defect, applied to a disposable copy, is caught by a property failure of the expected check | Only the listed mutations; fragments go stale when source changes; not run by CI |
| Staging UI fuzz | [`ui-fuzz.yml`](../../.github/workflows/ui-fuzz.yml), manual only | Black-box exploration of one deployed slot as a membership-less user, deduplicated issues, optional draft fix pull requests | Generic invariants only; runs only on GitHub with staging credentials; the script logic is tested by `node --test .github/scripts/ui-fuzz.test.mjs` |
| ACL bounded verification | `node .agents/skills/verify-acl-boundaries/scripts/verify.mjs --mutation-proof` | Independent audience properties over the enumerated inputs, with six deliberate production-expression mutations rejected | Not an unbounded formal proof or HTTP authorization audit |
| Runner lifecycle verification | `node .agents/skills/verify-job-lifecycle/scripts/verify.mjs --mutation-proof` | Real SQL against an independent bounded state machine, targeted races, Go wire tests, and ten deliberate production mutations | Assumes D1's transaction contract; does not prove arbitrary sequences or deployed behavior |
| Accounts client revocation model | `node .agents/skills/verify-accounts-client-revocation/scripts/verify.mjs --mutation-proof` | An Alloy 6 model of the membership triggers, the developer console, and token issuance, checked over every interleaving within its bounds, with six deliberate model mutations rejected | Checks a hand-written model tied to the code by hashes and anchors; assumes Better Auth behavior read from the installed version; no open findings; needs Java; local and hosted CI run it when a covered source changes |

The local CI entry points are `pnpm ci:quick`, `pnpm ci:full`, and
`pnpm ci:staged`. The staged command selects work from the index but runs against
the working tree. It is not evidence of an isolated staged snapshot.
Hosted workflow selection lives in `.github/scripts/changed-workspaces.mjs`.

Mutation testing uses [mutator](https://github.com/mizchi/mutator) and needs Node 24.
Each project's `mutator.config.json` names the mutated sources, all of which are
critical regions: a surviving or unreached mutant fails the run. The hosted
**Mutation tests** job runs `scripts/run-mutation.mjs --since` the pull request base
for the projects whose files changed, so it judges only mutants in the diff. A full
run exits 2 while known gaps remain; read its kill matrix as review candidates, not
as a deletion list.

When no input can tell a surviving mutant from the original, accept it from the
project directory with `pnpm exec mutator accept <key> --reason "equivalent: <why>"`.
Keys are in `.mutator/report/mutation.json` and in the job's annotations. The reason
must name why no caller can observe the change. Review `mutator.accepted.json` like
code and remove entries that a later run reports as killed or stale. Do not accept a
mutant only because the test that would kill it is inconvenient to write.

`pnpm test:e2e` copies the current working source into a disposable workspace,
relinks shared packages inside it, supplies deterministic test credentials, and
creates a private Worker registry. It excludes developer secrets, persistence,
builds, caches, and authentication storage state. Relevant staged application
checks use the same runner. The source tree's database is not the test fixture.
The snapshot record includes file hashes and submodule revisions.

Use `pnpm test:e2e --workspace @gdgjp/wiki -- tests/e2e/access-control.spec.ts`
to select one suite and forward Playwright arguments. The runner keeps JSON proof
even when another reporter is requested. Missing browser proof is a failure.
The final `isolated-e2e-result` line identifies retained evidence, per-suite
passed/failed/skipped/flaky counts, and whether scratch cleanup completed.

Dev-server journeys use the same Vite API as React Router's command. Their
filesystem access includes the snapshot and its installed dependency store.
Application code and local persistence remain inside the snapshot. Built-preview
journeys use freshly built artifacts from that snapshot instead.

The ACL verifier returns 2 for a stale source record even if the bounded properties
pass. Review the policy, oracle, and bounds before updating its hashes. A stale
record must not be hidden by a CI flag that allows source drift.

The runner verifier also rejects stale source hashes with exit 2. It uses a
disposable snapshot for deliberate mutations. See its
[properties and statechart](../../.agents/skills/verify-job-lifecycle/references/properties.md)
for finite bounds, adversarial interleavings, and exclusions. The Wiki HTTP E2E
also leases an expired job through the actual Worker and checks old, current,
missing, and duplicate callback generations against persisted state.

Runner heartbeat and result requests now require the job's captured `attempts`
generation. Missing generations return 400; stale generations return 409. Roll out
the Wiki server and updated Wiki/PR CLI runners together. This change has no schema
migration. Local verification does not mean that a coordinated deployment occurred.

The hosted **Engineering checks** job runs Node script types, the installation
doctor, and the ACL mutation proof for engineering inputs and ACL changes. Local
quick/full checks include the same verifiers; staged selection includes them for
relevant paths. The actual selectors and runner commands, rather than this table,
determine which checks run.

The separate runner-lifecycle job runs the verifier's own negative regressions,
the real-code bounded checks, Go race tests, and the mutation proof. Quick local
checks omit mutations; full and hosted checks include them. Selection includes
every source named in the reviewed coverage record. Source drift is a failure.

[Accounts client
revocation](../../.agents/skills/verify-accounts-client-revocation/SKILL.md) model-checks a
design with Alloy 6. The skill gives its properties, bounds, and assumptions, and its
`references/findings.md` lists breaks of the product code that the model found.
`scripts/verification/alloy.mjs` pins Alloy by version and SHA-256, downloads it to
`local_data/pstack/tools/`, and parses its results. `scripts/verification/alloy-skill.mjs`
holds what an Alloy verifier needs besides its model: source hashes, code anchors, call-site
counts, expected results, model mutations, and the `--record` step. A new Alloy model needs
a model file, a `coverage.json`, and a script that supplies its mutations and its narration
of a trace. The verifier exits 2 without running when covered code changed.
`.github/scripts/changed-workspaces.mjs` selects a verifier when a file its `coverage.json`
covers changes (its sources, anchor files, and census roots, or the shared Alloy scripts),
and `pnpm ci:quick`, `pnpm ci:full`, the staged pre-commit run, and the hosted `alloy` job
then run it with `--mutation-proof`.

Hosted E2E delegates to the same isolated runner used locally and uploads its
retained evidence tree. Fixture variables, migrations, and builds have one owner.
Local CI records [engineering observations](observations.md) even after failed
checks. Hosted observations collect Git and actual deployment workflow attempts.
On `main` they also collect Cloudflare production RUM when its token is configured.
Missing metrics and production RUM remain explicit gaps.

## Agent-driven runtime journeys

Use [Verify Accounts and Wiki](../../.agents/skills/verify-platform/SKILL.md) for
local OIDC, authoring, search, administration, and the existing reading journeys.
Use [Verify Wiki](../../.agents/skills/verify-wiki/SKILL.md) for its smaller reading
fixture. Drive either instance with Orca Browser. The helper's doctor and readiness probe
are prerequisites, not evidence that the following journeys passed.

| Existing journey | Recipe |
| --- | --- |
| Read-only viewer permissions | [Viewer](../../.agents/skills/verify-wiki/features/viewer.md) |
| Markdown copy excludes hidden content | [Redaction](../../.agents/skills/verify-wiki/features/redaction.md) |
| Sharing overview and permissions | [Sharing](../../.agents/skills/verify-wiki/features/sharing.md) |
| Page display settings | [Page menu](../../.agents/skills/verify-wiki/features/page-menu.md) |

These recipes exist; their presence does not mean they ran in a particular change.
Report the fixture identity, user action, expected and observed result, and evidence
path for each executed journey. Do not include authentication cookies in evidence.

The platform [feature map](../../.agents/skills/verify-platform/features/README.md)
also names Accounts sign-in, continuation, local OIDC, sign-out, Wiki authoring,
comments, keyword search, runner administration, and space settings. Its
[coverage record](../../.agents/skills/verify-platform/coverage.json) gives the
executed source snapshot and evidence for each journey. Authentication uses a real
local Accounts database session, not a Google login. The public new-page form does
not itself require authentication; publishing and user settings do.

Knowledge synthesis, external sync, AI search, and actual Google authentication remain
outside these maps; runner-backed translation is mapped below. Other applications' Playwright suites do not imply an Orca feature map
exists for them. The agents-local testing skill covers its specialized
VM and authorization environment; it is not a general product browser check.

[Verify the event and community apps](../../.agents/skills/verify-apps/SKILL.md) gives
screen, OST, MC, Deck, Roulette, Img, Meet, the website, Live Check-in, and Roster each a
[feature map](../../.agents/skills/verify-apps/features/README.md) and one driver,
`verify-apps.mjs --app <names>`, with its own `node --test` suite. The driver serves a
disposable snapshot with fresh D1 and Durable Object state, seeds OST, runs the fake
obs-websocket for Deck, and signs in fixture identities through each app's local-only
`/dev/login` (minted Auth.js cookies for Live Check-in). Its
[coverage record](../../.agents/skills/verify-apps/coverage.json) lists every mapped journey.

All 123 mapped journeys are `VERIFIED`; 39 more are outside the maps, each with its reason in
the app's map.

| App | Verified / mapped | Outside | Limits |
| --- | --- | --- | --- |
| screen | 13 / 13 | 4 | No SFU or media devices: video, talkback, noise suppression, and the mini window are outside |
| OST | 12 / 12 | 0 | Desk rotate uses `orca mouse` drags |
| Img | 14 / 14 | 6 | Transform fidelity and the CLI Bearer API are outside |
| Meet | 10 / 10 | 7 | Every Google API call is outside; meetings are seeded into local D1 |
| Roster | 10 / 10 | 3 | Proof of concept |
| Roulette | 14 / 14 | 4 | Sound, haptics, and random effects are outside |
| Deck | 22 / 22 | 5 | Fake OBS only; hold and push-to-talk presses use `orca mouse` |
| MC | 18 / 18 | 6 | OBS audio output and the autoplay unlock are outside; when the player clock reads `stalled`, remaining-time, loop-gap, and clip-end readings are not observable (restart, loop, and common-clip rows record this) |
| Website | 2 / 2 | 2 | TinyURL delegation is outside under Vite |
| Live Check-in | 8 / 8 | 2 | connpass and camera scanning are outside |

`--accounts` composes the apps with the platform stack's Accounts. Real OIDC sign-in reached
the local authorize endpoint and returned through each callback for every app. Accounts seeds
no Live Check-in client, so the driver inserts a local `live-checkin` OAuth client row into the
platform Accounts D1 when both are selected.

The Wiki map gained runner journeys with a local fake runner speaking the real runner HTTP
API: an English "translate now" request completed and shown on the page, and the runner
status page (see [runner jobs](../../.agents/skills/verify-platform/features/runner.md)).
Synthesis from sources, agent requests on agent-authored pages, external sync, AI search,
and actual Google authentication remain outside: they need an LLM, staged source documents
or an agent-authored fixture, external services, or Workers AI and Vectorize.

The delivery and operations apps each have their own skill and feature map:
[PR](../../.agents/skills/verify-pr/SKILL.md),
[Pay](../../.agents/skills/verify-pay/SKILL.md),
[SNS](../../.agents/skills/verify-sns/SKILL.md),
[Connpass](../../.agents/skills/verify-connpass/SKILL.md),
[Scheduler](../../.agents/skills/verify-scheduler/SKILL.md), and
[TinyURL](../../.agents/skills/verify-tinyurl/SKILL.md). They share one driver,
`node scripts/verification/app-stack.mjs --app <name> --doctor | --serve`, tested by
`node --test scripts/verification/app-stack.test.mjs`. It serves a disposable snapshot
on the 6161-6169 block (apart from `pnpm test:e2e`), applies each skill's seed, signs in
through the app's `/dev/login`, and attaches to a running verify-platform stack with
`--platform` when Accounts is needed. External sends go only to local fakes: pr's own
sns/tinyurl/connpass/img fakes and a Discord capture server, a closed loopback port for
X in sns, and absent credentials elsewhere, which the driver checks before start. Each
skill's `coverage.json` lists every mapped journey with its status and evidence.

With `--platform`, the driver also registers the stack's callback and post-logout URLs on
that Accounts' OAuth client before the app starts, because Accounts caches trusted clients
in memory after first use. Every mapped journey was executed against the working tree on
2026-11-24; none remains unexecuted.

| App | Verified | Failed (product defect) | Outside the map |
| --- | --- | --- | --- |
| PR | 22 of 23, including no send before approval, stale-version refusal, own-chapter target approval, a simultaneous double press creating one post, mail held until its time, connpass page, assistant, images and kit, live posts, listings, metrics, learning, and real Accounts sign-in | Runner admin: any chapter user opens `/admin/runner` and sees every chapter's jobs | Real sns/tinyurl/connpass/img/X/Discord, the OCI runner, Wiki contacts import |
| Pay | 20 of 20, including Google connection guards stopped before Google and real Accounts sign-in | None in the map; receipt upload sends the file to Gemini with an empty key (confirmed at module level, not run) | Receipt upload, Google OAuth, Drive, Sheets, Picker |
| Connpass | 17 of 17, including 66 read-deny, 57 write-deny and 24 validation requests with no job created, and a real Accounts bearer token | None in the map; a job whose browser fails to launch stays `running` (confirmed with a unit-level probe) | Every authorized request that reaches connpass.com or Luma |
| Scheduler | 14 of 17, including real Accounts sign-in and sign-out | Anonymous Update 403 (cookie path misses `/e/<id>.data`); no visible validation message; event page overflows at 390 px | Clipboard, launcher links |
| TinyURL | 22 of 24, including the custom-domain gateway handler and real Accounts sign-in | Another chapter deletes any tag; the tag delete dialog sends no request | Click analytics, OGP fetch, image upload success, domain connect, CLI with a token, installer |
| SNS | 25 of 28, including CLI journeys with real Accounts tokens and publishing that fails safe before X | X account revoke dialog sends no request; contributor search 500s and replaces Settings; CLI media without `sortOrder` 500s | Real X, cron, importer workflow, link previews; tag-handle orphan post confirmed over the CLI |

## Evidence and completion

Use `VERIFIED`, `NOT VERIFIED`, or `INCONCLUSIVE` for each claimed outcome.
A skipped check, a prerequisite check, and a cached test result must be identified
as such. Keep live integrations separate from local fixtures.

Runtime evidence goes under the verifier's `local_data/pstack/` run directory.
Local CI writes metrics under `.turbo/ci-metrics/`. Those files are ignored working
artifacts. Commit a concise explanation and source pointers when the decision needs
to survive the run; do not commit secrets, build output, or browser reports.

`pnpm verification:summary` (`scripts/verification-summary.mjs`) collects those files,
including screenshots, into one JSON and Markdown summary that lists missing sources as
missing; hosted CI publishes the same summary for each pull request, and the
[AI review](ai-review.md#verification-evidence) reads it.
