import { and, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import * as schema from "~/db/schema";
import type { getDb } from "~/lib/db.server";
import {
  JOB_PRIORITY,
  SYNTHESIZE_MIN_INTERVAL_SECONDS,
  type SynthesizePayload,
  type SynthesizeRequest,
} from "./shared";
import { mergeSynthesizePayload } from "./synthesize-payload.server";

type Db = ReturnType<typeof getDb>;

export async function enqueueSynthesize(
  db: Db,
  input: {
    spaceId: string;
    sourceIds?: readonly string[];
    documentIds?: readonly string[];
    requests?: readonly SynthesizeRequest[];
    manual?: boolean;
    now?: Date;
  },
): Promise<{ jobId: string; merged: boolean }> {
  const now = input.now ?? new Date();
  const nowSec = Math.floor(now.getTime() / 1000);
  const lastFinished = await db
    .select({ finishedAt: schema.agentJobs.finishedAt })
    .from(schema.agentJobs)
    .where(
      and(
        eq(schema.agentJobs.spaceId, input.spaceId),
        eq(schema.agentJobs.type, "synthesize"),
        inArray(schema.agentJobs.status, ["succeeded", "needs_review"]),
      ),
    )
    .orderBy(desc(schema.agentJobs.finishedAt))
    .limit(1)
    .get();
  const earliest = lastFinished?.finishedAt
    ? Math.floor(lastFinished.finishedAt.getTime() / 1000) + SYNTHESIZE_MIN_INTERVAL_SECONDS
    : nowSec;
  const runAfter = new Date((input.manual ? nowSec : Math.max(nowSec, earliest)) * 1000);

  const payload: SynthesizePayload = {
    sourceIds: [...new Set(input.sourceIds ?? [])],
    documentIds: [...new Set(input.documentIds ?? [])],
    requests: [...(input.requests ?? [])],
  };
  const id = crypto.randomUUID();
  const queued = await db
    .insert(schema.agentJobs)
    .values({
      id,
      type: "synthesize",
      spaceId: input.spaceId,
      status: "queued",
      priority: input.manual ? JOB_PRIORITY.manual : JOB_PRIORITY.synthesize,
      payload: JSON.stringify(payload),
      runAfter,
    })
    .onConflictDoUpdate({
      target: [schema.agentJobs.spaceId, schema.agentJobs.type],
      targetWhere: sql`status = 'queued' AND type IN ('synthesize', 'consolidate')`,
      set: {
        payload: mergeSynthesizePayload(sql`${schema.agentJobs.payload}`, sql`excluded.payload`),
        ...(input.manual ? { priority: JOB_PRIORITY.manual, runAfter: now } : {}),
      },
    })
    .returning({ id: schema.agentJobs.id })
    .get();
  if (!queued) throw new Error("Synthesize upsert returned no job");
  return { jobId: queued.id, merged: queued.id !== id };
}

export function pendingDocumentsCondition() {
  return and(
    eq(schema.sourceDocuments.status, "ready"),
    or(
      isNull(schema.sourceDocuments.integratedHash),
      ne(schema.sourceDocuments.integratedHash, schema.sourceDocuments.contentHash),
    ),
  );
}

export async function enqueueSynthesizeForSource(
  db: Db,
  sourceId: string,
  options: { manual?: boolean } = {},
): Promise<{ jobId: string } | null> {
  const source = await db
    .select({ id: schema.sources.id, spaceId: schema.sources.spaceId })
    .from(schema.sources)
    .where(eq(schema.sources.id, sourceId))
    .get();
  if (!source) return null;
  const pending = await db
    .select({ id: schema.sourceDocuments.id })
    .from(schema.sourceDocuments)
    .where(and(eq(schema.sourceDocuments.sourceId, sourceId), pendingDocumentsCondition()))
    .all();
  if (pending.length === 0 && !options.manual) return null;
  return enqueueSynthesize(db, {
    spaceId: source.spaceId,
    sourceIds: [source.id],
    documentIds: pending.map((row) => row.id),
    manual: options.manual,
  });
}

export async function enqueuePendingSynthesis(db: Db): Promise<number> {
  const bySpace = await pendingDocumentsBySpace(db);
  let enqueued = 0;
  for (const [spaceId, entry] of bySpace) {
    const active = await db
      .select({ n: sql<number>`count(*)` })
      .from(schema.agentJobs)
      .where(
        and(
          eq(schema.agentJobs.spaceId, spaceId),
          eq(schema.agentJobs.type, "synthesize"),
          inArray(schema.agentJobs.status, ["queued", "leased"]),
        ),
      )
      .get();
    if ((active?.n ?? 0) > 0) continue;
    await enqueueSynthesize(db, {
      spaceId,
      sourceIds: [...entry.sourceIds],
      documentIds: entry.documentIds,
    });
    enqueued += 1;
  }
  return enqueued;
}

async function pendingDocumentsBySpace(
  db: Db,
  spaceId?: string,
): Promise<Map<string, { sourceIds: Set<string>; documentIds: string[] }>> {
  const rows = await db
    .select({
      spaceId: schema.sources.spaceId,
      sourceId: schema.sourceDocuments.sourceId,
      documentId: schema.sourceDocuments.id,
    })
    .from(schema.sourceDocuments)
    .innerJoin(schema.sources, eq(schema.sources.id, schema.sourceDocuments.sourceId))
    .where(
      and(
        ne(schema.sources.status, "archived"),
        pendingDocumentsCondition(),
        spaceId ? eq(schema.sources.spaceId, spaceId) : undefined,
      ),
    )
    .limit(5000)
    .all();
  const bySpace = new Map<string, { sourceIds: Set<string>; documentIds: string[] }>();
  for (const row of rows) {
    const entry = bySpace.get(row.spaceId) ?? { sourceIds: new Set(), documentIds: [] };
    entry.sourceIds.add(row.sourceId);
    entry.documentIds.push(row.documentId);
    bySpace.set(row.spaceId, entry);
  }
  return bySpace;
}

export async function integrateNow(db: Db, spaceId: string, now?: Date) {
  const pending = (await pendingDocumentsBySpace(db, spaceId)).get(spaceId);
  return enqueueSynthesize(db, {
    spaceId,
    sourceIds: pending ? [...pending.sourceIds] : [],
    documentIds: pending?.documentIds ?? [],
    manual: true,
    now,
  });
}

export async function enqueueConsolidation(db: Db): Promise<number> {
  const spaces = await db
    .selectDistinct({ spaceId: schema.pages.spaceId })
    .from(schema.pages)
    .where(and(eq(schema.pages.origin, "agent"), eq(schema.pages.status, "published")))
    .all();
  let queued = 0;
  for (const { spaceId } of spaces) {
    const inserted = await db
      .insert(schema.agentJobs)
      .values({
        id: crypto.randomUUID(),
        type: "consolidate",
        spaceId,
        priority: JOB_PRIORITY.consolidate,
        payload: "{}",
      })
      .onConflictDoNothing()
      .returning({ id: schema.agentJobs.id })
      .get();
    if (inserted) queued += 1;
  }
  return queued;
}
