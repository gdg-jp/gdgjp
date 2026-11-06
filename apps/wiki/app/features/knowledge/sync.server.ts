import { and, eq, inArray, ne } from "drizzle-orm";
import * as schema from "~/db/schema";
import { sourceAudience } from "~/features/sources/audience";
import { ensureOpenReviewFlag } from "~/features/spaces/review.server";
import { getDb } from "~/lib/db.server";
import { type KnowledgeInstance, knowledgeBinding } from "./binding";
import { ensureSpaceInstance } from "./instances.server";
import { type MirrorItem, type MirrorSource, buildPageMirror } from "./mirror";
import { rawItemKey } from "./shared";

type Db = ReturnType<typeof getDb>;

/** Uploads + deletes per call; the queue continues the rest (Worker subrequest budget). */
const MAX_OPERATIONS = 60;
/** Raw documents larger than the Items API text limit are not indexed. */
const MAX_RAW_BYTES = 4 * 1024 * 1024;

export type KnowledgeSyncMessage = { type: "knowledge_sync"; spaceId: string };

export function isKnowledgeSyncQueueBody(body: unknown): body is KnowledgeSyncMessage {
  return (
    typeof body === "object" &&
    body !== null &&
    (body as { type?: unknown }).type === "knowledge_sync" &&
    typeof (body as { spaceId?: unknown }).spaceId === "string"
  );
}

/** Ask the queue to bring a space's index up to date (after a page save or an import). */
export async function scheduleKnowledgeSync(env: Env, spaceId: string): Promise<void> {
  if (!knowledgeBinding(env)) return;
  try {
    await env.SOURCE_FETCH_QUEUE.send({ type: "knowledge_sync", spaceId });
  } catch (error) {
    // The hourly reconcile catches up.
    console.error("[knowledge] could not schedule sync", spaceId, error);
  }
}

type Tracked = typeof schema.knowledgeItems.$inferSelect;

class Budget {
  used = 0;
  get exhausted(): boolean {
    return this.used >= MAX_OPERATIONS;
  }
}

async function upsertItem(
  db: Db,
  instance: KnowledgeInstance,
  spaceId: string,
  subject: { type: "page" | "document"; id: string; version: string },
  item: MirrorItem,
) {
  const uploaded = await instance.items.upload(item.key, item.body, { metadata: item.metadata });
  await db
    .insert(schema.knowledgeItems)
    .values({
      spaceId,
      itemKey: item.key,
      itemId: uploaded?.id ?? null,
      subjectType: subject.type,
      subjectId: subject.id,
      version: subject.version,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [schema.knowledgeItems.spaceId, schema.knowledgeItems.itemKey],
      set: {
        itemId: uploaded?.id ?? null,
        subjectType: subject.type,
        subjectId: subject.id,
        version: subject.version,
        updatedAt: new Date(),
      },
    });
}

async function removeItem(db: Db, instance: KnowledgeInstance, row: Tracked) {
  if (row.itemId) {
    try {
      await instance.items.delete(row.itemId);
    } catch (error) {
      // Already gone is fine; anything else is retried by the next sync.
      if (!/not exist|not found|404/i.test(String(error))) throw error;
    }
  }
  await db
    .delete(schema.knowledgeItems)
    .where(
      and(
        eq(schema.knowledgeItems.spaceId, row.spaceId),
        eq(schema.knowledgeItems.itemKey, row.itemKey),
      ),
    );
}

/**
 * Bring one space's AI Search instance in line with D1 (the source of truth):
 * published pages (mirror per `buildPageMirror`, versioned by sync_revision) and ready raw
 * documents (versioned by content hash + audience, so a visibility change re-tags them).
 * Items whose subject is gone are deleted. Returns `done: false` when the budget ran out.
 */
