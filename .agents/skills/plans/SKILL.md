---
name: plans
description: Turn a Plan-mode plan into reviewed implementation units and an execution checklist in a feature directory under docs/.
---

# Plans

Produce planning documents, without starting implementation. Respect the active mode's write restrictions; perform repository writes when permitted.

1. Create the plan file as usual in Plan mode. Choose a descriptive kebab-case `<feature-name>`.
2. Copy the full plan to `docs/<feature-name>/index.md`.
3. Launch a `reviewer` subagent to review `index.md` against the request and relevant repository context for missing requirements, inconsistent contracts, design flaws, and test gaps.
4. Evaluate the findings and update `index.md` for legitimate issues.
5. Split the reviewed detailed plan into dependency-aware implementation units: `01-<phase-name>.md`, `02-<phase-name>.md`, etc., in the same directory, by yourself (Do not use subagents). Keep `index.md` unchanged until step 9. Make each unit independently actionable, with explicit dependencies and contracts consistent with the index and other units.
6. Launch one `reviewer` subagent per unit file, running independent reviews in parallel as capacity permits. Give each reviewer its file, `index.md`, and relevant sibling contracts; request checks for completeness, consistency, implementability, and test coverage.
7. Collect every review, evaluate the findings, and fix legitimate issues in the unit files. Preserve cross-unit consistency.
8. Create `docs/<feature-name>/status.md` containing only checkbox entries in implementation order. Link every unit exactly once. Mark concurrent units with the same execution-group number and `parallel`; order groups by dependencies. Include no headings, explanations, or other content.
9. Rewrite `index.md` to add relative Markdown links to `status.md` and every numbered plan file at the top, with the plan files in implementation order. Preserve the reviewed detailed plan below these links.

## Plan contract

The original detailed plan and every unit file must include these headings:

- `## Context`: current behavior, motivation, constraints, and unit dependencies where applicable.
- `## External Goals`: externally observable outcomes and acceptance criteria.
- `## Design`: responsibilities, boundaries, and rationale, preserving implementation freedom where contracts allow it.
- `## Protocols`: inputs, outputs, broadly defined API and inter-component contracts, error behavior, and relevant invariants.
- `## Tests to add/update`: behavioral tests tied to goals and contracts, including relevant failure cases; explain when no tests need changing.
- `## Tech Stack`: original plan defines the macro technology stack, while the unit files detail the libraries and tools to be used.

Pass development intent and verifiable contracts to implementers while maintaining abstraction; avoid prescribing incidental implementation details.

Example `status.md` (entries only):

```markdown
- [ ] 1. [Foundation](01-foundation.md)
- [ ] 2. parallel: [Service](02-service.md)
- [ ] 2. parallel: [Client](03-client.md)
- [ ] 3. [Integration](04-integration.md)
```
