import { and, asc, eq, gt, like } from "drizzle-orm";
import * as schema from "../../../app/db/schema";
import { rawObjectMetadata } from "../../../app/features/sources/raw-object";
import { getDb } from "../../../app/lib/db.server";

/** Documents re-tagged per queue message (each costs one R2 get + one put). */
const BATCH = 40;

export type SourceAudienceRewriteMessage = {
  type: "source_audience_rewrite";
  sourceId: string;
  /** Resume after this document id. */
  after?: string;
};

export function isSourceAudienceRewriteQueueBody(
  body: unknown,
): body is SourceAudienceRewriteMessage {
  return (
    typeof body === "object" &&
    body !== null &&
    (body as { type?: unknown }).type === "source_audience_rewrite" &&
    typeof (body as { sourceId?: unknown }).sourceId === "string"
  );
}

/**
 * After a visibility change, re-tag every v2 raw object of the source with the new
 * `audience`. Unchanged content is never re-fetched, so without this the old audience would
 * keep matching readers the source no longer allows (search would leak after narrowing).
 * Continues itself through the queue in batches.
 */
export async function rewriteSourceAudience(
  env: Env,
  message: SourceAudienceRewriteMessage,
): Promise<{ rewritten: number; done: boolean }> {
  const db = getDb(env);
  const source = await db
    .select()
    .from(schema.sources)
    .where(eq(schema.sources.id, message.sourceId))
    .get();
  if (!source) return { rewritten: 0, done: true };
  const docs = await db
    .select({
      id: schema.sourceDocuments.id,
      r2Key: schema.sourceDocuments.r2Key,
      contentHash: schema.sourceDocuments.contentHash,
      path: schema.sourceDocuments.path,
    })
    .from(schema.sourceDocuments)
    .where(
      and(
        eq(schema.sourceDocuments.sourceId, source.id),
        like(schema.sourceDocuments.r2Key, "spaces/%"),
        message.after ? gt(schema.sourceDocuments.id, message.after) : undefined,
      ),
    )
    .orderBy(asc(schema.sourceDocuments.id))
    .limit(BATCH)
    .all();
  let rewritten = 0;
  for (const doc of docs) {
    const object = await env.BUCKET.get(doc.r2Key);
    if (!object) continue;
    await env.BUCKET.put(doc.r2Key, await object.arrayBuffer(), {
      httpMetadata: object.httpMetadata,
      customMetadata: rawObjectMetadata(source, { sha256: doc.contentHash, path: doc.path }),
    });
    rewritten += 1;
  }
  const last = docs.at(-1);
  if (docs.length === BATCH && last) {
    await env.SOURCE_FETCH_QUEUE.send({
      type: "source_audience_rewrite",
      sourceId: source.id,
      after: last.id,
    } satisfies SourceAudienceRewriteMessage);
    return { rewritten, done: false };
  }
  return { rewritten, done: true };
}
