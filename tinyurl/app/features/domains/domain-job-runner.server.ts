import {
  DOMAIN_JOB_RUNNING_LEASE_MS,
  type DomainJobQueueMessage,
  type DomainJobRecord,
  getDomainJob,
  markDomainJobFailed,
  markDomainJobRunning,
  markDomainJobSucceeded,
} from "./domain-job.repository.server";
import type { DomainServiceDependencies } from "./domain.service";
import { syncDomain } from "./domain.service";

export type { DomainJobQueueMessage };

export type DomainJobProcessOutcome =
  | { outcome: "handled" }
  | { outcome: "not_found" }
  | { outcome: "already_terminal" }
  // Another delivery already holds the running lease. The caller must
  // schedule redelivery around when that lease expires — see
  // processDomainJobQueueBatch — otherwise a worker that crashed mid-run
  // never gets its job reclaimed and it stays "running" forever.
  | { outcome: "lease_active"; retryDelaySeconds: number };

const MIN_LEASE_RETRY_DELAY_SECONDS = 5;

function leaseRetryDelaySeconds(job: DomainJobRecord): number {
  const startedAtMs = job.startedAt ? Date.parse(job.startedAt) : Date.now();
  const leaseExpiresAtMs = startedAtMs + DOMAIN_JOB_RUNNING_LEASE_MS;
  const remainingMs = leaseExpiresAtMs - Date.now();
  return Math.max(MIN_LEASE_RETRY_DELAY_SECONDS, Math.ceil(remainingMs / 1000));
}

/**
 * Both registration and resync enqueue the same `provision_domain` job type
 * against an already-persisted (pending or errored) domain row, so this
 * dispatcher only ever needs to call `syncDomain` — it creates the domain in
 * the provider on first run (via its own check-then-create fallback) and
 * re-verifies it on every subsequent run.
 */
export async function processDomainJobMessage(
  deps: DomainServiceDependencies,
  message: DomainJobQueueMessage,
): Promise<DomainJobProcessOutcome> {
  const job = await getDomainJob(deps.db, message.jobId);
  if (!job) return { outcome: "not_found" };
  // Terminal redelivery (e.g. an at-least-once queue re-delivering an
  // already-finished message) is a no-op.
  if (job.status === "succeeded" || job.status === "failed") {
    return { outcome: "already_terminal" };
  }

  if (job.type !== "provision_domain") {
    await markDomainJobFailed(deps.db, job.id, `unknown_job_type:${job.type}`);
    return { outcome: "handled" };
  }

  const claimed = await markDomainJobRunning(deps.db, job.id);
  if (!claimed) {
    return { outcome: "lease_active", retryDelaySeconds: leaseRetryDelaySeconds(job) };
  }

  const result = await syncDomain(deps, job.domainId);
  if (result.ok) {
    await markDomainJobSucceeded(deps.db, job.id, result.domain);
  } else {
    await markDomainJobFailed(deps.db, job.id, result.error, result.domain);
  }
  return { outcome: "handled" };
}

/** Structural subset of Cloudflare's `Message<Body>` this module depends on. */
export type DomainJobQueueMessageHandle = {
  readonly body: DomainJobQueueMessage;
  ack: () => void;
  retry: (options?: { delaySeconds?: number }) => void;
};

/**
 * Applies the ack/retry policy for a batch of queue messages: a message
 * whose job is still within another delivery's lease is retried with a
 * delay timed to land after that lease expires (so a crashed worker's job
 * eventually gets reclaimed); everything else that doesn't throw is acked;
 * a thrown error retries immediately, deferring to the queue's own backoff.
 */
export async function processDomainJobQueueBatch(
  deps: DomainServiceDependencies,
  messages: readonly DomainJobQueueMessageHandle[],
): Promise<void> {
  for (const message of messages) {
    try {
      const result = await processDomainJobMessage(deps, message.body);
      if (result.outcome === "lease_active") {
        message.retry({ delaySeconds: result.retryDelaySeconds });
      } else {
        message.ack();
      }
    } catch (error) {
      console.error("tinyurl domain job failed", error);
      message.retry();
    }
  }
}
