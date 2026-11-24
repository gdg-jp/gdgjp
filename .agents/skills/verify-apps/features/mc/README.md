# mc feature map

mc (`apps/mc`, `mc.gdgs.jp`) plays pre-generated AI MC audio remotely. A chapter member opens
the controller (`/`), picks a track tab (A, B, C), and sends play/stop/seek commands through
that track's `McRoom` Durable Object to the track's player page (`/play?track=<A|B|C>&t=<token>`),
which an OBS Browser Source loads. The player renders nothing (except an unlock button when
autoplay is blocked) and only emits audio. Clips added from the controller go to R2 + D1.

Drive these journeys in the stack started by [verify-apps](../../scripts/verify-apps.mjs) at
`http://localhost:6187` (built Worker preview, fresh local D1, fresh `McRoom` storage, empty R2,
no `GEMINI_API_KEY`). Bundled clips (`app/features/clips/clips.json`, `public/audio/*.mp3`) are
always present: A has 12 clips, B 13, C 11, and 共通 (common) 4 (`X-01`..`X-04`). Every journey
starts as `NOT VERIFIED`; a recipe here is not execution evidence.

## Identities

All sign-ins use the local-only `/dev/login` route; the URLs are in
`ready.json.applications.mc.fixtureLogins`. Sign each identity in within its own isolated Orca
profile. mc has no per-chapter scoping: a member of any chapter controls every track.

| Identity | Sign-in path | Reaches |
| --- | --- | --- |
| Anonymous | none | `/play` (token-gated socket), `/media/:id`; `/` 302 to `/signin?return_to=%2F` |
| `operator` | `/dev/login?as=verify-mc&chapter=1:dev-chapter&return_to=/` | the controller, clip upload API |
| `outsider` | `/dev/login?as=verify-mc-outsider&chapter=2:other-chapter&return_to=/` | the controller too (any chapter is enough) |
| `no-chapter` | `/dev/login?as=verify-mc-nochapter&chapter=0:none&return_to=/` | `/no-chapter` only |

`chapter=0:none` parses to no chapters. Omitting `chapter` gives the default `1:dev-chapter`
organizer, not a chapterless user. A player page needs no identity; its credential is the
64-hex `t` token, which is per track and lives in the track's `McRoom`.

## Routes

| Route | Who can reach it | Main actions | Visible states |
| --- | --- | --- | --- |
| `/` | Signed-in user with any chapter; anonymous 302 to `/signin?return_to=%2F`; chapterless 302 to `/no-chapter` | Track tabs `A` `B` `C` (tablist **トラック**, switch asks **トラック X に切り替えますか？** / **切り替える**); per clip card **再生** / **停止**, **最初から再生**, seek slider (named by the clip title), **再生済み** toggle, **編集** (uploaded clips only); **音声を追加** at the end of each tab; 共通 chips in the header shelf and **共通の音声を追加**; now-playing bar (region **再生中**) with **再生** / **停止**, **最初から再生**, seek, **ループ**, **ループ間隔** popover (**短く**, **ループ間隔（秒）**, **長く**); **診断** sheet | Lamps: **司会PC 接続中** / **司会PCがオフラインです**; player lamp (`data-testid=player-lamp`, `data-state` ok / down / multi / unknown) named **配信PC 接続中**, **配信PCが接続されていません**, **配信PCが複数接続されています**; red issue strip (`data-testid=issue`) for blocking issues; failure toasts (e.g. **配信PCが接続されていません**, **配信PCから応答がありません**); gap countdown while looping |
| 診断 sheet (on `/`) | Same as `/` | **Player URL (Track X)** read-only field (`data-testid=player-url`), **コピー** (toast **コピーしました** / **コピーできませんでした**), **再発行** (two confirmations), **再生済みをリセット** | Issue list (all issues including non-blocking: **配信PCで音声を読み込み中です**, **配信PCのページが非表示です**, ...); 司会PC `open · Nms`; per player `配信PC <connId>` with preload n/m, autoplay, volume, visibility, clock, status · clipId, UA; event log (**配信PC 接続**, **コマンド送信**, **Player URL 再発行**, ...) |
| Clip editor sheet (on `/`) | Same as `/` | **音声ファイルを選択** (file input `data-testid=clip-file`, `.wav,.mp3,.ogg,.flac,.aac`), **トラック** (A / B / C / 共通), **位置** (**先頭** or `<clip> の後`), **見出し**, **テキスト**, **キャンセル**, **登録** / **保存**, **削除** (edit only, confirm **この音声を削除しますか？** / **削除する**) | Attachment with file name and `m:ss`; 処理中 spinner; toasts **この音声は読み込めません**, **アップロードできませんでした**, **登録できませんでした**, **保存できませんでした**, **削除できませんでした**; **登録** disabled until file uploaded, 見出し and テキスト non-empty |
| `/play?track=<A\|B\|C>&t=<token>` | Anyone (OBS Browser Source); the socket accepts only the track's current token | **音声を有効にする** (only when autoplay is blocked) | Blank page; wrong token or unknown track never counts as connected (socket 403 / 400, endless reconnect); rotated token closes the socket |
| `/media/:id` | Anyone | none | Uploaded clip audio; 206 for Range requests; 404 for an unknown or deleted id |
| `/api/clips` (POST), `/api/clips/upload` (POST), `/api/clips/:id` (PATCH, DELETE) | Signed-in user with a chapter; otherwise 401 `{"error":"unauthorized"}` | Used by the clip editor | 400 / 404 / 409 / 413 / 415 JSON errors |
| `/signin` | Anyone | none | 302 to `/api/auth/signin`, which starts OIDC against Accounts |
| `/no-chapter` | Signed in without a chapter | link **accounts.gdgs.jp** to Accounts `/onboarding` | **GDG チャプターへの参加が必要です**; members go back to `/` |
| `/auth/signout` | Anyone | none | Clears the session and 302 to `/signin` (no sign-out control in the UI) |
| `/api/auth/*` | OIDC plumbing (`/api/auth/me` returns the session user or `null`) | none | not a screen |
| `/dev/login` | Local only | fixture sign-in | 302 to `return_to` |
| `/ws?role=controller\|player&track=X` | Controller needs the session (401 otherwise); player needs `t` (403 otherwise) | WebSocket only | not a screen |

