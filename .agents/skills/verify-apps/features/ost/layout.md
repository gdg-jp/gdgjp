# Desk layout and assignment

Organizers place desks for the venue and assign top-voted topics to them.

## Sub-features

- `ost-layout-editor`: **机を追加**, drag **サイズ変更**, persistence after reload.
- `ost-desk-rotate`: drag **回転**; the desk rotates without moving its center.
- `ost-auto-assign`: **自動割り当て** ranks by votes then submission time; `/tables` shows the result.

## How to get to it (user POV)

Dashboard → **設定** (`/<slug>/edit`), then **割り当てを表示** (`/<slug>/tables`).

## Driving it with Orca Browser

- Add: click **机を追加** twice with network capture on; two `POST /verify-ost/edit.data` 200.
- Resize: `eval` each `[aria-label=サイズ変更]` center and its parent's width and height.
  Switch to the owner tab, drag the handle by +100, +60 in ten steps. Require the desk to grow
  by about that delta (160x100 to 260x160 in the first run) and keep the size after reload.
- Rotate: drag **回転** a few pixels; `eval` `DOMMatrix(getComputedStyle(desk).transform)`
  angle stays under 30 degrees and the desk center moves less than 5 px.
- Auto-assign: with alpha at 1 vote and beta at 0, click **自動割り当て**, open `/tables`; the
  first desk lists `Verify topic alpha`, the second `Verify topic beta`. Screenshot.

## Gotchas

Two new desks are placed on top of each other; the second is the one under the pointer. The
canvas re-fits to its bounds after a resize, so both desks' screen x and y shift together;
compare sizes, not positions. `ost-desk-rotate` was not executed in the first run.
