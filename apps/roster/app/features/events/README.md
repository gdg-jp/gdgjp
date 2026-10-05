# events

The `events` table: CRUD and the 5-state recruitment lifecycle (`draft` → `open` → `closed` →
`published` → `ended`, freely reversible). `canApply` gates staff registration at
`/apply/:applyToken` (Stage 04). Public schedule visibility at `/r/:viewToken` (Stage 09) is
controlled by the default roster sheet's `visibility` — see `docs/roster/index.md` §3.

Entry points:

- `events.server.ts` — D1 access (`createEvent`, `getEvent`, `listEventsForChapters`,
  `updateEventSettings`). `apply_token`/`view_token` are random, independent of `id`. Every read
  filters `deleted_at IS NULL`.
- `status.ts` — the pure recruitment status lifecycle and registration predicate.
- `components/` — `EventForm` (`/events/new`), `EventCard` (the `/` list row),
  `EventSettingsForm` (the `/e/:id/design` settings card).

The time-slot grid, tracks, and roles are a separate feature: `~/features/schedule/`.
