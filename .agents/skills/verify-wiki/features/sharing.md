# Sharing dialog

## Sub-features

An author opens sharing, sees access sections, copies the link, and closes the dialog with Escape. Focus returns to its trigger.

## How to get to it (user POV)

Open the seeded **E2E Test Page** as its author. Choose **Share**, directly or from **More actions** on narrower layouts.

## Driving it with Orca browser

Set the author fixture cookie on the isolated Orca tab. Navigate to `http://localhost:6177/wiki/e2e-test-page`. Open **Share** using the current snapshot ref. Require the dialog heading to mention **E2E Test Page**, and require **People with access** and **General access**.

Click **Copy link** and observe **Copied**. Press Escape. Require the dialog to close and focus to return to its trigger, using Orca's snapshot or eval to read `document.activeElement`.

Capture the action receipts and open and closed dialog states. The existing recipe is `Google Docs-style overview, copy, Escape and focus restoration` in `access-control.spec.ts`.

## Gotchas

The seeded author's signed dev session is required. This journey does not send notifications or verify grants. A fixture or selector failure remains a failed journey.
