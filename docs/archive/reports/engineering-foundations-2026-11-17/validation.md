# Foundation change validation, November 17, 2026

This is local evidence for the engineering changes. Hosted GitHub Actions has not
run this working tree. No deployment, production data migration, or external
message was performed.

| Check | Result | Evidence |
| --- | --- | --- |
| `pnpm lint` | VERIFIED, no warnings after dangling-link cleanup | `/tmp/gdgjp-poteto-lint-final.log` |
| `pnpm typecheck` | NOT VERIFIED on first invocation; Wiki native compiler exited with Bus error 10 | `/tmp/gdgjp-poteto-typecheck.log` |
| `pnpm typecheck --concurrency=3` | VERIFIED, 26 successful tasks, 13 cached | `/tmp/gdgjp-poteto-typecheck-retry.log` |
| Repository script suite | VERIFIED, 86 passed, zero skipped after the final review fix | `/tmp/gdgjp-poteto-script-tests-reviewed.log` |
| Final selector regression | VERIFIED, 17 passed after the review fix | `.github/scripts/changed-workspaces.test.mjs` |
| Installation doctor | VERIFIED; configuration and links only | `scripts/pstack.mjs` |
| ACL mutation proof | VERIFIED; bounded source/page checks and all six mutants caught | `.agents/skills/verify-acl-boundaries/scripts/verify.mjs` |
| `pnpm test` | NOT VERIFIED, full graph failed | `/tmp/gdgjp-poteto-test.log` |
| MCP isolated retry, two workers | VERIFIED, 20 tests passed after timeout in full graph | `/tmp/gdgjp-poteto-mcp-retry.log` |
| Accounts onboarding isolated retry, two workers | VERIFIED, three tests passed after failures in full graph | `/tmp/gdgjp-poteto-accounts-retry.log` |
| SNS architecture isolated retry, one worker | VERIFIED, four tests passed after failure in full graph | `/tmp/gdgjp-poteto-sns-architecture.log` |
| PR test colocation isolated retry, one worker | NOT VERIFIED; `app/features/assets/design.test.ts` has no adjacent subject | `/tmp/gdgjp-poteto-pr-colocation.log` |
| Browser regression suites and Orca product journeys | Not run; this change alters engineering infrastructure and documentation | [Coverage reference](../../../engineering/verification.md) |

The deterministic PR placement failure concerns files unchanged by this change.
Other suites were interrupted when Turbo stopped on failure. The successful
isolated retries do not establish a successful full test graph or prove the cause
of the original timeout. Do not raise timeouts or weaken architecture checks to
make this record green.

The installation regression creates broken links in temporary discovery directories.
All three new negative cases failed against the old doctor and pass with the new
implementation. The implementation also found twelve real obsolete links, which
were removed without recreating missing skills.

Affected-command tests execute the real entrypoint with a controlled child executable.
They check selected workspace arguments and propagate a nonzero child exit status.
They prove command selection and failure propagation, not a hosted build.

An independent reviewer checked the changed commands, comments, instructions, and
decision record. It found the hosted pstack regression-selection gap, which was
fixed and tested. The review used the parent model family. Cross-vendor review was
unavailable in this session; it is not claimed.

The generic skill-creator validator rejects the existing pstack
`disable-model-invocation` metadata. That tool cannot validate this vendored format.
The repository doctor validates the skill's YAML header, references, and discovery
links instead. No behavioral prompt evaluation was run for the wording change.

Temporary logs are local working artifacts and may expire. The committed test and
verifier entrypoints above reproduce the checks; this document records this run's
observations, not permanent proof that later changes pass.

## Comment policy follow-up

The user subsequently approved the default no-new-comments policy. The source
review was expanded to comment-related X posts and the expanded October 17 trust
post. [The correspondence table](sources.md) now names previously omitted topics
and marks their implementation status. It does not claim all posts were read.

| Check | Observed result | Evidence |
| --- | --- | --- |
| Comment-checker CLI tests in temporary Git repositories | 10 passed, zero skipped; independently repeated by reviewer | `/tmp/gdgjp-comment-gate-final.log` |
| Hosted and local CI selection tests | 42 passed | `/tmp/gdgjp-comments-ci-tests.log` |
| `pnpm lint` | Passed Biome and the working-tree comment gate | `/tmp/gdgjp-comments-lint.log` |
| Full-file inspection of new checker, its tests, and affected executor | Passed; no unreviewed code comments | `/tmp/gdgjp-comments-files.log` |
| `pnpm typecheck --concurrency=3` | 26 tasks successful, all 26 cached; Node-script check ran | `/tmp/gdgjp-comments-typecheck.log` |
| Installation doctor after mode wording changes | Passed | `/tmp/gdgjp-comments-doctor.log` |
| `pnpm run test --concurrency=2` | Script suite passed 97 tests; application graph failed at PR test colocation | `/tmp/gdgjp-comments-test.log` |

