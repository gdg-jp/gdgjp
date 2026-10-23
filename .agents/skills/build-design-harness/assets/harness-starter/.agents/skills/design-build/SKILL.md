---
name: design-build
description: Create or revise a page using this project's scenario, design contracts, and static checks. Use for page implementation, not for changing shared design policy.
---

# Build from a scenario

1. Read the project's root `DESIGN.md`. Identify the user's outcome and resolve the scenario with `npm run design:resolve -- SCENARIO_ID` or `resolve_design_context` over MCP. Use catalog/search for discovery; do not invent IDs.
2. Read the returned resources. They own values, component behavior, composition, and required states. Keep their values out of this Skill.
3. Implement the requested page and states using the actual component APIs and generated theme. Record a missing requirement rather than making it approved policy.
4. Run `npm run design:check -- FILE.html` or send the actual HTML to `check_design`. Correct reported failures and rerun against the changed artifact. The static checker does not handle JSX or browser behavior.
5. Render and operate the page. Save evidence for layout, keyboard, state transitions, and task fit as applicable. Return contract/source revisions, failures, unevaluated items, and evidence locations. A mechanical pass is not completion approval.
6. When a useful pattern or knowledge/code mismatch emerges, use the local `design-improve` Skill. Finish the authorized artifact correction; proposing broader policy is a separate step.
