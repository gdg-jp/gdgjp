# Approval and send lifecycle

What a person sees for one post or mail and one chapter account, from the first draft to the
send. Each approval names the version on screen (`drafts.approved_version`,
`dispatch_targets.approved_version`). A send goes out only as the version that both the draft
approval and the chapter's approval name, and only while it is still the latest. A version
holds the text and the attached image (`draft_versions.media_url`), so changing the image saves
a new version like any other edit.

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
  s1 --> s2: the runner or an editor saves a new version or image
  s1 --> s3: a chapter member approves the version on screen
  s2 --> s1: a lead approves the version on screen
  s3 --> s4: the send starts [a post at once or at the next minute's cron, a mail at its time]
  s3 --> s2: the runner or an editor saves a new version or image
  s4 --> s5: the send fails
  s4 --> s6: sns or connpass accepts it
  s5 --> s3: a chapter member approves the version on screen
  s5 --> s2: the runner or an editor saves a new version or image
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
never uses another version's link. A connpass page or listing publishes the approved version.
A new version saved while a send is under way does not change what is sent. A post is claimed
and sent by the request that approves it; if that request stops before the claim, the minute
cron claims it with the approver's stored claims. Both claim with the same conditional write,
so one of them sends. The chart leaves out レビュー OK, 差し戻す, 却下, more than one account,
delegating or skipping a target, and sns reporting a scheduled post as failed later.
`app/features/dispatch/dispatch.server.test.ts` replays the races the chart cannot show.

## Known gaps

- A target whose Worker stops after the claim and before the send is recorded stays
  `dispatching`: a post before sns answers, a mail before its connpass job is in
  `connpass_jobs`. Nothing retries it, because the send may already have reached sns or
  connpass, and the page shows no button for it.
- If url.gdgs.jp creates a version's link and the Worker stops before pr records it, the next
  attempt is refused as a taken slug instead of making a second link, and the send does not go
  out. The TinyURL RPC has no lookup by slug, so a person deletes the link in url.gdgs.jp and
  approves the target again.
- A Discord post whose link creation fails at its time is marked failed and is not retried.
- Links stored before migration 0012 stay for health checks and metrics; only those a sent
  target shows went out with a version are bound to it.
