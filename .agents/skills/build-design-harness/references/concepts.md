# Design harness concepts

A design harness connects design knowledge to the work that consumes it and to the evidence used to improve that work. Its value comes from making useful decisions reproducible while leaving room for judgment where the answer depends on context.

Use these concepts to choose the structure of a harness. The concrete artifacts are specified in [patterns.md](patterns.md), the communication-design path in [communication.md](communication.md), and the checks in [verification.md](verification.md).

## Connect four responsibilities

| Responsibility | Question it answers | What makes it operational |
| --- | --- | --- |
| Constraints | Which choices are allowed or required? | Tokens, APIs, composition rules, and assertions that affect implementation. |
| Context | What outcome matters, for whom, and why? | A brief, user/task information, examples, and rationale available at the point of use. |
| Verification | Does the actual result satisfy the relevant criteria? | Executed checks, observed behavior, rendered evidence, and contextual review. |
| Feedback | What should change in the next attempt or task? | A correction and a maintained update to the relevant knowledge or check. |

When a design system already exists, much of the constraint and context material may be available. Inspect how agents retrieve it and how outputs are checked before creating more documentation. If a rule is present but repeatedly ignored, the problem may be discovery, an unclear scope, a missing example, or absent enforcement.

One file can serve several responsibilities in a small project. Separate files or services when they have different owners, consumers, or update cycles. File count is not a measure of harness completeness.

## Delegate execution while retaining intent

State what the user should understand or accomplish, then preserve that intent across implementation, review, and revision. Distinguish decisions already made from choices the agent is authorized to make and questions that still need product or design judgment. Do not repeatedly ask for decisions the user has already supplied.

For a product flow, include entry, action, completion, failure, recovery, and relevant operational consequences. A polished screen may still strand a user after a rejected request. For a communication artifact, include the audience's arrival context, the message, evidence for claims, and intended next action. Correct colors do not compensate for the wrong promise.

When a request is limited to review, the harness can produce findings and a feedback destination without generating or editing the artifact. When the request is to build a generation workflow, complete the production and verification path as well.

## Preserve authority and distinguish kinds of knowledge

| Kind | Example | Treatment |
| --- | --- | --- |
| Fact | An installed component exports two supported variants. | Verify against the implementation and reference that authority. |
| Requirement | Failed submission must preserve edited values. | Record scope and acceptance conditions; implement a check where possible. |
| Preference | A particular campaign places evidence before its offer. | Preserve audience, alternatives, and selection rationale. |
| Open question | The brand has no approved rule for this medium. | Make uncertainty explicit; propose a scoped choice without claiming approval. |

An entry document should help consumers find authoritative information, not become a competing copy of it. Different sources may own token values, component behavior, product requirements, and contextual decisions. Make those boundaries explicit. A visual example can reveal existing practice, but it does not prove that every detail is intended policy.

For a new product without established foundations, propose the few decisions required by the first task and label their status. This allows useful progress without inventing customer evidence, brand rules, or stakeholder approval.

## Evaluate composition and relationships

When individually valid components produce an incoherent page, inspect the composition: grouping, density, emphasis, reading order, and the transition between states. Add a pattern or scenario that expresses the missing relationship. Changing a component globally to fix one page can damage other valid uses.

For communication work, a complaint about spacing or heading size may indicate a deeper hierarchy problem. Ask what the reader needs to see first, what supports it, and what they are expected to understand next. Adjust the structure when local styling cannot solve that problem.

Record context-dependent selections with reasons. A dense comparison can be appropriate when simultaneous scanning is the task; a sparse sequence can be appropriate when attention must follow a narrative. Neither observation justifies a universal density rule.

## Preserve intent between production stages

For LPs, campaigns, and decks with unsettled direction, separate the brief, narrative choice, composition, and visual refinement. Each stage should receive the selected intent and rationale from the previous one. This reduces the chance that a later styling pass silently changes the message.

