import { and, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import * as schema from "../../../app/db/schema";
import { getDb } from "../../../app/lib/db.server";
import { extensionFor } from "./media-type";

export interface PersistDocumentInput {
  sourceId: string;
  /** The lease claimed by this queue delivery. */
  fetchAttemptId: string;
  path: string;
  title: string;
  body: Uint8Array;
  mediaType: string;
  cursor?: string | null;
  metadata?: string | null;
  assets?: readonly PersistAssetInput[];
  /** Incremental sources retain prior assets while adding newly observed ones. */
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
}

/**
 * SQL condition shared by every fetch-attempt mutation. It intentionally also
 * requires `fetching`: an archive/pending transition revokes the lease even if
 * a legacy caller did not clear its identifier.
 */
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
  const source = await db
    .select({ id: schema.sources.id })
    .from(schema.sources)
    .where(
      and(
        eq(schema.sources.id, sourceId),
        eq(schema.sources.fetchAttemptId, fetchAttemptId),
        eq(schema.sources.status, "fetching"),
      ),
    )
    .get();
  return Boolean(source);
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

/**
 * Upsert a source_document. Same content hash → skip R2 write and skip captured_at
 * update (raw immutability). Different hash → write a new R2 object and point r2_key
 * at it; old objects are never deleted.
 *
 * `assets` describes images already stored by `resolveSourceAssets`. Default `replace`
 * keeps document assets exactly in sync; incremental sources opt into `merge` so new
 * entries do not erase historical attachments that remain referenced by appended text.
 */
export async function persistSourceDocument(
  env: Env,
  input: PersistDocumentInput,
): Promise<PersistDocumentResult> {
  const db = getDb(env);
  if (!(await isSourceFetchAttemptCurrent(db, input.sourceId, input.fetchAttemptId))) {
    return { skipped: true };
  }

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

  if (existing && existing.contentHash === contentHash) {
    // Content is unchanged, so nothing is written — but a path that was archived by
    // reconciliation and has since reappeared has to come back, or an unchanged
    // document could stay retired forever. Cursor / metadata may still advance.
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
  const r2Key = contentR2Key(input.sourceId, id, contentHash, input.mediaType);
  await env.BUCKET.put(r2Key, input.body, {
    httpMetadata: {
      contentType: input.mediaType.startsWith("text/")
        ? `${input.mediaType}; charset=utf-8`
        : input.mediaType,
    },
    customMetadata: { sha256: contentHash, path: input.path },
  });

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

  return { skipped: false, id, path: input.path, contentHash, r2Key, written: true };
}
