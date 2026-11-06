import { validateSchema } from "@skills/pr-playbook/scripts/checks/index.mjs";
import { latestBrief } from "~/features/briefs/brief.repository.server";
import type { CampaignAccess } from "~/features/campaigns/access.server";
import { SKILL_FOR_KIND } from "~/features/jobs/skill-kinds";
import { recordEdits } from "~/features/learning/edits.server";
import { type ConnpassPageContent, withRenderedHtml } from "~/features/pages/render";
import { connpassSectionTemplates, outputSchemas } from "~/features/playbook/guides.server";
import {
  type DraftKind as CheckKind,
  PLAYBOOK_VERSION,
  runChecks,
} from "~/features/playbook/playbook";
import type { Draft } from "./draft";
import { DRAFT_KINDS } from "./draft-kinds";
import { addReview, appendVersion, latestVersion, setDraftStatus } from "./draft.repository.server";
import {
  type Actor,
  type ReviewAction,
  itemStatusFor,
  nextStatus,
  statusAfterEdit,
} from "./state-machine";

/** Who may review and approve this draft. */
export function actorFor(access: CampaignAccess, draft: Draft): Actor {
  const me = access.members.find((m) => m.userId === access.user.id);
  const canApprove = access.permissions.manage;
  const canReview =
    canApprove ||
    draft.reviewerUserId === access.user.id ||
    (draft.reviewerUserId === null &&
      !!me &&
      (me.roles.includes("reviewer") || me.roles.includes("lead")));
  return { canReview, canApprove };
}

export async function reviewDraft(
  db: D1Database,
  access: CampaignAccess,
  draft: Draft,
  action: Exclude<ReviewAction, "submit">,
  comment: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const to = nextStatus(draft.status, action, actorFor(access, draft));
  if (!to)
    return {
      ok: false,
      error: "この状態からはその操作ができません（権限か状態を確認してください）",
    };
  const changed = await setDraftStatus(db, draft.id, draft.status, to, itemStatusFor(to), {
    reviewedBy:
      action === "review_ok" || (action === "request_changes" && draft.status === "in_review")
        ? access.user.id
        : undefined,
    approvedBy: action === "approve" ? access.user.id : undefined,
  });
  if (!changed) return { ok: false, error: "ほかの人が先に更新しました。再読み込みしてください" };
  await addReview(db, {
    draftId: draft.id,
    version: draft.currentVersion,
    userId: access.user.id,
    decision:
      action === "request_changes" ? "request_changes" : action === "reject" ? "reject" : "approve",
    stage: action === "review_ok" || draft.status === "in_review" ? "review" : "approval",
    comment,
  });
  return { ok: true };
}

/**
 * A person's edit: validate against the Skill schema, check against the Playbook, append a
 * human version (never update the agent's), and send the draft back to review.
 */
export async function editDraft(
  db: D1Database,
  access: CampaignAccess,
  draft: Draft,
  content: unknown,
): Promise<{ ok: true; version: number } | { ok: false; errors: string[] }> {
  const skill = SKILL_FOR_KIND[draft.kind];
  const schema = skill ? outputSchemas[skill] : undefined;
  // A connpass page carries what the Worker added (skin, html): validate the slots only.
  const slots =
    draft.kind === "connpass_page" && content && typeof content === "object"
      ? (({ html: _h, skin: _s, renderWarnings: _w, ...rest }) => rest)(
          content as Record<string, unknown>,
        )
      : content;
  if (schema) {
    const errors = validateSchema(schema, slots);
    if (errors.length) return { ok: false, errors };
  }
  const brief = (await latestBrief(db, access.campaign.id))?.brief ?? null;
  const saved =
    draft.kind === "connpass_page"
      ? withRenderedHtml(slots as ConnpassPageContent, brief, connpassSectionTemplates)
      : content;
  const checkable = (DRAFT_KINDS as readonly string[]).includes(draft.kind);
  const report = checkable
    ? runChecks({ kind: draft.kind as CheckKind, draft: saved, brief })
    : { results: [] };
  const status = statusAfterEdit(draft.status);
  const previous = await latestVersion(db, draft.id);
  const version = await appendVersion(db, draft.id, {
    author: "human",
    userId: access.user.id,
    jobId: null,
    content: saved,
    playbookVersion: PLAYBOOK_VERSION,
    checkResults: report.results,
    status,
    itemStatus: itemStatusFor(status),
  });
  if (previous)
    await recordEdits(db, {
      campaignId: access.campaign.id,
      draftId: draft.id,
      fromVersion: previous.version,
      toVersion: version,
      kind: draft.kind,
      before: previous.content,
      after: saved,
      beforeChecks: previous.checkResults,
      afterChecks: report.results,
      userId: access.user.id,
    });
  return { ok: true, version };
}

export async function currentContent(db: D1Database, draft: Draft): Promise<unknown> {
  return (await latestVersion(db, draft.id))?.content ?? null;
}
