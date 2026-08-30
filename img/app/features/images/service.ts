import {
  type AuthUser,
  type ImageUploadInput,
  type ImageUploadResult,
  MAX_IMAGE_UPLOAD_BYTES,
  type UserChapter,
} from "@gdgjp/gdg-lib";
import { canAccessFolder } from "~/features/folders/policy";
import { getFolder } from "~/features/folders/repository";
import { generateUniqueImageId } from "./id";
import { canAccessImage, canShareImageWithChapter, resolveActorChapter } from "./policy";
import { probeImageDimensions } from "./probe";
import { deleteRenditionsForImage, deleteRenditionsForSource } from "./rendition-store";
import {
  type ImageRow,
  type ListImagesResult,
  createImage,
  deleteImage,
  getImage,
  listVisibleImages,
  parseImageListCursor,
  removeMobileImage,
  setImageChapter,
  setImageFolder,
  setImageSlug,
  setMobileImage,
  updateImageAttributes,
  updateImageBytes,
} from "./repository";
import { validateSlug } from "./slug";
import { deleteOriginal, putOriginal } from "./storage";

export type ImageActor = { user: AuthUser; chapters: UserChapter[] };

export type ImageServiceErrorCode =
  | "missing_file"
  | "not_image"
  | "too_large"
  | "forbidden"
  | "not_found"
  | "chapter_required"
  | "invalid_cursor"
  | "invalid_slug"
  | "slug_taken"
  | "folder_not_found"
  | "folder_chapter_mismatch"
  | "invalid_request";

export type ImageServiceResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ImageServiceErrorCode };

function ok<T>(value: T): ImageServiceResult<T> {
  return { ok: true, value };
}

function fail<T>(error: ImageServiceErrorCode): ImageServiceResult<T> {
  return { ok: false, error };
}

type ValidatedFile = { ok: true; file: File } | { ok: false; error: ImageServiceErrorCode };

/**
 * Reads the `file` multipart field and enforces the shared image/* and
 * MAX_IMAGE_UPLOAD_BYTES contract. Takes the raw form value (not
 * pre-extracted bytes) so callers can run policy checks — e.g. does this
 * image exist and can this actor mutate it — before validating the upload.
 */
function validateImageFile(value: FormDataEntryValue | null): ValidatedFile {
  if (!(value instanceof File)) return { ok: false, error: "missing_file" };
  if (!value.type.startsWith("image/")) return { ok: false, error: "not_image" };
  if (value.size > MAX_IMAGE_UPLOAD_BYTES) return { ok: false, error: "too_large" };
  return { ok: true, file: value };
}

export function imageUrl(env: Env, id: string): string {
  return `${env.APP_URL.replace(/\/$/, "")}/${id}`;
}

/** Canonical public URL for a known row: the custom slug when set, else the id. */
export function imageUrlFor(env: Env, image: Pick<ImageRow, "id" | "slug">): string {
  return `${env.APP_URL.replace(/\/$/, "")}/${image.slug ?? image.id}`;
}

/**
 * Creates a brand-new image: R2 write happens before the D1 insert (the row
 * references the object), so a D1 failure rolls back the just-written object.
 * Reused as-is by the cookie-session upload route, the local-dev internal
 * upload route, and the ImageUploadService RPC entrypoint used by tinyurl.
 */
