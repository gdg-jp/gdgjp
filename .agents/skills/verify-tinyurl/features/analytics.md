# Analytics

Members read click analytics for all their accessible links or one link: total clicks over a
date range, a trend chart by total, source, or link, and breakdowns by source, link, referrer,
location, browser, OS, and device. Clicks are recorded on every public redirect.

## Sub-features

- `tinyurl-analytics-empty` a user with no own, chapter, or shared links sees **No links yet**.
- `tinyurl-analytics` with links, the page renders **Clicks** `0` and the empty breakdowns
  (`No source data yet.`, `No clicks yet.`) because Analytics Engine is not readable locally.
- `tinyurl-analytics` single-link focus from **Analytics** in a link's menu or the **N clicks**
  button: the short URL under the heading, **Visit destination**, and **Clear link filter**.
- `tinyurl-analytics` malformed or unknown `linkId` answers 404; an inaccessible link answers 403.
- `tinyurl-analytics` the date range sheet (**Date range**) and automated-clicks toggle change the
  URL query and keep the page rendering.

## How to get to it (user POV)

Sidebar **Insights**, **Analytics** (`http://localhost:6169/analytics`); a link card's
**Link actions**, **Analytics**; the **0 clicks** button on a link detail page
(`/analytics?linkId=<id>`).

## Driving it with Orca Browser

Preconditions: `owner` signed in. The empty step runs before `owner` creates any link.

- **Empty.** `goto /analytics`. Require heading **Analytics**, **No links yet**, and
  `Create a link to start collecting analytics.` The outsider's seeded link does not count.
- **Zero data.** After [links.md](links.md) ran, `goto /analytics`. Require the **Clicks** card
  with `0`, the **Sources** card with `No source data yet.`, and the **Links** card with
  `No clicks yet.` Generate traffic first with three redirect requests
  (`curl -s -o /dev/null -A "$UA" http://localhost:6169/verify-first-renamed`); the count stays `0`
  in this stack, which is expected.
- **Focus.** `goto /links/<verify-first-renamed id>` and choose **0 clicks**. Require the URL
  `/analytics?linkId=<id>`, the title `verify-first-renamed analytics — GDG Japan Links`, the
  description `http://localhost:6169/verify-first-renamed`, **Visit destination**, and the link
  **Clear link filter** (visible text `verify-first-renamed`). Choose it and require `/analytics`.
- **Errors.** HTTP with the owner jar: `/analytics?linkId=not-a-link` prints `404`;
  `/analytics?linkId=link_01KSEED00000000000000000ZZ` prints `404`;
  `/analytics?linkId=link_01KSEED00000000000000000PV` prints `403`.
- **Range.** Open the date button, require the sheet **Date range** with
  `Select a preset or a start and end date.`, choose another preset, and require the URL query to
  change and the **Clicks** card to render again. Toggle the automated-clicks switch in the chart
  footer and require the URL query to change.

Evidence: screenshots of the empty, zero, and focused pages; the HTTP status lines.

## Gotchas

Click writes go to the `CLICKS_AE` binding and reads go to the Cloudflare AE SQL API, which needs
`CF_ACCOUNT_ID` and `CF_AE_API_TOKEN`. The test stack has neither, so every query fails and the
page falls back to zero. A nonzero count, per-source breakdown, or campaign click chart is outside
this map; do not report zero as a pass or failure of click recording.
The focused short URL is built from `SHORT_URL_BASE` and the slug, not from the link's domain, so
for a `go.gdgs.jp/` or `verify-gw.example/` link it shows `http://localhost:6169/<slug>`.
