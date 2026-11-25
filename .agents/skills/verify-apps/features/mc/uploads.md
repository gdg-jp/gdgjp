# mc uploaded clips

An operator adds a clip on the day from the controller. The audio goes to R2 (served at
`/media/<id>`), the title, text, and position to D1, and the room pushes the new catalogue to
every controller and player, which preloads it.

## Sub-features

- `mc-clip-upload`: **音声を追加** at the end of a tab opens the editor; choosing a file uploads it
  and shows its name and length; **見出し** defaults to the file stem; **登録** adds a card at the
  chosen **位置**; the player preloads and plays it; **編集** changes it with **保存**; **削除** removes
  it after **この音声を削除しますか？** / **削除する**; **キャンセル** after an upload discards the audio.
- `mc-common-upload`: **共通の音声を追加** opens the editor with **トラック** set to **共通**; the new clip
  appears as a shelf chip with its own **編集** button.

## How to get to it (user POV)

On `/`, scroll to the end of the selected tab and press the outlined **＋** (**音声を追加**). For a
shared clip press the **＋** at the end of the header shelf (**共通の音声を追加**). Uploaded clips
show a pencil (**編集**) on their card or chip.

## Driving it with Orca Browser

Preconditions: `operator` on `/` in `mc-operator`, tab `A`, a track A player open in `mc-player`
with the lamp `ok` and 診断 preload `16/16`. Test file: the bundled
`<scratch root>/apps/mc/public/audio/X-01.mp3` (7.2 s; the scratch root is `ready.json.scratch`).
Choose a unique title such as `verify-mc <run-id>`. The stack has no `GEMINI_API_KEY`, so the
text is typed by hand.

- Open and upload. Click **音声を追加**. Require a dialog with **音声ファイルを選択**, **トラック** `A`,
  **位置** `… の後` naming the last A clip, **見出し**, **テキスト**, and **登録** disabled. Start capture.
  Run `orca upload --page <id> --element <ref of 音声ファイルを選択> --files <X-01.mp3 path>`.
  Require the attachment `X-01.mp3` with `0:07`, **見出し** `X-01`, and a `POST /api/clips/upload`
  200 whose JSON has `id` `U-<10 hex>` and `transcribeError` `no-key`. Record the id.
- Register. Fill **見出し** with the unique title and **テキスト** with `一行目です。` newline `二行目です。`.
  Click **登録**. Require the dialog closed, `POST /api/clips` 200, and the last card containing the
  title and `一行目です。二行目です。` with file `X-01.mp3` and an **編集** button.
- Reaches the player. In **診断**, preload becomes `17/17`. On the player tab,
  `performance.getEntriesByType('resource').some(e=>e.name.endsWith('/media/<id>'))` is true.
  Click the new card's **再生**: `data-status` `playing`, then `ended` within 9 s.
- Independent checks. Reload the controller: the card is still last with the same title.
  `curl -s -o /dev/null -w '%{http_code} %{content_type}' http://localhost:6187/media/<id>` prints
  `200 audio/mpeg`; with `-H 'Range: bytes=0-99'` it prints `206`. A second controller tab shows
  the card without reload when the first tab edits it (next step).
- Edit. Click the card's **編集**. Change **見出し** to `<title> 改`, click **保存**. Require
  `PATCH /api/clips/<id>` 200 and the card text `<title> 改` in both controller tabs.
- Delete. Click **編集**, then **削除**. Require the alert **この音声を削除しますか？**; click **削除する**.
  Require `DELETE /api/clips/<id>` 200, no card with the title, preload back to `16/16`, and
  `curl` of `/media/<id>` now `404`.
- Cancel discards. Click **音声を追加**, upload the same file, note the new id from the upload
  response, then click **キャンセル**. Require a `DELETE /api/clips/<new id>` request (keepalive)
  and `/media/<new id>` `404` by `curl`.
- Common. Click **共通の音声を追加**. Require **トラック** `共通` and **位置** naming the last 共通 clip
  (`X-04 まもなく開始 の後`). Upload the file, set **見出し** `verify-mc common <run-id>`, type one line,
  click **登録**. Require a new shelf chip with that title and an **編集** button beside it; on
  track A's player 診断 preload becomes `17/17`. Delete it through its **編集** → **削除** →
  **削除する**.
- Evidence: editor snapshots before and after upload, the sanitized network list (status codes
  and the clip id), card or chip snapshots, the curl status lines, and one screenshot of the
  editor with the attachment.

## Gotchas

The upload happens as soon as a file is chosen, before **登録**; an editor closed without
registering deletes that audio by a keepalive request, which can be missing from capture if the
tab closes at once. **登録** stays disabled until the upload finishes, the title is non-empty,
and the text has at least one line. Decoding runs in the browser with `AudioContext`; if the
engine cannot decode the file, the toast **この音声は読み込めません** appears and nothing uploads.
The id format is `U-` plus 10 hex characters; `/media` ids are public by design (the OBS player
fetches them without a session). Uploads persist in the run's R2 and D1 until cleanup.