export async function uploadImage(
  env: Env,
  ctx: ExecutionContext,
  input: ImageUploadInput,
): Promise<ImageUploadResult> {
  if (
    !input.user.id ||
    !input.user.email ||
    !Number.isInteger(input.chapterId) ||
    input.chapterId <= 0
  ) {
    throw new Error("Invalid image owner");
  }
  if (!input.contentType.startsWith("image/")) {
    throw new Error("Please choose an image file.");
  }
  if (input.bytes.byteLength > MAX_IMAGE_UPLOAD_BYTES) {
    throw new Error("Image must be 10 MB or smaller.");
  }

  const ownerId = await upsertImageOwner(env.DB, input.user);
  const id = await generateUniqueImageId(env.DB);
  const dimensions =
    input.contentType === "image/svg+xml" ? null : await probeImageDimensions(env, input.bytes);
  await putOriginal(env, id, input.bytes, {
    contentType: input.contentType,
    userId: ownerId,
    chapterId: input.chapterId,
    filename: input.filename,
  });

  try {
    await createImage(env.DB, {
      id,
      userId: ownerId,
      accountId: ownerId,
      chapterId: input.chapterId,
      r2Key: id,
      contentType: input.contentType,
      byteSize: input.bytes.byteLength,
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
      filename: input.filename,
    });
  } catch (error) {
    ctx.waitUntil(deleteOriginal(env, id));
    throw error;
  }

  return { id, url: imageUrl(env, id) };
}

