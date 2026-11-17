# pstack setup verification

The setup covers all 58 existing pstack workflows plus the two generated project
verification skills. The model budget remains `medium`. Configuration and
support files are local to the repository.

## Verified results

| Check | Result | Evidence |
| --- | --- | --- |
| Cross-harness skill discovery, direct references, and nine model roles | Pass for 60 skills | `local_data/pstack/doctor.log` |
| Repeatable setup, existing-file preservation, broken links, invalid model choices | Five tests pass, included in existing script-test CI discovery | `local_data/pstack/setup-tests.log` |
| Shared ACL caller permission and channel audience containment | 7,290 source and 338,985 page inputs pass within the stated finite bounds | `local_data/pstack/acl-mutation.log` |
| ACL checker failure detection | All six real-expression mutations caught; baseline restored | `local_data/pstack/acl-mutation.log` |
| Wiki viewer journey through Orca Browser | Pass | `local_data/pstack/wiki/2026-11-17T11-50-13-786Z-ad65010d/proof.json` |
| Wiki temporary server and browser cleanup | Scratch directory removed, test tab/profile absent, port released | Same run's `result.json`, `proof.json`, and `local_data/pstack/wiki-doctor.log` |
| Lint, typecheck/build, script tests, and Go checks in `ci:quick` | Pass, including cached workspace build/typecheck results | `local_data/pstack/ci-quick-final.log` |
| Full workspace unit tests | Fail on existing PR test colocation | `local_data/pstack/ci-quick-final.log` |

The PR failure is `apps/pr/app/features/assets/design.test.ts`, which has no
matching implementation module. The same architecture test fails in a detached
checkout of unchanged base `d4f18a5694052c01b69d0a9267698e97ce2d145f`.
See `local_data/pstack/ci-baseline-pr-colocation.log`. No product code was changed.
The checked commit and unchanged PR application diff are recorded separately in
`local_data/pstack/ci-baseline-pr-provenance.json`.

The evidence directory is local and ignored by Git. It survives helper cleanup.
A fresh clone regenerates evidence by following the setup and verification skills.

## Wiki scope

The Orca run changed sharing through the author's real Share dialog, then used
an isolated test member identity. Duplicate, Move to, and Move to Trash were
visibly disabled. Clicking Small text changed the article's display state.
Production duplicate and move-target requests returned 403. The Share mutation's
POST returned 200 in Orca's network observation.

The screenshot was visually inspected. The user's existing Wiki tab and browser
profile were preserved. The test-profile deletion command returned a protocol
cleanup error, but a subsequent state read confirmed the profile was absent.
No duplicate delete was attempted.

Only the viewer journey is verified. The full redaction, sharing-dialog, and
page-display journeys are mapped but not yet verified. This does not establish
production deployment behavior, Google sign-in, or full Wiki feature coverage.
Earlier failed Playwright attempts remain as failed evidence. After the user's
browser instruction, the completed proof used Orca Browser.
The member-load browser record also contains React hydration error #418. The
completed viewer assertions passed; this setup does not claim the page is free
of preexisting application warnings or rendering defects.

## Formal verification scope

The ACL skill exhaustively executes production TypeScript within its documented
finite input space. Its expected audience is specified independently. This is
bounded exhaustive verification, not an unbounded mathematical proof or SMT proof.
Source hashes and the reviewed commit prevent unnoticed verification drift.
See `.agents/skills/verify-acl-boundaries/SKILL.md` for the bounds and exclusions.

## Decisions and principles

- **Build the Lever:** add repeatable setup, doctor, isolated server, and ACL checks.
- **Prove It Works:** run the generated checks, drive the real Wiki in Orca, and
  retain action receipts, a screenshot, HTTP results, and cleanup evidence.
- **Laziness Protocol:** retain existing skills and share one model configuration
  through relative links rather than maintaining three copies.
- **Never Block on the Human:** preserve the already approved medium budget and
  Claude model preferences without asking the same questions again.
- **Attack the Premise:** after browser actions failed repeatedly, test whether the
  development page was stable and switch to built preview for the successful run.

## Review limits

A separate Claude CLI reviewer ran as `claude-opus-5-5`. Its first review exposed
real adapter and discovery defects, which were corrected. The final review result
is retained in `local_data/pstack/claude-review-final.json`.
The final reviewer identified three remaining evidence-recording gaps. Request
identity details, browser cleanup state reads, and baseline commit provenance were
added afterward. Retrospectively recorded request metadata is labeled as such.
The native Codex transcript is not exposed to that reviewer, so the audit covers
files and saved tool evidence rather than an independent full transcript review.

Use `/maintain-verification-skill` to maintain the Wiki feature map and
`/maintain-formal-verification-skill` to review ACL verification after source changes.
