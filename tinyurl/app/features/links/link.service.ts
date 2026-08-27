import { isSuperAdmin } from "@gdgjp/gdg-lib";
import type { AuthUser, UserChapter } from "@gdgjp/gdg-lib";
import { getCampaignById, getCampaignChannelById } from "~/features/campaigns";
import { getDomainById } from "~/features/domains";
import { canEditFolder, getFolderById } from "~/lib/db";
import { createTag } from "~/features/tags";
import { validatePublicHttpUrl } from "~/lib/ogp";
import { generateRandomSlug, validateSlug } from "~/lib/slug";
import { type FeatureFailure, featureFailure } from "../shared/errors";
import { type ValidatedShare, validateSharePrincipal } from "./link-policy";
import {
  addComment,
  addPermission,
  copyFolderPermissionsToLink,
  deleteComment,
  deleteLink,
  findExistingTagId,
  listAllowedTagIds,
  listComments,
  listPermissionsForLink,
  createLink as repoCreateLink,
  updateLink as repoUpdateLink,
  setLinkTags,
  updatePermissionRole,
} from "./link.repository";
import type { CreateLinkInput, Link } from "./link.types";

export type LinkServiceDependencies = {
  db: D1Database;
};

export type LinkServiceActor = {
  user: AuthUser;
  chapter: UserChapter;
  chapters: UserChapter[];
};

async function applyLinkExtras(
  deps: LinkServiceDependencies,
  actor: LinkServiceActor,
  linkId: string,
  extras: {
    folderId: number | null;
    tagIds: number[];
    newTagNames: string[];
    comment: string;
    shares: ValidatedShare[];
  },
): Promise<void> {
  const inheritedPermissions = new Map<string, { id: number }>();
  if (extras.folderId !== null) {
    await copyFolderPermissionsToLink(deps.db, extras.folderId, linkId);
    for (const permission of await listPermissionsForLink(deps.db, linkId)) {
      inheritedPermissions.set(`${permission.principalType}:${permission.principalId}`, permission);
    }
  }
  const finalTagIds = new Set(extras.tagIds);
  for (const name of extras.newTagNames) {
    const result = await createTag(deps.db, { name, color: null, ownerUserId: actor.user.id });
    if (result.ok) {
      finalTagIds.add(result.tag.id);
    } else {
      const existingId = await findExistingTagId(deps.db, name, actor.user.id);
      if (existingId) finalTagIds.add(existingId);
    }
  }
  if (finalTagIds.size > 0) await setLinkTags(deps.db, linkId, [...finalTagIds]);
  if (extras.comment) {
    await addComment(deps.db, { linkId, authorUserId: actor.user.id, body: extras.comment });
  }
  for (const share of extras.shares) {
    const result = await addPermission(deps.db, {
      linkId,
      principalType: share.principalType,
      principalId: share.principalId,
      role: share.role,
    });
    if (!result.ok) {
      const inherited = inheritedPermissions.get(`${share.principalType}:${share.principalId}`);
      if (inherited) await updatePermissionRole(deps.db, linkId, inherited.id, share.role);
    }
  }
}

