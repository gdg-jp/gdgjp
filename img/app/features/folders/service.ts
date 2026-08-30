import type { AuthUser, UserChapter } from "@gdgjp/gdg-lib";
import { validateFolderName } from "./name";
import { canAccessFolder } from "./policy";
import {
  type FolderRow,
  type ListFoldersResult,
  createFolder,
  deleteFolder,
  getFolder,
  listFoldersForChapters,
  parseFolderListCursor,
  renameFolder,
} from "./repository";

type Actor = { user: AuthUser; chapters: UserChapter[] };

export type FolderServiceErrorCode =
  | "invalid_name"
  | "name_taken"
  | "not_found"
  | "forbidden"
  | "chapter_required"
  | "invalid_cursor";

export type FolderServiceResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: FolderServiceErrorCode };

function ok<T>(value: T): FolderServiceResult<T> {
  return { ok: true, value };
}

function fail<T>(error: FolderServiceErrorCode): FolderServiceResult<T> {
  return { ok: false, error };
}

/**
 * Lists folders across the actor's chapter memberships, optionally narrowed
 * to one chapter and paginated (mirrors listImagesForActor's chapterId/
 * limit/cursor contract). Callers that want "every folder, no paging" (the
 * dashboard folder bar) simply don't pass limit/cursor and rely on the
 * generous default page size in the repository layer.
 */
export async function listFoldersForActor(
  env: Env,
  actor: Actor,
  opts: { chapterId?: number; limit?: number; cursor?: string | null } = {},
): Promise<FolderServiceResult<ListFoldersResult>> {
  if (opts.chapterId !== undefined && !actor.chapters.some((c) => c.chapterId === opts.chapterId)) {
    return fail("forbidden");
  }
  let cursor: ReturnType<typeof parseFolderListCursor> | null = null;
  if (opts.cursor) {
    cursor = parseFolderListCursor(opts.cursor);
    if (!cursor) return fail("invalid_cursor");
  }
  const chapterIds = actor.chapters.map((c) => c.chapterId);
  const result = await listFoldersForChapters(env.DB, chapterIds, {
    chapterId: opts.chapterId,
    limit: opts.limit,
    cursor,
  });
  return ok(result);
}

export async function getFolderForActor(
  env: Env,
  actor: Actor,
  id: number,
): Promise<FolderServiceResult<FolderRow>> {
  const folder = await getFolder(env.DB, id);
  if (!folder) return fail("not_found");
  if (!canAccessFolder(actor, folder)) return fail("forbidden");
  return ok(folder);
}

/**
 * Creates a folder in the given chapter (or the actor's sole chapter when
 * omitted). Requires membership in that chapter unless the actor is a super
 * admin.
 */
export async function createFolderForActor(
  env: Env,
  actor: Actor,
  input: { name: string; chapterId: number | null },
): Promise<FolderServiceResult<FolderRow>> {
  const validated = validateFolderName(input.name);
  if (!validated.ok) return fail("invalid_name");

  let chapterId = input.chapterId;
  if (chapterId === null) {
    if (actor.chapters.length !== 1) return fail("chapter_required");
    chapterId = actor.chapters[0].chapterId;
  } else if (!actor.chapters.some((c) => c.chapterId === chapterId)) {
    return fail("forbidden");
  }

  const result = await createFolder(env.DB, {
    chapterId,
    name: validated.name,
    createdByUserId: actor.user.id,
  });
  if (!result.ok) return fail(result.reason);
  return ok(result.folder);
}

export async function renameFolderForActor(
  env: Env,
  actor: Actor,
  id: number,
  name: string,
): Promise<FolderServiceResult<FolderRow>> {
  const validated = validateFolderName(name);
  if (!validated.ok) return fail("invalid_name");

  const folder = await getFolder(env.DB, id);
  if (!folder) return fail("not_found");
  if (!canAccessFolder(actor, folder)) return fail("forbidden");

  const result = await renameFolder(env.DB, id, validated.name);
  if (!result.ok) return fail(result.reason);
  return ok(result.folder);
}

/** Images in the folder are not deleted; they fall back to unfiled. */
export async function deleteFolderForActor(
  env: Env,
  actor: Actor,
  id: number,
): Promise<FolderServiceResult<{ id: number }>> {
  const folder = await getFolder(env.DB, id);
  if (!folder) return fail("not_found");
  if (!canAccessFolder(actor, folder)) return fail("forbidden");

  await deleteFolder(env.DB, id);
  return ok({ id });
}
