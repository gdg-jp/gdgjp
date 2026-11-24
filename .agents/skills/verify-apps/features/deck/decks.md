# deck lifecycle: create, rename, duplicate, delete

A member creates a deck per OBS, renames it, duplicates it for another OBS, and deletes it.
Open phones and docks follow these changes through the deck's room.

## Sub-features

- `deck-create`: the empty home shows **まだデッキがありません。**; **デッキを作成** opens a dialog
  with **名前**, **列** (5), **行** (3); **作成** redirects to `/decks/<id>/edit`; the home lists the
  deck with **ドック未接続** and **編集**.
- `deck-rename`: **デッキのメニュー** → **名前を変更** → **保存** renames without bumping the layout
  version; the editor, an open phone, the dock, and the home show the new name.
- `deck-duplicate`: **複製** opens **デッキを複製** with **名前** `<name> のコピー`; **複製** redirects to
  the copy's editor with the same keys and images and a different dock URL.
- `deck-delete`: **削除** asks **「<name>」を削除しますか？**; **削除** returns to `/`; an open phone
  shows **このデッキは削除されました** and the dock **このデッキは削除されました。**.

## How to get to it (user POV)

`http://localhost:6189/` lists the decks of the member's chapters. The editor's top bar has the
deck name, **保存**, **操作画面**, and the **…** button **デッキのメニュー**.

## Driving it with Orca Browser

Preconditions: `member` signed in within `deck-member`. No deck exists in a fresh stack. Use a
unique name `verify-deck <run-id>` (at most 60 characters).

- Create. `goto /`. Require **まだデッキがありません。** and two **デッキを作成** controls (the icon
  button and the empty-state button). Click either. Require the dialog **デッキを作成** with
  **OBS 1 台につき 1 つ作ります。**, **名前** (required), **列** `5`, **行** `3`, and no **チャプター**
  field (one chapter). Fill **名前**, set **列** `4` and **行** `2`, click **作成**. Require the URL
  `/decks/<id>/edit` (record `DECK`), the title `<name> を編集 — deck`, the name in the top bar,
  and eight slots named **空き 1 にキーを追加** … **空き 8 にキーを追加**. Independent check: `goto /`
  and require one row with the name, the chip **ドック未接続**, and **編集**; reload keeps it.
- Rename. With the phone page `/d/$DECK` open in a second tab of `member2` (see
  [phone.md](phone.md)), open **デッキのメニュー** → **名前を変更**. Require the dialog **名前を変更** with
  **名前** prefilled. Fill `<name> 改`, click **保存**. Require the dialog closed and the top bar
  `<name> 改`. Without reload, the phone header (desktop width) and the dock header show the new
  name. Independent check: `goto /` shows `<name> 改`. The editor's **未保存** chip does not appear.
- Duplicate. Open **デッキのメニュー** → **複製**. Require **デッキを複製**, the description starting
  **キーと画像をすべてコピーします。**, and **名前** `<current name> のコピー`. Click **複製**. Require a
  new `/decks/<id2>/edit` URL with the same key names in the grid and, when a key uses an image,
  an `<img>` whose `src` is `/images/<id2>/<image id>` and loads 200. Open **OBS のドック URL** on
  both decks and compare without printing: the `t` values differ. `goto /`: both rows are listed.
- Delete. On the copy's editor (keep the original for later journeys unless this is the last
  journey), open a phone tab `/d/<id2>` and a dock tab for `<id2>` first. Open
  **デッキのメニュー** → **削除**. Require **「<name> のコピー」を削除しますか？** and
  **キー、画像、操作ログがすべて消えます。元に戻せません。**. Click **やめる**: nothing changes. Repeat and
  click **削除**. Require the URL `/` without the copy's row. The phone tab shows
  **このデッキは削除されました** with **デッキ一覧へ**; the dock tab shows **このデッキは削除されました。**.
  Independent check: `curl -b member.jar -o /dev/null -w '%{http_code}' http://localhost:6189/d/<id2>`
  prints `404`, and the copied image URL prints `404`.
- Evidence: dialog snapshots, the redirect URLs, home list snapshots before and after, the phone
  and dock screenshots after delete, and curl status lines.

## Gotchas

Create is a form POST that redirects; the e2e suite retries the opening click because the dialog
trigger can render before hydration. If the first click opens nothing, snapshot again and click
once more. With several chapters the dialog adds **チャプター**; the fixture identities have one.
Deleting the original deck invalidates every later journey that uses `DECK`; delete the
duplicate instead and keep the original until the end.
