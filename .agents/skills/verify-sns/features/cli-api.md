# CLI API

`/api/cli/v1/*` is the JSON surface the `gdg` CLI uses with an Accounts CLI bearer
token. It lists, creates, edits, and deletes posts, attaches and removes images,
publishes a post, manages contributors, and lists and revokes X accounts. The
contract is in `apps/sns/openapi/`.

## Sub-features

- `sns-cli-auth`: missing or invalid bearer, role, method, and media-type errors.
- `sns-cli-posts`: list with status filter and cursor, create, read, patch, delete.
- `sns-cli-media`: multipart image upload to a post and image removal.
- `sns-cli-contributors`: organizer-only list, add, and remove, and the access a
  contributor row grants.
- `sns-cli-x-accounts`: list without token fields, ID-confirmed revoke, and chapter
  isolation.
- `sns-cli-publish-failsafe`: the publish endpoint's conflicts and its fail-safe X
  failure.

## How to get to it (user POV)

A CLI user sends `Authorization: Bearer <token>` to `http://localhost:6165/api/cli/v1/...`.
SNS resolves the token by calling `GET <ACCOUNTS_URL>/api/cli/v1/identity`, so these
journeys need `--platform <verify-platform ready.json>` and [`../fixtures/accounts-seed.sql`](../fixtures/accounts-seed.sql)
applied to the Accounts D1. Every response is JSON with `Cache-Control: no-store`;
errors are `{"error":"<code>"}`.

## Driving it with Orca Browser

This surface has no browser UI; drive it with `curl` and record each status line and
body. Variables: `A=http://localhost:6165/api/cli/v1`,
`O='Authorization: Bearer sns-verify-cli-organizer-token-0001'` (Accounts organizer of
chapter 1, user `verify-cli-organizer`), `M='Authorization: Bearer sns-verify-cli-member-token-0001'`
(Accounts member of chapter 1, not a contributor), `J='content-type: application/json'`.
Before the first call, require
`curl -s -H "$O" http://localhost:6173/api/cli/v1/identity` to return the organizer
with chapter `1` and role `organizer`. Never send `tagHandles` and never put a URL in
`text`.

- **Auth (`sns-cli-auth`).**
  - `GET $A/posts?chapterId=1` without a header: `401` `{"error":"unauthorized"}`.
  - Same with `Authorization: Bearer not-a-token`: `401`.
  - `GET $A/posts` with `$O`: `400` `{"error":"invalid_request"}`.
  - `GET $A/posts?chapterId=1` with `$M`: `403` `{"error":"forbidden"}`.
  - `GET $A/posts?chapterId=2` with `$O`: `403`.
  - `GET $A/posts/post-verify-failed/publish` and `POST $A/x-accounts?chapterId=1` with
    `$O`: `405` `{"error":"method_not_allowed"}`.
  - `POST $A/posts` with `$O` and a JSON body but `content-type: text/plain`: `415`
    `{"error":"unsupported_media_type"}`.
  - Require `cache-control: no-store` on each response.
- **Posts (`sns-cli-posts`).**
  - `GET $A/posts?chapterId=1` with `$O`: `200`; `posts` includes `post-verify-failed`
    and `post-verify-published`, and excludes `post-verify-other-chapter`.
  - `GET $A/posts?chapterId=1&status=published`: only `post-verify-published`.
    `status=bogus`: `400`.
  - `GET $A/posts?chapterId=1&limit=1`: one post and `nextCursor` `MQ==`; following it
    with `cursor=MQ==` returns the next post.
  - `POST $A/posts` with `$O`, `$J`, and
    `{"chapterId":1,"xAccountId":"xacc-verify-1","text":"Verify CLI post 0001","scheduledAt":"2099-12-31T05:00:00.000Z","condition":"scheduled"}`:
    `201` with `post.status` `scheduled`. Independent check: the row has
    `created_by_user_id = 'verify-cli-organizer'` and no `post_attempts`.
  - The same body with `"condition":"later"`: `400` `invalid_condition`; with
    `"xAccountId":"xacc-verify-2"`: `400` `account_not_found`.
  - `GET $A/posts/<id>`: `200` with `post` and `media: []`.
  - `PATCH $A/posts/<id>` with `{"text":"Verify CLI post 0001 edited"}`: `200` with the
    new text. `PATCH $A/posts/post-verify-published` with the same body: `409`
    `not_editable`.
  - `GET $A/posts/post-verify-other-chapter` with `$O`: `404` `not_found`.
  - Keep `<id>` for the media and publish steps; delete it at the end with
    `DELETE $A/posts/<id>`: `200` `{"id":"<id>","deleted":true}`.
    `DELETE $A/posts/post-verify-published`: `409` `not_deletable`.
