# Wiki keyword search

A user finds an accessible page by a unique marker. A user without page access
cannot find the same page.

## Sub-features

- `wiki-search` checks a matching result and an authorization-filtered result.

## How to get to it (user POV)

Use Wiki search or open `http://localhost:6177/s/gdg-jp/search?q=VALUE`, where
`VALUE` is this run's unique body marker. Select the keyword search mode.

## Driving it with Orca Browser

Preconditions: complete the authoring journey and keep its URL and unique body
marker. Use a separate member profile with the `member` Wiki fixture. The page
must be restricted to its author for the negative check.

- Positive. In the author profile, open the space search route with the encoded
  marker as `q`. Select **キーワード** if needed. Require the created page's title
  and actual link in the results. Follow the link and require the page body marker.
- Restrict. In the author profile, use the sharing controls to make the page
  **Restricted**. Capture the successful page-access response. Read its access
  state through HTTP and require that the member has no page grant.
- Negative. In the member profile, search for the same marker in the same keyword
  mode. Require no link to that page. Request the page URL as the member through
  HTTP and require 404, which hides a denied page from a signed-in reader.
  Record both observations so absence alone is not the proof.

## Gotchas

This search uses local D1 `LIKE`. It does not verify AI search, vector retrieval,
external indexing, ranking quality, or production latency. Inspect the real page
access result before the negative check. Space access alone does not establish
that the member lacks page access. A public page is not a valid negative fixture.
