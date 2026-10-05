import { type AuthUser, isSuperAdmin } from "@gdgjp/gdg-lib";

import { requireUserWithChapter } from "~/features/auth/auth-redirect";
import {
  canEditFolder,
  createFolder,
  deleteFolder,
  listAccessibleRootFoldersWithCounts,
  updateFolder,
} from "~/features/folders";
import type { PageRequestArgs } from "~/http/request";

export type FolderActionData = { ok: true; message?: string } | { error: string };

export function folderViewer(user: AuthUser, chapters: { chapterId: number }[]) {
  return {
    userId: user.id,
    email: user.email,
    chapterIds: chapters.map((chapter) => chapter.chapterId),
    isSuperAdmin: isSuperAdmin(user),
  };
}

export async function requireContext(args: PageRequestArgs) {
  const env = args.context.cloudflare.env;
  const { user, chapter, chapters } = await requireUserWithChapter(env, args.request);
  return { env, user, chapter, chapters, viewer: folderViewer(user, chapters) };
}

export function folderName(form: FormData): string | null {
  const name = String(form.get("name") ?? "").trim();
  if (!name) return null;
  return name.length <= 48 ? name : null;
}

export async function loader(args: PageRequestArgs) {
  const { env, user, chapters, viewer } = await requireContext(args);
  const folders = await listAccessibleRootFoldersWithCounts(env.DB, viewer);
  const editable = await Promise.all(
    folders.map((folder) => canEditFolder(env.DB, folder.id, viewer)),
  );
  return {
    user: { email: user.email, image: user.image, name: user.name },
    folders: folders.map((folder, index) => ({ ...folder, editable: editable[index] })),
    chapters,
  };
}

export async function action(args: PageRequestArgs): Promise<FolderActionData> {
  const { env, viewer } = await requireContext(args);
  const form = await args.request.formData();
  const intent = String(form.get("intent") ?? "");
  const id = Number(form.get("id"));

  if (intent === "create") {
    const name = folderName(form);
    if (!name) return { error: "Enter a folder name of 48 characters or less." };
    const parentFolderId = Number(form.get("parentFolderId"));
    const result = await createFolder(env.DB, {
      name,
      actor: viewer,
      ...(Number.isInteger(parentFolderId) && parentFolderId > 0 ? { parentFolderId } : {}),
    });
    return result.ok
      ? { ok: true, message: "Folder created." }
      : { error: `Folder \"${name}\" already exists.` };
  }

  if (!Number.isInteger(id) || id <= 0) return { error: "Invalid folder." };
  if (intent === "update") {
    const name = folderName(form);
    if (!name) return { error: "Enter a folder name of 48 characters or less." };
    const result = await updateFolder(env.DB, { id, name, actor: viewer });
    if (result.ok) return { ok: true, message: "Folder renamed." };
    return {
      error:
        result.reason === "duplicate" ? `Folder \"${name}\" already exists.` : "Folder not found.",
    };
  }
  if (intent === "delete") {
    return (await deleteFolder(env.DB, { id, actor: viewer }))
      ? { ok: true, message: "Folder deleted." }
      : { error: "You do not have permission to delete this folder." };
  }
  return { error: "Unknown action." };
}

export type FoldersPageData = Awaited<ReturnType<typeof loader>>;
export type FoldersPageAction = Awaited<ReturnType<typeof action>>;
