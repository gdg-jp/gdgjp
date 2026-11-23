module approval

-- pr.gdgs.jp: one schedule item, its draft, and one dispatch target per account.
-- Each transition below is one D1 statement or one D1 batch in apps/pr. The request
-- records hold what a Worker request read earlier and still acts on.
-- coverage.json maps every transition to the code it describes.

open util/ordering[Version]

sig Version {}
sig Chapter {}

sig User {
  chapters: set Chapter,
  organizes: set Chapter
} { organizes in chapters }

one sig Campaign {
  host: one Chapter,
  cohosts: set Chapter,
  members: set User,
  leads: set User,
  reviewers: set User,
  admins: set User
} {
  leads in members
  reviewers in members
}

abstract sig Kind {}
one sig XPost, ConnpassMail extends Kind {}
one sig Item { kind: one Kind }

abstract sig DraftStatus {}
one sig Generating, Drafting, InReview, NeedsApproval, DraftApproved, Rejected
  extends DraftStatus {}

abstract sig TargetStatus {}
one sig NoRow, Pending, TargetApproved, Dispatching, Scheduled, Failed
  extends TargetStatus {}

one sig Draft {
  var status: one DraftStatus,
  var versions: some Version
}

sig Account {
  chapter: one Chapter,
  var tstatus: one TargetStatus,
  var approvedBy: lone User
}

abstract sig Pc {}
one sig Idle, Began, Decided, Claimed, Delivered extends Pc {}

abstract sig Intent {}
one sig Approve, ReviewOk, RequestChanges, Reject, Edit, TargetApprove, MailCron
  extends Intent {}

sig Req {
  var pc: one Pc,
  var intent: lone Intent,
  var by: lone User,
  var snapStatus: lone DraftStatus,
  var target: lone Account
}

abstract sig Event {}
one sig EInit, ELoadPage, ESystemSave, EReleaseFix, EBegin, EReviewCas, EReviewCasLost,
  EEnsureTargets, EEditSave, ETargetApproveCas, ETargetCasLost, EDispatchClaim, EClaimLost,
  EMailCronRead, ESend, EFinishScheduled, EFail, EPollFailed, EAbort, EStutter
  extends Event {}

-- History the product does not store. No transition reads it.
one sig Ghost {
  var seen: User -> lone Version,
  var seenStatus: User -> lone DraftStatus,
  var approvedCurrent: set Version,
  var approvedOnScreen: set Version,
  var draftApprovers: set User,
  var chapterCurrent: Account -> Version,
  var chapterOnScreen: Account -> Version,
  var sent: Account -> Version,
  var sentAs: Account -> User,
  var unspent: set Account,
  var doubleSend: set Account,
  var resent: set Account,
  var event: one Event,
  var evUser: lone User,
  var evAccount: lone Account,
  var evIntent: lone Intent
}

fun current: one Version { max[Draft.versions] }

-- campaigns/access.server.ts campaignPermissions
pred hasAccess[u: User] {
  some u.chapters & (Campaign.host + Campaign.cohosts) or u in Campaign.admins
}
pred canManage[u: User] {
  u in Campaign.admins or Campaign.host in u.organizes or u in Campaign.leads
}
-- drafts/review.server.ts actorFor
pred canReview[u: User] { canManage[u] or u in Campaign.reviewers }
-- dispatch/target.ts canApproveTarget
pred canApproveTarget[u: User, a: Account] {
  a.chapter in u.chapters
  (u in Campaign.members + Campaign.admins or a.chapter in u.organizes)
}

-- drafts/state-machine.ts nextStatus
fun nextStatus[s: DraftStatus, i: Intent, u: User]: set DraftStatus {
  { t: DraftStatus |
    (i = ReviewOk and s = InReview and canReview[u] and t = NeedsApproval)
    or (i = RequestChanges and t = Drafting
        and ((s = InReview and canReview[u]) or (s = NeedsApproval and canManage[u])))
    or (i = Approve and t = DraftApproved
        and ((s = NeedsApproval and canManage[u])
             or (s = InReview and canManage[u] and canReview[u])))
    or (i = Reject and s in InReview + NeedsApproval and canManage[u] and t = Rejected) }
}

