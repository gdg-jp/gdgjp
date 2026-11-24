# Roster generation and manual edit

The organizer generates a draft roster from demand and registrations, reads its metrics, switches
between three grid views, assigns someone by hand, and moves through the edit history.

## Sub-features

- `roster-generate`: **自動生成** on an empty sheet, **再生成** afterwards with the same シード
  producing the same result; metrics 未充足, 理想充足率, 第1希望の役割, 負荷のばらつき, 条件違反;
  views **スタッフ別**, **役割別**, **充足状況**; 履歴 entries.
- `roster-manual-edit`: a 充足状況 cell opens a drawer with 現在の担当 and ここに入れられる人;
  **追加** assigns even when the candidate is 稼働不可 (warn and allow); **外す** removes;
  **← 元に戻す**, **やり直す →**, and a history entry's **戻す** restore earlier states.
- Legacy `/e/:id/roster` redirects to the default sheet's roster; other sheets stay ungenerated.

## How to get to it (user POV)

`/e/:id`, then **割当を開く** on a sheet card, or the sidebar **割当** under 選択中のシフト表.

## Driving it with Orca Browser

Identity: `owner`. Preconditions: [event-design.md](event-design.md) (受付 demand on the 午前
row, 新人を単独の時間枠に割り当てない unchecked) and [staff-apply.md](staff-apply.md) (two
applicants with 受付: `verify-roster-staff (dev)` unavailable at 10:00–11:00, and `Proxy Staff2`).

- Empty state. `goto /e/<id>/roster`. Require the URL `/e/<id>/s/default:<id>/roster`, heading
  シフト生成, まだ生成していません。, a シード number, button **自動生成**, and 履歴 with
  まだ履歴がありません。
- Generate. Click **自動生成**. Require **再生成**, 前回の実行: `<n>ms · シード <seed>`, the
  metrics row with 理想充足率, and a 履歴 entry labelled 自動生成 marked 現在. Record the 理想充足率
  card text.
- Determinism. Click **再生成** without changing シード. Require the 理想充足率 card text to equal
  the recorded value.
- Views. Click **役割別**, **充足状況**, then **スタッフ別**; require a table after each.
- Manual edit. Click **充足状況**. In the `10:00–11:00` row click the first cell button. Require
  the drawer section ここに入れられる人 and a `verify-roster-staff (dev)` candidate marked
  稼働不可. Click its **追加**. Require the drawer to close; in **スタッフ別** require 稼働× in that
  person's 10:00–11:00 cell, and a new 履歴 entry of kind 手動編集.
- Undo and redo. Click **← 元に戻す**; require 稼働× gone. Click **やり直す →**; require it back.
  On an older 履歴 entry click **戻す** and require that entry to become 現在.
- Sheet scope. If the 懇親会 sheet exists, `goto /e/<id>` and open its **割当を開く**; require
  まだ生成していません。 there.

Independent check: mint an owner cookie with `curl -c` against `/dev/login` and
`GET /e/<id>/s/default:<id>/roster`; require `再生成` and `稼働×` in the body after the redo.
Evidence: screenshots of the metrics row, the drawer with the 稼働不可 candidate, the staff view
with 稼働×, and the history panel.

## Gotchas

Generation does not depend on event status; closing registration first only keeps the applicant
set stable. With 新人を単独の時間枠に割り当てない left checked and only newcomers registered, the
solver leaves slots empty and the metrics show 未充足; that is a precondition gap, not a solver
failure. Only slots covered by demand get cells in 充足状況, so keep the 午前 demand. Results
depend on the シード; compare runs only at the same シード. A same-date overlap with another sheet
shows **重複を承知で割り当てる** instead of a plain assignment; that path is outside this map.
