# Implementing checks and the correction loop

This specifies what executes, how results are represented, and how to prove the mechanism works. Reuse the target's browser library and test framework.

## Three kinds of checks

| Kind | Implement | Exercise a failure |
| --- | --- | --- |
| Contract/source | Validate fields, IDs and references; compare generated output; type-check examples; lint forbidden imports/raw styles | Unknown component/variant, missing check mapping, or edited generated CSS |
| Render/interaction | Start the preview; load the scenario; exercise actions/recovery; inspect focus, names, overflow, and screenshots | Lost input after error, duplicate saves, missing accessible name, or overflow |
| Contextual review | Inspect the actual output against a brief-specific criterion and examples | A mechanically valid page with wrong action priority or message |

Inspect authority or implementation, not two copies of the same claim. Use a language-aware linter for code policy; regex scanning is not a reliable component/API validator. Map failures to rule IDs so the correcting agent can retrieve the right contract.

Use the same assertion implementation in CLI, MCP, and any supported editor hook. Keep hook adapters small: supply supported input, return findings, and propagate failures. The task workflow owns retries and escalation. Reusing the core does not establish that a hook is installed; test its actual invocation when hook integration is in scope.

## Browser assertions for the profile example

Use observed accessible names or established stable test IDs. Connect backend/mock responses through the project's normal test mechanism.

| Rule | Setup and actions | Assertions |
| --- | --- | --- |
| `FORM-RECOVERY` | Enter `Morgan Chen`; reject the save request | Input still contains `Morgan Chen`; error is perceivable; retry is available and can reach success. |
| `FORM-PENDING` | Hold the save response pending; activate Save repeatedly | Exactly one request is sent; pending status is understandable; completion restores appropriate controls. |
| `LAYOUT-OVERFLOW` | Render required viewports and long-content states | No unintended page scrolling or clipped text/controls inside smaller containers. |
| Keyboard/focus | Navigate and operate without a pointer | Focus is visible, follows meaningful order, and reaches validation/recovery controls. |

Example of a page-level geometry assertion:

```js
const hasPageOverflow = await page.evaluate(() =>
  document.documentElement.scrollWidth > document.documentElement.clientWidth
);
assert.equal(hasPageOverflow, false, 'LAYOUT-OVERFLOW');
```

The target browser test supplies `page` and `assert`. This measures page geometry only: inspect nested containers and screenshots too, because hidden overflow can clip content without changing page width. Wait for the application/fonts, and fix data, theme, viewport, and scenario for reproducible captures.

Combine automated accessibility checks with keyboard and targeted manual inspection. A scan alone is not complete accessibility validation; screenshots cannot establish keyboard behavior or actual transitions.

## One command and a truthful report

Create a task-runner command such as `design:check` that executes real checks. A useful sequence is:

```text
generate --check -> contract/source checks -> build/start preview
-> scenario tests and screenshots -> aggregate report -> exit status
```

These labels are jobs to implement, not a ready-to-run command. Replace them in the finished `DESIGN.md` with exact commands and prerequisites you ran. Mark later stages unexecuted when an earlier failure prevents them; do not prepopulate passing results.

Return nonzero for required mechanical failure, missing required mechanical checks, or execution errors. Write a report on failed runs where feasible. A mechanical zero exit does not grant human approval; expose pending review in the final summary or existing approval gate.

Illustrative report shape:

```json
{
  "scenario": "profile-edit",
  "artifactRevision": "content-digest-or-commit-plus-dirty-snapshot",
  "checks": [
    {
      "rule": "FORM-RECOVERY",
      "status": "fail",
      "state": "server-error",
      "observation": "The name reset to Morgan Lee after rejection.",
      "evidence": ["server-error.png", "browser.log"],
      "nextAction": "Keep edited form state when the request fails."
    },
    {
      "rule": "COMMUNICATION-HIERARCHY",
      "status": "needs-review",
      "state": "default",
      "observation": "Save is visually subordinate to account deletion.",
      "evidence": ["default-narrow.png"],
      "nextAction": "Review action priority against the brief."
    }
  ]
}
```