async function upsertImageOwner(db: D1Database, user: ImageUploadInput["user"]): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const existing = await db
    .prepare(`SELECT id FROM "user" WHERE email = ? LIMIT 1`)
    .bind(user.email)
    .first<{ id: string }>();
  if (existing) {
    await db
      .prepare(`UPDATE "user" SET name = ?, image = ?, is_admin = ?, updated_at = ? WHERE id = ?`)
      .bind(user.name, user.image, user.isAdmin ? 1 : 0, now, existing.id)
      .run();
    return existing.id;
  }

  await db
    .prepare(
      `INSERT INTO "user" (id, email, name, image, is_admin, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(user.id, user.email, user.name, user.image, user.isAdmin ? 1 : 0, now, now)
    .run();
  return user.id;
}

/**
 * CLI-facing upload: unlike the dashboard's single "primary" chapter, a
 * bearer-token caller may belong to several chapters and must select one.
 */
export async function uploadImageForActor(
  env: Env,
  ctx: ExecutionContext,
  actor: ImageActor,
  fileValue: FormDataEntryValue | null,
  requestedChapterId: number | null,
): Promise<ImageServiceResult<ImageUploadResult>> {
  const chapter = resolveActorChapter(actor.chapters, requestedChapterId);
  if (!chapter.ok) return fail(chapter.error);
  const validated = validateImageFile(fileValue);
  if (!validated.ok) return fail(validated.error);

  const result = await uploadImage(env, ctx, {
    bytes: await validated.file.arrayBuffer(),
    contentType: validated.file.type,
    filename: validated.file.name || null,
    user: actor.user,
    chapterId: chapter.chapterId,
  });
  return ok(result);
}

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

/**
 * Replaces an existing image's bytes, reusing the same r2_key so the public
 * URL is stable. D1 persists first: if it fails, the existing public object
 * is left untouched rather than overwritten with content D1 never recorded.
 */
export async function replaceImageForActor(
  env: Env,
  ctx: ExecutionContext,
  actor: ImageActor,
  id: string,
  fileValue: FormDataEntryValue | null,
): Promise<ImageServiceResult<ImageRow>> {
  const image = await getImage(env.DB, id);
  if (!image) return fail("not_found");
  if (!canAccessImage(actor, image)) return fail("forbidden");
  const validated = validateImageFile(fileValue);
  if (!validated.ok) return fail(validated.error);

  const bytes = await validated.file.arrayBuffer();
  const filename = validated.file.name || image.filename;
  const dimensions =
    validated.file.type === "image/svg+xml" ? null : await probeImageDimensions(env, bytes);
  const updated = await updateImageBytes(env.DB, id, {
    contentType: validated.file.type,
    byteSize: bytes.byteLength,
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
    filename,
  });
  try {
    await putOriginal(env, image.r2Key, bytes, {
      contentType: validated.file.type,
      userId: image.userId,
      chapterId: image.chapterId,
      filename,
    });
  } catch (error) {
    await updateImageBytes(env.DB, id, {
      contentType: image.contentType,
      byteSize: image.byteSize,
      width: image.width,
      height: image.height,
      filename: image.filename,
    }).catch(() => {});
    throw error;
  }
  ctx.waitUntil(
    deleteRenditionsForSource(env, id, { variant: "d", sourceVersion: image.updatedAt }),
  );
  return ok(updated);
}

/** Same D1-first ordering as replaceImageForActor, see its docstring. */
export async function setMobileImageForActor(
  env: Env,
  ctx: ExecutionContext,
  actor: ImageActor,
  id: string,
  fileValue: FormDataEntryValue | null,
): Promise<ImageServiceResult<ImageRow>> {
  const image = await getImage(env.DB, id);
  if (!image) return fail("not_found");
  if (!canAccessImage(actor, image)) return fail("forbidden");
  const validated = validateImageFile(fileValue);
  if (!validated.ok) return fail(validated.error);

  const bytes = await validated.file.arrayBuffer();
  const filename = validated.file.name || null;
  const r2Key = `${id}/mobile`;
  const updated = await setMobileImage(env.DB, id, {
    r2Key,
    contentType: validated.file.type,
    byteSize: bytes.byteLength,
    filename,
  });
  try {
    await putOriginal(env, r2Key, bytes, {
      contentType: validated.file.type,
      userId: image.userId,
      chapterId: image.chapterId,
      filename,
    });
  } catch (error) {
    await revertMobileImage(env.DB, id, image).catch(() => {});
    throw error;
  }
  if (image.mobileUpdatedAt !== null) {
    ctx.waitUntil(
      deleteRenditionsForSource(env, id, {
        variant: "m",
        sourceVersion: image.mobileUpdatedAt,
      }),
    );
  }
  ctx.waitUntil(
    deleteRenditionsForSource(env, id, { variant: "d", sourceVersion: image.updatedAt }),
  );
  return ok(updated);
}

/** Restores the previously persisted mobile-variant metadata after a failed R2 write. */
async function revertMobileImage(db: D1Database, id: string, previous: ImageRow): Promise<void> {
  if (
    previous.mobileR2Key &&
    previous.mobileContentType !== null &&
    previous.mobileByteSize !== null
  ) {
    await setMobileImage(db, id, {
      r2Key: previous.mobileR2Key,
      contentType: previous.mobileContentType,
      byteSize: previous.mobileByteSize,
      filename: previous.mobileFilename,
    });
  } else {
    await removeMobileImage(db, id);
  }
}

export async function removeMobileImageForActor(
  env: Env,
  ctx: ExecutionContext,
  actor: ImageActor,
  id: string,
): Promise<ImageServiceResult<ImageRow>> {
  const image = await getImage(env.DB, id);
  if (!image) return fail("not_found");
  if (!canAccessImage(actor, image)) return fail("forbidden");
  if (!image.mobileR2Key) return ok(image);

  const updated = await removeMobileImage(env.DB, id);
  ctx.waitUntil(deleteOriginal(env, image.mobileR2Key));
  if (image.mobileUpdatedAt !== null) {
    ctx.waitUntil(
      deleteRenditionsForSource(env, id, {
        variant: "m",
        sourceVersion: image.mobileUpdatedAt,
      }),
    );
  }
  ctx.waitUntil(
    deleteRenditionsForSource(env, id, { variant: "d", sourceVersion: image.updatedAt }),
  );
  return ok(updated);
}

export async function deleteImageForActor(
  env: Env,
  ctx: ExecutionContext,
  actor: ImageActor,
  id: string,
): Promise<ImageServiceResult<{ id: string }>> {
  const image = await getImage(env.DB, id);
  if (!image) return fail("not_found");
  if (!canAccessImage(actor, image)) return fail("forbidden");

  await deleteImage(env.DB, id);
  ctx.waitUntil(deleteOriginal(env, image.r2Key));
  if (image.mobileR2Key) ctx.waitUntil(deleteOriginal(env, image.mobileR2Key));
  ctx.waitUntil(deleteRenditionsForImage(env, id));
  return ok({ id });
}
