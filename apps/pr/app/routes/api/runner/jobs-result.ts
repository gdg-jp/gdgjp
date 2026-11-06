import { importResult, releaseFailedFix } from "~/features/jobs/complete.server";
import { finishJob, getJob } from "~/features/jobs/job.repository.server";
import { readJson, requireRunner, runnerHost } from "~/features/jobs/runner-auth.server";
import type { RunnerResult } from "~/features/jobs/shared";
import type { Route } from "./+types/jobs-result";

/** POST /api/runner/jobs/:id/result — import the output (validated and checked here) and finish. */
export async function action({ request, context, params }: Route.ActionArgs) {
  const { env } = context.cloudflare;
  await requireRunner(request, env);
  const host = runnerHost(request);
  const body = await readJson<RunnerResult>(request);
  if (!body || !["succeeded", "failed", "needs_review"].includes(body.status)) {
    return Response.json({ error: "invalid_result" }, { status: 400 });
  }
  const job = await getJob(env.DB, params.id ?? "");
  if (!job || job.status !== "leased" || job.leaseOwner !== host)
    return Response.json({ error: "lease_lost" }, { status: 409 });
  if (body.status === "failed" && body.retry) {
    await finishJob(env.DB, job.id, host, {
      status: "failed",
      error: body.error ?? null,
      retry: true,
    });
    return Response.json({ ok: true, retried: true });
  }
  const outcome = await importResult(env.DB, job, body, env);
  const ok = await finishJob(env.DB, job.id, host, {
    status: outcome.status,
    result: outcome.summary,
    error: outcome.error ?? null,
  });
  if (outcome.status === "failed") await releaseFailedFix(env.DB, job);
  return ok
    ? Response.json({ ok: true, ...outcome })
    : Response.json({ error: "lease_lost" }, { status: 409 });
}
