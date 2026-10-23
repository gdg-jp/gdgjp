---
name: design-improve
description: Capture a discovered design pattern, repeated correction, or knowledge/code mismatch and carry a reviewed proposal into the next task's authoritative guidance.
---

# Turn a correction into maintained knowledge

1. Read root `DESIGN.md` and inspect existing rules, guidance, and proposals. Capture the observed problem and actual evidence; do not infer a global rule from one preference.
2. Choose the smallest destination: requirement, scenario, component, pattern, Skill reference, or shared rule. Propose an existing-rule update when appropriate instead of creating a duplicate.
3. For an additional supported HTML rule, adapt `examples/image-alt-proposal.json` and run `npm run feedback -- propose DRAFT.json`. Evidence paths must exist within this workspace. Other changes use a normal reviewable diff with the same observation, scope, evidence, and rationale.
4. Present the concrete change to the responsible reviewer using the existing authorization process. Prior explicit authorization remains valid; a proposed observation alone is not authorization. Record acceptance or rejection with its real reason. Do not invent an approval.
5. Only apply an accepted proposal. Regenerate derived views, check drift, restart MCP, and resolve the scenario again. Verify the new resource and checker behavior on the original defect, its correction, and a neighboring case.
6. Save before/after reports and the adoption receipt with the task's evidence. Rejected proposals stay outside the retrieval catalog. Retire superseded knowledge through reviewed changes rather than indefinitely appending instructions.
