# A harness that improves with use

Use this when building the path from a correction to later work. A useful learning loop has both a capture point and a verified destination. Saving a log is not completion.

## Capture during work and at wrap-up

Capture a repeated review correction, a newly useful pattern, or a mismatch between guidance and implementation. At task completion, inspect the task's authorized reports/decisions for uncaptured lessons. Use the team's existing issue, review, or repository files; do not introduce a database or collect unrelated private session history just to store observations.

For each proposal, retain:

```text
Observation: What happened, where, and for which task/user?
Evidence: Current artifact/report revision and reproducible case.
Scope: Which scenario, component, pattern, or medium does this affect?
Destination: The authoritative file or reference to change.
Proposal: Concrete change, rationale, and a valid alternative/example.
Decision: Proposed, accepted, or rejected; responsible reviewer and reason.
Adoption: Applied diff/revision and next-task verification, if accepted.
```

Store proposals outside agent instruction/retrieval paths. They can be searched by a maintainer investigating past decisions, but they must not be fed to a producer as accepted constraints. Preserve rejected reasons so a later review need not repeat the same unhelpful suggestion.

## Choose the smallest destination

| Finding | Destination and proof |
| --- | --- |
| One task has a new requirement | Its requirements/scenario; reproduce the changed behavior |
| A component's documented API is wrong | Its contract and relevant Skill reference; compile/render a real consumer |
| Components are correct but their relationship fails | Composition pattern or cross-screen scenario; exercise the relationship |
| A repeated decidable violation escapes inspection | Scoped rule plus shared detector/test; reject the defect and pass its correction |
| A contextual preference helps one audience/medium | Decision/rubric with contrasting examples; re-review in that context |
| Relevant guidance exists but is never retrieved | Skill routing/resolver/index; show a new task loading it |

Inspect existing guidance before adding a rule. A duplicate or contradictory instruction can reduce quality. Keep a local preference scoped, and retain an unresolved disagreement instead of disguising it as a mechanical assertion.

## Review, apply, and refresh

1. Prepare a concrete diff or supported rule proposal with evidence. Correct the authorized artifact independently; do not hold an ordinary fix hostage to a policy decision.
2. Route it through the existing owner/review process. Honor prior explicit authorization and record the actual decision; the workflow must not invent another confirmation gate or fabricate approval.
3. Apply accepted changes to authority, leaving rejected proposals out of production knowledge. If the authoritative revision changed in the meantime, reassess against that revision rather than blindly applying stale advice.
4. Regenerate affected views and run contract, reference, detector, and drift checks. Update the consuming Skill's reading path when a reference moves. Changing prose without updating its consumer is incomplete.
5. Start a new retrieval/run, verify the adopted guidance is present, and exercise the original defect, correction, and a neighboring case. Save the new report and link it to the proposal/adoption.

Do not let an automatic correction loop weaken rules, tests, or baselines to declare success. A policy exception is a scoped, recorded decision with its own acceptance conditions.

## Executable example

The [starter operator guide](../assets/harness-starter/DESIGN.md#learning-walkthrough) supplies the full command sequence. Its catalog initially checks button types but cannot detect a missing image `alt`. The image example therefore exposes a real coverage gap rather than a hardcoded failing report.

`feedback propose` validates a concrete additional rule and saves a proposal. `feedback decide` records an accepted/rejected decision with reviewer and reason. `feedback apply` accepts only an accepted proposal against its original authoritative revision. It updates the rule and adoption receipt in a single atomic catalog write; repeating the same adoption is a no-op. A local lock serializes maintenance.

The decision binds the reviewed candidate digest; proposal evidence is also hashed. Modified candidates or evidence are rejected before application. Keep immutable evidence copies when correcting the original artifact, and use a new reviewed proposal when the inputs change.

The CLI is a recordkeeping mechanism, not an identity or permission system. The operator/agent remains responsible for having the applicable authorization. Its tests use explicitly simulated decisions inside temporary workspaces. Do not describe them as real human approval or evidence of improved model quality.

After adoption, regenerate the catalog/theme, restart MCP, and resolve the scenario again. The new rule must be retrievable and must detect the untouched failing HTML through both MCP and CLI. Correct the actual element, rerun, and test an informative image and a decorative empty-alt case. Static presence still cannot judge whether alternative text communicates the right meaning.

The sample automates adding rules supported by its detector. Updates to component APIs, narrative guidance, requirements, and Skill references use ordinary reviewed changes with the same evidence path. Do not create a generic patch-execution API just to automate those different edits.

## Maintenance and comparison

Assign ownership to the authority already used by the team. Revalidate after component/library changes, token/brand changes, recurrent failures, or a model/toolchain change. Consolidate superseded guidance and preserve its decision history; endlessly appending instructions is not learning.

To evaluate whether the workflow helps, use comparable tasks and record:

- The unchanged brief, model/tool versions, starter revision, and permitted inputs.
- Separate baseline, harness-assisted, and feedback-corrected artifacts with source/contract revisions.
- Which rules ran, their results, the unexecuted/contextual items, and human interventions.
- The correction input and the evidence that the next task consumed the adopted knowledge.

Reuse the existing runner and report format. Collect measurements before evaluating them; keep evaluation-only answers out of producer context when that separation is part of the experiment. A before/after comparison of one task demonstrates that case, not a universal quality improvement percentage.
