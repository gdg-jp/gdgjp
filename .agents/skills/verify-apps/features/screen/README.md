# screen feature map

screen (`apps/screen`, `screen.gdgs.jp`) carries speakers' camera, mic and screen share to OBS.
Operators run a stage's control room; speakers join from the stage's invite link without
signing in; each output slot has token-gated OBS Browser Source pages. Live state is one
`StageRoom` Durable Object per stage. Media goes through the Cloudflare Realtime SFU.

Drive these journeys in the stack started by [verify-apps](../../SKILL.md) with
`--app screen` at `http://localhost:6188` (built Worker preview, fresh D1 and Durable Object
state, no stages). The helper builds without the DeepFilterNet assets and supplies no
`REALTIME_APP_TOKEN`, so every page reports the SFU as reconnecting. Everything carried by the
room socket still works: presence, slot assignment, ON AIR, cues, chat, timer, names and
output tokens. Every journey starts as `NOT VERIFIED`.

## Identities

| Identity | How | Reaches |
| --- | --- | --- |
| Anonymous | no session | invite lobby `/<stageId>/`, `/join/<token>`, OBS outputs with a token; `/` and `/stages/*` 302 to `/signin` |
| `operator` | `ready.json.applications.screen.fixtureLogins.operator.url` (`as=verify-op`, `1:dev-chapter`) | stage list, control room, `/api/stages` |
| Speaker | a second isolated Orca profile with no session | lobby and speaker room |
| OBS output | any profile; the URL carries `t=<outputToken>` | `/out/<stage>/<slot>/<camera\|screen\|mic>` |

Any chapter member is an operator; stages are not scoped to a chapter.

## Routes

| Route | Who | Main actions | Visible states |
| --- | --- | --- | --- |
| `/` | operator | **ステージを作成** (dialog: **名前**, **出力枠の数** `1 枠`..`4 枠`, **ID**, **ID を再生成**, **作成**); row link to the control room; row **メニュー** | empty state with a large **ステージを作成**; per row ON AIR dot, outputs and participants counts (polled every 5 s) |
| `/stages/:stageId` | operator | **ON AIR**; slots `出力枠 A`..; participant rows with `<name> の出力枠` radios **A に出力**, noise-suppression and monitor buttons; **A の割り当てを解除**; tabs **チャット** / **カンペ**, **宛先**, presets **残り 5 分** **巻いて** **音が出ていません**, **カンペ**, **カンペを送る**; timer **開始** **一時停止** **リセット** **分**; operator name button (dialog **登壇者に表示される名前**, **保存**); talkback devices; **OBS** dialog; **メニュー** (**招待リンクをコピー**, **OBS URL**, **名前を変更**, **リセット**, **削除**) | empty slots `空き`, `カメラなし`, `画面共有なし`; participant icons `ミュート`, `カメラ オフ`, `再接続中`; toasts `…をコピーしました` |
| `/:invite` (`/<stageId>/`) | anyone | language **日本語** / **English**, device menus, **お名前**, **参加**; in the room **送信** chat, **画面を共有**, **ミニ表示**, **退出**, cue **OK** | `リンクが無効です` for an unknown stage; alert `お名前を入力してください`; chips ON AIR (`data-tone` idle/onair) and connection; slot badge; cue alert; `このステージは削除されました`; `PC のブラウザで開いてください` on mobile UA |
| `/join/:token` | anyone | none | 301 to `/<token>/` |
| `/out/:stageId/:slot/:kind?t=` | OBS | none (transparent page); `&debug=1` shows a JSON status block | `.sc-out-frame` opacity 0 when nothing is wanted; with a wrong token the socket stays `offline` and `peer` is null |
| `/signin`, `/api/auth/*`, `/auth/signout`, `/no-chapter`, `/dev/login` | plumbing | none | without Accounts, `/api/auth/signin` answers a 503 retry page |

## Journeys

| ID | Feature | Identity | Recipe | Map |
| --- | --- | --- | --- | --- |
| `screen-operator-gate` | Operator pages need sign-in | anonymous | [stages](stages.md) | local |
| `screen-stage-create` | Create a stage with a custom ID | operator | [stages](stages.md) | local |
| `screen-stage-id-rules` | Duplicate and reserved IDs | operator | [stages](stages.md) | local |
| `screen-stage-rename-delete` | Rename and delete, seen by a speaker | operator, speaker | [stages](stages.md) | local |
| `screen-invalid-invite` | Unknown invite link | anonymous | [speaker](speaker.md) | local |
| `screen-speaker-lobby` | Language, name check, join | speaker | [speaker](speaker.md) | local |
| `screen-slot-assignment` | Assign and clear an output slot | operator, speaker | [control room](control-room.md) | local |
| `screen-on-air-cues` | ON AIR, cue cards, timer | operator, speaker | [control room](control-room.md) | local |
| `screen-chat` | Speaker to operator chat | speaker, operator | [control room](control-room.md) | local |
| `screen-obs-outputs` | OBS URLs, tokens, reissue | operator, OBS | [outputs](outputs.md) | local |
| `screen-operator-name` | Name shown to speakers | operator, speaker | [control room](control-room.md) | local |
| `screen-stage-reset` | Reset chat, cues, slots, ON AIR | operator | [control room](control-room.md) | local |
| `screen-media` | Camera, mic, screen tracks reach OBS and the control room | operator, speaker, OBS | none | outside: needs the Realtime SFU and media devices |
| `screen-talkback` | Push-to-talk while ON AIR | operator | none | outside: needs a microphone and the SFU |
| `screen-denoise` | DeepFilterNet noise suppression | operator, speaker | none | outside: assets are not built, needs audio |
| `screen-mini-window` | Document Picture-in-Picture mini window | speaker | none | outside: Orca cannot open a PiP window |
| `screen-oidc-signin` | Real Accounts sign-in | operator | [OIDC sign-in](../oidc-signin.md) | Local with `--accounts` |

Run the speaker in a separate isolated profile so its participant ID in localStorage and its
language cookie do not leak into the operator profile.
