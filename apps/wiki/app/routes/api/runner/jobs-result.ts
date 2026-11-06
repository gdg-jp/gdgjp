import type { ActionFunctionArgs } from "react-router";
import { readJson, requireRunner, runnerHost } from "~/features/jobs/runner-routes.server";
import { type JobResult, completeJob } from "~/features/jobs/runner.server";
import { getDb } from "~/lib/db.server";

/** POST /api/runner/jobs/:id/result — finish a leased job. */
export async function action({ request, context, params }: ActionFunctionArgs) {
  const { env } = context.cloudflare;
  requireRunner(request, env);
  const body = await readJson<JobResult>(request);
  if (!body || !["succeeded", "failed", "needs_review"].includes(body.status)) {
    return Response.json({ error: "invalid_result" }, { status: 400 });
  }
  const result = await completeJob(env, getDb(env), {
    ...body,
    jobId: params.id ?? "",
    host: runnerHost(request),
  });
  return result.ok
    ? Response.json(result)
    : Response.json({ error: "lease_lost" }, { status: 409 });
}
