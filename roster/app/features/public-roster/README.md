# public-roster

The one fully public, unauthenticated screen in this app: `/r/:viewToken`
(docs/roster/09-share-public-views.md). No table of its own — this feature
only reads `events`/`roster_sheets`/`time_slots`/`tracks`/`roles`/`applications`/`assignments`
through other features' existing accessors and reshapes the result into a
data surface that is deliberately smaller than what the owner-only
`~/features/roster/` screens can see.

Entry points:

- `types.ts` — the wire contract (`PublicRosterData`, `PublicRosterView`) copied
  verbatim from docs/roster/09-share-public-views.md "Design" §3. This is the
  exhaustive list of fields the public loader may ever return; nothing in
  this feature should widen it without updating that section of the stage
  doc first.
- `public-roster.server.ts` — `buildPublicRosterData`, the single function
  that assembles `/r/:viewToken`'s entire response. Two rules it enforces
  structurally: the selected sheet's `visibility` gates ASSEMBLY (a private
  sheet never even queries `applications`/`assignments`, not just "queries
  them but hides the result"), and the published branch builds `PublicRosterData`
  field-by-field rather than spreading a D1 row, so a later PII column added
  elsewhere can't silently ride along. `public-roster.server.test.ts` asserts
  both properties directly — the exact returned key set, and (via a D1-call
  spy) that no query runs when the selected sheet isn't published.
- `timeline.ts` — `buildPersonTimeline`, pure per-person merge logic for the
  individual view: consecutive slots with the same (track, role) collapse
  into one entry, a gap becomes an explicit `"break"` entry, and a merged
  range's co-assignees are the union across every slot in it (not just the
  first), so someone who took over partway through a merged range is still
  named. No D1, no React — independently unit-tested.
- `components/` —
  - `PublicStaffGrid` — the public default view (vertical = time, horizontal
    = staff). Visually the owner-only `~/features/roster/components/StaffGrid`
    shape, reusing `roster/grid.ts#groupAssignmentsByApplication`, but with no
    experience-level header and no click handler.
  - `PersonTimeline` — the individual view. **The screen this whole stage
    exists for** (docs/roster/09-share-public-views.md Context: staff check
    this on their phone the morning of the event).
  - `PartyList` — the 懇親会 tab: 3 groups (参加/未定/不参加) with a headcount
    and names each. Hidden by the route entirely when `event.hasParty` is
    false.

The role view doesn't get its own component here — `app/routes/r.$token.tsx`
reuses `~/features/roster/components/RoleGrid` directly with its new
`readOnly` prop (docs/roster/09-share-public-views.md: "作り直さない"), fed a
synthetic per-column `Demand` map (public data carries no real demand
numbers at all) purely so `buildGridColumns`/`buildRoleGridColumn`'s existing
column-derivation and merge-by-membership logic can be reused unchanged —
see that route file's module doc comment for why the numbers in that map are
dummies.

## The PII/experience-level constraint (ADR-005)

`PublicStaff` is `{id, name, party}` and nothing else — no `email`,
`contact`, `note`, `skills`, or `availability`; no experience level anywhere,
in any form (label, color, sort order). Withdrawn applicants are excluded
entirely, including any residual assignment row they still have (the
owner-only `StaffGrid` deliberately keeps such a row visible as a violation;
that nuance has no public equivalent — there is no "violation" concept on
this screen). `tests/architecture/public-view-exposure.test.ts` scans this
whole directory for a reintroduced `Level`/`LEVELS`/`"lead"`/`"exp"`
reference so this stays true even if a later change makes it "convenient" to
add one back.
