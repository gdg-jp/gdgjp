# Short links

A member creates a short link with a destination, slug, domain, tags, comment, visibility, and
preview metadata, edits it on its detail page, archives, restores, or deletes it, and reads its
QR code. Validation errors appear in the dialog or on the detail page without saving.

## Sub-features

- `tinyurl-links-empty` an `owner` with no links sees **No links yet** and **Create a link**.
- `tinyurl-link-create` the **Create new link** dialog saves a link and opens its detail page.
- `tinyurl-link-validation` reserved slug, taken slug, private destination, and private image
  URL are refused with a visible error and no row.
- `tinyurl-link-edit` destination, title, description, comment, tags, visibility, and (after the
  **Edit short link?** confirmation) slug and domain are saved from the floating bar.
- `tinyurl-link-archive-delete` **Archive…**, **Restore…**, and **Delete…** with typed
  confirmation, from the list and from the detail page.
- `tinyurl-qr` the create dialog and the detail page render a QR code for the short URL.
- `tinyurl-link-preview` offline preview behavior: **Fetch** failure on the detail page,
  non-image rejection, and the image-upload unavailable message.

## How to get to it (user POV)

- Links page `http://localhost:6169/links`: **Create link** in the header, or **Create a link** in
  the empty state.
- Folder page `/folders/<id>`: **Create link** (saves into that folder; see [folders.md](folders.md)).
- Campaign channel card: **Create link** (see [campaigns.md](campaigns.md)).
- Detail page `/links/<id>`: click a link card (**View details for localhost:6169/<slug>**) or the
  card's **Link actions** menu, **Edit**.

## Driving it with Orca Browser

Preconditions: seed applied; `owner` signed in through its README URL; `owner` has created
nothing yet (run `tinyurl-links-empty` first).

- **Empty state.** `goto http://localhost:6169/links`. Require heading **Links**, **No links yet**,
  **Create your first short link to get started.**, and button **Create a link**. The seeded
  private link of `outsider` must not appear.
- **Create.** Choose **Create link**. Require dialog title **Create new link**. Fill **Title**
  with `Verify first link` first, then **Destination URL** with `https://1.1.1.1/verify-first`
  (filling the title first suppresses the automatic preview fetch). Open the
  **Short link domain** select and choose `localhost:6169/`. Fill **Short Link** with
  `verify-first`. In **Tags**, open **Search or add tags...**, type `verify-tag`, and choose
  **Create "verify-tag"**. Fill **Comment** with `First comment`. Leave **Visibility** at
  **Private — only you and people you share with** and **Sharing** at **Not shared with anyone.**
  Choose **Create link**. Require navigation to `/links/link_<26 chars>`, the breadcrumb
  `localhost:6169/verify-first`, the QR text `https://localhost:6169/verify-first`, **Created by**
  `owner@dev.local`, and the button **0 clicks**. Record the link id from the URL.
- **Create read-back.** D1: `SELECT l.slug, d.hostname, l.destination_url, l.title, l.visibility,
  l.owner_user_id, l.owner_chapter_id FROM links l JOIN domains d ON d.id = l.domain_id WHERE
  l.slug = 'verify-first'` returns one row `verify-first`, `localhost:6169`,
  `https://1.1.1.1/verify-first`, `Verify first link`, `private`, `dev-user-owner`, `null`.
  `SELECT t.name FROM link_tags lt JOIN tags t ON t.id = lt.tag_id JOIN links l ON l.id = lt.link_id
  WHERE l.slug = 'verify-first'` returns `verify-tag`; `SELECT body FROM comments c JOIN links l ON
  l.id = c.link_id WHERE l.slug = 'verify-first'` returns `First comment`. HTTP: the redirect probe
  in [redirects.md](redirects.md) returns 302 to the destination.
- **Generated slug.** Create a second link with **Title** `Verify random`, **Destination URL**
  `https://1.1.1.1/verify-random`, domain `localhost:6169/`, and an empty **Short Link**. Require a
  detail page whose breadcrumb slug is 8 characters of `[A-Za-z0-9]`. Choosing the
  **Generate random slug** button in the dialog instead fills a 7-character slug before saving.
- **Validation.** In a new **Create new link** dialog with domain `localhost:6169/` and **Title**
  filled, submit each case and require the **Error** alert text and a toast with the same text:
  slug `links` → `"links" is a reserved slug.`; slug `verify-first` →
  `The slug "verify-first" is already taken.`; destination `http://localhost/x` with slug
  `verify-private-dest` → `Destination URL must not resolve to a private or loopback address.`;
  destination `https://1.1.1.1/x`, slug `verify-private-img`, **Image URL** `http://127.0.0.1/a.png`
  → `OG image URL must not resolve to a private or loopback address.` Read-back: `SELECT slug FROM
  links WHERE slug IN ('links','verify-private-dest','verify-private-img')` returns no rows and
  `SELECT COUNT(*) AS n FROM links WHERE slug = 'verify-first'` returns 1.
