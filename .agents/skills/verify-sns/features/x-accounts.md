# X account settings

A chapter's X accounts are the posting targets. Users see them in Settings and the
composer, revoke one after typing its X Account ID, and start X authorization. This
map stops authorization at the redirect to X and never completes it.

## Sub-features

- `sns-x-accounts-list` lists the chapter's active X accounts, or the empty message.
- `sns-x-revoke` revokes one account only after the typed ID matches.
- `sns-x-connect` stores an OAuth transaction and redirects to the configured X
  authorization URL with PKCE. Completing the callback is outside the map.

## How to get to it (user POV)

- `Settings`, section `X accounts` (`このチャプターから投稿するアカウント`). Each row shows
  `@<username>` and `解除`. The `Xを認可` link opens `/x/connect?return_to=/settings`.
- `解除` opens the alert dialog `Xアカウントの認可を解除しますか？`, whose description
  ends with the account's X Account ID. It has the `X Account ID` textbox, `キャンセル`,
  and `削除する`.
- The composer's `投稿先アカウント` menu lists the same accounts by display name and
  `@username`.

## Driving it with Orca Browser

Preconditions: seed applied; organizer profile signed in. For `sns-x-connect`, confirm
in the scratch `apps/sns/.dev.vars` that `X_AUTHORIZATION_URL`, `X_TOKEN_URL`, and
`X_API_BASE_URL` all point at `http://127.0.0.1:9`. If any still points at `x.com` or
`api.x.com`, mark `sns-x-connect` blocked and do not choose `Xを認可`.

- **List (`sns-x-accounts-list`).** Navigate to `/settings`. Require rows
  `@verify_chapter_one`, `@verify_cli_revoke`, and `@verify_revoke_me`, each with `解除`,
  and no `@verify_chapter_two`. Open `/schedule` and the `投稿先アカウント` menu. Require
  the three display names `Verify Chapter One`, `Verify CLI Revoke`, and
  `Verify Revoke Me` with their usernames, then press Escape. In the switcher profile
  on chapter 3, require `認可済みのXアカウントはありません。` on `/settings`.
  Independent check:
  `SELECT id, username FROM x_accounts WHERE chapter_id = 1 AND revoked_at IS NULL ORDER BY username`.
- **Revoke (`sns-x-revoke`).** On the `@verify_revoke_me` row choose `解除`. Require the
  dialog and the ID `900000000000000003` in its description. Require `削除する` disabled.
  Fill `X Account ID` with `900000000000000001` and require `削除する` still disabled.
  Replace it with `900000000000000003`, require `削除する` enabled, and choose it.
  Require `/settings` without `@verify_revoke_me` and with `@verify_chapter_one`.
  Independent checks: `SELECT id, revoked_at FROM x_accounts WHERE chapter_id = 1`
  shows a timestamp only for `xacc-verify-revoke`. With an organizer jar,
  `curl -s -o /dev/null -w '%{http_code}' -b <jar> -X POST -d id=xacc-verify-1 -d intent=revoke -d xUserId=wrong http://localhost:6165/settings/x`
  prints `400` (the route throws `X Account ID confirmation does not match`), and
  `xacc-verify-1` stays active.
- **Connect start (`sns-x-connect`).** First over HTTP with an organizer jar:
  `curl -s -D - -o /dev/null -b <jar> "http://localhost:6165/x/connect?return_to=/settings"`.
  Require `302` and a `Location` beginning `http://127.0.0.1:9/i/oauth2/authorize?`
  with `response_type=code`, `client_id=sns-verify-x-client`,
  `redirect_uri=http://localhost:6165/x/callback` (URL-encoded),
  `scope=tweet.read tweet.write users.read offline.access media.write`, a UUID `state`,
  a 43-character `code_challenge`, and `code_challenge_method=S256`. Independent check:
  `SELECT state, provider, user_id, chapter_id, return_to, expires_at FROM oauth_transactions`
  has a row for that state with `x`, `dev-user-verify-sns-organizer`, `1`, `/settings`,
  and an expiry about 10 minutes ahead. Repeat with `return_to=https://example.com/`
  and require `return_to = '/posts'` in the new row. Then in the browser with network
  capture, choose `Xを認可`. Require a request to `/x/connect?return_to=/settings`, a
  redirect to `http://127.0.0.1:9/i/oauth2/authorize?...`, and a browser connection
  error, not an X page.
- **Callback rejections (`sns-x-connect`).** Navigate to `/x/callback`. Require HTTP
  `400`; the route throws `Missing X OAuth response`. Navigate to
  `/x/callback?state=verify-bogus-state&code=verify-bogus-code`. Require HTTP `400`; the
  route throws `Invalid or expired X OAuth transaction`. Record the visible error text
  for both. Independent check: the `oauth_transactions` rows from the connect step
  remain.

Evidence: Settings snapshots before and after revocation, the dialog snapshot with the
disabled and enabled button, sanitized `Location` headers, and SQL results.

## Gotchas

- No X fake exists in the repository. Never call `/x/callback` with a state taken from
  `oauth_transactions`; the route consumes the transaction and posts the code to
  `X_TOKEN_URL`. With the loopback override that fails as a `500`; without it, the
  request reaches X. Completing authorization stays outside the map.
- Revocation only sets `revoked_at` in D1. It does not call X, and the stored token
  ciphertext remains in the row.
- `xacc-verify-1` backs the composer journeys. Revoke only `xacc-verify-revoke` here
  and `xacc-verify-cli-revoke` in the CLI map.
- Contributors and super admins also see `Xを認可` and `解除`; both routes require only
  chapter access.
- The seeded accounts have no profile image, so avatars render a placeholder glyph.
