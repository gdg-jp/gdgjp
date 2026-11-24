# Event creation and sheet design

An organizer creates an event, lands on its default sheet ("本編"), chooses roles, adds a track
and a phase, enters demand, and manages several sheets from the event's sheet list.

## Sub-features

- `roster-event-create`: `/events/new` creates the event, its time slots, and the 全体 track,
  then redirects to `/e/:id/s/default:<id>/design`.
- `roster-sheet-design`: 使う役割 (seeded 受付 / 誘導 / 司会 / 配信 / 記録 / 設営, plus event-owned
  roles), トラック, フェーズと時間枠, シフト表設定, and the 需要 matrix with its drawer.
- `roster-sheets`: `/e/:id` lists sheets; **シフト表を追加** creates another; **公開にする** /
  **非公開にする** and **アーカイブ** act per sheet. Legacy `/e/:id/design` redirects to the
  default sheet.

## How to get to it (user POV)

From `/` choose **イベントを作成**. After creation the app opens the sheet's design screen. The
sidebar links **シフト表一覧**, **割当**, **設計**, **スタッフ**, **共有** move between screens.

## Driving it with Orca Browser

Identity: `owner`. Precondition: fresh stack; no events exist.

- Create. `goto /dev/login?as=verify-roster&chapter=1:dev-chapter&return_to=/`. Require
  **最初のイベントを作成**. Click **イベントを作成**, fill イベント名 `Verify Roster Event`
  and 開催日 `2030-06-01`, leave 開始 09:00, 終了 19:00, 刻み幅 60, click **作成する**.
  Require the URL to match `/e/<id>/s/default:<id>/design` and record `<id>`. Require headings
  シフト表設定, フェーズと時間枠, トラック, 使う役割, 需要, and a 全体 track.
- Validation. On `/events/new`, submit with an empty イベント名. The browser's `required`
  check blocks the submit (alert `Please fill in this field.`) before the server message
  イベント名を入力してください。 can appear; require no new event on `/`.
- Roles. Check **受付**, click **役割を保存**, reload, require 受付 still checked. Fill 新しい役割
  with `クローク`, click **役割を作成**, require a checked クローク. Fill 「クローク」の名前 with
  `クローク・荷物`, click **名前を変更**, require a checked クローク・荷物.
- Track and phase. In the トラック form fill 名前 `Track A`, click **トラックを追加**, require
  `Track A` listed. In the phase form fill 名前 `午前`, 開始 `09:00`, 終了 `12:00`, click
  **フェーズを追加**, require 午前 listed and 時間枠（10） (phases tag slots; they do not change
  the count).
- Demand. Require 需要はまだありません。「役割を追加」から始めてください。 In 需要, leave the
  track select on 全体, choose 受付 in the role select, and click **役割を追加**. Click the first
  **需要なし** cell. In the
  drawer fill 最小 `1`, 理想 `2`, リード最小 `0`, 初参加上限 `99`, click **保存**. Require that
  cell no longer reads 需要なし. The matrix opens in フェーズ mode, so that first cell is the 午前
  row and covers the 09:00–10:00, 10:00–11:00, and 11:00–12:00 slots; the remaining slots sit in
  フェーズ未設定 with no demand.
- Settings. Uncheck **新人を単独の時間枠に割り当てない**, click **シフト表設定を保存**, reload,
  require it unchecked. Later journeys rely on this when every applicant is a newcomer.
- Sheets. `goto /e/<id>`. Require one card with the 本編 badge and 0件公開中. Click
  **シフト表を追加**, fill シフト表名 `懇親会`, 開催日 `2030-06-01`, 開始時刻 `19:00`, 終了時刻
  `21:00`, click **シフト表を作成**. Require a second card 懇親会 with 非公開, and links
  **割当を開く** and **設計を編集**. Open その他の操作 on 懇親会 only if testing archive: click
  **アーカイブ**, confirm **アーカイブする**, require the card gone. Skip archive if later journeys
  need the second sheet.
- Legacy redirect. HTTP `GET /e/<id>/design` with an owner cookie and require 302 to
  `/e/<id>/s/default:<id>/design`.

Independent check: mint an owner cookie with `curl -c` against the `/dev/login` URL, `GET /`, and
require `Verify Roster Event` in the body; `GET /e/<id>` and require `懇親会`.
Evidence: the event id, screenshots of the design screen after demand entry and of the sheet list.

## Gotchas

The default sheet id is literally `default:<eventId>`; keep the colon when building URLs. The demand
matrix shows no columns until a role is added with **役割を追加**, and that menu only offers roles
checked in 使う役割. Changing 開始時刻, 終了時刻, or 刻み幅 after demand exists triggers the
時間枠の設定変更を確認 dialog and can delete demand; do not change them mid-run. The 懇親会 sheet is
an ordinary sheet name; it is unrelated to the hidden `has_party` 懇親会 field.
