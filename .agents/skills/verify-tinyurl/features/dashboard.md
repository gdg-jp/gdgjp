# Links list: search, filters, and display

The Links page lists the user's own links, their chapter's links, links shared with them, and
every public link, and lets them search, filter by scope, folder, and campaign, and change the
layout, ordering, archived visibility, and displayed properties.

## Sub-features

- `tinyurl-dashboard-view` search by slug, URL, title, description, campaign, or channel, with
  the **No links match your filters.** state.
- `tinyurl-dashboard-view` **Filter** scope: **All links**, **Owned by me**, **Shared with me**.
- `tinyurl-dashboard-view` folder filter: **All folders**, **Unfiled**, each folder.
- `tinyurl-dashboard-view` campaign filter: **All campaigns**, **Unclassified** (default), each
  campaign and channel.
- `tinyurl-dashboard-view` **Display**: **Cards** / **Rows**, **Ordering**, **Show archived links**,
  **Display properties**, **Reset to default**, **Set as default**.
- `tinyurl-dashboard-view` the footer `Viewing 1–N of M links`.

## How to get to it (user POV)

Sidebar **Links** (or the GDG Japan Links mark) opens `http://localhost:6169/links`; `/` redirects
there.

## Driving it with Orca Browser

Preconditions: `owner` signed in; [links.md](links.md) ran, so `owner` has at least
`verify-first-renamed`, the random-slug link, and the archived-then-restored flow done. Create
one more link `verify-dash-second` (title `Second dash link`, destination
`https://1.1.1.1/verify-dash-second`, domain `localhost:6169/`).

- **Search.** In **Search links**, type `dash-second`. Require exactly one card,
  `localhost:6169/verify-dash-second`. Type `Second dash` and require the same card (title match).
  Type `zzz-no-match` and require **No links match your filters.** Clear the field.
- **Scope.** Open **Filter** and choose **Shared with me**. With no shares yet, require
  **No links match your filters.** Choose **Owned by me** and require the owner's cards. Return to
  **All links**.
- **Footer.** Require `Viewing 1–N of M links` where N is the visible card count and M counts
  unarchived accessible links. Cross-check M against D1: `SELECT COUNT(*) AS n FROM links WHERE
  owner_user_id = 'dev-user-owner' AND deleted_at IS NULL AND archived_at IS NULL` (before any
  sharing or public links exist).
- **Layout and ordering.** Open **Display**. Choose **Rows** and require the list to switch to
  rows. Set **Ordering** to **Date created · oldest** and require the oldest link first. Require
  **Reset to default** and **Set as default** to appear. Choose **Set as default**, reload, and
  require rows and oldest-first to persist. Read-back: `orca eval
  "localStorage.getItem('gdgjp-tinyurl-display-v1')"` returns JSON with `"layout":"rows"` and
  `"sort":"oldest"`. Choose **Cards** and **Date created · newest**, then **Set as default** to
  restore the baseline.
- **Properties.** In **Display properties** uncheck **Destination URL** and require the
  destination text to disappear from the cards; check it again.
- **Archived.** Archive `verify-dash-second` from its **Link actions** menu. Require it gone, then
  turn on **Show archived links** and require it with **Archived**. Turn the switch off.
- **Folder and campaign filters.** After [folders.md](folders.md) and [campaigns.md](campaigns.md)
  ran, choose the folder in the folder filter and require only that folder's links; choose
  **Unfiled** and require them absent. Choose **All campaigns** and require campaign links to
  appear; with the default **Unclassified** they are hidden.

Evidence: screenshots of the search match, the empty filter state, the rows layout, and the
archived card; the localStorage JSON; the D1 count.

## Gotchas

The campaign filter defaults to **Unclassified**, so links created from a campaign channel or
assigned to one are missing from the default list. Switch to **All campaigns** before concluding a
link is gone.
Display defaults live in this browser's localStorage under `gdgjp-tinyurl-display-v1`; they also
apply to folder pages. Restore them after the journey.
Every member sees every public link under **Shared with me**, across chapters. A public link
created by any identity changes other identities' counts.
Click counts on cards come from Analytics Engine and are `0` in this stack.