Use real observations and files, not this example's results. Evidence paths are relative to the run directory and must describe the current artifact. Include uncommitted changes in the artifact identity; HEAD alone can identify the wrong code. Record viewport/theme, tool versions, and commands in metadata or logs.

Also record the contract revision and coverage: which mechanical rules actually ran, which were inapplicable, and which require another checker or contextual review. Binding a report only to the artifact misses changes in the rules used to evaluate it. Keep original source bytes intact when hashing or transporting them.

- `pass`: the applicable check ran and met its criterion.
- `fail`: actual evidence violates the criterion.
- `needs-review`: evidence exists but judgment is unresolved.
- `not-evaluated`: a rule, capability, or required evidence is missing.
- `not-applicable`: excluded by declared task scope, with a reason.

An unknown brand rule is `not-evaluated`. General design suggestions belong in advisory findings, not product-specific compliance. No average score cancels a required failure.

## Demonstrate rejection and correction

Use a disposable copy or isolated fixture, preserving user changes:

1. Run a known-good case through the actual command.
2. Introduce one real defect, such as resetting input after a rejected save.
3. Confirm nonzero exit, the expected rule ID, and evidence of that defect.
4. Correct the implementation and confirm the same check passes.
5. Exercise a neighboring case, such as a different edited name or long content.

The bundled token test covers missing output, manual drift, changed source, invalid data, regeneration, and a passing check. A UI harness still needs real browser cases; a token test is not evidence of a functioning UI review loop.

## Contextual review and feedback

Define each criterion with an observable question and accepted/rejected examples with reasons. For hierarchy: “Can the intended user find the next action when it matters?” Inspect the artifact and brief rather than accepting the producer's summary.

Record the adopted decision:

```markdown
Decision: Keep entered values visible after a rejected save.
Context: Profile editing; failure should be recoverable without restarting.
Evidence: Failed run, corrected run, and FORM-RECOVERY observations.
Change: Removed the failure-path form reset.
Reusable destination: The edit-form pattern and its browser check.
Status/owner: Record the actual decision and responsible person or team.
Exception: None for this flow; other flows need their own justification.
```

Retain rejected suggestions when their reasons prevent repeated unhelpful corrections. Route lessons to the smallest applicable scope: scenario, component, pattern, then shared policy when justified. For preferences, preserve context and alternatives instead of inventing lint rules.

Implement the proposal, decision, adoption, and next-task proof described in [evolution.md](evolution.md). A decision record is an input to that process, not proof that retrieval or checks changed.

To measure improvement, keep baseline, harness-assisted, and corrected runs separate with equivalent task/model/tool/input conditions. Record human intervention. Do not hand-edit a comparison artifact while attributing the change to the harness. Retain the best verified revision when later scoring promotes complexity or a worse direction.

## Verify the harness itself

The [starter tests](../assets/harness-starter/test.mjs) demonstrate these mechanisms. Adapt the cases to the target's actual runtime:

| Mechanism | Required evidence |
| --- | --- |
| Retrieval and Skill routing | Resolve a real task, read each returned resource, and execute the discovered Skill's commands; unknown IDs and missing Skills fail |
| MCP | A subprocess stdio or actual selected transport client lists/reads resources and calls tools; handlers alone do not prove transport |
| Shared checks | The same artifact/scenario produces the same revision, rule IDs, findings, and coverage through CLI and MCP |
| Contract integrity | Duplicate IDs, unresolved dependencies, unsupported detector declarations, and missing rule implementations fail |
| Derived views | Changing authority makes the freshness check fail without rewriting output; regeneration updates the catalog/theme |
| Learning | Pending/rejected proposals do not change policy; accepted changes are visible in a new retrieval/run and detect the defect |
| Scope | A lesson for one scenario does not affect an unrelated scenario |
| Copy/install | A fresh working copy installs its lockfile and runs the documented commands without paths back into the author's checkout |

For a richer rule engine, check both directions between rule declarations and detector registrations; a registered detector without a reachable rule can be dead enforcement. Check that a new contract appears in discovery and its human view, rather than asserting that a particular source file contains its name.

Separate validation claims in the handover: deterministic checks, operator walkthrough, agent behavior, rendered evidence, and human acceptance. Passing the starter's static tests does not prove complete UI conformance or general improvements in generated design quality.
