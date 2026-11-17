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
