# Google Photos album, import, and library

An organizer registers a public shared Google Photos album for the chapter. An
external importer (GitHub Actions) copies album photos into the Worker through a
bearer-protected HTTP contract. Users then pick imported photos for a post.

## Sub-features

- `sns-photos-album` saves, rejects, disables, and re-enables the album URL.
- `sns-photos-import` drives the importer endpoints `claim`, `known`, `media`, and
  `complete` with the test import token, standing in for the GitHub Actions importer.
- `sns-photos-library` shows the empty library, then attaches an imported photo to a
  post.

## How to get to it (user POV)

- `Settings`, section `Google Photos album`
  (`公開共有アルバムを監視して、投稿用の写真ライブラリに取り込みます。`), shown only to the
  `organizer` role. It has a URL textbox with placeholder
  `https://photos.google.com/share/...` and `アルバムを保存`. A saved album shows
  `監視中・次回: <time>` or `停止中・次回: <time>`, `監視を停止` while enabled, any last
  error, and one line per poll run: `<time>: <outcome>`, with ` (<n> 件追加)` when photos
  were imported.
- The composer button `Google Photos から写真を選ぶ` saves the draft and opens
  `/google/photos/library?postId=<id>`. List cards link there with the same label.
- The library page has the heading `Google Photos の写真`, `最大 <n> 枚選択できます。`,
  one `写真を選択` button per photo (`写真 <n> を選択解除` once selected),
  `まだ取り込まれた写真はありません。` when empty, and `選択した写真を追加`.

## Driving it with Orca Browser

Preconditions: seed applied; `.dev.vars` has
`GOOGLE_PHOTOS_IMPORT_TOKEN=sns-verify-import-token`; organizer profile signed in.
Run the parts in this order: album, library part A, import, library part B. Shell
variables below: `B=http://localhost:6165/api/google-photos-import`,
`T='Authorization: Bearer sns-verify-import-token'`, and `PNG` set to the absolute
path of `.agents/skills/verify-sns/fixtures/verify-photo.png` in the repository.

- **Album (`sns-photos-album`).** On `/settings`, fill the album textbox with
  `https://example.com/album` and choose `アルバムを保存`. The server answers `400` with
  `公開 Google Photos アルバムの HTTPS URL を入力してください。`. Record the URL and what
  the page shows. Independent check: `SELECT COUNT(*) AS n FROM google_photos_albums`
  returns `0`. Return to `/settings`, fill
  `https://photos.google.com/share/verify-fixture-album`, and choose `アルバムを保存`.
  Require `/settings` with `監視中・次回:` and `監視を停止`. Independent check:
  `SELECT id, album_url, enabled, poll_interval_minutes, next_poll_at FROM google_photos_albums WHERE chapter_id = 1`
  returns the URL, `1`, `5`, and a time about 5 minutes ahead. Choose `監視を停止`.
  Require `停止中・次回:` and no `監視を停止`; the row has `enabled = 0`. Save the same
  URL again and require `監視中・次回:`. Saving makes no outbound request.
- **Library, part A (`sns-photos-library`).** Open `/schedule`. Fill `本文` with
  `Verify library post 0001`, choose `画像が添付されるまで待ってから投稿`, and fill
  `予約日時（JST）` with `2099-12-31T12:00`. Choose `Google Photos から写真を選ぶ`.
  Require `/google/photos/library?postId=<id>`, `Google Photos の写真`,
  `最大 4 枚選択できます。`, `まだ取り込まれた写真はありません。`, and a disabled
  `選択した写真を追加`. Independent check: the post exists with
  `status = 'waiting_for_photo'`. Navigate to `/google/photos/library` and to
  `/google/photos/library?postId=post-verify-other-chapter`; require HTTP `404` for both.
- **Import (`sns-photos-import`).** Wait until the `次回` time on Settings has passed (at
  most 5 minutes). Then:
  - `curl -s -o /dev/null -w '%{http_code}' -X POST "$B/claim"` prints `401`.
  - `curl -s -X POST -H "$T" "$B/claim"` returns
    `{"album":{"id":"<albumId>","url":"https://photos.google.com/share/verify-fixture-album","runId":"<runId>"}}`.
    A second claim returns `{"album":null}` while the lease holds.
  - `curl -s -X POST -H "$T" -H 'content-type: application/json' -d '{"albumId":"<albumId>","runId":"<runId>","stablePhotoIds":["verify-photo-1"]}' "$B/known"`
    returns `{"known":[]}`.
  - `curl -s -w '\n%{http_code}' -X POST -H "$T" -H 'content-type: image/png' -H 'x-album-id: <albumId>' -H 'x-import-run-id: <runId>' -H 'x-stable-photo-id: verify-photo-1' -H 'x-blurhash: LEHV6nWB2yk8pyo0adR*.7kCMdnj' -H 'x-photo-taken-at: 2026-01-15T03:00:00.000Z' --data-binary @"$PNG" "$B/media"`
    returns `{"id":"<mediaId>"}` and `201`. The same request again returns
    `{"duplicate":true}` and `409`.
  - `curl -s -X POST -H "$T" -H 'content-type: application/json' -d '{"albumId":"<albumId>","runId":"<runId>","outcome":"imported","discoveredPhotoIds":["verify-photo-1"],"importedCount":1}' "$B/complete"`
    returns `{"ok":true}`.
  Reload `/settings`. Require a run line ending `: imported (1 件追加)` and
  `監視中・次回:`. Independent checks:
  `SELECT id, r2_key, content_type, byte_size, blurhash, taken_at FROM google_photos_media`
  returns one row with key `google-photos/1/<mediaId>`, `image/png`, and `99`;
  `SELECT outcome, imported_count, discovered_count FROM google_photos_poll_runs` returns
  `imported`, `1`, `1`; the album has `active_run_id` and `lease_expires_at` null and a
  `last_success_at`. The R2 command for the key prints `99`, and with an organizer jar
  `GET /api/google-photos-media/<mediaId>` returns `200` with `image/png`.
- **Library, part B (`sns-photos-library`).** Reload the library URL from part A.
  Require one `写真を選択` button. Choose it. Require `写真 1 を選択解除` and an enabled
  `選択した写真を追加`. Choose `選択した写真を追加`. Require `/schedule?edit=<id>` with one
  image in the editor. Independent check: the post has one `post_media` row with key
  `1/<postId>/<uuid>` and size `99`, `status = 'scheduled'`, and no `post_attempts`
  rows; the library row still exists.

Evidence: Settings snapshots after each album change and after import, the curl
responses with IDs, library snapshots before and after selection, and SQL and R2
outputs.

## Gotchas

- The real importer is the GitHub Actions workflow in `google-photos-importer/`, which
  the cron dispatches through `api.github.com`. Dev Vite mode never runs the cron, and
  the map never dispatches the workflow or scrapes Google Photos.
- A new album is due 5 minutes after it is saved. Claim before then returns
  `{"album":null}`. Changing the URL of an album makes it due at once, but also
  deletes its imported media and R2 objects.
- The import token comes from `.dev.vars`. With an empty `GOOGLE_PHOTOS_IMPORT_TOKEN`
  every importer request returns `401`.
- `x-blurhash` must be 6 to 200 characters without whitespace, or `media` returns `400`.
- The library action calls `claimAndPublish`. A due `photo_required` post would publish
  as soon as a photo is attached, so keep the post in 2099.
- The `/settings/google-photos` action has no screen, so its `400` message for a
  non-Google URL may not render anywhere. Record what the browser shows.
- Run times render with `toLocaleString` on both server and browser; check the console
  for hydration mismatch warnings on Settings.
