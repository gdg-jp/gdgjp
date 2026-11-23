# Open findings

Each finding is a counterexample that Alloy found in the model and that was then read
against `apps/pr`. Paths are under `apps/pr/app`. The verifier prints the current steps on
every run; the steps here are the same traces with the names made readable.

All four come from one design fact: an approval is stored as a status on the draft row and
on the target row. Neither row records which version was approved, the forms send no
version, and a send reads the latest version.

## F1. A version saved during a target approval goes out unapproved

Property: the version that goes out was the latest version at a moment when the draft was
approved.

1. A lead approves the draft at version 1.
2. A chapter member presses the approve button of a dispatch target. The Worker reads the
   draft row and sees `approved` (`features/drafts/detail.server.ts`, `getDraft`).
3. Before that request writes anything, the runner saves version 2. The draft goes back to
   `in_review` or `generating` (`features/jobs/complete.server.ts`, `saveVersion`).
4. The request carries on with the status it read: it approves the target, claims it, reads
   the latest version, and sends version 2 (`features/dispatch/dispatch.server.ts`,
   `approveTarget` and `dispatchTarget`).

Nobody approved version 2. The window is the time between two statements of one request.
The mail cron has the same window between `dueMailTargets` and `latestVersion` in
`features/connpass/mail.server.ts`. With requests that do not overlap, the property holds.

## F2. A chapter's approval of a mail carries over to a later version

Property: the version that goes out for an account was the latest version when that
account's chapter approved the target.

1. A lead approves the mail draft at version 1. Targets are created.
2. A member of the co-host chapter approves the target of their connpass group. A mail
   target waits for the cron, so it stays `approved`.
3. The runner or an editor saves version 2. The draft goes back to `in_review`. The target
   stays `approved`: nothing resets `dispatch_targets` when a version is added.
4. The lead approves version 2.
5. At the item's time the cron finds the target `approved` and the draft `approved`, and
   sends version 2 as the co-host member (`features/dispatch/target.repository.server.ts`,
   `dueMailTargets`; `features/connpass/mail.server.ts`, `sendDueMails`).

The co-host chapter approved version 1 and never saw version 2. No race is needed. This
sequence was replayed on the real SQL and the real repository functions with `schema.sql`
in `node:sqlite`: after step 4, `dueMailTargets` returns the target with the co-host
member as approver, and `latestVersion` returns version 2.

## F3. The approve button approves whatever version is latest when it arrives

Property: the version that goes out was on the draft approver's screen when they pressed
approve.

1. A lead opens the draft page. It shows version 1, in review.
2. The runner saves version 2. The draft stays `in_review`. The open page does not reload.
3. The lead presses 承認. The form has no version field (`routes/drafts/detail.tsx`). The
   Worker reads the draft row, sees `in_review`, and sets `approved`
   (`features/drafts/review.server.ts`, `reviewDraft`).
4. A chapter member approves the target, and version 2 is sent.

The lead read version 1 and approved version 2. `draft_reviews` records the version that
the Worker read at step 3, so the audit row says version 2 was approved.

## F4. The target approve button has the same gap

Property: a version the draft approver saw was also on the chapter approver's screen when
they approved the target.

1. The draft is approved at version 1. A chapter member opens the page and sees version 1
   with the target's approve button.
2. Version 2 is saved, and a lead reads and approves version 2.
3. The chapter member presses the target's approve button on the page they still have open.
   The form sends the target id only (`features/dispatch/components/DeliveryCard.tsx`).
4. The Worker sees the draft `approved` and sends version 2 from that chapter's account.

## Seen while reading, not model-checked

- `setDispatchMedia` (`features/dispatch/delivery.server.ts`, intent `media`) changes the
  image of an approved draft for anyone who can edit the campaign. The draft stays
  `approved`, and the next target approval posts the new image.
