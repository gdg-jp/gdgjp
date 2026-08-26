import {
  type AuthUser,
  type ImageUploadInput,
  type ImageUploadResult,
  MAX_IMAGE_UPLOAD_BYTES,
  type UserChapter,
} from "@gdgjp/gdg-lib";
import { generateUniqueImageId } from "./id";
import { canMutateImage, resolveActorChapter } from "./policy";
import {
  type ImageRow,
  type ListImagesResult,
  createImage,
  deleteImage,
  getImage,
  listImagesByUser,
  parseImageListCursor,
  removeMobileImage,
  setMobileImage,
  updateImageBytes,
} from "./repository";
import { deleteOriginal, putOriginal } from "./storage";

export type ImageActor = { user: AuthUser; chapters: UserChapter[] };

export type ImageServiceErrorCode =
  | "missing_file"
  | "not_image"
  | "too_large"
  | "forbidden"
  | "not_found"
  | "chapter_required"
  | "invalid_cursor";

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
      width: null,
      height: null,
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
  opts: { chapterId?: number; limit?: number; cursor?: string | null } = {},
): Promise<ImageServiceResult<ListImagesResult>> {
  if (opts.chapterId !== undefined && !actor.chapters.some((c) => c.chapterId === opts.chapterId)) {
    return fail("forbidden");
  }
  let cursor: ReturnType<typeof parseImageListCursor> | null = null;
  if (opts.cursor) {
    cursor = parseImageListCursor(opts.cursor);
    if (!cursor) return fail("invalid_cursor");
  }
  const result = await listImagesByUser(env.DB, actor.user.id, {
    chapterId: opts.chapterId,
    limit: opts.limit,
    cursor,
  });
  return ok(result);
}

export async function getImageForActor(
  env: Env,
  actor: ImageActor,
  id: string,
): Promise<ImageServiceResult<ImageRow>> {
  const image = await getImage(env.DB, id);
  if (!image) return fail("not_found");
  if (!canMutateImage(actor.user, image)) return fail("forbidden");
  return ok(image);
}

/**
 * Replaces an existing image's bytes, reusing the same r2_key so the public
 * URL is stable. D1 persists first: if it fails, the existing public object
 * is left untouched rather than overwritten with content D1 never recorded.
 */
export async function replaceImageForActor(
  env: Env,
  actor: ImageActor,
  id: string,
  fileValue: FormDataEntryValue | null,
): Promise<ImageServiceResult<ImageRow>> {
  const image = await getImage(env.DB, id);
  if (!image) return fail("not_found");
  if (!canMutateImage(actor.user, image)) return fail("forbidden");
  const validated = validateImageFile(fileValue);
  if (!validated.ok) return fail(validated.error);

  const bytes = await validated.file.arrayBuffer();
  const filename = validated.file.name || image.filename;
  const updated = await updateImageBytes(env.DB, id, {
    contentType: validated.file.type,
    byteSize: bytes.byteLength,
    width: null,
    height: null,
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
  return ok(updated);
}

/** Same D1-first ordering as replaceImageForActor, see its docstring. */
export async function setMobileImageForActor(
  env: Env,
  actor: ImageActor,
  id: string,
  fileValue: FormDataEntryValue | null,
): Promise<ImageServiceResult<ImageRow>> {
  const image = await getImage(env.DB, id);
  if (!image) return fail("not_found");
  if (!canMutateImage(actor.user, image)) return fail("forbidden");
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
  if (!canMutateImage(actor.user, image)) return fail("forbidden");
  if (!image.mobileR2Key) return ok(image);

  const updated = await removeMobileImage(env.DB, id);
  ctx.waitUntil(deleteOriginal(env, image.mobileR2Key));
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
  if (!canMutateImage(actor.user, image)) return fail("forbidden");

  await deleteImage(env.DB, id);
  ctx.waitUntil(deleteOriginal(env, image.r2Key));
  if (image.mobileR2Key) ctx.waitUntil(deleteOriginal(env, image.mobileR2Key));
  return ok({ id });
}
