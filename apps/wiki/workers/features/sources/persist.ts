import { and, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import * as schema from "../../../app/db/schema";
import { rawObjectKey, rawObjectMetadata } from "../../../app/features/sources/raw-object";
export { rawObjectKey, rawObjectMetadata };
import { getDb } from "../../../app/lib/db.server";
import { extensionFor } from "./media-type";

export interface PersistDocumentInput {
  sourceId: string;
  fetchAttemptId: string;
  path: string;
  title: string;
  body: Uint8Array;
  mediaType: string;
  cursor?: string | null;
  metadata?: string | null;
  assets?: readonly PersistAssetInput[];
  assetPolicy?: "replace" | "merge";
}

export interface PersistAssetInput {
  path: string;
  r2Key: string;
  mimeType: string;
  byteSize: number;
  contentHash: string;
}

export interface PersistDocumentResult {
  skipped: boolean;
  id?: string;
  path?: string;
  contentHash?: string;
  r2Key?: string;
  written?: boolean;
  contentChanged?: boolean;
}

export function sourceFetchAttemptIsCurrent(sourceId: string, fetchAttemptId: string) {
  return sql`EXISTS (
    SELECT 1 FROM ${schema.sources}
    WHERE ${schema.sources.id} = ${sourceId}
      AND ${schema.sources.fetchAttemptId} = ${fetchAttemptId}
      AND ${schema.sources.status} = 'fetching'
  )`;
}

export async function isSourceFetchAttemptCurrent(
  db: ReturnType<typeof getDb>,
  sourceId: string,
  fetchAttemptId: string,
): Promise<boolean> {
  return Boolean(await currentLeasedSource(db, sourceId, fetchAttemptId));
}

async function currentLeasedSource(
  db: ReturnType<typeof getDb>,
  sourceId: string,
  fetchAttemptId: string,
) {
  return db
    .select({
      id: schema.sources.id,
      spaceId: schema.sources.spaceId,
      visibility: schema.sources.visibility,
      chapterId: schema.sources.chapterId,
      addedBy: schema.sources.addedBy,
    })
    .from(schema.sources)
    .where(
      and(
        eq(schema.sources.id, sourceId),
        eq(schema.sources.fetchAttemptId, fetchAttemptId),
        eq(schema.sources.status, "fetching"),
      ),
    )
    .get();
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
  mediaType: string,
): string {
  return `raw/${sourceId}/${sourceDocumentId}/${contentHash}${extensionFor(mediaType)}`;
}

export async function persistSourceDocument(
  env: Env,
  input: PersistDocumentInput,
): Promise<PersistDocumentResult> {
  const db = getDb(env);
  const source = await currentLeasedSource(db, input.sourceId, input.fetchAttemptId);
  if (!source) return { skipped: true };

  const contentHash = await sha256Hex(input.body);

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

  const targetKey = rawObjectKey(source.spaceId, input.sourceId, input.path);
  if (
    existing &&
    existing.contentHash === contentHash &&
    existing.r2Key === targetKey &&
    existing.status === "ready"
  ) {
    const patch: {
      status?: string;
      cursor?: string | null;
      metadata?: string | null;
      mediaType?: string;
    } = {};
    if (existing.status !== "ready") patch.status = "ready";
    if (input.cursor !== undefined && input.cursor !== existing.cursor) {
      patch.cursor = input.cursor;
    }
    if (input.metadata !== undefined && input.metadata !== existing.metadata) {
      patch.metadata = input.metadata;
    }
    if (input.mediaType !== existing.mediaType) patch.mediaType = input.mediaType;
    if (Object.keys(patch).length > 0) {
      const updated = await db
        .update(schema.sourceDocuments)
        .set(patch)
        .where(
          and(
            eq(schema.sourceDocuments.id, existing.id),
            eq(schema.sourceDocuments.sourceId, input.sourceId),
            sourceFetchAttemptIsCurrent(input.sourceId, input.fetchAttemptId),
          ),
        )
        .returning({ id: schema.sourceDocuments.id })
        .get();
      if (!updated) return { skipped: true };
    }
    return {
      skipped: false,
      id: existing.id,
      path: existing.path,
      contentHash: existing.contentHash,
      r2Key: existing.r2Key,
      written: false,
    };
  }

  const id = existing?.id ?? nanoid();
  const r2Key = targetKey;
  await env.BUCKET.put(r2Key, input.body, {
    httpMetadata: {
      contentType: input.mediaType.startsWith("text/")
        ? `${input.mediaType}; charset=utf-8`
        : input.mediaType,
    },
    customMetadata: rawObjectMetadata(source, { sha256: contentHash, path: input.path }),
  });
  const contentChanged = !existing || existing.contentHash !== contentHash;

  const now = new Date();
  const documentMutation = existing
    ? db
        .update(schema.sourceDocuments)
        .set({
          title: input.title,
          r2Key,
          contentHash,
          mediaType: input.mediaType,
          capturedAt: now,
          status: "ready",
          ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
          ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
        })
        .where(
          and(
            eq(schema.sourceDocuments.id, existing.id),
            eq(schema.sourceDocuments.sourceId, input.sourceId),
            sourceFetchAttemptIsCurrent(input.sourceId, input.fetchAttemptId),
          ),
        )
        .returning({ id: schema.sourceDocuments.id })
    : db
        .insert(schema.sourceDocuments)
        .select(
          db
            .select({
              id: sql<string>`${id}`.as("id"),
              sourceId: sql<string>`${input.sourceId}`.as("source_id"),
              path: sql<string>`${input.path}`.as("path"),
              title: sql<string>`${input.title}`.as("title"),
              r2Key: sql<string>`${r2Key}`.as("r2_key"),
              contentHash: sql<string>`${contentHash}`.as("content_hash"),
              mediaType: sql<string>`${input.mediaType}`.as("media_type"),
              capturedAt: sql<number>`${now.getTime()}`.as("captured_at"),
              cursor: sql<string | null>`${input.cursor ?? null}`.as("cursor"),
              metadata: sql<string | null>`${input.metadata ?? null}`.as("metadata"),
              status: sql<string>`'ready'`.as("status"),
              integratedHash: sql<string | null>`NULL`.as("integrated_hash"),
            })
            .from(schema.sources)
            .where(
              and(
                eq(schema.sources.id, input.sourceId),
                eq(schema.sources.fetchAttemptId, input.fetchAttemptId),
                eq(schema.sources.status, "fetching"),
              ),
            ),
        )
        .returning({ id: schema.sourceDocuments.id });

  const policy = input.assetPolicy ?? "replace";
  const currentAssets =
    policy === "merge"
      ? await db
          .select({ r2Key: schema.sourceAssets.r2Key })
          .from(schema.sourceAssets)
          .where(eq(schema.sourceAssets.sourceDocumentId, id))
          .all()
      : [];
  const existingR2Keys = new Set(currentAssets.map((asset) => asset.r2Key));
  const assetMutations = [];
  if (policy === "replace") {
    assetMutations.push(
      db
        .delete(schema.sourceAssets)
        .where(
          and(
            eq(schema.sourceAssets.sourceDocumentId, id),
            sourceFetchAttemptIsCurrent(input.sourceId, input.fetchAttemptId),
          ),
        ),
    );
  }
  for (const asset of input.assets ?? []) {
    if (existingR2Keys.has(asset.r2Key)) continue;
    existingR2Keys.add(asset.r2Key);
    assetMutations.push(
      db.insert(schema.sourceAssets).select(
        db
          .select({
            id: sql<string>`${nanoid()}`.as("id"),
            sourceDocumentId: sql<string>`${id}`.as("source_document_id"),
            path: sql<string>`${asset.path}`.as("path"),
            r2Key: sql<string>`${asset.r2Key}`.as("r2_key"),
            mimeType: sql<string>`${asset.mimeType}`.as("mime_type"),
            byteSize: sql<number>`${asset.byteSize}`.as("byte_size"),
            contentHash: sql<string>`${asset.contentHash}`.as("content_hash"),
          })
          .from(schema.sourceDocuments)
          .where(
            and(
              eq(schema.sourceDocuments.id, id),
              eq(schema.sourceDocuments.sourceId, input.sourceId),
              sourceFetchAttemptIsCurrent(input.sourceId, input.fetchAttemptId),
            ),
          ),
      ),
    );
  }
  const batchResults = await db.batch([documentMutation, ...assetMutations]);
  const documentRows = batchResults[0];
  if (!Array.isArray(documentRows) || documentRows.length === 0) return { skipped: true };

  return {
    skipped: false,
    id,
    path: input.path,
    contentHash,
    r2Key,
    written: true,
    contentChanged,
  };
}
