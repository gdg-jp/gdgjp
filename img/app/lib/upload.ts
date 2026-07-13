import {
  type ImageUploadInput,
  type ImageUploadResult,
  MAX_IMAGE_UPLOAD_BYTES,
} from "@gdgjp/gdg-lib";
import { generateUniqueImageId } from "~/lib/id";
import { createImage } from "~/lib/images";
import { deleteOriginal, putOriginal } from "~/lib/r2";

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

  return { id, url: `${env.APP_URL.replace(/\/$/, "")}/${id}` };
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
