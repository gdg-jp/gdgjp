# Public redirect, bot preview, and not found

Anyone, signed in or not, opens a short link and is sent to its destination with a 302. Link
preview crawlers get an HTML page with Open Graph tags instead. Unknown and deleted slugs answer
404. Link visibility and sharing do not affect public resolution.

## Sub-features

- `tinyurl-redirect` apex path: `http://localhost:6169/<slug>` answers 302 with `Location` set to
  the destination and `Cache-Control: no-store, max-age=0`.
- `tinyurl-redirect` prefixed path: `/r/<slug>` resolves the same link.
- `tinyurl-redirect` bot preview: a crawler user agent gets 200 HTML with `og:title`,
  `og:description`, `og:url`, a `twitter:card`, and a meta refresh to the destination.
- `tinyurl-redirect` not found: an unknown slug and a deleted link answer 404; `/notfound`
  renders **Link not found**.
- `tinyurl-redirect` private links still resolve publicly.
- `tinyurl-redirect` archived links: current behavior.

## How to get to it (user POV)

Paste a short link (for example `localhost:6169/verify-first-renamed`, shown on the link card and
copied with **Copy short URL**) into a browser, chat app, or social post. Crawlers fetch the same
URL to build a preview.

## Driving it with Orca Browser

Preconditions: seed applied; [links.md](links.md) `tinyurl-link-create` and `tinyurl-link-edit`
ran, so `verify-first-renamed` exists on `localhost:6169` with destination
`https://1.1.1.1/verify-first-edited` and title `Verify first link`. `UA` is set as in the README.
These are HTTP journeys: do not open a short link in Orca, because the browser would follow the
302 to the external destination.

- **Redirect.** `curl -s -D - -o /dev/null -A "$UA" http://localhost:6169/verify-first-renamed`
  must show status `302`, `Location: https://1.1.1.1/verify-first-edited`, and
  `Cache-Control: no-store, max-age=0`. Repeat without any cookie and with the owner jar; both
  answer the same.
- **Prefixed path.** `curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' -A "$UA"
  http://localhost:6169/r/verify-first-renamed` prints `302 https://1.1.1.1/verify-first-edited`.
- **Seeded private link.** `curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' -A "$UA"
  http://localhost:6169/verify-seed-private` prints `302 https://1.1.1.1/verify-seed-private`,
  although `owner` gets 403 on its detail page ([sharing.md](sharing.md)).
- **Bot preview.** `curl -s -A 'Twitterbot/1.0' http://localhost:6169/verify-first-renamed`
  returns status 200 HTML containing `<title>Verify first link</title>`,
  `<meta property="og:title" content="Verify first link">`,
  `<meta property="og:url" content="http://localhost:6169/verify-first-renamed">`,
  `<meta name="twitter:card" content="summary">`, and
  `<meta http-equiv="refresh" content="0;url=https://1.1.1.1/verify-first-edited">`. curl's
  default user agent receives this same page.
- **Not found.** `curl -s -o /dev/null -w '%{http_code}\n' -A "$UA"
  http://localhost:6169/verify-missing-slug` prints `404`; `/r/verify-missing-slug` prints `404`;
  the deleted `verify-archive` from [links.md](links.md) prints `404`. In Orca, `goto
  http://localhost:6169/notfound` and require **404**, **Link not found**,
  `This short link doesn't exist or has been removed.`, and **Go to links**.
- **Archived link.** Archive a fresh link `verify-archived-redirect` (destination
  `https://1.1.1.1/verify-archived-redirect`, domain `localhost:6169/`) and request it with
  `-A "$UA"`. Record the status. Current source answers 302 to the destination: archiving hides a
  link from lists but does not stop resolution.
- **Wrong domain.** A link saved on the default `gdgs.jp/` domain (create `verify-gdgs-domain`
  without changing **Short link domain**) answers 404 at `http://localhost:6169/verify-gdgs-domain`.
  Its D1 row has `domain_id = 1`. This is expected locally, not a defect.

Evidence: the response header blocks, the preview HTML excerpt, the `/notfound` screenshot, and
`SELECT l.slug, d.hostname, l.archived_at, l.deleted_at FROM links l JOIN domains d ON
d.id = l.domain_id WHERE l.slug LIKE 'verify-%'`.

## Gotchas

curl, `node` fetch, and other tools without a browser user agent are bots to `isbot`: they get
the 200 preview page, never a 302. Always pass `-A "$UA"` for redirect checks.
Unknown slugs answer the framework's bare 404, not the **Link not found** page; `/notfound` is
reachable only directly.
The local apex resolves only links on the seeded `localhost:6169` domain. Links on `gdgs.jp` and
`go.gdgs.jp` resolve only behind their production hostnames.
Click events are written to Analytics Engine on each request; the counts are not readable in this
stack (see [analytics.md](analytics.md)).
- Observed on 2026-11-24: with `APP_URL` and `SHORT_URL_BASE` both `http://localhost:6169`, the
  Worker treats every request on that host as an apex short link (`workers/app.ts`,
  `isApexRedirect`), so `/r/<slug>` resolves the slug `r` and answers 404. The `/r/` form is
  only reachable on a dashboard host that differs from the short-link host, which this stack
  does not have. Record the `/r/` probes as not reachable locally rather than as a failure.
