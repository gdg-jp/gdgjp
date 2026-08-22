import { nanoid } from "nanoid";

export type JobStatus = "queued" | "running" | "succeeded" | "failed";
export type JobType =
  | "create_event"
  | "update_event"
  | "publish_event"
  | "create_sub_event"
  | "delete_sub_event"
  | "upsert_survey"
  | "upsert_conference"
  | "upload_event_image"
  | "copy_event"
  | "delete_event_draft"
  | "cancel_event"
  | "update_participant"
  | "send_event_message"
  | "create_voucher_recipient"
  | "update_voucher_recipient"
  | "delete_voucher_recipient"
  | "relogin";

export type JobRecord = {
  id: string;
  type: JobType;
  status: JobStatus;
  groupSlug: string;
  eventId: string | null;
  requestJson: string;
  resultJson: string | null;
  error: string | null;
  artifactKey: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type JobQueueMessage = {
  jobId: string;
};

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

export async function createJob(
  env: Env,
  input: {
    type: JobType;
    groupSlug: string;
    eventId?: string | null;
    request: unknown;
    createdBy: string;
  },
  ctx?: ExecutionContext,
): Promise<JobRecord> {
  const id = nanoid(16);
  await env.DB.prepare(
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

  await env.JOB_QUEUE.send({ jobId: id } satisfies JobQueueMessage);
  // Vite local queue consumers often never fire; run the worker inline in dev.
  if (import.meta.env.DEV && ctx) {
    ctx.waitUntil(
      import("./job-runner.server").then((mod) =>
        mod.processJobMessage(env, ctx, { jobId: id } satisfies JobQueueMessage),
      ),
    );
  }
  const job = await getJob(env.DB, id);
  if (!job) throw new Error("job_create_failed");
  return job;
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

export function jobToJson(job: JobRecord) {
  const request = JSON.parse(job.requestJson) as Record<string, unknown>;
  const redactedRequest = Object.fromEntries(
    Object.entries(request).filter(([key]) => !["artifactKey", "body", "message"].includes(key)),
  );
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    groupId: job.groupSlug,
    eventId: job.eventId,
    request: redactedRequest,
    result: job.resultJson ? (JSON.parse(job.resultJson) as unknown) : null,
    error: job.error,
    artifactKey: job.artifactKey,
    createdBy: job.createdBy,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  };
}
