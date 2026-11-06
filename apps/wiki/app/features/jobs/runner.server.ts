import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import * as schema from "~/db/schema";
import { createNotification } from "~/features/notifications/notify.server";
import { pageInSpace } from "~/features/pages/page-space.server";
import { wikiPagePath } from "~/features/pages/wiki-page-path";
import { ensureOpenReviewFlag } from "~/features/spaces/review.server";
import type { getDb } from "~/lib/db.server";
import { finishAnswer, notifyAgent } from "./answer.server";
import type { AgentJobStatus, AgentJobType, SynthesizePayload } from "./shared";

type Db = ReturnType<typeof getDb>;
type Job = typeof schema.agentJobs.$inferSelect;

export const LEASE_SECONDS = 20 * 60;
export const MAX_ATTEMPTS = 3;
/** Jobs that work from a whole-space clone: never two at once for one space. */
const CLONE_JOBS: readonly AgentJobType[] = ["synthesize", "consolidate"];

/**
 * Lease the next runnable job of the given types, atomically. Clone jobs of a space that
 * already has one leased are skipped (one clone per space at a time), so two runners can
 * never push conflicting versions of the same space.
 */
export async function leaseNextJob(
  db: Db,
  input: { types: readonly AgentJobType[]; host: string; now?: Date },
): Promise<Job | null> {
  if (input.types.length === 0) return null;
  const now = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const types = sql.join(
    input.types.map((type) => sql`${type}`),
    sql`, `,
  );
  const clone = sql.join(
    CLONE_JOBS.map((type) => sql`${type}`),
    sql`, `,
  );
  const leased = await db
    .update(schema.agentJobs)
    .set({
      status: "leased",
      leaseOwner: input.host,
      leaseUntil: new Date((now + LEASE_SECONDS) * 1000),
      startedAt: sql`COALESCE(${schema.agentJobs.startedAt}, ${now})`,
    })
    .where(
      and(
        eq(schema.agentJobs.status, "queued"),
        sql`${schema.agentJobs.id} = (
          SELECT j.id FROM agent_jobs j
           WHERE j.status = 'queued' AND j.run_after <= ${now} AND j.type IN (${types})
             AND NOT (j.type IN (${clone}) AND EXISTS (
               SELECT 1 FROM agent_jobs o
                WHERE o.space_id = j.space_id AND o.status = 'leased' AND o.type IN (${clone})))
           ORDER BY j.priority DESC, j.created_at ASC
           LIMIT 1)`,
      ),
    )
    .returning()
    .get();
  return leased ?? null;
}

export async function extendJobLease(db: Db, jobId: string, host: string): Promise<boolean> {
  const result = await db
    .update(schema.agentJobs)
    .set({ leaseUntil: new Date(Date.now() + LEASE_SECONDS * 1000) })
    .where(
      and(
        eq(schema.agentJobs.id, jobId),
        eq(schema.agentJobs.status, "leased"),
        eq(schema.agentJobs.leaseOwner, host),
      ),
    );
  return (result.meta?.changes ?? 0) > 0;
}

export type JobResult = {
  status: Extract<AgentJobStatus, "succeeded" | "failed" | "needs_review">;
  result?: unknown;
  error?: string;
  /** synthesize: documents whose content the run integrated (default: the payload's). */
  integratedDocumentIds?: string[];
  /** synthesize: per request (by index in payload.requests) whether it was applied. */
  requestOutcomes?: Array<{ index: number; applied: boolean; note?: string }>;
  /** failed: put the job back in the queue (a lost push race) unless attempts run out. */
  retry?: boolean;
  /** needs_review: open a review flag on the job (e.g. `acl-untagged` with the findings). */
  reviewFlag?: { kind: "acl-untagged"; payload?: unknown };
};

function parsePayload(job: Job): SynthesizePayload {
  try {
    return JSON.parse(job.payload) as SynthesizePayload;
  } catch {
    return { sourceIds: [], documentIds: [] };
  }
}

