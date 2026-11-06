import { extendLease } from "~/features/jobs/job.repository.server";
import { requireRunner, runnerHost } from "~/features/jobs/runner-auth.server";
import type { Route } from "./+types/jobs-heartbeat";

/** POST /api/runner/jobs/:id/heartbeat — keep the lease. 409 when it was lost. */
export async function action({ request, context, params }: Route.ActionArgs) {
  const { env } = context.cloudflare;
  await requireRunner(request, env);
  const ok = await extendLease(env.DB, params.id ?? "", runnerHost(request));
  return ok ? Response.json({ ok: true }) : Response.json({ error: "lease_lost" }, { status: 409 });
}
