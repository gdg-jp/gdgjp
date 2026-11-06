import type { PrActor } from "@gdgjp/gdg-lib";
import { latestBrief } from "~/features/briefs/brief.repository.server";
import type { CampaignAccess } from "~/features/campaigns/access.server";
import type { Campaign } from "~/features/campaigns/campaign";
import { pageApprovalBlockers } from "~/features/connpass/page.server";
import type { Draft } from "~/features/drafts/draft";
import { latestVersion } from "~/features/drafts/draft.repository.server";
import { actorOf, callRpc, snsService } from "~/features/integrations/bindings.server";
import { ensureShortlink } from "~/features/links/create.server";
import { withShortlink } from "~/features/links/slug";
import { listingApprovalBlockers } from "~/features/listings/listing.server";
import type { ScheduleItem } from "~/features/schedule/item";
import { getItem, transitionItem } from "~/features/schedule/item.repository.server";
import { type DeliverablePost, approvalBlockers, deliverablePost, isoAt } from "./content";
import { logDispatch } from "./log.server";
import { canApproveTarget, isDispatchKind, rollupItemStatus, targetAccountKind } from "./target";
import { ensureTargets, getTarget, listTargets, moveTarget } from "./target.repository.server";

export type DispatchResult = { ok: true; message: string } | { ok: false; error: string };

async function deliverable(env: Env, draft: Draft) {
  const version = await latestVersion(env.DB, draft.id);
  return deliverablePost(version?.content ?? null);
}

const fallbackUrl = async (env: Env, campaignId: number) =>
  (await latestBrief(env.DB, campaignId))?.brief.event.connpassUrl ?? null;

/**
 * Before a draft is approved: refuse an OGP post without its image, and create the short
 * link now (as the approver) so a tinyurl failure stops the approval instead of the post.
 */
export async function prepareDraftApproval(
  env: Env,
  access: CampaignAccess,
  draft: Draft,
): Promise<{ ok: true } | { ok: false; errors: string[] }> {
  const connpass = [
    ...pageApprovalBlockers(access, draft),
    ...(await listingApprovalBlockers(env, access, draft)),
  ];
  if (connpass.length) return { ok: false, errors: connpass };
  if (!draft.scheduleItemId) return { ok: true };
  const post = await deliverable(env, draft);
  const fallback = await fallbackUrl(env, access.campaign.id);
  const blockers = approvalBlockers(post, fallback, draft.dispatchMediaUrl);
  if (blockers.length) return { ok: false, errors: blockers };
  const item = await getItem(env.DB, access.campaign.id, draft.scheduleItemId);
  if (post && item && post.text.includes("{{shortlink}}")) {
    const link = await ensureShortlink(env, actorOf(access), access.campaign, item, post, fallback);
    if (!link.ok) return { ok: false, errors: [link.error] };
  }
  return { ok: true };
}

/** After approval: one dispatch target per X account, each waiting for its chapter's approval. */
export async function afterDraftApproval(env: Env, campaign: Campaign, draft: Draft) {
  if (!draft.scheduleItemId || !isDispatchKind(draft.kind)) return;
  await ensureTargets(env.DB, campaign.id, draft.scheduleItemId, targetAccountKind(draft.kind));
}

export async function rollup(env: Env, itemId: number) {
  const status = rollupItemStatus((await listTargets(env.DB, itemId)).map((t) => t.status));
  if (status)
    await transitionItem(
      env.DB,
      itemId,
      ["approved", "dispatching", "scheduled", "failed"],
      status,
    );
}

/**
 * The account's chapter approves its target, and the post is scheduled on sns as that person.
 * Pressing twice, or two people at once, schedules one post: pending → approved and
 * approved → dispatching are both compare-and-set.
 */
export async function approveTarget(
  env: Env,
  access: CampaignAccess,
  draft: Draft,
  targetId: number,
): Promise<DispatchResult> {
  if (draft.status !== "approved") return { ok: false, error: "下書きを先に承認してください" };
  const target = await getTarget(env.DB, targetId);
  if (!target || target.scheduleItemId !== draft.scheduleItemId)
    return { ok: false, error: "配信先が見つかりません" };
  const viewer = {
    chapters: access.chapters,
    isMember: access.members.some((m) => m.userId === access.user.id),
    isAdmin: access.user.isAdmin,
  };
  if (!canApproveTarget(target.account, viewer))
    return {
      ok: false,
      error: `${target.account.label} はそのチャプターのメンバーだけが承認できます`,
    };
  const actor = actorOf(access);
  const approved = await moveTarget(env.DB, target.id, ["pending", "failed"], "approved", {
    approvedBy: access.user.id,
    actorSnapshot: JSON.stringify(actor),
    error: null,
  });
  if (!approved) return { ok: true, message: "この配信先はもう処理されています" };
  // A mail goes out at its time (Tips 10), never on approval: the minute cron sends it.
  if (draft.kind === "connpass_mail")
    return {
      ok: true,
      message: `${target.account.label} への送信を承認しました。予定の時刻に送ります`,
    };
  return dispatchTarget(env, access.campaign, draft, target.id, actor);
}

