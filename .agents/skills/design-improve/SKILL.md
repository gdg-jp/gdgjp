---
name: design-improve
description: Turn repeated corrections, newly useful compositions, or mismatches between guidance and implementation found through the design harness into a proposed change to the smallest authoritative source in packages/design-system (scenario, component contract, pattern, rules.json, or decisions.md); record the decision, apply what is accepted, and verify it takes effect in the next task. Use when asked to "feed this finding back into the harness", "add this as a rule", "keep this lesson", or "prevent the same mistake", or when a lesson remains at the end of design-build or design-review.
---

# Return lessons to the authority

Collecting logs is not improvement.
Turn an observation into a change to the smallest authoritative file, record the decision, and finish only after confirming it works in the next run.
Run commands from `packages/design-system/`.

## 1. Choose the destination

First read `design/decisions.md` (including rejected ideas) and the existing rules and contracts, so you do not create duplicates or contradictions.

| Observation | Destination |
| --- | --- |
| One task's requirements are incomplete | `design/scenarios/<id>.json` |
| A component's documented usage differs from its implementation | `design/components/<id>.json` (`src/design-contracts.test.tsx` checks it against the implementation) |
| Components are correct but their composition breaks | `design/patterns/<id>.json` and that scenario's e2e spec |
| A mechanically decidable violation keeps slipping through | A rule plus detector in `design/rules.json` |
| A preference that depends on context | `design/decisions.md`, with the context, alternatives, and reasons |
| The knowledge exists but is not being read | The Skill's steps or the resolver's refs |

Changing DESIGN.md's prose or token values is a change to the design system's public contract. Handle it separately, following `packages/design-system/AGENTS.md`.

## 2. Run statically detectable rules through the feedback CLI

Only the detectors in `sourceRuleSchema` in `harness/core.mjs` are supported (`jsx-required-prop`, `jsx-requires-context`, `jsx-forbidden-component`, `jsx-literal-pattern`, `import-policy`).

1. Write a draft JSON (shape in `design/proposals/README.md`). For evidence, point to a file or report that reproduces the violation; copies are saved under `design/proposals/<id>/`.
2. `pnpm -s design:feedback propose <draft.json>`. At this point it is in neither the rules nor the resolver.
3. Get the decision from the user (or the person responsible for DESIGN.md). An agent must never record `accepted` on its own.
   `pnpm -s design:feedback decide <id> accepted|rejected "<reviewer>" "<reason>"`
4. If accepted, run `pnpm -s design:feedback apply <id>` and then `pnpm design:catalog`. Keep rejected proposals with their reasons.
5. Verify: the new rule appears in `pnpm -s design:resolve <scenario>`, `design:check-source` exits 1 on the original violating file, and both the corrected version and a neighboring case (another correct example) pass. Restart the MCP server and repeat the same checks there.

Lessons a detector cannot express (changes to contracts, patterns, scenarios, or e2e specs) go through ordinary edits; record the decision and the next run's report in `design/decisions.md` the same way.

## Output

The proposal ID and path, the decision (who and why), the applied diff, and the paths of the reports or command output used for verification.
