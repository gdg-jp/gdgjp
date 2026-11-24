# Bearer authentication and method guard

Every API route resolves the caller by sending the Bearer token to the Accounts
userinfo endpoint (the mock IdP in this stack). A missing, malformed, or unknown token
gets 401 with `{"error":"invalid_token"}`. Routes that accept only some HTTP methods
answer other methods with 405 before they look at the token.

## Sub-features

- `connpass-auth-required` returns 401 for every API route group when no token is sent.
- `connpass-auth-invalid` returns 401 for an unknown token and for a non-Bearer scheme.
- `connpass-method-guard` returns 405 `{"error":"method_not_allowed"}` for an unsupported
  method on an action route, without authentication and without side effects.

- `connpass-accounts-bearer`: with `--platform`, the helper points `CONNPASS_E2E_ACCOUNTS_URL`
  at the verify-platform Accounts and seeds its CLI tokens. A real Accounts token for a chapter
  organizer gets `404 not_found` for a missing job and `403` on admin routes, and a mock IdP
  token is rejected with `401`.

## How to get to it (user POV)

A CLI or agent calls `http://localhost:6166/api/...` with or without an
`Authorization` header. This is HTTP only; drive it with curl, not Orca Browser.

## Driving it with HTTP (curl)

Preconditions: the helper is ready and the seed is applied. Record the job count.

- **No token, reads.** Send `GET` with no `Authorization` header to each of
  `/api/admin/groups`, `/api/admin/luma-calendars`, `/api/jobs/vjob-chapter10`,
  `/api/groups/verify-chapter10/events`, `/api/groups/verify-chapter10/events/900001`,
  `/api/groups/verify-chapter10/events/900001/sub-events`,
  `/api/groups/verify-chapter10/events/900001/sub-events/900002`,
  `/api/groups/verify-chapter10/events/900001/survey`,
  `/api/groups/verify-chapter10/events/900001/conference`,
  `/api/groups/verify-chapter10/events/900001/participants`,
  `/api/groups/verify-chapter10/events/900001/participants/p1`,
  `/api/groups/verify-chapter10/events/900001/stats`,
  `/api/groups/verify-chapter10/events/900001/vouchers`, and
  `/api/groups/verify-chapter10/events/900001/vouchers/v1`.
  Each returns `401` with body exactly `{"error":"invalid_token"}`.
- **No token, writes.** Send with no `Authorization` header:
  `POST /api/groups/verify-chapter10/events` with `{"title":"x"}`,
  `POST /api/groups/verify-chapter10/events/900001/publish` with `{}`,
  `POST /api/admin/session/relogin`,
  `PUT /api/admin/groups/verify-chapter10` with `{"enabled":false}`,
  `PUT /api/admin/luma-calendars/cal-verifyanon` with `{"enabled":true}`, and
  `POST /api/checkin` with `{"url":"https://connpass.com/event/1/qr_checkin/2/3/"}`.
  Each returns `401` `{"error":"invalid_token"}`.
- **Invalid token.** `GET /api/admin/groups` with `Authorization: Bearer not-a-real-token`
  returns `401` `{"error":"invalid_token"}`. `GET /api/admin/groups` with
  `Authorization: Basic ZTJlLWFkbWluOng=` returns `401` `{"error":"invalid_token"}`.
- **Method guard.** With no token, send `PUT /api/admin/session/relogin`,
  `DELETE /api/groups/verify-chapter10/events`, `PATCH /api/admin/groups/verify-chapter10`,
  `POST /api/admin/luma-calendars/cal-verifyanon`,
  `POST /api/groups/verify-chapter10/events/900001/survey`, and `PUT /api/checkin`. Each returns `405` with body `{"error":"method_not_allowed"}`.
- **Independent read-back.** `GET /api/admin/groups` as `e2e-admin` still lists
  `verify-chapter10` with `enabled: true`. `GET /api/admin/luma-calendars` as `e2e-admin`
  does not list `cal-verifyanon`. The job count is unchanged.
- **Evidence.** Save a table of method, path, header shape (none, unknown Bearer, Basic),
  status, and body, plus the before and after job counts, under
  `ready.json.evidence/connpass-auth-required/` and the matching journey directories.

## Gotchas

- 401 depends on the mock IdP answering 401 for unknown tokens. If the IdP is down,
  every request also returns 401. Check `http://127.0.0.1:6167/health` returns `ok`
  before and after this journey, and require at least one 200 with `e2e-admin` in the
  same run, so a dead IdP does not pass as authentication.
- Methods for which a route defines no handler at all (for example `GET
  /api/admin/session/relogin` or `POST /api/admin/groups`) are answered by React Router,
  not by the app. Their status and body are framework behaviour; do not assert them as
  this journey.
- Do not send the method-guard requests with an authorized identity and a different
  method. `DELETE` on an event or voucher route as an organizer enqueues a job that runs
  at once against connpass.com.
