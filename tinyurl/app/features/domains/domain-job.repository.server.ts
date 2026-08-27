import type { JobStatus } from "@gdgjp/gdg-lib/jobs";

export type DomainJobType = "provision_domain";

export type DomainJobRecord = {
  id: string;
  type: DomainJobType;
  status: JobStatus;
  domainId: number;
  requestJson: string;
  resultJson: string | null;
  error: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type DomainJobQueueMessage = { jobId: string };

/** A running job whose lease has expired is assumed crashed and reclaimable. */
export const DOMAIN_JOB_RUNNING_LEASE_MS = 5 * 60_000;

const JOB_COLS =
  "id, type, status, domain_id, request_json, result_json, error, created_by, created_at, updated_at, started_at, finished_at";

function toJob(row: Record<string, unknown>): DomainJobRecord {
  return {
    id: String(row.id),
    type: row.type as DomainJobType,
    status: row.status as JobStatus,
    domainId: Number(row.domain_id),
    requestJson: String(row.request_json),
    resultJson: row.result_json == null ? null : String(row.result_json),
    error: row.error == null ? null : String(row.error),
    createdBy: String(row.created_by),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    startedAt: row.started_at == null ? null : String(row.started_at),
    finishedAt: row.finished_at == null ? null : String(row.finished_at),
  };
}

export async function insertDomainJob(
  db: D1Database,
  input: { type: DomainJobType; domainId: number; request: unknown; createdBy: string },
): Promise<DomainJobRecord> {
  const id = crypto.randomUUID();
  const row = await db
    .prepare(
      `INSERT INTO jobs (id, type, status, domain_id, request_json, created_by)
       VALUES (?, ?, 'queued', ?, ?, ?)
       RETURNING ${JOB_COLS}`,
    )
    .bind(id, input.type, input.domainId, JSON.stringify(input.request ?? {}), input.createdBy)
    .first<Record<string, unknown>>();
  if (!row) throw new Error("job_insert_failed");
  return toJob(row);
}

export async function getDomainJob(db: D1Database, id: string): Promise<DomainJobRecord | null> {
  const row = await db
    .prepare(`SELECT ${JOB_COLS} FROM jobs WHERE id = ?`)
    .bind(id)
    .first<Record<string, unknown>>();
  return row ? toJob(row) : null;
}

export async function getLatestNonTerminalJobForDomain(
  db: D1Database,
  domainId: number,
): Promise<DomainJobRecord | null> {
  const row = await db
    .prepare(
      `SELECT ${JOB_COLS} FROM jobs
       WHERE domain_id = ? AND status IN ('queued', 'running')
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(domainId)
    .first<Record<string, unknown>>();
  return row ? toJob(row) : null;
}

/**
 * Claims a queued job, or reclaims a running one whose lease has expired
 * (worker crashed mid-run). Returns false if another delivery already holds
 * the lease, so the caller should no-op rather than run the provider call
 * concurrently.
 */
export async function markDomainJobRunning(
  db: D1Database,
  id: string,
  leaseMs: number = DOMAIN_JOB_RUNNING_LEASE_MS,
): Promise<boolean> {
  const cutoff = new Date(Date.now() - leaseMs).toISOString();
  const result = await db
    .prepare(
      `UPDATE jobs SET status = 'running',
         started_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ? AND (status = 'queued' OR (status = 'running' AND started_at < ?))`,
    )
    .bind(id, cutoff)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function markDomainJobSucceeded(
  db: D1Database,
  id: string,
  result: unknown,
): Promise<void> {
  await db
    .prepare(
      `UPDATE jobs SET status = 'succeeded', result_json = ?, error = NULL,
         finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`,
    )
    .bind(JSON.stringify(result ?? null), id)
    .run();
}

export async function markDomainJobFailed(
  db: D1Database,
  id: string,
  error: string,
  result?: unknown,
): Promise<void> {
  await db
    .prepare(
      `UPDATE jobs SET status = 'failed', error = ?,
         result_json = COALESCE(?, result_json),
         finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`,
    )
    .bind(error, result === undefined ? null : JSON.stringify(result), id)
    .run();
}