async function dispatchTarget(
  env: Env,
  campaign: Campaign,
  draft: Draft,
  targetId: number,
  actor: PrActor,
): Promise<DispatchResult> {
  if (!(await moveTarget(env.DB, targetId, ["approved"], "dispatching")))
    return { ok: true, message: "この配信先はもう配信中です" };
  const target = await getTarget(env.DB, targetId);
  const item = draft.scheduleItemId
    ? await getItem(env.DB, campaign.id, draft.scheduleItemId)
    : null;
  const post = await deliverable(env, draft);
  const fail = async (error: string) => {
    await moveTarget(env.DB, targetId, ["dispatching"], "failed", { error });
    if (item) await rollup(env, item.id);
    return { ok: false as const, error };
  };
  if (!target || !item || !post) return fail("配信する本文がありません");
  const text = await textForDelivery(env, actor, campaign, item, post);
  if (!text.ok) return fail(text.error);
  const created = await callRpc(() =>
    snsService(env).createScheduledPost({
      actor,
      chapterId: target.account.chapterId,
      xAccountId: target.account.externalId,
      text: text.text,
      scheduledAt: isoAt(item.dueAt),
      condition:
        item.kind === "live_post" && item.purpose === "photo" ? "photo_required" : "scheduled",
    }),
  );
  await logDispatch(env.DB, {
    campaignId: campaign.id,
    itemId: item.id,
    action: "sns_create",
    ok: created.ok,
    detail: created.ok
      ? `${target.account.label}: ${created.post.id}`
      : `${target.account.label}: ${created.code} ${created.message ?? ""}`,
  });
  if (!created.ok) return fail(`sns に予約できませんでした（${created.code}）`);
  if (draft.dispatchMediaUrl)
    await attachImage(
      env,
      actor,
      campaign,
      item,
      target.account.chapterId,
      created.post.id,
      draft.dispatchMediaUrl,
    );
  await moveTarget(env.DB, targetId, ["dispatching"], "scheduled", {
    externalRef: { snsPostId: created.post.id },
    error: null,
  });
  await transitionItem(env.DB, item.id, ["approved", "failed"], "dispatching");
  await rollup(env, item.id);
  return { ok: true, message: `${target.account.label} に予約しました` };
}

/** `{{shortlink}}` → the item's short link, on a copy (the draft version is never rewritten). */
async function textForDelivery(
  env: Env,
  actor: PrActor,
  campaign: Campaign,
  item: ScheduleItem,
  post: DeliverablePost,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  if (!post.text.includes("{{shortlink}}")) return { ok: true, text: post.text };
  const link = await ensureShortlink(
    env,
    actor,
    campaign,
    item,
    post,
    await fallbackUrl(env, campaign.id),
  );
  return link.ok ? { ok: true, text: withShortlink(post.text, link.link.shortUrl) } : link;
}

async function attachImage(
  env: Env,
  actor: PrActor,
  campaign: Campaign,
  item: ScheduleItem,
  chapterId: number,
  postId: string,
  url: string,
) {
  let detail = url;
  let ok = false;
  try {
    const response = await fetch(url);
    const contentType = response.headers.get("content-type") ?? "";
    if (response.ok && contentType.startsWith("image/")) {
      const bytes = await response.arrayBuffer();
      const attached = await callRpc(() =>
        snsService(env).attachMedia({ actor, chapterId, postId, bytes, contentType, sortOrder: 0 }),
      );
      ok = attached.ok;
      if (!attached.ok) detail = attached.code;
    } else detail = `image fetch ${response.status} ${contentType}`;
  } catch (error) {
    detail = error instanceof Error ? error.message : "image fetch failed";
  }
  await logDispatch(env.DB, {
    campaignId: campaign.id,
    itemId: item.id,
    action: "sns_media",
    ok,
    detail,
  });
}

/** Nobody in that chapter can approve: the target becomes a request item for them. */
export async function skipTarget(
  env: Env,
  access: CampaignAccess,
  draft: Draft,
  targetId: number,
  to: "skipped" | "delegated",
): Promise<{ ok: true; targetLabel: string } | { ok: false; error: string }> {
  const target = await getTarget(env.DB, targetId);
  if (!target || target.scheduleItemId !== draft.scheduleItemId || !access.permissions.edit)
    return { ok: false, error: "配信先が見つかりません" };
  if (!(await moveTarget(env.DB, target.id, ["pending", "failed"], to)))
    return { ok: false, error: "この配信先はもう処理されています" };
  await rollup(env, target.scheduleItemId);
  return { ok: true, targetLabel: target.account.label };
}
