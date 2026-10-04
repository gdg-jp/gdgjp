import { isSuperAdmin } from "@gdgjp/gdg-lib";
import { redirect } from "react-router";
import { clicksByLinkId } from "~/features/analytics/analytics-engine";
import { requireUserWithChapter } from "~/features/auth/auth-redirect";
import { getUsersByIds } from "~/features/auth/user.repository";
import { getDomainById, listDomainsForChapters } from "~/features/domains";
import { listAllAccessibleFolders } from "~/features/folders/folder-access.repository";
import {
  type LinkVisibility,
  type UpdateLinkPatch,
  type ViewerContext,
  addPermission,
  archiveLink,
  canEditLink,
  canViewLink,
  getLinkById,
  listComments,
  listPermissionsForLink,
  removePermission,
  restoreLink,
  softDeleteLink,
  updateLink,
  updateLinkWithExtras,
  updatePermissionRole,
} from "~/features/links";
import { isLinkId } from "~/features/links/id";
import { fetchOgp } from "~/features/links/ogp";
import {
  listTagsForChapter,
  listTagsForLink,
  listTagsForUser,
} from "~/features/tags/tag.repository";
import type { PageRequestArgs } from "~/http/request";

export async function ensureAccess(args: PageRequestArgs) {
  const env = args.context.cloudflare.env;
  const id = String(args.params.id ?? "");
  if (!isLinkId(id)) throw new Response("Not found", { status: 404 });
  const [{ user, chapter, chapters }, link, permissions] = await Promise.all([
    requireUserWithChapter(env, args.request),
    getLinkById(env.DB, id),
    listPermissionsForLink(env.DB, id),
  ]);
  if (!link) throw new Response("Not found", { status: 404 });
  const ctx: ViewerContext = { user, chapterId: chapter.chapterId };
  if (!canViewLink(ctx, link, permissions)) {
    throw new Response("Forbidden", { status: 403 });
  }
  const editable = canEditLink(ctx, link, permissions);
  return { env, user, chapter, chapters, link, permissions, ctx, editable, id };
}

export async function loader(args: PageRequestArgs) {
  const { env, user, chapter, chapters, link, permissions, editable } = await ensureAccess(args);
  const clicks = clicksByLinkId(env, [link.id])
    .then((clickMap) => clickMap.get(link.id) ?? 0)
    .catch(() => 0);
  const [tags, userTags, chapterTags, comments, users, domains, availableFolders] =
    await Promise.all([
      listTagsForLink(env.DB, link.id),
      listTagsForUser(env.DB, user.id),
      listTagsForChapter(env.DB, chapter.chapterId),
      listComments(env.DB, link.id),
      getUsersByIds(env.DB, [link.ownerUserId]),
      listDomainsForChapters(
        env.DB,
        chapters.map((item) => item.chapterId),
      ),
      listAllAccessibleFolders(env.DB, {
        userId: user.id,
        email: user.email,
        chapterIds: chapters.map((item) => item.chapterId),
        isSuperAdmin: isSuperAdmin(user),
      }),
    ]);
  const latestComment = comments.length > 0 ? comments[comments.length - 1] : null;
  const chapterNameById: Record<string, string> = {};
  for (const c of chapters) chapterNameById[String(c.chapterId)] = c.chapterSlug;
  return {
    user: { email: user.email, image: user.image, name: user.name },
    link,
    permissions,
    tags,
    availableTags: [...userTags, ...chapterTags],
    availableFolders,
    comment: latestComment?.body ?? "",
    users,
    editable,
    chapters,
    chapterNameById,
    appUrl: env.APP_URL,
    shortUrlBase: env.SHORT_URL_BASE,
    domainOptions: domains
      .filter((domain) => domain.status === "active" || domain.id === link.domainId)
      .map((domain) => ({ id: domain.id, hostname: domain.hostname })),
    clicks,
  };
}

