# Product UI build specification

Use this while creating the harness files. The profile-editing example is original implementation guidance, not a schema copied from a source. Replace illustrative decisions with verified project choices. Keep an existing schema when one exists.

## Files and data flow

```text
DESIGN.md
design/
  tokens.json
  components/button.json
  patterns/edit-form.json
  scenarios/profile-edit.json
  rules.json
  decisions.md
src/
  generated/theme.css
  ...existing components and a runnable profile editor...
scripts/
  check-design.*
  ...existing generator and browser tests...
test-results/design/<run-id>/
  report.json
  ...actual screenshots and check logs...
```

Source and script filenames follow the project's language and framework. The tree shows responsibilities, not permission to replace its layout.

```text
tokens -> generated theme -> component implementation -> composed page
component contract + pattern + scenario -> implementation instructions
rules -> executable assertions -> report + rendered evidence
scenario -> catalog/resolver -> relevant contracts + task Skills -> implementation
authority -> MCP resources + generated reference catalog + theme
report -> correction -> proposal -> decision -> authority update -> next task
```

Writing JSON does not make the application consume it. The generator consumes tokens; the build imports generated CSS; the implementation uses real component APIs; tests map rule/scenario IDs to assertions against the implementation. Document those connections.

## DESIGN.md: the entrypoint

Fill this outline with the project's actual values:

```markdown
# Product design contract

## Authority
Values: design/tokens.json; generated CSS is not edited by hand.
Button behavior: src/ui/Button implementation; its contract records supported use.
Profile requirements and states: design/scenarios/profile-edit.json.
Composition: design/patterns/edit-form.json.
Required checks: design/rules.json and the mapped executable assertions.
Contextual decisions: design/decisions.md.

## Build a profile edit
Read scenario profile-edit, pattern edit-form, and component button.
Implement applicable scenario states using shared components/theme.
Run generation, contract, and browser checks.
Inspect the report and images, fix identified violations, and rerun.

## Commands
Insert actual preview, generation, validation, and evidence commands.
Record working directory, prerequisites, and output paths.

## Acceptance and feedback
Required mechanical checks pass against the delivered revision.
Contextual review remains open until the responsible person decides it.
Record adopted/rejected changes and reasons in design/decisions.md.
```

Replace the command instructions with commands you implemented and ran. Add a local pointer from the agent's existing entrypoint; do not put every contract into that entrypoint.

## Tokens and generated theme

Inventory semantic roles used by the pilot: text, surface, action, focus, feedback, text hierarchy, spacing, border/shape, and motion where present. Reuse existing aliases, themes, units, and types. Define light/dark differences and reduced-motion behavior when the product supports them.

Read source styles or supplied brand definitions rather than treating screenshot measurements as approved values. Mark proposed choices. Preserve primitive/semantic distinctions in the existing system.

### Runnable token pipeline

The bundled [tokens.json](../assets/token-pipeline/tokens.json), [generator](../assets/token-pipeline/generate-tokens.mjs), and [test](../assets/token-pipeline/test-generate-tokens.mjs) provide a working mechanism using Node.js without package installation. From the skill directory:

```sh
node assets/token-pipeline/test-generate-tokens.mjs
```

The test uses temporary inputs/outputs and cleans them afterward. To adapt the example, copy the generator to `scripts/generate-tokens.mjs`, put project values in `design/tokens.json`, and run from the project root:

```sh
node scripts/generate-tokens.mjs design/tokens.json src/generated/theme.css
node scripts/generate-tokens.mjs design/tokens.json src/generated/theme.css --check
```

Import the generated file through the application's CSS entrypoint. Consume it as `color: var(--color-text)` and `gap: var(--space-control)`, for example. The check regenerates expected bytes in memory and exits nonzero if output is missing or different. Checking never rewrites output to hide drift.

This example uses a flat semantic-name/value map, supporting hex colors and nonnegative `px`/`rem` dimensions. It does not implement aliases, typography objects, multiple themes, or a token interchange standard. Extend the target's existing pipeline for those needs rather than converting its schema to this example. Detecting raw values in application CSS requires a separate lint rule.

