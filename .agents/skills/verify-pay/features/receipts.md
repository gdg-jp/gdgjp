# Receipt viewing

An item's receipt file link (`領収書: <filename>`) opens the stored file. Only the
claimant, the claim's creator, and the event's managers can read it.

## Sub-features

- `pay-receipt-access` serves a seeded receipt to its claimant and to a manager, refuses an unrelated member and another chapter's organizer, and redirects anonymous requests to sign-in.

## How to get to it (user POV)

On a claim page that the user can edit, each item with a receipt shows `領収書:` followed
by a link with the file name. The link opens `/receipts/claims/<claimId>/<file>` in the
same tab. Users who see the read-only item table have no link and reach the file only by URL.

## Driving it with Orca Browser

Preconditions: the helper is ready with the seed applied, and the receipt object exists
in the local R2 bucket. Create it once from the scratch `apps/pay` directory, using the
same persistence directory as the running app (add `--persist-to <dir>` if the helper
reports a non-default one):
`pnpm exec wrangler r2 object put gdgjp-pay-receipts/claims/clm_0000000000000000000000SEC2/fixture-receipt.png --local --file public/app-icon.png --content-type image/png`.
Receipt URL: `/receipts/claims/clm_0000000000000000000000SEC2/fixture-receipt.png`.

- Claimant. As `member` (`/dev/login?as=member&chapter=1:gdg-tokyo:member&return_to=/`),
  open C2 (`/events/evt_0000000000000000000000SEE1/claims/clm_0000000000000000000000SEC2`).
  Require the text `領収書: fixture-receipt.png` with a link. Choose the link. Require HTTP
  200, `Content-Type: image/png`, `Cache-Control: private, max-age=300`, and a rendered
  image. Evidence: network entry, screenshot.
- Manager. As `organizer` (`/dev/login?as=organizer&chapter=1:gdg-tokyo:organizer&return_to=/`),
  navigate to the receipt URL. Require HTTP 200 and `image/png`.
- Refused. As `claimant` (`/dev/login?as=claimant&chapter=1:gdg-tokyo:member&return_to=/`)
  and as `outsider` (`/dev/login?as=outsider&chapter=2:gdg-osaka:organizer&return_to=/`),
  navigate to the receipt URL. Require HTTP 403 for both.
- Anonymous. `curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://localhost:6164/receipts/claims/clm_0000000000000000000000SEC2/fixture-receipt.png`
  prints `302` with a location ending
  `/signin?return_to=%2Freceipts%2Fclaims%2Fclm_0000000000000000000000SEC2%2Ffixture-receipt.png`.
- Unknown object. As `member`, navigate to
  `/receipts/claims/clm_0000000000000000000000SEC2/missing.png` and require 404.
  Independent check for the whole journey: `pnpm exec wrangler r2 object get gdgjp-pay-receipts/claims/clm_0000000000000000000000SEC2/fixture-receipt.png --local --pipe | wc -c`
  equals the byte size of `public/app-icon.png`.

## Gotchas

- SQL cannot create R2 objects. Without the `wrangler r2 object put` step every receipt
  request returns 404, including the ones expected to be 403; record the journey as
  blocked by its precondition.
- The route looks up the object before checking permission, so a missing object returns
  404 to anyone signed in. Only an existing object distinguishes 403 from 404.
- Uploaded receipts are covered by `pay-receipt-upload-manual` in [claim detail](claim-detail.md).
- If `pay-claim-items` deleted an item with a receipt, its object is gone. The seeded
  receipt belongs to C2, which no mutation journey deletes.
