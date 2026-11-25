# Visibility, sharing, and chapter co-ownership

A link is private to its owner by default. The owner can make it visible to every signed-in
member, share it by email or chapter as viewer or editor, or create it on a chapter-owned domain
so the whole chapter co-owns it. Everyone else gets 403 on its detail and analytics pages.
Super admins bypass these checks.

## Sub-features

- `tinyurl-link-forbidden` a member of another chapter gets 403 on a private link's detail,
  analytics, and actions; malformed and unknown ids answer 404; an admin can open it.
- `tinyurl-link-sharing` **Anyone in GDG Japan can view**: any member sees the link under
  **Shared with me** and gets a read-only detail page.
- `tinyurl-link-sharing` email share as **Viewer**, role change to **Editor**, and **Remove**.
- `tinyurl-link-sharing` shares added in the **Create new link** dialog.
- `tinyurl-link-sharing` email share before the recipient's first sign-in.
- `tinyurl-link-sharing` chapter co-ownership through a chapter-owned domain.

## How to get to it (user POV)

On a link's detail page, use **Visibility** and the **Sharing** section (principal type
**Email** or **Chapter**, **Email address**, role **Viewer** or **Editor**, **Share**). In the
**Create new link** dialog, the same **Sharing** controls stage shares before saving. Recipients
find the link on `/links` under **Filter**, **Shared with me**.

## Driving it with Orca Browser

Preconditions: seed applied (`verify-seed-private`, id `link_01KSEED00000000000000000PV`, owned
by `outsider`); cookie jars minted for `owner`, `peer`, `outsider`, and `admin`.

- **Forbidden.** HTTP with the owner jar: `curl -s -o /dev/null -w '%{http_code}\n' -b
  "$EVIDENCE/owner.jar" http://localhost:6169/links/link_01KSEED00000000000000000PV` prints `403`;
  `/analytics?linkId=link_01KSEED00000000000000000PV` prints `403`;
  `curl -s -o /dev/null -w '%{http_code}\n' -b "$EVIDENCE/owner.jar" -X POST -d intent=delete
  http://localhost:6169/links/link_01KSEED00000000000000000PV` prints `403` and D1
  `SELECT deleted_at FROM links WHERE id = 'link_01KSEED00000000000000000PV'` stays null.
  `/links/not-a-link` and `/links/link_01KSEED00000000000000000ZZ` print `404`. In Orca as
  `owner`, `goto` the seeded detail URL and require that `Seeded private link` does not appear.
- **Admin bypass.** In Orca as `admin`, `goto /links/link_01KSEED00000000000000000PV`. Require
  **Title** `Seeded private link`, **Created by** `outsider@dev.local`, and enabled inputs.
  Do not save.
- **Public visibility.** As `owner`, create `verify-public` (title `Public link`, destination
  `https://1.1.1.1/verify-public`, domain `localhost:6169/`) and on its detail page set
  **Visibility** to **Anyone in GDG Japan can view**, then **Save changes**. D1: `SELECT
  visibility FROM links WHERE slug = 'verify-public'` returns `public`. As `outsider`, `goto
  /links`, choose **Filter**, **Shared with me**, and require the card
  `localhost:6169/verify-public`. Open it: inputs are disabled, there is no **Edit short link**
  button, no **Share** form, and **Link actions** lists no **Archive link…** or **Delete link…**.
  HTTP: `curl -s -b "$EVIDENCE/outsider.jar" -X POST -d intent=update -d title=Changed
  http://localhost:6169/links/<verify-public id>` must not change D1 `title` (still `Public link`);
  the rendered response contains `You don&#x27;t have permission to edit this link.` or the
  unescaped text.
- **Email share.** As `owner`, create `verify-shared` (title `Shared link`, destination
  `https://1.1.1.1/verify-shared`, domain `localhost:6169/`). On its detail page, in **Sharing**,
  change the principal type select to **Email**, fill **Email address** with `peer@dev.local`,
  keep **Viewer**, and choose **Share**. Require a row `peer@dev.local` / **Email** with a role
  select and **Save**. D1: `SELECT principal_type, principal_id, role FROM link_permissions WHERE
  link_id = '<id>'` returns `user`, `peer@dev.local`, `viewer`. Share the same email again and
  require `That principal already has access to this link.`
- **Viewer and editor.** As `peer`, **Shared with me** lists `verify-shared`; its detail page is
  read-only with the badge `viewer`. As `owner`, set that row's role select to **Editor** and choose
  **Save**; D1 role becomes `editor`. As `peer`, reload: inputs are enabled; change **Title** to
  `Shared link (peer edit)` and **Save changes**; D1 `title` matches. As `owner`, choose **Remove**
  on the row; D1 returns no permission rows; as `peer`, the detail URL answers 403.
- **Shares in the create dialog.** As `owner`, in **Create link** fill title `Dialog share`,
  destination `https://1.1.1.1/verify-dialog-share`, slug `verify-dialog-share`, domain
  `localhost:6169/`; in **Sharing** choose **Email**, fill `outsider@dev.local`, choose **Editor**,
  and **Share**. Require the staged row `outsider@dev.local` / **Editor** and **Remove**, then
  **Create link**. D1 has the `editor` row for `outsider@dev.local`.
- **Before first sign-in.** As `owner`, share `verify-shared` with `latecomer@dev.local` as
  **Viewer**. Then sign in with
  `http://localhost:6169/dev/login?as=latecomer&chapter=303:gdg-verify-sapporo:member&return_to=/links`
  and require `verify-shared` under **Shared with me**.
- **Chapter co-ownership.** As `owner`, create `verify-gw-link` (title `Gateway link`, destination
  `https://1.1.1.1/verify-gw-link`, **Short link domain** `verify-gw.example/`). D1: `SELECT
  owner_chapter_id FROM links WHERE slug = 'verify-gw-link'` returns `101`. As `peer` (no share),
  the link is on `/links` under **Filter**, **Owned by me** (chapter links count as the member's
  own), its detail page is editable, and a title change to `Gateway link (peer)` saves; restore
  the title `Gateway link` afterwards. As `outsider`, its detail URL answers 403.

Evidence: HTTP status lines, D1 rows after each change, screenshots of the outsider read-only
detail page and the peer editable page.

## Gotchas

Never run a permission step as `admin`; `admin=1` bypasses every check.
Permissions for email principals match the signed-in email (`<as>@dev.local`), not the user id.
Chapter co-ownership compares only the user's primary chapter (the first `chapter` value).
Removing a share takes effect on the recipient's next request; there is no session cache.
Public redirects ignore all of this: `verify-seed-private` still answers 302 to anyone.