## Component contract

Inspect the component source and callers. This example assumes the project really exports `Button` with these variants:

```json
{
  "id": "button",
  "implementation": "src/ui/Button.tsx",
  "export": "Button",
  "when": "Trigger an in-page action; use a link for navigation.",
  "variants": ["primary", "secondary"],
  "content": {"label": "Describe the action; icon-only buttons need an accessible name."},
  "states": ["default", "focus", "disabled", "pending"],
  "behavior": {
    "pending": "Prevent duplicate submission and preserve an understandable status.",
    "keyboard": "Activation and focus follow the underlying native button."
  },
  "examples": ["src/ui/Button.examples.tsx"]
}
```

Create the example or use an existing story; compile and render each stated variant/state. Do not create a parallel component to satisfy a filename. Validate the export/variant against the implementation or shared types; repeating a list in two JSON files is not independent validation.

## Composition pattern

Tokens and valid components leave page organization unspecified. A pattern connects them:

```json
{
  "id": "edit-form",
  "purpose": "Edit one object without losing entered data on failure.",
  "regions": [
    {"id": "heading", "content": "Object name and purpose"},
    {"id": "fields", "content": "Labeled fields with nearby validation"},
    {"id": "feedback", "content": "Submission status and recovery action"},
    {"id": "actions", "components": ["button"], "primaryAction": "Save profile"}
  ],
  "layout": {
    "narrow": "Single column in reading order; actions remain reachable without horizontal scrolling.",
    "wide": "Preserve reading order and group related fields."
  },
  "rules": ["FORM-RECOVERY", "FORM-PENDING", "LAYOUT-OVERFLOW"]
}
```

Use approved measurements when available. Put an approved composition example alongside its reasons. Scope density, width, and ordering constraints to the pattern they serve.

## Scenario and transitions

Use existing story args, mock services, or test data to make states reproducible. Named states must actually be reachable; do not introduce a production debug bypass just to manufacture them.

```json
{
  "id": "profile-edit",
  "pattern": "edit-form",
  "goal": "A member updates their display name and recovers from a failed save.",
  "data": {"displayName": "Morgan Lee", "editedName": "Morgan Chen"},
  "states": ["default", "invalid", "pending", "success", "server-error"],
  "transitions": [
    {"from": "default", "action": "submit an empty name", "to": "invalid"},
    {"from": "default", "action": "submit an edited name", "to": "pending"},
    {"from": "pending", "action": "server accepts", "to": "success"},
    {"from": "pending", "action": "server rejects", "to": "server-error"},
    {"from": "server-error", "action": "retry with preserved input", "to": "pending"}
  ],
  "viewports": [{"width": 390, "height": 844}, {"width": 1440, "height": 900}],
  "requiredRules": ["FORM-RECOVERY", "FORM-PENDING", "LAYOUT-OVERFLOW"]
}
```

Replace the illustrative viewports and requirements with supported product conditions. Add long text, empty data, locales, permissions, themes, or reduced motion when applicable.

## Rule-to-check contract

```json
[
  {
    "id": "FORM-RECOVERY",
    "scope": "profile-edit/server-error",
    "strength": "MUST",
    "requirement": "A rejected save preserves the edited name and offers retry.",
    "source": "design/scenarios/profile-edit.json",
    "verification": {"kind": "browser", "test": "profile-edit:failed-save-retains-input"},
    "exceptions": []
  },
  {
    "id": "FORM-PENDING",
    "scope": "profile-edit/pending",
    "strength": "MUST",
    "requirement": "Repeated activation while pending sends only one save request.",
    "source": "design/components/button.json",
    "verification": {"kind": "browser", "test": "profile-edit:single-submit"},
    "exceptions": []
  },
  {
    "id": "LAYOUT-OVERFLOW",
    "scope": "edit-form",
    "strength": "MUST",
    "requirement": "Supported viewports have no unintended horizontal page overflow.",
    "source": "design/patterns/edit-form.json",
    "verification": {"kind": "browser", "test": "profile-edit:overflow"},
    "exceptions": []
  }
]
```

