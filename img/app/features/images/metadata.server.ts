import { canAccessFolder } from "~/features/folders/policy";
import { getFolder } from "~/features/folders/repository.server";
import { canAccessImage, canShareImageWithChapter } from "./policy";
import {
  type ImageRow,
  getImage,
  setImageChapter,
  setImageFolder,
  setImageSlug,
  updateImageAttributes,
} from "./repository.server";
import { type ImageActor, type ImageServiceResult, fail, ok } from "./result";
import { validateSlug } from "./slug";

/**
 * Sets or clears an image's custom slug. An empty/whitespace-only value clears
 * it. `validateSlug`'s three rejection reasons collapse into `invalid_slug`;
 * the HTTP error mappers turn that into human-readable text. Keyed by id — the
 * slug namespace is only resolved by the public serve route.
 */
export async function setImageSlugForActor(
  env: Env,
  actor: ImageActor,
  id: string,
  rawSlug: string | null,
): Promise<ImageServiceResult<ImageRow>> {
  const image = await getImage(env.DB, id);
  if (!image) return fail("not_found");
  if (!canAccessImage(actor, image)) return fail("forbidden");

  const trimmed = (rawSlug ?? "").trim();
  const next = trimmed === "" ? null : trimmed;
  if (next !== null && !validateSlug(next).ok) return fail("invalid_slug");
  if (image.slug === next) return ok(image);

  const result = await setImageSlug(env.DB, id, next);
  if (!result.ok) return fail(result.reason);
  return ok(result.image);
}

/**
 * Assigns or clears (folderId === null) an image's folder. The folder must
 * belong to the image's current chapter — a folder is scoped to one chapter,
 * so cross-chapter assignment is rejected rather than silently reattributing
 * either side.
 */
export async function setImageFolderForActor(
  env: Env,
  actor: ImageActor,
  id: string,
  folderId: number | null,
): Promise<ImageServiceResult<ImageRow>> {
  const image = await getImage(env.DB, id);
  if (!image) return fail("not_found");
  if (!canAccessImage(actor, image)) return fail("forbidden");

  if (folderId === null) {
    if (image.folderId === null) return ok(image);
    return ok(await setImageFolder(env.DB, id, null));
  }

  const folder = await getFolder(env.DB, folderId);
  if (!folder) return fail("folder_not_found");
  if (!canAccessFolder(actor, folder)) return fail("forbidden");
  if (folder.chapterId !== image.chapterId) return fail("folder_chapter_mismatch");
  if (image.folderId === folderId) return ok(image);

  return ok(await setImageFolder(env.DB, id, folderId));
}

/**
 * Re-shares an image with a different chapter the actor belongs to. Clears
 * the image's folder as a side effect, since a folder belongs to exactly one
 * chapter (see setImageChapter).
 */
export async function setImageChapterForActor(
  env: Env,
  actor: ImageActor,
  id: string,
  chapterId: number,
): Promise<ImageServiceResult<ImageRow>> {
  const image = await getImage(env.DB, id);
  if (!image) return fail("not_found");
  if (!canAccessImage(actor, image)) return fail("forbidden");
  if (image.chapterId === chapterId) return ok(image);
  if (!canShareImageWithChapter(actor, chapterId)) return fail("forbidden");

  return ok(await setImageChapter(env.DB, id, chapterId));
}

export type UpdateImagePatch = {
  slug?: string | null;
  folderId?: number | null;
  chapterId?: number;
};

/**
 * Applies any combination of slug/folderId/chapterId to an image as a single
 * atomic change: every field is checked against the prospective final state
 * — including cross-field interactions like "does this folder belong to the
 * chapter we're moving to?" — before anything is written, and the write
 * itself is one UPDATE statement (updateImageAttributes). This guarantees a
 * later field failing (e.g. an unknown folderId) can never leave an earlier
 * field's change (e.g. a chapter reassignment) already committed.
 *
 * A chapterId change without an explicit folderId in the same patch clears
 * the folder, since a folder belongs to exactly one chapter. When both are
 * given together, the client's folderId is validated against the *new*
 * chapter, so moving an image and its folder to a new chapter in one call
 * works as expected.
 */
export async function updateImageForActor(
  env: Env,
  actor: ImageActor,
  id: string,
  patch: UpdateImagePatch,
): Promise<ImageServiceResult<ImageRow>> {
  const image = await getImage(env.DB, id);
  if (!image) return fail("not_found");
  if (!canAccessImage(actor, image)) return fail("forbidden");

  const hasChapterId = "chapterId" in patch;
  const hasFolderId = "folderId" in patch;
  const hasSlug = "slug" in patch;

  let chapterId = image.chapterId;
  if (hasChapterId) {
    chapterId = patch.chapterId as number;
    if (chapterId !== image.chapterId && !canShareImageWithChapter(actor, chapterId)) {
      return fail("forbidden");
    }
  }

  let folderId = image.folderId;
  if (hasFolderId) {
    folderId = patch.folderId ?? null;
    if (folderId !== null) {
      const folder = await getFolder(env.DB, folderId);
      if (!folder) return fail("folder_not_found");
      if (!canAccessFolder(actor, folder)) return fail("forbidden");
      if (folder.chapterId !== chapterId) return fail("folder_chapter_mismatch");
    }
  } else if (chapterId !== image.chapterId) {
    // The chapter is changing and the caller didn't say where the folder
    // should land — clear it, since the old folder cannot belong to the new
    // chapter.
    folderId = null;
  }

  let slug = image.slug;
  if (hasSlug) {
    const trimmed = (patch.slug ?? "").trim();
    slug = trimmed === "" ? null : trimmed;
    if (slug !== null && !validateSlug(slug).ok) return fail("invalid_slug");
  }

  if (chapterId === image.chapterId && folderId === image.folderId && slug === image.slug) {
    return ok(image);
  }

  const result = await updateImageAttributes(env.DB, id, { chapterId, folderId, slug });
  if (!result.ok) return fail(result.reason);
  return ok(result.image);
}
