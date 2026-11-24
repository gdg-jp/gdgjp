# Home page

The home page is a static description of the machine API. It needs no sign-in,
loads no data, and has no controls. It tells a reader to authenticate with a GDG
Accounts Bearer token and lists three API routes.

## Sub-features

- `connpass-home` renders the title, heading, Bearer guidance, and route list for an
  anonymous visitor, with no network request to the API or to connpass.com.

## How to get to it (user POV)

Open `http://localhost:6166/` in a browser. There is no sign-in link, no sign-in page,
and no signed-in view anywhere in the app. Unknown paths, for example
`http://localhost:6166/signin`, return the framework's default 404 page.

## Driving it with Orca Browser

Preconditions: the helper is ready. Create an isolated Orca profile and a tab in it,
following the verify-platform Orca procedure. Set no cookies.

- **Open.** Start network capture, then
  `orca goto --page "$connpass_page_id" --url http://localhost:6166/ --json`.
  Require the document title `GDG Japan Connpass API`.
- **Read.** Run `orca snapshot --page "$connpass_page_id"`. Require a level-1 heading
  `connpass.gdgs.jp`, a paragraph containing `Authenticate with a GDG Accounts Bearer token`,
  and a list with exactly these three items:
  `POST /api/groups/:groupId/events — create draft (async job)`,
  `POST /api/groups/:groupId/events/:eventId/publish — publish (async job)`, and
  `GET /api/jobs/:jobId — job status`. Require no link, button, or form.
- **No side effects.** Read `orca network --page "$connpass_page_id" --limit 50 --json`.
  Require only `localhost:6166` document, script, style, and icon requests. Require no
  `/api/` request and no request to `connpass.com`.
- **Independent read-back.** `curl -sS -o home.html -w '%{http_code}' http://localhost:6166/`
  returns `200`, and `home.html` contains `connpass.gdgs.jp` and `Bearer`.
- **Evidence.** Save the snapshot text, a screenshot from `orca screenshot`, the sanitized
  network list, and `home.html` under `ready.json.evidence/connpass-home/`.

## Gotchas

- The page text points to `/openapi` "in the repository". The server has no `/openapi`
  route; a GET there returns 404. That is expected, not a failed journey.
- The document language is `ja` while the copy is English. Assert the text, not the
  language attribute.
- Signed-in browser journeys do not exist for this app. Do not invent a cookie or a
  sign-in step to reach one.
