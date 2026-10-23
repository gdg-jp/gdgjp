---
name: design-build
description: Implement a screen or composed story that follows the GDG Apps design harness (the scenario, pattern, and component contracts and rules in packages/design-system/design/), then verify and correct it with pnpm design:check. Use when asked to "build this screen with the harness", "implement a scenario", "make design check pass", or "build it to the design-system contracts", or when creating or fixing a screen that has a scenario in design/scenarios/. For migrating production screens in apps/ use gdg-ui; for throwaway prototype HTML use design-prototype.
---

# Build a screen with the harness

All authoritative knowledge lives in `packages/design-system/`.
This Skill holds only the procedure; do not copy token values or component specs into it.
Run commands from `packages/design-system/` (from the repository root, use `pnpm --filter @gdgjp/design-system <script>`).

## Inputs

- A scenario ID (for example `scenario.profile-edit`). If none exists, draft `design/scenarios/<id>.json` from the brief in the same shape as the existing scenarios, and confirm it with the user before continuing.
- The brief. If it conflicts with the scenario's `brief`, treat the scenario as authoritative and confirm the difference with the user.

## Steps

1. Read `## Harness` in `DESIGN.md`. It maps each kind of knowledge to the file that owns it and gives the task sequence.
2. Run `pnpm -s design:resolve <scenario>` and read the resources it returns.
   If the `gdg-design` MCP server is connected, `resolve_design_context` and reading `gdg-design://<id>` do the same.
   Read only what is returned. If you are unsure of a component's props, read the story named in its contract's `details.story`.
3. Implement every entry in the scenario's `states` and `transitions` in the files listed in `artifact.source`.
   - Use only public exports from `src/index.ts`. Use `--gdg-*` tokens or semantic utilities for values.
   - Keep any test hooks described in the scenario's `artifact.testHooks` inside the story only.
   - For a new scenario, write `e2e/design-<id>.spec.ts` in the same shape as `e2e/design-profile-edit.spec.ts`. Start each test title with `RULE-ID: ...`; check.mjs maps results to rules by that prefix.
4. Run `pnpm -s design:check-source <file> <scenario>` on the files you wrote and fix static rule violations.
5. Run `pnpm design:check <scenario>`. It builds Storybook, so it takes a while; running it in the background is fine.
   Open the `report.md` given in the output's `report` field, and actually look at the screenshots it lists.
6. Fix each `fail` and `not-evaluated` rule following the report's `Next:` line and the rule's `fix`, then rerun step 5.
   - Make at most two automatic correction rounds. Stop and return to the user when progress stalls, a required tool does not work, or the fix needs a new product or design decision.
   - Never loosen rules, tests, baseline images, or exclusions to make a run pass.
7. For `needs-review` rules (such as TASK-FIT), compare the screenshots with the brief and write your observations. Do not approve them; leave the judgment to the user.

## Output

- Changed files, the path of the last passing report, `mechanicalPassed`, and the lists of `fail`, `not-evaluated`, and `needs-review` rules.
- List any repeated corrections or design-system gaps you found as input for the `design-improve` Skill. Do not edit rules.json yourself here.
