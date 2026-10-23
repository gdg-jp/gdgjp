---
name: design-review
description: Review an existing screen, story, or TSX file against the GDG Apps design harness (packages/design-system/design/rules.json and DESIGN.md), reporting mechanical violations, contextual findings, and unevaluated items separately. Use when asked to "do a design review", "does this screen follow the design system?", "look at the design check results", or "check the UI in this PR". Does not edit code; use design-build to fix.
---

# Review with the harness

Review the actual artifact. Do not rely on the author's claim that it is done, or on an averaged score.
Run commands from `packages/design-system/`.

## Inputs

- Target: a scenario ID (when a story exists) or the path to a TSX/TS file.
- Optional: the brief or the PR description.

## Steps

1. Read `## Harness` in `DESIGN.md`. If there is a scenario, read the resources returned by `pnpm -s design:resolve <scenario>`.
2. Run the mechanical checks.
   - With a scenario: `pnpm design:check <scenario>`. You may reuse an existing report found through `test-results/design/latest.json`, but only after confirming its `artifactRevision` matches the current working tree; otherwise rerun.
   - With only a file: `pnpm -s design:check-source <file>` (or `check_source` over MCP). State explicitly that this covers static rules only, not rendering, interaction, or layout.
3. Open report.md and the screenshots and write findings from these angles. Cite the screenshot path you looked at for each.
   - Can the user find the main action? (Is there one primary action, and does visual emphasis match the brief?)
   - Are states communicated? (Are errors next to the field, is a successful save clear, can the user recover from failure?)
   - Reading order and hierarchy, light and dark themes, narrow widths, and long Japanese text.
   - DESIGN.md's Do's and Don'ts.
4. Read `design/decisions.md` and make sure you are not re-proposing an idea that was already rejected.

## Output

Write these three groups separately; do not mix them.

| Group | Contents |
| --- | --- |
| Mechanical violations | Rule ID, location, observation, report path |
| Contextual findings | Angle, supporting screenshot, suggestion. Leave approval or rejection to the user |
| Not evaluated | `not-evaluated` rules with reasons, and what the harness does not examine at all (the report's `limits`) |

End with any recurring findings as candidates for `design-improve`.
