import {
  type ImageUploadInput,
  type ImageUploadResult,
  MAX_IMAGE_UPLOAD_BYTES,
} from "@gdgjp/gdg-lib";
import { validateImageFile } from "./file";
import { generateUniqueImageId } from "./id.server";
import { imageUrl } from "./img-url";
import { resolveActorChapter } from "./policy";
import { probeImageDimensions } from "./probe.server";
import { createImage } from "./repository.server";
import { type ImageActor, type ImageServiceResult, fail, ok } from "./result";
import { deleteOriginal, putOriginal } from "./storage.server";

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
