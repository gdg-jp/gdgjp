# Documentation organization, November 17, 2026

## Scope and decisions

The repository had no root documentation entrypoint. Current guidance, incomplete
plans, dated reports, implementation specifications, and executable eval data shared
the same level. The inventory reviewed group indexes, progress, ADRs, and consumers;
it did not read every document in full or revalidate external service setup.

The user requested organization after the engineering foundation changes. The
[writing post](https://x.com/poteto/status/2109885001584292091) and
[clarification](https://x.com/poteto/status/2109899035788345380) distinguish thinking
through writing from routine recording work. Neither prescribes this repository's
folder structure. The taxonomy below is a repository-specific choice.

| Material | Location |
| --- | --- |
| Reader entrypoint and app map | `docs/README.md`, `docs/applications.md` |
| Operating procedures | `docs/guides/` |
| Shared architecture and specification pointers | `docs/references/` |
| Current engineering policy and verification commands | `docs/engineering/` |
| Incomplete plans and specifications that still have callers | `docs/plans/` |
| Recorded unresolved investigations | `docs/issues/` |
| Dated reports, superseded instructions, articles, research, and old task records | `docs/archive/` |

`docs/roster/` and `docs/eval/` retain their positions because source code and tests
consume their specifications and data. Legacy v1 plans are grouped and labeled;
ACL stages and the Wiki bootstrap still have callers. Incomplete MVP, refactoring,
CLI, and UI plans remain outside Archive regardless of their age. Plan entrypoints
state uncertainty where document status and implementation do not establish completion.

The general architecture reference's old ownership survey moved into a dated report.
Pstack's historical setup snapshot is archived; `.agents/docs/pstack.md` remains the
current workflow. The old Vercel agent guide is explicitly historical.

## Preservation and checks

`scripts/docs-moves.json` records explicit moves. The helper previews changes without
arguments and applies them with `--apply`. It refuses destination collisions, rewrites
relative links and repository references, and preserves fenced examples. Repeating it
after the migration produces zero changes. It does not classify new plans automatically.
The old document pointer in `apps/accounts/migrations/0021_add_google_workspace_connections.sql`
is retained as historical migration text. Immutable migrations and decision-log rows
were not rewritten to claim that every textual path now names a live file.

The Wiki bootstrap remains 16,371 UTF-8 bytes with SHA-256
`dd4dc0f120f1ccf46fb4904d16fb452a918c1536548a027411f417baccaff420`.
Its existing four tests passed after the import moved. The PR kind-contract tests
also passed without moving or reformatting their input specification.

The migration fixed preexisting `order.md` and `00-overview.md` links and old
design-system paths. Public HTTP contract comments were preserved with three exact
reviewed exceptions; obsolete narration was removed. No application behavior, binding,
schema, secret, or deployment was intentionally changed.

`pnpm check:docs` checks the root layout and Markdown local file links. It does not
check external URLs, heading anchors, code examples, historical archive bodies, or
the semantic accuracy of guidance. It runs through lint, local CI, and hosted repository
policy checks. Its behavioral tests use temporary directories with broken links,
misplaced files, fences, and historical records.

Execution results are recorded in the foundation decision log and local logs. Hosted
CI and production integrations were not run during this organization task.

| Local validation | Result | Evidence |
| --- | --- | --- |
| Documentation checker and migration helper tests | 10 passed; independently repeated by reviewer | `.github/scripts/check-docs.test.mjs`, `.github/scripts/reorganize-docs.test.mjs` |
| `pnpm lint` | Passed Biome, comment policy, and documentation checks | `/tmp/gdgjp-docs-lint-final.log` |
| `pnpm typecheck --concurrency=3` | Failed with native compiler Bus error in Screen | `/tmp/gdgjp-docs-typecheck.log` |
| Sequential typecheck retry | 26 tasks successful, 19 cached | `/tmp/gdgjp-docs-typecheck-retry.log` |
| Wiki bootstrap and PR kind tests | Four and two passed | `/tmp/gdgjp-docs-wiki-seed-tests.log`, `/tmp/gdgjp-docs-pr-kinds-tests.log` |
| Wiki production build | Passed after import relocation | `/tmp/gdgjp-docs-wiki-build.log` |
| Repository script suite | 108 passed, zero skipped | `/tmp/gdgjp-docs-test-final.log` |
| Full application test graph | Failed at the existing PR test-colocation violation | `/tmp/gdgjp-docs-test-final.log` |

The first script-suite attempt exposed a migration-test fixture that depended on
automatic classification of flat plans. The helper was deliberately changed to
explicit mappings, so the fixture was updated to supply its own move and assert
that a new unclassified plan stays put. The final suite above passed.

Independent review found all 150 mapped destinations and confirmed the six PNG
files and Wiki bootstrap match their baseline. Review used the parent model family;
no cross-vendor review is claimed. Browser suites were not run because the change
does not alter product UI. The failed full graph does not establish a passing Wiki
application suite or passing checks for tasks interrupted by Turbo.
