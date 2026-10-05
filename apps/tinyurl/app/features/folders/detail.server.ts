import { redirect } from "react-router";
import { clicksByLinkId } from "~/features/analytics/analytics-engine";
import { requireUserWithChapter } from "~/features/auth/auth-redirect";
import { getUsersByIds } from "~/features/auth/user.repository";
import { listDomainsForChapters } from "~/features/domains";
import {
  canEditFolder,
  getAccessibleFolder,
  listAccessibleChildFoldersWithCounts,
  listAllAccessibleFolders,
  listLinksInFolderAccessible,
} from "~/features/folders/folder-access.repository";
import type { Folder } from "~/features/folders/folder-record";
import {
  addFolderPermission,
  createFolder,
  deleteFolder,
  listFolderPermissions,
  removeFolderPermission,
  updateFolder,
  updateFolderPermissionRole,
} from "~/features/folders/folder.repository";
import { type FolderActionData, folderViewer } from "~/features/folders/list.server";
import {
  listTagsForChapter,
  listTagsForLinks,
  listTagsForUser,
} from "~/features/tags/tag.repository";
import type { PageRequestArgs } from "~/http/request";

export function validName(form: FormData): string | null {
  const name = String(form.get("name") ?? "").trim();
  return name && name.length <= 48 ? name : null;
}

export async function requireContext(args: PageRequestArgs) {
  const env = args.context.cloudflare.env;
  const { user, chapter, chapters } = await requireUserWithChapter(env, args.request);
  const id = Number(args.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new Response("Not found", { status: 404 });
  return { env, user, chapter, chapters, id, viewer: folderViewer(user, chapters) };
}

export function breadcrumbsFor(folder: Folder, accessibleFolders: Folder[]): Folder[] {
  const byId = new Map(accessibleFolders.map((item) => [item.id, item]));
  const result = [folder];
  const seen = new Set([folder.id]);
  let cursor = folder;
  while (cursor.parentFolderId !== null) {
    const parent = byId.get(cursor.parentFolderId);
    if (!parent || seen.has(parent.id)) break;
    result.unshift(parent);
    seen.add(parent.id);
    cursor = parent;
  }
  return result;
}

export async function loader(args: PageRequestArgs) {
  const { env, user, chapters, id, viewer } = await requireContext(args);
  const folder = await getAccessibleFolder(env.DB, id, viewer);
  if (!folder) throw new Response("Not found", { status: 404 });
  const [childFolders, links, allFolders, editable, permissions, userTags, chapterTags, domains] =
    await Promise.all([
      listAccessibleChildFoldersWithCounts(env.DB, id, viewer),
      listLinksInFolderAccessible(env.DB, { ...viewer, folderId: id, includeArchived: true }),
      listAllAccessibleFolders(env.DB, viewer),
      canEditFolder(env.DB, id, viewer),
      listFolderPermissions(env.DB, id),
      listTagsForUser(env.DB, user.id),
      Promise.all(chapters.map((chapter) => listTagsForChapter(env.DB, chapter.chapterId))),
      listDomainsForChapters(
        env.DB,
        chapters.map((chapter) => chapter.chapterId),
      ),
    ]);
  const linkIds = links.map((link) => link.id);
  const clicks = clicksByLinkId(env, linkIds)
    .then((clickMap) => Object.fromEntries(clickMap))
    .catch((error) => {
      console.error("Analytics Engine query failed (folder links):", error);
      return {} as Record<string, number>;
    });
  const [owners, tagsByLinkId] = await Promise.all([
    getUsersByIds(env.DB, [...new Set(links.map((link) => link.ownerUserId))]),
    listTagsForLinks(env.DB, linkIds),
  ]);
  return {
    user: { email: user.email, image: user.image, name: user.name },
    folder,
    breadcrumbs: breadcrumbsFor(folder, allFolders),
    childFolders,
    links,
    owners,
    tagsByLinkId,
    clicks,
    editable,
    permissions,
    chapters,
    availableTags: [...userTags, ...chapterTags.flat()],
    domainOptions: domains
      .filter((domain) => domain.status === "active")
      .map((domain) => ({ id: domain.id, hostname: domain.hostname })),
    shortUrlBase: env.SHORT_URL_BASE,
  };
}

export async function action(args: PageRequestArgs): Promise<FolderActionData> {
  const { env, viewer, id } = await requireContext(args);
  const form = await args.request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "create") {
    const name = validName(form);
    if (!name) return { error: "Enter a folder name of 48 characters or less." };
    const result = await createFolder(env.DB, { name, actor: viewer, parentFolderId: id });
    return result.ok
      ? { ok: true, message: "Folder created." }
      : { error: "Could not create folder." };
  }
  if (intent === "rename") {
    const name = validName(form);
    if (!name) return { error: "Enter a folder name of 48 characters or less." };
    const result = await updateFolder(env.DB, { id, name, actor: viewer });
    return result.ok
      ? { ok: true, message: "Folder renamed." }
      : { error: "Could not rename folder." };
  }
  if (intent === "delete") {
    if (!(await deleteFolder(env.DB, { id, actor: viewer })))
      return { error: "Could not delete folder." };
    throw redirect("/folders");
  }
  if (intent === "addPermission") {
    const principalType = String(form.get("principalType"));
    const principalId = String(form.get("principalId") ?? "").trim();
    const role = String(form.get("role"));
    if ((principalType !== "user" && principalType !== "chapter") || !principalId) {
      return { error: "Choose a person or chapter to share with." };
    }
    if (principalType === "user" && !principalId.includes("@"))
      return { error: "Enter a valid email." };
    if (role !== "editor" && role !== "viewer") return { error: "Choose a valid permission." };
    const result = await addFolderPermission(env.DB, {
      ...viewer,
      folderId: id,
      principalType,
      principalId,
      role,
    });
    return result.ok
      ? { ok: true, message: "Folder shared." }
      : { error: "Could not update sharing." };
  }
  const permissionId = Number(form.get("permissionId"));
  if (!Number.isInteger(permissionId) || permissionId <= 0) return { error: "Invalid permission." };
  if (intent === "removePermission") {
    return (await removeFolderPermission(env.DB, { ...viewer, folderId: id, id: permissionId }))
      ? { ok: true, message: "Sharing removed." }
      : { error: "Could not remove sharing." };
  }
  if (intent === "updatePermissionRole") {
    const role = String(form.get("role"));
    if (role !== "editor" && role !== "viewer") return { error: "Choose a valid permission." };
    return (await updateFolderPermissionRole(env.DB, {
      ...viewer,
      folderId: id,
      id: permissionId,
      role,
    }))
      ? { ok: true, message: "Permission updated." }
      : { error: "Could not update sharing." };
  }
  return { error: "Unknown action." };
}

export type FoldersPageData = Awaited<ReturnType<typeof loader>>;
export type FoldersPageAction = Awaited<ReturnType<typeof action>>;