pred sameDraft { status' = status and versions' = versions }
pred sameTargets { tstatus' = tstatus and approvedBy' = approvedBy }
pred sameTargetsExcept[a: Account] {
  all b: Account - a | b.tstatus' = b.tstatus and b.approvedBy' = b.approvedBy
}
pred sameReqsExcept[r: lone Req] {
  all q: Req - r {
    q.pc' = q.pc
    q.intent' = q.intent
    q.by' = q.by
    q.snapStatus' = q.snapStatus
    q.target' = q.target
  }
}
pred advance[r: Req, to: Pc] {
  r.pc' = to
  r.intent' = r.intent
  r.by' = r.by
  r.snapStatus' = r.snapStatus
  r.target' = r.target
}
pred finish[r: Req] {
  r.pc' = Idle
  no r.intent'
  no r.by'
  no r.snapStatus'
  no r.target'
}
pred sameSeen { Ghost.seen' = Ghost.seen and Ghost.seenStatus' = Ghost.seenStatus }
pred sameDraftApprovals {
  Ghost.approvedCurrent' = Ghost.approvedCurrent
  Ghost.approvedOnScreen' = Ghost.approvedOnScreen
  Ghost.draftApprovers' = Ghost.draftApprovers
}
pred sameChapterApprovals {
  Ghost.chapterCurrent' = Ghost.chapterCurrent
  Ghost.chapterOnScreen' = Ghost.chapterOnScreen
  Ghost.unspent' = Ghost.unspent
}
pred sameSends {
  Ghost.sent' = Ghost.sent
  Ghost.sentAs' = Ghost.sentAs
  Ghost.doubleSend' = Ghost.doubleSend
  Ghost.resent' = Ghost.resent
}
pred sameHistory { sameSeen and sameDraftApprovals and sameChapterApprovals and sameSends }
pred log[e: Event, u: lone User, a: lone Account, i: lone Intent] {
  Ghost.event' = e
  Ghost.evUser' = u
  Ghost.evAccount' = a
  Ghost.evIntent' = i
}

fact init {
  Draft.status in Generating + InReview
  Draft.versions = first
  all a: Account | a.tstatus = NoRow and no a.approvedBy
  all r: Req | r.pc = Idle and no r.intent and no r.by and no r.snapStatus and no r.target
  no Ghost.seen
  no Ghost.seenStatus
  no Ghost.approvedCurrent
  no Ghost.approvedOnScreen
  no Ghost.draftApprovers
  no Ghost.chapterCurrent
  no Ghost.chapterOnScreen
  no Ghost.sent
  no Ghost.sentAs
  no Ghost.unspent
  no Ghost.doubleSend
  no Ghost.resent
  Ghost.event = EInit
  no Ghost.evUser
  no Ghost.evAccount
  no Ghost.evIntent
}

-- routes/drafts/detail.tsx loader: the page shows drafts.current_version and the buttons
-- that fit drafts.status; its forms carry no version
pred loadPage[u: User] {
  hasAccess[u]
  Ghost.seen' = Ghost.seen ++ u -> current
  Ghost.seenStatus' = Ghost.seenStatus ++ u -> Draft.status
  sameDraft and sameTargets and sameReqsExcept[none]
  sameDraftApprovals and sameChapterApprovals and sameSends
  log[ELoadPage, u, none, none]
}

-- drafts/draft.repository.server.ts appendVersion, called without a draft snapshot by
-- jobs/complete.server.ts saveVersion and live/generate.server.ts
pred systemSave {
  some next[current]
  versions' = versions + Draft -> next[current]
  Draft.status' in InReview + Generating
  sameTargets and sameReqsExcept[none] and sameHistory
  log[ESystemSave, none, none, none]
}

-- jobs/complete.server.ts releaseFailedFix
pred releaseFix {
  Draft.status = Generating
  Draft.status' = InReview
  versions' = versions
  sameTargets and sameReqsExcept[none] and sameHistory
  log[EReleaseFix, none, none, none]
}

-- drafts/detail.server.ts draftAction: getDraft, then the intent runs on that row
pred begin[r: Req, u: User, i: Intent, a: lone Account] {
  r.pc = Idle
  hasAccess[u]
  i in Approve + ReviewOk + RequestChanges + Reject + Edit + TargetApprove
  i = TargetApprove implies one a else no a
  r.pc' = Began
  r.intent' = i
  r.by' = u
  r.snapStatus' = Draft.status
  r.target' = a
  sameDraft and sameTargets and sameReqsExcept[r] and sameHistory
  log[EBegin, u, a, i]
}