export async function createLinkWithExtras(
  deps: LinkServiceDependencies,
  actor: LinkServiceActor,
  input: CreateLinkInput,
): Promise<{ ok: true; link: Link } | FeatureFailure> {
  const { user, chapter, chapters } = actor;

  if (!Number.isInteger(input.domainId) || input.domainId <= 0) {
    return featureFailure("invalid_input", "Domain is invalid.");
  }
  const domain = await getDomainById(deps.db, input.domainId);
  if (!domain || domain.status !== "active") {
    return featureFailure("invalid_input", "Domain is not active.");
  }
  if (
    domain.ownerChapterId !== null &&
    !chapters.some((item) => item.chapterId === domain.ownerChapterId) &&
    !isSuperAdmin(user)
  ) {
    return featureFailure("forbidden", "Domain is not available for your chapter.");
  }

  if (input.visibility !== "private" && input.visibility !== "public") {
    return featureFailure("invalid_input", "Visibility must be private or public.");
  }

  const shares: ValidatedShare[] = [];
  for (const raw of input.shares ?? []) {
    const result = validateSharePrincipal(raw);
    if (!result.ok) return featureFailure("invalid_input", result.error);
    shares.push(result.share);
  }

  let campaignChannelId: number | null = null;
  let ownerChapterId: number | null = null;
  let destinationUrl = input.destinationUrl;
  if (input.campaignChannelId != null) {
    campaignChannelId = input.campaignChannelId;
    if (!Number.isInteger(campaignChannelId) || campaignChannelId <= 0) {
      return featureFailure("invalid_input", "Campaign channel is invalid.");
    }
    const channel = await getCampaignChannelById(deps.db, campaignChannelId);
    const campaign = channel ? await getCampaignById(deps.db, channel.campaignId) : null;
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
      return featureFailure("invalid_input", "Campaign channel is not available for your chapter.");
    }
    ownerChapterId = accessChapter?.chapterId ?? chapter.chapterId;
    if (!destinationUrl && campaign.defaultDestinationUrl) {
      destinationUrl = campaign.defaultDestinationUrl;
    }
  }
  if (domain.ownerChapterId !== null) {
    if (ownerChapterId !== null && ownerChapterId !== domain.ownerChapterId) {
      return featureFailure(
        "invalid_input",
        "Campaign and domain must belong to the same chapter.",
      );
    }
    ownerChapterId = domain.ownerChapterId;
  }

  let folderId: number | null = null;
  let linkOwnerUserId = user.id;
  if (input.folderId != null) {
    folderId = input.folderId;
    if (
      !Number.isInteger(folderId) ||
      folderId <= 0 ||
      !(await canEditFolder(deps.db, folderId, {
        userId: user.id,
        email: user.email,
        chapterIds: chapters.map((item) => item.chapterId),
        isSuperAdmin: isSuperAdmin(user),
      }))
    ) {
      return featureFailure("invalid_input", "Folder is not available.");
    }
    const folder = await getFolderById(deps.db, folderId);
    if (!folder?.ownerUserId) return featureFailure("invalid_input", "Folder is not available.");
    linkOwnerUserId = folder.ownerUserId;
  }

  if (!destinationUrl) return featureFailure("invalid_input", "Destination URL is required.");
  const [destinationValidation, imageValidation] = await Promise.all([
    validatePublicHttpUrl(destinationUrl),
    input.ogImageUrl ? validatePublicHttpUrl(input.ogImageUrl) : Promise.resolve(null),
  ]);
  if (!destinationValidation.ok) {
    return featureFailure("invalid_input", `Destination ${destinationValidation.reason}`);
  }
  if (imageValidation && !imageValidation.ok) {
    return featureFailure("invalid_input", `OG image ${imageValidation.reason}`);
  }

  const commentBody = (input.comment ?? "").trim();
  if (commentBody.length > 2000) {
    return featureFailure(
      "invalid_input",
      `Comment must not exceed 2000 characters (received ${commentBody.length}).`,
    );
  }

  const createArgs = {
    domainId: input.domainId,
    destinationUrl,
    title: input.title ?? null,
    description: input.description ?? null,
    ogImageUrl: input.ogImageUrl ?? null,
    ownerUserId: linkOwnerUserId,
    ownerChapterId,
    campaignChannelId,
    folderId,
    visibility: input.visibility,
  };

  async function createOnce(slug: string) {
    const result = await repoCreateLink(deps.db, { ...createArgs, slug });
    if (!result.ok) return result;
    try {
      await applyLinkExtras(deps, actor, result.link.id, {
        folderId,
        tagIds: input.tagIds ?? [],
        newTagNames: input.newTagNames ?? [],
        comment: commentBody,
        shares,
      });
    } catch (err) {
      await deleteLink(deps.db, result.link.id);
      throw err;
    }
    return result;
  }

  let slug = input.slug.trim();
  if (!slug) {
    for (let attempt = 0; attempt < 5; attempt++) {
      slug = generateRandomSlug(8);
      const result = await createOnce(slug);
      if (result.ok) return { ok: true, link: result.link };
    }
    return featureFailure("conflict", "Could not generate a unique slug. Please try again.");
  }

  const validation = validateSlug(slug);
  if (!validation.ok) {
    return featureFailure(
      "invalid_input",
      validation.reason === "reserved"
        ? `"${slug}" is a reserved slug.`
        : "Slug may only contain letters, numbers, hyphens, and underscores (1–64 chars).",
    );
  }

  const result = await createOnce(slug);
  if (!result.ok) return featureFailure("conflict", `The slug "${slug}" is already taken.`);
  return { ok: true, link: result.link };
}

