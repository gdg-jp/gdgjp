# Verification reference

Run commands from the repository root. Choose checks for the behavior being changed;
the repository's required validation commands remain in [AGENTS.md](../../AGENTS.md).

## Automated checks

| Check | Entry point | What it establishes | Limit |
| --- | --- | --- | --- |
| Skill installation | `node scripts/pstack.mjs doctor` | Manifest skill headers, discovery links, references, model configuration structure | Does not run models or validate prompt decisions |
| Repository scripts | `node --test .github/scripts/*.test.mjs` | Script behavior and workflow contracts | Some CLI tests require a built Go binary |
| Types | `pnpm typecheck` | Node script and workspace type contracts | Does not establish runtime behavior |
| Static conventions | `pnpm lint` | Biome, comment policy, documentation links, and workspace boundaries | Does not establish product correctness |
| Workspace boundaries | `pnpm check:boundaries` | Rejects literal imports across application ownership and bypasses of declared public workspace exports | See [scope and limits](workspace-boundaries.md); application feature layering still needs its own tests |
| New code comments | `pnpm check:comments` | Rejects new or edited first-party JS/TS/Go comments without exact reviewed exceptions | Existing comments and other languages still need semantic review; see [the policy](comments.md) |
| Unit and architecture tests | `pnpm test` | Repository scripts and workspace test assertions | Coverage depends on each suite's assertions |
| Mutation tests | `pnpm test:mutation` (diff against `main`), `pnpm test:mutation:full` (every mutant, kill matrix) | Unit tests detect each mutant of changed shared RP auth and Accounts auth/OAuth code, or the mutant is accepted with a reason | Unit tests only, against mocked `openid-client` and Better Auth; mutants of unchanged code and test-only edits are not rechecked |
| Browser regressions | `pnpm test:e2e` | Existing automated browser journeys | Does not establish external service or production behavior |
| Seeded UI sequences | Wiki `tests/e2e/ui-properties.spec.ts`, through the isolated E2E runner | Two seeds and two viewports execute page switches, sharing, display persistence, and authorization invariants | Forty-eight generated actions are a bounded regression sample, not all interactions |
| ACL bounded verification | `node .agents/skills/verify-acl-boundaries/scripts/verify.mjs --mutation-proof` | Independent audience properties over the enumerated inputs, with six deliberate production-expression mutations rejected | Not an unbounded formal proof or HTTP authorization audit |
| Runner lifecycle verification | `node .agents/skills/verify-job-lifecycle/scripts/verify.mjs --mutation-proof` | Real SQL against an independent bounded state machine, targeted races, Go wire tests, and ten deliberate production mutations | Assumes D1's transaction contract; does not prove arbitrary sequences or deployed behavior |

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

Hosted E2E delegates to the same isolated runner used locally and uploads its
retained evidence tree. Fixture variables, migrations, and builds have one owner.
Local CI records [engineering observations](observations.md) even after failed
checks. Hosted observations collect Git and actual deployment workflow attempts.
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

Ingestion, external sync, AI search, and actual Google authentication remain outside
these maps. Other applications' Playwright suites do not imply an Orca feature map
exists for them. The agents-local testing skill covers its specialized
VM and authorization environment; it is not a general product browser check.

## Evidence and completion

Use `VERIFIED`, `NOT VERIFIED`, or `INCONCLUSIVE` for each claimed outcome.
A skipped check, a prerequisite check, and a cached test result must be identified
as such. Keep live integrations separate from local fixtures.

Runtime evidence goes under the verifier's `local_data/pstack/` run directory.
Local CI writes metrics under `.turbo/ci-metrics/`. Those files are ignored working
artifacts. Commit a concise explanation and source pointers when the decision needs
to survive the run; do not commit secrets, build output, or browser reports.
