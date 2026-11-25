# Manage an image on its detail page

On `/i/<id>` a chapter member replaces the bytes behind a stable URL, gives the image a custom
URL, adds a mobile-only variant, or deletes it.

## Sub-features

- `img-replace`: "Replace" swaps the original; the public URL stays the same and the ETag
  changes.
- `img-custom-slug`: "Custom URL" save, server validation, duplicate rejection, and "Clear".
- `img-mobile-variant`: "Upload mobile image", device-based serving, "Remove mobile image".
- `img-delete`: "Delete" with confirmation; the public URL and the detail page return 404.

## How to get to it (user POV)

Open a tile on `/`, or `/i/<id>`. Cards from top: the file card (filename heading,
`<type> · <size> KB`, "Copy URL", "Delete", preview, "Replace"), "Mobile image", "Custom URL"
(prefix text `img.gdgs.jp/`, textbox "Custom slug", "Save", "Clear" when set), "Optimization
URL builder", "Folder", "Chapter", "Public URL" (textbox "Public URL", and "Id URL" when a slug
is set). Errors show as an alert inside the card that failed.

## Driving it with Orca Browser

Preconditions: `red.png` uploaded as `member` ([upload.md](upload.md)); its id is `<id>`.
`member` profile on `/i/<id>`. Start `orca capture start`. Keep HTTP output in the evidence
directory.

`img-replace`:

1. Record `curl -sI 'http://localhost:6175/<id>?f=original'` (save as `replace-before.txt`).
2. `orca upload --element <ref of "Replace"> --files <evidence>/img-fixtures/blue.png`. Require
   `POST /api/replace/<id>` with 200 and no alert. Require the preview `img` `src` to change
   its `v=` suffix.
3. `reload`. Require the card heading `blue.png` and the textbox "Public URL" still
   `http://localhost:6175/<id>`.
4. Independent check: `curl -s 'http://localhost:6175/<id>?f=original' | shasum -a 256` equals
   the `blue.png` hash. `curl -sI` again (`replace-after.txt`); the `ETag` differs from
   `replace-before.txt`.

`img-custom-slug`:

1. Fill "Custom slug" with `signin`, click "Save". Require the alert "That custom URL isn't
   allowed. Use 1–64 letters, numbers, hyphens or underscores, and avoid reserved words."
   Repeat with `abcdefgh` (eight letters and digits look like an image id) and with
   `two words`; each gives the same alert.
2. Fill `verify-logo`, click "Save". Require the textbox "Public URL" value
   `http://localhost:6175/verify-logo`, the textbox "Id URL" value `http://localhost:6175/<id>`,
   and the button "Clear".
3. Independent check: `curl -sI 'http://localhost:6175/verify-logo?f=original'` returns 200
   with `Link: <http://localhost:6175/<id>>; rel="canonical"`; the body hash equals `blue.png`.
4. Duplicate: upload `tiny.png` from `/` (it opens `/i/<id2>`), fill "Custom slug"
   `verify-logo`, "Save". Require "That custom URL is already in use.". Keep `<id2>` for
   `img-delete`.
5. Back on `/i/<id>`, click "Clear", then in the dialog "Remove the custom URL?" click
   "Remove custom URL". Require "Public URL" back to `http://localhost:6175/<id>` and no "Id URL".
   `curl -s -o /dev/null -w '%{http_code}' http://localhost:6175/verify-logo` returns `404`.

`img-mobile-variant`:

1. On `/i/<id>` require "Optional. Until uploaded, every device receives the default image.".
2. `orca upload --element <ref of "Upload mobile image"> --files
   <evidence>/img-fixtures/green-tall.png`. Require the text starting `green-tall.png ·` and
   ending "Mobile devices now receive this image.", the image "Mobile preview of
   green-tall.png", and the button "Replace mobile image".
3. Independent check over HTTP (anonymous):
   - `curl -s -H 'Sec-CH-UA-Mobile: ?1' 'http://localhost:6175/<id>?f=original' | shasum -a 256`
     equals `green-tall.png`.
   - The same with `Sec-CH-UA-Mobile: ?0` equals `blue.png`.
   - `curl -s 'http://localhost:6175/<id>?variant=mobile&f=original'` equals `green-tall.png`.
   - `curl -sI 'http://localhost:6175/<id>?f=original'` has `Vary` containing
     `Sec-CH-UA-Mobile, CF-Device-Type, User-Agent`.
4. Optional browser check: in an anonymous profile tab, `orca set device --name "iPhone 15"`,
   `goto` `http://localhost:6175/<id>?f=original`, and screenshot it; it shows the green tall
   image. Re-run `set device` after every navigation.
5. Click "Remove mobile image", then the dialog's "Remove mobile image". Require the
   "Optional. Until uploaded…" text again; the mobile `curl` now returns the `blue.png` hash.

`img-delete` (on `<id2>`, the `tiny.png` image):

1. `goto` `/i/<id2>`. Click "Delete"; in "Delete this image?" ("This cannot be undone.") click
   "Cancel"; the page stays. Click "Delete" again and confirm "Delete".
2. Require the URL `/` and no tile for `<id2>`.
3. Independent check: `curl -s -o /dev/null -w '%{http_code}' http://localhost:6175/<id2>`
   returns `404`; `goto` `/i/<id2>` shows a 404 error screen.

Evidence: the before and after header files, every hash comparison, the slug alerts, the
mobile card snapshots, the optional device screenshot, and the delete network rows.

## Gotchas

- The file card's heading keeps the old filename until a reload; the replace action does not
  re-run the loader.
- Slug and folder changes do not bump `updated_at`, so they leave the ETag unchanged; a mobile
  upload does bump it (documented over-invalidation).
- "Custom URL" shows the production prefix `img.gdgs.jp/` even locally; the "Public URL"
  field is the source of truth.
- Two buttons are named "Remove mobile image"; pick the one inside the alert dialog for the
  confirmation.
- Desktop Orca sends `Sec-CH-UA-Mobile: ?0`, so the detail page's own previews always show the
  default image.
