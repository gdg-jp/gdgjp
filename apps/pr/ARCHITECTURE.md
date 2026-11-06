# pr architecture

| Responsibility | Code |
| --- | --- |
| RP session, chapter claims, sign-in redirects | `app/features/auth/` (copied from roulette) |
| Campaigns, host / co-host chapters, members and roles, permissions | `app/features/campaigns/` — `access.server.ts` is the only gate |
| Brief model (mirrors `skills/pr-playbook/references/brief.schema.json`), editor form, versions | `app/features/briefs/` — `parseBrief` validates with the Playbook schema itself |
| Schedule items, kinds, derived reminders, blocked-by conditions, calendar grouping | `app/features/schedule/` — `derive.ts` implements REMIND-STAFF-BEFORE-POST / SPEAKER-REQUEST-BEFORE-POST |
| Outreach contacts, Wiki import (`WIKI` binding, read-only) | `app/features/contacts/` |
| Bundled Playbook (rules, constants, guides, Skills, checker) | `app/features/playbook/` — imports `@skills/pr-playbook/…` |
| Runner jobs: queue, atomic lease, heartbeat, requeue; bundle (files + prompt + schema); import of results | `app/features/jobs/` — `bundle.server.ts`, `complete.server.ts` (schema validation, Playbook checks, one automatic fix) |
| Runner HTTP API (`RUNNER_TOKEN` only here) | `app/routes/api/runner/*` |
| Plans (runner output), adoption into the schedule | `app/features/plans/` — `adopt.ts` is pure, `adopt.server.ts` writes |
| Drafts: append-only versions, create → review → approve state machine, reviews, edits | `app/features/drafts/` — `state-machine.ts` is the only place transitions are decided |
| Domain-free widgets | `app/components/RowTable.tsx` |
| Shells | `app/layouts/AppLayout.tsx`, `CampaignLayout.tsx` (campaign tabs) |
| Screens + loaders / actions | `app/routes/<domain>/` — URLs in `app/routes.ts` |
| Worker entry | `workers/app.ts` |
| Schema | `migrations/` (`schema.sql` is generated) |

- Features never import routes; `app/lib` and `app/components` never import features; widgets import
  `*.server` modules only as types; routes contain no SQL (`tests/architecture/`).
- 400 lines per file at most; unit tests sit next to their subject.
- `schedule_items.kind` is checked in `kinds.ts` (it grows), statuses by a SQL CHECK.
  `kinds.test.ts` keeps the kinds equal to `docs/plans/pr/00-overview.md` §4.
- `draft_versions` is append-only: an edit, a runner rewrite and a fix are each a new version.
- The Worker never trusts runner output: `complete.server.ts` validates it against the Skill's
  output schema and runs the Playbook checks before anything is saved as a version.
- Times are epoch seconds in D1 and JST in every form (`schedule/calendar.ts`).
