# Source correspondence

The reviewed ideas below now have repository mechanisms and executed local evidence.
Delivery phases 1 through 4 are committed in `0e128570`, `443846d8`, `224bce80`,
and `192a491c`. Phase 4's commit hook passed all 17 configured E2E suites with
189 passed cases, no failures or flaky cases, and one explicit real-SFU skip.
Phase 5 connects verification and observations to delivery; its final full CI
also passed all 17 suites with the same counts and no retries. See
[validation](validation.md) for exact commands, source snapshots, failures, and
acceptance. These results do not establish every feature or production integration.

Reviewed on November 17, 2026 through Orca Browser. The video review used the English
automatic transcript and chapters, not a complete audiovisual review. X search was
`from:poteto comments`; long posts identified below were expanded. No claim is made
that every historical post or reply was read.

## Video

The source is [All Code Is Slop (Except Mine)](https://www.youtube.com/watch?v=O_zcc6Xl12g).

| Passage | Idea | Repository response | Scope and limits |
| --- | --- | --- | --- |
| 1:03 to 2:03 | Increase throughput while preserving quality through investment in the environment | Commit verifiable phases with isolated E2E, deterministic gates, reusable runtime and state verification, and engineering observations | No PR-volume target or claim of whole-repository correctness |
| 2:03 to 3:22 | Prioritize architecture, types, and deterministic checks; use prose for judgment | Enforce workspace and application import direction, parse runner wire data into schema-derived types, and run actual verifier commands in CI | Direct imports and selected contracts are covered; this is not a whole-API audit |
| 3:27 to 4:51 | Agents copy workarounds and established patterns | Delete OAuth forwarding APIs and unused editor APIs, repair sharing and menu lifetimes, fence runner generations, and remove forced-click test loops | Repairs follow demonstrated failures; no claim that all legacy workarounds were audited |
| 5:00 to 6:07 | Restrict APIs that require nuance; product code used replacement framework APIs instead of useEffect | Remove unused initialization effects and dependency suppressions; give sharing page ownership and open dialogs through the actual menu teardown event | No blanket React effect ban. Necessary framework lifecycle effects remain |
| 6:10 to 6:49 | Make runtime ownership obvious in directories and enforce dependency direction | Enforce public workspace exports, declared dependencies, feature-to-route direction, and runtime UI-to-server direction | Literal imports, aliases, and symlinks are covered. Computed and transitive imports are excluded |
| 6:56 to 9:35 | Comments can justify hacks; eliminate causes and replace prose with enforceable checks | Adopt default no-new-comments policy with exact exceptions, delete demonstrated compatibility paths and narration, and guard their ownership structurally | Necessary external and public API contracts remain. This is not a blanket deletion of historical comments |
| 9:40 to 10:45 | Review runtime evidence; provide user-facing feature maps and reusable verification CLIs | Add a reusable Accounts/Wiki stack, thirteen executed Orca journeys, source snapshots, action receipts, HTTP outcomes, screenshots, and cleanup proof | Covers selected local journeys; Google, production services, ingestion, and external sync remain excluded |
| 10:50 to 11:25 | Use TLA+ models or Lean proofs for costly state/algorithm bugs | Run bounded ACL and real-SQL runner verification, independent properties, deliberate mutations, source-drift rejection, and a statechart | Finite bounds and D1 transaction assumptions are explicit. No unbounded TLA+ or Lean claim |
| 11:35 to 11:44 | UI property-based testing can find interaction bugs; Bombadil is one example | Add seeded browser action sequences over two roles, two pages, two seeds, and desktop/mobile viewports | Forty-eight actions check display persistence, sharing isolation, and unchanged authorization; they exposed and now guard mobile menu/dialog ownership. This is bounded sampling; Bombadil is an example, not a required dependency |
| 11:51 to 13:16 | Spend substantial effort on verification and review artifacts, including statecharts | Run real checks and publish failures as well as successes | Job statechart and mutation evidence added. No token quota or token instrumentation; the reported 70% is an observation, not a universal target |
| 13:32 to 15:01 | Assess throughput together with reverts and user performance | Add a reusable report over real Git history, deployment workflow attempts, local CI outcomes and cache/skips, and actual synthetic browser timings. Hosted CI collects deployment history | Production RUM is unavailable. Workflow attempts are not per-app releases; no speedup or causal revert rate is inferred |
| 15:11 to 17:04 | Build foundations before automating loops; verify full builds as a user | Select real verifiers and their negative regressions in local/hosted delivery; use the same isolated E2E runner and retain failures and observations | Hosted changes were tested locally, not executed on GitHub. No deployment, automatic merge, or production fuzzing was requested |

## X posts

| Source | Reviewed content | Repository response |
| --- | --- | --- |
| [October 29](https://x.com/poteto/status/2115644484226777581) | Comments were banned because agents justify hacks with them | Default comment policy adopted with necessary exceptions |
| [October 16](https://x.com/poteto/status/2110758788525621282) | Expanded post recommends auditing comments and replacing them with stronger types, APIs, and lint | The gate rejects new comments; semantic repairs remove OAuth forwarding, unused lifecycle APIs, suppressions, and narration. Necessary exceptions remain explicit |
| [October 14 clarification](https://x.com/poteto/status/2110229505864552902) | Keep comments that explain real browser quirks | External constraints remain eligible for reviewed exceptions |
| [October 17](https://x.com/poteto/status/2111133080526495985) | Expanded post orders improvements, checks, prose, and human review; recommends studying prior corrections and prototyping questions | Selected actual correction history is mined in [the correction report](corrections.md), then encoded in ownership, isolation, transaction, UI, and pagination regressions. Private Slack, old transcripts, and all review feedback were not audited |
| [November 15](https://x.com/poteto/status/2121646643124809848) | Expanded post warns that minimal patches spread as copied patterns | Root-cause guidance updated in both mode and leaf skill |
| [November 16](https://x.com/poteto/status/2122067662373269960) | Timeline embeds a truncated older statement about engineering responsibility | Do not treat it as a fully read older post |
| [November 14](https://x.com/poteto/status/2121417335055831368) | Return with a tangible result instead of an avoidable question | Implement reversible changes and show evidence |

The correspondence covers every concept identified in the reviewed transcript and
posts. Tool names such as Bombadil, TLA+, and Lean are examples. This repository
uses the tools that execute its actual SQL and browser behavior at explicit bounds.
The speaker's token proportions and PR counts are observations, not quotas.

## Documentation follow-up

An Orca X search for `from:poteto (docs OR documentation OR markdown)` found
[the October 13 writing post](https://x.com/poteto/status/2109885001584292091), read
expanded, and [its clarification](https://x.com/poteto/status/2109899035788345380).
The author prefers writing material that helps her think, while allowing agents
to help with recording and routine organization. This is her writing preference;
it does not prohibit the document organization requested by this repository's user.

The reviewed posts do not prescribe a folder taxonomy. The repository's separation
of guides, references, plans, and historical records is a local decision based on
the actual documents and consumers. It is not presented as a layout specified by poteto.
