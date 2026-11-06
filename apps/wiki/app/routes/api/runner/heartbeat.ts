import type { ActionFunctionArgs } from "react-router";
import { readJson, requireRunner, runnerHost } from "~/features/jobs/runner-routes.server";
import { recordRunnerHeartbeat } from "~/features/jobs/runner.server";
import { getDb } from "~/lib/db.server";

/** POST /api/runner/heartbeat — runner liveness (shown on /admin/runner). */
export async function action({ request, context }: ActionFunctionArgs) {
  const { env } = context.cloudflare;
  requireRunner(request, env);
  const body = await readJson<{ version?: string; backend?: string; runningJobId?: string | null }>(
    request,
  );
  await recordRunnerHeartbeat(getDb(env), {
    host: runnerHost(request),
    version: String(body?.version ?? "").slice(0, 50),
    backend: String(body?.backend ?? "").slice(0, 20),
    runningJobId: body?.runningJobId ?? null,
  });
  return Response.json({ ok: true, now: Math.floor(Date.now() / 1000) });
}
