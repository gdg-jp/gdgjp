import { nanoid } from "nanoid";
import type { JobRecord, JobStatus, JobType, NewJobInput } from "./job-types";
function mapRow(row: Record<string, unknown>): JobRecord {
  return {
    id: String(row.id),
    type: row.type as JobType,
    status: row.status as JobStatus,
    groupSlug: String(row.group_slug),
    eventId: row.event_id == null ? null : String(row.event_id),
    requestJson: String(row.request_json),
    resultJson: row.result_json == null ? null : String(row.result_json),
    error: row.error == null ? null : String(row.error),
    artifactKey: row.artifact_key == null ? null : String(row.artifact_key),
    createdBy: String(row.created_by),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    startedAt: row.started_at == null ? null : String(row.started_at),
    finishedAt: row.finished_at == null ? null : String(row.finished_at),
  };
}

export async function getJob(db: D1Database, jobId: string): Promise<JobRecord | null> {
  const row = await db.prepare("SELECT * FROM jobs WHERE id = ?").bind(jobId).first();
  return row ? mapRow(row as Record<string, unknown>) : null;
}

export async function markJobRunning(db: D1Database, jobId: string): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE jobs SET status = 'running', started_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND status = 'queued'`,
    )
    .bind(jobId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function markJobSucceeded(
  db: D1Database,
  jobId: string,
  result: unknown,
  eventId?: string | null,
): Promise<void> {
  await db
    .prepare(
      `UPDATE jobs SET status = 'succeeded', result_json = ?, event_id = COALESCE(?, event_id),
       error = NULL, finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
    )
    .bind(JSON.stringify(result ?? {}), eventId ?? null, jobId)
    .run();
}

export async function markJobFailed(
  db: D1Database,
  jobId: string,
  error: string,
  artifactKey?: string | null,
): Promise<void> {
  await db
    .prepare(
      `UPDATE jobs SET status = 'failed', error = ?, artifact_key = COALESCE(?, artifact_key),
       finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
    )
    .bind(error, artifactKey ?? null, jobId)
    .run();
}

export async function insertQueuedJob(db: D1Database, input: NewJobInput): Promise<string> {
  const id = nanoid(16);
  await db
    .prepare(
      `INSERT INTO jobs (id, type, status, group_slug, event_id, request_json, created_by)
     VALUES (?, ?, 'queued', ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.type,
      input.groupSlug,
      input.eventId ?? null,
      JSON.stringify(input.request ?? {}),
      input.createdBy,
    )
    .run();

  return id;
}