export type UpdateLinkPatch = Partial<Omit<CreateLinkInput, "domainId">>;

export type UpdateLinkDomainChange = { domainId: number; ownerChapterId?: number | null };

export async function updateLinkWithExtras(
  deps: LinkServiceDependencies,
  actor: LinkServiceActor,
  id: string,
  patch: UpdateLinkPatch,
  domainUpdate?: UpdateLinkDomainChange,
): Promise<{ ok: true; link: Link } | FeatureFailure> {
  const { user, chapters } = actor;
  const update: Parameters<typeof repoUpdateLink>[2] = { ...domainUpdate };

  if (patch.destinationUrl !== undefined) {
    const destinationUrl = patch.destinationUrl.trim();
    if (!destinationUrl) return featureFailure("invalid_input", "Destination URL is required.");
    const validation = await validatePublicHttpUrl(destinationUrl);
    if (!validation.ok) return featureFailure("invalid_input", `Destination ${validation.reason}`);
    update.destinationUrl = destinationUrl;
  }

  if (patch.slug !== undefined) {
    const slug = patch.slug.trim();
    if (!slug) return featureFailure("invalid_input", "Slug is required.");
    const validation = validateSlug(slug);
    if (!validation.ok) {
      return featureFailure(
        "invalid_input",
        validation.reason === "reserved"
          ? `"${slug}" is a reserved slug.`
          : "Slug may only contain letters, numbers, hyphens, and underscores (1–64 chars).",
      );
    }
    update.slug = slug;
  }

  if (patch.title !== undefined) update.title = patch.title;
  if (patch.description !== undefined) update.description = patch.description;

  if (patch.ogImageUrl !== undefined) {
    if (patch.ogImageUrl) {
      const imageValidation = await validatePublicHttpUrl(patch.ogImageUrl);
      if (!imageValidation.ok) {
        return featureFailure("invalid_input", `OG image ${imageValidation.reason}`);
      }
    }
    update.ogImageUrl = patch.ogImageUrl;
  }

  if (patch.visibility !== undefined) {
    if (patch.visibility !== "private" && patch.visibility !== "public") {
      return featureFailure("invalid_input", "Visibility must be private or public.");
    }
    update.visibility = patch.visibility;
  }

  if (patch.folderId !== undefined) {
    if (patch.folderId === null) {
      update.folderId = null;
    } else {
      const folderId = patch.folderId;
      if (
        !Number.isInteger(folderId) ||
        folderId <= 0 ||
        !(await canEditFolder(deps.db, folderId, {
          userId: user.id,
          email: user.email,
          chapterIds: chapters.map((item) => item.chapterId),
          isSuperAdmin: isSuperAdmin(user),
        }))
      ) {
        return featureFailure("invalid_input", "Folder is not available.");
      }
      update.folderId = folderId;
    }
  }

  let updatedLink: Link | null;
  try {
    updatedLink = await repoUpdateLink(deps.db, id, update);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("UNIQUE")) {
      return featureFailure("conflict", `The slug "${update.slug}" is already taken.`);
    }
    throw err;
  }
  if (!updatedLink) return featureFailure("not_found", "Link not found.");

  if (patch.tagIds !== undefined || patch.newTagNames !== undefined) {
    const existingIds = patch.tagIds ?? [];
    const newNames = patch.newTagNames ?? [];
    const finalIds = new Set(await listAllowedTagIds(deps.db, user.id, existingIds));
    for (const name of newNames) {
      const result = await createTag(deps.db, { name, color: null, ownerUserId: user.id });
      if (result.ok) {
        finalIds.add(result.tag.id);
      } else {
        const existingId = await findExistingTagId(deps.db, name, user.id);
        if (existingId) finalIds.add(existingId);
      }
    }
    await setLinkTags(deps.db, id, [...finalIds]);
  }

  if (patch.comment !== undefined) {
    const body = (patch.comment ?? "").trim();
    if (body.length > 2000)
      return featureFailure("invalid_input", "Comment is too long (max 2000 chars).");
    const existing = await listComments(deps.db, id);
    for (const comment of existing.filter((c) => c.authorUserId === user.id)) {
      await deleteComment(deps.db, comment.id);
    }
    if (body) await addComment(deps.db, { linkId: id, authorUserId: user.id, body });
  }

  return { ok: true, link: updatedLink };
}
