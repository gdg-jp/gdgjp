# Tags

Members keep personal tags and chapter tags, attach them to links from the link dialogs, and
manage them on the Tags page: search, create, rename or recolor, and delete.

## Sub-features

- `tinyurl-tags` empty state **No tags yet**.
- `tinyurl-tags` **Create tag** with **Tag Name**, **Tag Color**, and **Scope** (**My tags** or
  **Chapter (<slug>)**), from the button or the **C** key.
- `tinyurl-tags` duplicate name and empty-search states.
- `tinyurl-tags` **Edit** (rename) and **Delete** with the **Delete tag?** confirmation.
- `tinyurl-tags` chapter tags are visible to other members of the chapter with a **Chapter**
  badge; link counts per tag.
- `tinyurl-tag-ownership` a member of another chapter must not be able to delete or rename a tag
  they do not own.

## How to get to it (user POV)

Sidebar **Library**, **Tags** (`http://localhost:6169/tags`), or **Manage** next to **Tags** in
the **Create new link** dialog. On a link, tags are added in **Search or add tags...**.

## Driving it with Orca Browser

Preconditions: `owner` signed in. The empty-state step runs before [links.md](links.md) creates
`verify-tag`; if it already ran, skip the empty step and record why.

- **Empty.** `goto /tags`. Require heading **Tags**, **No tags yet**, and
  `Tags help you organize your links. Create one to get started.`
- **Create.** Press **C** with focus outside a text field and require the dialog **Create tag**.
  Fill **Tag Name** with `verify-chapter-tag`, choose **Scope** **Chapter (gdg-verify-tokyo)**, and
  choose **Create tag**. Require the toast `Tag "verify-chapter-tag" created` and a row with the
  **Chapter** badge and `0 links`. Create `verify-owner-tag` with **My tags** from the
  **Create tag** button.
- **Read-back.** D1: `SELECT id, name, owner_user_id, owner_chapter_id FROM tags WHERE name LIKE
  'verify-%' ORDER BY name` returns `verify-chapter-tag` with `owner_chapter_id` `101` and
  `verify-owner-tag` (and `verify-tag` once links ran) with `owner_user_id` `dev-user-owner`.
- **Duplicate.** Create `verify-owner-tag` with **My tags** again and require the toast
  `Tag "verify-owner-tag" already exists.`
- **Search.** In **Search tags**, type `chapter` and require only `verify-chapter-tag`; type
  `zzz` and require `No tags match "zzz"`.
- **Attach.** On a link detail page, open **Search or add tags...**, choose
  `verify-chapter-tag`, and **Save changes**. On `/tags` the row shows `1 link`.
- **Edit.** Open **Actions for verify-owner-tag**, choose **Edit**, require **Edit tag**, change
  **Tag Name** to `verify-owner-tag-renamed`, and choose **Save changes**. Require the toast
  `Tag "verify-owner-tag-renamed" updated` and the D1 name.
- **Chapter visibility.** As `peer`, `goto /tags` and require `verify-chapter-tag` with
  **Chapter**, and no `verify-owner-tag-renamed`. As `outsider`, neither appears.
- **Delete.** As `owner`, open **Actions for verify-chapter-tag**, choose **Delete**, require
  **Delete tag?** with `This will remove the tag from 1 link.`, and choose **Delete**. D1 has no
  row for it and `SELECT COUNT(*) AS n FROM link_tags WHERE tag_id = <its id>` returns 0.
- **Ownership.** Record the id of `verify-owner-tag-renamed`. With the outsider jar, `curl -s -o
  /dev/null -w '%{http_code}\n' -b "$EVIDENCE/outsider.jar" -X POST -d intent=delete -d id=<id>
  http://localhost:6169/tags`. Expected: the tag still exists in D1 and on the owner's `/tags`.
  Repeat with `-d intent=update -d id=<id> -d name=taken-over`; expected: the name is unchanged.
  Current source fails both (see Gotchas); report the failure with the D1 rows.

Evidence: screenshots of the empty state, the created rows, the delete dialog; D1 rows before and
after each mutation and after the ownership attempt.

## Gotchas

The `/tags` action deletes or renames any tag id it receives without checking the tag's owner or
chapter, so the ownership step fails on the current source. Run it last in this file; it destroys
its fixture.
Tags created inline from the link dialogs are always personal, even for chapter links.
**C** opens the dialog only when focus is not in an input or text area.
