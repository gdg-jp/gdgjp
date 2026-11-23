import { leaseNextJob } from "~/features/jobs/job.repository.server";
import { requireRunner, runnerHost } from "~/features/jobs/runner-auth.server";
import { JOB_TYPES, type JobType, toRunnerJob } from "~/features/jobs/shared";
import type { Route } from "./+types/jobs-next";

const POLL_MS = 2000;

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  await requireRunner(request, env);
  const url = new URL(request.url);
  const types = (url.searchParams.get("types") ?? "")
    .split(",")
    .filter((t): t is JobType => (JOB_TYPES as readonly string[]).includes(t));
  const waitMs = Math.min(Number(url.searchParams.get("wait") ?? "0") || 0, 25) * 1000;
  const deadline = Date.now() + waitMs;
  do {
    const job = await leaseNextJob(env.DB, { types, host: runnerHost(request) });
    if (job) {
      return Response.json(toRunnerJob(job));
    }
    if (Date.now() + POLL_MS > deadline) break;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  } while (Date.now() < deadline);
  return new Response(null, { status: 204 });
}