-- drafts/review.server.ts reviewDraft -> setDraftStatus: UPDATE drafts ... WHERE status = <snapshot>
pred reviewCas[r: Req] {
  r.pc = Began
  r.intent in Approve + ReviewOk + RequestChanges + Reject
  one nextStatus[r.snapStatus, r.intent, r.by]
  Draft.status = r.snapStatus
  Draft.status' = nextStatus[r.snapStatus, r.intent, r.by]
  versions' = versions
  r.intent = Approve implies {
    Ghost.approvedCurrent' = Ghost.approvedCurrent + current
    Ghost.approvedOnScreen' = Ghost.approvedOnScreen + Ghost.seen[r.by]
    Ghost.draftApprovers' = Ghost.draftApprovers + r.by
    advance[r, Decided]
  } else {
    sameDraftApprovals
    finish[r]
  }
  sameTargets and sameReqsExcept[r]
  sameSeen and sameChapterApprovals and sameSends
  log[EReviewCas, r.by, none, r.intent]
}

pred reviewCasLost[r: Req] {
  r.pc = Began
  r.intent in Approve + ReviewOk + RequestChanges + Reject
  one nextStatus[r.snapStatus, r.intent, r.by]
  Draft.status != r.snapStatus
  finish[r]
  sameDraft and sameTargets and sameReqsExcept[r] and sameHistory
  log[EReviewCasLost, r.by, none, r.intent]
}

-- dispatch/dispatch.server.ts afterDraftApproval -> ensureTargets: INSERT OR IGNORE
pred ensureTargets[r: Req] {
  r.pc = Decided
  r.intent = Approve
  all a: Account {
    a.tstatus' = (a.tstatus = NoRow implies Pending else a.tstatus)
    a.approvedBy' = a.approvedBy
  }
  finish[r]
  sameDraft and sameReqsExcept[r] and sameHistory
  log[EEnsureTargets, r.by, none, r.intent]
}

-- drafts/review.server.ts editDraft -> appendVersion with statusAfterEdit(<snapshot>)
pred editSave[r: Req] {
  r.pc = Began
  r.intent = Edit
  some next[current]
  versions' = versions + Draft -> next[current]
  Draft.status' = (r.snapStatus = Rejected implies Rejected else InReview)
  finish[r]
  sameTargets and sameReqsExcept[r] and sameHistory
  log[EEditSave, r.by, none, r.intent]
}

-- dispatch/dispatch.server.ts approveTarget: snapshot check, canApproveTarget, then
-- moveTarget(["pending","failed"] -> "approved")
pred targetApproveCas[r: Req] {
  r.pc = Began
  r.intent = TargetApprove
  let a = r.target {
    r.snapStatus = DraftApproved
    canApproveTarget[r.by, a]
    a.tstatus in Pending + Failed
    a.tstatus' = TargetApproved
    a.approvedBy' = r.by
    sameTargetsExcept[a]
    Ghost.chapterCurrent' = Ghost.chapterCurrent + a -> current
    Ghost.chapterOnScreen' = Ghost.chapterOnScreen + a -> Ghost.seen[r.by]
    Ghost.unspent' = Ghost.unspent + a
    Item.kind = ConnpassMail implies finish[r] else advance[r, Decided]
    log[ETargetApproveCas, r.by, a, r.intent]
  }
  sameDraft and sameReqsExcept[r]
  sameSeen and sameDraftApprovals and sameSends
}

pred targetCasLost[r: Req] {
  r.pc = Began
  r.intent = TargetApprove
  r.snapStatus = DraftApproved
  canApproveTarget[r.by, r.target]
  r.target.tstatus not in Pending + Failed + NoRow
  log[ETargetCasLost, r.by, r.target, r.intent]
  finish[r]
  sameDraft and sameTargets and sameReqsExcept[r] and sameHistory
}

-- connpass/mail.server.ts sendDueMails -> dueMailTargets: one SELECT joining targets and drafts
pred mailCronRead[r: Req, a: Account] {
  r.pc = Idle
  Item.kind = ConnpassMail
  a.tstatus = TargetApproved
  Draft.status = DraftApproved
  r.pc' = Began
  r.intent' = MailCron
  r.by' = a.approvedBy
  no r.snapStatus'
  r.target' = a
  sameDraft and sameTargets and sameReqsExcept[r] and sameHistory
  log[EMailCronRead, a.approvedBy, a, MailCron]
}

pred readyToClaim[r: Req] {
  (r.intent = TargetApprove and r.pc = Decided) or (r.intent = MailCron and r.pc = Began)
}

-- dispatchTarget / sendDueMails: moveTarget(["approved"] -> "dispatching")
pred dispatchClaim[r: Req] {
  readyToClaim[r]
  let a = r.target {
    a.tstatus = TargetApproved
    a.tstatus' = Dispatching
    a.approvedBy' = a.approvedBy
    sameTargetsExcept[a]
    log[EDispatchClaim, r.by, a, r.intent]
  }
  advance[r, Claimed]
  sameDraft and sameReqsExcept[r] and sameHistory
}

