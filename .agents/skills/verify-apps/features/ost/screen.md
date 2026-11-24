# Projector screen

Organizers group similar topics by dragging cards together on `/<slug>/screen`.

## Sub-features

- `ost-screen-merge`: drag one card onto another; tap the stack to spread it; ungroup.
- `ost-screen-delete`: **このテーマを削除** on a card, **すべてクリア** for all topics.

## How to get to it (user POV)

Dashboard → **スクリーン**, or `/verify-ost/screen` as the owner, with two topics submitted.

## Driving it with Orca Browser

- Positions: `eval` the centers of the `li` elements whose text contains each topic.
- Merge: `orca tab switch --page <owner page>` (mouse commands act on the current tab), then
  `mouse move` to the first card, `mouse down`, several `mouse move` steps to the second card,
  `mouse up`. Snapshot: a button `2 Verify topic alpha まとめて 1 票 ・ タップで展開`. Reload;
  it is still there.
- Ungroup: click the stack; two **このテーマをグループから外す** buttons appear. Click one,
  press Escape, reload; two separate cards remain.
- Delete: click **このテーマを削除** on a card and confirm; the card disappears on the screen and
  on the participant vote dialog. **すべてクリア** opens the native confirm `すべてのテーマを削除します。よろしいですか？`; answer it
  with `orca dialog accept --page <id>`, then the screen shows `0 テーマ` and `テーマを募集中…`.

## Gotchas

`ost-screen-delete` has a recipe but was not executed in the first run; it removes the
topics that `ost-auto-assign` needs, so run it last. The spread view keeps stale snapshot
lines until reload; judge ungrouping after a reload.