/**
 * Record a runner's result. On a successful synthesize, the documents it integrated are
 * marked (`integrated_hash = content_hash`), their sources get `last_integrated_at`, and
 * everyone who asked for a change is notified.
 */
export async function completeJob(
  env: Env,
  db: Db,
  input: { jobId: string; host: string } & JobResult,
): Promise<{ ok: boolean }> {
  const job = await db
    .select()
    .from(schema.agentJobs)
    .where(eq(schema.agentJobs.id, input.jobId))
    .get();
  if (!job || job.status !== "leased" || job.leaseOwner !== input.host) return { ok: false };
  const now = new Date();
  if (input.status === "failed" && input.retry && job.attempts + 1 < MAX_ATTEMPTS) {
    await db
      .update(schema.agentJobs)
      .set({
        status: "queued",
        attempts: job.attempts + 1,
        leaseUntil: null,
        leaseOwner: null,
        error: input.error?.slice(0, 4000) ?? null,
      })
      .where(eq(schema.agentJobs.id, job.id));
    return { ok: true };
  }
  if (input.status === "needs_review" && input.reviewFlag) {
    await ensureOpenReviewFlag(db, {
      spaceId: job.spaceId,
      targetType: "job",
      targetId: job.id,
      kind: input.reviewFlag.kind,
      payload: input.reviewFlag.payload,
    });
  }
  await db
    .update(schema.agentJobs)
    .set({
      status: input.status,
      result: input.result === undefined ? null : JSON.stringify(input.result),
      error: input.error?.slice(0, 4000) ?? null,
      finishedAt: now,
      leaseUntil: null,
    })
    .where(eq(schema.agentJobs.id, job.id));

  if (job.type === "answer") {
    await finishAnswer(env, db, job.id);
    await notifyAgent(env, { jobId: job.id, status: input.status, result: input.result });
  }

  if (job.type === "synthesize") {
    const payload = parsePayload(job);
    if (input.status === "succeeded") {
      const documentIds = input.integratedDocumentIds ?? payload.documentIds;
      for (let i = 0; i < documentIds.length; i += 50) {
        await db
          .update(schema.sourceDocuments)
          .set({ integratedHash: sql`${schema.sourceDocuments.contentHash}` })
          .where(inArray(schema.sourceDocuments.id, documentIds.slice(i, i + 50)));
      }
      if (payload.sourceIds.length > 0) {
        await db
          .update(schema.sources)
          .set({ lastIntegratedAt: now })
          .where(inArray(schema.sources.id, payload.sourceIds));
      }
    }
    await notifyRequesters(env, db, job, payload, input);
  }
  return { ok: true };
}

async function notifyRequesters(
  env: Env,
  db: Db,
  job: Job,
  payload: SynthesizePayload,
  input: JobResult,
) {
  const requests = payload.requests ?? [];
  if (requests.length === 0) return;
  const space = await db
    .select({ slug: schema.spaces.slug })
    .from(schema.spaces)
    .where(eq(schema.spaces.id, job.spaceId))
    .get();
  for (const [index, request] of requests.entries()) {
    const outcome = input.requestOutcomes?.find((entry) => entry.index === index);
    const applied = input.status === "succeeded" && (outcome?.applied ?? true);
    const page = await db
      .select({ slug: schema.pages.slug })
      .from(schema.pages)
      .where(pageInSpace(job.spaceId, request.pageSlug))
      .get();
    const note = outcome?.note ? `: ${outcome.note.slice(0, 200)}` : "";
    await createNotification(env, db, {
      id: nanoid(),
      userId: request.requestedBy,
      type: "agent_request",
      titleJa: applied
        ? `依頼をエージェントが反映しました${note}`
        : `依頼をエージェントが反映できませんでした${note}`,
      titleEn: applied
        ? `The agent applied your request${note}`
        : `The agent could not apply your request${note}`,
      refId: job.id,
      refUrl: wikiPagePath([page?.slug ?? request.pageSlug], space?.slug ?? "gdg-jp"),
    });
  }
}

