---
name: design-review
description: Review an existing page against this project's contracts and rendered evidence, keeping mechanical violations and unresolved judgments separate.
---

# Review the actual artifact

1. Read root `DESIGN.md`, resolve the relevant scenario, and read its returned resources. Inspect the current artifact rather than the producer's description.
2. Run `npm run design:check -- FILE.html` or MCP `check_design` with its current source. Keep the reported contract/source revisions and rule IDs.
3. Inspect rendered behavior against the scenario. A check not run is `not-evaluated`; a judgment with evidence but no decision is `needs-review`. Do not turn either into a pass.
4. Report each actionable finding with the rule or criterion, observation, evidence, and suggested correction. Keep contextual advice distinct from binding rules.
5. After a correction, rerun the affected checks against the new source. If a missing contract caused the problem, invoke the local `design-improve` Skill; do not silently strengthen or weaken policy during review.
