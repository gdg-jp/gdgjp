# Upload from the library

A chapter member uploads an image from `/`, lands on its detail page, and sees it in the
library grid. The image belongs to the member's primary chapter.

## Sub-features

- `img-upload`: the empty library, "Choose image", the busy states, the redirect to
  `/i/<id>`, the detail header, the public URL, and the new gallery tile.
- `img-upload-errors`: a non-image file is refused in the browser; a file over 10 MiB is
  refused by the server with 413.

## How to get to it (user POV)

Sign in and open `http://localhost:6175/`. The header reads "GDG Japan Image"; the page heading
is "Chapter image library". Below the folder chips (All, Unfiled, "New folder") is the drop
zone "Drop an image here" / "or choose one from your device" with the button "Choose image".
During upload it reads "Uploading your image…", then "Opening image…", and the button
"Please wait…". Errors appear under the zone as an alert.

## Driving it with Orca Browser

Preconditions: fresh stack, test images created ([README.md](README.md#test-images)), the
`member` profile signed in through `ready.json`
(`applications.img.fixtureLogins.member.url`). Start `orca capture start`.

`img-upload`:

1. `goto` `/`. Require heading "Chapter image library" and "No images here yet.". Screenshot
   `img-empty.png`.
2. Snapshot interactive; `orca upload --element <ref of "Choose image"> --files
   <evidence>/img-fixtures/red.png`. Wait for the URL to contain `/i/`. Record the 8-character
   id from the URL.
3. Require heading "Image details", a card heading `red.png`, the text
   `image/png · ` followed by the size in KB (about `800`), the buttons "Copy URL", "Delete",
   "Replace", and the textbox "Public URL" with value `http://localhost:6175/<id>`. Require the
   preview `img` named `red.png` to have loaded (`eval` its `naturalWidth` is greater than 0).
4. In `orca network`, require `POST /api/upload` with status 200 and a JSON body
   `{"id":"<id>","url":…}`.
5. Click "Back to library". Require a tile link to `/i/<id>` whose image alt is `red.png` and
   whose caption is the id; "No images here yet." is gone. Screenshot `img-gallery.png`.
6. Independent check: anonymous `curl -s 'http://localhost:6175/<id>?f=original' -o
   red.download.png` and compare `shasum -a 256` with `red.png` in `sha256.txt`. Reload `/` and
   require the tile again.

`img-upload-errors`:

1. On `/`, upload `<evidence>/img-fixtures/notes.txt` to "Choose image". Require the alert
   "Please choose an image file." and no `POST /api/upload` in `orca network`.
2. Upload `huge.png`. Require `POST /api/upload` answered `413` and the alert text
   `file too large`. The URL stays `/`.
3. Independent check: reload `/`; the grid still holds only the `red.png` tile.

Evidence: the empty and gallery screenshots, the detail snapshot, the upload network rows,
the downloaded file hash, and both error snapshots.

## Gotchas

- The file input is visually hidden; give `orca upload` the "Choose image" button ref and let
  Orca catch the picker.
- The client checks only the browser-reported type. Orca derives it from the extension, so a
  `.txt` file triggers the client message without a request.
- Thumbnails request `?w=400&fit=cover`; locally `fit` is ignored and CSS `object-cover` does
  the cropping, so square tiles do not prove the server crop.
- `red.png` is reused by every other img recipe. Keep its id in the run notes.
