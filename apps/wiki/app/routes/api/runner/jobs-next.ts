import type { LoaderFunctionArgs } from "react-router";
import { requireRunner, runnerHost } from "~/features/jobs/runner-routes.server";
import { leaseNextJob } from "~/features/jobs/runner.server";
import type { AgentJobType } from "~/features/jobs/shared";
import { getDb } from "~/lib/db.server";

const TYPES: readonly AgentJobType[] = ["synthesize", "answer", "consolidate", "translate"];
const POLL_MS = 2000;

/** GET /api/runner/jobs/next?types=synthesize,translate&wait=25 — lease one job or 204. */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  requireRunner(request, env);
  const url = new URL(request.url);
  const types = (url.searchParams.get("types") ?? "")
    .split(",")
    .filter((type): type is AgentJobType => TYPES.includes(type as AgentJobType));
  const waitMs = Math.min(Number(url.searchParams.get("wait") ?? "0") || 0, 25) * 1000;
  const db = getDb(env);
  const deadline = Date.now() + waitMs;
  do {
    const job = await leaseNextJob(db, { types, host: runnerHost(request) });
    if (job) {
      return Response.json({
        id: job.id,
        type: job.type,
        spaceId: job.spaceId,
        payload: JSON.parse(job.payload),
        attempts: job.attempts,
        deadlineAt: job.deadlineAt ? Math.floor(job.deadlineAt.getTime() / 1000) : null,
      });
    }
    if (Date.now() + POLL_MS > deadline) break;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  } while (Date.now() < deadline);
  return new Response(null, { status: 204 });
}
