import {
  JOB_PRIORITY,
  type Job,
  type JobPayload,
  type JobStatus,
  type JobType,
  LEASE_SECONDS,
  MAX_ATTEMPTS,
  newJobId,
} from "./shared";

type JobRow = {
  id: string;
  type: JobType;
  campaign_id: number;
  status: JobStatus;
  priority: number;
  payload: string;
  result: string | null;
  error: string | null;
  lease_owner: string | null;
  lease_until: number | null;
  attempts: number;
  run_after: number;
  requested_by: string | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
};

const parse = (raw: string | null) => {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

export function toJob(row: JobRow): Job {
  return {
    id: row.id,
    type: row.type,
    campaignId: row.campaign_id,
    status: row.status,
    priority: row.priority,
    payload: parse(row.payload) ?? {},
    result: parse(row.result),
    error: row.error,
    leaseOwner: row.lease_owner,
    leaseUntil: row.lease_until,
    attempts: row.attempts,
    runAfter: row.run_after,
    requestedBy: row.requested_by,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export async function insertJob(
  db: D1Database,
  input: { campaignId: number; payload: JobPayload; requestedBy: string | null; priority?: number },
): Promise<string> {
  const id = newJobId();
  await db
    .prepare(
      "INSERT INTO agent_jobs (id, type, campaign_id, priority, payload, requested_by) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(
      id,
      input.payload.type,
      input.campaignId,
      input.priority ?? JOB_PRIORITY[input.payload.type],
      JSON.stringify(input.payload),
      input.requestedBy,
    )
    .run();
  return id;
}

export async function getJob(db: D1Database, id: string): Promise<Job | null> {
  const row = await db.prepare("SELECT * FROM agent_jobs WHERE id = ?").bind(id).first<JobRow>();
  return row ? toJob(row) : null;
}

/**
 * Lease the next runnable job of the given types in one statement: the UPDATE only matches
 * while the row is still queued, so two runners can never lease the same job.
 */
export async function leaseNextJob(
  db: D1Database,
  input: { types: readonly JobType[]; host: string; now?: number },
): Promise<Job | null> {
  if (input.types.length === 0) return null;
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const marks = input.types.map(() => "?").join(",");
  const row = await db
    .prepare(
      `UPDATE agent_jobs
          SET status = 'leased', lease_owner = ?, lease_until = ?, started_at = COALESCE(started_at, ?)
        WHERE status = 'queued'
          AND id = (SELECT id FROM agent_jobs
                     WHERE status = 'queued' AND run_after <= ? AND type IN (${marks})
                     ORDER BY priority DESC, created_at ASC, id ASC LIMIT 1)
        RETURNING *`,
    )
    .bind(input.host, now + LEASE_SECONDS, now, now, ...input.types)
    .first<JobRow>();
  return row ? toJob(row) : null;
}

/** Extend a lease the caller still holds. False means the lease was lost (expired or requeued). */
export async function extendLease(
  db: D1Database,
  id: string,
  host: string,
  now = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  const result = await db
    .prepare(
      "UPDATE agent_jobs SET lease_until = ? WHERE id = ? AND status = 'leased' AND lease_owner = ?",
    )
    .bind(now + LEASE_SECONDS, id, host)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

/** Finish a leased job. False when the caller no longer holds the lease. */
export async function finishJob(
  db: D1Database,
  id: string,
  host: string,
  outcome: {
    status: "succeeded" | "failed" | "needs_review";
    result?: unknown;
    error?: string | null;
    retry?: boolean;
  },
): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  if (outcome.status === "failed" && outcome.retry) {
    const result = await db
      .prepare(
        `UPDATE agent_jobs SET
           status = CASE WHEN attempts + 1 >= ? THEN 'failed' ELSE 'queued' END,
           attempts = attempts + 1, error = ?, lease_owner = NULL, lease_until = NULL,
           run_after = ? + 60 * (attempts + 1),
           finished_at = CASE WHEN attempts + 1 >= ? THEN ? ELSE NULL END
         WHERE id = ? AND status = 'leased' AND lease_owner = ?`,
      )
      .bind(MAX_ATTEMPTS, outcome.error ?? null, now, MAX_ATTEMPTS, now, id, host)
      .run();
    return (result.meta.changes ?? 0) > 0;
  }
  const result = await db
    .prepare(
      `UPDATE agent_jobs SET status = ?, result = ?, error = ?, lease_owner = NULL, lease_until = NULL, finished_at = ?
       WHERE id = ? AND status = 'leased' AND lease_owner = ?`,
    )
    .bind(
      outcome.status,
      outcome.result === undefined ? null : JSON.stringify(outcome.result),
      outcome.error ?? null,
      now,
      id,
      host,
    )
    .run();
  return (result.meta.changes ?? 0) > 0;
}

/** Leases past their deadline go back to the queue; the third time they fail. */
export async function requeueExpired(
  db: D1Database,
  now = Math.floor(Date.now() / 1000),
): Promise<number> {
  const result = await db
    .prepare(
      `UPDATE agent_jobs SET
         status = CASE WHEN attempts + 1 >= ? THEN 'failed' ELSE 'queued' END,
         attempts = attempts + 1, lease_owner = NULL, lease_until = NULL,
         error = COALESCE(error, 'lease expired'),
         finished_at = CASE WHEN attempts + 1 >= ? THEN ? ELSE NULL END
       WHERE status = 'leased' AND lease_until < ?`,
    )
    .bind(MAX_ATTEMPTS, MAX_ATTEMPTS, now, now)
    .run();
  return result.meta.changes ?? 0;
}

export async function recordHeartbeat(
  db: D1Database,
  input: { host: string; version: string; backend: string; runningJobId: string | null },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO runner_status (host, version, backend, last_seen_at, running_job_id) VALUES (?, ?, ?, unixepoch(), ?)
       ON CONFLICT (host) DO UPDATE SET version = excluded.version, backend = excluded.backend,
         last_seen_at = excluded.last_seen_at, running_job_id = excluded.running_job_id`,
    )
    .bind(input.host, input.version, input.backend, input.runningJobId)
    .run();
}

export async function runnerStatuses(db: D1Database) {
  const { results } = await db
    .prepare("SELECT * FROM runner_status ORDER BY last_seen_at DESC")
    .all<{
      host: string;
      version: string | null;
      backend: string | null;
      last_seen_at: number;
      running_job_id: string | null;
    }>();
  return results;
}

export async function listJobs(
  db: D1Database,
  filter: { campaignId?: number; limit?: number } = {},
): Promise<Job[]> {
  const where = filter.campaignId ? "WHERE campaign_id = ?" : "";
  const { results } = await db
    .prepare(`SELECT * FROM agent_jobs ${where} ORDER BY created_at DESC LIMIT ?`)
    .bind(...(filter.campaignId ? [filter.campaignId] : []), filter.limit ?? 50)
    .all<JobRow>();
  return results.map(toJob);
}

export async function jobCounts(db: D1Database) {
  const { results } = await db
    .prepare(
      "SELECT type, status, COUNT(*) AS n, MIN(created_at) AS oldest FROM agent_jobs GROUP BY type, status",
    )
    .all<{ type: JobType; status: JobStatus; n: number; oldest: number }>();
  return results;
}

/** Open (queued or leased) jobs of a type for a campaign, optionally matching a payload key. */
export async function openJobs(db: D1Database, campaignId: number, type: JobType): Promise<Job[]> {
  const { results } = await db
    .prepare(
      "SELECT * FROM agent_jobs WHERE campaign_id = ? AND type = ? AND status IN ('queued','leased')",
    )
    .bind(campaignId, type)
    .all<JobRow>();
  return results.map(toJob);
}
