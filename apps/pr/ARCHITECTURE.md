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
| Delivery accounts per chapter, tinyurl activation, posting precheck, `SNS` / `TINYURL` bindings | `app/features/integrations/` — `bindings.server.ts` is the only place the bindings are cast to the gdg-lib `PrService` types |
| Dispatch targets (one per item × X account, approved by that account's chapter), sns scheduling, delegation, status polling, reminders | `app/features/dispatch/` — `target.ts` decides who approves; `dispatch.server.ts` holds the `dispatching` compare-and-set |
| Short links (`{{shortlink}}` → url.gdgs.jp) and their health | `app/features/links/` |
| Discord webhooks (chapter settings, encrypted), message text from `constants.reminders.templates` | `app/features/notify/`, `app/features/settings/` |
| Staff reminders to send, speaker requests, outreach replies (approvals page) | `app/features/requests/` |
| Cron jobs (minute: requeue, reminders; hourly: sns status, link health) | `app/features/cron/cron.server.ts` (crons match `wrangler.toml`, tested) |
| connpass: page publishing on approval, survey, mails at their time, sub-events, thumbnail, publish, and the ledger of connpass jobs (`connpass_jobs`) the hourly cron follows | `app/features/connpass/` — writes only through `CONNPASS.PrService` jobs; never `create_event` |
| connpass page rendering (slots → HTML with the Playbook's renderer and section templates) and the preview | `app/features/pages/` — the agent's HTML is never used |
| Listings on Luma / TECH PLAY / Findy / Bevy: mapped from the brief (no runner), approval through `CONNPASS.createListing` or copy-and-mark-done by hand; Findy once per campaign | `app/features/listings/` |
| Images: template slots → HTML (`skills/pr-playbook/scripts/render/image-html.mjs`) → Browser Rendering snapshot → R2 `IMAGES`, render checks measured in the page; approval publishes to img.gdgs.jp (`IMG_UPLOAD`) and hands off (connpass thumbnail JPEG ≤ 1 MB, short-link OGP, post attachment, connpass page slot) | `app/features/assets/` |
| Live posts from the timetable (no LLM), with optional session cards | `app/features/live/` |
| Metrics: hourly tinyurl / connpass snapshots (aggregates only), ads CSV import with saved column maps, the dashboard with the goal curve | `app/features/metrics/` |
| Ad flights (from the adopted plan's budget), overrun alerts once per flight, X : IG split | `app/features/budget/` |
| Weekly analysis (`analyze` job, `pr-analyze`): report draft, proposals applied by a person | `app/features/analyze/` |
| Learning loop: human edits recorded per JSON leaf (`draft_edits`), the `retro` job (`pr-retro`), Playbook proposals decided by organizers and exported for `skills/pr-playbook/scripts/feedback.mjs` | `app/features/learning/`, `app/routes/playbook/` |
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
- Only a dispatch target's approval writes outside (sns, tinyurl), as the approver's live claims.
  Cron only follows status and sends Discord messages; it acts for stored claims snapshots
  (`dispatch_targets.actor_snapshot`, `campaigns.actor_snapshot`) and logs `no_actor` without one.
- A connpass page's `html` is rebuilt from its slots on every import and edit
  (`pages/render.ts`, `skills/pr-playbook/scripts/render/`). A connpass mail is approved per group
  target but sent by the minute cron at the item's time, never on approval.
- Images are never drawn by the agent: it returns slots and bounded `layoutVars`; the Worker
  builds the HTML with the same function the Skill's local renderer uses. Locally,
  `PR_RENDER_URL` points at `e2e/render-server.ts` (Playwright) because Browser Rendering does not
  run locally. Fonts are not deployed yet (embedding rights to confirm), so `RENDER-FONTS-LOADED`
  is `unevaluated`.
- `{{shortlink}}` is replaced on the copy sent to sns; `draft_versions.content` keeps it.
- Discord message text is never in TS (`reminders.server.test.ts`); webhook URLs are AES-GCM
  encrypted with `SETTINGS_ENCRYPTION_KEY` and never shown or logged.
- `pnpm dev` binds `SNS` / `TINYURL` / `CONNPASS` to `e2e/mock-services` (auxiliary workers); set
  `PR_REAL_SERVICES=1` to use real sns / tinyurl dev servers through the dev registry.
- The Worker never writes the Playbook or the Wiki: accepted proposals are exported and written
  back by `feedback.mjs` (rules with an existing check and constants only, refused on a stale
  `baseRevision` or personal data); the retro's Wiki update is shown for a person to paste.
- Times are epoch seconds in D1 and JST in every form (`schedule/calendar.ts`).
