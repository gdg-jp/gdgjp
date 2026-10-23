---
name: build-design-harness
description: "Build a working design harness for AI-assisted UI or communication design: authoritative contracts, MCP access, task-specific Agent Skills, executable checks, and reviewed learning that reaches the next task. Use to create or extend this infrastructure, not for an isolated styling change."
---

# Build Design Harness

Create the files, implementation, and checks that let the next agent produce consistent work without reconstructing the design system. Deliver one working path from a brief through retrieved knowledge, a rendered artifact, a check result, a correction, and a reviewed lesson used in a later task.

Apply the design principles below throughout the build. Read [concepts.md](references/concepts.md) when choosing what to constrain, how to evaluate it, or which lessons to retain; it explains the principles and their conditions of use. The skill contains the knowledge needed to perform the work without external background reading.

## Design principles

- **Connect constraints, context, verification, and feedback.** Constraints define acceptable choices; context explains the intended outcome; verification examines the actual result; feedback improves the next attempt. These are responsibilities of one working system, not four mandatory folders. Documents become useful when an agent, implementation, check, or reviewer consumes them.
- **Preserve intent and human judgment.** Begin with the user, their situation, and the product or communication goal. Carry that intent through the whole flow, including failure and recovery. Automate execution and checks while preserving established human decisions and identifying unresolved tradeoffs. Visual polish and model scores alone do not establish that the work serves its purpose.
- **Separate facts, requirements, preferences, and unknowns.** Reuse authoritative tokens, APIs, and product information. Encode binding requirements as observable conditions; keep contextual choices with their reasons and scope. Mark proposed choices and missing information explicitly. Resolve conflicting authorities rather than silently creating another source of truth; a screenshot shows current behavior, not necessarily approved policy.
- **Judge composition in context.** Correct components do not guarantee a coherent page or experience. Evaluate relationships, hierarchy, reading order, states, and transitions. For brand or communication work, preserve the message and narrative before refining local styling. A preference that helps one audience or medium must not automatically constrain another.
- **Require evidence and retain uncertainty.** Use deterministic checks for decidable rules and contextual review for meaning and fit. Inspect the current rendered artifact and its behavior. Missing rules or evidence remain unevaluated; unresolved judgments remain visible. Do not substitute an agent's completion claim or a favorable average score for acceptance evidence.
- **Turn corrections into maintained knowledge.** Fix the output, identify the missing knowledge or check, and update the smallest applicable contract or decision record. Retain rejected suggestions when their reasons prevent repeated mistakes. Establish ownership and revalidation triggers; collecting logs alone does not improve future work.
- **Start with a complete, scoped workflow.** Reuse the team's tools and design system, and prove one representative task before expanding. A requested review-only workflow can be a valid first harness. Extend infrastructure when a demonstrated need requires it, while completing the user's chosen scope.

## What to build

For product UI, create or extend these deliverables. The paths are defaults when the project has no equivalent; reuse established files and commands rather than creating a second system.

| Deliverable | Concrete contents | Completion evidence |
| --- | --- | --- |
| `DESIGN.md` | Entry instructions, authority map, task sequence, commands, acceptance conditions | An agent can locate the needed contract and run the documented command. |
| `design/tokens.json` and generated theme | Semantic colors, typography, spacing, shape, and motion needed by the pilot | Real UI consumes the theme; a drift check rejects manual changes to generated output. |
| `design/components/*.json` | Real import/export, allowed variants, content constraints, behavior, and examples | A compiled/rendered example exercises the declared API and states. |
| `design/patterns/*.json` | Page regions, component composition, responsive transitions, and intended task | A real page demonstrates the composition at its required sizes. |
| `design/scenarios/*.json` | Brief, sample data, states, transitions, and acceptance cases | States and transitions can be reproduced in the preview/test setup. |
| `design/rules.json` | Rule IDs, scope, requirement, checker or review method, exceptions | Each required mechanical rule maps to an implemented assertion. |
| Check scripts and task-runner integration | Contract checks, source checks, browser checks, report writing | A deliberate violation produces a nonzero exit; fixing it passes. |
| `design/decisions.md` and run evidence | Decisions with reasons; artifact revision, observations, results, screenshots | A correction is traced to a rerun and a reusable rule or scoped decision. |
| Catalog/resolver and MCP server | Searchable resources, task dependency resolution, shared checker, client connection | A real client retrieves the needed contracts and reports the same violations as the CLI. |
| Project Agent Skills | Build, review, and improve workflows with precise triggers and local references | The target agent discovers the Skill, resolves its inputs, and executes its documented commands. |
| Generated human/agent views | Catalog, reference index, theme; each tied to an authoritative source | A source change fails a non-mutating drift check until views are regenerated. |
| Feedback proposals and adoption evidence | Observation, scope, evidence, destination, decision/reason, applied change | Pending/rejected proposals stay out of policy; a later task consumes an accepted update. |

Use [patterns.md](references/patterns.md) for file contents, linked JSON examples, data flow, and implementation order. For LPs, brand graphics, or decks, use [communication.md](references/communication.md) instead of manufacturing UI component contracts for a non-UI task. Both paths use [verification.md](references/verification.md).

Read [agent-integration.md](references/agent-integration.md) to build MCP, task Skills, retrieval, derived views, and installation/update paths. Read [evolution.md](references/evolution.md) to implement capture, review, adoption, and next-task proof. These are capabilities to build or connect; a review-only request does not authorize installing every subsystem.

## 1. Map the target project

