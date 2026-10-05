# tasks

Per-chapter task lists: table / timeline / remaining views, dependencies, team assignment.
Routes are `app/routes/tasks/` and `app/routes/api/tasks/`; DB tables are `app/db/schema/tasks.ts`.

- `task-options.ts` — status / type enums + chip styles.
- `task-utils.ts` — date range, due-date formatting, weekend helpers.
- `useAnchoredMenu.ts` — shared popover-anchoring hook (used by dropdowns).
- `components/` — 13 view/row/dropdown components (`Task*View`, `TaskRow`, `NewTaskRow`, `TeamManager`, …).

Note: the three non-UI files sit at the feature root, not under `components/`.
