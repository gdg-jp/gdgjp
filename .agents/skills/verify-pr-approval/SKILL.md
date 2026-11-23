---
name: verify-pr-approval
description: Model-check pr.gdgs.jp's promise that nothing is posted or mailed without approval, with Alloy 6 over draft review, dispatch-target approval, and the send. Use after changing apps/pr draft status, draft versions, dispatch targets, the mail cron, or who may approve.
---

# Verify pr approval before sending

pr.gdgs.jp promises that nothing goes out without approval: a draft is approved, then each
account's dispatch target is approved by a member of that account's chapter, and only then
does the Worker call sns or connpass. A break posts to X or mails every participant under a
chapter's name, and neither can be taken back.

[model/approval.als](model/approval.als) is an Alloy 6 model of that flow. Every transition
in it is one D1 statement or one D1 batch in `apps/pr`. The model checker tries every order
of those statements inside the bounds below. It checks the model, not the TypeScript.

## Does your change touch this

Run the check when you change any of these in `apps/pr/app`:

- `features/drafts/`: `state-machine.ts`, `review.server.ts`, `draft.repository.server.ts`,
  `detail.server.ts`
- `features/dispatch/`: `dispatch.server.ts`, `target.ts`, `target.repository.server.ts`,
  `delivery.server.ts`, `poll.server.ts`, `components/DeliveryCard.tsx`
- `features/connpass/mail.server.ts`, `features/connpass/poll.server.ts`
- `features/campaigns/access.server.ts`
- `features/jobs/complete.server.ts`, `features/live/generate.server.ts`
- `routes/drafts/detail.tsx`

Also run it when you add a call to `appendVersion`, `setDraftStatus`, `moveTarget`,
`ensureTargets`, `createScheduledPost`, or `sendMessage` anywhere in `apps/pr`, or write
`drafts` or `dispatch_targets` with new SQL. The script counts those call sites in every
file under `apps/pr/app` and `apps/pr/workers` and reports a new one.

## Run

From the repository root. It needs Node 22.18 or newer and a Java runtime on `PATH`.
Verified with Node 26.3.1 and Temurin 21.0.3 on macOS arm64.

```sh
node .agents/skills/verify-pr-approval/scripts/verify.mjs
node .agents/skills/verify-pr-approval/scripts/verify.mjs --mutation-proof
```

The first run downloads Alloy 6.2.0 (21 MB) to `local_data/pstack/tools/` and checks its
SHA-256. The version, URL, and hash are pinned in `scripts/verification/alloy.mjs`. On a
machine without network access, set `ALLOY_JAR` to a copy of that file. The plain run takes
about 100 seconds, and `--mutation-proof` about two minutes.

The last line names a JSON report under `local_data/pstack/pr-approval/`. It holds every
result and every counterexample as numbered steps.

## Read the result

Each line is one check:

- `ok    <name>: holds` means Alloy found no trace that breaks the property.
- `ok    <name>: reachable` means a witness still exists: a post, a mail, and a resend
  after a failure can each happen. Without these, the other checks could pass because
  nothing can be sent.
- `open  <name>: finding F<n> still reproduces` means a recorded break of the product code
  is still there. The steps follow.
- `FAIL` means the result differs from `coverage.json`.

Exit codes:

- 0: every check matches `coverage.json` and the covered code is unchanged. Open findings
  are listed, and they are still bugs.
- 1: a property that held now has a counterexample, a recorded finding now holds, a witness
  vanished, a mutation was not caught, or the tool failed.
- 2: covered code changed. Nothing ran. See "When covered code changes".

## Properties

| Check | Property | Harm when it breaks | Now |
| --- | --- | --- | --- |
| `SendNeedsDraftApproval` | Nothing is sent unless a lead, the host chapter's organizer, or an admin approved the draft. | A post or a mail goes out although nobody with approval rights approved it. | holds |
| `SendRunsAsChapterMember` | Every send for an account runs as a member of that account's chapter who approved that target. | Someone outside a chapter posts from that chapter's account. | holds |
| `OneSendPerTargetApproval` | One approval of a dispatch target causes at most one send. | The same post or mail goes out twice. | holds |
| `SentVersionWasApprovedWhenSerial` | When requests do not overlap, the version that goes out was the latest version at a moment when the draft was approved. | Text that nobody approved goes out. | holds |
| `SentVersionWasApproved` | The same, when requests may overlap. | Text that nobody approved goes out. | finding F1 |
| `SentVersionWasChapterApprovedInOrderlyUse` | The version that goes out for an account was the latest version when that account's chapter approved the target. | A chapter's approval of one text sends a later text. | finding F2 |
| `DraftApproverSawSentVersionInOrderlyUse` | The version that goes out was on the draft approver's screen when they pressed approve. | The approver approves a text they have not read. | finding F3 |
| `ChapterApproverSawSentVersionInOrderlyUse` | A version the draft approver saw was also on the chapter approver's screen when they approved the target. | A chapter member approves sending a text they have not read. | finding F4 |

"Orderly use" means requests do not overlap and people press only buttons that the page
they last loaded showed them. A finding under that premise needs no race.

