#!/usr/bin/env node
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyAlloySkill } from "../../../../scripts/verification/alloy-skill.mjs";

const mutations = [
  {
    id: "approve-without-manage",
    kills: "SendNeedsDraftApproval",
    code: 'state-machine.ts nextStatus: drop actor.canApprove from the "approve" case',
    find: "and ((s = NeedsApproval and canManage[u])\n             or (s = InReview and canManage[u] and canReview[u])))",
    replace: "and (s = NeedsApproval or s = InReview))",
  },
  {
    id: "target-approve-without-chapter-check",
    kills: "SendRunsAsChapterMember",
    code: "dispatch.server.ts approveTarget: drop the canApproveTarget check",
    find: "    canApproveTarget[r.by, a]\n    a.tstatus in Pending + Failed",
    replace: "    a.tstatus in Pending + Failed",
  },
  {
    id: "claim-without-compare-and-swap",
    kills: "OneSendPerTargetApproval",
    code: 'dispatch.server.ts / mail.server.ts: ignore the result of moveTarget(["approved"] -> "dispatching")',
    find: "    a.tstatus = TargetApproved\n    a.tstatus' = Dispatching",
    replace: "    a.tstatus' = Dispatching",
  },
  {
    id: "target-approve-ignores-draft-status",
    kills: "SentVersionWasApprovedWhenSerial",
    code: 'dispatch.server.ts approveTarget: drop the draft.status !== "approved" check',
    find: "    r.snapStatus = DraftApproved\n    canApproveTarget[r.by, a]",
    replace: "    canApproveTarget[r.by, a]",
  },
  {
    id: "mail-cron-ignores-draft-status",
    kills: "SentVersionWasApprovedWhenSerial",
    code: "target.repository.server.ts dueMailTargets: drop d.status = 'approved' from the join",
    find: "  a.tstatus = TargetApproved\n  Draft.status = DraftApproved\n",
    replace: "  a.tstatus = TargetApproved\n",
  },
];

const label = (atom) => atom?.replace(/0$/, "") ?? null;
const DRAFT_STATUS = {
  Generating: "generating",
  Drafting: "drafting",
  InReview: "in_review",
  NeedsApproval: "needs_approval",
  DraftApproved: "approved",
  Rejected: "rejected",
};
const TARGET_STATUS = {
  NoRow: "no row",
  Pending: "pending",
  TargetApproved: "approved",
  Dispatching: "dispatching",
  Scheduled: "scheduled",
  Failed: "failed",
};
const BUTTON = {
  Approve: "承認 (approve the draft)",
  ReviewOk: "レビュー OK",
  RequestChanges: "差し戻す (request changes)",
  Reject: "却下 (reject)",
  Edit: "an edit of the draft",
  TargetApprove: "the approve button of a dispatch target",
};

function view(state) {
  const ghost = state.Ghost0;
  const first = state["ordering/Ord0"].First[0][0];
  const next = Object.fromEntries(state["ordering/Ord0"].Next);
  const order = [];
  for (let v = first; v; v = next[v]) order.push(v);
  const version = (atom) => `version ${order.indexOf(atom) + 1}`;
  const versions = state.Draft0.versions.map(([v]) => v);
  const current = order.findLast((v) => versions.includes(v));
  const accounts = Object.keys(state).filter((atom) => /^Account\d+$/.test(atom));
  const users = Object.keys(state).filter((atom) => /^User\d+$/.test(atom));
  const set = (field) => ghost[field].map((tuple) => tuple.join(">"));
  const has = (field, ...tuple) => set(field).includes(tuple.join(">"));
  const campaign = state.Campaign0;
  const inField = (field, user) => campaign[field].some(([u]) => u === user);
  const organizes = (user, chapter) => state[user].organizes.some(([c]) => c === chapter);
  const host = campaign.host[0][0];
  const canManage = (user) =>
    inField("admins", user) || organizes(user, host) || inField("leads", user);
  return {
    ghost,
    version,
    current,
    accounts,
    users,
    has,
    set,
    canManage,
    host,
    event: label(ghost.event[0][0]),
    user: ghost.evUser[0]?.[0] ?? null,
    account: ghost.evAccount[0]?.[0] ?? null,
    intent: label(ghost.evIntent[0]?.[0]),
    draftStatus: DRAFT_STATUS[label(state.Draft0.status[0][0])],
    targetStatus: (account) => TARGET_STATUS[label(state[account].tstatus[0][0])],
    chapterOf: (account) => state[account].chapter[0][0],
    sent: ghost.sent,
    sentAs: ghost.sentAs,
  };
}

