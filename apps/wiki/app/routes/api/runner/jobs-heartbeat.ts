import type { ActionFunctionArgs } from "react-router";
import { requireRunner, runnerHost } from "~/features/jobs/runner-routes.server";
import { extendJobLease } from "~/features/jobs/runner.server";
import { getDb } from "~/lib/db.server";

/** POST /api/runner/jobs/:id/heartbeat — keep the lease while the agent works. */
export async function action({ request, context, params }: ActionFunctionArgs) {
  const { env } = context.cloudflare;
  requireRunner(request, env);
  const ok = await extendJobLease(getDb(env), params.id ?? "", runnerHost(request));
  return ok ? Response.json({ ok }) : Response.json({ error: "lease_lost" }, { status: 409 });
}