- **Edit.** `goto /links/<verify-first id>`. Change **Destination URL** to
  `https://1.1.1.1/verify-first-edited`, **Description** to `Edited description`, and **Comment**
  to `Second comment`. Require the floating bar **Unsaved changes** with **Discard** and
  **Save changes**. Choose **Discard** and require the original values; make the same changes
  again and choose **Save changes**. Require the toast **Successfully updated short link!** and,
  after reload, the new values. Then choose **Edit short link** (pencil next to **Short Link**),
  require the alert **Edit short link?**, choose **Continue**, change the slug to
  `verify-first-renamed`, and save. Require the breadcrumb `localhost:6169/verify-first-renamed`.
- **Edit read-back.** D1: `SELECT slug, destination_url, description FROM links WHERE id =
  '<id>'` returns `verify-first-renamed`, `https://1.1.1.1/verify-first-edited`,
  `Edited description`; `SELECT body FROM comments WHERE link_id = '<id>'` returns exactly one
  row `Second comment` (the author's comment is replaced, not appended). HTTP:
  `/verify-first-renamed` answers 302 to the edited destination and `/verify-first` answers 404.
- **Edit validation.** On the same page set **Destination URL** to `http://localhost/x` and save.
  Require the **Error** alert `Destination URL must not resolve to a private or loopback address.`
  and an unchanged `destination_url` in D1.
- **QR.** Open **Create link** and fill **Short Link** with `verify-qr` and domain
  `localhost:6169/`. Require the **QR Code** section with an SVG and the text
  `localhost:6169/verify-qr` under it; choose **Cancel**. On the detail page of
  `verify-first-renamed`, require the **QR Code** SVG and the text
  `https://localhost:6169/verify-first-renamed`. Screenshot both. If a QR decoder is available
  (for example `zbarimg` on the screenshot), require it to decode the same text; otherwise record
  the payload as not decoded.
- **Preview, offline paths.** On the detail page set **Destination URL** to `http://localhost/x`
  without saving and choose **Fetch** under **Custom Link Preview**. Require the toast and alert
  `Could not fetch OGP data for that URL.` and unchanged `title` in D1. In **Create link**, choose
  **Upload a custom preview image** and pick
  [`../fixtures/not-an-image.txt`](../fixtures/not-an-image.txt); require the toast
  **Please choose an image file.** Pick [`../fixtures/verify-preview.svg`](../fixtures/verify-preview.svg);
  the overlay **Uploading to img…** may flash briefly; then require the toast
  `Image upload is temporarily unavailable. Please try again.` (the `img` Worker is not running)
  and the placeholder **Click or drop an image**. Choose **Cancel**.
- **Archive and restore.** Create `verify-archive` (destination `https://1.1.1.1/verify-archive`,
  domain `localhost:6169/`). On `/links`, open its card's **Link actions** and choose
  **Archive…**. Require the alert **Archive link**, `Are you sure you want to archive the following
  link?`, the preview `localhost:6169/verify-archive`, and choose **Archive link**. Require the
  card to disappear. Open **Display**, turn on **Show archived links**, and require the card with
  the badge **Archived**. From its menu choose **Restore…**, then **Restore link**. D1:
  `SELECT archived_at FROM links WHERE slug = 'verify-archive'` is non-null after archive and null
  after restore.
- **Delete.** On the detail page of `verify-archive`, open **Link actions** and choose
  **Delete link…**. Require the alert **Delete link**, the warning `Deleting these links will
  remove all of their analytics.`, and a disabled **Delete link** button. Type
  `localhost:6169/verify-archive` into **Confirm link deletion**; the button enables. Choose it and
  require `/links` without the card, also with **Show archived links** on. D1:
  `SELECT deleted_at FROM links WHERE slug = 'verify-archive'` is non-null. HTTP:
  `/verify-archive` answers 404.

Evidence: screenshots of the empty state, the filled dialog, the detail page after create and
after edit, both QR codes, the archive and delete dialogs; the D1 rows and HTTP lines above.

## Gotchas

The domain select defaults to `gdgs.jp/`, which does not resolve locally; always choose
`localhost:6169/`. Leaving **Title**, **Description**, and **Image URL** empty when the
destination field loses focus triggers an automatic preview fetch to the destination; with a
network that contacts `1.1.1.1`. Fill **Title** first.
**Short Link** has an HTML pattern, so a slug such as `bad slug!` is blocked by the browser
before any request; record the native validation message, not a server error.
Deleted links keep their slug: creating `verify-archive` again answers
`The slug "verify-archive" is already taken.` Use new slugs per run.
The detail QR text and **Visit short URL** use `https://` even on the local `http://` stack, so
do not click through it.
The **C** badge on **Create link** on `/links` has no keyboard handler; only `/tags` listens for
**C**. Do not count a key press as a create entry point.
Tags are shared across links of the same user; `verify-tag` created here is reused by later
journeys and counted on `/tags`.
