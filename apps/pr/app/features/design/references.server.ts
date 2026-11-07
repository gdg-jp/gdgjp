import { REFERENCE_KINDS, type ReferenceKind } from "~/features/assets/asset";
import {
  type DesignReference,
  deleteReference,
  getReference,
  insertReference,
  newReferenceId,
  referenceKey,
} from "./reference.repository.server";

const MAX_BYTES = 8 * 1024 * 1024;
const TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Save one reference design (a person's own work) for a chapter. */
export async function addReference(
  env: Env,
  chapterId: number,
  userId: string,
  input: { file: File; kind: string; event: string; madeOn: string; note: string },
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const kind = (REFERENCE_KINDS as readonly string[]).includes(input.kind)
    ? (input.kind as ReferenceKind)
    : null;
  if (!kind) return { ok: false, error: "種類を選んでください" };
  if (!TYPES.has(input.file.type))
    return { ok: false, error: "JPEG、PNG、WebP の画像を選んでください" };
  if (input.file.size > MAX_BYTES) return { ok: false, error: "8 MB までの画像にしてください" };
  if (input.file.size < 1_000) return { ok: false, error: "画像が空です" };
  const madeOn = /^\d{4}-\d{2}-\d{2}$/.test(input.madeOn) ? input.madeOn : "";
  const id = newReferenceId();
  const r2Key = referenceKey(chapterId, id);
  await env.IMAGES.put(r2Key, await input.file.arrayBuffer(), {
    httpMetadata: { contentType: input.file.type },
  });
  await insertReference(env.DB, {
    id,
    chapterId,
    kind,
    event: input.event.trim().slice(0, 80),
    madeOn,
    note: input.note.trim().slice(0, 200),
    contentType: input.file.type,
    bytes: input.file.size,
    r2Key,
    createdBy: userId,
  });
  return { ok: true, id };
}

export async function removeReference(env: Env, chapterId: number, id: string): Promise<boolean> {
  const ref = await getReference(env.DB, id);
  if (!ref || ref.chapterId !== chapterId) return false;
  await env.IMAGES.delete(ref.r2Key);
  return deleteReference(env.DB, chapterId, id);
}

export type { DesignReference };
