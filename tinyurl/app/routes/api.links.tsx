import { isSuperAdmin } from "@gdgjp/gdg-lib";
import { redirect } from "react-router";
import { requireUserWithChapter } from "~/lib/auth-redirect";
import {
  type LinkVisibility,
  addComment,
  addPermission,
  createLink,
  createTag,
  deleteLink,
  getCampaignById,
  getCampaignChannelById,
  setLinkTags,
} from "~/lib/db";
import { type OgpData, fetchOgp, validatePublicHttpUrl } from "~/lib/ogp";
import { generateRandomSlug, validateSlug } from "~/lib/slug";
import type { Route } from "./+types/api.links";

export type ApiLinksActionData = { error: string } | { ogp: OgpData | null } | null;

export async function action(args: Route.ActionArgs): Promise<ApiLinksActionData> {
  const env = args.context.cloudflare.env;
  const { user, chapter, chapters } = await requireUserWithChapter(env, args.request);

  const form = await args.request.formData();
  const intent = String(form.get("intent") ?? "create");

  if (intent === "fetchOgp") {
    const url = String(form.get("destinationUrl") ?? "").trim();
    const validation = await validatePublicHttpUrl(url);
    if (!validation.ok) return { error: `Destination ${validation.reason}` };
    return { ogp: await fetchOgp(validation.url.toString()) };
  }

  const rawSlug = String(form.get("slug") ?? "").trim();
  let destinationUrl = String(form.get("destinationUrl") ?? "").trim();
  const title = String(form.get("title") ?? "").trim() || null;
  const description = String(form.get("description") ?? "").trim() || null;
  const ogImageUrl = String(form.get("ogImageUrl") ?? "").trim() || null;
  const tagIds = form
    .getAll("tagId")
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n > 0);
  const newTagNames = form
    .getAll("newTagName")
    .map((v) => String(v).trim())
    .filter((n) => n.length > 0 && n.length <= 32);
  const commentBody = String(form.get("comment") ?? "").trim();
  const rawVisibility = String(form.get("visibility") ?? "private");
  const rawCampaignChannelId = String(form.get("campaignChannelId") ?? "").trim();
  const shares = form.getAll("share").map((value) => {
    const [principalType, principalId, role] = String(value).split(":");
    return { principalType, principalId: principalId?.trim() ?? "", role };
  });
  if (rawVisibility !== "private" && rawVisibility !== "public") {
    return { error: "Visibility must be private or public." };
  }
  const visibility: LinkVisibility = rawVisibility;

  for (const share of shares) {
    const {
      principalType: sharePrincipalType,
      principalId: sharePrincipalId,
      role: shareRole,
    } = share;
    if (sharePrincipalType !== "user" && sharePrincipalType !== "chapter") {
      return { error: "Invalid sharing principal type." };
    }
    if (shareRole !== "editor" && shareRole !== "viewer") return { error: "Invalid sharing role." };
    if (sharePrincipalType === "user" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(sharePrincipalId)) {
      return { error: "Invalid sharing email address." };
    }
    if (sharePrincipalType === "chapter" && !/^\d+$/.test(sharePrincipalId)) {
      return { error: "Sharing chapter id must be a number." };
    }
  }

  let campaignChannelId: number | null = null;
  let ownerChapterId: number | null = null;
  if (rawCampaignChannelId) {
    campaignChannelId = Number(rawCampaignChannelId);
    if (!Number.isInteger(campaignChannelId) || campaignChannelId <= 0) {
      return { error: "Campaign channel is invalid." };
    }
    const channel = await getCampaignChannelById(env.DB, campaignChannelId);
    const campaign = channel ? await getCampaignById(env.DB, channel.campaignId) : null;
    const accessChapter = campaign?.chapterIds
      .map((id) => chapters.find((item) => item.chapterId === id))
      .find((item) => item !== undefined);
    if (
      !channel ||
      !campaign ||
      channel.archivedAt !== null ||
      campaign.archivedAt !== null ||
      (!accessChapter && !isSuperAdmin(user))
    ) {
      return { error: "Campaign channel is not available for your chapter." };
    }
    ownerChapterId = accessChapter?.chapterId ?? chapter.chapterId;
    if (!destinationUrl && campaign.defaultDestinationUrl) {
      destinationUrl = campaign.defaultDestinationUrl;
    }
  }

  if (!destinationUrl) return { error: "Destination URL is required." };
  const [destinationValidation, imageValidation] = await Promise.all([
    validatePublicHttpUrl(destinationUrl),
    ogImageUrl ? validatePublicHttpUrl(ogImageUrl) : Promise.resolve(null),
  ]);
  if (!destinationValidation.ok) return { error: `Destination ${destinationValidation.reason}` };
  if (imageValidation && !imageValidation.ok) {
    return { error: `OG image ${imageValidation.reason}` };
  }

  if (commentBody.length > 2000) {
    return { error: `Comment must not exceed 2000 characters (received ${commentBody.length}).` };
  }

  async function applyExtras(linkId: string) {
    const finalTagIds = new Set(tagIds);
    for (const name of newTagNames) {
      const result = await createTag(env.DB, { name, color: null, ownerUserId: user.id });
      if (result.ok) {
        finalTagIds.add(result.tag.id);
      } else {
        const row = await env.DB.prepare(
          "SELECT id FROM tags WHERE name = ? AND (owner_user_id = ? OR owner_user_id IS NULL)",
        )
          .bind(name, user.id)
          .first<{ id: number }>();
        if (row?.id) finalTagIds.add(row.id);
      }
    }
    if (finalTagIds.size > 0) await setLinkTags(env.DB, linkId, [...finalTagIds]);
    if (commentBody) {
      await addComment(env.DB, { linkId, authorUserId: user.id, body: commentBody });
    }
    for (const share of shares) {
      await addPermission(env.DB, {
        linkId,
        principalType: share.principalType as "user" | "chapter",
        principalId: share.principalId,
        role: share.role as "viewer" | "editor",
      });
    }
  }

  async function createLinkWithExtras(input: Parameters<typeof createLink>[1]) {
    const result = await createLink(env.DB, input);
    if (!result.ok) return result;
    try {
      await applyExtras(result.link.id);
    } catch (err) {
      await deleteLink(env.DB, result.link.id);
      throw err;
    }
    return result;
  }

  let slug = rawSlug;
  if (!slug) {
    for (let attempt = 0; attempt < 5; attempt++) {
      slug = generateRandomSlug(8);
      const result = await createLinkWithExtras({
        slug,
        destinationUrl,
        title,
        description,
        ogImageUrl,
        ownerUserId: user.id,
        ownerChapterId,
        campaignChannelId,
        visibility,
      });
      if (result.ok) {
        throw redirect(`/links/${result.link.id}`);
      }
    }
    return { error: "Could not generate a unique slug. Please try again." };
  }

  const validation = validateSlug(slug);
  if (!validation.ok) {
    return {
      error:
        validation.reason === "reserved"
          ? `"${slug}" is a reserved slug.`
          : "Slug may only contain letters, numbers, hyphens, and underscores (1–64 chars).",
    };
  }

  const result = await createLinkWithExtras({
    slug,
    destinationUrl,
    title,
    description,
    ogImageUrl,
    ownerUserId: user.id,
    ownerChapterId,
    campaignChannelId,
    visibility,
  });
  if (!result.ok) return { error: `The slug "${slug}" is already taken.` };
  throw redirect(`/links/${result.link.id}`);
}
