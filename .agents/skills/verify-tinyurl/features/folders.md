# Folders

Members collect links in nested folders, rename and delete them, and share a folder with people
or chapters. Links and child folders created inside a shared folder start with its permissions.

## Sub-features

- `tinyurl-folders` empty state **No folders yet** and an empty folder page.
- `tinyurl-folders` **Create folder** at the root and inside a folder, duplicate-name error.
- `tinyurl-folders` **Rename** from the list and from the folder page.
- `tinyurl-folders` **Create link** inside a folder; the folder's link count and the link's
  **Folder** select.
- `tinyurl-folders` **Delete…** moves links and child folders out instead of deleting them.
- `tinyurl-folder-sharing` **Share** a folder by email as **Editor**; the recipient sees it, can
  create links in it, and new links inherit the share; other members get 404.

## How to get to it (user POV)

Sidebar **Library**, **Folders** (`http://localhost:6169/folders`). A folder card opens
`/folders/<id>`, whose header has **Create link**, **Create folder**, and
**Actions for <name>** (**Share**, **Rename**, **Delete…**). On a link detail page, the
**Folder** select moves a link between folders or to **No folder**.

## Driving it with Orca Browser

Preconditions: `owner` signed in; cookie jars for `peer` and `outsider`.

- **Empty.** `goto /folders`. Require heading **Folders**, `Organize links and share folders with
  people or chapters.`, **No folders yet**, and **Create folder**.
- **Create.** Choose **Create folder**; the dialog **Create folder** has **Name**. Fill
  `Verify folder` and choose **Create folder**. Require the toast **Folder created.** and a card
  `Verify folder` / `0 links`. Repeat with `Verify folder` and require the toast
  `Folder "Verify folder" already exists.` D1: `SELECT id, name, owner_user_id, parent_folder_id
  FROM folders` returns one row `Verify folder`, `dev-user-owner`, `null`. Record the id.
- **Rename from the list.** Open **Actions for Verify folder**, choose **Rename**, require
  **Rename folder**, set **Name** to `Verify folder A`, choose **Rename**, and require the toast
  **Folder renamed.** and the new card name.
- **Empty folder page.** Open the card. Require the heading `Verify folder A`,
  **This folder is empty**, and `Create a link or folder to start organizing this space.`
- **Child folder.** Choose **Create folder** in the folder header; require
  `New folders inherit this folder’s sharing settings.`; create `Verify child`. Require a
  **Folders** section with `Verify child` and `0 folders · 0 links`. D1: its `parent_folder_id`
  is the parent id. `/folders` lists only `Verify folder A` at the root.
- **Link in folder.** Choose **Create link** in the folder header and create `verify-in-folder`
  (title `Folder link`, destination `https://1.1.1.1/verify-in-folder`, domain `localhost:6169/`).
  On its detail page the **Folder** select shows `Verify folder A`. Back on the folder page, the
  **Links** section lists it; `/folders` shows `1 link`. D1: `SELECT folder_id FROM links WHERE
  slug = 'verify-in-folder'` is the folder id.
- **Move out.** On that link's detail page set **Folder** to **No folder** and **Save changes**;
  D1 `folder_id` becomes null. Set it back to `Verify folder A` and save.
- **Share.** On the folder page open **Actions for Verify folder A**, **Share**. Require
  `Share “Verify folder A”` and `New links and folders created here start with these permissions.`
  Choose **Email**, fill **Email address** `peer@dev.local`, choose **Editor**, and **Share**.
  D1: `SELECT principal_type, principal_id, role FROM folder_permissions WHERE folder_id = <id>`
  returns `user`, `peer@dev.local`, `editor`.
- **Recipient.** As `peer`, `goto /folders` and require `Verify folder A`. Open it and create
  `verify-peer-in-folder` (title `Peer folder link`, destination
  `https://1.1.1.1/verify-peer-in-folder`, domain `localhost:6169/`). D1: `SELECT owner_user_id,
  folder_id FROM links WHERE slug = 'verify-peer-in-folder'` returns `dev-user-owner` and the
  folder id; `SELECT principal_id, role FROM link_permissions lp JOIN links l ON l.id = lp.link_id
  WHERE l.slug = 'verify-peer-in-folder'` includes `peer@dev.local`, `editor`.
- **Other members.** With the outsider jar, `curl -s -o /dev/null -w '%{http_code}\n' -b
  "$EVIDENCE/outsider.jar" http://localhost:6169/folders/<id>` prints `404`, and the outsider's
  `/folders` shows **No folders yet**.
- **Delete.** As `owner`, on the folder page choose **Delete…**, require **Delete folder?** and
  `Links and child folders in “Verify folder A” will be moved out of this folder. They will not
  be deleted.`, and choose **Delete folder**. Require `/folders`. D1: no row for the folder;
  `SELECT folder_id, deleted_at FROM links WHERE slug IN ('verify-in-folder','verify-peer-in-folder')`
  returns null `folder_id` and null `deleted_at`; `Verify child` has `parent_folder_id` null and
  now appears at the root.

Evidence: screenshots of the empty list, the folder page with child folder and link, the share
dialog with the permission row, and the delete dialog; the D1 rows above.

## Gotchas

A link created in someone else's folder is owned by the folder's owner, not the creator; the
creator keeps access through the inherited permission.
Unauthorized folder ids answer 404, not 403.
The root list shows a child folder only when its parent is not accessible to the viewer.
