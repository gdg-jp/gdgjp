import type { JobRecord } from "./job-types";
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
