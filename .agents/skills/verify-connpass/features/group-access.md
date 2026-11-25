# Group access boundaries

Every group route first resolves the group from the allowlist by slug (case-insensitive)
or numeric connpass group ID. Reading needs an enabled group plus admin or membership in
the group's chapter. Writing also needs a first-party client and the organizer role in
that chapter, or admin. A denied request returns 403 `{"error":"forbidden"}` before any
browser session or job exists.

## Sub-features

- `connpass-read-deny` returns 403 to reads of an unknown group, a disabled group (even for
  an admin), an admin-only group (for an organizer), and a chapter group (for an outsider),
  on every read route.
- `connpass-write-deny` returns 403 on every write route to a member, an organizer of another
  chapter, an organizer using a developer-owned (non-first-party) client, and an organizer
  on a disabled, admin-only, or unknown group, and enqueues no job.

## How to get to it (user POV)

A CLI or agent calls `/api/groups/:groupId/events/...` with a Bearer token. HTTP only;
drive it with curl.

## Driving it with HTTP (curl)

Preconditions: the seed is applied and the identity gate passed. Record the job count
before each journey. Use event ID `900001`, sub-event ID `900002`, participant ID `p1`, and
voucher ID `v1`. These IDs exist nowhere; the requests must be denied before any lookup.

Read routes, written relative to `/api/groups/<group>`:
`/events`, `/events/900001`, `/events/900001/sub-events`, `/events/900001/sub-events/900002`,
`/events/900001/survey`, `/events/900001/conference`, `/events/900001/participants`,
`/events/900001/participants/p1`, `/events/900001/stats`, `/events/900001/vouchers`,
`/events/900001/vouchers/v1`.

- **Unknown group.** `GET` every read route with `<group>` = `does-not-exist` as `e2e-admin`.
  Each returns `403` `{"error":"forbidden"}`.
- **Disabled group.** `GET` every read route with `<group>` = `verify-disabled` as `e2e-admin`
  and as `e2e-member`. Each returns `403`.
- **Admin-only group.** `GET` every read route with `<group>` = `verify-adminonly` as
  `e2e-organizer`. Each returns `403`.
- **Outsider.** `GET` every read route with `<group>` = `verify-chapter10` and with
  `<group>` = `4242` (the seeded numeric ID) as `e2e-outsider`. Each returns `403`.
- **Read-deny read-back.** The job count is unchanged, and
  `ready.json.evidence/server.log` has no `connpass session:` line written during the
  journey. Any such line means a browser session started; stop and report it.

Write requests, relative to `/api/groups/<group>`:
`POST /events` `{"title":"deny"}`; `PATCH /events/900001` `{"title":"deny"}`;
`DELETE /events/900001`; `POST /events/900001/publish` `{}`;
`POST /events/900001/image` multipart field `image` = `<ready.json.source>/.agents/skills/verify-connpass/fixtures/not-an-image.txt`
(`type=text/plain`); `POST /events/900001/copy`; `POST /events/900001/cancel`;
`PATCH /events/900001/participants/p1` `{"status":"attending"}`;
`POST /events/900001/messages` `{"subject":"deny","body":"deny"}`;
`POST /events/900001/vouchers` `{"name":"deny","quantity":1,"participationTypeIds":["t1"]}`;
`PATCH /events/900001/vouchers/v1` `{"name":"deny","quantity":1,"participationTypeIds":["t1"]}`;
`DELETE /events/900001/vouchers/v1`; `POST /events/900001/sub-events` `{"title":"deny"}`;
`DELETE /events/900001/sub-events/900002`; `PUT /events/900001/survey` `{"questions":[]}`;
`PUT /events/900001/conference` `{"isActive":true}`.

- **Member.** Send every write request with `<group>` = `verify-chapter10` as `e2e-member`.
  Each returns `403` `{"error":"forbidden"}`.
- **Other chapter's organizer.** Send every write request with `<group>` = `verify-chapter10`
  as `e2e-outsider`. Each returns `403`.
- **Non-first-party client.** Send every write request with `<group>` = `verify-chapter10`
  as `e2e-developer-app-organizer`. Each returns `403`. This identity has the same chapter
  and role as `e2e-organizer`; only its client differs.
- **Organizer on groups it cannot write.** Send `POST /events` `{"title":"deny"}`,
  `POST /events/900001/publish` `{}`, and `PUT /events/900001/conference` `{"isActive":true}`
  as `e2e-organizer` with `<group>` = `verify-disabled`, `verify-adminonly`, and
  `does-not-exist`. Each returns `403`.
- **Write-deny read-back.** The job count is unchanged.
  `SELECT COUNT(*) AS n FROM jobs WHERE created_by IN ('e2e-member-user','e2e-outsider-user','e2e-organizer-user') AND id NOT LIKE 'vjob-%'`
  returns `0`. No `connpass session:` line appears in the server log during the journey.
- **Evidence.** Save a table of identity, method, path, status, and body, plus the SQL
  outputs, under `ready.json.evidence/<journey ID>/`.

## Gotchas

- A positive read (for example a member listing `verify-chapter10` events) is outside the
  map. It opens a Browser Rendering session and navigates to connpass.com. The developer-app
  identity can read, so never send it a read request for `verify-chapter10` either.
- The image denial must use the text fixture. Authorization runs before the upload is
  parsed, but a real image would be stored and submitted if authorization were wrong.
- The group slug is lowercased before lookup. `VERIFY-CHAPTER10` is the same group, so do
  not use case variants as "unknown" groups.
- If any request returns `202`, a job was created and has already started against
  connpass.com. Stop the run, record the job ID, and report a defect.