The application graph completed 23 tasks successfully with 16 cached. The PR failure
still names `app/features/assets/design.test.ts`. Wiki also reported a test-colocation
failure before Turbo interrupted its suite, so its full result remains unverified.
These application files were not changed by the comment-policy work. Browser suites
were not repeated because no product UI or behavior was changed. Hosted CI remains
unexecuted for this working tree.

Read-only review found no remaining defect in the checker, CI integration, or source
correspondence. It used the parent model family; no cross-vendor review is claimed.

## Application ownership follow-up

The implementation continues from commit `04fb9938`. The user's existing two
`plan-creator` deletions remain outside this unit. The canonical status table is
[sources.md](sources.md).

| Check | Observed result | Evidence |
| --- | --- | --- |
| Workspace boundary CLI | VERIFIED, 2,381 files and 9,090 literal import edges; zero violations | `/tmp/gdgjp-poteto-boundary-scan.log`; `scripts/check-workspace-boundaries.mjs` |
| Boundary and delivery selection tests | VERIFIED, 58 passed, zero skipped, including 13 checker cases | `/tmp/gdgjp-poteto-boundary-tests.log`; `.github/scripts/check-workspace-boundaries.test.mjs` |
| Wiki OAuth scoped behavior and ownership tests | VERIFIED, seven suites and 53 tests passed from the repository root | `/tmp/gdgjp-poteto-oauth-root-tests.log` |
| OAuth export ownership rejection | VERIFIED, original twelve forwards failed; named-alias, star, and import-then-export mutations failed | `/tmp/gdgjp-oauth-ownership-baseline.log`; `/tmp/gdgjp-oauth-ownership-mutations.log`; `apps/wiki/tests/architecture/google-oauth-ownership.test.ts` |
| `pnpm lint` | VERIFIED, Biome, comments, documentation, and workspace boundary checks passed | `/tmp/gdgjp-poteto-adoption-lint.log` |
| `pnpm typecheck --concurrency=1` | VERIFIED, 26 successful tasks, 24 cached; Node-script check ran | `/tmp/gdgjp-poteto-adoption-typecheck.log` |
| `pnpm run test --concurrency=2` | VERIFIED, 126 script tests with zero skipped; 25 successful tasks, eight cached | `/tmp/gdgjp-poteto-adoption-test.log` |

An independent agent reproduced a Node package-import alias bypass in the new
checker. Preserving its leading `#` and adding a NodeNext fixture fixed it. New
policy selection also exposed CI tests that assumed an absolute step index. Those
assertions now identify the named steps and retain the build-before-browser check.
The reviewer repeated the checker and CI tests after correction and reported no
remaining blocking finding. It used the inherited Codex model, not another vendor.

The semantic comment change removes two narration headers and the compatibility
API they described. It does not audit all existing comments. The OAuth and Drive
implementations are unchanged. Live Google OAuth, browser journeys, E2E suites,
and hosted CI were not run for this import-ownership unit. Computed imports and
`import.meta.glob` remain outside the new boundary checker. Broader application
layering and the remaining runtime work stay open in the correspondence table.

## Mandatory E2E phase

The user subsequently required E2E for every phase and a commit per phase. A new
runner tests current working source inside a disposable snapshot. It supplies
dummy credentials, relinks workspace dependencies, uses a private Worker registry,
and retains reports after cleanup. New SNS and Website journeys replace their
previously empty E2E commands. CI now selects all 17 configured suites.

Fresh-state runs exposed and repaired verification defects hidden by development
state: dependency filesystem access, a Wiki persistence override leaking into
other apps, excessive buffered migration output, SNS service configuration, and
unstable dev-server execution for additional built-preview applications. Earlier
failed runs remain under `local_data/pstack/e2e/`; they are not counted as passes.

Screen's deletion also exposed an application race. The Durable Object's deletion
event unmounted the component that owned its fetcher before that fetcher's
redirect completed. The redirecting mutation now uses Router-owned submission.
The browser regression deliberately holds the HTTP response until the deletion
event has removed that component, then requires navigation to the stage list.
Its design-source check passed.

`pnpm test:e2e -- --retries=0` completed all 17 suites with **179 passed, zero
failed, zero flaky, and one skipped**. The skipped case requires real Realtime SFU
credentials; local fixture success does not establish that integration. This run
is `local_data/pstack/e2e/2026-11-17T14-57-33-817Z-545d7fec/result.json`.
It records exit code zero and successful scratch cleanup. No browser results were
reused from cache. The log is `/tmp/gdgjp-poteto-phase1-e2e-accepted.log`.

