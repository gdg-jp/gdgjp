import type { PrActor } from "@gdgjp/gdg-lib";
import type { CampaignAccess } from "~/features/campaigns/access.server";
import type { Campaign } from "~/features/campaigns/campaign";
import { getCampaignById } from "~/features/campaigns/campaign.repository.server";
import { pageApprovalBlockers } from "~/features/connpass/page.server";
import { type Draft, approvedForSending } from "~/features/drafts/draft";
import { getDraft, getVersion } from "~/features/drafts/draft.repository.server";
import { STALE_VERSION } from "~/features/drafts/review.server";
import { actorOf, callRpc, parseActor, snsService } from "~/features/integrations/bindings.server";
import { NO_CONTENT, approvedVersionText, fallbackUrl } from "~/features/links/create.server";
import type { ApprovedLinkVersion } from "~/features/links/link";
import { listingApprovalBlockers } from "~/features/listings/listing.server";
import type { ScheduleItem } from "~/features/schedule/item";
import { getItem, transitionItem } from "~/features/schedule/item.repository.server";
import { approvalBlockers, deliverablePost, isoAt } from "./content";
import { logDispatch } from "./log.server";
import { canApproveTarget, isDispatchKind, rollupItemStatus, targetAccountKind } from "./target";
import {
  type ApprovedVersion,
  approveTargetVersion,
  claimApprovedTarget,
  ensureTargets,
  getTarget,
  listTargets,
  moveTarget,
  unclaimedPostTargets,
} from "./target.repository.server";

export type DispatchResult = { ok: true; message: string } | { ok: false; error: string };

export async function draftApprovalBlockers(
  env: Env,
  access: CampaignAccess,
  draft: Draft,
  version: number,
): Promise<string[]> {
  if (version !== draft.currentVersion) return [STALE_VERSION];
  const connpass = [
    ...pageApprovalBlockers(access, draft),
    ...(await listingApprovalBlockers(env, access, draft)),
  ];
  if (connpass.length || !draft.scheduleItemId) return connpass;
  const saved = await getVersion(env.DB, draft.id, version);
  return approvalBlockers(deliverablePost(saved?.content ?? null), {
    fallbackUrl: await fallbackUrl(env.DB, access.campaign.id),
    mediaUrl: saved?.mediaUrl ?? null,
    tinyurlActive: access.campaign.tinyurlCampaignId !== null,
  });
}

export async function afterDraftApproval(
  env: Env,
  access: CampaignAccess,
  draft: Draft,
  approved: ApprovedLinkVersion,
): Promise<string | null> {
  if (!draft.scheduleItemId) return null;
  if (isDispatchKind(draft.kind))
    await ensureTargets(
      env.DB,
      access.campaign.id,
      draft.scheduleItemId,
      targetAccountKind(draft.kind),
    );
  const item = await getItem(env.DB, access.campaign.id, draft.scheduleItemId);
  if (!item) return null;
  const text = await approvedVersionText(env, actorOf(access), access.campaign, item, approved);
  return text.ok || text.error === NO_CONTENT ? null : text.error;
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

export async function approveTarget(
  env: Env,
  access: CampaignAccess,
  draft: Draft,
  targetId: number,
  version: number,
): Promise<DispatchResult> {
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
  const at = { targetId: target.id, draftId: draft.id, version };
  const approved = await approveTargetVersion(env.DB, at, {
    userId: access.user.id,
    actorSnapshot: JSON.stringify(actor),
  });
  if (!approved) return refusal(env, access, draft.id, at);
  if (draft.kind === "connpass_mail")
    return {
      ok: true,
      message: `${target.account.label} への送信を版 ${version} で承認しました。予定の時刻に送ります`,
    };
  return dispatchTarget(env, access.campaign, at, actor);
}

async function refusal(
  env: Env,
  access: CampaignAccess,
  draftId: number,
  at: ApprovedVersion,
): Promise<DispatchResult> {
  const now = await getDraft(env.DB, access.campaign.id, draftId);
  if (!now || now.currentVersion !== at.version) return { ok: false, error: STALE_VERSION };
  if (!approvedForSending(now)) return { ok: false, error: "下書きを先に承認してください" };
  return { ok: true, message: "この配信先はもう処理されています" };
}

async function dispatchTarget(
  env: Env,
  campaign: Campaign,
  at: ApprovedVersion,
  actor: PrActor,
): Promise<DispatchResult> {
  const claimed = await claimApprovedTarget(env.DB, at);
  if (!claimed) {
    const now = await getDraft(env.DB, campaign.id, at.draftId);
    return now?.currentVersion === at.version && approvedForSending(now)
      ? { ok: true, message: "この配信先はもう配信中です" }
      : { ok: false, error: STALE_VERSION };
  }
  return sendClaimedPost(env, campaign, at.targetId, claimed, actor);
}

export async function sendApprovedPosts(env: Env): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  for (const target of await unclaimedPostTargets(env.DB)) {
    const claimed = await claimApprovedTarget(env.DB, target.at);
    if (!claimed) continue;
    const campaign = await getCampaignById(env.DB, target.account.campaignId);
    const actor = parseActor(target.actorSnapshot);
    const result =
      campaign && actor
        ? await sendClaimedPost(env, campaign, target.id, claimed, actor)
        : await withoutActor(env, target.account.campaignId, target.scheduleItemId, target.id);
    if (result.ok) sent++;
    else failed++;
  }
  return { sent, failed };
}

async function withoutActor(env: Env, campaignId: number, itemId: number, targetId: number) {
  await logDispatch(env.DB, {
    campaignId,
    itemId,
    action: "sns_create",
    ok: false,
    detail: "no_actor",
  });
  return failClaimed(env, targetId, itemId, "承認者の情報がありません");
}

async function failClaimed(
  env: Env,
  targetId: number,
  itemId: number | null,
  error: string,
): Promise<DispatchResult> {
  await moveTarget(env.DB, targetId, ["dispatching"], "failed", { error });
  if (itemId !== null) await rollup(env, itemId);
  return { ok: false, error };
}

async function sendClaimedPost(
  env: Env,
  campaign: Campaign,
  targetId: number,
  claimed: ApprovedLinkVersion,
  actor: PrActor,
): Promise<DispatchResult> {
  const target = await getTarget(env.DB, targetId);
  const item = target ? await getItem(env.DB, campaign.id, target.scheduleItemId) : null;
  const fail = (error: string) => failClaimed(env, targetId, item?.id ?? null, error);
  if (!target || !item) return fail(NO_CONTENT);
  const text = await approvedVersionText(env, actor, campaign, item, claimed);
  if (!text.ok) return fail(text.error);
  const mediaUrl = (await getVersion(env.DB, claimed.draftId, claimed.version))?.mediaUrl ?? null;
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
  if (mediaUrl)
    await attachImage(
      env,
      actor,
      campaign,
      item,
      target.account.chapterId,
      created.post.id,
      mediaUrl,
    );
  await moveTarget(env.DB, targetId, ["dispatching"], "scheduled", {
    externalRef: { snsPostId: created.post.id },
    error: null,
  });
  await transitionItem(env.DB, item.id, ["approved", "failed"], "dispatching");
  await rollup(env, item.id);
  return { ok: true, message: `${target.account.label} に予約しました` };
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