/**
 * Hourly: expired leases go back to the queue (3 attempts, then failed); answers past their
 * deadline expire (the asker already got the degraded reply).
 */
export async function requeueExpiredJobs(db: Db, now = new Date()): Promise<number> {
  const nowSec = Math.floor(now.getTime() / 1000);
  await db.run(sql`
    UPDATE agent_jobs SET status = 'expired', finished_at = ${nowSec}, lease_until = NULL
     WHERE type = 'answer' AND status IN ('queued', 'leased') AND deadline_at IS NOT NULL
       AND deadline_at < ${nowSec}`);
  const expired = await db
    .select({ id: schema.agentJobs.id, attempts: schema.agentJobs.attempts })
    .from(schema.agentJobs)
    .where(and(eq(schema.agentJobs.status, "leased"), lt(schema.agentJobs.leaseUntil, now)))
    .all();
  for (const job of expired) {
    const attempts = job.attempts + 1;
    await db
      .update(schema.agentJobs)
      .set(
        attempts >= MAX_ATTEMPTS
          ? {
              status: "failed",
              attempts,
              leaseUntil: null,
              leaseOwner: null,
              finishedAt: now,
              error: "lease expired",
            }
          : { status: "queued", attempts, leaseUntil: null, leaseOwner: null },
      )
      .where(and(eq(schema.agentJobs.id, job.id), eq(schema.agentJobs.status, "leased")));
  }
  return expired.length;
}

export async function recordRunnerHeartbeat(
  db: Db,
  input: { host: string; version: string; backend: string; runningJobId: string | null },
) {
  await db
    .insert(schema.runnerStatus)
    .values({ ...input, lastSeenAt: new Date(), alertedAt: null })
    .onConflictDoUpdate({
      target: schema.runnerStatus.host,
      set: {
        version: input.version,
        backend: input.backend,
        runningJobId: input.runningJobId,
        lastSeenAt: new Date(),
        alertedAt: null,
      },
    });
}

/** Newest runner heartbeat (null = never). Stage 05 answers degrade when this is stale. */
export async function latestRunnerHeartbeat(db: Db): Promise<Date | null> {
  const row = await db
    .select({ lastSeenAt: schema.runnerStatus.lastSeenAt })
    .from(schema.runnerStatus)
    .orderBy(desc(schema.runnerStatus.lastSeenAt))
    .limit(1)
    .get();
  return row?.lastSeenAt ?? null;
}

/**
 * Hourly: if no runner has been heard from for 10 minutes, alert once (Discord webhook in
 * RUNNER_ALERT_WEBHOOK_URL when set, else the Worker log) until a heartbeat clears it.
 */
export async function alertIfRunnerDown(env: Env, db: Db, now = new Date()): Promise<boolean> {
  const rows = await db.select().from(schema.runnerStatus).all();
  const stale = rows.filter(
    (row) => now.getTime() - row.lastSeenAt.getTime() > 10 * 60 * 1000 && !row.alertedAt,
  );
  if (stale.length === 0) return false;
  const queued = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.agentJobs)
    .where(eq(schema.agentJobs.status, "queued"))
    .get();
  const message = `Knowledge runner silent: ${stale
    .map((row) => `${row.host} (last seen ${row.lastSeenAt.toISOString()})`)
    .join(", ")} — ${queued?.n ?? 0} jobs queued. See /admin/runner.`;
  const webhook = (env as unknown as { RUNNER_ALERT_WEBHOOK_URL?: string })
    .RUNNER_ALERT_WEBHOOK_URL;
  if (webhook) {
    await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: message }),
    }).catch((error) => console.error("[runner] alert webhook failed", error));
  } else {
    console.error(`[runner] ${message}`);
  }
  for (const row of stale) {
    await db
      .update(schema.runnerStatus)
      .set({ alertedAt: now })
      .where(eq(schema.runnerStatus.host, row.host));
  }
  return true;
}
