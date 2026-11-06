import { recordHeartbeat } from "~/features/jobs/job.repository.server";
import { readJson, requireRunner, runnerHost } from "~/features/jobs/runner-auth.server";
import type { Route } from "./+types/heartbeat";

/** POST /api/runner/heartbeat — runner liveness (shown on /admin/runner). */
export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.cloudflare;
  await requireRunner(request, env);
  const body = await readJson<{ version?: string; backend?: string; runningJobId?: string | null }>(
    request,
  );
  await recordHeartbeat(env.DB, {
    host: runnerHost(request),
    version: String(body?.version ?? "").slice(0, 50),
    backend: String(body?.backend ?? "").slice(0, 20),
    runningJobId: body?.runningJobId ?? null,
  });
  return Response.json({ ok: true, now: Math.floor(Date.now() / 1000) });
}
