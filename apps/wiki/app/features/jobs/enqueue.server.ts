import { and, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import * as schema from "~/db/schema";
import type { getDb } from "~/lib/db.server";
import {
  JOB_PRIORITY,
  SYNTHESIZE_MIN_INTERVAL_SECONDS,
  type SynthesizePayload,
  type SynthesizeRequest,
} from "./shared";

type Db = ReturnType<typeof getDb>;

function parsePayload(raw: string): SynthesizePayload {
  try {
    const value = JSON.parse(raw) as Partial<SynthesizePayload>;
    return {
      sourceIds: Array.isArray(value.sourceIds) ? value.sourceIds : [],
      documentIds: Array.isArray(value.documentIds) ? value.documentIds : [],
      requests: Array.isArray(value.requests) ? value.requests : [],
    };
  } catch {
    return { sourceIds: [], documentIds: [], requests: [] };
  }
}

const union = (a: readonly string[], b: readonly string[]) => [...new Set([...a, ...b])];

/**
 * Queue (or merge into) the space's synthesize job.
 *
 * One queued synthesize per space (partial unique index): new documents and requests merge
 * into it, because the runner integrates a whole space from one clone. A new job may not
 * start within an hour of the last finished one — hourly Discord refreshes would otherwise
 * schedule ~24 runs a day against a personal subscription quota. `manual` ("integrate now")
 * lifts that wait and raises the priority.
 */
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
  const inserted = await db
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
    .onConflictDoNothing()
    .returning({ id: schema.agentJobs.id })
    .get();
  if (inserted) return { jobId: inserted.id, merged: false };

  const queued = await db
    .select()
    .from(schema.agentJobs)
    .where(
      and(
        eq(schema.agentJobs.spaceId, input.spaceId),
        eq(schema.agentJobs.type, "synthesize"),
        eq(schema.agentJobs.status, "queued"),
      ),
    )
    .get();
  if (!queued) {
    // The queued job was leased between the insert and this read; try once more.
    return enqueueSynthesize(db, { ...input, now });
  }
  const merged = parsePayload(queued.payload);
  const next: SynthesizePayload = {
    sourceIds: union(merged.sourceIds, payload.sourceIds),
    documentIds: union(merged.documentIds, payload.documentIds),
    requests: [...(merged.requests ?? []), ...(payload.requests ?? [])],
  };
  await db
    .update(schema.agentJobs)
    .set({
      payload: JSON.stringify(next),
      ...(input.manual ? { priority: JOB_PRIORITY.manual, runAfter: now } : {}),
    })
    .where(and(eq(schema.agentJobs.id, queued.id), eq(schema.agentJobs.status, "queued")));
  return { jobId: queued.id, merged: true };
}

/** Documents of a source the runner has not integrated yet (new or changed content). */
export function pendingDocumentsCondition() {
  return and(
    eq(schema.sourceDocuments.status, "ready"),
    or(
      isNull(schema.sourceDocuments.integratedHash),
      ne(schema.sourceDocuments.integratedHash, schema.sourceDocuments.contentHash),
    ),
  );
}

/** After an import completes: queue synthesis of whatever it left unintegrated. */
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

/**
 * Hourly safety net: any space with unintegrated documents and no queued / leased job gets
 * one, so a dropped hook never leaves material unintegrated.
 */
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

/** Unintegrated documents of non-archived sources, grouped by space (one space, if given). */
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

/**
 * "Integrate now": queue (or raise) the space's synthesize job with every document not
 * integrated yet. Without them the job would run on an empty list and "succeed" at once —
 * which also restarted the hourly wait — after a failed or needs_review run.
 */
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

/** Nightly: one consolidate job per space that has agent pages (none if one is queued). */
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
