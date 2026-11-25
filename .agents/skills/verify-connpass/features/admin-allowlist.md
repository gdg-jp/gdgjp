# Admin allowlists

A GDG admin, using a first-party client, maintains two allowlists that gate every
other route: connpass groups the shared bot may administer (mapped to a chapter) and
Luma calendars whose guests may be checked in (mapped to a chapter). Only D1 is touched;
nothing reaches connpass.com or Luma.

## Sub-features

- `connpass-admin-luma` lists Luma calendars from the empty state, upserts one, rejects an
  invalid calendar ID with 400, and updates an existing calendar.
- `connpass-admin-groups` upserts a group with a normalized lowercase slug, lists all groups
  in slug order, and overwrites an existing group's fields on a second upsert.
- `connpass-admin-forbidden` returns 403 for organizer, member, and developer-app tokens on
  every admin route and leaves both allowlists unchanged.

## How to get to it (user POV)

An admin calls `GET /api/admin/groups`, `PUT /api/admin/groups/:groupId`,
`GET /api/admin/luma-calendars`, and `PUT /api/admin/luma-calendars/:calendarId` with a
Bearer token. This is HTTP only; drive it with curl.

## Driving it with HTTP (curl)

Preconditions: the seed is applied, no Luma calendar exists, and the job count is recorded.
Run `connpass-admin-luma` first.

- **Luma empty state.** `GET /api/admin/luma-calendars` as `e2e-admin` returns `200`
  `{"calendars":[]}`.
- **Luma upsert.** `PUT /api/admin/luma-calendars/cal-verify1` as `e2e-admin` with
  `{"chapterId":"10","enabled":true}` returns `200`
  `{"calendarId":"cal-verify1","chapterId":"10","enabled":true}`. Then
  `GET /api/admin/luma-calendars` returns `{"calendars":[{"calendarId":"cal-verify1","chapterId":"10","enabled":true}]}`.
- **Luma invalid ID.** `PUT /api/admin/luma-calendars/not-a-calendar` as `e2e-admin` with
  `{"chapterId":"10"}` returns `400` `{"error":"invalid_calendar_id"}`.
  `PUT /api/admin/luma-calendars/cal-bad_id` returns the same `400`.
- **Luma update.** `PUT /api/admin/luma-calendars/cal-verify1` as `e2e-admin` with
  `{"chapterId":10,"enabled":false}` returns `200`
  `{"calendarId":"cal-verify1","chapterId":"10","enabled":false}`.
- **Luma read-back.** SQL: `SELECT calendar_api_id, chapter_id, enabled FROM luma_calendars ORDER BY calendar_api_id`
  returns exactly one row `cal-verify1`, `10`, `0`.
- **Group seed listing.** `GET /api/admin/groups` as `e2e-admin` returns `200` with `groups`
  in ascending slug order: `verify-adminonly` (`numericGroupId: null`, `chapterId: null`,
  `enabled: true`), `verify-chapter10` (`4242`, `"10"`, `true`), and `verify-disabled`
  (`null`, `"10"`, `false`).
- **Group upsert and slug normalization.** `PUT /api/admin/groups/Verify-Upsert` as
  `e2e-admin` with `{"chapterId":10,"numericGroupId":5150,"enabled":true}` returns `200`
  `{"groupId":"verify-upsert","numericGroupId":5150,"chapterId":"10","enabled":true}`.
  `GET /api/admin/groups` now has four entries, and `verify-upsert` is the last one.
- **Group overwrite.** `PUT /api/admin/groups/verify-upsert` as `e2e-admin` with
  `{"chapterId":"10","enabled":false}` returns `200`
  `{"groupId":"verify-upsert","numericGroupId":null,"chapterId":"10","enabled":false}`.
  The omitted `numericGroupId` is stored as null.
- **Group read-back.** SQL: `SELECT group_slug, group_id, chapter_id, enabled FROM groups WHERE group_slug = 'verify-upsert'`
  returns one row `verify-upsert`, `NULL`, `10`, `0`. `SELECT COUNT(*) AS n FROM groups WHERE group_slug = 'Verify-Upsert'`
  returns `0`.
- **Forbidden.** For each of `e2e-organizer`, `e2e-member`, and
  `e2e-developer-app-organizer`, send `GET /api/admin/groups`,
  `GET /api/admin/luma-calendars`, `PUT /api/admin/groups/verify-forbidden` with
  `{"chapterId":"10","enabled":true}`, `PUT /api/admin/luma-calendars/cal-verifyforbidden`
  with `{"chapterId":"10","enabled":true}`, and `POST /api/admin/session/relogin`.
  Each returns `403` `{"error":"forbidden"}`.
- **Forbidden read-back.** As `e2e-admin`, `GET /api/admin/groups` has no
  `verify-forbidden` and `GET /api/admin/luma-calendars` has no `cal-verifyforbidden`.
  The job count is unchanged.
- **Evidence.** Save every request and response, the SQL outputs, and the job counts under
  `ready.json.evidence/<journey ID>/`.

## Gotchas

- An upsert replaces all fields. Omitting `chapterId` stores null and turns the group or
  calendar admin-only; omitting `numericGroupId` clears it. Always send every field you
  mean to keep.
- `enabled` accepts only JSON booleans. Any other value, including the string `"false"`,
  is stored as enabled. Do not use a string to disable a row in these journeys.
- `chapterId` accepts a string or a number; a number is returned and stored as a string.
- Do not upsert any group with `chapterId` `99`, and do not change the three seeded
  groups. The outsider's check-in denial and the group-access journeys rely on them.
- The relogin request in the forbidden step must return 403 for all three identities.
  If it returns 202, a relogin job was created; record the job ID and treat it under
  `connpass-relogin-job` rules.
