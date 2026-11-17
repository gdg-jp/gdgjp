# Engineering changes grounded in verification

## Sources and interpretation

Reviewed on November 17, 2026 through Orca Browser:

- Lauren Tan's [All Code Is Slop (Except Mine)](https://www.youtube.com/watch?v=O_zcc6Xl12g).
  The review used the English automatic transcript and chapter descriptions, not
  a complete audiovisual review. Automatic transcription contains name errors.
- [The quick-fix post](https://x.com/poteto/status/2121646643124809848), including its
  expanded text. The argument is that agents copy existing workarounds, so repairing
  the cause can justify a larger change.
- [The engineering responsibility post](https://x.com/poteto/status/2122067662373269960)
  on the profile timeline. The embedded older post was truncated there.
- [The tangible-results post](https://x.com/poteto/status/2121417335055831368)
  on the profile timeline.
- [The comment-audit post](https://x.com/poteto/status/2110758788525621282), expanded,
  [the comment-ban post](https://x.com/poteto/status/2115644484226777581), and
  [the necessary-comment clarification](https://x.com/poteto/status/2110229505864552902).
- [The trust-priority post](https://x.com/poteto/status/2111133080526495985), expanded.
  It orders codebase improvements, static checks, prose, and human review, and
  recommends learning from actual corrections rather than accumulating instructions.

The talk prioritizes code structure and deterministic checks at 2:03, dependency
boundaries at 6:10, enforceable corrections at 6:56, runtime feature maps at 9:40,
bounded models and proofs at 10:50, and foundations before automation at 15:11.
These are the reasons for the changes below. The speaker's throughput and revert
figures describe her team; they are not targets or measurements for this repository.

The local interpretation is to remove causes that agents would otherwise copy,
make important constraints executable, and review evidence of actual behavior.
The user approved a default prohibition on new comments with reviewed exceptions.
See [the comment policy](../../engineering/comments.md). The useEffect restriction remains a framework-specific
example; this repository has not supplied replacement APIs that justify that ban.

[The source correspondence](../../archive/reports/engineering-foundations-2026-11-17/sources.md) distinguishes reviewed ideas, implemented
changes, and missing work. It is not an exhaustive audit of every @poteto post.

## Confirmed gaps and changes

The baseline is `bff471dd88ba048639f22200602aa461d3cc7ca8` plus the existing working
tree deletion of `.claude/skills/plan-creator/`. That deletion is outside this work.

| Area | Confirmed gap | Change |
| --- | --- | --- |
| Skills | Upstream README directed contributors to nonexistent generators and global model settings | Replace it with the local entry guide and canonical configuration paths |
| Skill discovery | Twelve links referenced removed skills | Remove obsolete links and make the doctor reject dangling discovery links |
| Coding principle | The local simplicity skill equated simplicity with a small diff | Prefer a complete root-cause solution, migrate callers, and delete obsolete paths |
| Documentation | An old migration's exclusions appeared in the general architecture guide | Label the historical scope and separate it from current ownership |
| Verification | Existing ACL and installation checks were absent from automatic selection | Connect existing checks to CI instead of inventing replacement verifiers |
| CI | Affected package detection and handwritten task lists diverged, omitting connpass checks | Execute selected workspace tasks from detector outputs |
| Runtime evidence | The Wiki skill covers only four journeys | Publish coverage and exclusions without claiming whole-app verification |

See [the verification reference](../../engineering/verification.md) for commands and limits and
[the decision record](../../archive/reports/engineering-foundations-2026-11-17/decisions.tsv) for execution checkpoints. The
[validation record](../../archive/reports/engineering-foundations-2026-11-17/validation.md) includes passing checks and whole-test failures.

## Delivery sequence and acceptance

The user requires E2E validation and a commit at the end of each implementation
phase. Continue on `main` in these verifiable units:

1. Finish workspace ownership and OAuth cleanup. Isolate the complete E2E run
   from development state, replace phantom E2E commands with real journeys, run
   every configured suite, and commit the passing result.
2. Remove demonstrated lifecycle workarounds. Simplify the Wiki comment editor,
   repair sharing-effect ownership, enforce application import boundaries, and
   run focused behavior tests and Wiki E2E before committing.
3. Verify runner state transitions against real SQL. Cover lease ownership,
   expiry, retry bounds, stale completion, and payload conservation with an
   independent bounded oracle and deliberate mutations. Include a statechart
   and run related E2E before committing.
4. Expand runtime feature maps for Accounts and Wiki, execute them through Orca,
   and add seeded UI action sequences with observable invariants. Preserve
   action/result evidence and cleanup proof, run E2E, and commit.
5. Encode lessons from actual repository corrections, add release/revert and
   browser-timing reports, connect the verifiers to CI, and run final full E2E.
   Commit the final source correspondence with exact coverage and limitations.

Completion means each reviewed concept has a concrete repository mechanism and
executed evidence, or a source-grounded decision about an example that does not
apply. It does not mean every feature of every application has been proven.
Production observations remain distinct from local fixtures and synthetic timings.

The original acceptance criteria remain the basis for those phases:

1. Repair automatic check selection and skill discovery documentation. Acceptance
   requires executable regressions for selected tasks, nonzero failure propagation,
   a passing installation doctor, and an ACL mutation proof that catches all mutants.
2. Audit application boundaries against their current `ARCHITECTURE.md`. For each
   repeated violation, capture the behavior, add an executable boundary check, migrate
   every affected caller, and delete the obsolete path. A list of suggested cleanups
   alone does not complete this step.
3. Expand runtime feature maps by user journey. Prioritize Accounts sign-in and
   authorization, Wiki authoring/search, and cross-app flows that rely on Accounts.
   Each journey needs isolated fixtures, an observable result, failure evidence,
   and cleanup. Run it through Orca before marking it covered.
4. Model additional stateful behavior where the failure cost warrants it, such as
   queue retries or permission changes. Run the actual code against independent
   properties when possible. Label finite enumeration and unbounded proofs accurately.
5. Expand automation only after those checks reject deliberate defects and run in
   the actual delivery path. Measure skipped checks separately from successful ones.

The initial foundation is committed in `04fb9938`. Mandatory delivery phase 1 is
committed in `0e128570`, including all 17 isolated E2E suites. The
[workspace import check](../../engineering/workspace-boundaries.md) to preserve the
existing separation between applications and shared packages. Negative fixtures
exercise prohibited imports rather than relying on a clean baseline alone.

The first semantic comment cleanup removes Wiki's Google OAuth compatibility
exports. Six production callers now import the existing OAuth owner directly.
The Drive file API no longer reexports its twelve OAuth types and values. A
TypeScript symbol-origin test rejects reintroducing those exports through named,
star, or imported aliases. The file/document and OAuth implementations are unchanged.

Phase 2 removes the comment editor's unused initialization and read-only APIs.
Sharing state belongs to one page, aborts obsolete reads, and snapshots child
counts for the post-close synchronization prompt. The import checker now rejects
feature-to-route dependencies and runtime UI imports of server implementations.
Explicit type-only contracts remain allowed. Direct imports were audited across
the current applications; this is not a transitive bundle or whole-API audit.

Steps 3 through 5 remain open. Keep existing regression suites and working
application boundaries when adapting another team's examples.
