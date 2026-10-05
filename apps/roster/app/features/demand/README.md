# demand

The `demands` table: `min`/`ideal`/`leadMin`/`newMax` per `(time_slot, track, role)`
(`docs/roster/index.md` §4, §5). `ideal === 0` means exactly the same thing as the row not
existing — every function here preserves that equivalence on both the read and write side.
Feeds the `/e/:id/design` demand matrix now; from Stage 06 onward it's also the solver's demand
input.

Entry points:

- `types.ts` — the `Demand` domain type. Field names (`min`/`ideal`/`leadMin`/`newMax`) follow
  the solver-spec names in `docs/roster/index.md` §5, not the SQL column names
  (`min_count`/`ideal_count`).
- `validate.ts` — pure invariant checks (`validateDemand`). The one call-out: rejecting
  `leadMin > ideal` — an unmet `leadMin` would sit at rank 1 of the solver's scarcity ordering
  forever (index.md §5.2) and starve every other slot's fill order.
- `impact.ts` — pure `demandLossOnSlotChange`, reusing Stage 02's `reconcileSlotKeys` (not
  reimplemented) to report how many demand rows a time-slot grid regeneration would delete, and
  `demandLossByStepMinOption`, which precomputes that count for each candidate step-size option
  so `~/features/events/components/EventSettingsForm`'s real stepMin select can warn
  ("N件の需要が失われます") before its own submit goes through, via a `confirm()` gate.
- `matrix.ts` — pure row/column assembly for the demand matrix UI: `buildColumns` (only the
  (track, role) pairs with real demand), `buildPhaseRows`/`buildSlotRows` (phase-wide vs.
  per-slot rows, with the phase row's `uniform` flag driving the UI's `*` marker), and
  `timeSlotIdsForTarget` (expands a clicked row into the slots a write fans out to).
- `demand.server.ts` — D1 access (`listDemandsForEvent`, `getDemand`, `bulkUpsertDemands`,
  `upsertDemand`). Every read filters `ideal_count > 0`; every write deletes rather than storing
  an `ideal = 0` row, so a missing row and an explicit zero-ideal row are indistinguishable to
  every caller.
- `components/` — `DemandMatrix` (the `/e/:id/design` card: mode toggle, "役割を追加", the
  table), `DemandCell` (one cell button), `DemandDrawer` (the min/ideal/leadMin/newMax editor +
  bulk-copy-to-other-tracks/-phases form).

Time slots, phases, tracks, and roles themselves are a separate feature: `~/features/schedule/`.
