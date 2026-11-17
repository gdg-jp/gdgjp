# Viewer permissions

## Sub-features

A read-only reader can change personal display settings. The reader cannot duplicate, move, or archive the page.

## How to get to it (user POV)

Open a public Wiki page as a signed-in member who is not its author. Open **More actions**.

## Driving it with Orca browser

Start the helper with `--serve`. Read the author's local fixture cookie from the path in `ready.json`. Establish public viewer access with POST `/api/page-access/e2e-test-page-id`, JSON `{"intent":"setGeneralAccess","visibility":"public","generalRole":"viewer"}`, using that author cookie. Require a successful response.

In a new isolated Orca profile, set the member fixture cookie and navigate to `http://localhost:6177/wiki/e2e-test-page`. Open **More actions** using the snapshot's current ref. Check **Duplicate**, **Move to**, and **Move to Trash** are disabled. Click **Small text**. Observe the visible article's `data-small-text` attribute becoming `true` through Orca eval.

Attempt duplicate with POST to the page path and form `intent=duplicatePage` as the member. GET `/api/pages/move-targets?pageId=e2e-test-page-id` as the same member. Both must return 403. Capture responses and the Orca menu screenshot. The existing recipe is `read-only viewers can copy and change display but cannot mutate` in `page-menu.spec.ts`.

Save the HTTP method, request body, `member` fixture label, expected user ID
`e2e-member-user-id`, status, and response body. Do not save the signed cookie value.

## Gotchas

Signed development cookies establish identities without Google. This does not verify OIDC. Fixtures are test-only data in disposable local D1. This journey does not attempt every mutation endpoint.
