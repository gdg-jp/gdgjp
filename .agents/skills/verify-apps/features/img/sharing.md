# Chapter sharing and super admin

Every image belongs to one chapter. Its uploader, every member of that chapter, and super
admins can view and change it. A member of two chapters can re-share an image to the other
chapter, which removes it from its folder.

## Sub-features

- `img-chapter-sharing`: a same-chapter peer sees and opens the member's image; an outsider
  does not; a two-chapter user sees chapter badges and moves an image to `other-chapter`; the
  folder is cleared; access follows the new chapter while the uploader keeps access.
- `img-super-admin`: an `admin=1` user outside the chapter opens the detail page by URL.

## How to get to it (user POV)

On `/` a user with two or more chapters sees a chapter badge on every tile. On `/i/<id>` the
"Chapter" card reads "Members of dev-chapter can view, replace, and delete this image." for a
one-chapter user. A two-chapter user instead gets "Members of the selected chapter can view,
replace, and delete this image." and the combobox "Chapter". Changing it while the image is in
a folder opens "Share with a different chapter?" / "This will remove the image from its
folder." with "Cancel" and "Change chapter".

## Driving it with Orca Browser

Preconditions: `member` uploaded `red.png` (`<id>`) and `blue.png` (`<id3>`)
([upload.md](upload.md), [folders.md](folders.md)). As `member`, create folder `Share Test` on
`/` and move `<id3>` into it with the "Folder" combobox. Open one isolated profile each for
`peer`, `outsider`, `multi`, and `admin` with the fixture logins from
[README.md](README.md#identities), each with `return_to=/`.

`img-chapter-sharing`:

1. `peer`: on `/` require tiles for `<id>` and `<id3>` and the `Share Test` chip. Open
   `/i/<id3>`; require "Image details", "Members of dev-chapter can view, replace, and delete
   this image.", and the combobox "Folder" showing `Share Test`.
2. `outsider`: on `/` require "No images here yet." and no `Share Test` chip. `goto`
   `/i/<id3>`; require an error screen, and `curl -s -b outsider.jar -o /dev/null -w
   '%{http_code}' http://localhost:6175/i/<id3>` returns `403`.
3. `multi`: on `/` require both tiles with the badge `dev-chapter`. Open `/i/<id3>`. Require
   the combobox "Chapter" showing `dev-chapter`. Choose `other-chapter`. In the dialog click
   "Cancel"; require the combobox still `dev-chapter`. Choose `other-chapter` again and click
   "Change chapter". Require `POST /api/share/<id3>` 200, the combobox "Chapter"
   `other-chapter`, and "Folder" `No folder`.
4. Independent checks:
   - `outsider`: reload `/`; require the `<id3>` tile. `/i/<id3>` now shows "Image details".
   - `peer`: reload `/`; `<id3>` is gone. `curl` with `peer.jar` on `/i/<id3>` returns `403`.
   - `member` (the uploader): `/` still lists `<id3>` and `/i/<id3>` opens; the owner keeps
     access by design.
   - `member`: the `Share Test` chip count ends with `0`.
   - Anonymous `curl 'http://localhost:6175/<id3>?f=original'` still returns the `blue.png`
     hash; sharing never changes the public URL.

`img-super-admin`:

1. `admin` (chapter `other-chapter`, `admin=1`): `goto` `/i/<id>` (still in `dev-chapter`).
   Require "Image details" and the card heading `blue.png`.
2. Independent check: `goto` `/`; `<id>` is not listed (the library lists only own and
   chapter images). A non-admin login with the same chapter (`outsider`) gets `403` on
   `/i/<id>`.

Evidence: tile snapshots for each identity before and after the share, the dialog snapshot,
the share network row, and every curl status line.

## Gotchas

- Dev sessions carry their chapters in the cookie; log in again after changing the label's
  chapters, never edit claims.
- The share combobox lists only the user's own chapters; sharing to a chapter you do not
  belong to needs a super admin and has no UI path.
- `<id3>` stays in `other-chapter` after this recipe; later recipes that need it in
  `dev-chapter` must share it back as `multi`.
