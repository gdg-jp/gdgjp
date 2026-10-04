import { validateImageFile } from "./file";
import { canAccessImage } from "./policy";
import { probeImageDimensions } from "./probe.server";
import { deleteRenditionsForImage, deleteRenditionsForSource } from "./rendition-store.server";
import {
  type ImageRow,
  deleteImage,
  getImage,
  removeMobileImage,
  setMobileImage,
  updateImageBytes,
} from "./repository.server";
import { type ImageActor, type ImageServiceResult, fail, ok } from "./result";
import { deleteOriginal, putOriginal } from "./storage.server";

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
