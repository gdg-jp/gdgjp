# Folders

Folders are flat and owned by one chapter. Members filter the library by folder, upload into
the selected folder, move images in and out, and rename or delete folders. Deleting a folder
keeps its images as unfiled.

## Sub-features

- `img-folders`: "New folder", the duplicate-name error, the folder chip and its count, the
  All / Unfiled / folder filters, upload into the selected folder, the detail page's "Folder"
  select, "Rename", and "Delete" with "Delete folder".

## How to get to it (user POV)

On `/` the chip row holds "All", "Unfiled", one chip per folder (name followed by its image
count), and "New folder". "New folder" reveals the textbox "Folder name" (max 48 characters),
"Create", and the icon button "Cancel creating folder". Selecting a folder chip
(`/?folder=<id>`) shows a bar "<n> image(s) in <name>" with "Rename" and "Delete". On
`/i/<id>` the "Folder" card has a combobox "Folder" with "No folder" and the chapter's folders.

## Driving it with Orca Browser

Preconditions: `member` profile; `red.png` uploaded (`<id>`, not in a folder). Start
`orca capture start`.

1. On `/` click "New folder", fill "Folder name" `Verify Event`, click "Create". Require a
   chip link whose `href` is `/?folder=<fid>` and whose text starts with `Verify Event` and
   ends with `0`. Record `<fid>`.
2. Click "New folder" again, fill `Verify Event`, "Create". Require the alert "A folder with
   that name already exists." Click "Cancel creating folder".
3. Click the `Verify Event` chip. Require URL `/?folder=<fid>`, the bar "0 images in Verify
   Event", and "No images here yet.".
4. With the folder selected, upload `blue.png` through "Choose image". On the new detail page
   (`/i/<id3>`) require the combobox "Folder" showing `Verify Event`. In `orca network`, the
   `POST /api/upload` form carried `folderId=<fid>`.
5. `goto` `/i/<id>` (red). Select "Folder" → `Verify Event`. Require `POST /api/move/<id>`
   200 and the combobox now `Verify Event`.
6. `goto` `/?folder=<fid>`. Require two tiles (`<id>`, `<id3>`) and "2 images in Verify Event".
   `goto` `/?folder=unfiled`; require neither tile. `goto` `/`; require both.
7. On `/i/<id3>` select "Folder" → "No folder". Require `/?folder=unfiled` to show `<id3>`
   and the folder chip count to end with `1`.
8. On `/?folder=<fid>` click "Rename", fill "Folder name" `Verify Event 2`, click "Save".
   Require the chip and bar to read `Verify Event 2`.
9. Click "Delete". Require the dialog "Delete “Verify Event 2”?" with "Its 1 image(s) will
   become unfiled.". Click "Delete folder". Require URL `/` and no `Verify Event 2` chip.
10. Independent checks: `goto` `/?folder=unfiled`; require `<id>` and `<id3>`. Anonymous
    `curl -s -o /dev/null -w '%{http_code}' 'http://localhost:6175/<id>?f=original'` is still
    `200`. In the `peer` profile
    (`/dev/login?as=verify-img-peer&chapter=1:dev-chapter:member&return_to=/`), a folder
    created by `member` before step 9 is visible to the peer too; if you want that check, run
    it between steps 1 and 9 and require the peer's chip row to list it.

Evidence: snapshots of the chip row after steps 1, 6, 8 and 9, the move and upload network
rows, and the filter screenshots.

## Gotchas

- The chip's accessible name is the folder name and the count run together (for example
  `Verify Event0`); locate chips by `href`, not by exact name.
- The upload form sends `folderId` only while a folder chip is selected; "All" and "Unfiled"
  upload unfiled.
- Folder changes do not bump the image's `updated_at`, so its public ETag stays the same.
- Folder lists are per chapter; the detail page offers only folders of the image's chapter.
