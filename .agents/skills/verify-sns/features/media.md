# Post images and R2 media

Users attach up to four images to a post from the composer or from a list card, add
alt text, and remove images. Images are stored in the local `MEDIA` R2 bucket and
served only to the post's chapter. A post that waits for a photo becomes scheduled
once an image arrives.

## Sub-features

- `sns-media-composer` uploads an image with alt text while creating a post, and
  serves it only within the chapter.
- `sns-media-photo-required` adds an image from a list card to a post that waits for
  a photo, then removes it in the editor and deletes the R2 object.

## How to get to it (user POV)

- In `/schedule`, the image button `端末から写真を追加` opens a file chooser for
  `input[name="images"]`. Each preview has `画像を削除` and `Alt`
  (`画像の説明（Alt）を編集`), which opens the `画像の説明` dialog with the textbox
  `画像の説明を入力` and `閉じる`.
- On a `/posts` card, `画像を追加` opens a file chooser for that card's
  `input[name="images"]` and submits immediately to `/api/posts`.
- Image bytes load from `/api/media/<mediaId>`.

## Driving it with Orca Browser

Preconditions: the organizer profile is signed in. Upload
[`../fixtures/verify-photo.png`](../fixtures/verify-photo.png) (a 99-byte 32x32 PNG)
through Orca's file upload into the named input. Use a 2099 time for every post here.
Read R2 objects from the scratch `apps/sns` directory with
`pnpm exec wrangler r2 object get "gdgjp-sns-media/<r2_key>" --local --pipe | wc -c`.

- **Composer upload (`sns-media-composer`).** Open `/schedule`. Fill `本文` with
  `Verify image post 0001`, choose `指定時刻に投稿`, and fill `予約日時（JST）` with
  `2099-12-31T10:00`. Upload `verify-photo.png` into the `端末から写真を追加` input.
  Require a preview with `画像を削除` and `Alt`. Choose `Alt`, fill `画像の説明を入力`
  with `Verify alt text`, and choose `閉じる`. Do not open `タグ付けするユーザー`.
  Choose `予約する`. Require a card with `Verify image post 0001`, `scheduled`, and an
  image whose alt text is `Verify alt text`. Independent checks:
  `SELECT m.id, m.r2_key, m.content_type, m.byte_size, m.alt_text, m.sort_order FROM post_media m JOIN posts p ON p.id = m.post_id WHERE p.text = 'Verify image post 0001'`
  returns one row with `image/png`, `99`, `Verify alt text`, `0`, and a key
  `1/<postId>/<uuid>`. The R2 command prints `99`. With an organizer jar,
  `curl -s -o /dev/null -w '%{http_code} %{content_type}' -b <jar> http://localhost:6165/api/media/<mediaId>`
  prints `200 image/png`. With an other-chapter jar from
  `http://localhost:6165/dev/login?as=verify-sns-other&chapter=2:other-chapter:organizer&return_to=/posts`,
  the same request prints `404`. Without a cookie it returns `302` to `/signin`.
- **Photo-required post (`sns-media-photo-required`).** Open `/schedule`. Fill `本文`
  with `Verify photo required post 0001`, choose
  `画像が添付されるまで待ってから投稿`, fill `2099-12-31T11:00`, and choose `予約する`.
  Require a card with `画像が添付されるまで待ってから投稿` and `waiting_for_photo`.
  On that card upload `verify-photo.png` into its `画像を追加` input. The label may
  briefly read `画像を追加中…`. Require the card with the image and status `scheduled`. Independent
  check: the post has `status = 'scheduled'`, one `post_media` row, and no
  `post_attempts` rows. Then choose `投稿を編集`, choose `画像を削除` on the existing
  image, and choose `変更を保存`. Require the card without an image and with
  `waiting_for_photo`. Independent check: the post has no `post_media` rows and the R2
  command for the old key fails with an object-not-found error.
- **Rejected file.** On the same card, upload a non-image file such as
  [`../fixtures/seed.sql`](../fixtures/seed.sql). Require the card alert
  `画像は4枚まで、1枚5MB以下の画像ファイルを指定してください。` and no new
  `post_media` row.

Evidence: card snapshots before and after each upload, the image response status and
type, and the SQL and R2 outputs.

## Gotchas

- Adding an image from a card calls `claimAndPublish`. On a due `photo_required` post
  the first image triggers a publish attempt, so keep every post in this map in 2099.
- The card's file input is hidden inside its label and submits on change. Target the
  input inside the intended card; several cards each have one.
- `accept="image/*"` limits only the chooser. The server rejects non-image types and
  files over 5 MB, and allows at most four images per post.
- Alt text for new images is sent as `new-alt-<index>`; existing images use
  `alt-<mediaId>`. A card upload sets no alt text.
- Deleting a post deletes its media rows by cascade and their R2 objects afterwards.
