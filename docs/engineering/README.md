# Engineering reference

- [Code comment policy](comments.md): default prohibition, reviewed exceptions, and the lexical check.
- [Workspace import boundaries](workspace-boundaries.md): application ownership and public shared-package entry points.
- [Application conventions](app-conventions.md): migrations and schema dumps, relying-party registration, dev ports, crons, LLM-free Workers, and test placement.
- [Effects and timers](effects.md): the ban on `useEffect` and raw timers, their replacements, the shrink-only baseline, and allowances.
- [Verification reference](verification.md): executable checks, runtime journeys, and coverage limits.
- [UI property tests and the staging fuzz loop](ui-properties.md): seeded action sequences, invariants, mutation proofs, and fix pull requests from staging failures.
- [Staging environments](staging.md): the three `stg-N` slots, PR deploy labels, nightly data sync, and the trust model.
- [AI review gate](ai-review.md): the required GDG-chan review, finding resolution, and the agent's sign-in.
- [Engineering observations](observations.md): delivery outcomes, source freshness, and browser timing provenance.
- [Foundation work plan](../plans/engineering-foundations/README.md): source interpretation, delivery phases, and acceptance.
- [Source review](../archive/reports/engineering-foundations-2026-11-17/sources.md),
  [validation record](../archive/reports/engineering-foundations-2026-11-17/validation.md), and
  [decision record](../archive/reports/engineering-foundations-2026-11-17/decisions.tsv): dated evidence, not current pass claims.
