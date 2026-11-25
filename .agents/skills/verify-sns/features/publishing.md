# Publishing without reaching X

A post is published when it is due: immediately from the composer, on retry of a
failed post, when an image arrives for a due photo-required post, from the CLI
publish endpoint, or from the minute cron. This map exercises only the paths that
fail before any X request is built, and proves that nothing is sent.

## Sub-features

- `sns-publish-failsafe` drives `再試行` on a failed post and `今すぐ投稿` in the
  composer. Both run the real claim and publish code and end in `failed` with
  `Invalid encrypted secret`, because the fixture token cannot be decrypted.
- Real publication to X, X media upload, alt-text metadata, tagged users, and the
  cron are outside the map.

## How to get to it (user POV)

- `/posts`: a `failed` card shows `投稿に失敗しました: <reason>` and `再試行`.
- `/schedule`: the posting-option menu `今すぐ投稿` hides `予約日時（JST）` and changes the
  submit button to `今すぐ投稿`.

## Driving it with Orca Browser

Guard, run immediately before this journey and before `sns-cli-publish-failsafe`. Stop
and mark both journeys blocked if any line fails:

- `SELECT COUNT(*) AS unsafe FROM x_accounts WHERE access_token_ciphertext <> 'fixture-not-encrypted'`
  returns `0`.
- The scratch `apps/sns/.dev.vars` sets `X_API_BASE_URL=http://127.0.0.1:9` and
  `X_TOKEN_URL=http://127.0.0.1:9/2/oauth2/token`.
- `nc -z 127.0.0.1 9` exits nonzero.

Then, in the organizer profile:

- **Retry (`sns-publish-failsafe`).** Navigate to `/posts`. On
  `Verify fixture failed post` choose `再試行`. Require the card to revalidate with
  `failed` and `投稿に失敗しました: Invalid encrypted secret`. Independent checks:
  `SELECT status, failure_reason, published_x_post_id FROM posts WHERE id = 'post-verify-failed'`
  returns `failed`, `Invalid encrypted secret`, and null;
  `SELECT outcome, detail FROM post_attempts WHERE post_id = 'post-verify-failed'`
  returns one row `failed`, `Invalid encrypted secret`.
- **Immediate (`sns-publish-failsafe`).** Open `/schedule`. Fill `本文` with
  `Verify immediate post 0001`. Open the posting-option menu and choose `今すぐ投稿`.
  Require that `予約日時（JST）` disappears and the submit button reads `今すぐ投稿`.
  Choose it. Require `/posts` with a card for the text showing `failed` and
  `投稿に失敗しました: Invalid encrypted secret`. Independent check: the post has
  `status = 'failed'`, null `published_x_post_id`, and one `post_attempts` row with
  `failed` and `Invalid encrypted secret`.
- **No-send proof.** `SELECT COUNT(*) AS n FROM posts WHERE published_x_post_id IS NOT NULL AND id <> 'post-verify-published'`
  returns `0`, and `SELECT COUNT(*) AS n FROM post_attempts WHERE outcome <> 'failed' OR detail <> 'Invalid encrypted secret'`
  returns `0`. Search the SNS server log for `api.x.com` and `127.0.0.1:9` and require
  no match.

Evidence: the guard outputs, card snapshots before and after, the SQL results, and
the log search result.

## Gotchas

- `decryptSecret` runs before the token expiry check and before every X request, so a
  seeded account fails with `Invalid encrypted secret` and builds no request. The
  loopback X URLs are a second barrier. A `needs_confirmation` status, or a failure
  reason that mentions a network error, means a request was attempted; stop the run
  and treat it as a guard failure.
- No local X fake exists, so `published` and the X post ID are never produced here.
  Do not connect a real X account to make the journey pass.
- The cron (`scheduled` in `workers/app.ts`, `* * * * *` in production) does two
  things: `publishDuePosts` claims up to 50 posts with status `scheduled` or
  `waiting_for_photo` whose time has passed and publishes each through X, then it
  leases one due Google Photos album and dispatches the GitHub Actions workflow at a
  hard-coded `api.github.com` URL. The dispatch URL ignores `.dev.vars`. Dev Vite mode
  never invokes the cron. Do not trigger it locally (for example through Wrangler's
  scheduled test endpoint): the publish half fails safe with the fixtures, but the
  dispatch half sends a request to GitHub. Verify scheduling by stored rows instead.
- `failed` posts are not picked up by the cron; only `再試行`, editing, and the CLI
  publish endpoint retry them.
- Leaving a post due in `scheduled` or `waiting_for_photo` is harmless in dev mode but
  would publish on the next cron tick in any environment that runs the cron.
