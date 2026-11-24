# connpass.com operations (outside the map)

These are the features that make connpass.gdgs.jp useful: reading and changing connpass
events, participants, vouchers, surveys, and sub-events, publishing, uploading images,
and mailing participants, all through a Browser Rendering session logged in as the shared
bot. Every one of them reaches connpass.com, and the stack has no local fake of
connpass.com. They are outside this map. Only their 401, 403, 405, and 400 paths are
verified, in the other feature files.

## Sub-features

Each ID below is `OUTSIDE MAP`. Record it in coverage as not run, with the reason given here.

- `connpass-ext-event-list` `GET /api/groups/:groupId/events` scrapes the group's events.
- `connpass-ext-event-detail` `GET /api/groups/:groupId/events/:eventId` scrapes one event.
- `connpass-ext-sub-event-read` `GET .../sub-events` and `GET .../sub-events/:subEventId`.
- `connpass-ext-survey-read` `GET .../survey`.
- `connpass-ext-conference-read` `GET .../conference`.
- `connpass-ext-participants-read` `GET .../participants` and `GET .../participants/:participantId`.
- `connpass-ext-stats-read` `GET .../stats`.
- `connpass-ext-vouchers-read` `GET .../vouchers` and `GET .../vouchers/:voucherId`.
- `connpass-ext-event-create` `POST /api/groups/:groupId/events` creates a draft (`create_event` job).
- `connpass-ext-event-update` `PATCH .../events/:eventId` (`update_event`).
- `connpass-ext-event-delete-draft` `DELETE .../events/:eventId` (`delete_event_draft`).
- `connpass-ext-event-publish` `POST .../publish` publishes the event and can post to X through
  connpass when `postToTwitter` is true (`publish_event`).
- `connpass-ext-event-image` `POST .../image` stores the image in R2 and uploads it (`upload_event_image`).
- `connpass-ext-event-copy` `POST .../copy` (`copy_event`).
- `connpass-ext-event-cancel` `POST .../cancel` (`cancel_event`).
- `connpass-ext-participant-update` `PATCH .../participants/:participantId` (`update_participant`).
- `connpass-ext-event-message` `POST .../messages` sends mail to the event's participants
  (`send_event_message`).
- `connpass-ext-vouchers-write` `POST .../vouchers`, `PATCH` and `DELETE .../vouchers/:voucherId`
  (`create_`, `update_`, `delete_voucher_recipient`).
- `connpass-ext-sub-event-write` `POST .../sub-events` and `DELETE .../sub-events/:subEventId`
  (`create_sub_event`, `delete_sub_event`).
- `connpass-ext-survey-write` `PUT .../survey` (`upsert_survey`).
- `connpass-ext-conference-write` `PUT .../conference` (`upsert_conference`).
- `connpass-ext-checkin-connpass` `POST /api/checkin` with a connpass reception URL by an
  organizer or admin of an enabled group.
- `connpass-ext-checkin-luma` `POST /api/checkin` with a Luma URL when the Luma bot password is set.
- `connpass-ext-pr-service` the `PrService` entrypoint that apps/pr calls through a service
  binding (`checkGroup`, `updateEvent`, `publishEvent`, `uploadImage`, `upsertSurvey`,
  `sendMessage`, `createSubEvent`, `getJob`, `getStats`, `listParticipants`, and the
  `not_supported` answers of `sendGroupMessage` and `createListing`).

## How to get to it (user POV)

An organizer's or admin's CLI or agent calls these routes with a first-party Bearer token
for an allowlisted, enabled group in the caller's chapter. apps/pr reaches the same
operations through `PrService`. Production runs them against connpass.com as the shared bot.

## Driving it with HTTP (curl)

Do not drive any sub-feature on this page. The exact behaviour that puts them outside the
map is below; it applies even without bot credentials.

- **Job execution in this stack.** `createJob` inserts a `queued` row, sends
  `{ jobId }` to `JOB_QUEUE`, and, because the helper serves dev Vite mode
  (`import.meta.env.DEV` is true), also runs `processJobMessage` immediately inside the
  request's `waitUntil`. The local queue consumer in `workers/app.ts` may receive the same
  message; the atomic `queued` to `running` claim lets only one of them proceed. A job
  created through the API therefore executes locally within seconds. It cannot be held in
  `queued` without changing code.
- **What an executed browser job does without credentials.** It opens a Browser Rendering
  session (a local Chromium in this stack), then checks the login by navigating to
  `https://connpass.com/dashboard/`. connpass.com redirects to its login page. The runner
  then reads the bot credentials, which are missing, and the job becomes `failed` with
  `error: "connpass_bot_credentials_missing"` and a failure screenshot stored in local R2
  at `jobs/<job id>/failure.png`. No login or write is sent, but the dashboard and login
  pages of connpass.com are requested anonymously. That is external traffic, so these jobs
  are outside the map.
- **What a synchronous read does without credentials.** The same anonymous dashboard
  navigation happens. When connpass.com redirects to a `/login` URL, the read forces a
  relogin (which fails on the missing credentials) and retries once, so the navigation
  happens twice.
  The route answers `502` with `{"error":"connpass_bot_credentials_missing"}`; the
  participant-detail and voucher-detail routes answer 500 instead.
- **What happens with credentials.** If the bot credentials are present (the source
  checkout's `apps/connpass/.dev.vars` has them), the job logs in to connpass.com as the
  shared bot and performs the real operation: it creates, edits, publishes, copies,
  cancels, or deletes real events, uploads images, changes participants and vouchers, and
  mails real participants. The README credential gate exists to make this impossible.
- **The one exception.** The `relogin` job opens a blank page and fails on the missing
  credentials before any navigation. It is the only executed job in the map; see
  [jobs](jobs.md).
- **PrService.** It has no HTTP route. Exercising it needs apps/pr with a service binding to
  this worker; its write methods call the same `createJob` and execute the same way.

## Gotchas

- A 202 from any route on this page means a job already started. Stop, record the job ID,
  and report the request; do not try to cancel it through another job.
- Browser Rendering is local Chromium in dev Vite mode. Setting `[browser] remote = true`,
  as AGENTS.md suggests for live tests, sends the session to Cloudflare's remote browser
  and makes every journey on this page reach connpass.com from Cloudflare instead.
- A local fake of connpass.com would need the Browser Rendering session to resolve
  `connpass.com` to a local server with the real page structure. No such fake exists.
  AGENTS.md names selector fixtures under `fixtures/html/`, but that directory does not
  exist in `apps/connpass`.
- `pnpm test:e2e:live` (`e2e/live.spec.ts`) is the only harness that drives these paths, and
  it acts on real connpass.com with real credentials. It is out of scope.