const violations = {
  SendNeedsDraftApproval: (s) => {
    if (s.sent.length && !s.ghost.draftApprovers.length) {
      return "Something was sent although nobody approved the draft.";
    }
    const outsider = s.ghost.draftApprovers.find(([u]) => !s.canManage(u));
    return outsider
      ? `${outsider[0]} approved the draft without being lead, host organizer, or admin.`
      : null;
  },
  SendRunsAsChapterMember: (s) => {
    const bad = s.sentAs.find(([a, u]) => !s.memberOf(u, s.chapterOf(a)));
    return bad
      ? `${bad[0]} belongs to ${s.chapterOf(bad[0])}, but the send ran as ${bad[1]}, who is not in that chapter.`
      : null;
  },
  OneSendPerTargetApproval: (s) =>
    s.ghost.doubleSend.length
      ? `${s.ghost.doubleSend[0][0]} was sent twice on one target approval.`
      : null,
  SentVersionWasApproved: (s) => {
    const bad = s.sent.find(([, v]) => !s.has("approvedCurrent", v));
    return bad
      ? `${s.version(bad[1])} went out through ${bad[0]}, but the draft was never approved while ${s.version(bad[1])} was the latest version.`
      : null;
  },
  SentVersionWasChapterApprovedInOrderlyUse: (s) => {
    const bad = s.sent.find(([a, v]) => !s.has("chapterCurrent", a, v));
    return bad
      ? `${s.version(bad[1])} went out through ${bad[0]}, but ${s.chapterOf(bad[0])} approved that target when an earlier version was the latest.`
      : null;
  },
  DraftApproverSawSentVersionInOrderlyUse: (s) => {
    const bad = s.sent.find(([, v]) => !s.has("approvedOnScreen", v));
    return bad
      ? `${s.version(bad[1])} went out through ${bad[0]}, but the person who approved the draft had another version on screen.`
      : null;
  },
  ChapterApproverSawSentVersionInOrderlyUse: (s) => {
    const bad = s.sent.find(
      ([a, v]) =>
        s.has("approvedOnScreen", v) &&
        s.has("chapterCurrent", a, v) &&
        !s.has("chapterOnScreen", a, v),
    );
    return bad
      ? `${s.version(bad[1])} went out through ${bad[0]}, but the ${s.chapterOf(bad[0])} member who approved that target had another version on screen.`
      : null;
  },
};
violations.SentVersionWasApprovedWhenSerial = violations.SentVersionWasApproved;

function narrate(states, name) {
  const first = states[0];
  const start = view(first);
  const memberOf = (user, chapter) => first[user].chapters.some(([c]) => c === chapter);
  const campaign = first.Campaign0;
  const lines = [
    `  Setting: a ${label(first.Item0.kind[0][0]) === "XPost" ? "X post" : "connpass mail"} item. Host chapter ${start.host}; co-hosts ${campaign.cohosts.map(([c]) => c).join(", ") || "none"}.`,
  ];
  for (const user of start.users) {
    const roles = ["leads", "reviewers", "admins"]
      .filter((field) => campaign[field].some(([u]) => u === user))
      .map((field) => field.replace(/s$/, ""));
    const chapters = first[user].chapters.map(
      ([c]) => `${c}${first[user].organizes.some(([o]) => o === c) ? " (organizer)" : ""}`,
    );
    lines.push(
      `    ${user}: ${chapters.join(", ") || "no chapter"}${roles.length ? `; ${roles.join(", ")}` : ""}${start.canManage(user) ? "; may approve drafts" : ""}`,
    );
  }
  for (const account of start.accounts) {
    lines.push(`    ${account}: owned by ${start.chapterOf(account)}`);
  }
  const check = violations[name];
  let step = 0;
  for (let index = 1; index < states.length; index++) {
    const before = view(states[index - 1]);
    const s = view(states[index]);
    s.memberOf = memberOf;
    const a = s.account;
    const sentences = {
      LoadPage: `${s.user} opens the draft page. It shows ${s.version(s.current)}; the draft is ${s.draftStatus}.`,
      SystemSave: `The runner (or live-post generation) saves ${s.version(s.current)}. The draft is now ${s.draftStatus}.`,
      ReleaseFix: "A failed fix job is released. The draft goes from generating to in_review.",
      Begin: `${s.user} submits ${BUTTON[s.intent]}${a ? ` for ${a}` : ""}. The Worker reads the draft row: ${s.draftStatus}.`,
      ReviewCas: `${s.user}'s ${BUTTON[s.intent]} is written: the draft goes ${before.draftStatus} -> ${s.draftStatus} while the latest version is ${s.version(s.current)}.`,
      ReviewCasLost: `${s.user}'s request finds the draft status changed and writes nothing.`,
      EnsureTargets: "Dispatch targets are created as pending for accounts that had none.",
      EditSave: `${s.user}'s edit is saved as ${s.version(s.current)}. The draft is now ${s.draftStatus}.`,
      TargetApproveCas: a
        ? `${s.user} approves the target for ${a} (${s.chapterOf(a)}): ${before.targetStatus(a)} -> approved.`
        : "",
      TargetCasLost: `${s.user}'s target approval finds the target already handled and writes nothing.`,
      MailCronRead: `The mail cron finds the target for ${a} approved and the draft approved. It will send as ${s.user}.`,
      DispatchClaim: `The target for ${a} is claimed: approved -> dispatching.`,
      ClaimLost: `The claim for ${a} finds the target no longer approved and stops.`,
      Send: `The Worker reads the latest version and sends ${s.version(s.current)} through ${a} as ${s.user}.`,
      FinishScheduled: `The target for ${a} is marked scheduled.`,
      Fail: `The send for ${a} is recorded as failed. The target can be approved again.`,
      PollFailed: `sns reports the scheduled post for ${a} as failed. The target can be approved again.`,
      Abort: `${s.user ?? "The cron"}'s request stops without another write.`,
    };
    const sentence = sentences[s.event.slice(1)];
    if (sentence) lines.push(`  ${++step}. ${sentence}`);
    const reason = check?.(s);
    if (reason) {
      lines.push(`  => ${reason}`);
      return lines;
    }
  }
  return lines;
}

await verifyAlloySkill({
  skill: dirname(dirname(fileURLToPath(import.meta.url))),
  id: "pr-approval",
  model: "model/approval.als",
  mutations,
  narrate,
});