export async function syncSpaceKnowledge(
  env: Env,
  spaceId: string,
): Promise<{ done: boolean; uploaded: number; deleted: number }> {
  const binding = knowledgeBinding(env);
  if (!binding) return { done: true, uploaded: 0, deleted: 0 };
  await ensureSpaceInstance(env, spaceId);
  const instance = binding.get(spaceId);
  const db = getDb(env);
  const budget = new Budget();
  let uploaded = 0;
  let deleted = 0;

  const tracked = await db
    .select()
    .from(schema.knowledgeItems)
    .where(eq(schema.knowledgeItems.spaceId, spaceId))
    .all();
  const bySubject = new Map<string, Tracked[]>();
  for (const row of tracked) {
    const key = `${row.subjectType}:${row.subjectId}`;
    bySubject.set(key, [...(bySubject.get(key) ?? []), row]);
  }
  const seenSubjects = new Set<string>();

  // --- pages ---------------------------------------------------------------
  // Ids and revisions only; content is loaded just for pages whose mirror is stale (the
  // editor schedules a sync on every autosave, so the common case must be cheap).
  const pageRevisions = await db
    .select({ id: schema.pages.id, syncRevision: schema.pages.syncRevision })
    .from(schema.pages)
    .where(and(eq(schema.pages.spaceId, spaceId), eq(schema.pages.status, "published")))
    .all();
  const stalePageIds: string[] = [];
  for (const page of pageRevisions) {
    const subjectKey = `page:${page.id}`;
    seenSubjects.add(subjectKey);
    const current = bySubject.get(subjectKey) ?? [];
    if (current.length > 0 && current.every((row) => row.version === String(page.syncRevision))) {
      continue;
    }
    stalePageIds.push(page.id);
  }
  const pages = [];
  for (let i = 0; i < stalePageIds.length && i < MAX_OPERATIONS; i += 50) {
    pages.push(
      ...(await db
        .select({
          id: schema.pages.id,
          titleJa: schema.pages.titleJa,
          titleEn: schema.pages.titleEn,
          contentJa: schema.pages.contentJa,
          contentEn: schema.pages.contentEn,
          pageType: schema.pages.pageType,
          origin: schema.pages.origin,
          updatedAt: schema.pages.updatedAt,
          syncRevision: schema.pages.syncRevision,
        })
        .from(schema.pages)
        .where(inArray(schema.pages.id, stalePageIds.slice(i, i + 50)))
        .all()),
    );
  }
  const sourceRows = await db
    .select({
      id: schema.sources.id,
      visibility: schema.sources.visibility,
      chapterId: schema.sources.chapterId,
      addedBy: schema.sources.addedBy,
      status: schema.sources.status,
    })
    .from(schema.sources)
    .where(eq(schema.sources.spaceId, spaceId))
    .all();
  const sources = new Map<string, MirrorSource>(sourceRows.map((row) => [row.id, row]));

  for (const page of pages) {
    if (budget.exhausted) return { done: false, uploaded, deleted };
    const current = bySubject.get(`page:${page.id}`) ?? [];
    const version = String(page.syncRevision);
    const { items, ambiguousSpans } = buildPageMirror(page, sources);
    for (const item of items) {
      await upsertItem(db, instance, spaceId, { type: "page", id: page.id, version }, item);
      budget.used += 1;
      uploaded += 1;
    }
    const keep = new Set(items.map((item) => item.key));
    for (const row of current) {
      if (keep.has(row.itemKey)) continue;
      await removeItem(db, instance, row);
      budget.used += 1;
      deleted += 1;
    }
    if (ambiguousSpans.length > 0) {
      await ensureOpenReviewFlag(db, {
        spaceId,
        targetType: "page",
        targetId: page.id,
        kind: "acl-ambiguous-span",
        payload: { srcIds: ambiguousSpans },
      });
    }
  }

  // More stale pages than this call loaded: let the queue continue before raw work.
  if (stalePageIds.length > pages.length) return { done: false, uploaded, deleted };

  // --- raw documents --------------------------------------------------------
  const readySources = sourceRows.filter((row) => row.status !== "archived");
  const documents =
    readySources.length === 0
      ? []
      : await db
          .select({
            id: schema.sourceDocuments.id,
            sourceId: schema.sourceDocuments.sourceId,
            title: schema.sourceDocuments.title,
            path: schema.sourceDocuments.path,
            r2Key: schema.sourceDocuments.r2Key,
            contentHash: schema.sourceDocuments.contentHash,
            mediaType: schema.sourceDocuments.mediaType,
          })
          .from(schema.sourceDocuments)
          .where(
            and(
              inArray(
                schema.sourceDocuments.sourceId,
                readySources.map((row) => row.id),
              ),
              eq(schema.sourceDocuments.status, "ready"),
              ne(schema.sourceDocuments.mediaType, "application/pdf"),
            ),
          )
          .all();
  for (const doc of documents) {
    const source = sources.get(doc.sourceId);
    if (!source) continue;
    const subjectKey = `document:${doc.id}`;
    seenSubjects.add(subjectKey);
    const audience = sourceAudience(source);
    const version = `${doc.contentHash}:${audience}`;
    const current = bySubject.get(subjectKey) ?? [];
    if (current.length > 0 && current.every((row) => row.version === version)) continue;
    if (budget.exhausted) return { done: false, uploaded, deleted };
    const object = await env.BUCKET.get(doc.r2Key);
    budget.used += 1;
    if (!object || object.size > MAX_RAW_BYTES) continue;
    await upsertItem(
      db,
      instance,
      spaceId,
      { type: "document", id: doc.id, version },
      {
        key: rawItemKey(doc.id),
        body: `# ${doc.title}\n\n${await object.text()}`,
        metadata: { layer: "raw", audience, source_id: doc.sourceId, page_type: "", lang: "" },
      },
    );
    budget.used += 1;
    uploaded += 1;
  }

  // --- subjects that no longer exist (archived / deleted / moved) ----------
  for (const [subjectKey, rows] of bySubject) {
    if (seenSubjects.has(subjectKey)) continue;
    for (const row of rows) {
      if (budget.exhausted) return { done: false, uploaded, deleted };
      await removeItem(db, instance, row);
      budget.used += 1;
      deleted += 1;
    }
  }
  return { done: true, uploaded, deleted };
}

/** Queue consumer: sync, and continue through the queue while work remains. */
export async function processKnowledgeSync(env: Env, message: KnowledgeSyncMessage): Promise<void> {
  const result = await syncSpaceKnowledge(env, message.spaceId);
  console.log(JSON.stringify({ component: "knowledge", event: "sync", ...message, ...result }));
  if (!result.done) await env.SOURCE_FETCH_QUEUE.send(message);
}

/** Hourly: schedule a sync of every space (cheap when nothing changed). */
export async function scheduleAllKnowledgeSyncs(env: Env, db: Db): Promise<number> {
  const spaces = await db.select({ id: schema.spaces.id }).from(schema.spaces).all();
  for (const space of spaces) await scheduleKnowledgeSync(env, space.id);
  return spaces.length;
}