## Journeys

| Journey ID | Feature | Identity | Recipe | Status |
| --- | --- | --- | --- | --- |
| `mc-access` | Sign-in gate, chapterless gate, other-chapter access, API 401 | Anonymous, `no-chapter`, `outsider`, `operator` | [access.md](access.md) | In map |
| `mc-signout` | `/auth/signout` clears the session | `operator` | [access.md](access.md) | In map (run last) |
| `mc-player-url` | 診断 sheet Player URL per track, copy | `operator` | [player-url.md](player-url.md) | In map |
| `mc-player-url-reissue` | Two-step reissue; old URL stops counting | `operator`, Anonymous player | [player-url.md](player-url.md) | In map |
| `mc-playback` | Play is acknowledged, remaining time counts down, stop asks first, resume | `operator`, Anonymous player | [playback.md](playback.md) | In map |
| `mc-restart-seek-switch` | 最初から再生, seek, switching clip while audible, cue while idle | `operator`, Anonymous player | [playback.md](playback.md) | In map |
| `mc-played-marks` | 再生済み toggle persists in the room; reset | `operator` | [playback.md](playback.md) | In map |
| `mc-loop` | Loop toggle, loop gap, gap countdown, ループを停止しますか？ | `operator`, Anonymous player | [playback.md](playback.md) | In map |
| `mc-common-clips` | 共通 chips play on the selected track's player | `operator`, Anonymous player | [playback.md](playback.md) | In map |
| `mc-no-player` | Command with no player fails at once | `operator` | [presence.md](presence.md) | In map |
| `mc-player-lost` | Closed player flagged within seconds; reopened player recovers | `operator`, Anonymous player | [presence.md](presence.md) | In map |
| `mc-wrong-token` | Wrong token never connects | `operator`, Anonymous player | [presence.md](presence.md) | In map |
| `mc-multi-player` | Two players on one track show multi | `operator`, Anonymous player | [presence.md](presence.md) | In map |
| `mc-player-diagnostics` | Player-side diagnostics (preload, autoplay, visibility) reach the controller | `operator`, Anonymous player | [presence.md](presence.md) | In map |
| `mc-autoplay-unlock` | Blocked autoplay shows 音声を有効にする; clicking it unlocks | Anonymous player | [presence.md](presence.md) | Outside: Orca Browser allows autoplay (診断 autoplay `ok`), so the unlock prompt never appears; it needs a browser that blocks autoplay, such as a fresh OBS Browser Source |
| `mc-track-channels` | Tab switch asks first; each track is its own channel and token | `operator`, Anonymous players | [tracks.md](tracks.md) | In map |
| `mc-clip-upload` | Upload, register, play, edit, delete an uploaded clip; player preloads it | `operator`, Anonymous player | [uploads.md](uploads.md) | In map |
| `mc-common-upload` | Upload into 共通 from **共通の音声を追加** | `operator` | [uploads.md](uploads.md) | In map |
| `mc-oidc-signin` | Real sign-in through Accounts OIDC | Accounts session | [OIDC sign-in](../oidc-signin.md) | Local with `--accounts` |
| `mc-obs-audio` | Audible output in the OBS mixer, Browser Source settings | OBS operator | none | Outside: needs a real OBS and audio device. Observable here only as player state reported to the controller (card `data-status`, remaining time, 診断 status · clipId, clock ok) |
| `mc-transcribe` | Gemini transcription of an uploaded clip | `operator` | none | Outside: needs `GEMINI_API_KEY` and an external API; the stack runs without it (`transcribeError: "no-key"`, text typed by hand) |
| `mc-self-offline` | 司会PCがオフラインです and controller reconnect | `operator` | none | Outside: Orca Browser has no network-offline control; reconnect logic is covered by `reliable-socket.test.ts` |
| `mc-muted-stalled` | 配信PCでミュートされています, 配信PCで音声が進んでいません, 配信PCで再生エラーが発生しました | Anonymous player | none | Outside: the player's `Audio` element is detached from the DOM and the page has no mute control; stalls and media errors need a failing audio device or corrupt media |
| `mc-clip-dropzone` | Drag-and-drop a file onto the dropzone | `operator` | none | Outside: Orca sets files through `upload`, not an OS drag; the file-picker path is covered by `mc-clip-upload` |

Order: run `mc-player-url-reissue` after every journey that reuses a copied Player URL, and
`mc-signout` last. Played marks and loop settings live in the track's `McRoom` for the whole run;
reset them (or use another track) before a journey that asserts a fresh state.
