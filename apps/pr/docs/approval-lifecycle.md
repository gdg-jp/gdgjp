# Approval and send lifecycle

What a person sees for one post or mail and one chapter account, from the first draft to the
send. Each approval names the version on screen (`drafts.approved_version`,
`dispatch_targets.approved_version`). A send goes out only as the version that both the draft
approval and the chapter's approval name, and only while it is still the latest.

```mermaid
---
title: "pr.gdgs.jp: approving and sending one post or mail for one chapter account"
---
stateDiagram-v2
  state "Legend" as legend {
    lg0: approval
    lg1: sending
    lg2: done
  }
  class lg0 yellow
  class lg1 blue
  class lg2 teal
  s0: Draft in review
  s1: Draft approved#59; waiting for the chapter's approval
  s2: A new version is in review#59; approvals no longer apply
  s3: Both approved this version#59; waiting to send
  s4: Sending the version both approved
  s5: The send failed#59; the chapter can approve again
  s6: Sent
  [*] --> s0
  s0 --> s1: a lead approves the version on screen
  s1 --> s2: the runner or an editor saves a new version
  s1 --> s3: a chapter member approves the version on screen
  s2 --> s1: a lead approves the version on screen
  s3 --> s4: the send starts [a post at once, a mail at its time]
  s3 --> s2: the runner or an editor saves a new version
  s4 --> s5: the send fails
  s4 --> s6: sns or connpass accepts it
  s5 --> s3: a chapter member approves the version on screen
  s5 --> s2: the runner or an editor saves a new version
  s4 --> s2: the send fails
  s2 --> s5: a lead approves the version on screen
  class s0 yellow
  class s1 yellow
  class s2 yellow
  class s3 blue
  class s4 blue
  class s5 yellow
  class s6 teal
```

Pressing approve on a page that shows an older version, or without the right to approve, is
refused and changes nothing, inside or outside pr, so the chart draws no arrow for it. Approval
checks only read; the approval is written conditionally on the version, status and permission;
only then does pr act outside. A `{{shortlink}}` link belongs to the version it was created for
(`campaign_links.draft_id`, `draft_version`, slug `<campaign>-<kind>-<draft>v<version>`): the
draft approval creates it, a send that finds it missing creates it before sending, and a send
never uses another version's link. A connpass page or listing publishes the approved version. A new version saved while a send is under way does not change
what is sent. The chart leaves out レビュー OK, 差し戻す, 却下, more than one account,
delegating or skipping a target, and sns reporting a scheduled post as failed later.
`app/features/dispatch/dispatch.server.test.ts` replays the races the chart cannot show.

## Known gaps

- If url.gdgs.jp creates a version's link and the Worker stops before pr records it, the next
  attempt is refused as a taken slug instead of making a second link, and the send does not go
  out. The TinyURL RPC has no lookup by slug, so a person deletes the link in url.gdgs.jp and
  approves the target again.
- A Discord post whose link creation fails at its time is marked failed and is not retried.
- Links stored before migration 0012 stay for health checks and metrics; only those a sent
  target shows went out with a version are bound to it.

- `setDispatchMedia` (`app/features/dispatch/delivery.server.ts`, intent `media`) changes the
  image of an approved draft for anyone who can edit the campaign. The image is not part of a
  version, so the draft stays approved and the next target approval posts the new image.
- An X post target whose Worker stops after `approveTargetVersion` and before
  `claimApprovedTarget` stays `approved` for a version that is still current. Nothing claims
  it later and the page shows no approve button for it, so the post does not go out.
