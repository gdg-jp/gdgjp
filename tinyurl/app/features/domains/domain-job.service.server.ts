import type { AuthUser, UserChapter } from "@gdgjp/gdg-lib";
import { type JobEnvelope, parseJobJson } from "@gdgjp/gdg-lib/jobs";
import type { FeatureFailure } from "../shared/errors";
import {
  type DomainJobQueueMessage,
  type DomainJobRecord,
  type DomainJobType,
  getDomainJob,
  getLatestNonTerminalJobForDomain,
  insertDomainJob,
  markDomainJobFailed,
} from "./domain-job.repository.server";
import {
  VERCEL_HOBBY_DOMAIN_LIMIT,
  createPendingDomain,
  getDomainById,
  listDomainsForChapters,
  manageableChapterIds,
  normalizeApex,
} from "./index";
import type { Domain, DomainServiceDependencies } from "./index";

export type DomainJob = JobEnvelope<DomainJobType, { domainId: number }, Domain>;

export type DomainJobFailureCode = FeatureFailure["code"] | "queue_unavailable";
export type DomainJobFailure = { ok: false; code: DomainJobFailureCode; error: string };

export function domainJobFailure(code: DomainJobFailureCode, error: string): DomainJobFailure {
  return { ok: false, code, error };
}

export function domainJobToJson(job: DomainJobRecord): DomainJob {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    domainId: job.domainId,
    request: parseJobJson<Record<string, unknown>>(job.requestJson) ?? {},
    result: parseJobJson<Domain>(job.resultJson),
    error: job.error,
    createdBy: job.createdBy,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  };
}

type Actor = { user: AuthUser; chapters: UserChapter[] };

async function enqueueProvisionJob(
  deps: DomainServiceDependencies,
  env: Env,
  ctx: ExecutionContext,
  domainId: number,
  createdBy: string,
  request: unknown,
): Promise<{ ok: true; job: DomainJob } | DomainJobFailure> {
  const job = await insertDomainJob(deps.db, {
    type: "provision_domain",
    domainId,
    request,
    createdBy,
  });

  try {
    await env.JOB_QUEUE.send({ jobId: job.id } satisfies DomainJobQueueMessage);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Queue send failed";
    // Never leave an unsent job permanently queued: fail it immediately so a
    // client polling the job (or retrying the mutation) sees a clean error
    // instead of a job stuck forever in "queued".
    await markDomainJobFailed(deps.db, job.id, message);
    return domainJobFailure("queue_unavailable", "Failed to queue domain provisioning.");
  }

  // Vite local queue consumers often never fire; run the worker inline in dev.
  if (import.meta.env.DEV) {
    ctx.waitUntil(
      import("./domain-job-runner.server").then((mod) =>
        mod.processDomainJobMessage(deps, { jobId: job.id }),
      ),
    );
  }

  const persisted = await getDomainJob(deps.db, job.id);
  return { ok: true, job: domainJobToJson(persisted ?? job) };
}

export async function createDomainRegistrationJob(
  deps: DomainServiceDependencies,
  env: Env,
  ctx: ExecutionContext,
  actor: Actor,
  input: { hostname: string; chapterId: number },
): Promise<{ ok: true; job: DomainJob } | DomainJobFailure> {
  const manageableIds = manageableChapterIds(actor.user, actor.chapters);
  if (!Number.isInteger(input.chapterId) || !manageableIds.includes(input.chapterId)) {
    return domainJobFailure("forbidden", "You cannot manage domains for that chapter.");
  }

  const hostname = normalizeApex(input.hostname);
  if (!hostname || hostname === "gdgs.jp") {
    return domainJobFailure(
      "invalid_input",
      "Enter a registrable apex domain such as gdg-tokyo.jp.",
    );
  }

  const inspection = await deps.detectCustomDomain(hostname);
  if (inspection.dns.status === "unsafe" || inspection.https.status === "unsafe-redirect") {
    return domainJobFailure(
      "invalid_input",
      "This domain resolves to an unsafe or private destination.",
    );
  }

  const existing = await listDomainsForChapters(deps.db, manageableIds, false);
  if (existing.length >= VERCEL_HOBBY_DOMAIN_LIMIT) {
    return domainJobFailure(
      "invalid_input",
      "The Vercel Hobby project domain limit has been reached.",
    );
  }

  let domain: Domain;
  try {
    domain = await createPendingDomain(deps.db, {
      hostname,
      mode: inspection.mode,
      upstreamOrigin: inspection.suggestedUpstreamOrigin,
      ownerChapterId: input.chapterId,
      createdByUserId: actor.user.id,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) {
      return domainJobFailure("conflict", "That domain is already registered.");
    }
    throw error;
  }

  return enqueueProvisionJob(deps, env, ctx, domain.id, actor.user.id, input);
}

export async function createDomainSyncJob(
  deps: DomainServiceDependencies,
  env: Env,
  ctx: ExecutionContext,
  actor: Actor,
  domainId: number,
): Promise<{ ok: true; job: DomainJob } | DomainJobFailure> {
  const domain = await getDomainById(deps.db, domainId);
  if (!domain) return domainJobFailure("not_found", "Domain not found.");

  const manageableIds = manageableChapterIds(actor.user, actor.chapters);
  if (domain.ownerChapterId === null || !manageableIds.includes(domain.ownerChapterId)) {
    return domainJobFailure("forbidden", "You cannot manage domains for that chapter.");
  }
  if (domain.status === "active") {
    return domainJobFailure("conflict", "This domain is already active.");
  }

  const existingJob = await getLatestNonTerminalJobForDomain(deps.db, domainId);
  if (existingJob) {
    return domainJobFailure(
      "conflict",
      "A provisioning job is already in progress for this domain.",
    );
  }

  // A retry creates a new job against the existing error/pending domain
  // instead of inserting a duplicate domain row.
  return enqueueProvisionJob(deps, env, ctx, domain.id, actor.user.id, {});
}
