# Contributor management

Organizers and super admins grant SNS posting access to a user by email, for one
chapter, and remove it. The add field suggests Accounts users while typing.

## Sub-features

- `sns-contributors-add` adds an email from the Settings form and grants that user
  access to the chapter.
- `sns-contributors-remove` removes a contributor and revokes the user's access.
- Candidate search (`/api/contributor-candidates`) queries Accounts. Only its empty
  query and its forbidden response are inside the map.

## How to get to it (user POV)

`Settings`, section `Contributors` (`このチャプターの投稿操作を許可するユーザー`). It
appears only for an organizer or super admin. The email textbox has the placeholder
`名前またはメールアドレスで検索`; typing opens a suggestion list that shows `検索中…`,
candidate names and emails, or `該当するユーザーはいません。`. The submit button is
`追加`. Each contributor row shows the email and `削除`.

## Driving it with Orca Browser

Preconditions: seed applied; the contributor part of `sns-access-roles` has run.
Organizer profile signed in.

- **Add (`sns-contributors-add`).** Start network capture. On `/settings`, focus the
  `名前またはメールアドレスで検索` textbox and type `verify-sns-member@dev.local`. Record
  the status of the `/api/contributor-candidates?q=...` request and whether the
  Settings page is still rendered. If it is, choose `追加`. Require `/settings` with
  the row `verify-sns-member@dev.local`. Independent check:
  `SELECT chapter_id, user_email, granted_by_user_id FROM sns_contributors WHERE user_email = 'verify-sns-member@dev.local'`
  returns `1` and `dev-user-verify-sns-organizer`. Then in the Member profile reload
  `/posts` and require the `Posts` heading instead of `/no-chapter`. If the candidate
  request fails and replaces the page, report the journey as failed with the response
  status and the visible error. Do not insert the row by SQL or CLI and report a pass.
- **Remove (`sns-contributors-remove`).** On `/settings`, on the row
  `verify-sns-contributor@dev.local`, choose `削除`. Require `/settings` without that row.
  Independent check: the `sns_contributors` query for that email returns no rows. In the
  Contributor profile reload `/posts` and require `/no-chapter`.
- **Candidate endpoint boundaries.** With an organizer jar,
  `curl -s -b <jar> "http://localhost:6165/api/contributor-candidates?q="` returns
  `{"candidates":[]}` without calling Accounts. With a contributor jar the same request
  returns `403`.

Evidence: Settings snapshots before and after each change, the candidate request
status from network capture, the member and contributor `/posts` snapshots, and SQL
results.

## Gotchas

- Dev-login sessions carry no Accounts access token. A non-empty candidate query calls
  `getAccessToken`, which throws `ClaimsUnavailableError`; the source returns a `500`.
  A failed `useFetcher().load` goes to the route error boundary, so the Settings page
  can be replaced before `追加` is chosen. A real OIDC session through local Accounts,
  with an Accounts user who may search users, is the only local path for the search.
  That path is outside this map until the helper provides it.
- The access check compares emails without case. Dev-login emails are
  `<as>@dev.local`, so the member's email is `verify-sns-member@dev.local`.
- The browser accepts `name@host` as a valid email, but the server requires a dot in the
  domain. The server's `有効なメールアドレスを入力してください。` comes from an action-only
  route with no screen; record what the browser shows if this case is exercised.
- Contributor membership is checked per request; removal takes effect on the next load.
