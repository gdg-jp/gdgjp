import type { ActionFunctionArgs } from "react-router";
import { leaseUpdateSchema } from "~/features/jobs/runner-input.server";
import { requireRunner, runnerHost } from "~/features/jobs/runner-routes.server";
import { extendJobLease } from "~/features/jobs/runner.server";
import { getDb } from "~/lib/db.server";

export async function action({ request, context, params }: ActionFunctionArgs) {
  const { env } = context.cloudflare;
  requireRunner(request, env);
  const body = leaseUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "invalid_lease" }, { status: 400 });
  const ok = await extendJobLease(getDb(env), {
    jobId: params.id ?? "",
    host: runnerHost(request),
    attempts: body.data.attempts,
  });
  return ok ? Response.json({ ok }) : Response.json({ error: "lease_lost" }, { status: 409 });
}
