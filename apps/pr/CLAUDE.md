# CLAUDE.md — `@gdgjp/pr`

pr.gdgs.jp — event PR (marketing) assistant. Repo-wide conventions in `../../CLAUDE.md`.
Plan: `docs/plans/pr/00-overview.md` (read it first), stage files `01-*.md` … `09-*.md`.

## What it is

One campaign per event. A brief (the event's facts, meta-themes, sessions, speakers, budget) drives
a schedule of posts, mails, asks and reminders. Later stages add runner-written drafts, review and
approval, delivery through sns / tinyurl / connpass, images, metrics and a learning loop.

- **The Worker never calls an LLM.** Drafts come from the OCI runner (`gdg pr runner`, Stage 02).
- **The Playbook is bundled from `skills/pr-playbook`** (gdg-jp/skills submodule): rules, constants,
  guides and the checker (`app/features/playbook/`). The build fails without the submodule.
  Do not copy Playbook rules into TS; read `constants` / `rules`.
- **Contacts' source of truth is the Wiki** page `WIKI_OUTREACH_TITLE`, read AS the signed-in user
  through the `WIKI` binding (`/api/agent/search`, `/api/agent/cat` only). pr never writes the Wiki.

## Runner

`gdg pr runner` (apps/cli/internal/pr/runner) on the OCI VM leases `agent_jobs` through
`/api/runner/*` with secret `RUNNER_TOKEN` (not the wiki's). Each job gets a bundle of files
(`app/features/jobs/bundle.server.ts`): the Skill's SKILL.md and output schema, the Playbook parts
it reads, the check scripts, BRIEF.json and JOB.md. Codex runs read-only and returns JSON; the
Worker validates and checks it (`complete.server.ts`). Locally:

```sh
GDG_PR_URL=http://localhost:5191 RUNNER_TOKEN=<.dev.vars value> YOMIYASU_DIR=… gdg pr runner --once
```

## Delivery

Nothing goes out without approval. A post's draft is approved once; then each X account
(`campaign_accounts`, per chapter) is a dispatch target approved by a member of **that account's
chapter**, and only that approval calls `SNS.createScheduledPost` as the approver. `{{shortlink}}`
becomes a url.gdgs.jp link (`TINYURL.createLink`) created at draft approval. Crons follow sns status,
send staff reminders / review requests / follow-ups to the chapter's Discord webhook
(`/settings/chapter`, encrypted with `SETTINGS_ENCRYPTION_KEY`) and check link health. Locally,
`pnpm dev` serves `SNS` / `TINYURL` from `e2e/mock-services`; `/dev/cron?name=minute|hourly` runs a
cron (`PR_REAL_SERVICES=1` uses real sns / tinyurl dev servers instead).

## Access

Campaigns belong to a host chapter; co-host chapters join through `campaign_chapters`. Members of
either can see and edit the schedule. Brief, settings, co-hosts and members need `manage`: the lead
(`campaign_members.roles` has `lead`), the host chapter's organizer, or a super admin
(`app/features/campaigns/access.server.ts`). Others get 404.

## Dev

```sh
pnpm --filter @gdgjp/pr migrate:local
pnpm --filter @gdgjp/pr dev          # :5191; /dev/login?as=x&chapter=1:slug:organizer
pnpm --filter @gdgjp/pr test
pnpm --filter @gdgjp/pr test:e2e     # needs the skills submodule (brief fixture)
```

`.dev.vars` from `.dev.vars.example`. Dev-login sessions have no access token, so the Wiki import
needs a real sign-in through a local accounts server.

## Code map

See `ARCHITECTURE.md`.
