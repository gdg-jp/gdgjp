import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import * as schema from "../../../app/db/schema";
import { getDb } from "../../../app/lib/db.server";

export interface PersistDocumentInput {
  sourceId: string;
  path: string;
  title: string;
  markdown: string;
  assets?: readonly PersistAssetInput[];
}

export interface PersistAssetInput {
  path: string;
  r2Key: string;
  mimeType: string;
  byteSize: number;
  contentHash: string;
}

export interface PersistDocumentResult {
  id: string;
  path: string;
  contentHash: string;
  r2Key: string;
  written: boolean;
}

export async function sha256Hex(value: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer,
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function contentR2Key(
  sourceId: string,
  sourceDocumentId: string,
  contentHash: string,
): string {
  return `raw/${sourceId}/${sourceDocumentId}/${contentHash}.md`;
}

/**
 * Upsert a source_document. Same content hash → skip R2 write and skip captured_at
 * update (raw immutability). Different hash → write a new R2 object and point r2_key
 * at it; old objects are never deleted.
 *
 * `assets` describes the images already stored by `resolveSourceAssets`. The rows are
 * rebuilt whenever the document changes so they always describe the current version;
 * the R2 objects they used to point at stay in the bucket.
 */
export async function persistSourceDocument(
  env: Env,
  input: PersistDocumentInput,
): Promise<PersistDocumentResult> {
  const db = getDb(env);
  const bytes = new TextEncoder().encode(input.markdown);
  const contentHash = await sha256Hex(bytes);

  const existing = await db
    .select()
    .from(schema.sourceDocuments)
    .where(
      and(
        eq(schema.sourceDocuments.sourceId, input.sourceId),
        eq(schema.sourceDocuments.path, input.path),
      ),
    )
    .get();

  if (existing && existing.contentHash === contentHash) {
    // Content is unchanged, so nothing is written — but a path that was archived by
    // reconciliation and has since reappeared has to come back, or an unchanged
    // document could stay retired forever.
    if (existing.status !== "ready") {
      await db
        .update(schema.sourceDocuments)
        .set({ status: "ready" })
        .where(eq(schema.sourceDocuments.id, existing.id));
    }
    return {
      id: existing.id,
      path: existing.path,
      contentHash: existing.contentHash,
      r2Key: existing.r2Key,
      written: false,
    };
  }

  const id = existing?.id ?? nanoid();
  const r2Key = contentR2Key(input.sourceId, id, contentHash);
  await env.BUCKET.put(r2Key, bytes, {
    httpMetadata: { contentType: "text/markdown; charset=utf-8" },
    customMetadata: { sha256: contentHash, path: input.path },
  });

  const now = new Date();
  if (existing) {
    await db
      .update(schema.sourceDocuments)
      .set({
        title: input.title,
        r2Key,
        contentHash,
        capturedAt: now,
        status: "ready",
      })
      .where(eq(schema.sourceDocuments.id, existing.id));
  } else {
    await db.insert(schema.sourceDocuments).values({
      id,
      sourceId: input.sourceId,
      path: input.path,
      title: input.title,
      r2Key,
      contentHash,
      capturedAt: now,
      status: "ready",
    });
  }

  await replaceSourceAssets(db, id, input.assets ?? []);

  return { id, path: input.path, contentHash, r2Key, written: true };
}

async function replaceSourceAssets(
  db: ReturnType<typeof getDb>,
  sourceDocumentId: string,
  assets: readonly PersistAssetInput[],
): Promise<void> {
  await db
    .delete(schema.sourceAssets)
    .where(eq(schema.sourceAssets.sourceDocumentId, sourceDocumentId));

  if (assets.length === 0) return;

  await db.insert(schema.sourceAssets).values(
    assets.map((asset) => ({
      id: nanoid(),
      sourceDocumentId,
      path: asset.path,
      r2Key: asset.r2Key,
      mimeType: asset.mimeType,
      byteSize: asset.byteSize,
      contentHash: asset.contentHash,
    })),
  );
}
