# Access boundaries and sign-out

The library and detail pages require a chapter member; the public image GET requires
nothing. Users without a chapter see an onboarding page, and the CLI API rejects requests
without a Bearer token.

## Sub-features

- `img-access`: anonymous redirects for `/` and `/i/<id>`, anonymous dashboard API calls, the
  no-chapter page, 403 and 404 detail pages, and the CLI API's 401.
- `img-signout`: "Sign out" in the account menu ends the dev session.

## How to get to it (user POV)

Signed in, the top bar shows "GDG Japan Image", "Color theme", "Open app launcher", and the
avatar button "Account menu" with "Manage your account" and "Sign out". A user without a
chapter sees "Join a GDG to continue", the note that existing images stay viewable by link,
and "Join a chapter".

## Driving it with Orca Browser

Preconditions: `<id>` exists (any earlier recipe). Fresh isolated profiles per identity.

`img-access`:

1. Anonymous HTTP, each with `curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n'`:
   - `/` → `302` to `/signin?return_to=%2F`.
   - `/i/<id>` → `302` to `/signin?return_to=%2Fi%2F<id>`.
   - `/?folder=unfiled` → `302` with the query kept in `return_to`.
   - `GET /api/auth/me` → `200` `{"user":null}`.
   - `curl -s -X POST -F file=@red.png http://localhost:6175/api/upload` → a redirect to
     sign-in, never `200`; then reload `/` as `member` and require no new tile.
   - `GET /api/cli/v1/images` with no `Authorization` → `401` `{"error":"invalid_token"}`.
   - `/<id>?f=original` → `200` (public).
2. No chapter: open `/dev/login?as=verify-img-none&chapter=0&return_to=/`. Require the URL
   `/no-chapter`, heading "Join a GDG to continue", and a "Join a chapter" link to
   `http://localhost:6173/onboarding` (read the `href`; Accounts is not running). As `member`,
   `goto` `/no-chapter`; require a redirect to `/`.
3. Malformed and unknown ids as `member`: `goto` `/i/bad` and `/i/zzzzzzzz`. Both show an
   error screen; `curl -b member.jar` returns `404` for each.
4. Other chapter: `outsider` on `/i/<id>` returns `403` (see [sharing.md](sharing.md)).

`img-signout` (run last for the `member` profile):

1. Start `orca capture start`. Click "Account menu", then "Sign out". Require `GET
   /auth/signout` answered `302` to `/signin` with a `Set-Cookie` that clears
   `gdgjp-img-session`. The following `/api/auth/signin` fails without Accounts; that is
   expected.
2. Independent check: `goto` `/api/auth/me`; require `{"user":null}`. `goto` `/`; require a
   redirect toward `/signin?return_to=%2F`. Anonymous `/<id>?f=original` still returns 200.

Evidence: the curl status lines, the no-chapter screenshot, the 404 screens, and the
sign-out network rows.

## Gotchas

- The app has no route ErrorBoundary, so 403 and 404 detail pages render React Router's
  default error screen (in Vite dev with developer hints). Assert the HTTP status, not page
  text.
- `chapter=0` means no chapters; omitting `chapter` gives the default `1:dev-chapter`
  organizer.
- The 401 is the only CLI behavior checkable locally; token-authenticated CLI journeys are
  outside the map.
