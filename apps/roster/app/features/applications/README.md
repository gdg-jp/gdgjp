# applications

Staff self-registration and owner-side proxy registration (ADR-008): the `applications`,
`application_skills`, and `availabilities` tables. `/apply/:applyToken` is the public route this
feature exists to serve — see `docs/roster/04-applications.md`.

Entry points:

- `types.ts` — the domain vocabulary (`Level`/`Pref`/`AvailabilityValue`/`PartyStatus`), copied
  verbatim from `docs/roster/index.md` §3. The solver (Stage 06) depends on these exact strings.
- `claim.ts` — `resolveApplication`, the pure proxy-registration claim decision (ADR-008):
  `userId` match beats `email` match, and a claimed row (`user_id` non-null) is never claimable by
  someone else. No D1, no auth — independently unit-tested.
- `validate.ts` — `validateApplyForm`, pure form validation parameterized by the event's actual
  `event_roles`/`time_slots` ids.
- `form-fields.ts` — the `FormData` <-> role/availability field-naming contract shared by
  `ApplyForm` and `ProxyAddDialog` (`role_<id>`/`level_<id>`/`pref_<id>`/`avail_<id>`), so both
  routes that submit this shape (`apply.$token.tsx`, `e.$id.staff.tsx`) parse it identically.
- `applications.server.ts` — D1 access: `createApplication`/`updateApplication`/
  `withdrawApplication`/`claimApplication`, plus `resolveOwnApplication`, the ADR-008 orchestration
  that auto-claims a matching unclaimed proxy row and is what both `/apply/:token`'s loader and
  action use instead of trusting a client-submitted application id. Stage 05 adds
  `correctApplication`, the owner-correction write bundle (`/e/:id/staff`'s `StaffDrawer`):
  reactivates the row (`withdrawn: false`, same "save reactivates" convention as `/apply/:token`)
  and wholesale-replaces skills/availability, all attributed `updatedBy: "owner"`.
- `skills.server.ts` / `availability.server.ts` — `application_skills`/`availabilities` D1 access.
  Both are wholesale delete-all-then-insert on every save (mirrors
  `~/features/schedule/tracks.server#setEventRoles`'s shape) — there's no partial update path.
- `staff-view.ts` (Stage 05) — pure view-model assembly for `/e/:id/staff`'s staff list:
  `buildStaffRows` (role-id -> role-name resolution, o/d availability counts scoped to the event's
  current time slots) and `toStaffDrawerDetail` (the drawer's editable snapshot). Takes a
  structurally-`ApplicantDetail`-shaped input rather than importing
  `~/features/supply`'s actual type — `applications/` must not depend on `supply/` (docs/roster/
  05-staff-supply-demand.md "Design" §5: the dependency runs `supply/` -> `applications/`, never
  the reverse).
- `components/` — `ApplyForm` (the self-registration/edit form), `RoleSkillRow` (one role's
  checkbox + conditionally-shown level/pref selects), `AvailabilityGrid` (the ○/△/× grid with
  終日○/すべて×/午前のみ/午後のみ shortcuts), `ProxyAddDialog` (owner-side proxy-add entry point),
  `StaffTable` (Stage 05: the staff list), `StaffDrawer` (Stage 05: owner corrections — reuses
  `RoleSkillRow`/`AvailabilityGrid` verbatim rather than reimplementing the input UI).

## The public-route PII constraint

`/apply/:applyToken`'s loader (`app/routes/apply.$token.tsx`) must never return another
applicant's name/email/contact/skills/availability — only the viewer's own record plus
event-level, non-identifying data (the event summary, the recruiting roles, the time-slot grid).
`apply.$token.test.ts` asserts this directly on the loader's raw return value against a
two-applicant seed, not just on what the UI happens to render — see that file's doc comment
before changing what the loader returns.

## Two-UNIQUE-index dedup (ADR-008)

`(event_id, user_id)` (partial, `WHERE user_id IS NOT NULL`) and `(event_id, email)` — both
verified against a real SQLite engine in `applications.server.test.ts` via
`tests/helpers/sqlite-d1.ts`, not a hand-mocked `D1Database`. A proxy registration
(`user_id IS NULL`) is claimed by filling in `user_id`, never by creating a second row.
