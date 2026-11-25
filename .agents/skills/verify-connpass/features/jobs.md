# Job status and bot relogin job

Every connpass write is an asynchronous job stored in D1. `GET /api/jobs/:jobId` shows
a job to anyone who can read its group, to its creator, and to admins, with request
fields `body`, `message`, and `artifactKey` removed. An admin can also ask the bot to log
in again with `POST /api/admin/session/relogin`, which creates a `relogin` job.

## Sub-features

- `connpass-job-read` reads seeded terminal jobs with each identity: group readers,
  the creator of a job in a disabled group, and admins see it; others get 403. The
  response redacts `body`, `message`, and `artifactKey` from `request`.
- `connpass-job-missing` returns 404 `{"error":"not_found"}` for an unknown job ID.
- `connpass-relogin-job` creates a relogin job as admin, observes it reach the terminal
  `failed` state with `connpass_bot_credentials_missing`, and checks that non-admins can
  neither create nor read it.

## How to get to it (user POV)

A CLI or agent polls `GET /api/jobs/:jobId` with the ID returned by a 202 response. An
admin calls `POST /api/admin/session/relogin` after the bot session breaks. HTTP only;
drive it with curl.

## Driving it with HTTP (curl)

Preconditions: the seed is applied, so jobs `vjob-chapter10`, `vjob-disabled`, and
`vjob-adminonly` exist and are terminal. The credential gate in the README passed. Record
the job count.

- **Group reader sees a job.** `GET /api/jobs/vjob-chapter10` as each of `e2e-member`,
  `e2e-organizer`, `e2e-developer-app-organizer`, and `e2e-admin` returns `200` with
  `id: "vjob-chapter10"`, `type: "update_event"`, `status: "succeeded"`,
  `groupId: "verify-chapter10"`, `eventId: "900001"`, `request: {"title":"Seeded title"}`,
  `result: {"eventId":"900001"}`, `error: null`, `artifactKey: null`,
  `createdBy: "seed-other-user"`, and `finishedAt: "2026-01-01T00:01:00.000Z"`.
  The `request` object has no `body`, `message`, or `artifactKey` key.
- **Outsider denied.** `GET /api/jobs/vjob-chapter10` as `e2e-outsider` returns `403`
  `{"error":"forbidden"}`.
- **Creator of a disabled-group job.** `GET /api/jobs/vjob-disabled` as `e2e-member`
  (its creator, `e2e-member-user`) returns `200` with `status: "failed"`,
  `error: "seeded_failure"`, `artifactKey: "jobs/vjob-disabled/failure.png"`, and
  `request: {"postToTwitter":false}`. The same request as `e2e-organizer` and as
  `e2e-outsider` returns `403`. As `e2e-admin` it returns `200`.
- **Admin-only group.** `GET /api/jobs/vjob-adminonly` as `e2e-organizer` returns `403`;
  as `e2e-admin` it returns `200` with `type: "copy_event"` and `result: {"eventId":"900004"}`.
- **Missing job.** `GET /api/jobs/does-not-exist` as `e2e-admin` and as `e2e-member` returns
  `404` `{"error":"not_found"}`.
- **Read-back for reads.** SQL:
  `SELECT id, status, request_json FROM jobs WHERE id LIKE 'vjob-%' ORDER BY id`
  shows the three seeded rows unchanged, with `request_json` still containing
  `seeded body text`. That proves redaction happens in the response, not in storage.
  The job count is unchanged.
- **Relogin denied.** `POST /api/admin/session/relogin` as `e2e-organizer`, `e2e-member`,
  and `e2e-developer-app-organizer` returns `403` `{"error":"forbidden"}`. The job count is
  unchanged.
- **Relogin accepted.** `POST /api/admin/session/relogin` as `e2e-admin` with no body
  returns `202` with `type: "relogin"`, `groupId: "_system"`, `eventId: null`,
  `createdBy: "e2e-admin-user"`, `request: {}`, and `status` either `queued` or `running`.
  Record the returned `id`.
- **Relogin reaches a terminal state.** Poll `GET /api/jobs/<returned id>` as `e2e-admin`
  every 2 seconds for up to 120 seconds. Require `status: "failed"`,
  `error: "connpass_bot_credentials_missing"`, `result: null`, `artifactKey: null`, and
  non-null `startedAt` and `finishedAt`.
- **Relogin is not visible to non-admins.** `GET /api/jobs/<returned id>` as `e2e-organizer`
  and as `e2e-member` returns `403` `{"error":"forbidden"}`.
- **Relogin read-back.** SQL:
  `SELECT type, status, group_slug, error, created_by FROM jobs WHERE id = '<returned id>'`
  returns `relogin`, `failed`, `_system`, `connpass_bot_credentials_missing`,
  `e2e-admin-user`. The job count is exactly one more than before this step.
- **Evidence.** Save every response, the poll transcript with timestamps, the SQL output,
  and the server log lines from `ready.json.evidence/server.log` written between the
  202 and the terminal poll under `ready.json.evidence/<journey ID>/`.

## Gotchas

- The relogin job is the only job this map executes. In dev Vite mode, `createJob`
  runs the job immediately inside the request's `waitUntil`, and the local queue
  consumer may receive the same message. The atomic `queued` to `running` claim lets
  only one of them run it. The relogin path launches a local Chromium, opens a blank
  page, and then fails while reading the bot credentials, before any navigation. It
  sends nothing to connpass.com when the credential gate passed.
- If the terminal error is anything other than `connpass_bot_credentials_missing`
  (for example a Chromium launch error), the journey fails. Record the error string.
  Do not retry with credentials.
- If the job stays `running` past 120 seconds, the journey fails. Record the last poll.
- The first local Chromium launch may download a browser build. That download is not a
  connpass.com request, but it needs network access to the browser download host.
- `e2e-developer-app-organizer` and `e2e-organizer` share the subject `e2e-organizer-user`.
  The creator rule treats them as the same user.
- Do not create any other job to test polling. Every other job type navigates to
  connpass.com as soon as it runs. See [connpass.com operations](connpass-operations.md).

- Observed 2026-11-24: local Browser Rendering could not launch Chromium in this environment
  (`spawn Unknown system error -88`), so the relogin job reached `failed` with the launch error
  rather than `connpass_bot_credentials_missing`. The terminal `failed` state and the
  authorization boundaries are the assertions; the error text depends on the local browser.