export async function action(args: PageRequestArgs) {
  const { env, user, chapter, chapters, link, editable, id } = await ensureAccess(args);
  const form = await args.request.formData();
  const intent = form.get("intent");

  if (!editable) return { error: "You don't have permission to edit this link." };

  if (intent === "delete") {
    await softDeleteLink(env.DB, id);
    throw redirect("/links");
  }

  if (intent === "archive") {
    await archiveLink(env.DB, id);
    throw redirect("/links");
  }

  if (intent === "restore") {
    await restoreLink(env.DB, id);
    throw redirect("/links");
  }

  if (intent === "update") {
    let domainUpdate: Parameters<typeof updateLinkWithExtras>[4];

    if (form.has("domainId")) {
      const domainId = Number(form.get("domainId"));
      const domain = Number.isInteger(domainId) ? await getDomainById(env.DB, domainId) : null;
      if (!domain || domain.status !== "active") return { error: "Domain is not active." };
      if (
        domain.ownerChapterId !== null &&
        !chapters.some((chapter) => chapter.chapterId === domain.ownerChapterId) &&
        !isSuperAdmin(user)
      ) {
        return { error: "Domain is not available for your chapter." };
      }
      if (
        link.campaignChannelId !== null &&
        domain.ownerChapterId !== null &&
        link.ownerChapterId !== domain.ownerChapterId
      ) {
        return { error: "Campaign and domain must belong to the same chapter." };
      }
      domainUpdate = {
        domainId: domain.id,
        ownerChapterId: domain.ownerChapterId !== null ? domain.ownerChapterId : undefined,
      };
    }

    const patch: UpdateLinkPatch = {};
    if (form.has("destinationUrl")) {
      patch.destinationUrl = String(form.get("destinationUrl") ?? "").trim();
    }
    if (form.has("slug")) {
      patch.slug = String(form.get("slug") ?? "").trim();
    }
    if (form.has("title")) {
      patch.title = String(form.get("title") ?? "").trim() || null;
    }
    if (form.has("description")) {
      patch.description = String(form.get("description") ?? "").trim() || null;
    }
    if (form.has("ogImageUrl")) {
      patch.ogImageUrl = String(form.get("ogImageUrl") ?? "").trim() || null;
    }
    if (form.has("visibility")) {
      patch.visibility = String(form.get("visibility") ?? "") as LinkVisibility;
    }
    if (form.has("folderId")) {
      const rawFolderId = String(form.get("folderId") ?? "").trim();
      patch.folderId = rawFolderId ? Number(rawFolderId) : null;
    }
    if (form.has("manageTags")) {
      patch.tagIds = form
        .getAll("tagId")
        .map((v) => Number(v))
        .filter((n) => Number.isInteger(n) && n > 0);
      patch.newTagNames = form
        .getAll("newTagName")
        .map((v) => String(v).trim())
        .filter((n) => n.length > 0 && n.length <= 32);
    }
    if (form.has("comment")) {
      patch.comment = String(form.get("comment") ?? "").trim();
    }

    const result = await updateLinkWithExtras(
      { db: env.DB },
      { user, chapters, selectedChapterId: chapter.chapterId },
      id,
      patch,
      domainUpdate,
    );
    if (!result.ok) return { error: result.error };

    return { success: "Saved." };
  }

  if (intent === "fetchOgp") {
    const destinationUrl = String(form.get("destinationUrl") ?? link.destinationUrl).trim();
    const ogp = await fetchOgp(destinationUrl || link.destinationUrl);
    if (!ogp) return { error: "Could not fetch OGP data for that URL." };
    await updateLink(env.DB, id, {
      title: ogp.title ?? link.title,
      description: ogp.description ?? link.description,
      ogImageUrl: ogp.image ?? link.ogImageUrl,
    });
    return { success: "OGP data fetched." };
  }

  if (intent === "addPermission") {
    const principalType = String(form.get("principalType") ?? "");
    const principalId = String(form.get("principalId") ?? "").trim();
    const role = String(form.get("role") ?? "");
    if (principalType !== "user" && principalType !== "chapter") {
      return { error: "Invalid principal type." };
    }
    if (role !== "editor" && role !== "viewer") return { error: "Invalid role." };
    if (!principalId) return { error: "Principal id required." };
    if (principalType === "user" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(principalId)) {
      return { error: "Invalid email address." };
    }
    if (principalType === "chapter" && !/^\d+$/.test(principalId)) {
      return { error: "Chapter id must be a number." };
    }
    const result = await addPermission(env.DB, {
      linkId: id,
      principalType,
      principalId,
      role,
    });
    if (!result.ok) return { error: "That principal already has access to this link." };
    return { success: "Permission added." };
  }

  if (intent === "removePermission") {
    const permId = Number(form.get("permissionId"));
    if (!Number.isInteger(permId) || permId <= 0) return { error: "Invalid permission id." };
    const removed = await removePermission(env.DB, id, permId);
    if (!removed) return { error: "Permission not found for this link." };
    return null;
  }

  if (intent === "updatePermissionRole") {
    const permId = Number(form.get("permissionId"));
    const role = String(form.get("role") ?? "");
    if (!Number.isInteger(permId) || permId <= 0) return { error: "Invalid permission id." };
    if (role !== "editor" && role !== "viewer") return { error: "Invalid role." };
    const updated = await updatePermissionRole(env.DB, id, permId, role);
    if (!updated) return { error: "Permission not found for this link." };
    return null;
  }

  return { error: "Unknown action." };
}

export type LinksPageData = Awaited<ReturnType<typeof loader>>;
export type LinksPageAction = Awaited<ReturnType<typeof action>>;
