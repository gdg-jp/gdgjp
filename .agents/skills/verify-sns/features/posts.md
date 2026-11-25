# Post list and schedule composer

Organizers and contributors see the selected chapter's unpublished posts, create a
post for a chapter X account, edit it, and delete it. Published and in-flight posts
are locked, and posts from other chapters are unreachable.

## Sub-features

- `sns-posts-list` shows queued, waiting, and failed posts with account, time,
  condition, status, and failure reason. Published posts are not listed.
- `sns-posts-empty` shows the empty list and a composer with no X account.
- `sns-schedule-create` stores a post for a future time without publishing it.
- `sns-schedule-edit` changes text and time of an editable post.
- `sns-schedule-delete` deletes an editable post after confirmation.
- `sns-post-locked` refuses to change or delete a published post.
- `sns-post-isolation` refuses another chapter's post.

## How to get to it (user POV)

- `Posts` in the bottom navigation, or `http://localhost:6165/posts`. The page has the
  `Posts` heading, the `予約する` link, and the floating `投稿を予約する` link.
- Each card is a link to its editor and has `投稿を編集`, `画像を追加`, and
  `Google Photos から写真を選ぶ`. A failed card also has `再試行`.
- The composer is `/schedule`. Its controls are the `投稿先アカウント` menu button, the
  `本文` textbox (placeholder `いまどうしてる？`), the posting-option menu button
  (`今すぐ投稿`, `指定時刻に投稿`, `画像が添付されるまで待ってから投稿`), the
  `予約日時（JST）` field, and a submit button labelled `予約する`, `今すぐ投稿`, or, when
  editing, `変更を保存`. Editing adds `キャンセル` and `削除`.

## Driving it with Orca Browser

Preconditions: the seed is applied and the organizer profile is signed in. Never put a
URL in `本文` and never fill `タグ付けするユーザー`. Never submit with `今すぐ投稿`, and
never submit a past `予約日時（JST）` here; publishing belongs to
[publishing.md](publishing.md). Read posts with
`pnpm exec wrangler d1 execute gdgjp-sns-db --local --json --command "<SQL>"`.

- **Populated list (`sns-posts-list`).** Navigate to `/posts`. Require one card with
  `Verify fixture failed post`, `Verify Chapter One`, `@verify_chapter_one`,
  `2026/01/01 12:00`, `指定時刻に投稿`, `failed`, the alert
  `投稿に失敗しました: Fixture failure, never sent`, and `再試行`. Do not choose
  `再試行` here. Require that `Verify fixture published post` and
  `Verify fixture other chapter post` are absent. Independent check:
  `SELECT id, status FROM posts WHERE chapter_id = 1` returns both chapter 1 fixtures,
  including the hidden `published` row.
- **Empty state (`sns-posts-empty`).** In the switcher profile after
  `sns-chapter-switch`, require `予約投稿はまだありません。` and the link
  `最初の投稿を予約する`. Open it. Require the account button text
  `Xアカウントを認可してください`, and require that the account button, the submit button,
  and `Google Photos から写真を選ぶ` are disabled.
- **Create (`sns-schedule-create`).** In the organizer profile choose
  `投稿を予約する`. Require `Verify Chapter One` on the `投稿先アカウント` button. Fill
  `本文` with `Verify scheduled post 0001`. Open the posting-option button and choose
  `指定時刻に投稿`. Fill `予約日時（JST）` with `2099-12-31T09:00`. Choose `予約する`.
  Require `/posts` and a card with `Verify scheduled post 0001`, `2099/12/31 9:00`,
  `指定時刻に投稿`, and `scheduled`. Independent check:
  `SELECT id, chapter_id, x_account_id, scheduled_at, condition, status, created_by_user_id FROM posts WHERE text = 'Verify scheduled post 0001'`
  returns chapter `1`, `xacc-verify-1`, `2099-12-31T00:00:00.000Z`, `scheduled`,
  `scheduled`, and `dev-user-verify-sns-organizer`; the matching `post_attempts` count is
  `0`. Also require cookie `sns-posting-option=scheduled`.
- **Validation in the composer.** On `/schedule`, fill `本文` with 281 `a` characters.
  Require the counter `Xの残り文字数: -1` and a disabled `予約する`. Clear the field and
  require `予約する` disabled again.
- **Edit (`sns-schedule-edit`).** On the `Verify scheduled post 0001` card choose
  `投稿を編集`. Require `/schedule?edit=<id>`, the saved text, `2099-12-31T09:00`, and
  `変更を保存`. Choose `キャンセル` and require `/posts` with the card unchanged. Edit
  again, change the text to `Verify scheduled post 0001 edited` and the time to
  `2099-12-30T21:30`, and choose `変更を保存`. Require the updated card with
  `2099/12/30 21:30`. Independent check: the row has the new text,
  `scheduled_at = '2099-12-30T12:30:00.000Z'`, and a later `updated_at`.
- **Delete (`sns-schedule-delete`).** Open the edited post and choose `削除`. Require
  the alert dialog `予約投稿を削除しますか？`. Choose `キャンセル` and require the editor.
  Choose `削除` again, then `削除する`. Require `/posts` without the card. Independent
  check: `SELECT COUNT(*) AS n FROM posts WHERE text LIKE 'Verify scheduled post 0001%'`
  returns `0`.
- **Locked post (`sns-post-locked`).** Navigate to
  `/schedule?edit=post-verify-published`. Require the editor with
  `Verify fixture published post`. Choose `変更を保存`. Require HTTP `409` and the error
  `投稿中または投稿済みの予約は変更できません。`. Choose `削除`, then `削除する`. Require
  `投稿中または投稿済みの予約は削除できません。`. Independent check: the row still has
  `status = 'published'` and its original text.
- **Other chapter (`sns-post-isolation`).** Navigate to
  `/schedule?edit=post-verify-other-chapter`. Require HTTP `403`. With an organizer jar,
  `curl -s -o /dev/null -w '%{http_code}' -b <jar> -X POST -F intent=add_media -F postId=post-verify-other-chapter http://localhost:6165/api/posts`
  prints `404`. Independent check: the chapter 2 row is unchanged.

Evidence: snapshots of `/posts` before and after create, edit, and delete; the editor
snapshot with each error message; the SQL results.

## Gotchas

- Every composer submit that is not the Google Photos button calls `claimAndPublish`
  after saving. A post whose time has passed is published at once. `今すぐ投稿` uses the
  current time, and the `予約日時（JST）` default is the current minute, so a careless
  `指定時刻に投稿` submit publishes immediately. Always type a 2099 time.
- The default posting option comes from the `sns-posting-option` cookie, so it changes
  after the first journey. Choose the option explicitly every time.
- Saving a `failed` post recomputes its status to `scheduled` or `waiting_for_photo`.
  Run [publishing.md](publishing.md) before editing `post-verify-failed`.
- `/posts` excludes `published` rows by query. Verify published posts through D1 or the
  CLI list, not the screen.
- `/schedule?edit=<unknown id>` renders an empty composer. Saving it creates a new post.
- The card and composer both show times in Asia/Tokyo. Stored values are UTC.
- Forbidden and conflict pages use React Router's default error output. Assert the HTTP
  status, then record the text.
