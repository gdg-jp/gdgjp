# supply

The demand-vs-applications cross-check: "does a candidate exist" for each (time slot, role),
distinguishing a headcount shortage from an experience (lead) shortage
(`docs/roster/05-staff-supply-demand.md`, `docs/roster/index.md` §5.8). Feeds `/e/:id/staff`'s
supply-demand view. **The solver is not involved** — this is a rough upper-bound estimate of
candidate counts, not a guarantee that an assignment exists (Stage 06/07's job).

A new feature, not folded into `demand/` or `applications/`: `demand/` is the input side and
`applications/` is the registration side, and mixing the cross-check into either would blur that
boundary. `supply/` imports both — the correct direction (docs/roster/05-staff-supply-demand.md
"Design" §5) — and neither of those features imports back from here.

Entry points:

- `supply.ts` — pure, no D1: `computeSlotSupplyDemand`/`computeSupplyDemand` (the per-time-slot
  `need`/`available`/`tight` snapshot), `summarizeShortages` (event-wide, deduplicated (role, kind)
  shortages for the recruiting-announcement summary), and `toSupplyApplicant` (mapping Stage 04's
  `ApplicationRecord`/`ApplicationSkillRecord`/`AvailabilityRecord` into this module's own
  `SupplyApplicant`). `roleShortage`'s doc comment is the actual implementation of this stage's
  core rule: **`head` and `lead` shortages are never both reported for the same (slot, role)** —
  headcount takes priority.
- `supply.server.ts` — D1 orchestration: `listApplicantDetailsForEvent` (every application for the
  event with its skills/availability rows attached, reusing `~/features/applications`' reads
  verbatim) and `getSupplyDemandForEvent` (assembles `supply.ts`'s input via `~/features/demand`
  and the above, then calls `computeSupplyDemand`). Accepts a pre-fetched `applicantDetails` list
  so a caller that also builds the staff list in the same request (`/e/:id/staff`) doesn't
  re-query `application_skills`/`availabilities` twice.
- `components/` — `SupplyDemandRow` (one time slot's need/available + shortage badges) and
  `ShortageSummary` (the top-of-page registered-count + recruiting-announcement-ready shortage
  list).

## The estimate caveat

`computeSupplyDemand`'s counts are an upper bound: the same applicant can cover several roles, so
"3 candidates for reception, 2 for stream" does not mean 5 people can be placed simultaneously.
Every UI built on this module's output must show that caveat rather than imply a guarantee —
see `docs/roster/05-staff-supply-demand.md` "Design" §1.
