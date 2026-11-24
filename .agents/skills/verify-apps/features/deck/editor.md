# deck editor

The PC editor arranges keys on pages and folders, sets each key's OBS action, confirmation, and
look, and saves the layout as a new version. Saving is refused while a key is incomplete or
when someone else saved first.

## Sub-features

- `deck-key-edit`: clicking **空き N にキーを追加** adds a scene key and selects it; the inspector
  edits **タイトル**, **種類**, **操作**, op fields (for a scene: **シーン**, **切り替え先**),
  **誤操作の防止** (**なし** / **長押し** / **2 回タップ**) and **長押しの秒数**; **キーを削除** removes it;
  an incomplete key blocks **保存** with **設定が足りないキーが N 個あります（赤い印）**; **保存**
  shows **保存しました** and clears **未保存**.
- `deck-key-look`: **背景色** swatches (**グレー**, **青**, **赤**, **緑**, **黄**, **スレート**, **黒**),
  **アイコン** (**アイコンなし** or an icon name), **画像をアップロード** / **画像を外す**,
  **オンのときの見た目を変える**.
- `deck-folders-pages`: **フォルダを追加**, **画面** select, **フォルダ名**, **フォルダを削除**; keys of
  種類 **フォルダを開く** (**フォルダ**) and **フォルダから戻る**; **ページを追加**, page tabs, **ページを左へ** /
  **ページを右へ**, **ページを削除**; **列** / **行** resize with a native confirm when keys would drop.
- `deck-save-conflict`: a second editor that is dirty when another save lands shows
  **ほかの人がこのデッキを保存しました**; its **保存** gets 409 and **ほかの人が先に保存しました**;
  **自分の変更を捨てて最新を読み込む** loads the latest; a clean editor silently takes the new version.

## How to get to it (user POV)

From `/`, choose **編集** on a deck row. The grid is in the middle, the inspector on the right,
and the OBS panel with **操作ログ** under the grid.

## Driving it with Orca Browser

Preconditions: `deck-create` done (`DECK`, 4 × 2, empty); `member` in `deck-member` on
`/decks/$DECK/edit`. For OBS-backed fields the dock should be connected
(`deck-dock-connect`); without it the fields are free text and no warnings appear. Image file:
`<scratch root>/apps/deck/public/icon-192.png`. A cookie jar for HTTP reads:
`curl -s -c member.jar -o /dev/null '<member fixtureLogin URL>'`.

- Add and refuse incomplete. Click **空き 1 にキーを追加**. Require the slot renamed
  **キー: （無題）** with `data-incomplete`, the **未保存** chip, and the inspector with **タイトル**
  empty, **種類** **OBS の操作**, **操作** **シーン**, **シーン** empty, **切り替え先** **番組（本番）**. Click
  **保存**. Require the toast **設定が足りないキーが 1 個あります（赤い印）** and no layout POST in capture.
- Fill and save. Fill **タイトル** `休憩` and **シーン** `Break`. With the dock connected, the
  **シーン** field's datalist holds `Main`, `Break`, `Ending`
  (`[...document.querySelectorAll('datalist option')].map(o=>o.value)`), and typing `Breakx`
  shows **シーン「Breakx」が見つかりません** until corrected. Set **誤操作の防止** to **長押し**; require
  **長押しの秒数** `1.5`. Click **保存**. Require `POST /api/decks/$DECK/layout` 200 with a higher
  `version`, the toast **保存しました**, and no **未保存**. Independent check: reload; the slot is
  **キー: 休憩**; `curl -s -b member.jar http://localhost:6189/decks/$DECK/edit | grep -c '休憩'` is
  at least 1.
- Look and image. Select **キー: 休憩**. Click swatch **赤** (`aria-pressed=true`) and icon
  **アイコンなし**. Click **画像をアップロード** and run `orca upload` on that button with the PNG.
  Require `POST /api/decks/$DECK/images` 200 with `{"ok":true,"id":...}` (record `IMG`), a key
  face `<img>` with `src` `/images/$DECK/$IMG`, and **画像を外す**. Toggle
  **オンのときの見た目を変える** on: a second look block appears. Save. Independent check:
  `curl -s -b member.jar -o /dev/null -w '%{http_code} %{content_type}' http://localhost:6189/images/$DECK/$IMG`
  prints `200 image/webp` (or `image/png` if the engine cannot encode WebP).
- Folders. Click **フォルダを追加**. Require **画面** showing **フォルダ: フォルダ** and **フォルダ名**
  `フォルダ`. Rename it `その他`. Add a key in slot 1 with **種類** **フォルダから戻る**, title `戻る`.
  Switch **画面** to **ホーム**, add a key in slot 2, **種類** **フォルダを開く**, **フォルダ** `その他`,
  title `その他`. Save; reload; both keys remain. **フォルダを開く** is disabled in **種類** when no
  folder exists.
- Pages. Click **ページを追加**. Require tabs `1` `2` with `2` selected and **ページを削除**. Add a key
  on page 2, then click **ページを削除**: Orca reports `browser_dialog_opened` for
  **このページのキーも削除されます。続けますか？**; run `orca dialog dismiss` and require page 2 kept;
  repeat and `orca dialog accept`; require only tab `1`.
- Grid resize. Set **列** to `1`. The native confirm reads **はみ出すキーが N 個削除されます。続けますか？**
  (N counts keys beyond column 1); `orca dialog dismiss` keeps `4`. Do not accept unless the
  journey intends to drop keys.
- Delete a key. Select a key, click **キーを削除**; the slot returns to **空き N にキーを追加** and the
  inspector shows **キーを選ぶと、ここで設定できます。**. Save or discard as the next journey needs.
- Conflict. Open `/decks/$DECK/edit` as `member2` in `deck-member2` (tab B). In the `member`
  tab (tab A) change a title and **保存**. Tab B, still clean, shows the new title without reload.
  In tab B change another title (now **未保存**). In tab A change and **保存** again. Tab B shows the
  alert **ほかの人がこのデッキを保存しました**. Click **保存** in tab B: require
  `POST .../layout` 409 and the toast **ほかの人が先に保存しました**. Click
  **自分の変更を捨てて最新を読み込む**: the alert and **未保存** disappear and tab A's title shows.
  Independent check: with `member.jar`, POST
  `{"version":1,"layout":{"cols":4,"rows":2,"boards":{"root":{"id":"root","name":"ホーム","pages":[{"id":"p1","keys":{}}]}}}}`
  to `/api/decks/$DECK/layout` (`-H 'content-type: application/json'`); it returns `409` because
  the deck is past version 1, and the editor still shows the saved keys.
- Evidence: inspector and grid snapshots before and after each save, sanitized network rows for
  layout and image POSTs (status, version), toasts, dialog receipts, curl lines, and a screenshot
  of the grid with the image key.

## Gotchas

While **未保存** is shown, reloading or navigating triggers the beforeunload prompt; Orca reports
it as a dialog. Answer it, or save first. The 画面, 種類, 操作, 列, 行 controls are Radix selects:
click the trigger, then click the option (Orca `select` works only on native `<select>`). Key
reordering by drag is outside the map. The datalist and missing-reference warnings appear only
while the dock reports a connected OBS. Saves also prune images unused for a day, which does not
affect a run. A key's look under **オンのときの見た目を変える** only shows on the phone when OBS state
makes the key on (for a scene key: that scene is live).