A reusable section or slide pattern needs a purpose, required content, hierarchy, use conditions, and an editable example. A catalog of attractive screenshots alone does not explain when to use each arrangement.

When brand differentiation is an explicit goal, examine whether the proposed positioning depends on that brand's actual purpose or capabilities. Writing the message with competitor names substituted can make generic claims easier to discuss. Treat the result as contextual critique, not a deterministic originality test. Routine controls, instructions, and accessibility patterns benefit from familiarity and do not need a novelty requirement.

## Match evidence to the claim

Use executable checks for decidable requirements, such as generated-file consistency, supported APIs, or preservation of input after a failed request. Use rendered evidence and interaction to examine what the user actually sees and can do. Source-code inspection and screenshots establish different things; neither substitutes for all the others.

For judgments about relevance, hierarchy, identity, or task fit, define criteria with accepted and rejected examples and their reasons. The artifact and brief must be available to the reviewer; the producer's summary is insufficient evidence.

Keep an inability to evaluate visible. If a rule or observation is missing, record that gap. General design advice can be offered as advice, but must not masquerade as a product-specific compliance finding. Required failures remain failures even if other dimensions receive favorable scores.

## Bound evaluation and compare honestly

For repeated automatic revision, define acceptance conditions, a budget, a no-progress condition, and a route for unresolved decisions. More iterations can increase complexity or encourage superficial optimization toward a rubric. Preserve the best verified artifact rather than assuming the last revision is best.

When making a claim about improved generation quality, compare equivalent tasks with controlled model, tool, brief, and starter conditions. Keep baseline, harness-assisted, and corrected outputs separate, and record human intervention. A successful comparison illustrates behavior under those conditions; it does not establish a universal improvement rate.

For ordinary delivery, run checks proportionate to the task. A benchmark program or a second agent is not required merely to build a useful harness.

## Make knowledge available at the point of use

Keep the agent entrypoint small enough to orient the task: authority, retrieval paths, workflow, and commands. Put detailed component guidance near the component and task-specific context with the task. This makes relevant knowledge easier to find without injecting every rule into every session.

Make this executable: a catalog identifies authoritative records, a resolver selects task dependencies, MCP exposes retrieval/checking, and Agent Skills organize the work. Human reference views and machine responses should derive from the same maintained records. These are access paths, not separate owners of the design system. [agent-integration.md](agent-integration.md) supplies the build procedure.

When behavior across multiple screens matters, use a working prototype with consistent data and reproducible states. Static examples remain useful for appearance and hierarchy, but cannot demonstrate transitions or recovery.

For several products with genuinely different requirements, separate shared constraints, design-system knowledge, and product/task context. Reuse the production and verification mechanisms while preserving those differences. A single project does not need a distribution or synchronization platform just to mirror this organization.

## Curate feedback and design for adoption

Capture observations, adopted or rejected changes, reasons, and evidence in the team's normal workflow. Then decide what generalizes. Route each lesson to the smallest useful home: task decision, component guidance, composition pattern, or shared rule. Repeated mechanical failures are candidates for executable checks; one person's local preference is not automatically organizational policy.

Give maintained knowledge an owner and revalidation triggers, such as changes to tokens/components, product or brand requirements, recurring failures, or the agent/toolchain. Retire outdated or contradictory guidance instead of endlessly appending it. Logging and curation are separate activities; log collection alone does not establish improvement.

Separate proposals from authority, record acceptance or rejection with reasons, and verify that adopted knowledge is retrieved in a later task. Correcting today's output and changing tomorrow's guidance are different observable outcomes. The [evolution workflow](evolution.md) connects them without treating every observation as policy or every repeated task as an autonomous agent loop.

When rolling out to a team, make the first workflow easy to invoke, its output easy to inspect, and its feedback easy to submit. Prove one complete task with the tools people already use, then expand based on observed needs. Adoption, ownership, and maintenance are part of the harness because they determine whether the next task benefits from what was learned.
