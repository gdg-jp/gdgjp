import { newId } from "./model";

/** The editor shrinks images to 256px before upload; this is a hard cap. */
export const MAX_IMAGE_BYTES = 1024 * 1024;

const TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type ImageType = (typeof TYPES)[number];

export function imageKey(deckId: string, imageId: string): string {
  return `decks/${deckId}/${imageId}`;
}

/**
 * The real type from the file's first bytes. SVG (scripts) and anything else
 * is refused whatever the browser claimed.
 */
export function sniffImageType(bytes: Uint8Array): ImageType | null {
  const at = (i: number) => bytes[i] ?? -1;
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return "image/png";
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  if (
    at(0) === 0x52 &&
    at(1) === 0x49 &&
    at(2) === 0x46 &&
    at(3) === 0x46 &&
    at(8) === 0x57 &&
    at(9) === 0x45 &&
    at(10) === 0x42 &&
    at(11) === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

export type UploadResult = { ok: true; id: string } | { ok: false; error: "size" | "type" };

export async function uploadImage(env: Env, deckId: string, file: File): Promise<UploadResult> {
  if (file.size === 0 || file.size > MAX_IMAGE_BYTES) return { ok: false, error: "size" };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffImageType(bytes);
  if (!type) return { ok: false, error: "type" };
  const id = newId();
  await env.IMAGES.put(imageKey(deckId, id), bytes, { httpMetadata: { contentType: type } });
  await env.DB.prepare(
    "INSERT INTO deck_image (id, deck_id, content_type, size) VALUES (?, ?, ?, ?)",
  )
    .bind(id, deckId, type, bytes.byteLength)
    .run();
  return { ok: true, id };
}

export async function getImage(env: Env, deckId: string, imageId: string) {
  return env.IMAGES.get(imageKey(deckId, imageId));
}

/** Copies every image of a deck to another (deck duplication keeps image ids). */
export async function copyImages(env: Env, fromDeck: string, toDeck: string): Promise<void> {
  const { results } = await env.DB.prepare(
    "SELECT id, content_type, size FROM deck_image WHERE deck_id = ?",
  )
    .bind(fromDeck)
    .all<{ id: string; content_type: string; size: number }>();
  for (const row of results) {
    const obj = await env.IMAGES.get(imageKey(fromDeck, row.id));
    if (!obj) continue;
    await env.IMAGES.put(imageKey(toDeck, row.id), await obj.arrayBuffer(), {
      httpMetadata: { contentType: row.content_type },
    });
    await env.DB.prepare(
      "INSERT INTO deck_image (id, deck_id, content_type, size) VALUES (?, ?, ?, ?)",
    )
      .bind(row.id, toDeck, row.content_type, row.size)
      .run();
  }
}

/**
 * Removes images the saved layout no longer uses. Only images older than a day:
 * a fresh upload may belong to another editor's unsaved changes.
 */
export async function pruneImages(env: Env, deckId: string, keep: Set<string>): Promise<void> {
  const { results } = await env.DB.prepare(
    "SELECT id FROM deck_image WHERE deck_id = ? AND created_at < unixepoch() - 86400",
  )
    .bind(deckId)
    .all<{ id: string }>();
  const unused = results.map((r) => r.id).filter((id) => !keep.has(id));
  if (unused.length === 0) return;
  await env.IMAGES.delete(unused.map((id) => imageKey(deckId, id)));
  await env.DB.batch(
    unused.map((id) =>
      env.DB.prepare("DELETE FROM deck_image WHERE deck_id = ? AND id = ?").bind(deckId, id),
    ),
  );
}

export async function deleteAllImages(env: Env, deckId: string): Promise<void> {
  const { results } = await env.DB.prepare("SELECT id FROM deck_image WHERE deck_id = ?")
    .bind(deckId)
    .all<{ id: string }>();
  if (results.length > 0) await env.IMAGES.delete(results.map((r) => imageKey(deckId, r.id)));
}
