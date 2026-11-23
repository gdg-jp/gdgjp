import {
  type ImageUploadInput,
  type ImageUploadResult,
  MAX_IMAGE_UPLOAD_BYTES,
} from "@gdgjp/gdg-lib";
import { canAccessFolder } from "~/features/folders/policy";
import { getFolder } from "~/features/folders/repository.server";
import { validateImageFile } from "./file";
import { generateUniqueImageId } from "./id.server";
import { imageUrl } from "./img-url";
import { setImageFolderForActor } from "./metadata.server";
import { resolveActorChapter } from "./policy";
import { probeImageDimensions } from "./probe.server";
import { createImage } from "./repository.server";
import { type ImageActor, type ImageServiceResult, fail, ok } from "./result";
import { deleteOriginal, putOriginal } from "./storage.server";

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
      .prepare(`UPDATE "user" SET name = ?, image = ?, updated_at = ? WHERE id = ?`)
      .bind(user.name, user.image, now, existing.id)
      .run();
    return existing.id;
  }

  await db
    .prepare(
      `INSERT INTO "user" (id, email, name, image, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(user.id, user.email, user.name, user.image, now, now)
    .run();
  return user.id;
}

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

export async function uploadImageToFolderForActor(
  env: Env,
  ctx: ExecutionContext,
  actor: ImageActor,
  input: Omit<ImageUploadInput, "user" | "chapterId">,
  folderId: number,
): Promise<ImageServiceResult<ImageUploadResult>> {
  const folder = await getFolder(env.DB, folderId);
  if (!folder) return fail("folder_not_found");
  if (!canAccessFolder(actor, folder)) return fail("forbidden");

  const result = await uploadImage(env, ctx, {
    ...input,
    user: actor.user,
    chapterId: folder.chapterId,
  });
  await setImageFolderForActor(env, actor, result.id, folder.id);
  return ok(result);
}
