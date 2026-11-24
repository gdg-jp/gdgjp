# QR check-in

`POST /api/checkin` takes the URL read from an attendee's ticket QR code. A connpass
reception URL (`https://connpass.com/event/<id>/qr_checkin/<n>/<n>/`) is checked in through
the bot's connpass session; a Luma ticket URL (`https://luma.com/check-in/evt-...?pk=g-...`)
is checked in through api.luma.com as the Luma bot. Any other URL is rejected with 400.
The live-checkin app's developer client IDs in `CHECKIN_CLIENT_IDS` may also call this
route; other developer clients may not.

## Sub-features

- `connpass-checkin-validation` returns 400 `{"error":"invalid_checkin_url"}` for a missing
  URL and for URLs that are neither connpass reception URLs nor Luma ticket URLs.
- `connpass-checkin-deny` returns 403 `{"error":"forbidden"}` for a connpass URL when the
  caller is not an organizer or admin of any enabled allowlisted group, or uses a developer
  client outside `CHECKIN_CLIENT_IDS`.
- `connpass-checkin-luma-unconfigured` returns the safe failure body
  `{"checkedIn":false,"userId":null,"reason":"error","promoCode":null}` for a well-formed Luma
  URL when no Luma bot password is configured, without contacting api.luma.com.

## How to get to it (user POV)

The QR check-in app or a CLI posts `{"url":"<scanned URL>"}` with a Bearer token. HTTP only;
drive it with curl.

## Driving it with HTTP (curl)

Preconditions: the seed is applied, the credential gate passed (no `LUMA_BOT_PASSWORD` and no
connpass bot credentials), the identity gate passed, and no enabled group has chapter `99`.
Fresh KV holds no `luma:bot:sessionKey` and no `connpass:bot:storageState`. Record the job
count.

- **Validation.** As `e2e-organizer`, `POST /api/checkin` with each of these bodies:
  `{}`; `{"url":"https://example.com/event/1/qr_checkin/2/3/"}`;
  `{"url":"http://connpass.com/event/1/qr_checkin/2/3/"}`;
  `{"url":"https://connpass.com/event/1/"}`; `{"url":"https://luma.com/check-in/evt-abc"}`;
  `{"url":"https://luma.com/check-in/evt-abc?pk=bad"}`;
  `{"url":"https://evil.example/check-in/evt-abc?pk=g-def"}`. Each returns `400`
  `{"error":"invalid_checkin_url"}`.
- **Connpass URL denied.** As each of `e2e-member`, `e2e-outsider`, and
  `e2e-developer-app-organizer`, `POST /api/checkin` with
  `{"url":"https://connpass.com/event/1/qr_checkin/2/3/"}`. Each returns `403`
  `{"error":"forbidden"}`.
- **Luma URL without a Luma bot password.** As `e2e-member`, `POST /api/checkin` with
  `{"url":"https://luma.com/check-in/evt-verify1?pk=g-verify1"}`. It returns `200` with body
  exactly `{"checkedIn":false,"userId":null,"reason":"error","promoCode":null}`.
  The server log for this request contains `luma_checkin_failed` and
  `luma_bot_credentials_missing`.
- **Independent read-back.** The job count is unchanged. The server log written during the
  journey has no `connpass session:` line. As `e2e-admin`, `GET /api/admin/luma-calendars`
  is unchanged from before the journey.
- **Evidence.** Save every request and response, the job counts, and the relevant server
  log lines under `ready.json.evidence/<journey ID>/`.

## Gotchas

- Never send a connpass URL as `e2e-organizer` or `e2e-admin`. The seeded enabled
  chapter-10 group gives them check-in access, so the request opens a Browser Rendering
  session that navigates to connpass.com.
- The outsider's 403 depends on no enabled chapter-99 group existing. If one exists, the
  outsider's connpass request reaches connpass.com.
- The Luma path asks Luma for the event's calendar before it checks the allowlist. Every
  authenticated identity, including an outsider, gets the same 200 failure body while no
  Luma password is configured. That response does not prove authorization; it proves only
  the safe failure shape.
- With `LUMA_BOT_PASSWORD` configured, the Luma request signs in to api.luma.com as the
  shared bot and can mark a real guest checked in. The credential gate exists to prevent it.
- `CHECKIN_CLIENT_IDS` comes from `wrangler.toml`. The mock IdP has no identity with that
  client ID, so the trusted-client allowance has no journey in this map.