pred claimLost[r: Req] {
  readyToClaim[r]
  r.target.tstatus != TargetApproved
  log[EClaimLost, r.by, r.target, r.intent]
  finish[r]
  sameDraft and sameTargets and sameReqsExcept[r] and sameHistory
}

-- dispatchTarget: latestVersion, then SNS.createScheduledPost as the approver.
-- sendDueMails: latestVersion, then CONNPASS.sendMessage as the approver snapshot.
pred send[r: Req] {
  r.pc = Claimed
  let a = r.target {
    Ghost.sent' = Ghost.sent + a -> current
    Ghost.sentAs' = Ghost.sentAs + a -> r.by
    Ghost.doubleSend' = (a in Ghost.unspent implies Ghost.doubleSend else Ghost.doubleSend + a)
    Ghost.unspent' = Ghost.unspent - a
    Ghost.resent' = (some a.(Ghost.sent) implies Ghost.resent + a else Ghost.resent)
    log[ESend, r.by, a, r.intent]
  }
  Ghost.chapterCurrent' = Ghost.chapterCurrent
  Ghost.chapterOnScreen' = Ghost.chapterOnScreen
  advance[r, Delivered]
  sameDraft and sameTargets and sameReqsExcept[r]
  sameSeen and sameDraftApprovals
}

-- moveTarget(["dispatching"] -> "scheduled")
pred finishScheduled[r: Req] {
  r.pc = Delivered
  let a = r.target {
    a.tstatus' = (a.tstatus = Dispatching implies Scheduled else a.tstatus)
    a.approvedBy' = a.approvedBy
    sameTargetsExcept[a]
    log[EFinishScheduled, r.by, a, r.intent]
  }
  finish[r]
  sameDraft and sameReqsExcept[r] and sameHistory
}

-- fail(): moveTarget(["dispatching"] -> "failed"), before the send or after an error reply
pred fail[r: Req] {
  r.pc in Claimed + Delivered
  let a = r.target {
    a.tstatus' = (a.tstatus = Dispatching implies Failed else a.tstatus)
    a.approvedBy' = a.approvedBy
    sameTargetsExcept[a]
    log[EFail, r.by, a, r.intent]
  }
  finish[r]
  sameDraft and sameReqsExcept[r] and sameHistory
}

-- dispatch/poll.server.ts pollScheduledPosts: moveTarget(["scheduled"] -> "failed").
-- connpass/poll.server.ts pollConnpassJobs: moveTarget(["scheduled","dispatching"] -> "failed")
-- once the connpass job exists, which is after the send.
pred pollFailed[a: Account] {
  a.tstatus = Scheduled
    or (Item.kind = ConnpassMail and a.tstatus = Dispatching
        and (some r: Req | r.target = a and r.pc = Delivered))
  a.tstatus' = Failed
  a.approvedBy' = a.approvedBy
  sameTargetsExcept[a]
  sameDraft and sameReqsExcept[none] and sameHistory
  log[EPollFailed, none, a, none]
}

-- A request that returns an error, or a Worker that stops, at any await
pred abort[r: Req] {
  r.pc != Idle
  log[EAbort, r.by, r.target, r.intent]
  finish[r]
  sameDraft and sameTargets and sameReqsExcept[r] and sameHistory
}

pred stutter {
  sameDraft and sameTargets and sameReqsExcept[none] and sameHistory
  log[EStutter, none, none, none]
}

fact transitions {
  always {
    stutter
    or systemSave
    or releaseFix
    or (some u: User | loadPage[u])
    or (some a: Account | pollFailed[a])
    or (some r: Req, u: User, i: Intent, a: Account | begin[r, u, i, a])
    or (some r: Req, u: User, i: Intent | begin[r, u, i, none])
    or (some r: Req, a: Account | mailCronRead[r, a])
    or (some r: Req {
      reviewCas[r] or reviewCasLost[r] or ensureTargets[r] or editSave[r]
      or targetApproveCas[r] or targetCasLost[r] or dispatchClaim[r] or claimLost[r]
      or send[r] or finishScheduled[r] or fail[r] or abort[r]
    })
  }
}

pred quiet { all r: Req | r.pc = Idle }

-- Requests do not overlap: once one begins, only its own steps happen until it ends.
pred serial {
  always (not quiet implies after Ghost.event in
    EReviewCas + EReviewCasLost + EEnsureTargets + EEditSave + ETargetApproveCas
    + ETargetCasLost + EDispatchClaim + EClaimLost + ESend + EFinishScheduled + EFail + EAbort)
}