Inspect its instruction files, existing Skills/MCP, build scripts, token source, component exports, CSS/theme entrypoint, stories/examples, test runner, and preview. Locate requirements, terminology/state definitions, and existing feedback/review ownership. Read actual implementations and trace their callers before defining constraints.

Write an authority map in `DESIGN.md`: which file owns values, behavior, composition, product requirements, and review decisions. Record the pilot task, its user/outcome, required states/media, and exclusions. Select one actual flow or artifact; ask only for missing facts that change it materially.

Produce a gap list with an action per gap: reuse, connect, create, or resolve. Example: “Tokens already exist; import their generated theme into the preview and add the existing generation check to design verification.” Do not replace a functioning pipeline to match the example tree.

## 2. Build the sources and their consumers

Implement the sequence in [patterns.md](references/patterns.md#build-in-this-order): token/theme connection, real components, a composed page, reproducible states, and rule/check mapping. Author only the contracts needed for the first flow, but complete that flow end to end.

When no token pipeline exists, [the bundled generator](assets/token-pipeline/generate-tokens.mjs) demonstrates a deterministic source-to-CSS pipeline with a failing drift check. Read its [usage and limits](references/patterns.md#runnable-token-pipeline) before adapting it. It covers one mechanism; it is not a complete harness or a replacement for an existing token format.

Extract project-specific choices from supplied artifacts and established decisions. Keep uncertain choices provisional. Do not present example colors, component names, viewport sizes, or limits from this skill as the user's brand policy.

## 3. Implement verification

Read [verification.md](references/verification.md) before implementing checks. Create a command that executes the applicable assertions and writes results tied to the current artifact. Reuse installed testing tools. A prose `check` field, a file-existence test, or a hardcoded passing report is not enforcement.

Verify contracts and sources first, then render the UI or exported medium. Exercise the task, failure/recovery path, keyboard/focus behavior where relevant, and content/layout stress cases. Save actual observations and images. Evaluate contextual quality against the brief separately from mechanical compliance.

Make mechanical failures fail the task-runner command and connect it to existing CI when in scope. Unexecuted checks and unresolved contextual judgments remain visible even when the mechanical command succeeds.

Share the checker between CLI, MCP, and any supported editor/hook entrypoint. Hooks report or block a detected problem; the task workflow owns correction attempts. Include what was checked, what cannot be checked, and why. Test the harness itself: references resolve, declared mechanical rules have implementations, changed contracts reach all generated views, and the checker rejects known violations.

## 4. Expose knowledge and install task Skills

Follow [agent-integration.md](references/agent-integration.md). Build searchable resources and resolve a task into its relevant contracts, component/pattern dependencies, and Skills. Use the same authority and checker as the local commands. Keep proposals outside this retrieval surface.

Install or adapt project Skills for implementation, review, and knowledge improvement. Give each a task-specific description, inputs, local reading path, real commands, output, and stopping conditions. Do not copy token values or component specifications into Skill prose. Reuse the target's supported discovery directories rather than assuming one agent client.

Add a short pointer to `DESIGN.md` in the existing agent entrypoint, preserving unrelated instructions. Put this workflow in `DESIGN.md`, with actual paths and commands:

1. Read the brief and select the relevant pattern, component, and token sources.
2. Implement the required states using those sources.
3. Run the design-check command and inspect its report and rendered evidence.
4. Correct specific failures; rerun affected checks against the new artifact revision.
5. Review meaning, hierarchy, and task fit; record unresolved choices for the responsible person.
6. Save the accepted result and update the smallest relevant contract or decision record.

Use an existing retry budget; otherwise start with at most two automatic correction attempts. Stop earlier when progress stalls, a required tool is unavailable, or the next change needs a new product decision. Preserve the last verified result. Do not lower the acceptance bar to make a run pass. This is a default for the workflow being built, not a reason to leave the user's authorized implementation unfinished.

## 5. Connect corrections to the next task

Implement [evolution.md](references/evolution.md): capture a concrete observation during work or wrap-up, propose the smallest knowledge change, record the responsible decision, apply accepted changes, refresh derived views, and verify a fresh task. Existing explicit authorization remains valid; do not invent approval or add repeat confirmation gates. Generalizing a local observation into new shared policy still requires the applicable decision.

Keep rejected proposals and reasons available to maintainers without injecting them as instructions. For multi-screen tasks, requirements handoff, or shared distribution, implement the relevant extension in [patterns.md](references/patterns.md#extend-for-the-actual-workflow) rather than replacing the team's workflow.

## 6. Demonstrate the complete path

Run the actual entrypoint on the pilot. Show a real violation, its reported rule ID and evidence, the correction, and the rerun. Use an isolated fixture for deliberate breakage. Check a neighboring case so the rule does not merely memorize one screenshot.

For MCP and learning, also show real transport retrieval, CLI/MCP agreement, an ignored pending/rejected proposal, and an accepted lesson consumed by a new run. The [runnable starter](references/agent-integration.md#run-the-bundled-starter) supplies a tested local example, not the target project's full UI or browser verifier. Copy it with [copy-starter.mjs](scripts/copy-starter.mjs); this also reuses the token generator without maintaining another implementation.

Finish when the deliverables in the selected path have real consumers and observable results. If a capability is missing, identify the unverified acceptance condition and complete independent work; do not claim the harness is operational. Respect requests limited to review or planning by producing findings or a build specification instead of editing product code.

Hand over the files, exact invocation, passed/failed/unexecuted checks, evidence paths, remaining human decisions, and the owner/update path. Keep this skill and its bundled references free of website links; record any newly researched source URLs only in the external bibliography and distill the needed content locally.
