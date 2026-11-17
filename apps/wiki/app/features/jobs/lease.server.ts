import { and, eq, lt, sql } from "drizzle-orm";
import * as schema from "~/db/schema";
import type { getDb } from "~/lib/db.server";
import type { LeaseUpdate } from "./runner-input.server";
import { mergeSynthesizePayload } from "./synthesize-payload.server";

type Db = ReturnType<typeof getDb>;
type Job = typeof schema.agentJobs.$inferSelect;
export type JobLease = LeaseUpdate & { jobId: string; host: string };

export function leaseCondition({
  jobId,
  host,
  attempts,
}: Omit<JobLease, "host"> & { host: string | null }) {
  return and(
    eq(schema.agentJobs.id, jobId),
    eq(schema.agentJobs.status, "leased"),
    sql`${schema.agentJobs.leaseOwner} IS ${host}`,
    eq(schema.agentJobs.attempts, attempts),
  );
}

export async function returnToQueue(
  db: Db,
  job: Job,
  attempts: number,
  error: string | null,
  now: Date,
  expiredBefore?: Date,
): Promise<boolean> {
  const owned = and(
    leaseCondition({ jobId: job.id, host: job.leaseOwner, attempts: job.attempts }),
    expiredBefore ? lt(schema.agentJobs.leaseUntil, expiredBefore) : undefined,
  );
  const queued = { status: "queued", attempts, leaseUntil: null, leaseOwner: null, error };
  if (job.type !== "synthesize" && job.type !== "consolidate") {
    const updated = await db
      .update(schema.agentJobs)
      .set(queued)
      .where(owned)
      .returning({ id: schema.agentJobs.id });
    return updated.length > 0;
  }
  const waiting = sql`SELECT q.id FROM agent_jobs q
    WHERE q.space_id = ${job.spaceId} AND q.type = ${job.type} AND q.status = 'queued'`;
  const source = sql`EXISTS (SELECT 1 FROM agent_jobs original
    WHERE original.id = ${job.id} AND original.status = 'leased'
      AND original.lease_owner IS ${job.leaseOwner} AND original.attempts = ${job.attempts}
      ${expiredBefore ? sql`AND original.lease_until < ${Math.floor(expiredBefore.getTime() / 1000)}` : sql``})`;
  const incoming = sql`(SELECT original.payload FROM agent_jobs original WHERE original.id = ${job.id})`;
  const [, merged, requeued] = await db.batch([
    db
      .update(schema.agentJobs)
      .set({
        payload: mergeSynthesizePayload(sql`${schema.agentJobs.payload}`, incoming, {
          prependRequests: true,
        }),
        priority: sql`max(${schema.agentJobs.priority}, ${job.priority})`,
        runAfter: sql`min(${schema.agentJobs.runAfter}, ${Math.floor(job.runAfter.getTime() / 1000)})`,
      })
      .where(
        and(
          eq(schema.agentJobs.spaceId, job.spaceId),
          eq(schema.agentJobs.type, job.type),
          eq(schema.agentJobs.status, "queued"),
          source,
        ),
      ),
    db
      .update(schema.agentJobs)
      .set({
        status: "failed",
        attempts,
        leaseUntil: null,
        leaseOwner: null,
        finishedAt: now,
        error: sql`substr('merged into queued job ' || (${waiting}) || ${error ? `: ${error}` : ""}, 1, 4000)`,
      })
      .where(and(owned, sql`EXISTS (${waiting})`))
      .returning({ id: schema.agentJobs.id }),
    db
      .update(schema.agentJobs)
      .set(queued)
      .where(and(owned, sql`NOT EXISTS (${waiting})`))
      .returning({ id: schema.agentJobs.id }),
  ]);
  return merged.length + requeued.length > 0;
}
