export type JobStatus = "queued" | "running" | "succeeded" | "failed";

/**
 * The public envelope shared by every async-job API (TinyURL domain
 * provisioning, SNS publish-now). `TResource` carries the app-specific
 * resource id(s) the job concerns (e.g. `{ domainId: number }`); `TResult` is
 * the app-specific success/error snapshot persisted once the job finishes.
 */
export type JobEnvelope<TType extends string, TResource extends object, TResult> = {
  id: string;
  type: TType;
  status: JobStatus;
  request: Record<string, unknown>;
  result: TResult | null;
  error: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
} & TResource;