- **Media (`sns-cli-media`).** `POST $A/posts/<id>/media` with `$O`,
  `-F "file=@$PNG;type=image/png" -F sortOrder=0 -F altText="Verify CLI alt"`: `201`
  with `media.id`, `contentType` `image/png`, `byteSize` `99`. Without `sortOrder`:
  `400` `invalid_request`. Independent checks: the `post_media` row and its R2 object
  (`99` bytes). `DELETE $A/media/<mediaId>` with `$O`: `200` with `deleted: true` and
  the post; the row and object are gone. `DELETE $A/media/<mediaId>` again: `404`.
- **Contributors (`sns-cli-contributors`).**
  - `GET $A/contributors?chapterId=1` with `$M`: `403`. With `$O`: `200` listing the
    seeded contributor emails that remain.
  - `POST $A/contributors` with `$O`, `$J`, and
    `{"chapterId":1,"userEmail":"verify-cli-member@verify.invalid"}`: `201`.
    `"userEmail":"not-an-email"`: `400`.
  - `GET $A/posts?chapterId=1` with `$M`: now `200`. `GET $A/contributors?chapterId=1`
    with `$M`: still `403`.
  - `DELETE "$A/contributors?chapterId=1&userEmail=verify-cli-member@verify.invalid"`
    with `$O`: `200` `{"deleted":true}`. `GET $A/posts?chapterId=1` with `$M`: `403`
    again. Independent check: the `sns_contributors` row appears and disappears.
- **X accounts (`sns-cli-x-accounts`).**
  - `GET $A/x-accounts?chapterId=1` with `$O`: `200`; every account has `id`,
    `xUserId`, `username`, `displayName`, and `revokedAt`, and no key contains
    `Token` or `Ciphertext`.
  - `DELETE $A/x-accounts/xacc-verify-1` with `$J` and `{"xUserId":"wrong"}`: `400`
    `x_user_id_mismatch`; the account stays active.
  - `DELETE $A/x-accounts/xacc-verify-2` with `{"xUserId":"900000000000000002"}`:
    `404`.
  - `DELETE $A/x-accounts/xacc-verify-cli-revoke` with
    `{"xUserId":"900000000000000004"}`: `200` `{"id":"xacc-verify-cli-revoke","revoked":true}`.
    The list no longer contains it; the row has `revoked_at` set.
- **Publish (`sns-cli-publish-failsafe`).** Run the guard from
  [publishing.md](publishing.md#driving-it-with-orca-browser) first.
  - `POST $A/posts/post-verify-published/publish` with `$O`: `409` `already_published`.
  - Create a photo-required post with `"condition":"photo_required"` and a 2099 time,
    then `POST $A/posts/<that id>/publish`: `409` `missing_required_media`.
  - `POST $A/posts/<id>/publish` for the scheduled post from the posts step: `502`
    with `post.status` `failed` and `post.failureReason` `Invalid encrypted secret`.
    Independent check: one `post_attempts` row `failed`, `Invalid encrypted secret`.
  - Without a header: `401`. `POST $A/posts/post-verify-other-chapter/publish` with
    `$O`: `404`.

Evidence: one file per step with the request line (token redacted), status, headers,
and body, plus SQL and R2 outputs.

## Gotchas

- SNS fetches `ACCOUNTS_URL` directly, not through the service binding. If Accounts is
  down, every authenticated call returns `401`, which looks like a bad token.
- Unknown post, media, and X account IDs return `404` before authentication runs, while
  existing ones return `401` without a token. Use existing IDs for the auth checks.
- Cross-chapter `403` is reported as `404` on ID routes and as `403` on list routes.
- CLI create and media upload do not call `claimAndPublish`; only `/publish` and the cron
  publish. A CLI post with a past time would be published by the next cron tick in any
  environment that runs the cron, so use 2099 times.
- `tagHandles` resolve through the X users API. With the fixtures that fails after the
  post row is inserted and returns `500`.
- The contributor check matches the identity's email, so the Accounts emails in the
  seed are the ones to grant.
