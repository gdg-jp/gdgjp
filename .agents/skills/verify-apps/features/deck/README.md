# deck feature map

deck (`apps/deck`, `deck.gdgs.jp`) replaces Stream Deck Mobile for OBS. Chapter members build a
deck in the PC editor (pages, folders, keys that run OBS actions, multi-actions) and press keys
from a phone page. An OBS custom browser dock (`/dock/<deck>?t=<token>`, no sign-in) holds the
only obs-websocket connection and links OBS to the deck's `DeckRoom` Durable Object.

Drive these journeys in the stack started by [verify-apps](../../scripts/verify-apps.mjs) at
`http://localhost:6189` (built Worker preview, fresh local D1 and R2, no decks). The helper also
runs the repository's fake obs-websocket (`apps/deck/e2e/fake-obs.ts`) on
`ws://127.0.0.1:4467` with no password. It reports OBS `32.2.2`, scenes `Main` (program),
`Break`, `Ending`, scene items `Main` → `Camera` (1), `Logo` (2), `Break` → `Logo` (3), inputs
`Mic` (-6 dB, unmuted), `Desktop`, `Camera`, `Logo`, and hotkeys `OBSBasic.StartStreaming`,
`OBSBasic.Screenshot`. Every journey starts as `NOT VERIFIED`; a recipe here is not execution
evidence.

## Identities

All sign-ins use `/dev/login`; the URLs are in `ready.json.applications.deck.fixtureLogins`.
Use one isolated Orca profile per identity, plus a session-less `deck-dock` profile for the dock.
Deck access is by chapter only; the role suffix changes nothing.

| Identity | Sign-in path | Reaches |
| --- | --- | --- |
| Anonymous | none | `/dock/:deckId?t=<token>`; everything else 302 to `/signin` |
| `member` | `/dev/login?as=verify-deck&chapter=1:dev-chapter&return_to=/` | every screen for chapter 1 decks |
| `member2` | `/dev/login?as=verify-deck-2&chapter=1:dev-chapter:member&return_to=/` | the same decks; a second person for live updates, the operation log, and save conflicts |
| `outsider` | `/dev/login?as=verify-deck-outsider&chapter=2:other-chapter&return_to=/` | `/` with no chapter 1 decks; 404 on chapter 1 deck routes |
| `no-chapter` | `/dev/login?as=verify-deck-nochapter&chapter=0:none&return_to=/` | `/no-chapter` only |

`chapter=0:none` parses to no chapters; omitting `chapter` yields the `1:dev-chapter` organizer.

## Routes

