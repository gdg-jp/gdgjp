# OBS outputs

Each slot has camera, screen and mic Browser Source pages behind the stage's output token.

## Sub-features

- **OBS** dialog with **A カメラURLをコピー**, **A 画面URLをコピー**, **A マイクURLをコピー**, **サイズをコピー**.
- Output page joins the room only with the current token.
- **URL を再発行** rotates the token and cuts off the old URL.

## How to get to it (user POV)

Control room → **OBS**. OBS loads `/out/<stage>/<slot>/<kind>?t=<token>`.

## Driving it with Orca Browser

- Copy: click **OBS**, click **A カメラURLをコピー**. The action effects show the toast
  `A カメラの URL をコピーしました`.
- Token: read `outputToken` from `GET /stages/<id>.data` with an operator session. With a
  speaker assigned to A, open `/out/<id>/A/camera?t=<token>&debug=1` in a new tab. `eval` the
  `.sc-out-debug` JSON: `socket` `open`, `peer.name` `Verify Speaker`. Open the same path with
  `t=wrong-token`; `socket` `offline` and `peer` null.
- Reissue: **URL を再発行** → **再発行**. Read the new token over HTTP; it differs. The old
  token now gives `peer` null and the new token gives the speaker.

## Gotchas

The pages are transparent and media needs the SFU, so `.sc-out-frame` opacity stays `0` and
`tracks` is empty locally. Close output tabs before deleting the stage.
