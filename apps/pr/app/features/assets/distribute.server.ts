import type { CampaignAccess } from "~/features/campaigns/access.server";
import { connpassEventOf, submitConnpass } from "~/features/connpass/submit.server";
import { getDraft, setDispatchMedia } from "~/features/drafts/draft.repository.server";
import { currentContent, editDraft } from "~/features/drafts/review.server";
import {
  actorOf,
  callRpc,
  connpassService,
  tinyurlService,
} from "~/features/integrations/bindings.server";
import { linkForItem } from "~/features/links/link.repository.server";
import { type ConnpassPageContent, setSectionImages } from "~/features/pages/render";
import type { Asset } from "./asset";
import { moveAsset, setPublished } from "./asset.repository.server";

type ImageUpload = {
  upload(input: {
    bytes: ArrayBuffer;
    contentType: string;
    filename: string | null;
    user: CampaignAccess["user"];
    chapterId: number;
  }): Promise<{ id: string; url: string }>;
};

/**
 * Approval publishes the image to img.gdgs.jp as the approver, then hands it to where it is
 * used: the connpass thumbnail (JPEG ≤ 1 MB), a short link's OGP, a post's attachment, or a
 * connpass page's image slot (a new page version).
 */
export async function approveAsset(env: Env, access: CampaignAccess, asset: Asset) {
  if (asset.checks.some((c) => c.strength === "MUST" && c.status === "fail"))
    return { ok: false as const, error: "MUST の検査が落ちています。直して描画し直してください" };
  if (!asset.r2Key) return { ok: false as const, error: "画像がありません" };
  if (!(await moveAsset(env.DB, asset.id, ["needs_approval"], "approved", access.user.id)))
    return { ok: true as const, message: "この画像はもう処理されています" };
  const png = await env.IMAGES.get(asset.r2Key);
  if (!png) return { ok: false as const, error: "画像がありません" };
  try {
    const uploaded = await (env.IMG_UPLOAD as unknown as ImageUpload).upload({
      bytes: await png.arrayBuffer(),
      contentType: "image/png",
      filename: `${access.campaign.slug}-${asset.templateId}-${asset.id}.png`,
      user: access.user,
      chapterId: access.campaign.chapterId,
    });
    await setPublished(env.DB, asset.id, uploaded.id, uploaded.url);
    const used = await handOff(env, access, asset, uploaded.url);
    return { ok: true as const, message: `img.gdgs.jp に上げました（${uploaded.url}）。${used}` };
  } catch (error) {
    await moveAsset(env.DB, asset.id, ["approved"], "needs_approval");
    return {
      ok: false as const,
      error: `img.gdgs.jp に上げられませんでした（${error instanceof Error ? error.message : error}）`,
    };
  }
}

async function handOff(
  env: Env,
  access: CampaignAccess,
  asset: Asset,
  url: string,
): Promise<string> {
  const actor = actorOf(access);
  if (asset.templateId === "connpass-thumbnail") {
    const event = connpassEventOf(access.campaign);
    const jpeg = asset.r2KeyJpeg ? await env.IMAGES.get(asset.r2KeyJpeg) : null;
    if (!event || !jpeg) return "connpass の設定が無いので、サムネイルは手で上げてください";
    const bytes = await jpeg.arrayBuffer();
    const result = await submitConnpass(env, {
      actor,
      campaign: access.campaign,
      itemId: null,
      kind: "upload_event_image",
      call: () =>
        connpassService(env).uploadImage({
          actor,
          ...event,
          bytes,
          contentType: "image/jpeg",
          name: `${access.campaign.slug}.jpg`,
        }),
    });
    return result.ok ? "connpass にサムネイルを上げるジョブを積みました" : result.error;
  }
  if (asset.templateId === "ogp-1200x630" && asset.forScheduleItemId) {
    const link = await linkForItem(env.DB, asset.forScheduleItemId);
    if (!link) return "短縮リンクがまだ無いので、OGP は投稿の承認時に使われます";
    const updated = await callRpc(() =>
      tinyurlService(env).updateLink({ actor, linkId: link.tinyurlLinkId, ogImageUrl: url }),
    );
    if (updated.ok)
      await env.DB.prepare("UPDATE campaign_links SET og_image_url = ? WHERE id = ?")
        .bind(url, link.id)
        .run();
    return updated.ok
      ? "短縮リンクの OGP にしました"
      : `OGP を更新できませんでした（${updated.code}）`;
  }
  if (asset.forDraftId && asset.forImageSlotId) {
    const draft = await getDraft(env.DB, access.campaign.id, asset.forDraftId);
    const content = draft
      ? ((await currentContent(env.DB, draft)) as ConnpassPageContent | null)
      : null;
    if (!draft || !content) return "";
    const saved = await editDraft(
      env.DB,
      access,
      draft,
      setSectionImages(content, { [asset.forImageSlotId]: url }),
    );
    return saved.ok
      ? `connpass ページの ${asset.forImageSlotId} に入れました（版 ${saved.version}）`
      : saved.errors.join(" / ");
  }
  if (asset.forDraftId) {
    await setDispatchMedia(env.DB, asset.forDraftId, url);
    return "投稿の添付画像にしました";
  }
  return "";
}