| Route | Who can reach it | Main actions | Visible states |
| --- | --- | --- | --- |
| `/` | Signed in with a chapter; anonymous 302 to `/signin?return_to=%2F`; chapterless 302 to `/no-chapter` | **デッキを作成** (icon button, and a text button in the empty state) opens the dialog **デッキを作成** with **名前**, **チャプター** (only with several chapters), **列** (5), **行** (3), **作成**; each row links to `/d/<id>` and has **編集**; **アプリ一覧**, **Account menu** → **ログアウト** | Heading **デッキ**; empty **まだデッキがありません。**; row chips **ドック未接続**, **OBS 未接続**, **接続中**, **配信中**, **録画中** (polled every 5 s); chapter slug per row with several chapters |
| `/decks/:deckId/edit` | Members of the deck's chapter; others 404 | **保存**, **操作画面** (new tab `/d/<id>`), **デッキのメニュー** → **OBS のドック URL** / **名前を変更** / **複製** / **削除**; toolbar **画面** (ホーム / `フォルダ: <name>`), **フォルダを追加**, **フォルダ名**, **フォルダを削除**, **列**, **行**; tablist **ページ** with `1`, `2`, ..., **ページを追加**, **ページを左へ**, **ページを右へ**, **ページを削除**; grid slots **空き N にキーを追加** / **キー: <title>**; inspector **キーを削除**, **タイトル**, **種類**, **操作** and op fields, **誤操作の防止**, **長押しの秒数**, **背景色** swatches, **アイコン**, **画像をアップロード** / **画像を外す**, **オンのときの見た目を変える**; OBS panel **OBS を読み直す** and **操作ログ** | **未保存** chip; toasts **保存しました**, **設定が足りないキーが N 個あります（赤い印）**, **ほかの人が先に保存しました**, **保存できませんでした**, **デッキが大きすぎます**; alert **ほかの人がこのデッキを保存しました** with **自分の変更を捨てて最新を読み込む**; OBS chip **オフライン** / **ドック未接続** / **OBS 未接続** / `OBS 32.2.2 ・ シーン 3`; missing-reference warnings such as `シーン「X」が見つかりません`; **キーを選ぶと、ここで設定できます。**; log **まだ操作はありません** or rows with 実行中 / 成功 / 失敗; native confirms for grid shrink and page removal; beforeunload prompt while dirty |
| Deck dialogs (on the editor) | Same as the editor | **OBS のドック**: field **ドックの URL**, **コピー**, **URL を再発行** → **ドックの URL を再発行しますか？** (**やめる** / **再発行**); **名前を変更** (**名前**, **保存**); **デッキを複製** (**名前** default `<name> のコピー`, **複製**); **「<name>」を削除しますか？** (**やめる** / **削除**) | Duplicate and create redirect to the new editor; delete redirects to `/` |
| `/d/:deckId` | Members of the deck's chapter; others 404 | Press keys (tap, **N.N 秒長押し**, **2 回タップ**, **押している間**), folder keys, **戻る**, **デッキ一覧**, page nav **前のページ** / **N ページ** / **次のページ**, volume dialog (**音量** slider, **閉じる**) | **接続しています…** before the room answers; chips **オフライン**, **ドック未接続**, **OBS 未接続**, **接続中**, **配信**, **録画** / **録画 ❚❚**; keys `aria-pressed` when on, elapsed badge while streaming/recording, `もう一度` while armed; disabled keys while the dock or OBS is down; error toasts from failed steps; **このデッキは削除されました** with **デッキ一覧へ**; phone portrait hides the header |
| `/dock/:deckId?t=<token>` | Anyone with the deck's current dock token (OBS custom browser dock) | **設定** / **閉じる**, form **obs-websocket の URL**, **パスワード**, **スクリーンショットの保存先フォルダ**, **保存して接続**; **このドックで接続し直す** after being replaced | **この URL は使えません。デッキの編集画面から新しいドックの URL をコピーしてください。** for a wrong token or unknown deck; status `deck.gdgs.jp` **接続中…** / **接続** / **再接続中…**, `OBS` **接続中…** / `接続 (32.2.2)` / **未接続** / **パスワードが違います**; help text while OBS is offline; **この URL は再発行されました。新しい URL をドックに設定してください。**, **別のドックが接続したため切断しました。**, **このデッキは削除されました。**; region **操作ログ** |
| `/api/decks` (POST `intent=create\|rename\|duplicate\|rotate-dock\|delete`), `/api/decks/:deckId/layout` (POST), `/api/decks/:deckId/images` (POST) | Members of the deck's chapter; other chapters 404 | Used by the editor | layout 409 on a stale `version`, 413 when too large, 400 invalid; images 413 / 415; GET `/api/decks` redirects to `/` |
| `/images/:deckId/:imageId` | Members of the deck's chapter | Key images | 404 for others or unknown ids |
| `/signin` | Anyone | none | 302 to `/api/auth/signin` (OIDC against Accounts) |
| `/no-chapter` | Signed in without a chapter | link **accounts.gdgs.jp** | **GDG チャプターへの参加が必要です** |
| `/auth/signout` | Anyone | none | Clears the session, 302 to `/signin` |
| `/api/auth/*`, `/dev/login`, `/ws` | Plumbing | none | not screens (`/ws?role=dock` needs the token, 403 otherwise; `role=controller` needs chapter membership, 401 otherwise) |

## Independent OBS read

The fake OBS keeps its state for the whole run and has no reset endpoint. Read it as a second
obs-websocket client from `<scratch root>/apps/deck` (where `ws` resolves):

```sh
node --input-type=module -e '
import WebSocket from "ws";
const [type, data] = [process.argv[1], JSON.parse(process.argv[2] ?? "{}")];
const ws = new WebSocket("ws://127.0.0.1:4467");
ws.on("message", (raw) => {
  const m = JSON.parse(raw);
  if (m.op === 0) ws.send(JSON.stringify({ op: 1, d: { rpcVersion: 1 } }));
  else if (m.op === 2) ws.send(JSON.stringify({ op: 6, d: { requestType: type, requestId: "v", requestData: data } }));
  else if (m.op === 7) { console.log(JSON.stringify(m.d)); ws.close(); }
});' GetSceneList '{}'
```

Useful reads: `GetSceneList` (`currentProgramSceneName`), `GetStreamStatus`, `GetRecordStatus`,
`GetInputMute '{"inputName":"Mic"}'`, `GetInputVolume '{"inputName":"Mic"}'`,
`GetSceneItemList '{"sceneName":"Main"}'`. Only send `Get*` requests; a `Set*` request from the
check would change the state under test. `TriggerHotkeyByName` changes no state, so a hotkey
press is observable only through the dock and editor logs.