[references/findings.md](references/findings.md) tells F1 to F4 as steps and names the
code behind each.

## Bounds and assumptions

Alloy checks every trace of up to 14 states, or 18 for the `WhenSerial` and `InOrderlyUse`
checks, with exactly 2 chapters, 3 users, 2 accounts with one dispatch target each, 3 draft
versions, and 2 Worker requests in flight at once. There is one schedule item with one
draft. The item is an X post or a connpass mail. A pass says nothing beyond these bounds.

The model assumes:

- A D1 statement, and a D1 batch, is atomic. Statements of different requests interleave
  freely.
- A Worker can stop after any statement.
- Chapter membership, campaign roles, and the campaign's accounts do not change during a
  trace.
- A person submits only the forms on `routes/drafts/detail.tsx`. Only the three
  `InOrderlyUse` checks and `SentVersionWasApproved` assume this. The checks that hold do
  not: they cover hand-written requests too.
- Reading the latest version and calling sns or connpass are one step. Nothing else in the
  model reads what was sent, so the order of that call against other steps cannot change a
  result.

It does not cover:

- the image on a post (`drafts.dispatch_media_url`). `setDispatchMedia` changes it without a
  new version or a new approval, and the model has only versions;
- `discord_post` items and staff reminders, connpass page publishing, and listings, which
  send through other paths;
- a second send after sns or connpass accepted a post but the call returned an error. The
  target becomes `failed`, and approving it again sends again. `OneSendPerTargetApproval`
  counts that as two approvals;
- `?v=` on the draft page, `skipped`, `delegated`, and `done` targets, a draft with status
  `superseded`, deleting drafts, items, or accounts, and what sns, tinyurl, and connpass do
  after the call;
- whether the TypeScript does what the model says. `coverage.json` ties the two together,
  and a person keeps it true.

## When covered code changes

Exit code 2 lists each changed file, each new or removed call site, and each anchor that no
longer matches. An anchor is a line of production code that a model transition stands for.
`coverage.json` names the transition next to it.

1. Read the diff of every listed file since `syncedCommit` in `coverage.json`.
2. For each change, decide whether it alters a step that the model describes: a guard, the
   status a write requires or sets, which rows a statement touches, the order of statements,
   what a request reads before it writes, or a new path to `drafts`, `draft_versions`,
   `dispatch_targets`, sns, or connpass.
3. If it does, change `model/approval.als` to say what the code now does. Keep one
   statement or batch as one transition. Write the change from the code, before you look at
   a result. Update the anchors and the `find` text of any mutation that no longer matches.
4. Run with `--allow-source-drift --mutation-proof`. This runs the checks against your
   updated model and still exits 2.
5. When every line is `ok` or a recorded `open`, and you have confirmed that the model
   describes the code, run with `--record`. It reruns everything, then writes the new
   hashes, call sites, and `syncedCommit`. It writes nothing if any check differs.

Do not run `--record` to silence exit code 2. It moves the sync point, so run it only after
steps 1 to 3.

## A counterexample appears

Replay the steps against the code. Each step names what a request read or wrote, and
`coverage.json` gives the line.

- If a step cannot happen in the code, the model is wrong. Fix the model and say what was
  wrong.
- If every step can happen, the code breaks the property. Report it with the steps and the
  harm. Do not weaken the property, add a premise, or shrink a bound to make it pass, and do
  not change product code unless the user asked for the fix.

To confirm a counterexample on real SQL, a throwaway Vitest file in `apps/pr` can load
`schema.sql` into `node:sqlite` as `features/jobs/job.repository.server.test.ts` does and
call the repository functions in the order of the steps. F2 was confirmed that way.

## A finding is fixed

When product code closes a finding, its check reports `FAIL ... but it now holds`. Update
the model for the fix as in "When covered code changes", set that check's `expect` to
`holds` in `coverage.json`, remove its `finding`, and add a mutation in `scripts/verify.mjs`
that removes the new guard from the model and names the check it must break. Then run
`--record`.

## Prove the check can fail

`--mutation-proof` copies the model, removes one guard per copy, and requires the named
property to fail. Each guard stands for a line of production code:

| Mutation | Guard removed | Property that must fail |
| --- | --- | --- |
| `approve-without-manage` | `actor.canApprove` in `nextStatus` | `SendNeedsDraftApproval` |
| `target-approve-without-chapter-check` | `canApproveTarget` in `approveTarget` | `SendRunsAsChapterMember` |
| `claim-without-compare-and-swap` | the result of `moveTarget(["approved"] -> "dispatching")` | `OneSendPerTargetApproval` |
| `target-approve-ignores-draft-status` | `draft.status !== "approved"` in `approveTarget` | `SentVersionWasApprovedWhenSerial` |
| `mail-cron-ignores-draft-status` | `d.status = 'approved'` in `dueMailTargets` | `SentVersionWasApprovedWhenSerial` |

## Coverage record

[coverage.json](coverage.json) holds the SHA-256 of nine source files, the call-site counts,
the anchors, the expected result of each check, and `syncedCommit`: the commit at which the
model was last confirmed to describe the code. Use `/maintain-formal-verification-skill`
when earlier changes skipped this review.
