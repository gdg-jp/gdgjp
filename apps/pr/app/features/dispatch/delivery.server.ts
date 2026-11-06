import type { CampaignAccess } from "~/features/campaigns/access.server";
import type { Draft } from "~/features/drafts/draft";
import { latestVersion, setDispatchMedia } from "~/features/drafts/draft.repository.server";
import { currentContent, editDraft } from "~/features/drafts/review.server";
import { linkForItem } from "~/features/links/link.repository.server";
import { getItem } from "~/features/schedule/item.repository.server";
import { deliverablePost, jstLabel } from "./content";
import { delegateTarget } from "./delegate.server";
import { approveTarget, skipTarget } from "./dispatch.server";
import { TARGET_STATUS_LABELS, canApproveTarget, isDispatchKind } from "./target";
import { listTargets } from "./target.repository.server";

export type DeliveryView = {
  dispatchable: boolean;
  at: string | null;
  shortUrl: string | null;
  linkUrl: string | null;
  ogImage: string | null;
  attachmentKind: string;
  mediaUrl: string | null;
  targets: {
    id: number;
    label: string;
    status: string;
    statusLabel: string;
    canApprove: boolean;
    error: string | null;
    snsPostId: string | null;
    publishedXPostId: string | null;
  }[];
};

export async function deliveryView(
  env: Env,
  access: CampaignAccess,
  draft: Draft,
): Promise<DeliveryView | null> {
  if (!draft.scheduleItemId || !isDispatchKind(draft.kind)) return null;
  const item = await getItem(env.DB, access.campaign.id, draft.scheduleItemId);
  if (!item) return null;
  const post = deliverablePost((await latestVersion(env.DB, draft.id))?.content ?? null);
  const viewer = {
    chapters: access.chapters,
    isMember: access.members.some((m) => m.userId === access.user.id),
    isAdmin: access.user.isAdmin,
  };
  const link = await linkForItem(env.DB, item.id);
  return {
    dispatchable: draft.status === "approved",
    at: jstLabel(item.dueAt),
    shortUrl: link?.shortUrl ?? null,
    linkUrl: post?.linkUrl ?? null,
    ogImage: post?.ogImage ?? null,
    attachmentKind: post?.attachmentKind ?? "none",
    mediaUrl: draft.dispatchMediaUrl,
    targets: (await listTargets(env.DB, item.id)).map((t) => ({
      id: t.id,
      label: t.account.label,
      status: t.status,
      statusLabel: TARGET_STATUS_LABELS[t.status],
      canApprove: canApproveTarget(t.account, viewer),
      error: t.error,
      snsPostId: t.externalRef?.snsPostId ?? null,
      publishedXPostId: t.externalRef?.publishedXPostId ?? null,
    })),
  };
}

type Result = { ok: boolean; message?: string; errors?: string[] };
const fromDispatch = (r: { ok: true; message: string } | { ok: false; error: string }): Result =>
  r.ok ? { ok: true, message: r.message } : { ok: false, errors: [r.error] };

/** The delivery forms on the draft page (`intent` starts with `target-`, or `link`, `media`). */
export async function deliveryAction(
  env: Env,
  access: CampaignAccess,
  draft: Draft,
  intent: string,
  form: FormData,
): Promise<Result | null> {
  const targetId = Number(form.get("target"));
  if (intent === "target-approve")
    return fromDispatch(await approveTarget(env, access, draft, targetId));
  if (intent === "target-delegate")
    return fromDispatch(await delegateTarget(env, access, draft, targetId));
  if (intent === "target-skip") {
    const r = await skipTarget(env, access, draft, targetId, "skipped");
    return r.ok
      ? { ok: true, message: `${r.targetLabel} は見送りました` }
      : { ok: false, errors: [r.error] };
  }
  if (intent === "media") {
    const url = String(form.get("mediaUrl") ?? "").trim();
    if (url && !/^https?:\/\//.test(url))
      return { ok: false, errors: ["画像の URL を入れてください"] };
    await setDispatchMedia(env.DB, draft.id, url || null);
    return { ok: true, message: url ? "画像を付けました" : "画像を外しました" };
  }
  if (intent === "link") return editLink(env, access, draft, form);
  return null;
}

/** The link and OGP image are part of the content: a new human version (back to review). */
async function editLink(
  env: Env,
  access: CampaignAccess,
  draft: Draft,
  form: FormData,
): Promise<Result> {
  const content = structuredClone(
    (await currentContent(env.DB, draft)) as {
      posts?: { attachment?: Record<string, unknown> }[];
    } | null,
  );
  const post = content?.posts?.[0];
  if (!post?.attachment) return { ok: false, errors: ["投稿がありません"] };
  const url = String(form.get("linkUrl") ?? "").trim();
  const ogImage = String(form.get("ogImage") ?? "").trim();
  post.attachment.link = url ? { url, ogImage: ogImage || null } : null;
  if (url && ogImage && post.attachment.kind === "none") post.attachment.kind = "ogp";
  const result = await editDraft(env.DB, access, draft, content);
  return result.ok
    ? { ok: true, message: `版 ${result.version} を保存しました（レビューに戻ります）` }
    : { ok: false, errors: result.errors };
}