## Journeys

| Journey ID | Feature | Identity | Recipe | Status |
| --- | --- | --- | --- | --- |
| `deck-access` | Sign-in gate, chapterless gate, cross-chapter 404 on pages, APIs, and images | Anonymous, `no-chapter`, `outsider`, `member` | [access.md](access.md) | In map |
| `deck-signout` | **Account menu** → **ログアウト** clears the session | `member` | [access.md](access.md) | In map (run last) |
| `deck-create` | Empty home, create dialog, redirect to the editor, home row and chip | `member` | [decks.md](decks.md) | In map |
| `deck-rename` | Rename from the menu; phone and home follow | `member` | [decks.md](decks.md) | In map |
| `deck-duplicate` | Duplicate with keys and images, new dock token | `member` | [decks.md](decks.md) | In map |
| `deck-delete` | Delete; open phone and dock are told | `member`, Anonymous dock | [decks.md](decks.md) | In map |
| `deck-key-edit` | Add, configure, save, and delete keys; incomplete keys block saving | `member` | [editor.md](editor.md) | In map |
| `deck-key-look` | Colors, icons, on-look, and image upload | `member`, `outsider` | [editor.md](editor.md) | In map |
| `deck-folders-pages` | Folders, folder/back keys, pages, grid resize | `member` | [editor.md](editor.md) | In map |
| `deck-save-conflict` | A stale save gets 409 and the stale alert; discard reloads | `member`, `member2` | [editor.md](editor.md) | In map |
| `deck-dock-connect` | Dock URL, first-run settings, connect to OBS, editor and home status | `member`, Anonymous dock | [dock.md](dock.md) | In map |
| `deck-dock-token` | Wrong token, reissue disconnects the dock, a second dock replaces the first | `member`, Anonymous dock | [dock.md](dock.md) | In map |
| `deck-dock-obs-offline` | Wrong obs-websocket URL shows 未接続 and help; keys disable | Anonymous dock, `member` | [dock.md](dock.md) | In map |
| `deck-press-scene` | Scene key switches the program scene and lights up | `member` | [phone.md](phone.md) | In map |
| `deck-press-confirm` | Hold-to-fire stream key, double-tap record key | `member` | [phone.md](phone.md) | In map |
| `deck-press-momentary` | Push-to-talk unmutes while held | `member` | [phone.md](phone.md) | In map |
| `deck-press-multi` | Multi action runs scene then source-hide in order | `member` | [phone.md](phone.md) | In map |
| `deck-folder-nav` | Folder opens, hotkey key reaches OBS, back returns | `member` | [phone.md](phone.md) | In map |
| `deck-volume` | Volume slider key opens a dialog and sets the input volume | `member` | [phone.md](phone.md) | In map |
| `deck-live-layout` | An editor save reaches an open phone without reload | `member`, `member2` | [phone.md](phone.md) | In map |
| `deck-phone-layout` | Portrait phone: no header, grid rotated to 2 × 4, fills the screen | `member` | [phone.md](phone.md) | In map |
| `deck-oidc-signin` | Real sign-in through Accounts OIDC | Accounts session | [OIDC sign-in](../oidc-signin.md) | Local with `--accounts` |
| `deck-real-obs` | A real OBS: dock inside OBS, actual scene switch, stream, screenshot files | OBS operator | none | Outside: needs OBS Studio; the fake OBS covers the wire protocol only |
| `deck-obs-auth` | **パスワードが違います** on a wrong obs-websocket password | Anonymous dock | none | Outside until the fake OBS companion is started with a password; with no password any password connects |
| `deck-key-reorder` | Drag a key onto another slot | `member` | none | Outside: HTML5 drag and drop needs `dragstart`/`drop`, which Orca's `mouse` commands do not reliably produce; `moveKey` has unit tests |
| `deck-pwa` | Add to home screen, wake lock, haptics | `member` on a phone | none | Outside: needs a real mobile browser and device APIs |
| `deck-screenshot-action` | Screenshot key saving into the dock's folder | `member` | none | Outside: the fake OBS does not implement `SaveSourceScreenshot`, so the step fails by design |

Order: `deck-create` → `deck-dock-connect` → the editor journeys → the phone journeys →
`deck-dock-token` and `deck-dock-obs-offline` → `deck-rename`, `deck-duplicate` → `deck-delete`
→ `deck-signout`. The fake OBS state carries across journeys (for example streaming stays on);
read it before each assertion and assert changes, not absolute values, unless the recipe says
otherwise.
