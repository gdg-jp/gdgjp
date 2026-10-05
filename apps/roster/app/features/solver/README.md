# solver

Pure TS greedy-fill + local-search shift solver (`docs/roster/index.md` §5,
`docs/roster/06-solver.md`). No D1, no React, no `fetch`, no `window` — plain
objects in, plain objects out (ADR-004). Stage 07 is the only thing that will
ever call `solve()` from inside a route/action.

**Deliberately does not import from `~/features/demand` or
`~/features/applications`** (Stage 03 / 04, built in parallel from the same
base). This module defines its own `SolverInput` / `SolverApplication` /
`Assignments` / `Report` in `types.ts`; Stage 07 is responsible for mapping
real D1 rows onto these plain types.

## Entry points

- `types.ts` — every solver I/O type, plus the key-string helpers
  (`demandKey`, `assignmentKey`, ...) that every other file in this feature
  shares. `Assignments`' key shape (`${applicationId}|${slotId}`) is the
  actual implementation of the "never double-book a slot" hard constraint —
  see its doc comment before changing it.
- `random.ts` — `mulberry32`, the *only* randomness source anywhere in this
  feature. Never `Math.random()`.
- `constraints.ts` — `hardViolations`: the 5 conditions auto-generation may
  never violate. Returns a list of warning strings, never throws, never
  blocks by itself — `solve()` is the only caller that treats a non-empty
  result as "skip this candidate"; Stage 07's manual-edit flow reuses the
  same function to warn-and-allow instead.
- `cost.ts` — `candidateCost`, the §5.3 cost table applied exactly as
  specified. Lower is better (a dissatisfaction-minimization score).
- `scarcity.ts` — `orderDemandCells`, step ① of the 7-step flow.
- `solve.ts` — orchestrates steps ①-⑦: runs the lead/min/ideal greedy fill
  itself (steps ②-④), then calls `local-search.ts` (⑤), `ojt-swap.ts` (⑥),
  and `evaluate.ts` (⑦). Also defines `EngineState` (the mutable bookkeeping
  shared across phases: `assignments`, per-app `load`, per-cell `cellMembers`,
  per-app `appSlots`) and `Movers` (the only way `local-search.ts` /
  `ojt-swap.ts` may mutate that state). Those two files import `EngineState`
  / `Movers` as **types only** — under this repo's `verbatimModuleSyntax`
  that's fully erased at compile time, so despite `solve.ts` importing their
  functions as values, there is no runtime circular import.
- `local-search.ts` — step ⑤: evens out load, respecting `leadMin`/`newMax`
  on every move, never touching a `locked` assignment.
- `ojt-swap.ts` — step ⑥: pairs an all-newcomer cell with an experienced
  person from a different cell in the same time slot; never swaps if the
  donor cell would end up with nobody experienced.
- `evaluate.ts` — step ⑦, and independently callable: Stage 07's manual-edit
  flow and Stage 08's history comparison re-run this same function on
  hand-edited or historical `Assignments`, so it holds no state of its own
  and imports nothing from `solve.ts`.
- `suggest.ts` — `suggestFor`, candidate suggestions for Stage 07's
  manual-edit UI. Returns every applicant (including hard-violation
  candidates, with warnings) — never filters the list down.
- `fixtures.ts` — deterministic synthetic `SolverInput` generator (driven by
  `mulberry32`, not `Math.random()`) used by the test suite and the bench.

## Scale bench

`solve.bench.test.ts` runs the required 100-staff x 60-slot x 10-role x
4-track case (`docs/roster/06-solver.md` Design §8) and asserts it finishes
within a generous 10s CI-noise margin. The actual measured wall time is
reported in the Stage 06 PR description, not just asserted against the
budget — that number is the real input to whether Stage 07 can call this
synchronously from a Worker action (ADR-004) or needs to look at
client-side execution instead.

## Determinism

`solve(input)` and `solve(input)` called again **must** return a deeply-equal
`Assignments` map. This is the single most load-bearing property of this
feature — see `solve.test.ts`'s first test and `random.ts`'s doc comment.
Every place iteration order matters (application lists, cell lists, Set/Map
membership) is built from caller-supplied arrays or deterministic insertion,
never from hash-based ordering that could vary.