Implement the named tests; the `test` strings are identifiers, not existing commands. Reject missing/duplicate IDs, unresolved pattern/component/rule references, and mechanical rules without a mapped check. For contextual criteria use an explicit review method and rubric. [verification.md](verification.md) defines execution and result behavior.

## Build in this order

1. Identify authority and save the real brief. Map example paths onto the project.
2. Connect tokens to generated output and import it. Prove drift detection.
3. Document and render the real shared components needed by the task.
4. Compose a runnable page; wire the scenario's state transitions.
5. Implement source/contract checks and browser assertions; aggregate real results.
6. Expose the same authority/checks through the [agent integration](agent-integration.md); install the task Skills and test retrieval.
7. Run the workflow, correct a defect, and retain before/after evidence.
8. Follow the [learning workflow](evolution.md) and prove a fresh task consumes the adopted lesson.

Connect and verify existing implementations of these steps. Do not expand one flow into a full component catalog, or stop at JSON while the theme, examples, or checks have no consumer.

## Extend for the actual workflow

Apply these additions when the chosen task needs them. Each requires a consumer and a verification case, not just another document.

### Business knowledge, writing, and localization

Create or connect topic references for domain terms, object/status definitions, UX writing, and localization. Record the authoritative term, meaning, permitted transitions, display text by locale, and examples of misuse. Keep business facts in product requirements; Skills explain when and how to read them.

Resolve those references alongside the scenario. A writing Skill should inspect actual labels in context and check that the same object/action uses the same terminology across screens. Implement checks for declared status values and missing translation keys where decidable; review tone and clarity with rendered examples. Do not copy another product's vocabulary or claim a word-length check establishes good writing.

### Several screens and shared state

Extend the scenario with route IDs, related entities, shared fixture data, overlays, and transitions. Assign each route/overlay a composition pattern. Example: a member edited in a detail page must show the updated name in the list; cancel must not mutate it; a failed save must preserve the edit without changing the list.

Use one shared fixture/store rather than independent per-screen mock objects that disagree. Run a cross-screen journey after individual screen checks. Produce a story-ordered capture index with the route/state, reproduction instruction or URL, and screenshot. Keep any URL-driven state switch in the prototype/test boundary; do not add a production authorization or error bypass.

If parallel design/review is explicitly part of the target workflow, give each worker the same requirements and shared data contract, define ownership, and aggregate a cross-screen review. The behavior and handoff can also run in one agent; a fixed agent count is not a requirement.

### Requirements and prototype round trip

Create a task-input template that preserves requirement IDs, user goal, routes, data, states, related features, and open questions. Consume it in the build Skill. It can be populated from an existing requirements document; preserve the authoritative document and its supplied decisions.

When exploration produces an agreement, write a proposed requirements delta referencing the observed prototype state and decision. Adopt that delta into the established requirements source before using it as implementation policy. The handoff includes the selected requirement revision, behavior/state table, unresolved items, and reproduction/capture index. A prototype is evidence of exploration, not automatic approval or production-ready code.

For teams with separate prototype/production repositories, build an explicit refresh procedure: identify the production revision and relevant components, update the prototype baseline in a reviewed change, preserve prototype-only state controls, and rerun the representative journey. If extracting a specification or generating production code is requested, test the resulting implementation against those requirements; do not report a conversion percentage without measurement.

### Shared distribution and maintenance

Use the [installation/update contract](agent-integration.md#install-update-and-remove) when more than one project consumes the harness. Record the consumed version and run a representative consumer before accepting breaking changes. Keep onboarding commands and generated documentation aligned with the actual scripts. A health assessment should report what can be retrieved, executed, and maintained, with evidence and a repair action for each gap; file presence alone is insufficient.
