import { eq, sql } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import * as schema from "~/db/schema";
import { chunkPageContent } from "./chunker.server";

type Db = ReturnType<typeof drizzle>;

async function computeHash(content: string): Promise<string> {
  const data = new TextEncoder().encode(content);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function indexPageEmbeddings(env: Env, db: Db, pageId: string): Promise<void> {
  if (!env.VECTORIZE || !env.AI) {
    console.warn("embedding-pipeline: VECTORIZE or AI not bound, skipping");
    return;
  }

  const page = await db
    .select({
      id: schema.pages.id,
      slug: schema.pages.slug,
      titleJa: schema.pages.titleJa,
      titleEn: schema.pages.titleEn,
      summaryJa: schema.pages.summaryJa,
      summaryEn: schema.pages.summaryEn,
      contentJa: schema.pages.contentJa,
      contentEn: schema.pages.contentEn,
      status: schema.pages.status,
    })
    .from(schema.pages)
    .where(eq(schema.pages.id, pageId))
    .get();

  if (!page || page.status !== "published") {
    console.warn("embedding-pipeline: page not found or not published", pageId);
    return;
  }

  const contentHash = await computeHash(page.contentJa + page.contentEn);

  // Check if content is unchanged
  const existing = await db
    .select({ contentHash: schema.pageEmbeddingStatus.contentHash })
    .from(schema.pageEmbeddingStatus)
    .where(eq(schema.pageEmbeddingStatus.pageId, pageId))
    .get();

  if (existing?.contentHash === contentHash) {
    console.log("embedding-pipeline: content unchanged, skipping", pageId);
    return;
  }

  const chunks = chunkPageContent({
    pageId: page.id,
    slug: page.slug,
    titleJa: page.titleJa,
    titleEn: page.titleEn,
    summaryJa: page.summaryJa,
    summaryEn: page.summaryEn,
    contentJa: page.contentJa,
    contentEn: page.contentEn,
  });

  if (chunks.length === 0) {
    console.warn("embedding-pipeline: no chunks produced", pageId);
    await upsertStatus(db, pageId, "indexed", 0, contentHash, null);
    return;
  }

  // Batch embed (max 100 per call)
  const chunkTexts = chunks.map((c) => c.text);
  const batchSize = 100;
  const allEmbeddings: number[][] = [];

  for (let i = 0; i < chunkTexts.length; i += batchSize) {
    const batch = chunkTexts.slice(i, i + batchSize);
    const result = await env.AI.run("@cf/baai/bge-m3", { text: batch });
    const data = (result as { data?: number[][] }).data ?? [];
    allEmbeddings.push(...data);
  }

  // Delete old vectors for this page — use stored chunkCount to avoid over-generating IDs
  const existingStatus = await db
    .select({ chunkCount: schema.pageEmbeddingStatus.chunkCount })
    .from(schema.pageEmbeddingStatus)
    .where(eq(schema.pageEmbeddingStatus.pageId, pageId))
    .get();
  const oldChunkLimit = Math.max(existingStatus?.chunkCount ?? 0, 200);
  const oldIds: string[] = [];
  for (const lang of ["ja", "en"]) {
    for (let i = 0; i < oldChunkLimit; i++) {
      oldIds.push(`${pageId}:${lang}:${i}`);
    }
  }
  try {
    await env.VECTORIZE.deleteByIds(oldIds);
  } catch {
    // Ignore errors from deleting non-existent IDs
  }

  // Validate embedding count matches chunk count
  const validPairs = chunks
    .map((chunk, i) => ({ chunk, embedding: allEmbeddings[i] }))
    .filter((p): p is typeof p & { embedding: number[] } => p.embedding !== undefined);
  if (validPairs.length !== chunks.length) {
    console.error(
      `embedding-pipeline: embedding count mismatch for ${pageId}: got ${validPairs.length} embeddings for ${chunks.length} chunks`,
    );
  }

  // Upsert new vectors
  const vectors = validPairs.map(({ chunk, embedding }) => ({
    id: `${pageId}:${chunk.language}:${chunk.chunkIndex}`,
    values: embedding,
    metadata: {
      pageId: chunk.pageId,
      language: chunk.language,
      chunkIndex: chunk.chunkIndex,
      sectionHeading: chunk.sectionHeading ?? "",
      slug: chunk.slug,
    },
  }));

  // Upsert in batches of 100
  for (let i = 0; i < vectors.length; i += batchSize) {
    await env.VECTORIZE.upsert(vectors.slice(i, i + batchSize));
  }

  await upsertStatus(db, pageId, "indexed", chunks.length, contentHash, null);
  console.log("embedding-pipeline: indexed", pageId, "chunks:", chunks.length);
}

export async function deletePageEmbeddings(env: Env, db: Db, pageId: string): Promise<void> {
  if (!env.VECTORIZE) return;

  const existing = await db
    .select({ chunkCount: schema.pageEmbeddingStatus.chunkCount })
    .from(schema.pageEmbeddingStatus)
    .where(eq(schema.pageEmbeddingStatus.pageId, pageId))
    .get();
  const limit = Math.max(existing?.chunkCount ?? 0, 200);

  const ids: string[] = [];
  for (const lang of ["ja", "en"]) {
    for (let i = 0; i < limit; i++) {
      ids.push(`${pageId}:${lang}:${i}`);
    }
  }
  try {
    await env.VECTORIZE.deleteByIds(ids);
  } catch {
    // best-effort
  }

  await db.delete(schema.pageEmbeddingStatus).where(eq(schema.pageEmbeddingStatus.pageId, pageId));
}

async function upsertStatus(
  db: Db,
  pageId: string,
  status: string,
  chunkCount: number,
  contentHash: string,
  errorMessage: string | null,
): Promise<void> {
  const now = new Date();
  await db
    .insert(schema.pageEmbeddingStatus)
    .values({
      pageId,
      status,
      chunkCount,
      contentHash,
      lastIndexedAt: status === "indexed" ? now : null,
      errorMessage,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.pageEmbeddingStatus.pageId,
      set: {
        status,
        chunkCount,
        contentHash,
        errorMessage,
        updatedAt: now,
        lastIndexedAt: status === "indexed" ? now : sql`last_indexed_at`,
      },
    });
}