The preview configuration removes remote AI, AI Search, Browser Rendering, and
Vectorize bindings, and forces local service resolution. These external features
are outside the fixture's coverage. The configuration regression rejects their
accidental retention. Local authoring must not upload fixture content to production.

Independent review used the inherited Codex model. A different vendor and the
optional `cursor-team-kit` deslop command were unavailable; local formatting,
comment checks, source review, and executable regressions were used.

## Phase 2 lifecycle and application boundaries

Phase 1 is committed in `0e128570`. Phase 2 deletes unused comment-editor
initialization and read-only props and their effects. Sharing is keyed by page,
aborts obsolete access/candidate loads, and preserves a close-time descendant
snapshot. Independent review found and repaired the reset-induced child-sync
regression before acceptance. The import gate now enforces feature-to-route and
runtime UI-to-server direction. Its 19 tests include prohibited imports, generated
route types, aliases, symlinks, mixed imports, and allowed type-only contracts.
The current application audit found no imports requiring a compatibility exemption.

The first actual Wiki E2E run passed 20 and failed four new specs. Their intercepts
missed Router's `.data` requests. The next run passed 23 and failed one new fixture
without required timestamps. These failures remain recorded in the preceding
`15-21-37` and `15-25-51` run directories. Tests now delay real responses without
forging Router's encoding. No timeout increase or assertion removal was used.

The accepted run `local_data/pstack/e2e/2026-11-17T15-27-12-218Z-ffe3c3d6/result.json`
has **24 passed, zero failed, zero skipped, and zero flaky**, without retries.
Scratch cleanup succeeded. Five new journeys cover formatted comment submission,
candidate-response cancellation, page-switch access isolation, post-close child
synchronization with persisted ACLs, and late mutation isolation.

`pnpm lint`, `pnpm typecheck --concurrency=1`, and
`pnpm run test --concurrency=2` passed. Type checks had 25 of 26 cached tasks;
workspace tests had 24 of 25 cached tasks. Independent lifecycle review separately
ran four Vitest files and 31 tests. Logs are `/tmp/gdgjp-poteto-phase2-*` and
`/tmp/gdgjp-phase2-independent-review.log`. External Google and deployed Workers
were not tested. This direct-import gate does not prove transitive browser safety.

## Phase 3 job lifecycle

Phase 2 is committed in `443846d8`. Actual SQL experiments identified stale
completion after reassignment, recovery after renewal, concurrent enqueue loss,
and same-host generation confusion. Completion and recovery now compare ownership
at the write. Payload transfer and source retirement share one transaction.
Atomic enqueue merges the database's current payload. Both Go runners send the
attempt captured for each job. HTTP boundaries validate it before business logic.

`node .agents/skills/verify-job-lifecycle/scripts/verify.mjs --mutation-proof`
passed on integrated main source. Its retained result is
`local_data/pstack/job-lifecycle/2026-11-17T15-31-26.460Z-70968f6b/result.json`.
Six Vitest files passed 41 tests both before and after mutations. Go passed 26 tests
in two runner packages with `-race -count=1`. All ten production mutations failed
their target assertions. Source remained unchanged and scratch cleanup succeeded.
The independent oracle checked 648 three-command sequences, 1,944 transitions,
and 27 clone request sequences. Additional tests exercise targeted write races,
three concurrent producers, and a 650-document union. These are finite bounds.
The SQLite proxy assumes D1's documented atomic ordered batch contract.

The verifier's own five regressions passed, including an actual changed-source
checkout returning exit 2 before execution. Independent review confirmed the
mutation acceptance gate and source coverage, and separately reran those tests.
The statechart and exclusions live in the verifier's properties reference.

Wiki E2E passed **25 tests with zero failures, skips, flaky results, or retries**
in `local_data/pstack/e2e/2026-11-17T15-30-31-951Z-0b200b59/result.json`. The new
HTTP case verifies authentication, generation 0 to 1 recovery, missing and stale
callbacks, current heartbeat and result, duplicate rejection, and actual stored
state. `pnpm lint`, `pnpm typecheck --concurrency=1`, and
`pnpm run test --concurrency=2` passed. Logs are `/tmp/gdgjp-poteto-phase3-*`.

Heartbeat and result requests now require `attempts`. Deploy the updated Wiki
server and both CLI runners together. No deployment or schema migration occurred.
External notifications, deployed D1, arbitrary sequence lengths, and every job
side effect remain outside this bounded result.
