# discord

Discord integration: bot API, user OAuth, token storage, and task reminders.

- `api.server.ts` — bot REST calls (guilds, channels, messages) + `authorDisplayName`.
- `oauth.server.ts` / `token.server.ts` — user OAuth flow + `discord_oauth_tokens` rows.
- `reminders.server.ts` — `sendDueTaskReminders`, invoked by the `TASK_REMINDER_CRON` branch of `workers/app.ts`.

Caveat: the cron branch is production-only — `workers/app.scheduled.test.ts` pins the wiring.
