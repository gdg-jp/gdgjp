# Staff registration via share link

The organizer opens registration and shares the スタッフ登録URL. Anyone can read the overview;
any signed-in account, from any chapter, can register, update, or withdraw. The organizer can
also register someone by email, and that person's first sign-in claims the entry.

## Sub-features

- `roster-staff-apply`: ステータス 募集中 enables `/apply/:token`; anonymous visitors see the
  overview and **サインインして登録する**; a signed-in visitor submits **登録する** and returns to
  **登録内容を更新**; any other status shows 募集は終了しました。
- `roster-staff-proxy`: **メールアドレスで代理登録** on `/e/:id/staff`; the matching account
  (email compared case-insensitively) sees its prefilled entry on the apply page.
- The 登録スタッフ table and correction drawer (**保存**, **辞退にする**) on `/e/:id/staff`.

## How to get to it (user POV)

Organizer: `/e/:id` then **スタッフを管理**, or the sidebar **スタッフ**. Copy the URL from the
スタッフ登録URL card or click **登録画面を開く**. Staff: open the shared link.

## Driving it with Orca Browser

Preconditions: an event from [event-design.md](event-design.md) with 受付 checked in 使う役割
and at least one demand cell. The apply path is the `code` text in the スタッフ登録URL card,
`/apply/<token>`; record it.

- Open registration. As `owner`, `goto /e/<id>/staff`. Require 受付停止中 and
  ステータスを「募集中」にすると登録できます。 ステータス is a native select: use `orca select --value 募集中`, click
  **ステータスを更新**, reload, require 募集中 on the card.
- Anonymous overview. In a fresh profile with no cookies, `goto <apply path>`. Require heading
  **スタッフ登録**, `Verify Roster Event · 2030-06-01 09:00–19:00`, 募集中の役割 with 受付, link
  **サインインして登録する**, and no 表示名 field. HTTP `GET <apply path>` without cookies and
  require 200.
- Self-registration. `goto /dev/login?as=verify-roster-staff&chapter=2:other-chapter&return_to=<apply path>`.
  Require 表示名 prefilled with `verify-roster-staff (dev)`. In 担当できる役割 check 受付; in
  参加できない時間 click **すべて解除**, then mark × for the `10:00–11:00` row. Click **登録する**.
  Require **登録内容を更新**; reload and require it again with 受付 still checked.
- Organizer sees it. As `owner`, `goto /e/<id>/staff`. Require a 登録スタッフ row
  `verify-roster-staff (dev)` and the 時間帯別の需給 section. Click the row; require the drawer
  heading `verify-roster-staff (dev) の補正` and buttons **保存** and **辞退にする**. Close without saving.
- Proxy add. Click **メールアドレスで代理登録**. Fill メールアドレス `Verify-Roster-Staff2@Dev.Local`,
  表示名 `Proxy Staff2`, check 受付, click **すべて解除**, then the dialog's **登録する**. Require the
  dialog to close and a `Proxy Staff2` row. Then
  `goto /dev/login?as=verify-roster-staff2&chapter=2:other-chapter&return_to=<apply path>` and
  require 表示名 `Proxy Staff2` and **登録内容を更新**.
- Closed. As `owner`, set ステータス to 締切 and click **ステータスを更新**. As anyone,
  `goto <apply path>` and require 募集は終了しました。 with no form.
- Unknown token. HTTP `GET /apply/not-a-token` and require 404.

Independent check: mint an owner cookie with `curl -c` against `/dev/login`, `GET /e/<id>/staff`,
and require both `verify-roster-staff (dev)` and `Proxy Staff2` in the body.
Evidence: screenshots of the anonymous overview, the submitted form, the staff table, and the
closed message.

## Gotchas

Registration is open only while ステータス is 募集中 (`open`); 下書き, 締切, 公開, and 終了 all
close it. The staff identities use chapter 2 on purpose: registering needs a sign-in, not
membership, and a chapter 2 account must still get 403 on `/e/<id>/staff`. A withdrawn applicant
sees この登録は辞退済みです。 on the apply page. With a second sheet (懇親会 from the design
recipe) the form shows one availability group per sheet, labelled `<sheet name> — <date>`, each
with its own **すべて解除**; act inside the 本編 group, where `10:00–11:00` lives. Marking a slot ×
means "参加できない" (`× 参加できない` checkbox); leaving it means available. The 懇親会 select never renders because no screen
sets the event's `has_party` flag. Re-open registration (募集中) before generating if a later
journey adds applicants; generation itself does not require any status.
