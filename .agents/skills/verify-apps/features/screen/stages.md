# Stages

An operator creates, renames and deletes stages. The stage ID is also the speaker invite link.

## Sub-features

- `screen-operator-gate`: anonymous `/` redirects to sign-in.
- `screen-stage-create`: create a stage with a typed ID, which is lowercased.
- `screen-stage-id-rules`: a taken ID shows an error; a served path such as `stages` disables **作成**.
- `screen-stage-rename-delete`: rename persists for operator and speaker; delete ends the stage for everyone.

## How to get to it (user POV)

Sign in, open `/`, press **ステージを作成**. The row **メニュー** and the control room **メニュー**
hold **名前を変更** and **削除**.

## Driving it with Orca Browser

- Gate: start network capture in a fresh profile and `goto http://localhost:6188/`. Require
  `/` 302 to `/signin?return_to=%2F` then `/api/auth/signin`. Without Accounts that request
  answers the 503 page **サインインサービスに接続できませんでした**; record it, it is not a product failure of the gate.
- Create: open the operator fixture login URL. Click **ステージを作成**, fill **名前**
  `Verify Stage`, focus **ID**, clear it, `type` `VERIFY-STAGE`. Require the field to read
  `verify-stage`. Click **作成**, `wait --url /stages/verify-stage`, snapshot: **ON AIR**,
  `出力枠 A`, `出力枠 B`. Screenshot.
- ID rules: create `verify-dup`, go back to `/`, open the dialog again with the same ID and
  click **作成**. Require `この ID はすでに使われています`. Fill **ID** `stages` and require
  **作成** disabled.
- Rename and delete: with a speaker joined (see [speaker](speaker.md)), **メニュー** →
  **名前を変更**, fill **名前**, **保存**. Reload operator and speaker; both show the new name.
  **メニュー** → **削除** → **削除**. Require the operator URL `/` and the speaker page text
  `このステージは削除されました`. Independent check: `GET /stages/verify-stage.data` with the
  operator session returns 404.

## Gotchas

The list and control room render on the client; HTTP bodies hold loader data, not text.
Read loader data with `GET /stages/<id>.data` and an operator cookie from a `curl` fixture
login when you need the output token. Clipboard reads through `eval` time out in Orca, so
the copy toast is the observable result of a copy.