-- People press only buttons that the page they last loaded showed them:
-- routes/drafts/detail.tsx canAct, dispatch/components/DeliveryCard.tsx view.dispatchable.
pred viaForms {
  always (Ghost.event' = EBegin implies {
    some Ghost.seen[Ghost.evUser']
    Ghost.evIntent' in Approve + ReviewOk + RequestChanges + Reject
      implies Ghost.seenStatus[Ghost.evUser'] in InReview + NeedsApproval
    Ghost.evIntent' = TargetApprove implies Ghost.seenStatus[Ghost.evUser'] = DraftApproved
  })
}

pred orderly { serial and viaForms }

-- Nothing is sent unless someone allowed to approve drafts approved this draft.
assert SendNeedsDraftApproval {
  always (some Ghost.sent implies some Ghost.draftApprovers)
  always (all u: Ghost.draftApprovers | canManage[u])
}

-- Every send for an account runs as a member of that account's chapter who approved it.
assert SendRunsAsChapterMember {
  always (all a: Account, u: a.(Ghost.sentAs) | a.chapter in u.chapters)
}

-- One approval of a target causes at most one send.
assert OneSendPerTargetApproval {
  always no Ghost.doubleSend
}

-- The version that goes out was the latest version when the draft was approved.
assert SentVersionWasApproved {
  viaForms implies always (Account.(Ghost.sent) in Ghost.approvedCurrent)
}

assert SentVersionWasApprovedWhenSerial {
  serial implies always (Account.(Ghost.sent) in Ghost.approvedCurrent)
}

-- The version that goes out for an account was the latest version when that account's
-- chapter approved the target.
assert SentVersionWasChapterApprovedInOrderlyUse {
  orderly implies always (Ghost.sent in Ghost.chapterCurrent)
}

-- The version that goes out was on the draft approver's screen when they approved.
assert DraftApproverSawSentVersionInOrderlyUse {
  orderly implies always (Account.(Ghost.sent) in Ghost.approvedOnScreen)
}

-- A version the draft approver did see, sent for an account, was also on that chapter
-- approver's screen when they approved the target.
assert ChapterApproverSawSentVersionInOrderlyUse {
  orderly implies always (all a: Account, v: a.(Ghost.sent) |
    v in Ghost.approvedOnScreen & a.(Ghost.chapterCurrent) implies v in a.(Ghost.chapterOnScreen))
}

-- Witnesses: the checks above must not hold only because nothing can be sent.
pred XPostGoesOut { Item.kind = XPost and eventually some Ghost.sent }
pred MailGoesOut { Item.kind = ConnpassMail and eventually some Ghost.sent }
pred ResendAfterFailure { eventually some Ghost.resent }

check SendNeedsDraftApproval
  for 3 but exactly 2 Chapter, exactly 3 User, exactly 2 Account, exactly 3 Version, exactly 2 Req, 14 steps
check SendRunsAsChapterMember
  for 3 but exactly 2 Chapter, exactly 3 User, exactly 2 Account, exactly 3 Version, exactly 2 Req, 14 steps
check OneSendPerTargetApproval
  for 3 but exactly 2 Chapter, exactly 3 User, exactly 2 Account, exactly 3 Version, exactly 2 Req, 14 steps
check SentVersionWasApproved
  for 3 but exactly 2 Chapter, exactly 3 User, exactly 2 Account, exactly 3 Version, exactly 2 Req, 14 steps
check SentVersionWasApprovedWhenSerial
  for 3 but exactly 2 Chapter, exactly 3 User, exactly 2 Account, exactly 3 Version, exactly 2 Req, 18 steps
check SentVersionWasChapterApprovedInOrderlyUse
  for 3 but exactly 2 Chapter, exactly 3 User, exactly 2 Account, exactly 3 Version, exactly 2 Req, 18 steps
check DraftApproverSawSentVersionInOrderlyUse
  for 3 but exactly 2 Chapter, exactly 3 User, exactly 2 Account, exactly 3 Version, exactly 2 Req, 18 steps
check ChapterApproverSawSentVersionInOrderlyUse
  for 3 but exactly 2 Chapter, exactly 3 User, exactly 2 Account, exactly 3 Version, exactly 2 Req, 18 steps
run XPostGoesOut
  for 3 but exactly 2 Chapter, exactly 3 User, exactly 2 Account, exactly 3 Version, exactly 2 Req, 14 steps
run MailGoesOut
  for 3 but exactly 2 Chapter, exactly 3 User, exactly 2 Account, exactly 3 Version, exactly 2 Req, 14 steps
run ResendAfterFailure
  for 3 but exactly 2 Chapter, exactly 3 User, exactly 2 Account, exactly 3 Version, exactly 2 Req, 16 steps
