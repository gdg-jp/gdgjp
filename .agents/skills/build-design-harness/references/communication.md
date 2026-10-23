# Building a communication-design harness

Use this for LPs, campaign graphics, and presentation decks. Build reusable assets and the first real output in the target's existing authoring/export tools.

## Deliverables

| File or equivalent | Contents | Consumer |
| --- | --- | --- |
| `DESIGN.md` | Brief/brand/pattern locations, workflow, check/export commands | Producing agent and reviewer |
| `design/brand.md` | Approved vocabulary, imagery/logo rules, type/color roles, examples, reasons | Copy, layout, asset selection |
| `design/brief.md` | Audience, arrival context, message, factual evidence, desired action, medium, constraints | Narrative selection and review |
| `design/patterns/` | Section/slide purpose, required content, hierarchy, use conditions, editable example | Page/deck composition |
| `design/story.md` | Selected narrative, section order, alternatives, selection reason | Wireframe and final artifact |
| `design/rubric.md` | Mechanical requirements and contextual criteria kept distinct | Checks and reviewer |
| Native source and rendered/exported output | Actual HTML, deck, or graphic and its delivery format | End user and inspection |
| `design/decisions.md` and run evidence | Changes, reasons, observations, and outputs tied to revision | Next task and maintenance |

A slide deck does not need web component contracts. An interactive LP also uses the UI path's component/browser checks.

Use [agent-integration.md](agent-integration.md) for task Skills and retrieval: expose the brief, approved assets, brand rules, narrative, patterns, and rubric instead of inventing UI components for a deck or graphic. Provide creation/review/improvement workflows with the native authoring and export commands. A catalog can point to local native assets; never claim the starter's HTML checker can inspect a slide deck.

## Brief example

```markdown
Artifact: Webinar registration landing page.
Audience: Existing customers responsible for monthly reporting.
Arrival context: A product email links directly here.
Message: Learn the product's supported reporting workflow.
Desired action: Register for the session.
Facts needed: Approved title, date/time, speaker, agenda, registration terms.
Evidence: Identify the supplied source of each factual claim.
Medium: Responsive web page, including registration outcome.
Constraints: Use existing brand assets and approved terminology.
Open questions: Record missing facts; do not invent them.
```

Fill it from the task and materials. The desired action does not establish conversion evidence or authorize fabricated claims/testimonials.

## Pattern catalog entry

```markdown
Pattern: Event introduction.
Use when: The reader needs to judge relevance before registering.
Inputs: Title, audience benefit, date/time, registration action.
Hierarchy: Title/benefit first, logistics next, primary action easy to find.
Composition: Group facts with labels; associate the action with those facts.
Brand choices: Apply the project's approved type roles and spacing.
Checks: Required facts present; no clipped text at supported sizes;
the action reaches its documented outcome.
Review: Does the opening match the promise of the referring email?
```

For a comparison slide, define common dimensions, aligned units, explicit tradeoffs, and an evidence-supported conclusion. Include an editable example in the native format. A description alone is not an authoring template.

## Brief to story to composition

1. Complete the brief from known information; expose missing facts.
2. If direction is unsettled, compare materially different narratives: benefit-first, problem-first, or evidence-first when supported. Show the opening, section order, and reason for each.
3. Record the chosen order and actual rationale. Preserve existing user decisions instead of imposing another approval ceremony.
4. Map sections/slides to catalog entries and create a wireframe in the target format.
5. Apply approved assets/type, render/export, and inspect intended viewing sizes.

For the webinar example, one proposed order is benefit/logistics, audience, agenda, speaker evidence, registration. Validate it against the brief; do not impose it on every LP.

## Implementable checks

- Compare required names, dates, and numbers against authoritative supplied content.
- Verify approved assets exist, render, and meet declared crop/placement constraints.
- Export/open the actual medium; inspect clipping, overflow, missing fonts/images, unreadable labels, and omitted content.
- For an LP, exercise links/forms, keyboard/focus, errors, success, and narrow layouts.

Use [verification.md](verification.md) for status, exit behavior, evidence, and revision. Text presence can be checked mechanically; effective communication also needs contextual judgment.

## Contextual rubric

| Criterion | Question answered from the artifact |
| --- | --- |
| Purpose | Is the intended outcome understandable? |
| Relevance | Does it fit the audience's situation and arrival promise? |
| Structure | Is necessary information presented before the decision? |
| Identity | Which specific choices fit this brand? |
| Focus | What can be removed without losing meaning? |
| Craft | Do type, alignment, spacing, proportion, and media support the hierarchy? |

Attach examples and reasons to relevant criteria. Do not average away incorrect facts or broken interactions.

If differentiation is required, write the core message with competitor names substituted and discuss what brand-specific meaning remains. This is a critique exercise, not a deterministic originality test. Familiar navigation, instructions, and accessibility patterns do not need a novelty gate.

When spacing adjustments fail, inspect relationships: what should appear first, what supports it, and what the reader expects. Record “in this context, we selected this arrangement because…” instead of a global whitespace rule. This preserves useful judgment without overgeneralizing it.

Feed that record through [evolution.md](evolution.md). Propose the relevant pattern, rubric, or brand-reference change, retain the responsible decision, refresh its retrieval path, and verify a second artifact reads the adopted guidance. A campaign-specific selection must retain its audience/medium scope; rejected alternatives remain maintainer context, not instructions for the next campaign.
