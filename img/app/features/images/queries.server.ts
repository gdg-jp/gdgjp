import { canAccessFolder } from "~/features/folders/policy";
import { getFolder } from "~/features/folders/repository.server";
import { canAccessImage } from "./policy";
import {
  type ImageRow,
  type ListImagesResult,
  getImage,
  listVisibleImages,
  parseImageListCursor,
} from "./repository.server";
import { type ImageActor, type ImageServiceResult, fail, ok } from "./result";

export async function listImagesForActor(
  env: Env,
  actor: ImageActor,
  opts: {
    chapterId?: number;
    folderId?: number | null;
    limit?: number;
    cursor?: string | null;
  } = {},
): Promise<ImageServiceResult<ListImagesResult>> {
  if (opts.chapterId !== undefined && !actor.chapters.some((c) => c.chapterId === opts.chapterId)) {
    return fail("forbidden");
  }
  if (opts.folderId !== undefined && opts.folderId !== null) {
    const folder = await getFolder(env.DB, opts.folderId);
    if (!folder) return fail("folder_not_found");
    if (!canAccessFolder(actor, folder)) return fail("forbidden");
  }
  let cursor: ReturnType<typeof parseImageListCursor> | null = null;
  if (opts.cursor) {
    cursor = parseImageListCursor(opts.cursor);
    if (!cursor) return fail("invalid_cursor");
  }
  const result = await listVisibleImages(
    env.DB,
    { userId: actor.user.id, chapterIds: actor.chapters.map((c) => c.chapterId) },
    { chapterId: opts.chapterId, folderId: opts.folderId, limit: opts.limit, cursor },
  );
  return ok(result);
}

export async function getImageForActor(
  env: Env,
  actor: ImageActor,
  id: string,
): Promise<ImageServiceResult<ImageRow>> {
  const image = await getImage(env.DB, id);
  if (!image) return fail("not_found");
  if (!canAccessImage(actor, image)) return fail("forbidden");
  return ok(image);
}
