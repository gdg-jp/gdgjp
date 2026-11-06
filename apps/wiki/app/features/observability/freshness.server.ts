import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import * as schema from "~/db/schema";
import { rawItemKey } from "~/features/knowledge/shared";
import type { getDb } from "~/lib/db.server";

type Db = ReturnType<typeof getDb>;
type Sample = {
  kind: string;
  spaceId: string | null;
  valueSeconds: number;
  subjectId: string | null;
};

const DAY = 24 * 60 * 60;
export const FRESHNESS_SAMPLE_SIZE = 20;

/**
 * Nightly (Stage 06): record the last day's latencies.
 * - freshness: raw document captured → its knowledge item uploaded (our side of AI Search).
 * - integration: earliest captured document of a synthesize job → job finished.
 * - answer: answer job created → finished; answer_expired: 1 per expired answer, 0 per finished.
 */
export async function sampleFreshness(db: Db, now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - DAY * 1000);
  const samples: Sample[] = [];

  const docs = await db
    .select({
      id: schema.sourceDocuments.id,
      capturedAt: schema.sourceDocuments.capturedAt,
      spaceId: schema.sources.spaceId,
    })
    .from(schema.sourceDocuments)
    .innerJoin(schema.sources, eq(schema.sources.id, schema.sourceDocuments.sourceId))
    .where(gt(schema.sourceDocuments.capturedAt, since))
    .orderBy(sql`random()`)
    .limit(FRESHNESS_SAMPLE_SIZE)
    .all();
  if (docs.length > 0) {
    const items = await db
      .select({ key: schema.knowledgeItems.itemKey, updatedAt: schema.knowledgeItems.updatedAt })
      .from(schema.knowledgeItems)
      .where(
        inArray(
          schema.knowledgeItems.itemKey,
          docs.map((doc) => rawItemKey(doc.id)),
        ),
      )
      .all();
    const updated = new Map(items.map((item) => [item.key, item.updatedAt]));
    for (const doc of docs) {
      const at = updated.get(rawItemKey(doc.id));
      if (!at || !doc.capturedAt || at < doc.capturedAt) continue; // not indexed yet
      samples.push({
        kind: "freshness",
        spaceId: doc.spaceId,
        valueSeconds: seconds(at) - seconds(doc.capturedAt),
        subjectId: doc.id,
      });
    }
  }

  const finished = await db
    .select()
    .from(schema.agentJobs)
    .where(
      and(
        inArray(schema.agentJobs.type, ["synthesize", "answer"]),
        gt(schema.agentJobs.createdAt, since),
        inArray(schema.agentJobs.status, ["succeeded", "failed", "needs_review", "expired"]),
      ),
    )
    .all();
  for (const job of finished) {
    if (job.type === "answer") {
      samples.push({
        kind: "answer_expired",
        spaceId: job.spaceId,
        valueSeconds: job.status === "expired" ? 1 : 0,
        subjectId: job.id,
      });
      if (job.status !== "expired" && job.finishedAt) {
        samples.push({
          kind: "answer",
          spaceId: job.spaceId,
          valueSeconds: seconds(job.finishedAt) - seconds(job.createdAt),
          subjectId: job.id,
        });
      }
      continue;
    }
    if (job.status !== "succeeded" || !job.finishedAt) continue;
    const ids = (JSON.parse(job.payload) as { documentIds?: string[] }).documentIds ?? [];
    if (ids.length === 0) continue;
    const earliest = await db
      .select({ at: sql<number | null>`min(${schema.sourceDocuments.capturedAt})` })
      .from(schema.sourceDocuments)
      .where(inArray(schema.sourceDocuments.id, ids.slice(0, 50)))
      .get();
    if (earliest?.at) {
      samples.push({
        kind: "integration",
        spaceId: job.spaceId,
        valueSeconds: seconds(job.finishedAt) - earliest.at,
        subjectId: job.id,
      });
    }
  }

  for (let i = 0; i < samples.length; i += 20) {
    await db
      .insert(schema.freshnessSamples)
      .values(
        samples.slice(i, i + 20).map((sample) => ({ id: nanoid(), ...sample, sampledAt: now })),
      );
  }
  return samples.length;
}

function seconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

export type LatencySummary = {
  kind: string;
  count: number;
  p50: number | null;
  p95: number | null;
  mean: number | null;
};

export function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? null;
}

/** p50 / p95 per kind over the last `days` days (/admin/stats). */
export async function summarizeLatency(
  db: Db,
  days = 7,
  now = new Date(),
): Promise<LatencySummary[]> {
  const since = new Date(now.getTime() - days * DAY * 1000);
  const rows = await db
    .select({ kind: schema.freshnessSamples.kind, value: schema.freshnessSamples.valueSeconds })
    .from(schema.freshnessSamples)
    .where(gt(schema.freshnessSamples.sampledAt, since))
    .all();
  const byKind = new Map<string, number[]>();
  for (const row of rows) byKind.set(row.kind, [...(byKind.get(row.kind) ?? []), row.value]);
  return ["freshness", "integration", "answer", "answer_expired"].map((kind) => {
    const values = (byKind.get(kind) ?? []).sort((a, b) => a - b);
    const mean = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
    return {
      kind,
      count: values.length,
      p50: percentile(values, 50),
      p95: percentile(values, 95),
      mean,
    };
  });
}
